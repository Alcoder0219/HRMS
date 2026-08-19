import { randomInt } from 'node:crypto';
import mongoose from 'mongoose';
import Employee from '../../models/employee/employee.model.js';

/**
 * Every read here excludes soft-deleted rows by default. Callers that genuinely
 * want them -- the restore flow, the audit view -- must opt in explicitly, so a
 * forgotten filter cannot resurrect a deleted employee into a normal listing.
 */
const notDeleted = { deletedAt: null };

const withScope = (scopeFilter = {}, extra = {}) => ({ ...scopeFilter, ...notDeleted, ...extra });

/** Reference data every list and detail view needs resolved. */
const POPULATE = [
  { path: 'departmentId', select: 'name code' },
  { path: 'designationId', select: 'name code level' },
  { path: 'shiftId', select: 'name code startTime endTime' },
  { path: 'reportingManagerId', select: 'firstName lastName employeeCode employeeId' },
  // Added alongside the originals; a record without them simply resolves null.
  { path: 'unitId', select: 'name code city state' },
  { path: 'gradeId', select: 'name code level' },
  { path: 'salaryTemplateId', select: 'name code' },
  /**
   * The login account, so a screen can show whether this employee can sign in
   * without a second request per row.
   *
   * The selection is deliberately narrow. A User carries a password hash, its
   * history, and the brute-force counters; populating the whole document into
   * every employee list would put all of that one careless `res.json` away from
   * a response body. These five fields are what the Employee screens display
   * and nothing else.
   */
  { path: 'userId', select: 'email role status lastLoginAt isEmailVerified' },
];

/* ------------------------------------------------------------------ reads */

export const findById = (id, { includeDeleted = false, populate = true } = {}) => {
  const filter = { _id: id, ...(includeDeleted ? {} : notDeleted) };
  const query = Employee.findOne(filter);
  return populate ? query.populate(POPULATE) : query;
};

export const findByCode = (tenantId, employeeCode) =>
  Employee.findOne({ tenantId, employeeCode: String(employeeCode).toUpperCase(), ...notDeleted });

export const findByWorkEmail = (tenantId, workEmail) =>
  Employee.findOne({ tenantId, workEmail: String(workEmail).toLowerCase(), ...notDeleted });

export const findByEmployeeId = (tenantId, employeeId) =>
  Employee.findOne({ tenantId, employeeId, ...notDeleted });

/**
 * Paginated list. Count and page are fetched together because the client needs
 * both to render pagination, and two round trips would let them disagree.
 */
export const paginate = async ({ filter, sort, skip, limit, populate = true, lean = true }) => {
  const query = Employee.find(filter).sort(sort).skip(skip).limit(limit);
  if (populate) query.populate(POPULATE);
  if (lean) query.lean({ virtuals: true });

  const [items, total] = await Promise.all([query.exec(), Employee.countDocuments(filter)]);

  return { items, total };
};

/** Unpaginated cursor for export, which must not be capped by a page size. */
export const stream = (filter, sort) =>
  Employee.find(filter).sort(sort).populate(POPULATE).lean().cursor();

export const countBy = (filter) => Employee.countDocuments({ ...filter, ...notDeleted });

/**
 * Headcount grouped by status, in one aggregation rather than six counts.
 * Drives the list screen's summary strip.
 */
export const statusSummary = (scopeFilter = {}) =>
  Employee.aggregate([
    { $match: withScope(scopeFilter) },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);

/* ----------------------------------------------------------------- writes */

export const create = (payload) => Employee.create(payload);

export const insertMany = (payloads) =>
  // `ordered: false` lets a bulk import continue past a bad row instead of
  // abandoning the whole batch at the first failure.
  Employee.insertMany(payloads, { ordered: false, rawResult: true });

export const updateById = (id, update) =>
  Employee.findOneAndUpdate({ _id: id, ...notDeleted }, update, {
    new: true,
    runValidators: true,
  }).populate(POPULATE);

export const softDelete = (id, { deletedBy, reason }) =>
  Employee.findOneAndUpdate(
    { _id: id, ...notDeleted },
    { $set: { deletedAt: new Date(), deletedBy, deleteReason: reason ?? null } },
    { new: true },
  );

export const restore = (id) =>
  Employee.findOneAndUpdate(
    { _id: id, deletedAt: { $ne: null } },
    { $set: { deletedAt: null, deletedBy: null, deleteReason: null } },
    { new: true },
  );

/**
 * Next sequential employee code for a tenant.
 *
 * Derived from the highest existing code rather than a document count, because
 * a count would reissue a code after a deletion. Soft-deleted rows are included
 * in the scan for the same reason -- a retired code must stay retired.
 */
export const nextEmployeeCode = async (tenantId, prefix = 'EMP', width = 5) => {
  const rows = await Employee.find({
    tenantId,
    employeeCode: new RegExp(`^${prefix}\\d+$`),
  })
    .select('employeeCode')
    .lean();

  /**
   * The highest number is found numerically, not by sorting the string.
   *
   * A lexical sort puts "EMP9" above "EMP10", so widening the padding -- from
   * EMP00001 to EMP000001, say -- would otherwise start the sequence again and
   * collide with existing codes. Comparing the numeric suffix makes the width
   * a presentation choice that can be changed safely at any point.
   */
  const highest = rows.reduce((max, row) => {
    const value = Number(row.employeeCode.slice(prefix.length));
    return Number.isFinite(value) && value > max ? value : max;
  }, 0);

  return `${prefix}${String(highest + 1).padStart(width, '0')}`;
};

/**
 * The business-facing employee ID: five digits followed by a letter, e.g.
 * "33650D".
 *
 * Deliberately random rather than sequential. A sequence has to be read before
 * it can be written, and two creates landing together read the same highest
 * value and then write the same next one -- the race the previous
 * implementation had. A random draw needs no read to be correct, so the only
 * arbiter of uniqueness is the unique index, which is exactly where that
 * decision belongs.
 *
 * It is also derived from nothing about the person. Name, department,
 * designation and joining date all change, and an identifier that encodes them
 * either goes stale or invites someone to "correct" it.
 *
 * `randomInt` rather than `Math.random`: the latter is biased across a modulo
 * and, being seeded per process, can repeat draws between workers started in
 * the same tick.
 */
const ID_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export const randomEmployeeId = () =>
  `${String(randomInt(0, 100_000)).padStart(5, '0')}${ID_LETTERS[randomInt(0, ID_LETTERS.length)]}`;

/**
 * Draws an employee ID that no employee holds.
 *
 * Soft-deleted rows are included in the check, and the scan is not scoped to a
 * tenant: an ID that has ever been issued is never issued again. A leaver's ID
 * still sits on years of payslips and attendance, and reissuing it would make
 * two people indistinguishable in the record -- which is the one thing the
 * identifier exists to prevent.
 *
 * The draw is only a first filter. Two requests can still pass it at the same
 * instant, so `createEmployee` retries against the unique index rather than
 * trusting this result.
 */
export const generateEmployeeId = async (attempts = 12) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = randomEmployeeId();
    // eslint-disable-next-line no-await-in-loop -- candidates must be tried in order
    const taken = await Employee.exists({ employeeId: candidate });
    if (!taken) return candidate;
  }

  // 2.6M combinations against a realistic headcount means this is unreachable
  // in practice; throwing beats returning a duplicate if it ever is reached.
  throw new Error('Could not generate a unique employee ID');
};

/** True when the manager chain from `managerId` reaches `employeeId`. */
export const wouldCreateReportingCycle = async (employeeId, managerId) => {
  if (!managerId) return false;
  if (String(employeeId) === String(managerId)) return true;

  const seen = new Set([String(employeeId)]);
  let cursor = managerId;

  // Bounded walk: a corrupted chain must not spin forever.
  for (let depth = 0; depth < 50 && cursor; depth += 1) {
    const key = String(cursor);
    if (seen.has(key)) return true;
    seen.add(key);

    const manager = await Employee.findById(cursor).select('reportingManagerId').lean();
    cursor = manager?.reportingManagerId ?? null;
  }

  return false;
};

export const toObjectId = (value) =>
  mongoose.Types.ObjectId.isValid(value) ? new mongoose.Types.ObjectId(String(value)) : null;

export default {
  findById,
  findByCode,
  findByWorkEmail,
  findByEmployeeId,
  paginate,
  stream,
  countBy,
  statusSummary,
  create,
  insertMany,
  updateById,
  softDelete,
  restore,
  nextEmployeeCode,
  randomEmployeeId,
  generateEmployeeId,
  wouldCreateReportingCycle,
  toObjectId,
};
