import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path = '') => `${ENDPOINTS.leaves}${path}`;

const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length),
    ),
  );

/**
 * Client for backend/routes/leave/leave.routes.js.
 *
 * Balances are never computed here. Entitlement, accrual, carry-forward and
 * encashment limits are all decided by the server -- a figure derived in the
 * browser would be a second opinion about how many days someone has left, and
 * the wrong one to act on.
 */
const leaveService = {
  /* ------------------------------------------------------------- types -- */
  listTypes: (params) => axiosClient.get(url('/types'), { params: clean(params) }),
  getType: (id) => axiosClient.get(url(`/types/${id}`)),
  createType: (payload) => axiosClient.post(url('/types'), payload),
  updateType: (id, payload) => axiosClient.patch(url(`/types/${id}`), payload),
  setTypeStatus: (id, isActive) => axiosClient.patch(url(`/types/${id}/status`), { isActive }),
  deleteType: (id) => axiosClient.delete(url(`/types/${id}`)),

  /* ---------------------------------------------------------- balances -- */

  /** Every active type's balance for one employee, materialised on read. */
  myBalances: (params) => axiosClient.get(url('/balances/me'), { params: clean(params) }),
  listBalances: (params) => axiosClient.get(url('/balances'), { params: clean(params) }),
  carryForward: (payload) => axiosClient.post(url('/balances/carry-forward'), payload),
  encash: (id, payload) => axiosClient.post(url(`/balances/${id}/encash`), payload),
  adjust: (id, payload) => axiosClient.patch(url(`/balances/${id}/adjust`), payload),

  /* ---------------------------------------------------------- requests -- */

  /**
   * Dry run. Returns the day breakdown, the balance it would draw on, and
   * every problem at once -- so a form is corrected in one pass rather than
   * one rejection at a time.
   */
  preview: (payload) => axiosClient.post(url('/requests/preview'), payload),
  apply: (payload) => axiosClient.post(url('/requests'), payload),
  listRequests: (params) => axiosClient.get(url('/requests'), { params: clean(params) }),
  getRequest: (id) => axiosClient.get(url(`/requests/${id}`)),
  decide: (id, payload) => axiosClient.patch(url(`/requests/${id}/decision`), payload),
  cancel: (id, payload) => axiosClient.post(url(`/requests/${id}/cancel`), payload),
  pendingCount: () => axiosClient.get(url('/requests/pending-count')),

  /* ---------------------------------------------------------- calendar -- */
  calendar: (params) => axiosClient.get(url('/calendar'), { params: clean(params) }),

  /* ----------------------------------------------------------- reports -- */
  report: (params) => axiosClient.get(url('/reports/balances'), { params: clean(params) }),
  exportReport: (params) =>
    axiosClient.get(url('/reports/balances/export'), { params: clean(params), responseType: 'blob' }),
  exportReportPdf: (params) =>
    axiosClient.get(url('/reports/balances/export/pdf'), { params: clean(params), responseType: 'blob' }),
};

export default leaveService;
