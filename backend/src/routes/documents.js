const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const upload = require('../middleware/upload');
const prisma = require('../prisma');
const {ingest_Document} = require('../services/ragService');
const router = express.Router();
const {calculate_Quick_Finger_print,calculate_Full_Sha256} = require('../utils/fileFingerprint');
const UPLOAD_DIR = path.resolve(__dirname,'../../uploads');

router.post('/upload',upload.single('file'),async (req, res) => {
        let document = null;
        try {
             if (!req.file) {
                return res.status(400).json({message:'没有上传文件'});
            }

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

            //只有出现疑似重复才计算完整 SHA-256
            if (fingerprintCandidates.length > 0) {
                console.log('发现疑似重复文件，开始完整SHA-256验证...');

                // 新上传文件只计算一次完整SHA
                currentFullHash = await calculate_Full_Sha256( req.file.path );
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


module.exports = router;