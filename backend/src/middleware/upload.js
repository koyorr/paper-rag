const multer = require('multer');
const path = require('path');
const crypto = require('crypto');

const uploadDir = path.resolve(__dirname,'../../uploads');

const storage = multer.diskStorage(
    {destination: (req, file, cb) => {cb(null, uploadDir);},
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        const filename = `${crypto.randomUUID()}${ext}`;
        cb(null, filename);
    }
    }
);


const fileFilter = (req, file, cb) => {
    if (file.mimetype !== 'application/pdf') {
        return cb(
            new Error('目前只支持 PDF 文件')
        );
    }
    cb(null, true);
};


const upload = multer({
    storage,
    limits: {
        fileSize: 10 * 1024 * 1024
    },
    fileFilter
});


module.exports = upload;