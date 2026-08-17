import JobOpening from '../../models/recruitment/jobOpening.model.js';
import Candidate from '../../models/recruitment/candidate.model.js';
import Interview from '../../models/recruitment/interview.model.js';
import Offer from '../../models/recruitment/offer.model.js';
import Employee from '../../models/employee/employee.model.js';

import ApiError from '../../utils/ApiError.js';
import {
  AUDIT_ACTIONS,
  JOB_STATUS,
  CANDIDATE_STAGE,
  CANDIDATE_STAGE_ORDER,
  ACTIVE_CANDIDATE_STAGES,
  INTERVIEW_STATUS,
  OFFER_STATUS,
  OFFER_STATUS_TRANSITIONS,
  EMPLOYEE_STATUS,
} from '../../utils/constants.js';
import { buildPagination, buildSort, buildSearch } from '../../utils/queryBuilder.js';
import { recordAudit, diffObjects } from '../../helpers/audit.helper.js';
import employeeService from '../employee/employee.service.js';

/**
 * Recruitment: requisitions, candidates, interviews, offers and joining.
 *
 * The module ends where the Employee module begins. A candidate is not an
 * employee -- no code, no salary structure, no attendance -- and most never
 * become one. Conversion happens once, at joining, and goes through the
 * existing employee service rather than writing an Employee document directly,
 * so every rule that service enforces still applies to a new joiner.
 */

const tenantOf = (req) => req.user?.tenantId ?? null;

/* -------------------------------------------------------------------------- */
/*                                Job openings                                */
/* -------------------------------------------------------------------------- */

const JOB_SORTABLE = ['title', 'code', 'status', 'vacancies', 'openedAt', 'createdAt'];

const nextCode = async (prefix, Model, tenantId, field = 'code') => {
  const count = await Model.countDocuments({ tenantId });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
};

export const listJobs = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const filter = { tenantId: tenantOf(req) };

  if (query.status) filter.status = query.status;
  if (query.departmentId) filter.departmentId = query.departmentId;

  Object.assign(filter, buildSearch(query.search, ['title', 'code', 'location']));

  const sort = buildSort({ sortBy: query.sortBy, sortOrder: query.sortOrder }, JOB_SORTABLE, { createdAt: -1 });

  const [items, total] = await Promise.all([
    JobOpening.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'departmentId', select: 'name code' },
        { path: 'designationId', select: 'name code' },
        { path: 'unitId', select: 'name code' },
        { path: 'hiringManagerId', select: 'employeeCode employeeId firstName lastName' },
      ])
      .lean(),
    JobOpening.countDocuments(filter),
  ]);

  // Applicants per opening, so the list answers "is anyone actually applying".
  const counts = await Candidate.aggregate([
    { $match: { jobOpeningId: { $in: items.map((item) => item._id) } } },
    { $group: { _id: '$jobOpeningId', total: { $sum: 1 } } },
  ]);

  const byJob = new Map(counts.map((row) => [String(row._id), row.total]));

  return {
    items: items.map((item) => ({
      ...item,
      applicants: byJob.get(String(item._id)) ?? 0,
      // `remaining` is a virtual; lean rows carry none.
      remaining: Math.max(0, (item.vacancies ?? 0) - (item.filled ?? 0)),
    })),
    total,
    page,
    limit,
  };
};

export const getJob = async (id, req) => {
  const job = await JobOpening.findOne({ _id: id, tenantId: tenantOf(req) })
    .populate([
      { path: 'departmentId', select: 'name code' },
      { path: 'designationId', select: 'name code level' },
      { path: 'unitId', select: 'name code' },
      { path: 'gradeId', select: 'name code' },
      { path: 'hiringManagerId', select: 'employeeCode employeeId firstName lastName' },
    ])
    .lean();

  if (!job) throw ApiError.notFound('Job opening not found');

  const pipeline = await Candidate.aggregate([
    { $match: { jobOpeningId: job._id } },
    { $group: { _id: '$stage', count: { $sum: 1 } } },
  ]);

  return {
    ...job,
    // `remaining` is a virtual and `.lean()` drops it unless asked; recomputed
    // here so the shape is the same either way.
    remaining: Math.max(0, (job.vacancies ?? 0) - (job.filled ?? 0)),
    pipeline: Object.fromEntries(pipeline.map((row) => [row._id, row.count])),
  };
};

export const createJob = async (payload, req) => {
  const tenantId = tenantOf(req);

  const code = payload.code || (await nextCode('JOB', JobOpening, tenantId));

  const clash = await JobOpening.findOne({ tenantId, code }).select('title').lean();
  if (clash) throw ApiError.conflict(`Code "${code}" is already used by ${clash.title}`);

  const job = await JobOpening.create({
    ...payload,
    code,
    tenantId,
    // Opening a requisition on creation is the common case; a DRAFT stays shut.
    openedAt: payload.status === JOB_STATUS.OPEN ? new Date() : null,
    createdBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: 'JobOpening',
    entityId: job._id,
    entityLabel: `${job.code} — ${job.title}`,
    action: AUDIT_ACTIONS.CREATE,
    changes: diffObjects({}, job.toObject({ depopulate: true })),
  });

  return job.toObject();
};

export const updateJob = async (id, payload, req) => {
  const job = await JobOpening.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!job) throw ApiError.notFound('Job opening not found');

  const before = job.toObject({ depopulate: true });

  // Opening a requisition for the first time stamps when it opened.
  if (payload.status === JOB_STATUS.OPEN && job.status !== JOB_STATUS.OPEN && !job.openedAt) {
    payload.openedAt = new Date();
  }

  if ([JOB_STATUS.CLOSED, JOB_STATUS.FILLED].includes(payload.status) && !job.closedAt) {
    payload.closedAt = new Date();
  }

  Object.assign(job, payload, { updatedBy: req.user.id });
  await job.save();

  const changes = diffObjects(before, job.toObject({ depopulate: true }));

  if (changes.length) {
    await recordAudit({
      req,
      entity: 'JobOpening',
      entityId: job._id,
      entityLabel: `${job.code} — ${job.title}`,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return job.toObject();
};

/** Removes a requisition, but only when nobody has applied to it. */
export const deleteJob = async (id, req) => {
  const job = await JobOpening.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!job) throw ApiError.notFound('Job opening not found');

  const applicants = await Candidate.countDocuments({ jobOpeningId: id });

  if (applicants > 0) {
    throw ApiError.conflict(
      `${job.title} has ${applicants} applicant(s). Close the opening instead — deleting it would orphan them.`,
    );
  }

  await JobOpening.deleteOne({ _id: id });

  await recordAudit({
    req,
    entity: 'JobOpening',
    entityId: job._id,
    entityLabel: `${job.code} — ${job.title}`,
    action: AUDIT_ACTIONS.DELETE,
  });

  return { deleted: true, title: job.title };
};

/* -------------------------------------------------------------------------- */
/*                                 Candidates                                 */
/* -------------------------------------------------------------------------- */

const CANDIDATE_SORTABLE = ['firstName', 'lastName', 'stage', 'appliedAt', 'expectedCtc', 'createdAt'];

export const listCandidates = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const filter = { tenantId: tenantOf(req) };

  if (query.stage) filter.stage = query.stage;
  if (query.jobOpeningId) filter.jobOpeningId = query.jobOpeningId;
  if (query.source) filter.source = query.source;
  if (query.active) filter.stage = { $in: ACTIVE_CANDIDATE_STAGES };

  Object.assign(filter, buildSearch(query.search, ['firstName', 'lastName', 'email', 'currentEmployer']));

  const sort = buildSort(
    { sortBy: query.sortBy, sortOrder: query.sortOrder },
    CANDIDATE_SORTABLE,
    { appliedAt: -1 },
  );

  const [items, total] = await Promise.all([
    Candidate.find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate([{ path: 'jobOpeningId', select: 'code title departmentId' }])
      .lean(),
    Candidate.countDocuments(filter),
  ]);

  return {
    // `fullName` is a virtual, and lean rows carry none of them. Composed here
    // so the list and the detail response agree on the shape.
    items: items.map((item) => ({ ...item, fullName: `${item.firstName} ${item.lastName}`.trim() })),
    total,
    page,
    limit,
  };
};

export const getCandidate = async (id, req) => {
  const candidate = await Candidate.findOne({ _id: id, tenantId: tenantOf(req) })
    .populate([
      { path: 'jobOpeningId', select: 'code title departmentId designationId' },
      { path: 'convertedEmployeeId', select: 'employeeCode employeeId firstName lastName' },
    ])
    .lean();

  if (!candidate) throw ApiError.notFound('Candidate not found');

  const [interviews, offers] = await Promise.all([
    Interview.find({ candidateId: id }).sort({ round: 1 }).lean(),
    Offer.find({ candidateId: id }).sort({ createdAt: -1 }).lean(),
  ]);

  return {
    ...candidate,
    // Virtuals are dropped by `.lean()` in Mongoose 8, so the name is composed
    // rather than read -- the trap this codebase has hit before.
    fullName: `${candidate.firstName} ${candidate.lastName}`.trim(),
    interviews: interviews.map(withAverageRating),
    offers,
  };
};

export const createCandidate = async (payload, req) => {
  const tenantId = tenantOf(req);

  const job = await JobOpening.findOne({ _id: payload.jobOpeningId, tenantId }).lean();
  if (!job) throw ApiError.notFound('Job opening not found');

  if (job.status !== JOB_STATUS.OPEN) {
    throw ApiError.badRequest(`${job.title} is ${job.status.toLowerCase()} and is not accepting applications`);
  }

  const duplicate = await Candidate.findOne({
    tenantId,
    email: String(payload.email).toLowerCase(),
    jobOpeningId: payload.jobOpeningId,
  })
    .select('firstName lastName')
    .lean();

  if (duplicate) {
    throw ApiError.conflict(
      `${duplicate.firstName} ${duplicate.lastName} has already applied for this opening`,
    );
  }

  const candidate = await Candidate.create({
    ...payload,
    tenantId,
    stageHistory: [{ stage: CANDIDATE_STAGE.APPLIED, at: new Date(), by: req.user.id }],
    createdBy: req.user.id,
  });

  await recordAudit({
    req,
    entity: 'Candidate',
    entityId: candidate._id,
    entityLabel: `${candidate.firstName} ${candidate.lastName}`,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { jobOpening: job.title },
  });

  return candidate.toObject();
};

export const updateCandidate = async (id, payload, req) => {
  const candidate = await Candidate.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!candidate) throw ApiError.notFound('Candidate not found');

  const before = candidate.toObject({ depopulate: true });
  Object.assign(candidate, payload, { updatedBy: req.user.id });
  await candidate.save();

  const changes = diffObjects(before, candidate.toObject({ depopulate: true }));

  if (changes.length) {
    await recordAudit({
      req,
      entity: 'Candidate',
      entityId: candidate._id,
      entityLabel: `${candidate.firstName} ${candidate.lastName}`,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return candidate.toObject();
};

/**
 * Moves a candidate through the funnel.
 *
 * HIRED is not settable here: it is a consequence of joining, which the
 * conversion step owns. Allowing it to be set by hand would let a candidate be
 * marked hired without ever becoming an employee.
 */
export const moveStage = async (id, { stage, note }, req) => {
  const candidate = await Candidate.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!candidate) throw ApiError.notFound('Candidate not found');

  if (stage === CANDIDATE_STAGE.HIRED) {
    throw ApiError.badRequest('A candidate becomes hired by joining, not by a stage change');
  }

  if (candidate.stage === CANDIDATE_STAGE.HIRED) {
    throw ApiError.badRequest('This candidate has already been hired');
  }

  if (candidate.stage === stage) return candidate.toObject();

  const from = candidate.stage;

  candidate.stage = stage;
  if (stage === CANDIDATE_STAGE.REJECTED) candidate.rejectionReason = note ?? null;

  candidate.stageHistory.push({ stage, at: new Date(), by: req.user.id, note: note ?? null });
  candidate.updatedBy = req.user.id;

  await candidate.save();

  await recordAudit({
    req,
    entity: 'Candidate',
    entityId: candidate._id,
    entityLabel: `${candidate.firstName} ${candidate.lastName}`,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'stage', from, to: stage }],
    metadata: { note: note ?? null },
  });

  return candidate.toObject();
};

/** Attaches an uploaded resume. Stored the same way employee documents are. */
export const attachResume = async (id, file, req) => {
  const candidate = await Candidate.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!candidate) throw ApiError.notFound('Candidate not found');

  candidate.resume = {
    fileName: file.originalname,
    // Same subdirectory the employee documents use, so the static mount, the
    // preview and the download all behave identically.
    filePath: `/uploads/documents/${file.filename}`,
    mimeType: file.mimetype,
    size: file.size,
    uploadedAt: new Date(),
  };
  candidate.updatedBy = req.user.id;

  await candidate.save();

  await recordAudit({
    req,
    entity: 'Candidate',
    entityId: candidate._id,
    entityLabel: `${candidate.firstName} ${candidate.lastName}`,
    action: AUDIT_ACTIONS.UPLOAD,
    metadata: { fileName: file.originalname, size: file.size },
  });

  return candidate.toObject();
};

/* -------------------------------------------------------------------------- */
/*                                 Interviews                                 */
/* -------------------------------------------------------------------------- */

/**
 * Mean panel rating for a lean interview document.
 *
 * The model defines this as a virtual, but `.lean()` does NOT produce virtuals
 * in Mongoose 8 -- `{ virtuals: true }` needs the mongoose-lean-virtuals plugin,
 * which this project does not use. Reading `averageRating` off a lean row gives
 * `undefined`, so it is computed here instead.
 */
const withAverageRating = (interview) => {
  const scored = (interview.feedback ?? []).filter((entry) => typeof entry.rating === 'number');

  return {
    ...interview,
    averageRating: scored.length
      ? Number((scored.reduce((sum, entry) => sum + entry.rating, 0) / scored.length).toFixed(1))
      : null,
  };
};

export const listInterviews = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const filter = { tenantId: tenantOf(req) };

  if (query.status) filter.status = query.status;
  if (query.candidateId) filter.candidateId = query.candidateId;
  if (query.jobOpeningId) filter.jobOpeningId = query.jobOpeningId;

  if (query.from || query.to) {
    filter.scheduledAt = {};
    if (query.from) filter.scheduledAt.$gte = new Date(query.from);
    if (query.to) filter.scheduledAt.$lte = new Date(query.to);
  }

  const [items, total] = await Promise.all([
    Interview.find(filter)
      .sort({ scheduledAt: query.sortOrder === 'desc' ? -1 : 1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'candidateId', select: 'firstName lastName email stage' },
        { path: 'jobOpeningId', select: 'code title' },
        { path: 'interviewerIds', select: 'employeeCode employeeId firstName lastName' },
      ])
      .lean(),
    Interview.countDocuments(filter),
  ]);

  return { items: items.map(withAverageRating), total, page, limit };
};

export const scheduleInterview = async (payload, req) => {
  const tenantId = tenantOf(req);

  const candidate = await Candidate.findOne({ _id: payload.candidateId, tenantId });
  if (!candidate) throw ApiError.notFound('Candidate not found');

  if (!ACTIVE_CANDIDATE_STAGES.includes(candidate.stage)) {
    throw ApiError.badRequest(
      `${candidate.firstName} is ${candidate.stage.toLowerCase()} and cannot be interviewed`,
    );
  }

  // Rounds number themselves, so a panel does not have to track where it is.
  const existing = await Interview.countDocuments({ candidateId: payload.candidateId });

  const interview = await Interview.create({
    ...payload,
    tenantId,
    jobOpeningId: candidate.jobOpeningId,
    round: payload.round ?? existing + 1,
    createdBy: req.user.id,
  });

  // Scheduling the first interview moves the candidate along on its own; doing
  // it by hand as well is a step everyone forgets.
  if (candidate.stage !== CANDIDATE_STAGE.INTERVIEW) {
    candidate.stage = CANDIDATE_STAGE.INTERVIEW;
    candidate.stageHistory.push({
      stage: CANDIDATE_STAGE.INTERVIEW,
      at: new Date(),
      by: req.user.id,
      note: `Round ${interview.round} scheduled`,
    });
    await candidate.save();
  }

  await recordAudit({
    req,
    entity: 'Interview',
    entityId: interview._id,
    entityLabel: `${candidate.firstName} ${candidate.lastName} — round ${interview.round}`,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { scheduledAt: interview.scheduledAt },
  });

  return interview.toObject();
};

export const updateInterview = async (id, payload, req) => {
  const interview = await Interview.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!interview) throw ApiError.notFound('Interview not found');

  const before = interview.toObject({ depopulate: true });

  if (payload.status === INTERVIEW_STATUS.COMPLETED && !interview.completedAt) {
    payload.completedAt = new Date();
  }

  Object.assign(interview, payload, { updatedBy: req.user.id });
  await interview.save();

  const changes = diffObjects(before, interview.toObject({ depopulate: true }));

  if (changes.length) {
    await recordAudit({
      req,
      entity: 'Interview',
      entityId: interview._id,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return interview.toObject();
};

/** Records one interviewer's verdict and closes the round if asked. */
export const submitFeedback = async (id, payload, req) => {
  const interview = await Interview.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!interview) throw ApiError.notFound('Interview not found');

  interview.feedback.push({ ...payload, submittedAt: new Date() });

  if (payload.closeRound) {
    interview.status = INTERVIEW_STATUS.COMPLETED;
    interview.completedAt = new Date();
    interview.outcome = payload.recommendation ?? interview.outcome;
  }

  interview.updatedBy = req.user.id;
  await interview.save();

  await recordAudit({
    req,
    entity: 'Interview',
    entityId: interview._id,
    action: AUDIT_ACTIONS.UPDATE,
    metadata: { rating: payload.rating ?? null, recommendation: payload.recommendation ?? null },
  });

  return interview.toObject();
};

/* -------------------------------------------------------------------------- */
/*                                   Offers                                   */
/* -------------------------------------------------------------------------- */

export const listOffers = async (query, req) => {
  const { page, limit, skip } = buildPagination(query);
  const filter = { tenantId: tenantOf(req) };

  if (query.status) filter.status = query.status;
  if (query.candidateId) filter.candidateId = query.candidateId;
  if (query.jobOpeningId) filter.jobOpeningId = query.jobOpeningId;

  const [items, total] = await Promise.all([
    Offer.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate([
        { path: 'candidateId', select: 'firstName lastName email phone' },
        { path: 'jobOpeningId', select: 'code title' },
        { path: 'designationId', select: 'name' },
        { path: 'departmentId', select: 'name' },
        { path: 'employeeId', select: 'employeeCode employeeId firstName lastName' },
      ])
      .lean(),
    Offer.countDocuments(filter),
  ]);

  return { items, total, page, limit };
};

export const getOffer = async (id, req) => {
  const offer = await Offer.findOne({ _id: id, tenantId: tenantOf(req) })
    .populate([
      { path: 'candidateId', select: 'firstName lastName email phone currentCtc expectedCtc noticePeriodDays' },
      { path: 'jobOpeningId', select: 'code title' },
      { path: 'designationId', select: 'name' },
      { path: 'departmentId', select: 'name' },
      { path: 'unitId', select: 'name' },
      { path: 'gradeId', select: 'name' },
      { path: 'employeeId', select: 'employeeCode employeeId firstName lastName' },
    ])
    .lean();

  if (!offer) throw ApiError.notFound('Offer not found');
  return offer;
};

export const createOffer = async (payload, req) => {
  const tenantId = tenantOf(req);

  const candidate = await Candidate.findOne({ _id: payload.candidateId, tenantId });
  if (!candidate) throw ApiError.notFound('Candidate not found');

  if (!ACTIVE_CANDIDATE_STAGES.includes(candidate.stage)) {
    throw ApiError.badRequest(`${candidate.firstName} is ${candidate.stage.toLowerCase()}`);
  }

  // A second live offer to the same candidate is a mistake, not a negotiation.
  const live = await Offer.findOne({
    candidateId: payload.candidateId,
    status: { $in: [OFFER_STATUS.DRAFT, OFFER_STATUS.SENT, OFFER_STATUS.ACCEPTED] },
  })
    .select('offerNumber status')
    .lean();

  if (live) {
    throw ApiError.conflict(`${live.offerNumber} is already ${live.status.toLowerCase()} for this candidate`);
  }

  const offer = await Offer.create({
    ...payload,
    tenantId,
    jobOpeningId: candidate.jobOpeningId,
    offerNumber: await nextCode('OFR', Offer, tenantId),
    createdBy: req.user.id,
  });

  if (candidate.stage !== CANDIDATE_STAGE.OFFER) {
    candidate.stage = CANDIDATE_STAGE.OFFER;
    candidate.stageHistory.push({
      stage: CANDIDATE_STAGE.OFFER,
      at: new Date(),
      by: req.user.id,
      note: offer.offerNumber,
    });
    await candidate.save();
  }

  await recordAudit({
    req,
    entity: 'Offer',
    entityId: offer._id,
    entityLabel: offer.offerNumber,
    action: AUDIT_ACTIONS.CREATE,
    metadata: { candidate: `${candidate.firstName} ${candidate.lastName}`, annualCtc: offer.annualCtc },
  });

  return offer.toObject();
};

const assertOfferTransition = (from, to) => {
  if (!OFFER_STATUS_TRANSITIONS[from]?.includes(to)) {
    throw ApiError.badRequest(`A ${from.toLowerCase()} offer cannot become ${to.toLowerCase()}`);
  }
};

export const setOfferStatus = async (id, { status, reason }, req) => {
  const offer = await Offer.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!offer) throw ApiError.notFound('Offer not found');

  assertOfferTransition(offer.status, status);

  const from = offer.status;
  offer.status = status;

  if (status === OFFER_STATUS.SENT) offer.sentAt = new Date();
  if ([OFFER_STATUS.ACCEPTED, OFFER_STATUS.DECLINED].includes(status)) offer.respondedAt = new Date();
  if (status === OFFER_STATUS.DECLINED) offer.declineReason = reason ?? null;
  if (status === OFFER_STATUS.WITHDRAWN) offer.withdrawReason = reason ?? null;

  offer.updatedBy = req.user.id;
  await offer.save();

  /**
   * A declined or withdrawn offer puts the candidate back out of the running.
   * Leaving them at OFFER would keep them in every "awaiting response" count
   * for ever.
   */
  if ([OFFER_STATUS.DECLINED, OFFER_STATUS.WITHDRAWN].includes(status)) {
    const candidate = await Candidate.findById(offer.candidateId);

    if (candidate && candidate.stage === CANDIDATE_STAGE.OFFER) {
      candidate.stage =
        status === OFFER_STATUS.DECLINED ? CANDIDATE_STAGE.WITHDRAWN : CANDIDATE_STAGE.REJECTED;

      candidate.stageHistory.push({
        stage: candidate.stage,
        at: new Date(),
        by: req.user.id,
        note: `${offer.offerNumber} ${status.toLowerCase()}`,
      });

      await candidate.save();
    }
  }

  await recordAudit({
    req,
    entity: 'Offer',
    entityId: offer._id,
    entityLabel: offer.offerNumber,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from, to: status }],
    metadata: { reason: reason ?? null },
  });

  return offer.toObject();
};

/* -------------------------------------------------------------------------- */
/*                          Joining and conversion                            */
/* -------------------------------------------------------------------------- */

/**
 * Turns an accepted offer into an employee.
 *
 * Goes through the employee service rather than writing the document directly,
 * so uniqueness, date coherence and the audit entry a new hire gets are all the
 * ones the Employee module already enforces. Recruitment does not get its own
 * shortcut into the employee table.
 *
 * The offer carries the placement precisely so this step is a copy: department,
 * designation, unit, grade and reporting line all come across.
 */
export const convertToEmployee = async (offerId, payload, req) => {
  const offer = await Offer.findOne({ _id: offerId, tenantId: tenantOf(req) });
  if (!offer) throw ApiError.notFound('Offer not found');

  /**
   * Already-converted is checked FIRST.
   *
   * A converted offer is JOINED, so the status check below would otherwise
   * catch it and report "only an accepted offer can be converted" -- true, but
   * a confusing way to say "you already did this".
   */
  if (offer.employeeId) {
    throw ApiError.conflict('This offer has already been converted into an employee');
  }

  if (offer.status !== OFFER_STATUS.ACCEPTED) {
    throw ApiError.badRequest('Only an accepted offer can be converted into an employee');
  }

  const candidate = await Candidate.findById(offer.candidateId);
  if (!candidate) throw ApiError.notFound('Candidate not found');

  if (candidate.convertedEmployeeId) {
    throw ApiError.conflict('This candidate is already an employee');
  }

  const joiningDate = payload.joiningDate ?? offer.proposedJoiningDate;

  const employee = await employeeService.createEmployee(
    {
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      personalEmail: candidate.email,
      mobile: candidate.phone ?? undefined,
      joiningDate,

      departmentId: offer.departmentId ?? undefined,
      designationId: offer.designationId ?? undefined,
      unitId: offer.unitId ?? undefined,
      gradeId: offer.gradeId ?? undefined,
      reportingManagerId: offer.reportingManagerId ?? undefined,
      employmentType: offer.employmentType,

      // A probation period on the offer means they start on probation.
      status: offer.probationMonths > 0 ? EMPLOYEE_STATUS.PROBATION : EMPLOYEE_STATUS.ACTIVE,

      ...(payload.employeeCode ? { employeeCode: payload.employeeCode } : {}),
      ...(payload.workEmail ? { workEmail: payload.workEmail } : {}),
      ...(payload.employeeId ? { employeeId: payload.employeeId } : {}),
    },
    req,
  );

  const employeeObjectId = employee._id ?? employee.id;

  offer.status = OFFER_STATUS.JOINED;
  offer.employeeId = employeeObjectId;
  offer.actualJoiningDate = joiningDate;
  offer.joinedAt = new Date();
  offer.updatedBy = req.user.id;
  await offer.save();

  candidate.stage = CANDIDATE_STAGE.HIRED;
  candidate.convertedEmployeeId = employeeObjectId;
  candidate.convertedAt = new Date();
  candidate.stageHistory.push({
    stage: CANDIDATE_STAGE.HIRED,
    at: new Date(),
    by: req.user.id,
    note: `Joined as ${employee.employeeCode}`,
  });
  await candidate.save();

  /**
   * The requisition fills as people actually join, not as offers go out --
   * an accepted offer that never turns up must not consume a seat.
   */
  const job = await JobOpening.findById(offer.jobOpeningId);

  if (job) {
    job.filled = Math.min(job.vacancies, (job.filled ?? 0) + 1);
    if (job.filled >= job.vacancies) {
      job.status = JOB_STATUS.FILLED;
      job.closedAt = new Date();
    }
    await job.save();
  }

  await recordAudit({
    req,
    entity: 'Offer',
    entityId: offer._id,
    entityLabel: offer.offerNumber,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'status', from: OFFER_STATUS.ACCEPTED, to: OFFER_STATUS.JOINED }],
    metadata: { employeeCode: employee.employeeCode },
  });

  return { offer: offer.toObject(), employee };
};

/* -------------------------------------------------------------------------- */
/*                                   Reports                                  */
/* -------------------------------------------------------------------------- */

/**
 * The hiring funnel and what it cost in time.
 *
 * Drop-off is measured between adjacent stages, which is only meaningful
 * because CANDIDATE_STAGE_ORDER is the real sequence.
 */
export const hiringReport = async ({ from, to, jobOpeningId }, req) => {
  const tenantId = tenantOf(req);

  const match = { tenantId };
  if (jobOpeningId) match.jobOpeningId = jobOpeningId;

  if (from || to) {
    match.appliedAt = {};
    if (from) match.appliedAt.$gte = new Date(from);
    if (to) match.appliedAt.$lte = new Date(to);
  }

  const candidates = await Candidate.find(match)
    .populate({ path: 'jobOpeningId', select: 'code title departmentId' })
    .lean();

  /**
   * Reached counts everyone who got AT LEAST this far, so the funnel only ever
   * narrows. Counting the current stage alone would show a candidate sitting at
   * OFFER as never having been interviewed.
   */
  const reachedIndex = (candidate) => {
    const highest = (candidate.stageHistory ?? [])
      .map((entry) => CANDIDATE_STAGE_ORDER.indexOf(entry.stage))
      .filter((index) => index >= 0);

    const current = CANDIDATE_STAGE_ORDER.indexOf(candidate.stage);

    // Floored at APPLIED: a candidate record existing means they applied. A
    // rejected candidate whose history was never written -- an import, a
    // legacy row -- would otherwise score -1 and drop out of the funnel
    // altogether, hiding the very drop-off this report measures.
    return Math.max(0, current, ...highest);
  };

  const funnel = CANDIDATE_STAGE_ORDER.map((stage, index) => {
    const reached = candidates.filter((candidate) => reachedIndex(candidate) >= index).length;
    return { stage, reached };
  }).map((entry, index, all) => ({
    ...entry,
    // Conversion from the previous stage, which is the number worth acting on.
    conversionPercent:
      index === 0 || all[index - 1].reached === 0
        ? 100
        : Number(((entry.reached / all[index - 1].reached) * 100).toFixed(1)),
  }));

  const bySource = [...new Set(candidates.map((candidate) => candidate.source))].map((source) => {
    const group = candidates.filter((candidate) => candidate.source === source);
    const hired = group.filter((candidate) => candidate.stage === CANDIDATE_STAGE.HIRED).length;

    return {
      source,
      applied: group.length,
      hired,
      conversionPercent: group.length ? Number(((hired / group.length) * 100).toFixed(1)) : 0,
    };
  });

  // Days from application to joining, for those who actually joined.
  const hired = candidates.filter((candidate) => candidate.convertedAt);
  const timeToHireDays = hired.length
    ? Number(
        (
          hired.reduce(
            (sum, candidate) =>
              sum + (new Date(candidate.convertedAt) - new Date(candidate.appliedAt)) / 86_400_000,
            0,
          ) / hired.length
        ).toFixed(1),
      )
    : 0;

  const byJob = new Map();

  candidates.forEach((candidate) => {
    const key = candidate.jobOpeningId?._id ? String(candidate.jobOpeningId._id) : 'unassigned';

    if (!byJob.has(key)) {
      byJob.set(key, {
        jobOpeningId: key,
        code: candidate.jobOpeningId?.code ?? '—',
        title: candidate.jobOpeningId?.title ?? 'Unassigned',
        applied: 0,
        hired: 0,
        rejected: 0,
        active: 0,
      });
    }

    const entry = byJob.get(key);
    entry.applied += 1;
    if (candidate.stage === CANDIDATE_STAGE.HIRED) entry.hired += 1;
    else if ([CANDIDATE_STAGE.REJECTED, CANDIDATE_STAGE.WITHDRAWN].includes(candidate.stage)) entry.rejected += 1;
    else entry.active += 1;
  });

  const [openJobs, scheduledInterviews, pendingOffers] = await Promise.all([
    JobOpening.countDocuments({ tenantId, status: JOB_STATUS.OPEN }),
    Interview.countDocuments({ tenantId, status: INTERVIEW_STATUS.SCHEDULED }),
    Offer.countDocuments({ tenantId, status: OFFER_STATUS.SENT }),
  ]);

  return {
    totals: {
      candidates: candidates.length,
      hired: hired.length,
      openJobs,
      scheduledInterviews,
      pendingOffers,
      timeToHireDays,
    },
    funnel,
    bySource,
    byJob: [...byJob.values()].sort((a, b) => b.applied - a.applied),
  };
};

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
  attachResume,
  listInterviews,
  scheduleInterview,
  updateInterview,
  submitFeedback,
  listOffers,
  getOffer,
  createOffer,
  setOfferStatus,
  convertToEmployee,
  hiringReport,
};
