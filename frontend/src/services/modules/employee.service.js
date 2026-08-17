import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path = '') => `${ENDPOINTS.employees}${path}`;

/**
 * Strips empty filters before they reach the query string, so the URL reflects
 * what is actually being filtered and the backend is not handed a pile of
 * blanks to ignore.
 */
const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length),
    ),
  );

const employeeService = {
  list: (params) => axiosClient.get(url(), { params: clean(params) }),

  summary: () => axiosClient.get(url('/summary')),

  getOne: (id) => axiosClient.get(url(`/${id}`)),

  create: (payload) => axiosClient.post(url(), payload),

  update: (id, payload) => axiosClient.patch(url(`/${id}`), payload),

  changeStatus: (id, payload) => axiosClient.patch(url(`/${id}/status`), payload),

  /**
   * `purgeAttachments` also deletes the employee's folder under `attachments/`.
   *
   * Off by default: the delete itself is reversible, and restoring an employee
   * whose files were destroyed returns a record with nothing attached to it.
   */
  remove: (id, reason, purgeAttachments = false) =>
    axiosClient.delete(url(`/${id}`), { data: { reason, purgeAttachments } }),

  restore: (id) => axiosClient.post(url(`/${id}/restore`)),

  auditTrail: (id, params) => axiosClient.get(url(`/${id}/audit`), { params }),

  /**
   * Transfer and promotion history.
   *
   * Read-only views over the audit trail rather than their own collections: a
   * transfer IS the change to the employee's unit, department, designation or
   * reporting line, and that change is already recorded. Executing one is an
   * ordinary `update()` call.
   */
  movements: (id, params) => axiosClient.get(url(`/${id}/movements`), { params: clean(params) }),

  allMovements: (params) => axiosClient.get(url('/movements'), { params: clean(params) }),

  uploadPhoto: (id, file) => {
    const form = new FormData();
    form.append('photo', file);
    return axiosClient.post(url(`/${id}/photo`), form);
  },

  uploadDocuments: (id, files, type) => {
    const form = new FormData();
    files.forEach((file) => form.append('documents', file));
    if (type) form.append('type', type);
    return axiosClient.post(url(`/${id}/documents`), form);
  },

  deleteDocument: (id, documentId) => axiosClient.delete(url(`/${id}/documents/${documentId}`)),

  /* ------------------------------------------------------- attachments -- */

  /**
   * The Documents tab.
   *
   * Files live under `attachments/<employeeCode>/<Section>/` on the server and
   * are never served statically, so every read goes through an authenticated
   * endpoint rather than a public URL.
   */
  documentSections: () => axiosClient.get(url('/attachments/sections')),

  /**
   * `params` is optional. `{ page, limit }` asks for one page of a flat list;
   * omitting it returns every document grouped by section, which is what the
   * Documents tab reads.
   */
  listAttachments: (id, params) => axiosClient.get(url(`/${id}/attachments`), { params: clean(params) }),

  /**
   * `onProgress` receives 0-100 so the upload card can show a real bar rather
   * than an indeterminate spinner.
   */
  uploadAttachments: (id, type, files, onProgress) => {
    const form = new FormData();
    files.forEach((file) => form.append('files', file));

    return axiosClient.post(url(`/${id}/attachments/${type}`), form, {
      onUploadProgress: (event) => {
        if (!onProgress || !event.total) return;
        onProgress(Math.round((event.loaded / event.total) * 100));
      },
    });
  },

  replaceAttachment: (id, documentId, type, file, onProgress) => {
    const form = new FormData();
    form.append('file', file);

    return axiosClient.put(url(`/${id}/attachments/${documentId}/replace/${type}`), form, {
      onUploadProgress: (event) => {
        if (!onProgress || !event.total) return;
        onProgress(Math.round((event.loaded / event.total) * 100));
      },
    });
  },

  deleteAttachment: (id, documentId) => axiosClient.delete(url(`/${id}/attachments/${documentId}`)),

  /** Blob rather than a URL, because the endpoint requires the auth header. */
  downloadAttachment: (id, documentId, disposition = 'attachment') =>
    axiosClient.get(url(`/${id}/attachments/${documentId}/file`), {
      params: { disposition },
      responseType: 'blob',
    }),

  /**
   * Excel responses bypass the client's JSON unwrapping: `responseType: blob`
   * makes axios hand back the raw file, and the interceptor's `response.data`
   * unwrap is exactly what we want here.
   */
  exportExcel: (params) =>
    axiosClient.get(url('/export'), { params: clean(params), responseType: 'blob' }),

  downloadTemplate: () => axiosClient.get(url('/import/template'), { responseType: 'blob' }),

  importExcel: (file, dryRun = false) => {
    const form = new FormData();
    form.append('file', file);
    form.append('dryRun', String(dryRun));
    return axiosClient.post(url('/import'), form);
  },
};

/** Triggers a browser download from a Blob without leaking the object URL. */
export const downloadBlob = (blob, filename) => {
  const href = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(href);
};

export default employeeService;
