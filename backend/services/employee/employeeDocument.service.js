import fs from 'node:fs';

import employeeRepository from '../../repositories/employee/employee.repository.js';
import User from '../../models/auth/user.model.js';
import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS, DOCUMENT_TYPES } from '../../utils/constants.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import {
  createEmployeeFolders,
  folderFor,
  relativePath,
  removeStoredFile,
  resolveStoredPath,
} from '../../helpers/employeeFiles.helper.js';

/**
 * Employee documents: the metadata half of the attachments feature.
 *
 * The bytes are written to disk by the upload middleware before this runs.
 * What lives here is the record of them -- employee, type, original name,
 * stored name, relative path, size, MIME type, when and by whom -- which is
 * all MongoDB ever holds. Nothing here reads or writes file contents except
 * the download stream, which opens a handle and hands it to Express.
 *
 * Documents stay on the employee document as a subdocument array rather than
 * in a collection of their own: they are only ever read with their employee,
 * there are tens of them rather than thousands, and the array already existed.
 * A separate collection would have meant a second source of truth for the same
 * relationship.
 */

const ENTITY = 'Employee';

/** The sections the Documents tab shows, in order, and how each behaves. */
export const DOCUMENT_SECTIONS = [
  { type: DOCUMENT_TYPES.PHOTO, label: 'Employee Photo', multiple: false, accept: 'image' },
  { type: DOCUMENT_TYPES.PAN_COPY, label: 'PAN Card', multiple: false, accept: 'any' },
  { type: DOCUMENT_TYPES.AADHAAR_COPY, label: 'Aadhaar Card', multiple: false, accept: 'any' },
  { type: DOCUMENT_TYPES.DRIVING_LICENSE_COPY, label: 'Driving License', multiple: false, accept: 'any' },
  { type: DOCUMENT_TYPES.PASSPORT_COPY, label: 'Passport', multiple: false, accept: 'any' },
  { type: DOCUMENT_TYPES.RESUME, label: 'Resume', multiple: false, accept: 'any' },
  {
    type: DOCUMENT_TYPES.EDUCATION,
    label: 'Education Documents',
    multiple: true,
    accept: 'any',
    examples: ['10th Marksheet', '12th Marksheet', 'Graduation', 'Post Graduation', 'Diploma', 'ITI', 'Certificates'],
  },
  {
    type: DOCUMENT_TYPES.EXPERIENCE,
    label: 'Experience Documents',
    multiple: true,
    accept: 'any',
    examples: ['Offer Letter', 'Experience Letter', 'Relieving Letter', 'Salary Slip', 'Previous Company Documents'],
  },
  {
    type: DOCUMENT_TYPES.OTHER,
    label: 'Other Documents',
    multiple: true,
    accept: 'any',
    examples: ['Medical Certificate', 'Police Verification', 'Marriage Certificate', 'Birth Certificate', 'Vaccination Certificate'],
  },
];

const SECTION_TYPES = DOCUMENT_SECTIONS.map((section) => section.type);

const loadEmployee = async (id, req) => {
  const employee = await employeeRepository.findById(id, { populate: false });
  if (!employee) throw ApiError.notFound('Employee not found');

  if (String(employee.tenantId ?? null) !== String(req.user?.tenantId ?? null)) {
    // Same message as "not found" on purpose: whether an employee exists in
    // another tenant is not something this caller should be able to learn.
    throw ApiError.notFound('Employee not found');
  }

  return employee;
};

/**
 * The shape every screen receives. Matches the brief's record exactly.
 *
 * `uploadedByName` is additive -- `uploadedBy` still carries the raw id, so
 * anything already reading it is unaffected. The card needs a person's name;
 * an ObjectId on screen tells the reader nothing.
 */
const present = (employee, document, uploaderNames = new Map()) => ({
  _id: document._id,
  employeeId: employee.employeeCode,
  documentType: document.type,
  section: folderFor(document.type),
  originalName: document.title,
  storedName: document.fileName,
  path: document.filePath,
  size: document.size,
  mimeType: document.mimeType,
  uploadedAt: document.uploadedAt,
  uploadedBy: document.uploadedBy,
  uploadedByName: uploaderNames.get(String(document.uploadedBy)) ?? null,

  // Expiry and verification are stored on the document and were the only two
  // fields the Documents screen still had to read off the raw employee record
  // to render its table. Additive -- nothing that already consumes this shape
  // is affected.
  expiresAt: document.expiresAt ?? null,
  isVerified: Boolean(document.isVerified),
  verifiedAt: document.verifiedAt ?? null,
});

/** Expired, or expiring inside the window the Documents screen warns on. */
const EXPIRY_WARNING_DAYS = 60;

const isExpiringSoon = (document, now = new Date()) => {
  if (!document.expiresAt) return false;

  const threshold = new Date(now);
  threshold.setDate(threshold.getDate() + EXPIRY_WARNING_DAYS);

  return new Date(document.expiresAt) <= threshold;
};

/**
 * Resolves uploader ids to names in one query.
 *
 * A `populate` on the subdocument array would work too, but this keeps the
 * repository call unchanged and costs exactly one lookup however many
 * documents the employee has.
 */
const resolveUploaders = async (documents) => {
  const ids = [...new Set((documents ?? []).map((document) => String(document.uploadedBy)).filter(Boolean))];
  if (!ids.length) return new Map();

  const users = await User.find({ _id: { $in: ids } })
    .select('firstName lastName email')
    .lean();

  return new Map(
    users.map((user) => [
      String(user._id),
      `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email,
    ]),
  );
};

/* -------------------------------------------------------------------------- */
/*                                    Read                                    */
/* -------------------------------------------------------------------------- */

/**
 * One page of an employee's documents, newest first.
 *
 * The counts are of the WHOLE set, not of the page: "3 of 47 verified" has to
 * keep saying 47 when the reader is looking at page two, or the summary above
 * the table would change every time they turned a page.
 *
 * Newest first because a document screen is worked from the most recent upload
 * backwards. The grouped shape keeps its original insertion order, so nothing
 * that already reads it sees a reordering.
 */
const paginate = (employee, documents, { page, limit }) => {
  const now = new Date();
  const ordered = [...documents].sort(
    (a, b) => new Date(b.uploadedAt ?? 0) - new Date(a.uploadedAt ?? 0),
  );

  const total = ordered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  // A page beyond the end is clamped rather than returned empty: deleting the
  // last document on page 3 should show page 3's new contents, not a blank.
  const current = Math.min(Math.max(1, page), totalPages);
  const start = (current - 1) * limit;

  return {
    employeeId: employee.employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
    total,
    verified: ordered.filter((document) => document.isVerified).length,
    expiring: ordered.filter((document) => isExpiringSoon(document, now)).length,
    page: current,
    limit,
    totalPages,
    // 1-based, inclusive -- what "Showing 1–20 of 47" is rendered from.
    from: total ? start + 1 : 0,
    to: Math.min(start + limit, total),
    documents: ordered.slice(start, start + limit),
  };
};

/**
 * Every document the employee has, grouped by section -- or one page of them.
 *
 * Grouped on the server so the tab does not have to know which types belong to
 * which section -- the same descriptor drives the folder layout, the upload
 * route and this response.
 *
 * A caller that asks for a `limit` gets the other shape: a flat page of
 * documents, newest first, with the counts the screen needs alongside. The
 * Documents screen lists rather than groups, and shipping every document of
 * every employee to paginate them in the browser is exactly the cost
 * pagination exists to avoid.
 *
 * Which shape you get depends only on whether `limit` was supplied. Callers
 * that pass nothing -- the Documents tab, and the upload, replace and delete
 * paths below, which all return this to refresh the screen -- get precisely
 * what they got before.
 */
export const listDocuments = async (id, req, options = {}) => {
  const employee = await loadEmployee(id, req);

  const uploaderNames = await resolveUploaders(employee.documents);
  const documents = (employee.documents ?? []).map((document) => present(employee, document, uploaderNames));

  const limit = Number(options.limit);
  if (Number.isFinite(limit) && limit > 0) {
    return paginate(employee, documents, { page: Number(options.page) || 1, limit });
  }

  const sections = DOCUMENT_SECTIONS.map((section) => ({
    ...section,
    folder: folderFor(section.type),
    documents: documents.filter((document) => document.documentType === section.type),
  }));

  // Anything typed outside the nine sections -- a legacy record, or a type the
  // tab does not offer -- is surfaced under Other rather than hidden.
  const unsectioned = documents.filter((document) => !SECTION_TYPES.includes(document.documentType));
  if (unsectioned.length) {
    const other = sections.find((section) => section.type === DOCUMENT_TYPES.OTHER);
    other.documents = [...other.documents, ...unsectioned];
  }

  return {
    employeeId: employee.employeeCode,
    employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
    total: documents.length,
    sections,
  };
};

/**
 * Opens a stored file for download or inline preview.
 *
 * Returns a stream rather than a URL. The alternative -- serving the
 * attachments directory statically -- would make every identity document
 * readable by anyone who learned its path, with no session, no tenant check
 * and no audit entry.
 */
export const openDocument = async (id, documentId, req) => {
  const employee = await loadEmployee(id, req);

  const document = (employee.documents ?? []).find((entry) => String(entry._id) === String(documentId));
  if (!document) throw ApiError.notFound('Document not found');

  const absolute = resolveStoredPath(document.filePath);

  if (!fs.existsSync(absolute)) {
    // The record outlived its file. Reported plainly rather than as a 500:
    // the caller can act on "the file is missing", not on a stack trace.
    throw ApiError.notFound('The stored file is missing from the attachments folder');
  }

  return {
    stream: fs.createReadStream(absolute),
    fileName: document.title || document.fileName,
    mimeType: document.mimeType,
    size: document.size,
  };
};

/* -------------------------------------------------------------------------- */
/*                                   Write                                    */
/* -------------------------------------------------------------------------- */

/**
 * Records files the middleware has already written.
 *
 * Single-file sections replace rather than accumulate: an employee has one
 * photograph and one PAN card, and letting them stack would leave the tab
 * showing three PAN cards with no way to tell which is current. The previous
 * file is deleted from disk in the same step, so the folder matches the
 * database.
 */
export const attachDocuments = async (id, files, req) => {
  if (!files?.length) throw ApiError.badRequest('No file was uploaded');

  const employee = await loadEmployee(id, req);
  const documentType = req.documentType;

  const section = DOCUMENT_SECTIONS.find((entry) => entry.type === documentType);
  const replacesExisting = section && !section.multiple;

  const superseded = replacesExisting
    ? (employee.documents ?? []).filter((document) => document.type === documentType)
    : [];

  const added = files.map((file) => ({
    type: documentType,
    title: file.originalname,
    fileName: file.filename,
    filePath: relativePath(file.path),
    mimeType: file.mimetype,
    size: file.size,
    uploadedBy: req.user.id,
    uploadedAt: new Date(),
  }));

  const update = {
    $push: { documents: { $each: added } },
    $set: { updatedBy: req.user.id },
  };

  if (superseded.length) {
    // Mongo refuses $push and $pull on the same field in one update, so the
    // removal runs first and the insert second.
    await employeeRepository.updateById(id, {
      $pull: { documents: { _id: { $in: superseded.map((document) => document._id) } } },
    });

    await Promise.all(superseded.map((document) => removeStoredFile(document.filePath)));
  }

  await employeeRepository.updateById(id, update);

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: employee._id,
    entityLabel: `${employee.employeeCode} - ${employee.firstName} ${employee.lastName}`.trim(),
    action: AUDIT_ACTIONS.UPLOAD,
    changes: added.map((document) => ({
      field: `documents.${folderFor(documentType)}`,
      from: null,
      to: document.title,
    })),
    metadata: {
      documentType,
      folder: folderFor(documentType),
      count: added.length,
      replaced: superseded.length,
      bytes: added.reduce((total, document) => total + document.size, 0),
    },
  });

  return listDocuments(id, req);
};

/**
 * Replaces one document in place.
 *
 * Used by the multi-file sections, where "replace this particular certificate"
 * is not the same as "upload another one". The new file is already on disk;
 * this removes the old record and its file.
 */
export const replaceDocument = async (id, documentId, files, req) => {
  const employee = await loadEmployee(id, req);

  const existing = (employee.documents ?? []).find((entry) => String(entry._id) === String(documentId));
  if (!existing) throw ApiError.notFound('Document not found');

  if (!files?.length) throw ApiError.badRequest('No replacement file was uploaded');

  await employeeRepository.updateById(id, { $pull: { documents: { _id: existing._id } } });
  await removeStoredFile(existing.filePath);

  const file = files[0];
  const replacement = {
    type: existing.type,
    title: file.originalname,
    fileName: file.filename,
    filePath: relativePath(file.path),
    mimeType: file.mimetype,
    size: file.size,
    uploadedBy: req.user.id,
    uploadedAt: new Date(),
  };

  await employeeRepository.updateById(id, {
    $push: { documents: replacement },
    $set: { updatedBy: req.user.id },
  });

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: employee._id,
    entityLabel: `${employee.employeeCode} - ${employee.firstName} ${employee.lastName}`.trim(),
    action: AUDIT_ACTIONS.UPDATE,
    changes: [{ field: `documents.${folderFor(existing.type)}`, from: existing.title, to: replacement.title }],
    metadata: { documentType: existing.type, replacedDocumentId: String(documentId) },
  });

  return listDocuments(id, req);
};

/**
 * Deletes a document and its file.
 *
 * The file goes with the record. The previous implementation pulled the
 * subdocument and left the bytes on disk, which quietly filled the upload
 * directory with files nothing referenced and nothing would ever clean up.
 */
export const deleteDocument = async (id, documentId, req) => {
  const employee = await loadEmployee(id, req);

  const document = (employee.documents ?? []).find((entry) => String(entry._id) === String(documentId));
  if (!document) throw ApiError.notFound('Document not found');

  await employeeRepository.updateById(id, {
    $pull: { documents: { _id: document._id } },
    $set: { updatedBy: req.user.id },
  });

  const fileRemoved = await removeStoredFile(document.filePath);

  await recordAudit({
    req,
    entity: ENTITY,
    entityId: employee._id,
    entityLabel: `${employee.employeeCode} - ${employee.firstName} ${employee.lastName}`.trim(),
    action: AUDIT_ACTIONS.DELETE,
    changes: [{ field: `documents.${folderFor(document.type)}`, from: document.title, to: null }],
    metadata: {
      documentType: document.type,
      path: document.filePath,
      fileRemoved,
    },
  });

  return listDocuments(id, req);
};

/** Creates the folder tree for an employee that predates this feature. */
export const ensureFolders = async (id, req) => {
  const employee = await loadEmployee(id, req);
  await createEmployeeFolders(employee.employeeCode);
  return { employeeId: employee.employeeCode };
};

export default {
  DOCUMENT_SECTIONS,
  listDocuments,
  openDocument,
  attachDocuments,
  replaceDocument,
  deleteDocument,
  ensureFolders,
};
