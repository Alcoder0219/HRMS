import asyncHandler from '../../utils/asyncHandler.js';
import ApiError from '../../utils/ApiError.js';
import ApiResponse from '../../utils/ApiResponse.js';
import recruitmentService from '../../services/recruitment/recruitment.service.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';
import { buildOfferLetterPdf } from '../../helpers/pdf.helper.js';

const query = (req) => req.validatedQuery ?? req.query ?? {};

const paginated = (res, result) =>
  ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });

/* ---------------------------------------------------------- job openings -- */

export const listJobs = asyncHandler(async (req, res) =>
  paginated(res, await recruitmentService.listJobs(query(req), req)),
);

export const getJob = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.getJob(req.params.id, req)),
);

export const createJob = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await recruitmentService.createJob(req.body, req), 'Job opening created'),
);

export const updateJob = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.updateJob(req.params.id, req.body, req), 'Job opening updated'),
);

export const deleteJob = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.deleteJob(req.params.id, req), 'Job opening deleted'),
);

/* ------------------------------------------------------------- candidates -- */

export const listCandidates = asyncHandler(async (req, res) =>
  paginated(res, await recruitmentService.listCandidates(query(req), req)),
);

export const getCandidate = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.getCandidate(req.params.id, req)),
);

export const createCandidate = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await recruitmentService.createCandidate(req.body, req), 'Candidate added'),
);

export const updateCandidate = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.updateCandidate(req.params.id, req.body, req), 'Candidate updated'),
);

export const moveStage = asyncHandler(async (req, res) => {
  const candidate = await recruitmentService.moveStage(req.params.id, req.body, req);
  return ApiResponse.ok(res, candidate, `Moved to ${candidate.stage.toLowerCase()}`);
});

export const uploadResume = asyncHandler(async (req, res) => {
  if (!req.file) throw ApiError.badRequest('No file was uploaded');

  const candidate = await recruitmentService.attachResume(req.params.id, req.file, req);
  return ApiResponse.ok(res, candidate, 'Resume uploaded');
});

/* ------------------------------------------------------------- interviews -- */

export const listInterviews = asyncHandler(async (req, res) =>
  paginated(res, await recruitmentService.listInterviews(query(req), req)),
);

export const scheduleInterview = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await recruitmentService.scheduleInterview(req.body, req), 'Interview scheduled'),
);

export const updateInterview = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.updateInterview(req.params.id, req.body, req), 'Interview updated'),
);

export const submitFeedback = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.submitFeedback(req.params.id, req.body, req), 'Feedback recorded'),
);

/* ----------------------------------------------------------------- offers -- */

export const listOffers = asyncHandler(async (req, res) =>
  paginated(res, await recruitmentService.listOffers(query(req), req)),
);

export const getOffer = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.getOffer(req.params.id, req)),
);

export const createOffer = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await recruitmentService.createOffer(req.body, req), 'Offer created'),
);

export const setOfferStatus = asyncHandler(async (req, res) => {
  const offer = await recruitmentService.setOfferStatus(req.params.id, req.body, req);
  return ApiResponse.ok(res, offer, `Offer ${offer.status.toLowerCase()}`);
});

/** Streams the offer letter as a PDF. */
export const offerLetter = asyncHandler(async (req, res) => {
  const offer = await recruitmentService.getOffer(req.params.id, req);
  const settings = await payrollRepository.findSettings(req.user.tenantId ?? null);

  const buffer = await buildOfferLetterPdf({
    offer: {
      ...offer,
      // Flattened so the PDF builder stays free of populate shapes.
      designationName: offer.designationId?.name ?? null,
      departmentName: offer.departmentId?.name ?? null,
      unitName: offer.unitId?.name ?? null,
    },
    candidate: offer.candidateId ?? {},
    company: { name: settings?.bank?.companyName ?? 'HRMS' },
  });

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="offer-${offer.offerNumber}.pdf"`);

  return res.status(200).send(buffer);
});

/* ------------------------------------------------------ joining/conversion -- */

export const convert = asyncHandler(async (req, res) => {
  const result = await recruitmentService.convertToEmployee(req.params.id, req.body, req);

  return ApiResponse.created(
    res,
    result,
    `${result.employee.employeeCode} created from offer ${result.offer.offerNumber}`,
  );
});

/* ---------------------------------------------------------------- reports -- */

export const report = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await recruitmentService.hiringReport(query(req), req), 'Hiring report'),
);

export default {
  listJobs,
  getJob,
  createJob,
  updateJob,
  deleteJob,
  listCandidates,
  getCandidate,
  createCandidate,
  updateCandidate,
  moveStage,
  uploadResume,
  listInterviews,
  scheduleInterview,
  updateInterview,
  submitFeedback,
  listOffers,
  getOffer,
  createOffer,
  setOfferStatus,
  offerLetter,
  convert,
  report,
};
