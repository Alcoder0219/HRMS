import axiosClient from '@services/api/axiosClient.js';
import { ENDPOINTS } from '@services/api/endpoints.js';

const url = (path = '') => `${ENDPOINTS.recruitment}${path}`;

const clean = (params = {}) =>
  Object.fromEntries(
    Object.entries(params).filter(
      ([, value]) =>
        value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && !value.length),
    ),
  );

/**
 * Client for backend/routes/recruitment/recruitment.routes.js.
 *
 * The module ends at `convert`, which is where a candidate becomes an employee.
 * That call goes through the employee service on the server, so a new joiner is
 * subject to every rule an employee created any other way would be.
 */
const recruitmentService = {
  /* -------------------------------------------------------- job openings -- */
  listJobs: (params) => axiosClient.get(url('/jobs'), { params: clean(params) }),
  getJob: (id) => axiosClient.get(url(`/jobs/${id}`)),
  createJob: (payload) => axiosClient.post(url('/jobs'), payload),
  updateJob: (id, payload) => axiosClient.patch(url(`/jobs/${id}`), payload),
  deleteJob: (id) => axiosClient.delete(url(`/jobs/${id}`)),

  /* ---------------------------------------------------------- candidates -- */
  listCandidates: (params) => axiosClient.get(url('/candidates'), { params: clean(params) }),
  getCandidate: (id) => axiosClient.get(url(`/candidates/${id}`)),
  createCandidate: (payload) => axiosClient.post(url('/candidates'), payload),
  updateCandidate: (id, payload) => axiosClient.patch(url(`/candidates/${id}`), payload),
  moveStage: (id, payload) => axiosClient.patch(url(`/candidates/${id}/stage`), payload),

  uploadResume: (id, file) => {
    const form = new FormData();
    form.append('resume', file);
    return axiosClient.post(url(`/candidates/${id}/resume`), form);
  },

  /* ---------------------------------------------------------- interviews -- */
  listInterviews: (params) => axiosClient.get(url('/interviews'), { params: clean(params) }),
  scheduleInterview: (payload) => axiosClient.post(url('/interviews'), payload),
  updateInterview: (id, payload) => axiosClient.patch(url(`/interviews/${id}`), payload),
  submitFeedback: (id, payload) => axiosClient.post(url(`/interviews/${id}/feedback`), payload),

  /* -------------------------------------------------------------- offers -- */
  listOffers: (params) => axiosClient.get(url('/offers'), { params: clean(params) }),
  getOffer: (id) => axiosClient.get(url(`/offers/${id}`)),
  createOffer: (payload) => axiosClient.post(url('/offers'), payload),
  setOfferStatus: (id, payload) => axiosClient.patch(url(`/offers/${id}/status`), payload),
  offerLetter: (id) => axiosClient.get(url(`/offers/${id}/letter`), { responseType: 'blob' }),

  /** Turns an accepted offer into an employee. */
  convert: (id, payload = {}) => axiosClient.post(url(`/offers/${id}/convert`), payload),

  /* ------------------------------------------------------------- reports -- */
  hiringReport: (params) => axiosClient.get(url('/reports/hiring'), { params: clean(params) }),
};

export default recruitmentService;
