import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path) => `${ENDPOINTS.organization}${path}`;

const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length),
    ),
  );

/**
 * Client for backend/routes/organization/organization.routes.js.
 *
 * Two groups, matching the server:
 *
 * - The picker calls return active rows only with a narrow projection. Forms
 *   across the app populate their dropdowns from these.
 * - The `master*` calls are the management surface: paginated, searchable, and
 *   able to see retired rows, which a dropdown must never do.
 *
 * `master` is one of units | departments | designations | grades | shifts.
 */
const organizationService = {
  /* --------------------------------------------------------- pickers -- */

  /** One request for every picker a form needs. */
  masters: () => axiosClient.get(url('/masters')),
  departments: () => axiosClient.get(url('/departments')),
  designations: () => axiosClient.get(url('/designations')),
  shifts: () => axiosClient.get(url('/shifts')),
  units: () => axiosClient.get(url('/units')),
  grades: () => axiosClient.get(url('/grades')),
  salaryTemplates: () => axiosClient.get(url('/salary-templates')),
  reportingManagers: () => axiosClient.get(url('/reporting-managers')),

  /* ------------------------------------------------------ management -- */

  listMaster: (master, params) =>
    axiosClient.get(url(`/masters/${master}`), { params: clean(params) }),

  getMaster: (master, id) => axiosClient.get(url(`/masters/${master}/${id}`)),

  createMaster: (master, payload) => axiosClient.post(url(`/masters/${master}`), payload),

  updateMaster: (master, id, payload) => axiosClient.patch(url(`/masters/${master}/${id}`), payload),

  setMasterStatus: (master, id, isActive) =>
    axiosClient.patch(url(`/masters/${master}/${id}/status`), { isActive }),

  deleteMaster: (master, id) => axiosClient.delete(url(`/masters/${master}/${id}`)),

  masterAudit: (master, id, params) =>
    axiosClient.get(url(`/masters/${master}/${id}/audit`), { params: clean(params) }),

  /* -------------------------------------------------------- transfer -- */

  /**
   * Excel and PDF are produced by the server, so they carry its formatting and
   * re-check the caller's rights. Both export everything matching the current
   * filters, not just the page on screen.
   */
  exportMasterExcel: (master, params) =>
    axiosClient.get(url(`/masters/${master}/export`), { params: clean(params), responseType: 'blob' }),

  exportMasterPdf: (master, params) =>
    axiosClient.get(url(`/masters/${master}/export/pdf`), { params: clean(params), responseType: 'blob' }),

  masterTemplate: (master) =>
    axiosClient.get(url(`/masters/${master}/import/template`), { responseType: 'blob' }),

  importMaster: (master, file, dryRun = false) => {
    const form = new FormData();
    form.append('file', file);
    form.append('dryRun', String(dryRun));

    return axiosClient.post(url(`/masters/${master}/import`), form);
  },
};

export default organizationService;
