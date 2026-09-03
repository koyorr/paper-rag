const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const upload = require('../middleware/upload');
const prisma = require('../prisma');
const {ingest_Document, delete_Documents} = require('../services/ragService');
const router = express.Router();
const {calculate_Quick_Finger_print,calculate_Full_Sha256} = require('../utils/fileFingerprint');
const UPLOAD_DIR = path.resolve(__dirname,'../../uploads');

/**
 * multer/busboy 会把非 ASCII 文件名按 latin1 解码（如中文文件名变成乱码），
 * 这里还原为正确的 UTF-8：UTF-8 字节被 latin1 解码后，再按 latin1 转回 UTF-8 即可。
 * 若解码结果出现替换符（说明本来就是 UTF-8 明文），则原样返回。
 */
function decodeOriginalName(name) {
    if (!name) return name;
    try {
        const decoded = Buffer.from(name, 'latin1').toString('utf8');
        return decoded.includes('\uFFFD') ? name : decoded;
    } catch {
        return name;
    }
}

router.post('/upload',upload.single('file'),async (req, res) => {
        let document = null;
        try {
             if (!req.file) {
                return res.status(400).json({message:'没有上传文件'});
            }

            // 还原中文文件名（multer latin1 解码问题）
            req.file.originalname = decodeOriginalName(req.file.originalname);

            // 现在先模拟用户,后面做好 JWT 后：const userId = req.user.id;
            const userId = Number(req.header('x-user-id'));
            if (!userId) {
                return res.status(401).json({message: '缺少 x-user-id'});
            }

            console.log('\n========== 文件上传 ==========');
            console.log('原始文件名:',req.file.originalname);
            console.log('存储文件名:',req.file.filename);
            console.log('文件大小:',req.file.size,'bytes');

            // 查询同大小文件
            const sameSizeDocuments =
                await prisma.document.findMany({
                    where: {userId, size:req.file.size},
                    select: {
                        id:true,
                        originalName: true,
                        storedName:true,
                        size:true,
                        quickFingerprint:true,
                        fileHash:true,
                        createdAt:true
                    }
                });
            console.log('同大小候选文件数量:', sameSizeDocuments.length);

            // 第一轮快速验证
            const quickFingerprint = await calculate_Quick_Finger_print(
                    req.file.path,
                    req.file.size
                );
            console.log( 'Quick Fingerprint:', quickFingerprint );

            // 在同大小文件中找快速指纹一致的候选
            const fingerprintCandidates = sameSizeDocuments.filter(item =>
                        item.quickFingerprint === quickFingerprint
                );
            console.log( '快速指纹匹配候选:', fingerprintCandidates.length );

            let currentFullHash = null;

            // 新上传文件总是计算完整 SHA-256（文件指纹，状态 READY 依赖它生成）
            currentFullHash = await calculate_Full_Sha256( req.file.path );

            // 只有出现疑似重复才需要与旧文件逐个比对完整 SHA-256
            if (fingerprintCandidates.length > 0) {
                console.log('发现疑似重复文件，进行完整SHA-256比对...');
                console.log('新文件 SHA-256:',currentFullHash);

                // 与候选文件逐个比较
                for (const candidate of fingerprintCandidates) {
                    let candidateHash = candidate.fileHash;

                    // 旧文件以前没有计算过完整SHA，第一次遇到疑似重复时，给旧文件补算一次。
                    if (!candidateHash) {
                        const oldFilePath = path.join(UPLOAD_DIR,candidate.storedName);

                        // 检查旧物理文件是否存在
                        try {
                            await fs.access( oldFilePath );
                        } catch {
                            console.warn(`警告：数据库文档 ${candidate.id} 存在，但物理文件不存在`);

                            // 数据库和文件系统不一致，跳过这个候选。
                            continue;
                        }

                        console.log(`正在补算旧文件 ${candidate.id} 的SHA-256`);
                        candidateHash = await calculate_Full_Sha256(oldFilePath);


                        //写回MySQL
                        await prisma.document.update({
                            where: {id:candidate.id},
                            data: {fileHash:candidateHash }
                        });
                    }


                    // 最终重复判断
                    if (candidateHash === currentFullHash) {
                        console.log('重复文件:',candidate.originalName);

                        //删除刚刚 Multer产生的新文件
                        await fs.unlink(req.file.path).catch(() => {});

                        return res.status(409).json({
                                message:'该文件已经上传过，请勿重复上传',
                                duplicate:true,
                                documentId:candidate.id,
                                originalName:candidate.originalName,
                                uploadTime:candidate.createdAt.toLocaleString(
                                            'zh-CN',
                                            {
                                                timeZone:'Asia/Shanghai',
                                                hour12: false
                                            }
                                        )
                            });
                    }
                }
                /*
                 * 快速指纹一样，但是完整 SHA 不一样。说明不是同一个文件。
                 * currentFullHash 已经算出来了，后面直接保存。
                 */
                // console.log('完整SHA不同，不是重复文件');
            }


            // 1. MySQL 新建文档记录
            document = await prisma.document.create({
                    data: {
                        userId,
                        originalName: req.file.originalname,                 
                        storedName: req.file.filename,
                        mimeType: req.file.mimetype,
                        size: req.file.size,
                        quickFingerprint,
                        fileHash:currentFullHash,
                        status: 'PROCESSING',
                    }
                });

            // 2. 调用 Python（分块参数来自前端设置请求头 x-rag-*）
            const chunkSize = req.header('x-rag-chunk-size') || undefined;
            const chunkOverlap = req.header('x-rag-chunk-overlap') || undefined;
            const result = await ingest_Document({
                    documentId: document.id,
                    storedName: document.storedName,
                    originalName:  document.originalName,
                    userId,
                    chunkSize,
                    chunkOverlap
                });

            // 3. Python成功后更新MySQL
            const updatedDocument = await prisma.document.update({
                where: {id: document.id},
                data: {
                    status: 'READY',
                    chunkCount: result.chunks
                }
            });


            // 返回前端
            return res.json({
                message: '文档上传并入库成功',
                duplicate:false,
                documentId: document.id,
                originalName:document.originalName,
                chunks: result.chunks,
                createdAt: document.createdAt,
                uploadTime: document.createdAt.toLocaleString(
                    'zh-CN',
                    {
                        timeZone: 'Asia/Shanghai',
                        hour12: false
                    }
                )
            });

        } catch (error) {
            console.error(error);
            // 如果MySQL Document已经创建成功，但是Python处理失败，更新为FAILED。
            if (document) {
                await prisma.document.update({
                    where: { id: document.id },
                    data: { status: 'FAILED' }
                // .catch(() => {})忽略可能出现的二次错误（如数据库连接失败），避免影响最终响应
                }).catch(() => {});         
            }
            // 如果document都还没有创建，说明在去重/数据库写入阶段就失败了。这种情况下删除Multer产生的文件。
            if (!document && req.file?.path) {
                await fs.unlink(req.file.path).catch(() => {});
            }

            return res.status(500).json({
                message: '文档处理失败',
                error:  error.response?.data ?? error.message
            });
        }
    }
);


/** GET /api/documents  文档列表 */
router.get('/', async (req, res) => {
    try {
        const userId = Number(req.header('x-user-id'));
        if (!userId) {
            return res.status(401).json({ message: '缺少 x-user-id' });
        }

        const docs = await prisma.document.findMany({
            where: { userId },
            orderBy: { createdAt: 'desc' }
        });

        res.json({
            documents: docs.map((d) => ({
                id: d.id,
                originalName: d.originalName,
                storedName: d.storedName,
                mimeType: d.mimeType,
                size: d.size,
                status: d.status,
                chunkCount: d.chunkCount,
                fileHash: d.fileHash,
                createdAt: d.createdAt,
                uploadTime: d.createdAt.toLocaleString(
                    'zh-CN',
                    { timeZone: 'Asia/Shanghai', hour12: false }
                )
            }))
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: '获取文档列表失败', error: error.message });
    }
});

/** GET /api/documents/:id/file  打开论文 PDF（新标签页预览） */
router.get('/:id/file', async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id) return res.status(400).json({ message: '参数错误' });

        const doc = await prisma.document.findUnique({ where: { id } });
        if (!doc) return res.status(404).json({ message: '文档不存在' });

        const filePath = path.resolve(UPLOAD_DIR, doc.storedName);
        if (!filePath.startsWith(path.resolve(UPLOAD_DIR) + path.sep)) {
            return res.status(400).json({ message: '非法文件路径' });
        }

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            `inline; filename*=UTF-8''${encodeURIComponent(doc.originalName)}`
        );
        res.sendFile(filePath, (err) => {
            if (err) {
                console.error('打开文件失败:', err.message);
                if (!res.headersSent) {
                    res.status(404).json({ message: '文件不存在或已删除' });
                }
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: '打开文件失败', error: error.message });
    }
});

/** DELETE /api/documents/:id  删除文档：物理文件 + Chroma 向量 + MySQL 记录 */
router.delete('/:id', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = Number(req.header('x-user-id'));
        if (!userId) return res.status(401).json({ message: '缺少 x-user-id' });
        if (!id) return res.status(400).json({ message: '参数错误' });

        const doc = await prisma.document.findUnique({ where: { id } });
        if (!doc) return res.status(404).json({ message: '文档不存在' });

        // 1. 删除 Chroma 向量（失败不阻断后续清理）
        try {
            await delete_Documents({ documentId: id, userId });
        } catch (e) {
            console.warn('删除向量失败（继续清理其余部分）:', e.message);
        }

        // 2. 删除 uploads 中的物理文件
        await fs.unlink(path.join(UPLOAD_DIR, doc.storedName)).catch(() => {});

        // 3. 删除 MySQL 记录
        await prisma.document.delete({ where: { id } });

        res.json({ message: '删除成功', documentId: id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: '删除失败', error: error.message });
    }
});

/** POST /api/documents/:id/reindex  重新解析入库（删旧向量 -> 重新分块向量化） */
router.post('/:id/reindex', async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = Number(req.header('x-user-id'));
        if (!userId) return res.status(401).json({ message: '缺少 x-user-id' });
        if (!id) return res.status(400).json({ message: '参数错误' });

        const doc = await prisma.document.findUnique({ where: { id } });
        if (!doc) return res.status(404).json({ message: '文档不存在' });

        const filePath = path.join(UPLOAD_DIR, doc.storedName);
        await fs.access(filePath);

        // 1. 删除旧向量
        try {
            await delete_Documents({ documentId: id, userId });
        } catch (e) {
            console.warn('删除旧向量失败（继续重新解析）:', e.message);
        }

        // 2. 重新分块向量化（分块参数来自前端设置请求头 x-rag-*）
        const chunkSize = req.header('x-rag-chunk-size') || undefined;
        const chunkOverlap = req.header('x-rag-chunk-overlap') || undefined;
        const result = await ingest_Document({
            documentId: id,
            storedName: doc.storedName,
            originalName: doc.originalName,
            userId,
            chunkSize,
            chunkOverlap
        });

        // 3. 更新状态
        await prisma.document.update({
            where: { id },
            data: { status: 'READY', chunkCount: result.chunks }
        });

        res.json({ message: '重新解析成功', documentId: id, chunks: result.chunks });
    } catch (error) {
        console.error(error);
        // 处理失败时标记 FAILED，便于前端展示
        try {
            const id = Number(req.params.id);
            await prisma.document.update({
                where: { id },
                data: { status: 'FAILED' }
            }).catch(() => {});
        } catch {}
        res.status(500).json({ message: '重新解析失败', error: error.response?.data ?? error.message });
    }
});

module.exports = router;