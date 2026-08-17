import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import documentService from '../../services/employee/employeeDocument.service.js';

/**
 * Employee documents.
 *
 * Thin by design: the upload middleware has already written the files and the
 * service owns every rule about them. What is left here is the HTTP shape --
 * and, for downloads, the headers that decide whether a browser previews a
 * file or saves it.
 */

export const sections = asyncHandler(async (_req, res) =>
  ApiResponse.ok(res, documentService.DOCUMENT_SECTIONS, 'Document sections'),
);

/**
 * `page` and `limit` are optional. Without them the response is the grouped
 * shape the Documents tab reads; with them it is one page of a flat list. The
 * pagination travels inside the payload rather than in the envelope's `meta`,
 * because the same payload also carries the whole-set counts the screen's
 * summary needs.
 */
export const list = asyncHandler(async (req, res) =>
  ApiResponse.ok(
    res,
    await documentService.listDocuments(req.params.id, req, req.validatedQuery ?? {}),
    'Employee documents',
  ),
);

export const upload = asyncHandler(async (req, res) => {
  const files = req.files ?? (req.file ? [req.file] : []);
  const result = await documentService.attachDocuments(req.params.id, files, req);

  return ApiResponse.created(res, result, `${files.length} file(s) uploaded`);
});

export const replace = asyncHandler(async (req, res) => {
  const files = req.files ?? (req.file ? [req.file] : []);
  const result = await documentService.replaceDocument(req.params.id, req.params.documentId, files, req);

  return ApiResponse.ok(res, result, 'Document replaced');
});

export const remove = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await documentService.deleteDocument(req.params.id, req.params.documentId, req), 'Document deleted'),
);

/**
 * Streams one file.
 *
 * `?disposition=inline` is what the preview dialog asks for; the default is an
 * attachment, so a click on Download saves rather than navigates. The filename
 * is quoted and stripped of quotes because it comes from user input and lands
 * in a header.
 */
export const download = asyncHandler(async (req, res) => {
  const { stream, fileName, mimeType, size } = await documentService.openDocument(
    req.params.id,
    req.params.documentId,
    req,
  );

  const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
  const safeName = String(fileName).replace(/["\\]/g, '');

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', size);
  res.setHeader('Content-Disposition', `${disposition}; filename="${safeName}"`);
  // These files are identity documents; a shared cache must not keep a copy.
  res.setHeader('Cache-Control', 'private, no-store');

  stream.on('error', () => res.destroy());

  return stream.pipe(res);
});

export const ensureFolders = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await documentService.ensureFolders(req.params.id, req), 'Attachment folders ready'),
);

export default { sections, list, upload, replace, remove, download, ensureFolders };
