import AuditLog from '../../models/audit/auditLog.model.js';
import Employee from '../../models/employee/employee.model.js';
import Unit from '../../models/organization/unit.model.js';
import Department from '../../models/organization/department.model.js';
import Designation from '../../models/organization/designation.model.js';
import Grade from '../../models/organization/grade.model.js';

import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../../utils/constants.js';
import { buildPagination } from '../../utils/queryBuilder.js';

/**
 * Transfer and promotion history, derived from the audit trail.
 *
 * There is no transfers collection and no promotions collection, and this does
 * not add one. A transfer IS a change to an employee's unit, department,
 * designation or reporting line, and every one of those is already recorded --
 * with its before and after values, who made it and when -- by the audit entry
 * that `PATCH /employees/:id` writes.
 *
 * Deriving the history from that single source rather than maintaining a
 * parallel table means the two can never disagree. A second table would drift
 * the first time someone edited an employee through any other path.
 *
 * Executing a transfer or a promotion is likewise the existing update endpoint;
 * this module only reads.
 */

/** The fields whose movement is worth reporting, and what to call them. */
const MOVEMENT_FIELDS = {
  unitId: { label: 'Unit', Model: Unit, kind: 'TRANSFER', type: 'UNIT_TRANSFER' },
  departmentId: { label: 'Department', Model: Department, kind: 'TRANSFER', type: 'DEPARTMENT_TRANSFER' },
  designationId: { label: 'Designation', Model: Designation, kind: 'EITHER', type: 'DESIGNATION_CHANGE' },
  gradeId: { label: 'Grade', Model: Grade, kind: 'PROMOTION', type: 'GRADE_CHANGE' },
  reportingManagerId: {
    label: 'Reporting Manager',
    Model: Employee,
    kind: 'TRANSFER',
    type: 'REPORTING_CHANGE',
  },
};

const TRACKED = Object.keys(MOVEMENT_FIELDS);

const HEX = /^[0-9a-f]{24}$/i;

/**
 * Pulls an id out of whichever shape the audit entry stored.
 *
 * Three exist in the trail, and all three describe real movements:
 *
 *   1. A plain hex id -- what is written now.
 *   2. A JSON sub-document, from the period when the diff compared an id on one
 *      side against a populated document on the other.
 *   3. Reassembled bytes, handled before this by `normalizeChanges`.
 *
 * Reading all three means existing history stays usable instead of being
 * silently dropped because it predates a fix.
 */
const extractId = (value) => {
  if (value === null || value === undefined) return null;

  const text = String(value);
  if (HEX.test(text)) return text;

  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text);
      const id = parsed?._id ?? parsed?.id;
      if (id && HEX.test(String(id))) return String(id);
    } catch {
      // Not JSON after all -- fall through and report it unresolved.
    }
  }

  return text;
};

/** The display name a JSON sub-document already carries, if it has one. */
const extractName = (value) => {
  const text = String(value ?? '');
  if (!text.startsWith('{')) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed?.name) return parsed.name;
    // Employees are stored by their parts rather than a single name field.
    if (parsed?.firstName) {
      return `${parsed.firstName} ${parsed.lastName ?? ''}`.trim() +
        (parsed.employeeCode ? ` (${parsed.employeeCode})` : '');
    }
  } catch {
    return null;
  }

  return null;
};

/**
 * Rebuilds the byte-level entries older audit records contain.
 *
 * Before the diff helper learned that an ObjectId is a single value, a
 * department change was stored as twelve rows -- `departmentId.buffer.0`
 * through `.11`, one per byte. Those records still exist and describe real
 * movements, so they are reassembled here rather than discarded: twelve bytes
 * in order are exactly the ObjectId's hex.
 *
 * New entries arrive already correct and pass through untouched.
 */
const normalizeChanges = (changes = []) => {
  const direct = [];
  const buffers = new Map();

  changes.forEach((change) => {
    const match = /^(\w+)\.buffer\.(\d+)$/.exec(change.field ?? '');

    if (!match) {
      direct.push(change);
      return;
    }

    const [, field, index] = match;
    if (!buffers.has(field)) buffers.set(field, { from: [], to: [] });

    const entry = buffers.get(field);
    entry.from[Number(index)] = change.from;
    entry.to[Number(index)] = change.to;
  });

  const toHex = (bytes) => {
    // A side that was null carries no bytes; that is a genuine "was not set".
    const usable = bytes.filter((byte) => byte !== null && byte !== undefined);
    if (usable.length !== 12) return null;

    return usable.map((byte) => Number(byte).toString(16).padStart(2, '0')).join('');
  };

  buffers.forEach((entry, field) => {
    direct.push({ field, from: toHex(entry.from), to: toHex(entry.to) });
  });

  return direct;
};

/** Names for every id that appears in the history, fetched once per request. */
const buildLookup = async (movements) => {
  const idsByField = new Map(TRACKED.map((field) => [field, new Set()]));

  movements.forEach((movement) => {
    [movement.fromId, movement.toId].forEach((id) => {
      if (id && HEX.test(id)) idsByField.get(movement.field)?.add(id);
    });
  });

  const lookup = {};

  await Promise.all(
    TRACKED.map(async (field) => {
      const ids = [...(idsByField.get(field) ?? [])];
      lookup[field] = new Map();
      if (!ids.length) return;

      const { Model } = MOVEMENT_FIELDS[field];

      // Employees are named differently from the masters, so the reporting
      // line resolves through its own projection.
      const select = Model === Employee ? 'employeeCode firstName lastName' : 'name code';
      const documents = await Model.find({ _id: { $in: ids } }).select(select).lean();

      documents.forEach((document) => {
        lookup[field].set(
          String(document._id),
          Model === Employee
            ? `${document.firstName} ${document.lastName} (${document.employeeCode})`
            : document.name,
        );
      });
    }),
  );

  return lookup;
};

/**
 * A designation change is a promotion when the new level is more senior, and a
 * lateral transfer otherwise.
 *
 * Guessing from the title would be unreliable; the level on the designation
 * master is the organisation's own statement of seniority, so it is what
 * decides. When either level is unknown the change is reported as a transfer,
 * which is the weaker and safer claim.
 */
const classifyDesignation = async (fromId, toId) => {
  // An unrecoverable side cannot be compared, so the change is reported as a
  // transfer -- the claim that survives not knowing the levels.
  if (!fromId || !toId || !HEX.test(fromId) || !HEX.test(toId)) return 'TRANSFER';

  const [from, to] = await Promise.all([
    Designation.findById(fromId).select('level').lean(),
    Designation.findById(toId).select('level').lean(),
  ]);

  if (!from || !to || from.level === undefined || to.level === undefined) return 'TRANSFER';

  return to.level > from.level ? 'PROMOTION' : 'TRANSFER';
};

/** Flattens audit entries into one row per moved field. */
const toMovements = (entries) =>
  entries.flatMap((entry) =>
    normalizeChanges(entry.changes)
      .filter((change) => TRACKED.includes(change.field))
      .map((change) => ({
        auditId: String(entry._id),
        employeeId: entry.entityId ? String(entry.entityId) : null,
        employeeLabel: entry.entityLabel ?? null,
        field: change.field,
        label: MOVEMENT_FIELDS[change.field].label,
        type: MOVEMENT_FIELDS[change.field].type,
        fromId: extractId(change.from),
        toId: extractId(change.to),
        // A JSON-shaped entry already carries the name it had at the time,
        // which is better than today's name if the record was since renamed.
        fromName: extractName(change.from),
        toName: extractName(change.to),
        occurredAt: entry.occurredAt,
        actorEmail: entry.actorEmail ?? null,
        actorRole: entry.actorRole ?? null,
      }))
      /**
       * Compared AFTER the ids are extracted, not before.
       *
       * A legacy entry holds the id on one side and a JSON sub-document on the
       * other, so the raw strings differ even when nothing moved. Comparing
       * them as written reported phantom transfers -- "Engineering to
       * Engineering" -- for every save that merely touched the record.
       */
      .filter((movement) => String(movement.fromId ?? '') !== String(movement.toId ?? '')),
  );

/** Attaches resolved names and the transfer/promotion classification. */
const decorate = async (movements) => {
  const lookup = await buildLookup(movements);

  return Promise.all(
    movements.map(async (movement) => {
      const names = lookup[movement.field] ?? new Map();

      const kind =
        MOVEMENT_FIELDS[movement.field].kind === 'EITHER'
          ? await classifyDesignation(movement.fromId, movement.toId)
          : MOVEMENT_FIELDS[movement.field].kind;

      // Current name first, then the one the entry recorded, then the raw id.
      const resolve = (id, recorded) => {
        if (!id) return null;
        return names.get(id) ?? recorded ?? id;
      };

      const from = resolve(movement.fromId, movement.fromName);
      const to = resolve(movement.toId, movement.toName);

      return {
        ...movement,
        kind,
        from,
        to,
        // True when a side could only be reported as a raw id -- usually a
        // legacy byte-level entry, or a master that has since been deleted.
        // The screen says so rather than showing something that looks like a name.
        unresolved:
          Boolean(movement.fromId && from === movement.fromId && HEX.test(movement.fromId)) ||
          Boolean(movement.toId && to === movement.toId && HEX.test(movement.toId)),
      };
    }),
  );
};

const KIND_FILTER = {
  transfer: (movement) => movement.kind === 'TRANSFER',
  promotion: (movement) => movement.kind === 'PROMOTION',
  all: () => true,
};

/**
 * Movement history for one employee.
 *
 * Paginated after decoration rather than in the query: one audit entry can
 * carry several moved fields, so the row count is not known until the entries
 * have been flattened.
 */
export const getEmployeeMovements = async (employeeId, { type = 'all', page = 1, limit = 25 } = {}, req) => {
  const employee = await Employee.findOne({ _id: employeeId, tenantId: req.user?.tenantId ?? null })
    .select('employeeCode employeeId firstName lastName unitId departmentId designationId gradeId reportingManagerId')
    .lean();

  if (!employee) throw ApiError.notFound('Employee not found');

  const entries = await AuditLog.find({
    entity: 'Employee',
    entityId: employeeId,
    action: { $in: [AUDIT_ACTIONS.UPDATE, AUDIT_ACTIONS.CREATE] },
  })
    .sort({ occurredAt: -1 })
    .lean();

  const decorated = await decorate(toMovements(entries));
  const filtered = decorated.filter(KIND_FILTER[type] ?? KIND_FILTER.all);

  const { skip } = buildPagination({ page, limit });

  return {
    items: filtered.slice(skip, skip + limit),
    total: filtered.length,
    page,
    limit,
  };
};

/**
 * Movements across the organisation, for the module list screens.
 *
 * Bounded by a date window rather than scanning the whole trail: the audit
 * collection grows without limit, and a query with no ceiling would get slower
 * every month it is left running.
 */
export const listMovements = async ({ type = 'all', from, to, page = 1, limit = 25 } = {}, req) => {
  const filter = {
    tenantId: req.user?.tenantId ?? null,
    entity: 'Employee',
    action: AUDIT_ACTIONS.UPDATE,
  };

  if (from || to) {
    filter.occurredAt = {};
    if (from) filter.occurredAt.$gte = new Date(from);
    if (to) filter.occurredAt.$lte = new Date(to);
  }

  const entries = await AuditLog.find(filter)
    .sort({ occurredAt: -1 })
    // A generous ceiling on the audit rows read, so a long-lived trail cannot
    // turn this into an unbounded scan.
    .limit(5000)
    .lean();

  const decorated = await decorate(toMovements(entries));
  const filtered = decorated.filter(KIND_FILTER[type] ?? KIND_FILTER.all);

  const { skip } = buildPagination({ page, limit });

  return {
    items: filtered.slice(skip, skip + limit),
    total: filtered.length,
    page,
    limit,
  };
};

export default { getEmployeeMovements, listMovements, MOVEMENT_FIELDS };
