import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path = '') => `${ENDPOINTS.attendance}${path}`;

const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length),
    ),
  );

const attendanceService = {
  /* ------------------------------------------------------ self service -- */
  myToday: () => axiosClient.get(url('/me/today')),
  myCalendar: (params) => axiosClient.get(url('/me/calendar'), { params: clean(params) }),
  punch: (payload) => axiosClient.post(url('/punch'), payload),
  compOff: (employeeId) => axiosClient.get(url('/comp-off'), { params: clean({ employeeId }) }),

  /* ---------------------------------------------------------- register -- */
  list: (params) => axiosClient.get(url(), { params: clean(params) }),
  dailySummary: (date) => axiosClient.get(url('/summary'), { params: clean({ date }) }),
  markManual: (payload) => axiosClient.post(url('/manual'), payload),
  lockPeriod: (payload) => axiosClient.post(url('/lock'), payload),

  /* ------------------------------------------------------------ ingest -- */
  biometric: (payload) => axiosClient.post(url('/biometric'), payload),
  downloadTemplate: () => axiosClient.get(url('/import/template'), { responseType: 'blob' }),
  importFile: (file, dryRun = false) => {
    const form = new FormData();
    form.append('file', file);
    form.append('dryRun', String(dryRun));
    return axiosClient.post(url('/import'), form);
  },

  /* ------------------------------------------------- monthly sheets ---- */

  /**
   * One call serves preview and commit.
   *
   * The file is uploaded again on commit so the server re-validates it rather
   * than trusting a payload echoed back from the preview.
   */
  importSheet: ({ file, year, month, duplicateStrategy = 'REPLACE', commit = false, onProgress }) => {
    const form = new FormData();
    form.append('file', file);
    form.append('year', String(year));
    form.append('month', String(month));
    form.append('duplicateStrategy', duplicateStrategy);
    form.append('commit', String(commit));

    return axiosClient.post(url('/import/sheet'), form, {
      // A 10,000-row workbook takes real time to upload; without a progress
      // handler the screen has nothing to show but a spinner.
      onUploadProgress: onProgress
        ? (event) => onProgress(event.total ? Math.round((event.loaded * 100) / event.total) : 0)
        : undefined,
      timeout: 300_000,
    });
  },

  sheetTemplate: (params) =>
    axiosClient.get(url('/import/sheet/template'), { params: clean(params), responseType: 'blob' }),

  sheets: (params) => axiosClient.get(url('/sheets'), { params: clean(params) }),
  employeeMonth: (params) => axiosClient.get(url('/month'), { params: clean(params) }),
  updateSheet: (id, payload) => axiosClient.put(url(`/sheets/${id}`), payload),
  deleteSheet: (id) => axiosClient.delete(url(`/sheets/${id}`)),

  /* ----------------------------------------------------------- reports -- */

  dayReport: (params) => axiosClient.get(url('/reports/days'), { params: clean(params) }),
  exportDayReport: (params) =>
    axiosClient.get(url('/reports/days/export'), { params: clean(params), responseType: 'blob' }),
  groupedReport: (params) => axiosClient.get(url('/reports/grouped'), { params: clean(params) }),
  exportSummaryPdf: (params) =>
    axiosClient.get(url('/reports/summary/pdf'), { params: clean(params), responseType: 'blob' }),
  monthlyRegister: (params) => axiosClient.get(url('/reports/monthly'), { params: clean(params) }),
  monthlySummary: (params) => axiosClient.get(url('/reports/summary'), { params: clean(params) }),
  // A year of overtime totals in one request, for the dashboard's trend chart.
  overtimeTrend: (params) => axiosClient.get(url('/reports/overtime-trend'), { params: clean(params) }),
  exceptions: (params) => axiosClient.get(url('/reports/exceptions'), { params: clean(params) }),
  exportMonthly: (params) =>
    axiosClient.get(url('/reports/export'), { params: clean(params), responseType: 'blob' }),

  /* --------------------------------------------------- regularizations -- */
  regularizations: (params) => axiosClient.get(url('/regularizations'), { params: clean(params) }),
  pendingCount: () => axiosClient.get(url('/regularizations/pending-count')),
  requestRegularization: (payload) => axiosClient.post(url('/regularizations'), payload),
  decideRegularization: (id, payload) =>
    axiosClient.patch(url(`/regularizations/${id}/decision`), payload),
  cancelRegularization: (id) => axiosClient.post(url(`/regularizations/${id}/cancel`)),

  /* ---------------------------------------------------------- calendar -- */
  /**
   * `status` is omitted by every caller except the management screen, and the
   * server then returns active rows only -- which is what the grader and the
   * dashboard have always received.
   */
  holidays: (year, status) => axiosClient.get(url('/holidays'), { params: clean({ year, status }) }),
  createHoliday: (payload) => axiosClient.post(url('/holidays'), payload),
  updateHoliday: (id, payload) => axiosClient.patch(url(`/holidays/${id}`), payload),
  setHolidayStatus: (id, isActive) => axiosClient.patch(url(`/holidays/${id}/status`), { isActive }),
  holidayAudit: (id, params) => axiosClient.get(url(`/holidays/${id}/audit`), { params: clean(params) }),
  deleteHoliday: (id) => axiosClient.delete(url(`/holidays/${id}`)),

  policy: () => axiosClient.get(url('/policy')),
  savePolicy: (payload) => axiosClient.put(url('/policy'), payload),
};

/**
 * Reads the browser's position for a geo punch.
 *
 * Resolves to `null` rather than rejecting when location is unavailable: the
 * server decides whether a punch without coordinates is acceptable, and
 * failing here would block someone whose organisation has no geofence at all.
 */
export const readPosition = (timeoutMs = 8000) =>
  new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) =>
        resolve({
          latitude: coords.latitude,
          longitude: coords.longitude,
          accuracy: Math.round(coords.accuracy ?? 0),
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });

export default attendanceService;
