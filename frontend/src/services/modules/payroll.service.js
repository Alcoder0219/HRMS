import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path = '') => `${ENDPOINTS.payroll}${path}`;

const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length),
    ),
  );

/**
 * Client for backend/routes/payroll/payroll.routes.js.
 *
 * One-for-one with the routes that already exist -- nothing here invents an
 * endpoint. The asset register lives under /payroll on the server too, which is
 * why it appears in this file rather than in the employee service.
 */
const payrollService = {
  /* ------------------------------------------------- salary structures -- */
  ctcPreview: (params) => axiosClient.get(url('/structures/preview'), { params: clean(params) }),
  createStructure: (payload) => axiosClient.post(url('/structures'), payload),
  currentStructure: (employeeId) => axiosClient.get(url(`/structures/${employeeId}`)),
  structureHistory: (employeeId) => axiosClient.get(url(`/structures/${employeeId}/history`)),

  /* -------------------------------------------------------- payroll runs -- */
  listRuns: (params) => axiosClient.get(url('/runs'), { params: clean(params) }),
  getRun: (id) => axiosClient.get(url(`/runs/${id}`)),
  processRun: (payload) => axiosClient.post(url('/runs/process'), payload),
  submitRun: (id) => axiosClient.post(url(`/runs/${id}/submit`)),
  approveRun: (id) => axiosClient.post(url(`/runs/${id}/approve`)),
  markRunPaid: (id, payload) => axiosClient.post(url(`/runs/${id}/paid`), payload),
  cancelRun: (id, payload) => axiosClient.post(url(`/runs/${id}/cancel`), payload),

  salaryRegister: (id) => axiosClient.get(url(`/runs/${id}/register`)),
  exportRegister: (id) => axiosClient.get(url(`/runs/${id}/register/export`), { responseType: 'blob' }),
  bankFile: (id, params) =>
    axiosClient.get(url(`/runs/${id}/bank-file`), { params: clean(params), responseType: 'blob' }),

  /* ------------------------------------------------------------ payslips -- */
  listPayslips: (params) => axiosClient.get(url('/payslips'), { params: clean(params) }),
  getPayslip: (id) => axiosClient.get(url(`/payslips/${id}`)),
  payslipPdf: (id) => axiosClient.get(url(`/payslips/${id}/pdf`), { responseType: 'blob' }),
  holdPayslip: (id, payload) => axiosClient.patch(url(`/payslips/${id}/hold`), payload),

  /* --------------------------------------------------------------- loans -- */
  listLoans: (params) => axiosClient.get(url('/loans'), { params: clean(params) }),
  getLoan: (id) => axiosClient.get(url(`/loans/${id}`)),
  createLoan: (payload) => axiosClient.post(url('/loans'), payload),
  decideLoan: (id, payload) => axiosClient.patch(url(`/loans/${id}/decision`), payload),
  disburseLoan: (id, payload) => axiosClient.post(url(`/loans/${id}/disburse`), payload),
  holdLoan: (id, payload) => axiosClient.patch(url(`/loans/${id}/hold`), payload),
  recordRepayment: (id, payload) => axiosClient.post(url(`/loans/${id}/repayment`), payload),

  /* ------------------------------------------------------------- reports -- */
  statutoryReport: (params) => axiosClient.get(url('/reports/statutory'), { params: clean(params) }),
  costByDepartment: (params) => axiosClient.get(url('/reports/cost-by-department'), { params: clean(params) }),
  yearlyTrend: (params) => axiosClient.get(url('/reports/trend'), { params: clean(params) }),

  /* --------------------------------------------------------- settlements -- */
  settlementDashboard: () => axiosClient.get(url('/settlements/dashboard')),
  listSettlements: (params) => axiosClient.get(url('/settlements'), { params: clean(params) }),
  getSettlement: (id) => axiosClient.get(url(`/settlements/${id}`)),
  createSettlement: (payload) => axiosClient.post(url('/settlements'), payload),
  settlementPdf: (id) => axiosClient.get(url(`/settlements/${id}/pdf`), { responseType: 'blob' }),
  recalculateSettlement: (id, payload) => axiosClient.patch(url(`/settlements/${id}/recalculate`), payload),
  submitSettlement: (id) => axiosClient.post(url(`/settlements/${id}/submit`)),
  hrDecision: (id, payload) => axiosClient.patch(url(`/settlements/${id}/hr-decision`), payload),
  financeDecision: (id, payload) => axiosClient.patch(url(`/settlements/${id}/finance-decision`), payload),
  markSettlementPaid: (id, payload) => axiosClient.post(url(`/settlements/${id}/paid`), payload),
  holdSettlement: (id, payload) => axiosClient.post(url(`/settlements/${id}/hold`), payload),
  releaseSettlement: (id, payload) => axiosClient.post(url(`/settlements/${id}/release`), payload),
  cancelSettlement: (id, payload) => axiosClient.post(url(`/settlements/${id}/cancel`), payload),

  /* -------------------------------------------------------------- assets -- */
  listAssets: (params) => axiosClient.get(url('/assets'), { params: clean(params) }),
  getAsset: (id) => axiosClient.get(url(`/assets/${id}`)),
  createAsset: (payload) => axiosClient.post(url('/assets'), payload),
  assignAsset: (id, payload) => axiosClient.post(url(`/assets/${id}/assign`), payload),
  returnAsset: (id, payload) => axiosClient.post(url(`/assets/${id}/return`), payload),
  markAssetLost: (id, payload) => axiosClient.post(url(`/assets/${id}/lost`), payload),
  downloadAssetTemplate: () => axiosClient.get(url('/assets/import/template'), { responseType: 'blob' }),
  importAssets: (file, dryRun = false) => {
    const form = new FormData();
    form.append('file', file);
    form.append('dryRun', String(dryRun));
    return axiosClient.post(url('/assets/import'), form);
  },

  /* ------------------------------------------------------------ settings -- */
  settings: () => axiosClient.get(url('/settings')),
  saveSettings: (payload) => axiosClient.put(url('/settings'), payload),
};

export default payrollService;
