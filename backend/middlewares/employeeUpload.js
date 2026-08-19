import multer from 'multer';

import env from '../config/env.js';
import ApiError from '../utils/ApiError.js';
import employeeRepository from '../repositories/employee/employee.repository.js';
import {
  categoryFolder,
  createEmployeeFolders,
  relativePath,
  removeStoredFile,
  safeFileName,
  uniqueFileName,
} from '../helpers/employeeFiles.helper.js';
import { DOCUMENT_TYPES } from '../utils/constants.js';

/**
 * The one upload middleware every employee-document route uses.
 *
 * Every section of the Documents tab -- the photo, the single-file identity
 * documents, and the multi-file categories -- goes through this. The only
 * thing that varies is the document type, which arrives in the route
 * parameter, so there is no per-section upload code to keep in step.
 *
 * The destination is computed per request from the employee and the type, so
 * Multer writes straight into `attachments/EMP00001/NationalID/` rather than
 * into a staging directory that something else then has to move files out of.
 */

const IMAGE_MIMES = ['image/jpeg', 'image/png'];
const PDF_MIME = 'application/pdf';
const ALLOWED = [...IMAGE_MIMES, PDF_MIME];

/**
 * Per-type size limits.
 *
 * Multer takes a single `fileSize`, so the ceiling is set to the larger of the
 * two and the image limit is enforced in the filter, where the MIME type is
 * known. Setting one 2 MB limit would reject valid PDFs; setting one 10 MB
 * limit would accept a 9 MB photograph.
 */
const limitFor = (mimetype) =>
  mimetype === PDF_MIME ? env.attachments.maxPdfBytes : env.attachments.maxImageBytes;

const megabytes = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * Resolves the employee and prepares its folders before Multer runs.
 *
 * Doing this first means a request for an unknown employee is refused before a
 * single byte is written, and that the destination directory is guaranteed to
 * exist by the time the disk storage engine asks for it -- including for
 * employees created before this feature existed.
 */
export const prepareEmployeeFolder = async (req, _res, next) => {
  try {
    const employee = await employeeRepository.findById(req.params.id, { populate: false });
    if (!employee) throw ApiError.notFound('Employee not found');

    const tenantMatches =
      String(employee.tenantId ?? null) === String(req.user?.tenantId ?? null);
    if (!tenantMatches) throw ApiError.notFound('Employee not found');

    const documentType = req.params.type ?? req.body?.type ?? DOCUMENT_TYPES.OTHER;
    if (!Object.values(DOCUMENT_TYPES).includes(documentType)) {
      throw ApiError.badRequest(`Unknown document type: ${documentType}`);
    }

    await createEmployeeFolders(employee.employeeCode);

    // Handed to the storage engine and to the controller, so neither has to
    // load the employee a second time.
    req.employeeRecord = employee;
    req.documentType = documentType;

    return next();
  } catch (error) {
    return next(error);
  }
};

const storage = multer.diskStorage({
  destination(req, _file, callback) {
    try {
      callback(null, categoryFolder(req.employeeRecord.employeeCode, req.documentType));
    } catch (error) {
      callback(error);
    }
  },

  filename(req, file, callback) {
    try {
      const directory = categoryFolder(req.employeeRecord.employeeCode, req.documentType);
      const safe = safeFileName(file.originalname, file.mimetype);
      callback(null, uniqueFileName(directory, safe));
    } catch (error) {
      callback(error);
    }
  },
});

const fileFilter = (_req, file, callback) => {
  if (!ALLOWED.includes(file.mimetype)) {
    const error = new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname);
    error.message = `${file.originalname}: only JPG, PNG and PDF files are accepted`;
    return callback(error);
  }

  // Multer streams the file before reporting its size, so an oversized image
  // is caught here by the declared length where the browser supplies one, and
  // by the hard `fileSize` limit below in every case.
  const declared = Number(file.size ?? 0);
  if (declared > 0 && declared > limitFor(file.mimetype)) {
    const error = new multer.MulterError('LIMIT_FILE_SIZE', file.fieldname);
    error.message = `${file.originalname} is larger than ${megabytes(limitFor(file.mimetype))}`;
    return callback(error);
  }

  return callback(null, true);
};

const uploader = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: Math.max(env.attachments.maxImageBytes, env.attachments.maxPdfBytes),
    files: 10,
  },
});

/** Single-file sections: photo, the identity documents, and the resume. */
export const uploadSingle = uploader.single('file');

/** Multi-file sections: education, experience, other. */
export const uploadMany = uploader.array('files', 10);

/**
 * Catches what the size limit could not.
 *
 * An image between 2 MB and 10 MB passes Multer's ceiling and lands on disk
 * before its real size is known. It is removed here rather than left as an
 * orphan, and the caller is told which rule it broke.
 */
export const enforcePerTypeLimits = async (req, _res, next) => {
  const files = req.files ?? (req.file ? [req.file] : []);
  const offenders = files.filter((file) => file.size > limitFor(file.mimetype));

  if (offenders.length === 0) return next();

  // The whole batch goes, not just the offender: a partial upload that reports
  // an error but keeps half the files is worse than one that keeps none.
  await Promise.all(files.map((file) => removeStoredFile(relativePath(file.path))));

  return next(
    ApiError.badRequest(
      offenders
        .map((file) => `${file.originalname} is larger than ${megabytes(limitFor(file.mimetype))}`)
        .join('; '),
    ),
  );
};

export default { prepareEmployeeFolder, uploadSingle, uploadMany, enforcePerTypeLimits };
