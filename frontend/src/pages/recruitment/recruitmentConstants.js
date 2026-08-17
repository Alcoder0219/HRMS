/**
 * Shared recruitment vocabulary for the screens.
 *
 * Mirrors the enums in backend/utils/constants.js. Only names and presentation
 * live here -- never the rules, which the server owns and re-checks.
 */

export const JOB_STATUS_COLOR = {
  DRAFT: 'default',
  OPEN: 'success',
  ON_HOLD: 'warning',
  CLOSED: 'default',
  FILLED: 'info',
};

/** In funnel order, which is what makes the pipeline readable. */
export const CANDIDATE_STAGES = [
  'APPLIED',
  'SCREENING',
  'INTERVIEW',
  'OFFER',
  'HIRED',
  'REJECTED',
  'WITHDRAWN',
];

/** HIRED is absent: it is a consequence of joining, not a move anyone makes. */
export const MOVABLE_STAGES = ['APPLIED', 'SCREENING', 'INTERVIEW', 'OFFER', 'REJECTED', 'WITHDRAWN'];

export const STAGE_COLOR = {
  APPLIED: 'default',
  SCREENING: 'info',
  INTERVIEW: 'primary',
  OFFER: 'warning',
  HIRED: 'success',
  REJECTED: 'error',
  WITHDRAWN: 'default',
};

export const CANDIDATE_SOURCES = [
  'DIRECT',
  'REFERRAL',
  'JOB_PORTAL',
  'CONSULTANT',
  'CAMPUS',
  'SOCIAL',
  'OTHER',
];

export const INTERVIEW_MODES = ['VIDEO', 'IN_PERSON', 'PHONE'];

export const INTERVIEW_STATUS_COLOR = {
  SCHEDULED: 'primary',
  COMPLETED: 'success',
  CANCELLED: 'default',
  NO_SHOW: 'error',
};

export const RECOMMENDATIONS = [
  { value: 'STRONG_YES', label: 'Strong yes', color: 'success' },
  { value: 'YES', label: 'Yes', color: 'success' },
  { value: 'NO', label: 'No', color: 'error' },
  { value: 'STRONG_NO', label: 'Strong no', color: 'error' },
];

export const OFFER_STATUS_COLOR = {
  DRAFT: 'default',
  SENT: 'warning',
  ACCEPTED: 'info',
  DECLINED: 'error',
  WITHDRAWN: 'default',
  JOINED: 'success',
};

/**
 * Which status changes the server will accept from each state.
 * Mirrors OFFER_STATUS_TRANSITIONS; JOINED is reached by converting, never by
 * setting a status.
 */
export const OFFER_NEXT = {
  DRAFT: [
    { value: 'SENT', label: 'Send offer', color: 'primary' },
    { value: 'WITHDRAWN', label: 'Withdraw', color: 'error' },
  ],
  SENT: [
    { value: 'ACCEPTED', label: 'Mark accepted', color: 'success' },
    { value: 'DECLINED', label: 'Mark declined', color: 'error' },
    { value: 'WITHDRAWN', label: 'Withdraw', color: 'error' },
  ],
  ACCEPTED: [{ value: 'WITHDRAWN', label: 'Withdraw', color: 'error' }],
  DECLINED: [],
  WITHDRAWN: [],
  JOINED: [],
};

export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'TEMPORARY'];

export default {
  JOB_STATUS_COLOR,
  CANDIDATE_STAGES,
  MOVABLE_STAGES,
  STAGE_COLOR,
  CANDIDATE_SOURCES,
  INTERVIEW_MODES,
  INTERVIEW_STATUS_COLOR,
  RECOMMENDATIONS,
  OFFER_STATUS_COLOR,
  OFFER_NEXT,
  EMPLOYMENT_TYPES,
};
