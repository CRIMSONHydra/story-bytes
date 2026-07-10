import multer from 'multer';
import { ApiError } from './errors';

const UPLOAD_DIR = '/tmp/story-bytes-uploads';
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB
const ALLOWED = ['.epub', '.cbz', '.cbr', '.txt', '.md', '.pdf'];
const ACCEPTED = ALLOWED.join(', ');

export const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const dotIndex = file.originalname.lastIndexOf('.');
    if (dotIndex === -1) {
      // ApiError → the central handler returns a 400 envelope (not a raw 500).
      cb(new ApiError(400, 'UNSUPPORTED_FILE_TYPE', `File must have an extension. Accepted: ${ACCEPTED}`));
      return;
    }
    const ext = file.originalname.toLowerCase().slice(dotIndex);
    if (ALLOWED.includes(ext)) {
      cb(null, true);
    } else {
      cb(new ApiError(400, 'UNSUPPORTED_FILE_TYPE', `Unsupported file type: ${ext}. Accepted: ${ACCEPTED}`));
    }
  },
});
