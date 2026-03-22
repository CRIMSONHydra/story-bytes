import multer from 'multer';

const UPLOAD_DIR = '/tmp/story-bytes-uploads';
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

export const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.toLowerCase().slice(file.originalname.lastIndexOf('.'));
    const allowed = ['.epub', '.cbz', '.cbr'];
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${ext}. Accepted: .epub, .cbz, .cbr`));
    }
  },
});
