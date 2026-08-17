import Joi from 'joi';
import {
  ATTENDANCE_STATUS,
  ATTENDANCE_SOURCE,
  REGULARIZATION_TYPES,
  REGULARIZATION_STATUS,
  HOLIDAY_TYPES,
} from '../../utils/constants.js';
import { SORTABLE_FIELDS } from '../../services/attendance/attendance.service.js';
import { SORTABLE_FIELDS as REG_SORTABLE } from '../../services/attendance/regularization.service.js';

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': 'Must be a valid identifier',
  'string.length': 'Must be a valid identifier',
});

const location = Joi.object({
  latitude: Joi.number().min(-90).max(90).required(),
  longitude: Joi.number().min(-180).max(180).required(),
  // Reported by the device; used to widen the geofence rather than to reject.
  accuracy: Joi.number().min(0).max(10_000),
  address: Joi.string().trim().max(250).allow('', null),
});

const paging = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(200).default(25),
};

/* ------------------------------------------------------------- punching -- */

export const punchSchema = {
  body: Joi.object({
    employeeId: objectId,
    direction: Joi.string().valid('IN', 'OUT'),
    location,
    source: Joi.string().valid(...Object.values(ATTENDANCE_SOURCE)),
    note: Joi.string().trim().max(250).allow('', null),
    // Back-dating a punch is a privileged act; the route gates it, and the
    // schema keeps it out of the self-service payload by default.
    time: Joi.date(),
  }).default({}),
};

export const markManualSchema = {
  body: Joi.object({
    employeeId: objectId.required(),
    date: Joi.date().required(),
    checkIn: Joi.date().allow(null, ''),
    checkOut: Joi.date().allow(null, ''),
    status: Joi.string().valid(...Object.values(ATTENDANCE_STATUS)).allow(null, ''),
    remarks: Joi.string().trim().max(500).allow('', null),
    // Why the correction was made. Optional, so existing callers are
    // unaffected; it is written to the audit trail, never to the record.
    reason: Joi.string().trim().max(300).allow('', null),
  })
    /**
     * A day with nothing at all says nothing at all.
     *
     * `remarks` counts: a correction that only annotates a day is legitimate,
     * and now that the editor omits fields it did not change, a note-only edit
     * genuinely arrives without times or a status.
     */
    .or('checkIn', 'checkOut', 'status', 'remarks')
    .messages({ 'object.missing': 'Provide a check-in, a check-out, a status or a remark' }),
};

/* ---------------------------------------------------------------- reads -- */

export const listAttendanceSchema = {
  query: Joi.object({
    ...paging,
    sortBy: Joi.string().valid(...SORTABLE_FIELDS),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    employeeId: objectId,
    status: Joi.alternatives().try(
      Joi.string().valid(...Object.values(ATTENDANCE_STATUS)),
      Joi.array().items(Joi.string().valid(...Object.values(ATTENDANCE_STATUS))),
    ),
    from: Joi.date(),
    to: Joi.date().min(Joi.ref('from')).messages({
      'date.min': 'The end of the range must be after its start',
    }),
    isRegularized: Joi.boolean(),
    hasAnomaly: Joi.boolean(),
    lateOnly: Joi.boolean(),
    overtimeOnly: Joi.boolean(),
  }),
};

export const dailySummarySchema = {
  query: Joi.object({ date: Joi.date().default(() => new Date()) }),
};

export const compOffSchema = {
  query: Joi.object({ employeeId: objectId }),
};

/* ------------------------------------------------ monthly sheet import --- */

const year = Joi.number().integer().min(2000).max(2100);
const monthNumber = Joi.number().integer().min(1).max(12);

export const listSheetsSchema = {
  query: Joi.object({
    ...paging,
    sortBy: Joi.string().valid('year', 'month', 'employeeId', 'uploadedAt', 'createdAt'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    year,
    month: monthNumber,
    // The uploaded identifier, which is free text rather than an ObjectId.
    employeeId: Joi.string().trim().max(40),
    importBatchId: Joi.string().trim().max(60),
  }),
};

export const monthQuerySchema = {
  query: Joi.object({
    // Accepts an ObjectId, an employee ID or an employee code.
    employeeId: Joi.string().trim().max(40).required(),
    year: year.required(),
    month: monthNumber.required(),
  }),
};

export const templateQuerySchema = {
  query: Joi.object({ year, month: monthNumber }),
};

const sheetDaySchema = Joi.object({
  day: Joi.number().integer().min(1).max(31).required(),
  inTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .allow(null, '')
    .messages({ 'string.pattern.base': 'Times must be HH:mm' }),
  outTime: Joi.string()
    .pattern(/^([01]\d|2[0-3]):[0-5]\d$/)
    .allow(null, '')
    .messages({ 'string.pattern.base': 'Times must be HH:mm' }),
  remark: Joi.string().trim().max(120).allow(null, ''),
});

export const updateSheetSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    attendance: Joi.array().items(sheetDaySchema).max(31),
    unit: Joi.string().trim().max(120).allow(null, ''),
    remarks: Joi.string().trim().max(500).allow(null, ''),
  }).min(1),
};

/* ---------------------------------------------------------- new reports -- */

export const dayReportSchema = {
  query: Joi.object({
    // Mirrors DAY_REPORTS in services/attendance/attendanceReport.service.js.
    type: Joi.string().valid('LATE', 'EARLY', 'OVERTIME', 'ABSENT', 'HALF_DAY').required(),
    from: Joi.date().required(),
    to: Joi.date().min(Joi.ref('from')).required().messages({
      'date.min': 'The end of the range must be after its start',
    }),
    departmentId: objectId,
    unitId: objectId,
  }),
};

export const groupedReportSchema = {
  query: Joi.object({
    year: year.required(),
    month: monthNumber.required(),
    groupBy: Joi.string().valid('department', 'unit').default('department'),
  }),
};

/** A whole year of overtime, a month at a time. Feeds the dashboard's trend. */
export const overtimeTrendSchema = {
  query: Joi.object({ year: year.required() }),
};

export const monthlyCalendarSchema = {
  query: Joi.object({
    employeeId: objectId,
    year: Joi.number().integer().min(2000).max(2100).required(),
    month: Joi.number().integer().min(1).max(12).required(),
  }),
};

export const monthlyReportSchema = {
  query: Joi.object({
    year: Joi.number().integer().min(2000).max(2100).required(),
    month: Joi.number().integer().min(1).max(12).required(),
    departmentId: objectId,
    employeeId: objectId,

    /* ------------------------------------------- overtime filters ----- */
    // Additive and all optional, so every existing caller is unaffected.
    shiftId: objectId,
    hasOvertime: Joi.boolean(),
    minOvertimeMinutes: Joi.number().integer().min(0).max(100000),
  }),
};

export const exceptionReportSchema = {
  query: Joi.object({
    from: Joi.date().required(),
    to: Joi.date().min(Joi.ref('from')).required(),
    departmentId: objectId,
  }),
};

export const idParamSchema = {
  params: Joi.object({ id: objectId.required() }),
};

/* --------------------------------------------------------------- ingest -- */

export const biometricSchema = {
  body: Joi.object({
    deviceId: Joi.string().trim().max(60).allow('', null),
    punches: Joi.array()
      .items(
        Joi.object({
          employeeCode: Joi.string().trim().max(20).required(),
          timestamp: Joi.date().required(),
          direction: Joi.string().valid('IN', 'OUT', 'UNKNOWN').default('UNKNOWN'),
          deviceId: Joi.string().trim().max(60).allow('', null),
          note: Joi.string().trim().max(250).allow('', null),
        }),
      )
      .min(1)
      // Devices batch overnight; 5,000 is roughly a day for a large site and
      // keeps one request from monopolising the process.
      .max(5000)
      .required(),
  }),
};

export const lockPeriodSchema = {
  body: Joi.object({
    from: Joi.date().required(),
    to: Joi.date().min(Joi.ref('from')).required(),
  }),
};

/* ------------------------------------------------------ regularization --- */

export const requestRegularizationSchema = {
  body: Joi.object({
    employeeId: objectId,
    date: Joi.date().required(),
    type: Joi.string().valid(...Object.values(REGULARIZATION_TYPES)).required(),
    requestedCheckIn: Joi.date().allow(null, ''),
    requestedCheckOut: Joi.date().allow(null, ''),
    requestedStatus: Joi.string()
      .valid(
        ATTENDANCE_STATUS.PRESENT,
        ATTENDANCE_STATUS.HALF_DAY,
        ATTENDANCE_STATUS.ON_DUTY,
        ATTENDANCE_STATUS.WORK_FROM_HOME,
      )
      .allow(null, ''),
    reason: Joi.string().trim().min(5).max(500).required().messages({
      'string.min': 'Give a reason of at least 5 characters',
      'any.required': 'A reason is required',
    }),
  })
    .or('requestedCheckIn', 'requestedCheckOut', 'requestedStatus')
    .messages({ 'object.missing': 'Specify the corrected times or the status you are claiming' }),
};

export const decideRegularizationSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    decision: Joi.string()
      .valid(REGULARIZATION_STATUS.APPROVED, REGULARIZATION_STATUS.REJECTED)
      .required(),
    comment: Joi.string().trim().max(500).allow('', null),
  }).when(Joi.object({ decision: REGULARIZATION_STATUS.REJECTED }).unknown(), {
    // A rejection without a stated reason is the one the employee will
    // escalate; requiring it up front avoids that conversation.
    then: Joi.object({ comment: Joi.string().trim().min(3).max(500).required() }),
  }),
};

export const listRegularizationsSchema = {
  query: Joi.object({
    ...paging,
    sortBy: Joi.string().valid(...REG_SORTABLE),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    status: Joi.alternatives().try(
      Joi.string().valid(...Object.values(REGULARIZATION_STATUS)),
      Joi.array().items(Joi.string().valid(...Object.values(REGULARIZATION_STATUS))),
    ),
    type: Joi.string().valid(...Object.values(REGULARIZATION_TYPES)),
    employeeId: objectId,
    from: Joi.date(),
    to: Joi.date().min(Joi.ref('from')),
    mine: Joi.boolean().default(false),
  }),
};

/* -------------------------------------------------------------- holiday -- */

export const createHolidaySchema = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(120).required(),
    date: Joi.date().required(),
    type: Joi.string().valid(...Object.values(HOLIDAY_TYPES)).default(HOLIDAY_TYPES.PUBLIC),
    description: Joi.string().trim().max(300).allow('', null),
    departmentIds: Joi.array().items(objectId).default([]),
    locations: Joi.array().items(Joi.string().trim().max(80)).default([]),
    isOptional: Joi.boolean().default(false),
  }),
};

export const listHolidaysSchema = {
  query: Joi.object({
    year: Joi.number().integer().min(2000).max(2100).default(() => new Date().getFullYear()),
    /**
     * Omitted means active only, which is what the grader and the calendar
     * widget have always received. The management screen asks for `all` so it
     * can restore a withdrawn holiday -- a row it cannot see is a row it can
     * never bring back.
     */
    status: Joi.string().valid('active', 'inactive', 'all'),
  }),
};

export const updateHolidaySchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({
    name: Joi.string().trim().min(2).max(120),
    date: Joi.date(),
    type: Joi.string().valid(...Object.values(HOLIDAY_TYPES)),
    description: Joi.string().trim().max(300).allow('', null),
    departmentIds: Joi.array().items(objectId),
    locations: Joi.array().items(Joi.string().trim().max(80)),
    isOptional: Joi.boolean(),
  }).min(1),
};

export const holidayStatusSchema = {
  params: Joi.object({ id: objectId.required() }),
  body: Joi.object({ isActive: Joi.boolean().required() }),
};

export const holidayAuditSchema = {
  params: Joi.object({ id: objectId.required() }),
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

/* --------------------------------------------------------------- policy -- */

export const upsertPolicySchema = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    departmentId: objectId.allow(null, ''),
    fullDayMinutes: Joi.number().integer().min(60).max(900),
    halfDayMinutes: Joi.number().integer().min(30).max(600),
    lateGraceMinutes: Joi.number().integer().min(0).max(120),
    earlyGoingGraceMinutes: Joi.number().integer().min(0).max(120),
    latesPerHalfDayDeduction: Joi.number().integer().min(0).max(10),
    overtimeEnabled: Joi.boolean(),
    minOvertimeMinutes: Joi.number().integer().min(0).max(240),
    maxOvertimeMinutes: Joi.number().integer().min(0).max(720),
    overtimeAfterShiftEnd: Joi.boolean(),
    compOffEnabled: Joi.boolean(),
    compOffMinMinutes: Joi.number().integer().min(60).max(720),
    compOffExpiryDays: Joi.number().integer().min(7).max(365),
    autoAbsentOnNoPunch: Joi.boolean(),
    countBreakAsWorked: Joi.boolean(),
    weeklyOffs: Joi.array().items(Joi.number().integer().min(0).max(6)).max(7),
    geofenceEnabled: Joi.boolean(),
    rejectOutsideGeofence: Joi.boolean(),
    geofenceSites: Joi.array().items(
      Joi.object({
        name: Joi.string().trim().max(100).required(),
        latitude: Joi.number().min(-90).max(90).required(),
        longitude: Joi.number().min(-180).max(180).required(),
        radiusMetres: Joi.number().min(20).max(5000).default(200),
        isActive: Joi.boolean().default(true),
      }),
    ),
    regularizationEnabled: Joi.boolean(),
    regularizationWindowDays: Joi.number().integer().min(1).max(90),
    maxRegularizationsPerMonth: Joi.number().integer().min(0).max(31),
  })
    // Caught here as well as in the model so the client gets a field-level
    // message instead of a generic 500 from the schema hook.
    .custom((value, helpers) => {
      if (value.halfDayMinutes && value.fullDayMinutes && value.halfDayMinutes >= value.fullDayMinutes) {
        return helpers.error('policy.thresholds');
      }
      return value;
    })
    .messages({ 'policy.thresholds': 'Half-day minutes must be less than full-day minutes' }),
};

export default {
  punchSchema,
  markManualSchema,
  listAttendanceSchema,
  dailySummarySchema,
  compOffSchema,
  listSheetsSchema,
  monthQuerySchema,
  templateQuerySchema,
  updateSheetSchema,
  dayReportSchema,
  groupedReportSchema,
  overtimeTrendSchema,
  monthlyCalendarSchema,
  monthlyReportSchema,
  exceptionReportSchema,
  idParamSchema,
  biometricSchema,
  lockPeriodSchema,
  requestRegularizationSchema,
  decideRegularizationSchema,
  listRegularizationsSchema,
  createHolidaySchema,
  listHolidaysSchema,
  updateHolidaySchema,
  holidayStatusSchema,
  holidayAuditSchema,
  upsertPolicySchema,
};
