import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import env from './env.js';

const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

export const IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
export const DOCUMENT_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
export const SPREADSHEET_MIMES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/**
 * Disk storage with generated filenames.
 *
 * The client's filename is never used on disk. It is attacker-controlled and
 * has historically been the vector for path traversal (`../../`), null-byte
 * truncation and double-extension tricks. The original is kept in the database
 * for display; the file itself gets a random name and an extension derived
 * from its declared MIME type.
 */
const diskStorage = (subdirectory) =>
  multer.diskStorage({
    destination(_req, _file, callback) {
      callback(null, ensureDir(path.join(env.upload.dir, subdirectory)));
    },
    filename(_req, file, callback) {
      const extension = MIME_EXTENSIONS[file.mimetype] ?? '';
      callback(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${extension}`);
    },
  });

const fileFilter = (allowedMimes) => (_req, file, callback) => {
  if (allowedMimes.includes(file.mimetype)) return callback(null, true);

  const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname);
  error.message = `Unsupported file type: ${file.mimetype}`;
  return callback(error);
};

export const photoUpload = multer({
  storage: diskStorage('avatars'),
  fileFilter: fileFilter(IMAGE_MIMES),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
});

export const documentUpload = multer({
  storage: diskStorage('documents'),
  fileFilter: fileFilter(DOCUMENT_MIMES),
  limits: { fileSize: env.upload.maxSizeBytes, files: 10 },
});

/**
 * Import spreadsheets are held in memory, never written to disk: the file is
 * parsed once and discarded, so persisting it would only create an unmanaged
 * copy of the payroll data it contains.
 */
export const spreadsheetUpload = multer({
  storage: multer.memoryStorage(),
  fileFilter: fileFilter(SPREADSHEET_MIMES),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

export default { photoUpload, documentUpload, spreadsheetUpload };
