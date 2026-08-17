import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path = '') => `${ENDPOINTS.reports}${path}`;

const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length),
    ),
  );

/**
 * Client for backend/routes/report/report.routes.js.
 *
 * Four methods cover eight reports because the server describes each one --
 * its filters, its columns, its cards and its charts -- rather than exposing a
 * bespoke endpoint per domain. Adding a ninth report is a server-side change
 * that this file does not need to know about.
 */
const reportService = {
  /** Which reports exist, and what each one can be filtered and shown by. */
  catalog: () => axiosClient.get(url('/catalog')),

  run: (slug, params) => axiosClient.get(url(`/${slug}`), { params: clean(params) }),

  exportExcel: (slug, params) =>
    axiosClient.get(url(`/${slug}/export/excel`), { params: clean(params), responseType: 'blob' }),

  exportPdf: (slug, params) =>
    axiosClient.get(url(`/${slug}/export/pdf`), { params: clean(params), responseType: 'blob' }),
};

export default reportService;
