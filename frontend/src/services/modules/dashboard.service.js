import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path) => `${ENDPOINTS.dashboard}${path}`;

const clean = (params = {}) =>
  Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''));

/**
 * Client for backend/routes/dashboard/dashboard.routes.js.
 *
 * One read per section, all taking the same filters -- `{ year, month,
 * unitId, departmentId }` -- so the dashboard's filters mean the same thing
 * in every panel. Each section is scoped and permission-checked by the server.
 */
const dashboardService = {
  employees: (params) => axiosClient.get(url('/employees'), { params: clean(params) }),
  today: (params) => axiosClient.get(url('/today'), { params: clean(params) }),
  attendance: (params) => axiosClient.get(url('/attendance'), { params: clean(params) }),
  leave: (params) => axiosClient.get(url('/leave'), { params: clean(params) }),
  payroll: (params) => axiosClient.get(url('/payroll'), { params: clean(params) }),
};

export default dashboardService;
