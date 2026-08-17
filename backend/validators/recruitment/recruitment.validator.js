import Joi from 'joi';
import {
  JOB_STATUS,
  CANDIDATE_STAGE,
  CANDIDATE_SOURCE,
  INTERVIEW_MODE,
  INTERVIEW_STATUS,
  INTERVIEW_RECOMMENDATION,
  OFFER_STATUS,
  EMPLOYMENT_TYPE,
} from '../../utils/constants.js';

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': 'Must be a valid identifier',
  'string.length': 'Must be a valid identifier',
});

const money = (max = 100_000_000) => Joi.number().min(0).max(max);
const text = (max) => Joi.string().trim().max(max).allow('', null);

const paging = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
};

export const idParamSchema = { params: Joi.object({ id: objectId.required() }) };

/* ---------------------------------------------------------- job openings -- */

const jobShape = {
  code: Joi.string().trim().uppercase().max(20).allow('', null),
  title: Joi.string().trim().min(2).max(120),
  description: text(4000),

  departmentId: objectId.allow('', null),
  designationId: objectId.allow('', null),
  unitId: objectId.allow('', null),
  gradeId: objectId.allow('', null),
  hiringManagerId: objectId.allow('', null),

  employmentType: Joi.string().valid(...Object.values(EMPLOYMENT_TYPE)),
  vacancies: Joi.number().integer().min(1).max(999),

  minExperienceYears: Joi.number().min(0).max(50),
  maxExperienceYears: Joi.number().min(0).max(50),
  minSalary: money(),
  maxSalary: money(),

  skills: Joi.array().items(Joi.string().trim().max(40)).max(30),
  location: text(120),
  status: Joi.string().valid(...Object.values(JOB_STATUS)),
  closesOn: Joi.date().allow(null, ''),
  closeReason: text(300),
};

/**
 * Bands are checked here as well as in the model: a hook that throws surfaces
 * as a 500, and this is the client's mistake to fix.
 */
const withBands = (schema) =>
  schema.custom((value, helpers) => {
    if (value.maxSalary > 0 && value.minSalary > 0 && value.maxSalary < value.minSalary) {
      return helpers.message('Maximum salary cannot be below the minimum');
    }

    if (
      value.maxExperienceYears > 0 &&
      value.minExperienceYears > 0 &&
      value.maxExperienceYears < value.minExperienceYears
    ) {
      return helpers.message('Maximum experience cannot be below the minimum');
    }

    return value;
  });

export const listJobsSchema = {
  query: Joi.object({
    ...paging,
    search: text(100),
    status: Joi.string().valid(...Object.values(JOB_STATUS)),
    departmentId: objectId,
    sortBy: Joi.string().max(40),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

export const createJobSchema = {
  body: withBands(Joi.object(jobShape).fork(['title'], (rule) => rule.required())),
};

export const updateJobSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: withBands(Joi.object(jobShape).min(1)),
};

/* ------------------------------------------------------------- candidates -- */

const candidateShape = {
  firstName: Joi.string().trim().min(1).max(60),
  lastName: Joi.string().trim().min(1).max(60),
  email: Joi.string().trim().lowercase().email({ tlds: false }).max(120),
  phone: text(20),

  jobOpeningId: objectId,
  source: Joi.string().valid(...Object.values(CANDIDATE_SOURCE)),
  referredBy: text(120),

  totalExperienceYears: Joi.number().min(0).max(60),
  currentEmployer: text(120),
  currentCtc: money(),
  expectedCtc: money(),
  noticePeriodDays: Joi.number().integer().min(0).max(365),

  skills: Joi.array().items(Joi.string().trim().max(40)).max(30),
  notes: text(2000),
};

export const listCandidatesSchema = {
  query: Joi.object({
    ...paging,
    search: text(100),
    stage: Joi.string().valid(...Object.values(CANDIDATE_STAGE)),
    jobOpeningId: objectId,
    source: Joi.string().valid(...Object.values(CANDIDATE_SOURCE)),
    active: Joi.boolean(),
    sortBy: Joi.string().max(40),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

export const createCandidateSchema = {
  body: Joi.object(candidateShape).fork(
    ['firstName', 'lastName', 'email', 'jobOpeningId'],
    (rule) => rule.required(),
  ),
};

export const updateCandidateSchema = {
  params: Joi.object({ id: objectId.required() }),
  // The opening a candidate applied to is not editable: moving them to another
  // role is a new application, and the funnel would otherwise lose its history.
  body: Joi.object(candidateShape).fork(['jobOpeningId'], (rule) => rule.forbidden()).min(1),
};

export const moveStageSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    // HIRED is deliberately absent: that is a consequence of joining.
    stage: Joi.string()
      .valid(
        CANDIDATE_STAGE.APPLIED,
        CANDIDATE_STAGE.SCREENING,
        CANDIDATE_STAGE.INTERVIEW,
        CANDIDATE_STAGE.OFFER,
        CANDIDATE_STAGE.REJECTED,
        CANDIDATE_STAGE.WITHDRAWN,
      )
      .required(),
    note: text(500),
  }).when(Joi.object({ stage: Joi.valid(CANDIDATE_STAGE.REJECTED) }).unknown(), {
    then: Joi.object({ note: Joi.string().trim().min(3).max(500).required() }),
  }),
};

/* ------------------------------------------------------------- interviews -- */

export const listInterviewsSchema = {
  query: Joi.object({
    ...paging,
    status: Joi.string().valid(...Object.values(INTERVIEW_STATUS)),
    candidateId: objectId,
    jobOpeningId: objectId,
    from: Joi.date(),
    to: Joi.date().min(Joi.ref('from')),
    sortOrder: Joi.string().valid('asc', 'desc').default('asc'),
  }),
};

export const scheduleInterviewSchema = {
  body: Joi.object({
    candidateId: objectId.required(),
    round: Joi.number().integer().min(1).max(20),
    title: text(120),
    scheduledAt: Joi.date().required(),
    durationMinutes: Joi.number().integer().min(5).max(480),
    mode: Joi.string().valid(...Object.values(INTERVIEW_MODE)),
    location: text(200),
    meetingLink: text(500),
    interviewerIds: Joi.array().items(objectId).max(10),
  }),
};

export const updateInterviewSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    scheduledAt: Joi.date(),
    durationMinutes: Joi.number().integer().min(5).max(480),
    mode: Joi.string().valid(...Object.values(INTERVIEW_MODE)),
    location: text(200),
    meetingLink: text(500),
    interviewerIds: Joi.array().items(objectId).max(10),
    status: Joi.string().valid(...Object.values(INTERVIEW_STATUS)),
    outcome: Joi.string().valid(...Object.values(INTERVIEW_RECOMMENDATION)).allow(null),
    cancelReason: text(300),
  }).min(1),
};

export const feedbackSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    interviewerId: objectId.allow('', null),
    interviewerName: text(120),
    rating: Joi.number().integer().min(1).max(5),
    recommendation: Joi.string().valid(...Object.values(INTERVIEW_RECOMMENDATION)),
    strengths: text(1000),
    concerns: text(1000),
    comment: text(2000),
    // Closes the round and stamps the panel's overall call.
    closeRound: Joi.boolean().default(false),
  }).or('rating', 'recommendation', 'comment'),
};

/* ----------------------------------------------------------------- offers -- */

export const listOffersSchema = {
  query: Joi.object({
    ...paging,
    status: Joi.string().valid(...Object.values(OFFER_STATUS)),
    candidateId: objectId,
    jobOpeningId: objectId,
  }),
};

export const createOfferSchema = {
  body: Joi.object({
    candidateId: objectId.required(),
    designationId: objectId.allow('', null),
    departmentId: objectId.allow('', null),
    unitId: objectId.allow('', null),
    gradeId: objectId.allow('', null),
    reportingManagerId: objectId.allow('', null),
    employmentType: Joi.string().valid(...Object.values(EMPLOYMENT_TYPE)),

    annualCtc: money().min(1).required(),
    monthlyCtc: money(),
    probationMonths: Joi.number().integer().min(0).max(24),
    noticePeriodDays: Joi.number().integer().min(0).max(365),

    proposedJoiningDate: Joi.date().required(),
    validUntil: Joi.date().allow(null, ''),
    notes: text(2000),
  }),
};

export const offerStatusSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    status: Joi.string()
      .valid(OFFER_STATUS.SENT, OFFER_STATUS.ACCEPTED, OFFER_STATUS.DECLINED, OFFER_STATUS.WITHDRAWN)
      .required(),
    reason: text(300),
  }).when(
    Joi.object({ status: Joi.valid(OFFER_STATUS.DECLINED, OFFER_STATUS.WITHDRAWN) }).unknown(),
    { then: Joi.object({ reason: Joi.string().trim().min(3).max(300).required() }) },
  ),
};

export const convertSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    // All optional: the offer already carries the placement, and the employee
    // service generates a code when none is supplied.
    joiningDate: Joi.date(),
    employeeCode: Joi.string().trim().uppercase().max(20).allow('', null),
    employeeId: Joi.string().trim().max(20).allow('', null),
    workEmail: Joi.string().trim().lowercase().email({ tlds: false }).max(120).allow('', null),
  }).default({}),
};

/* ---------------------------------------------------------------- reports -- */

export const reportSchema = {
  query: Joi.object({
    from: Joi.date(),
    to: Joi.date().min(Joi.ref('from')),
    jobOpeningId: objectId,
  }),
};

export default {
  idParamSchema,
  listJobsSchema,
  createJobSchema,
  updateJobSchema,
  listCandidatesSchema,
  createCandidateSchema,
  updateCandidateSchema,
  moveStageSchema,
  listInterviewsSchema,
  scheduleInterviewSchema,
  updateInterviewSchema,
  feedbackSchema,
  listOffersSchema,
  createOfferSchema,
  offerStatusSchema,
  convertSchema,
  reportSchema,
};
