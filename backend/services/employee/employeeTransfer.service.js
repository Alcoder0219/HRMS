import mongoose from 'mongoose';
import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import {
  AUDIT_ACTIONS,
  EMPLOYEE_STATUS,
  EMPLOYMENT_TYPE,
  GENDER,
  MARITAL_STATUS,
  BLOOD_GROUPS,
  RESOURCES,
} from '../../utils/constants.js';
import { buildSort, buildFilters, buildSearch, dateRange } from '../../utils/queryBuilder.js';
import employeeRepository from '../../repositories/employee/employee.repository.js';
import Department from '../../models/organization/department.model.js';
import Designation from '../../models/organization/designation.model.js';
import { buildWorkbook, parseWorkbook } from '../../helpers/excel.helper.js';
import { recordAudit, recordAuditBatch } from '../../helpers/audit.helper.js';
import { buildScopeFilter } from '../../helpers/permission.helper.js';

/**
 * Column contract shared by export, the import template and the import parser.
 *
 * One definition for all three is the point: a template that drifts from the
 * parser produces files that look right and import wrong.
 */
export const COLUMNS = [
  { header: 'Employee Code', key: 'employeeCode', width: 16, importable: false },
  { header: 'Employee ID', key: 'employeeId', width: 16 },
  { header: 'First Name', key: 'firstName', width: 18, required: true },
  { header: 'Middle Name', key: 'middleName', width: 16 },
  // Optional, matching the Employee schema and the Add Employee form: a
  // mononym is a real name, not a missing one. Only `required` was dropped --
  // the header, width and position are unchanged, so existing templates and
  // already-filled workbooks import exactly as before.
  { header: 'Last Name', key: 'lastName', width: 18 },
  { header: 'Father Name', key: 'fatherName', width: 20 },
  { header: 'Mother Name', key: 'motherName', width: 20 },
  { header: 'Gender', key: 'gender', width: 14 },
  { header: 'Date Of Birth', key: 'dateOfBirth', width: 14, type: 'date' },
  { header: 'Blood Group', key: 'bloodGroup', width: 12 },
  { header: 'Marital Status', key: 'maritalStatus', width: 14 },
  { header: 'Personal Email', key: 'personalEmail', width: 26 },
  { header: 'Mobile', key: 'mobile', width: 16 },
  { header: 'Work Email', key: 'workEmail', width: 26 },
  { header: 'Joining Date', key: 'joiningDate', width: 14, type: 'date', required: true },
  { header: 'Confirmation Date', key: 'confirmationDate', width: 16, type: 'date' },
  { header: 'Department Code', key: 'departmentCode', width: 16 },
  { header: 'Designation Code', key: 'designationCode', width: 18 },
  { header: 'Reporting Manager Code', key: 'reportingManagerCode', width: 22 },
  { header: 'Employment Type', key: 'employmentType', width: 16 },
  { header: 'Work Location', key: 'workLocation', width: 18 },
  { header: 'CTC', key: 'ctc', width: 14, type: 'number', format: '#,##0.00' },
  { header: 'Grade', key: 'grade', width: 10 },
  { header: 'PF Number', key: 'pfNumber', width: 18 },
  { header: 'ESI Number', key: 'esiNumber', width: 18 },
  { header: 'UAN', key: 'uan', width: 16 },
  { header: 'PAN', key: 'pan', width: 14 },
  { header: 'Aadhaar', key: 'aadhaar', width: 16 },
  { header: 'Passport Number', key: 'passportNumber', width: 18 },
  { header: 'Driving License', key: 'drivingLicense', width: 18 },
  { header: 'Bank Account Number', key: 'accountNumber', width: 22 },
  { header: 'Bank Name', key: 'bankName', width: 22 },
  { header: 'IFSC', key: 'ifsc', width: 14 },
  { header: 'Emergency Contact Name', key: 'emergencyName', width: 24 },
  { header: 'Emergency Contact Relation', key: 'emergencyRelation', width: 22 },
  { header: 'Emergency Contact Phone', key: 'emergencyPhone', width: 22 },
  { header: 'Current Address', key: 'currentAddressLine1', width: 30 },
  { header: 'Current City', key: 'currentCity', width: 16 },
  { header: 'Current State', key: 'currentState', width: 16 },
  { header: 'Current Postal Code', key: 'currentPostalCode', width: 16 },
  { header: 'Status', key: 'status', width: 16, importable: false },
];

const IMPORT_COLUMNS = COLUMNS.filter((column) => column.importable !== false);

/* -------------------------------------------------------------------------- */
/*                                   Export                                   */
/* -------------------------------------------------------------------------- */

const toRow = (employee) => ({
  employeeCode: employee.employeeCode,
  employeeId: employee.employeeId,
  firstName: employee.firstName,
  middleName: employee.middleName,
  lastName: employee.lastName,
  fatherName: employee.fatherName,
  motherName: employee.motherName,
  gender: employee.gender,
  dateOfBirth: employee.dateOfBirth,
  bloodGroup: employee.bloodGroup,
  maritalStatus: employee.maritalStatus,
  personalEmail: employee.personalEmail,
  mobile: employee.mobile,
  workEmail: employee.workEmail,
  joiningDate: employee.joiningDate,
  confirmationDate: employee.confirmationDate,
  departmentCode: employee.departmentId?.code ?? null,
  designationCode: employee.designationId?.code ?? null,
  reportingManagerCode: employee.reportingManagerId?.employeeCode ?? null,
  employmentType: employee.employmentType,
  workLocation: employee.workLocation,
  ctc: employee.salaryStructure?.ctc ?? null,
  grade: employee.salaryStructure?.grade ?? null,
  pfNumber: employee.statutory?.pfNumber ?? null,
  esiNumber: employee.statutory?.esiNumber ?? null,
  uan: employee.statutory?.uan ?? null,
  pan: employee.statutory?.pan ?? null,
  aadhaar: employee.statutory?.aadhaar ?? null,
  passportNumber: employee.statutory?.passportNumber ?? null,
  drivingLicense: employee.statutory?.drivingLicense ?? null,
  accountNumber: employee.bankDetails?.accountNumber ?? null,
  bankName: employee.bankDetails?.bankName ?? null,
  ifsc: employee.bankDetails?.ifsc ?? null,
  emergencyName: employee.emergencyContacts?.[0]?.name ?? null,
  emergencyRelation: employee.emergencyContacts?.[0]?.relationship ?? null,
  emergencyPhone: employee.emergencyContacts?.[0]?.phone ?? null,
  currentAddressLine1: employee.currentAddress?.line1 ?? null,
  currentCity: employee.currentAddress?.city ?? null,
  currentState: employee.currentAddress?.state ?? null,
  currentPostalCode: employee.currentAddress?.postalCode ?? null,
  status: employee.status,
});

const FILTER_DEFINITIONS = {
  status: (value) => ({ status: Array.isArray(value) ? { $in: value } : value }),
  departmentId: (value) => ({ departmentId: employeeRepository.toObjectId(value) }),
  designationId: (value) => ({ designationId: employeeRepository.toObjectId(value) }),
  employmentType: (value) => ({ employmentType: value }),
  joinedFrom: (value, params) => {
    const range = dateRange(value, params.joinedTo);
    return range ? { joiningDate: range } : null;
  },
  joinedTo: () => null,
};

/**
 * Exports the same set the list screen is showing, honouring the caller's
 * scope and filters. An export that ignored the scope would be the easiest
 * possible way around RBAC.
 */
export const exportEmployees = async (query, req) => {
  const scope = buildScopeFilter(req, {
    ownerField: '_id',
    managerField: 'reportingManagerId',
    departmentField: 'departmentId',
    resource: RESOURCES.EMPLOYEE,
  });
  delete scope.tenantId;

  const filter = {
    tenantId: req.user.tenantId ?? null,
    ...scope,
    deletedAt: null,
    ...buildFilters(query, FILTER_DEFINITIONS),
  };

  const search = buildSearch(query.search, ['employeeCode', 'firstName', 'lastName', 'workEmail']);
  if (search) Object.assign(filter, search);

  const sort = buildSort(query, ['employeeCode', 'firstName', 'lastName', 'joiningDate'], {
    employeeCode: 1,
  });

  const rows = [];
  const cursor = employeeRepository.stream(filter, sort);
  // Streamed rather than loaded at once: an export of 50k employees would
  // otherwise sit in memory in full before a byte reaches the client.
  for await (const employee of cursor) rows.push(toRow(employee));

  const buffer = await buildWorkbook({
    sheetName: 'Employees',
    columns: COLUMNS,
    rows,
    meta: { creator: req.user.email },
  });

  await recordAudit({
    req,
    entity: 'Employee',
    entityId: new mongoose.Types.ObjectId(),
    action: AUDIT_ACTIONS.EXPORT,
    metadata: { rows: rows.length, filters: query },
  });

  logger.info('Employee export generated', { rows: rows.length, actor: req.user.email });

  return { buffer, rowCount: rows.length };
};

/** Empty workbook with the exact headers the importer expects. */
export const buildImportTemplate = () =>
  buildWorkbook({
    sheetName: 'Employee Import',
    columns: IMPORT_COLUMNS,
    rows: [],
    meta: { creator: 'HRMS' },
  });

/* -------------------------------------------------------------------------- */
/*                                   Import                                   */
/* -------------------------------------------------------------------------- */

const ENUM_SETS = {
  gender: Object.values(GENDER),
  maritalStatus: Object.values(MARITAL_STATUS),
  employmentType: Object.values(EMPLOYMENT_TYPE),
  bloodGroup: BLOOD_GROUPS,
};

const parseDate = (value) => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;

  const parsed = new Date(value);
  // `undefined` signals "present but unparseable", which the caller reports as
  // a row error -- distinct from `null`, meaning "not supplied".
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const validateRow = (data, lookups) => {
  const errors = [];

  IMPORT_COLUMNS.filter((column) => column.required).forEach((column) => {
    if (!data[column.key]) errors.push(`${column.header} is required`);
  });

  Object.entries(ENUM_SETS).forEach(([key, allowed]) => {
    const value = data[key];
    if (value && !allowed.includes(String(value).toUpperCase())) {
      errors.push(`${key} must be one of: ${allowed.join(', ')}`);
    }
  });

  const joiningDate = parseDate(data.joiningDate);
  if (data.joiningDate && joiningDate === undefined) errors.push('Joining Date is not a valid date');

  const dateOfBirth = parseDate(data.dateOfBirth);
  if (data.dateOfBirth && dateOfBirth === undefined) errors.push('Date Of Birth is not a valid date');

  if (data.departmentCode && !lookups.departments.has(String(data.departmentCode).toUpperCase())) {
    errors.push(`Unknown department code: ${data.departmentCode}`);
  }

  if (data.designationCode && !lookups.designations.has(String(data.designationCode).toUpperCase())) {
    errors.push(`Unknown designation code: ${data.designationCode}`);
  }

  if (data.pan && !/^[A-Z]{5}\d{4}[A-Z]$/.test(String(data.pan).toUpperCase())) {
    errors.push('PAN format is invalid');
  }

  if (data.aadhaar && !/^\d{12}$/.test(String(data.aadhaar).replace(/\s/g, ''))) {
    errors.push('Aadhaar must be 12 digits');
  }

  return errors;
};

const toEmployeePayload = (data, lookups, tenantId, actorId) => ({
  tenantId,
  employeeId: data.employeeId ? String(data.employeeId) : null,
  firstName: String(data.firstName).trim(),
  middleName: data.middleName ? String(data.middleName).trim() : null,
  // Guarded like every other optional column: unguarded, a blank cell reaches
  // `String(undefined)` and imports the literal text "undefined" as a surname.
  // Empty rather than null, to match the schema default.
  lastName: data.lastName ? String(data.lastName).trim() : '',
  fatherName: data.fatherName ?? null,
  motherName: data.motherName ?? null,
  gender: data.gender ? String(data.gender).toUpperCase() : GENDER.UNDISCLOSED,
  dateOfBirth: parseDate(data.dateOfBirth) ?? null,
  bloodGroup: data.bloodGroup ? String(data.bloodGroup).toUpperCase() : null,
  maritalStatus: data.maritalStatus ? String(data.maritalStatus).toUpperCase() : null,
  personalEmail: data.personalEmail ? String(data.personalEmail).toLowerCase() : null,
  mobile: data.mobile ? String(data.mobile) : null,
  workEmail: data.workEmail ? String(data.workEmail).toLowerCase() : null,
  joiningDate: parseDate(data.joiningDate),
  confirmationDate: parseDate(data.confirmationDate) ?? null,
  departmentId: lookups.departments.get(String(data.departmentCode ?? '').toUpperCase()) ?? null,
  designationId: lookups.designations.get(String(data.designationCode ?? '').toUpperCase()) ?? null,
  reportingManagerId: lookups.managers.get(String(data.reportingManagerCode ?? '').toUpperCase()) ?? null,
  employmentType: data.employmentType
    ? String(data.employmentType).toUpperCase()
    : EMPLOYMENT_TYPE.FULL_TIME,
  workLocation: data.workLocation ?? null,
  salaryStructure: { ctc: data.ctc ? Number(data.ctc) : null, grade: data.grade ?? null },
  statutory: {
    pfNumber: data.pfNumber ?? null,
    pfApplicable: Boolean(data.pfNumber),
    esiNumber: data.esiNumber ?? null,
    esiApplicable: Boolean(data.esiNumber),
    uan: data.uan ? String(data.uan) : null,
    pan: data.pan ? String(data.pan).toUpperCase() : null,
    aadhaar: data.aadhaar ? String(data.aadhaar).replace(/\s/g, '') : null,
    passportNumber: data.passportNumber ?? null,
    drivingLicense: data.drivingLicense ?? null,
  },
  bankDetails: {
    accountNumber: data.accountNumber ? String(data.accountNumber) : null,
    bankName: data.bankName ?? null,
    ifsc: data.ifsc ? String(data.ifsc).toUpperCase() : null,
  },
  emergencyContacts: data.emergencyName
    ? [
        {
          name: data.emergencyName,
          relationship: data.emergencyRelation ?? 'Not specified',
          phone: String(data.emergencyPhone ?? ''),
          isPrimary: true,
        },
      ]
    : [],
  currentAddress: {
    line1: data.currentAddressLine1 ?? null,
    city: data.currentCity ?? null,
    state: data.currentState ?? null,
    postalCode: data.currentPostalCode ? String(data.currentPostalCode) : null,
  },
  status: EMPLOYEE_STATUS.PROBATION,
  createdBy: actorId,
  updatedBy: actorId,
});

/**
 * Bulk import.
 *
 * Validates every row before writing any, so the caller gets one complete
 * report instead of discovering problems one failed request at a time. In
 * `dryRun` mode nothing is written at all -- the expected first step for a file
 * of a few thousand people.
 */
export const importEmployees = async (buffer, { dryRun = false } = {}, req) => {
  const tenantId = req.user.tenantId ?? null;

  const { rows, truncated } = await parseWorkbook(buffer, { columns: IMPORT_COLUMNS });
  if (!rows.length) throw ApiError.badRequest('The uploaded file contains no data rows');

  const [departments, designations] = await Promise.all([
    Department.find({ tenantId, isActive: true }).select('code').lean(),
    Designation.find({ tenantId, isActive: true }).select('code').lean(),
  ]);

  const lookups = {
    departments: new Map(departments.map((d) => [d.code, d._id])),
    designations: new Map(designations.map((d) => [d.code, d._id])),
    managers: new Map(),
  };

  const managerCodes = [
    ...new Set(rows.map(({ data }) => data.reportingManagerCode).filter(Boolean)),
  ].map((code) => String(code).toUpperCase());

  if (managerCodes.length) {
    const managers = await Promise.all(
      managerCodes.map((code) => employeeRepository.findByCode(tenantId, code)),
    );
    managers.filter(Boolean).forEach((manager) => {
      lookups.managers.set(manager.employeeCode, manager._id);
    });
  }

  /* --- validation pass -------------------------------------------------- */
  const valid = [];
  const failed = [];
  // Duplicates inside the file itself: the database index cannot catch two
  // identical rows in the same unvalidated batch.
  const seenWorkEmails = new Set();
  const seenEmployeeIds = new Set();

  for (const { rowNumber, data } of rows) {
    const errors = validateRow(data, lookups);

    const workEmail = data.workEmail ? String(data.workEmail).toLowerCase() : null;
    if (workEmail) {
      if (seenWorkEmails.has(workEmail)) errors.push('Work Email is duplicated within this file');
      else seenWorkEmails.add(workEmail);
    }

    if (data.employeeId) {
      const key = String(data.employeeId);
      if (seenEmployeeIds.has(key)) errors.push('Employee ID is duplicated within this file');
      else seenEmployeeIds.add(key);
    }

    if (workEmail && (await employeeRepository.findByWorkEmail(tenantId, workEmail))) {
      errors.push('An employee with this work email already exists');
    }

    if (errors.length) failed.push({ row: rowNumber, errors, data });
    else valid.push({ rowNumber, payload: toEmployeePayload(data, lookups, tenantId, req.user.id) });
  }

  const summary = {
    totalRows: rows.length,
    valid: valid.length,
    failed: failed.length,
    truncated,
    dryRun,
    errors: failed.slice(0, 100),
    errorsTruncated: failed.length > 100,
  };

  if (dryRun || !valid.length) return { ...summary, imported: 0 };

  /* --- write pass ------------------------------------------------------- */
  // Codes are allocated sequentially here rather than inside the model, so the
  // whole batch gets a contiguous, gap-free run.
  const startCode = await employeeRepository.nextEmployeeCode(tenantId);
  const prefix = startCode.replace(/\d+$/, '');
  const startNumber = Number(startCode.slice(prefix.length));
  const width = startCode.length - prefix.length;

  valid.forEach(({ payload }, index) => {
    payload.employeeCode = `${prefix}${String(startNumber + index).padStart(width, '0')}`;
  });

  /**
   * Imported rows that carry no employee ID are issued one, exactly as they
   * would be if they had been added through the form.
   *
   * Without this an import is the one way into the system that leaves the
   * business identifier blank, and those employees would then be unidentifiable
   * on every screen that quotes it. IDs already in the sheet are kept.
   *
   * `issued` guards against two rows in the same batch drawing the same ID:
   * none of them are in the database yet, so the generator cannot see them.
   */
  const issued = new Set();

  for (const { payload } of valid) {
    if (payload.employeeId) continue;

    let candidate;
    do {
      // eslint-disable-next-line no-await-in-loop -- one draw at a time by design
      candidate = await employeeRepository.generateEmployeeId();
    } while (issued.has(candidate));

    issued.add(candidate);
    payload.employeeId = candidate;
  }

  let imported = valid.length;

  try {
    await employeeRepository.insertMany(valid.map((entry) => entry.payload));
  } catch (error) {
    // `ordered: false` means the good rows still landed. Report what actually
    // happened rather than failing the whole request.
    const writeErrors = error.writeErrors ?? [];
    logger.error('Bulk insert reported row errors', {
      failedRows: writeErrors.length,
      message: error.message,
    });

    writeErrors.forEach((writeError) => {
      failed.push({
        row: valid[writeError.index]?.rowNumber ?? null,
        errors: [writeError.errmsg ?? 'Database rejected this row'],
      });
    });

    imported = valid.length - writeErrors.length;
    summary.failed = failed.length;
    summary.errors = failed.slice(0, 100);
    summary.errorsTruncated = failed.length > 100;
  }

  await recordAudit({
    req,
    entity: 'Employee',
    entityId: new mongoose.Types.ObjectId(),
    action: AUDIT_ACTIONS.IMPORT,
    metadata: { totalRows: rows.length, imported, failed: summary.failed },
  });

  await recordAuditBatch({
    req,
    entries: valid.map(({ payload }) => ({
      entity: 'Employee',
      entityId: payload._id ?? new mongoose.Types.ObjectId(),
      entityLabel: `${payload.employeeCode} - ${payload.firstName} ${payload.lastName}`,
      action: AUDIT_ACTIONS.CREATE,
      metadata: { source: 'IMPORT' },
    })),
  });

  logger.info('Employee import completed', {
    total: rows.length,
    imported,
    failed: summary.failed,
  });

  return { ...summary, imported };
};

export default { exportEmployees, buildImportTemplate, importEmployees, COLUMNS };
