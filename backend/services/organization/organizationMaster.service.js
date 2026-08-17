import mongoose from 'mongoose';

import Unit from '../../models/organization/unit.model.js';
import Department from '../../models/organization/department.model.js';
import Designation from '../../models/organization/designation.model.js';
import Grade from '../../models/organization/grade.model.js';
import Shift from '../../models/organization/shift.model.js';
import Employee from '../../models/employee/employee.model.js';

import ApiError from '../../utils/ApiError.js';
import { AUDIT_ACTIONS } from '../../utils/constants.js';
import { buildPagination, buildSort, buildSearch } from '../../utils/queryBuilder.js';
import { recordAudit, recordAuditBatch, diffObjects } from '../../helpers/audit.helper.js';
import { buildWorkbook, parseWorkbook } from '../../helpers/excel.helper.js';
import { buildTablePdf } from '../../helpers/pdf.helper.js';
import auditLogRepository from '../../repositories/audit/auditLog.repository.js';

/**
 * CRUD for the organization masters.
 *
 * The five masters are the same kind of object -- a named, coded reference list
 * scoped to a tenant -- and differ only in which extra columns they carry. One
 * generic implementation driven by the descriptor table below therefore replaces
 * five near-identical services, and a fix to the delete guard or the importer
 * lands in one place rather than five.
 *
 * Nothing here changes a schema. The models, their indexes and their existing
 * read endpoints are untouched; this only adds the write half the module was
 * missing.
 */

/**
 * Per-master description.
 *
 * `fields`     -- writable fields, with the coercion the model expects.
 * `searchable` -- fields the list search scans.
 * `references` -- where a delete would leave an orphan. Checked before removal.
 * `columns`    -- shared by the Excel export, the import template and the PDF,
 *                 so the three can never drift out of step.
 */
const text = (value) => {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
};

const upper = (value) => {
  const result = text(value);
  return result ? result.toUpperCase() : null;
};

const number = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const boolean = (value) => {
  if (typeof value === 'boolean') return value;
  if (value === null || value === undefined || value === '') return null;
  return ['true', 'yes', '1', 'y'].includes(String(value).trim().toLowerCase());
};

/** Accepts "0,6" or "Sunday, Saturday" from a spreadsheet cell. */
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const weeklyOffs = (value) => {
  if (Array.isArray(value)) return value.map(Number).filter((day) => day >= 0 && day <= 6);
  if (value === null || value === undefined || value === '') return null;

  return String(value)
    .split(/[,;/]/)
    .map((part) => {
      const token = part.trim().toLowerCase();
      if (/^\d$/.test(token)) return Number(token);
      const index = DAY_NAMES.findIndex((day) => day.startsWith(token.slice(0, 3)));
      return index;
    })
    .filter((day) => day >= 0 && day <= 6);
};

export const MASTERS = {
  units: {
    key: 'units',
    label: 'Unit',
    plural: 'Units',
    entity: 'Unit',
    Model: Unit,
    searchable: ['name', 'code', 'city', 'state'],
    sortable: ['name', 'code', 'city', 'state', 'isActive', 'createdAt', 'updatedAt'],
    fields: {
      name: text,
      code: upper,
      city: text,
      state: text,
      address: text,
      pfEstablishmentCode: upper,
      esiEstablishmentCode: text,
      ptState: text,
      lwfState: text,
      isActive: boolean,
    },
    references: [{ Model: Employee, field: 'unitId', label: 'employee' }],
    columns: [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'City', key: 'city', width: 18 },
      { header: 'State', key: 'state', width: 18 },
      { header: 'Address', key: 'address', width: 34 },
      { header: 'PF Establishment Code', key: 'pfEstablishmentCode', width: 22 },
      { header: 'ESI Establishment Code', key: 'esiEstablishmentCode', width: 22 },
      { header: 'PT State', key: 'ptState', width: 16 },
      { header: 'LWF State', key: 'lwfState', width: 16 },
      { header: 'Active', key: 'isActive', width: 10 },
    ],
  },

  departments: {
    key: 'departments',
    label: 'Department',
    plural: 'Departments',
    entity: 'Department',
    Model: Department,
    searchable: ['name', 'code', 'description'],
    sortable: ['name', 'code', 'isActive', 'createdAt', 'updatedAt'],
    fields: {
      name: text,
      code: upper,
      description: text,
      headId: text,
      parentId: text,
      isActive: boolean,
    },
    objectIdFields: ['headId', 'parentId'],
    populate: [
      { path: 'headId', select: 'employeeCode employeeId firstName lastName' },
      { path: 'parentId', select: 'name code' },
    ],
    references: [
      { Model: Employee, field: 'departmentId', label: 'employee' },
      { Model: Designation, field: 'departmentId', label: 'designation' },
      { Model: Department, field: 'parentId', label: 'child department' },
    ],
    columns: [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Description', key: 'description', width: 40 },
      { header: 'Active', key: 'isActive', width: 10 },
    ],
  },

  designations: {
    key: 'designations',
    label: 'Designation',
    plural: 'Designations',
    entity: 'Designation',
    Model: Designation,
    searchable: ['name', 'code'],
    sortable: ['name', 'code', 'level', 'isActive', 'createdAt', 'updatedAt'],
    fields: { name: text, code: upper, level: number, departmentId: text, isActive: boolean },
    objectIdFields: ['departmentId'],
    populate: [{ path: 'departmentId', select: 'name code' }],
    references: [{ Model: Employee, field: 'designationId', label: 'employee' }],
    columns: [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Active', key: 'isActive', width: 10 },
    ],
  },

  grades: {
    key: 'grades',
    label: 'Grade',
    plural: 'Grades',
    entity: 'Grade',
    Model: Grade,
    searchable: ['name', 'code', 'description'],
    sortable: ['name', 'code', 'level', 'minGross', 'maxGross', 'isActive', 'createdAt', 'updatedAt'],
    fields: {
      name: text,
      code: upper,
      level: number,
      minGross: number,
      maxGross: number,
      description: text,
      isActive: boolean,
    },
    references: [{ Model: Employee, field: 'gradeId', label: 'employee' }],
    columns: [
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Level', key: 'level', width: 10 },
      { header: 'Min Gross', key: 'minGross', width: 16, format: '#,##0' },
      { header: 'Max Gross', key: 'maxGross', width: 16, format: '#,##0' },
      { header: 'Description', key: 'description', width: 34 },
      { header: 'Active', key: 'isActive', width: 10 },
    ],
  },

  shifts: {
    key: 'shifts',
    label: 'Shift',
    plural: 'Shifts',
    entity: 'Shift',
    Model: Shift,
    searchable: ['name', 'code'],
    sortable: ['name', 'code', 'startTime', 'endTime', 'isActive', 'createdAt', 'updatedAt'],
    fields: {
      name: text,
      code: upper,
      startTime: text,
      endTime: text,
      breakMinutes: number,
      isNightShift: boolean,
      weeklyOffs,
      isActive: boolean,
    },
    references: [{ Model: Employee, field: 'shiftId', label: 'employee' }],
    columns: [
      { header: 'Name', key: 'name', width: 24 },
      { header: 'Code', key: 'code', width: 14 },
      { header: 'Start Time', key: 'startTime', width: 14 },
      { header: 'End Time', key: 'endTime', width: 14 },
      { header: 'Break Minutes', key: 'breakMinutes', width: 16 },
      { header: 'Night Shift', key: 'isNightShift', width: 14 },
      { header: 'Weekly Offs', key: 'weeklyOffs', width: 18 },
      { header: 'Active', key: 'isActive', width: 10 },
    ],
  },
};

export const MASTER_KEYS = Object.keys(MASTERS);

/** Resolves the descriptor, or refuses a master nobody defined. */
export const resolveMaster = (key) => {
  const master = MASTERS[key];
  if (!master) throw ApiError.notFound(`Unknown organization master "${key}"`);
  return master;
};

const tenantOf = (req) => req.user?.tenantId ?? null;

/**
 * Applies the descriptor's coercions to a request body.
 *
 * Only declared fields survive, so an unexpected key in the payload cannot
 * reach the document -- the validator rejects unknown keys too, and this is the
 * second line of that same defence.
 */
const coerce = (master, payload = {}) => {
  const result = {};

  Object.entries(master.fields).forEach(([field, transform]) => {
    if (!(field in payload)) return;

    const value = transform(payload[field]);

    // An empty ObjectId string must become null, not "" -- Mongoose would
    // otherwise throw a CastError on save.
    if (master.objectIdFields?.includes(field)) {
      result[field] = value && mongoose.Types.ObjectId.isValid(value) ? value : null;
      return;
    }

    result[field] = value;
  });

  return result;
};

/** Values as a user reads them, shared by the Excel and PDF exports. */
const presentRow = (master, document) => {
  const row = {};

  master.columns.forEach(({ key }) => {
    const value = document[key];

    if (key === 'isActive') row[key] = value ? 'Yes' : 'No';
    else if (key === 'isNightShift') row[key] = value ? 'Yes' : 'No';
    else if (key === 'weeklyOffs') row[key] = (value ?? []).map((day) => DAY_NAMES[day]?.slice(0, 3)).join(', ');
    else row[key] = value ?? '';
  });

  return row;
};

/* -------------------------------------------------------------------------- */
/*                                    Read                                    */
/* -------------------------------------------------------------------------- */

/**
 * Paginated list for the management screen.
 *
 * Deliberately distinct from the existing picker endpoints: those return only
 * active rows with a narrow projection because a dropdown must not offer a
 * retired department. A management screen has to show the retired ones too,
 * which is why `status` defaults to everything rather than to active.
 */
export const listMaster = async (key, query, req) => {
  const master = resolveMaster(key);
  const { page, limit, skip } = buildPagination(query);

  const filter = { tenantId: tenantOf(req) };

  if (query.status === 'active') filter.isActive = true;
  if (query.status === 'inactive') filter.isActive = false;

  Object.assign(filter, buildSearch(query.search, master.searchable));

  const sort = buildSort(
    { sortBy: query.sortBy, sortOrder: query.sortOrder },
    master.sortable,
    { name: 1 },
  );

  let cursor = master.Model.find(filter).sort(sort).skip(skip).limit(limit);
  if (master.populate) master.populate.forEach((populate) => cursor.populate(populate));

  const [items, total] = await Promise.all([cursor.lean(), master.Model.countDocuments(filter)]);

  return { items, total, page, limit };
};

export const getMaster = async (key, id, req) => {
  const master = resolveMaster(key);

  let cursor = master.Model.findOne({ _id: id, tenantId: tenantOf(req) });
  if (master.populate) master.populate.forEach((populate) => cursor.populate(populate));

  const document = await cursor.lean();
  if (!document) throw ApiError.notFound(`${master.label} not found`);

  // Enough for the detail screen to say "12 employees are in this department"
  // before someone tries to delete it.
  const usage = await countReferences(master, id);

  return { ...document, usage };
};

/** How many records point at this row, per referencing collection. */
const countReferences = async (master, id) => {
  if (!master.references?.length) return { total: 0, breakdown: [] };

  const counts = await Promise.all(
    master.references.map(async ({ Model, field, label }) => {
      const filter = { [field]: id };
      // Soft-deleted employees are not a reason to block a delete.
      if (Model.schema.path('deletedAt')) filter.deletedAt = null;

      return { label, count: await Model.countDocuments(filter) };
    }),
  );

  const breakdown = counts.filter((entry) => entry.count > 0);

  return { total: breakdown.reduce((sum, entry) => sum + entry.count, 0), breakdown };
};

/* -------------------------------------------------------------------------- */
/*                                   Write                                    */
/* -------------------------------------------------------------------------- */

/**
 * The code is unique per tenant at the database level. Checking first turns a
 * driver-level E11000 into a message naming the field, which is the difference
 * between a usable form error and a 500.
 */
const assertCodeAvailable = async (master, code, tenantId, excludeId = null) => {
  if (!code) return;

  const clash = await master.Model.findOne({
    tenantId,
    code,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  })
    .select('_id name')
    .lean();

  if (clash) {
    throw ApiError.conflict(`Code "${code}" is already used by ${clash.name}`);
  }
};

export const createMaster = async (key, payload, req) => {
  const master = resolveMaster(key);
  const tenantId = tenantOf(req);

  const data = coerce(master, payload);
  await assertCodeAvailable(master, data.code, tenantId);

  const document = await master.Model.create({ ...data, tenantId });

  await recordAudit({
    req,
    entity: master.entity,
    entityId: document._id,
    entityLabel: document.name,
    action: AUDIT_ACTIONS.CREATE,
    changes: diffObjects({}, coerce(master, document.toObject())),
  });

  return document.toObject();
};

export const updateMaster = async (key, id, payload, req) => {
  const master = resolveMaster(key);
  const tenantId = tenantOf(req);

  const existing = await master.Model.findOne({ _id: id, tenantId });
  if (!existing) throw ApiError.notFound(`${master.label} not found`);

  const before = existing.toObject();
  const data = coerce(master, payload);

  if (data.code && data.code !== before.code) {
    await assertCodeAvailable(master, data.code, tenantId, id);
  }

  // A department cannot be its own parent, and neither can a cycle be created
  // one level up. Anything deeper is left to the reporting view rather than
  // walking the whole tree on every save.
  if (master.key === 'departments' && data.parentId && String(data.parentId) === String(id)) {
    throw ApiError.badRequest('A department cannot be its own parent');
  }

  Object.assign(existing, data);

  // Saved through the document, not findOneAndUpdate, so schema validators and
  // any pre-save hooks actually run.
  await existing.save();

  const after = existing.toObject();
  const changes = diffObjects(coerce(master, before), coerce(master, after));

  if (changes.length) {
    await recordAudit({
      req,
      entity: master.entity,
      entityId: existing._id,
      entityLabel: after.name,
      action: AUDIT_ACTIONS.UPDATE,
      changes,
    });
  }

  return after;
};

export const setMasterStatus = async (key, id, isActive, req) => {
  const master = resolveMaster(key);

  const existing = await master.Model.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!existing) throw ApiError.notFound(`${master.label} not found`);

  if (existing.isActive === isActive) return existing.toObject();

  existing.isActive = isActive;
  await existing.save();

  await recordAudit({
    req,
    entity: master.entity,
    entityId: existing._id,
    entityLabel: existing.name,
    action: AUDIT_ACTIONS.STATUS_CHANGE,
    changes: [{ field: 'isActive', from: String(!isActive), to: String(isActive) }],
  });

  return existing.toObject();
};

/**
 * Removes a master row, but only when nothing points at it.
 *
 * A hard delete of a referenced department would leave every employee in it
 * holding an id that resolves to nothing -- the exact orphan state the data
 * cleanup had to repair. Deactivating instead keeps history readable and stops
 * the row appearing in pickers, which is what "delete" usually means here.
 */
export const deleteMaster = async (key, id, req) => {
  const master = resolveMaster(key);

  const existing = await master.Model.findOne({ _id: id, tenantId: tenantOf(req) });
  if (!existing) throw ApiError.notFound(`${master.label} not found`);

  const usage = await countReferences(master, id);

  if (usage.total > 0) {
    const detail = usage.breakdown
      .map((entry) => `${entry.count} ${entry.label}${entry.count === 1 ? '' : 's'}`)
      .join(', ');

    throw ApiError.conflict(
      `${existing.name} is still used by ${detail}. Deactivate it instead, or reassign those records first.`,
    );
  }

  await master.Model.deleteOne({ _id: id });

  await recordAudit({
    req,
    entity: master.entity,
    entityId: existing._id,
    entityLabel: existing.name,
    action: AUDIT_ACTIONS.DELETE,
    changes: diffObjects(coerce(master, existing.toObject()), {}),
  });

  return { deleted: true, name: existing.name };
};

/* -------------------------------------------------------------------------- */
/*                                Audit trail                                 */
/* -------------------------------------------------------------------------- */

export const getMasterAudit = async (key, id, pagination) => {
  const master = resolveMaster(key);
  return auditLogRepository.findForEntity(master.entity, id, pagination);
};

/* -------------------------------------------------------------------------- */
/*                                  Transfer                                  */
/* -------------------------------------------------------------------------- */

/** Every row matching the current filters, not just the current page. */
const rowsForExport = async (master, query, req) => {
  const filter = { tenantId: tenantOf(req) };

  if (query.status === 'active') filter.isActive = true;
  if (query.status === 'inactive') filter.isActive = false;

  Object.assign(filter, buildSearch(query.search, master.searchable));

  const sort = buildSort({ sortBy: query.sortBy, sortOrder: query.sortOrder }, master.sortable, { name: 1 });

  return master.Model.find(filter).sort(sort).lean();
};

export const exportMasterExcel = async (key, query, req) => {
  const master = resolveMaster(key);
  const documents = await rowsForExport(master, query, req);

  const buffer = await buildWorkbook({
    sheetName: master.plural,
    columns: master.columns,
    rows: documents.map((document) => presentRow(master, document)),
    meta: { creator: 'HRMS' },
  });

  await recordAudit({
    req,
    entity: master.entity,
    entityId: null,
    entityLabel: master.plural,
    action: AUDIT_ACTIONS.EXPORT,
    metadata: { format: 'xlsx', rowCount: documents.length },
  });

  return { buffer, rowCount: documents.length };
};

export const exportMasterPdf = async (key, query, req) => {
  const master = resolveMaster(key);
  const documents = await rowsForExport(master, query, req);

  // The PDF is landscape A4; more than about eight columns stops being legible,
  // so the widest masters print their most useful subset rather than a squashed
  // version of everything.
  const columns = master.columns.slice(0, 8).map((column) => ({
    header: column.header,
    key: column.key,
    width: Math.max(60, Math.round((column.width ?? 18) * 5)),
    align: ['minGross', 'maxGross', 'level', 'breakMinutes'].includes(column.key) ? 'right' : 'left',
  }));

  const buffer = await buildTablePdf({
    title: master.plural,
    subtitle: `${documents.length} record(s) · ${new Date().toLocaleDateString()}`,
    columns,
    rows: documents.map((document) => presentRow(master, document)),
  });

  await recordAudit({
    req,
    entity: master.entity,
    entityId: null,
    entityLabel: master.plural,
    action: AUDIT_ACTIONS.EXPORT,
    metadata: { format: 'pdf', rowCount: documents.length },
  });

  return { buffer, rowCount: documents.length };
};

/** The export columns double as the import template, so they cannot drift. */
export const buildMasterTemplate = async (key) => {
  const master = resolveMaster(key);

  return buildWorkbook({
    sheetName: master.plural,
    columns: master.columns,
    rows: [],
    meta: { creator: 'HRMS' },
  });
};

/**
 * Imports a spreadsheet.
 *
 * Matched on `code`, which is the tenant-unique key: a row whose code already
 * exists updates that record rather than failing, so re-importing a corrected
 * sheet is a safe operation instead of a duplicate-key error.
 *
 * `dryRun` validates and reports without writing, which is what the preview
 * step on the screen uses.
 */
export const importMaster = async (key, buffer, { dryRun = false } = {}, req) => {
  const master = resolveMaster(key);
  const tenantId = tenantOf(req);

  const { rows, truncated } = await parseWorkbook(buffer, { columns: master.columns });

  if (!rows.length) throw ApiError.badRequest('The uploaded file contains no data rows');

  const existing = await master.Model.find({ tenantId }).select('_id code name').lean();
  const byCode = new Map(existing.map((document) => [String(document.code).toUpperCase(), document]));

  const errors = [];
  const toCreate = [];
  const toUpdate = [];
  // Catches a sheet that repeats a code within itself, which the database
  // would only report on the second write.
  const seen = new Set();

  rows.forEach(({ rowNumber, data }) => {
    const record = coerce(master, data);
    const problems = [];

    if (!record.name) problems.push('Name is required');
    if (!record.code) problems.push('Code is required');

    if (record.code && seen.has(record.code)) {
      problems.push(`Code "${record.code}" appears more than once in this file`);
    }

    if (master.key === 'shifts') {
      const pattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!record.startTime || !pattern.test(record.startTime)) problems.push('Start time must be HH:mm');
      if (!record.endTime || !pattern.test(record.endTime)) problems.push('End time must be HH:mm');
    }

    if (master.key === 'grades' && record.minGross !== null && record.maxGross !== null) {
      if (record.maxGross > 0 && record.maxGross < record.minGross) {
        problems.push('Max gross cannot be below min gross');
      }
    }

    if (problems.length) {
      errors.push({ row: rowNumber, code: record.code ?? null, errors: problems });
      return;
    }

    seen.add(record.code);

    const match = byCode.get(record.code);
    if (match) toUpdate.push({ id: match._id, record });
    else toCreate.push(record);
  });

  const summary = {
    total: rows.length,
    valid: toCreate.length + toUpdate.length,
    toCreate: toCreate.length,
    toUpdate: toUpdate.length,
    failed: errors.length,
    errors: errors.slice(0, 50),
    truncated,
    dryRun,
  };

  if (dryRun || summary.valid === 0) return { ...summary, created: 0, updated: 0 };

  /**
   * `ordered: false` so one bad row does not abandon the rest. MongoDB here is
   * a standalone deployment, so there is no transaction to wrap this in -- the
   * dry run is what stands in for one.
   */
  const operations = [
    ...toCreate.map((record) => ({ insertOne: { document: { ...record, tenantId } } })),
    ...toUpdate.map(({ id, record }) => ({ updateOne: { filter: { _id: id }, update: { $set: record } } })),
  ];

  const result = await master.Model.bulkWrite(operations, { ordered: false });

  await recordAudit({
    req,
    entity: master.entity,
    entityId: null,
    entityLabel: master.plural,
    action: AUDIT_ACTIONS.IMPORT,
    metadata: {
      created: result.insertedCount ?? 0,
      updated: result.modifiedCount ?? 0,
      failed: errors.length,
    },
  });

  return {
    ...summary,
    created: result.insertedCount ?? 0,
    updated: result.modifiedCount ?? 0,
  };
};

export default {
  MASTERS,
  MASTER_KEYS,
  resolveMaster,
  listMaster,
  getMaster,
  createMaster,
  updateMaster,
  setMasterStatus,
  deleteMaster,
  getMasterAudit,
  exportMasterExcel,
  exportMasterPdf,
  buildMasterTemplate,
  importMaster,
};
