const fs = require('fs');
const fsPromises = require('fs/promises');
const crypto = require('crypto');

/**
 * 读取：
 * 1. 文件大小
 * 2. 文件开头 64KB
 * 3. 文件中间 64KB
 * 4. 文件结尾 64KB
 */
async function calculate_Quick_Finger_print(filePath,fileSize) {
    const fileHandle = await fsPromises.open(filePath,'r');
    try {
        const chunkSize = 64 * 1024;           // 防止文件本身小于64KB
        const actualChunkSize = Math.min(chunkSize,fileSize);

        // 1. 文件开头
        const startBuffer = Buffer.alloc(actualChunkSize);
        if (actualChunkSize > 0) {
            await fileHandle.read(
                startBuffer, 0,
                actualChunkSize, 0
            );
        }

        // 2. 文件中间
        const middleBuffer = Buffer.alloc(actualChunkSize);
        const middlePosition = Math.max(0, Math.floor(fileSize / 2) - Math.floor(actualChunkSize / 2));
        if (actualChunkSize > 0) {
            await fileHandle.read(
                middleBuffer,0,
                actualChunkSize,middlePosition
            );
        }

        // 3. 文件结尾
        const endBuffer = Buffer.alloc(actualChunkSize);
        const endPosition = Math.max(0, fileSize - actualChunkSize);
        if (actualChunkSize > 0) {
            await fileHandle.read(
                endBuffer,0,
                actualChunkSize,endPosition
            );
        }


        // 4. 生成快速指纹
        const hash = crypto.createHash('sha256');           //文件大小也参与指纹生成

        hash.update(String(fileSize));
        hash.update(startBuffer);
        hash.update(middleBuffer);
        hash.update(endBuffer);

        return hash.digest('hex');
    } finally {
        await fileHandle.close();
    }
}

//完整 SHA-256,使用 Stream，不会一次性把整个 PDF 加载到内存。
function calculate_Full_Sha256( filePath ) {
    return new Promise((resolve, reject) => {
            const hash = crypto.createHash('sha256');
            const stream = fs.createReadStream(filePath);

            stream.on('data',chunk => {hash.update(chunk);});
            stream.on('end',() => {resolve(hash.digest('hex'));});
            stream.on('error',error => {reject(error);});
        }
    );
}

module.exports = {
    calculate_Quick_Finger_print,
    calculate_Full_Sha256
};