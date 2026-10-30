import ExcelJS from 'exceljs';
import mongoose from 'mongoose';

import logger from '../../config/logger.js';
import ApiError from '../../utils/ApiError.js';
import { ACTIONS, ASSET_CATEGORY, ASSET_CONDITION, AUDIT_ACTIONS, RESOURCES } from '../../utils/constants.js';
import Asset from '../../models/employee/asset.model.js';
import Employee from '../../models/employee/employee.model.js';
import { parseWorkbook } from '../../helpers/excel.helper.js';
import { recordAudit } from '../../helpers/audit.helper.js';
import { can } from '../../helpers/permission.helper.js';
import { createAssetSchema } from '../../validators/payroll/settlement.validator.js';
import assetService from './asset.service.js';

/**
 * Bulk import into the asset register.
 *
 * A thin layer over the single-asset path, not a second one: every row is
 * checked by the same validator as the Add asset form and written by the same
 * `createAsset` (code generation, recovery default, audit entry). A row that
 * names an employee is then issued through `assignAsset`, exactly as the Issue
 * button would -- so an imported asset is never ASSIGNED without the assignment
 * history, holder and audit trail the register depends on.
 *
 * Status is deliberately not a column. It is a consequence of the issue/return
 * cycle, and letting a spreadsheet set it would produce an ASSIGNED asset with
 * nobody holding it.
 */

const SHEET_NAME = 'Assets';
const MAX_ERRORS = 100;

/**
 * The column contract shared by the template and the parser. `key` is the
 * field name the asset API takes; `issueTo` and `issuedOn` feed the issue step.
 */
export const IMPORT_COLUMNS = [
  { header: 'Asset Code', key: 'assetCode', width: 16, help: 'Optional. Leave blank to generate the next AST code. Must be unique.' },
  { header: 'Name', key: 'name', width: 28, required: true, help: 'Required. 2 to 120 characters.' },
  { header: 'Category', key: 'category', width: 16, allowed: Object.values(ASSET_CATEGORY), help: 'Optional. Defaults to OTHER.' },
  { header: 'Serial Number', key: 'serialNumber', width: 22, help: 'Optional. Up to 60 characters. Must not already be in the register.' },
  { header: 'Make', key: 'make', width: 16, help: 'Optional. Up to 60 characters.' },
  { header: 'Model', key: 'model', width: 16, help: 'Optional. Up to 60 characters.' },
  { header: 'Purchase Date', key: 'purchaseDate', width: 16, type: 'date', help: 'Optional. A date, e.g. 2026-01-15.' },
  { header: 'Purchase Cost', key: 'purchaseCost', width: 16, type: 'number', help: 'Optional. A number, 0 or more.' },
  { header: 'Recovery Value', key: 'recoveryValue', width: 16, type: 'number', help: 'Optional. Charged on exit if not returned. Defaults to the purchase cost.' },
  { header: 'Condition', key: 'condition', width: 14, allowed: Object.values(ASSET_CONDITION), help: 'Optional. Defaults to NEW.' },
  { header: 'Notes', key: 'notes', width: 30, help: 'Optional. Up to 500 characters.' },
  { header: 'Issue To (Employee Code)', key: 'issueTo', width: 24, help: 'Optional. Employee Code or Employee ID of an existing employee. Leave blank to keep the asset in stock.' },
  { header: 'Issued On', key: 'issuedOn', width: 14, type: 'date', help: 'Optional, only with Issue To. Defaults to the import date.' },
];

const HEADER_BY_KEY = Object.fromEntries(IMPORT_COLUMNS.map((column) => [column.key, column.header]));

/** Shown on the Instructions sheet only -- never on the sheet that is imported. */
const SAMPLE_ROW = {
  assetCode: 'SAMPLE-001',
  name: 'Dell Latitude 5440 (sample)',
  category: 'LAPTOP',
  serialNumber: 'SN-SAMPLE-123',
  make: 'Dell',
  model: 'Latitude 5440',
  purchaseDate: '2026-01-15',
  purchaseCost: 2500000,
  recoveryValue: 1800000,
  condition: 'NEW',
  notes: 'Example only',
  issueTo: 'EMP0001',
  issuedOn: '2026-02-01',
};

/* -------------------------------------------------------------- template -- */

const styleHeader = (row) => {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
  row.alignment = { vertical: 'middle', horizontal: 'left' };
  row.height = 22;
};

/**
 * The import template.
 *
 * The first sheet holds only the headers -- the importer reads that sheet, so
 * the example row lives on a separate Instructions sheet where it can never be
 * imported by accident. Category and Condition carry in-cell dropdowns.
 */
export const buildAssetImportTemplate = async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HRMS';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(SHEET_NAME, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = IMPORT_COLUMNS.map(({ header, key, width }) => ({ header, key, width }));
  styleHeader(sheet.getRow(1));

  IMPORT_COLUMNS.forEach((column, index) => {
    const letter = sheet.getColumn(index + 1).letter;
    if (column.type === 'date') sheet.getColumn(index + 1).numFmt = 'yyyy-mm-dd';

    if (column.allowed) {
      sheet.dataValidations.add(`${letter}2:${letter}1001`, {
        type: 'list',
        allowBlank: true,
        formulae: [`"${column.allowed.join(',')}"`],
        showErrorMessage: true,
        errorTitle: `Invalid ${column.header}`,
        error: `Choose one of: ${column.allowed.join(', ')}`,
      });
    }
  });

  const guide = workbook.addWorksheet('Instructions');
  guide.columns = [
    { header: 'Column', key: 'header', width: 26 },
    { header: 'Required', key: 'required', width: 10 },
    { header: 'Allowed values / rules', key: 'help', width: 70 },
    { header: 'Example (do not import)', key: 'example', width: 28 },
  ];
  styleHeader(guide.getRow(1));

  IMPORT_COLUMNS.forEach((column) => {
    guide.addRow({
      header: column.header,
      required: column.required ? 'Yes' : 'No',
      help: column.allowed ? `${column.help} One of: ${column.allowed.join(', ')}` : column.help,
      example: SAMPLE_ROW[column.key],
    });
  });

  guide.addRow({});
  [
    `Fill in the "${SHEET_NAME}" sheet, one asset per row, starting on row 2. Keep its header row unchanged.`,
    'The example above is for reference only. Rows whose Asset Code starts with SAMPLE are rejected.',
    'Status is not imported: a row with Issue To becomes ASSIGNED to that employee, every other row is AVAILABLE.',
    'Validate the file in the import dialog first. Rows with errors are listed by row number and are not imported.',
    'Save as Excel Workbook (.xlsx).',
  ].forEach((line) => guide.addRow({ header: line }));

  return workbook.xlsx.writeBuffer();
};

/* ---------------------------------------------------------------- import -- */

const text = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
};

const parseDate = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = value instanceof Date ? value : new Date(value);
  // `undefined` = present but unreadable, reported as a row error.
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const parseNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
};

/** The body `POST /payroll/assets` would receive for this row, plus any parse errors. */
const toAssetPayload = (data) => {
  const errors = [];
  const payload = {};

  const assetCode = text(data.assetCode);
  if (assetCode) payload.assetCode = assetCode.toUpperCase();

  payload.name = text(data.name) ?? undefined;

  const category = text(data.category);
  if (category) payload.category = category.toUpperCase().replace(/\s+/g, '_');

  ['serialNumber', 'make', 'model', 'notes'].forEach((key) => {
    const value = text(data[key]);
    if (value) payload[key] = value;
  });

  const condition = text(data.condition);
  if (condition) payload.condition = condition.toUpperCase();

  const purchaseDate = parseDate(data.purchaseDate);
  if (purchaseDate === undefined) errors.push('Purchase Date is not a valid date');
  else if (purchaseDate) payload.purchaseDate = purchaseDate;

  ['purchaseCost', 'recoveryValue'].forEach((key) => {
    const value = parseNumber(data[key]);
    if (value === undefined) errors.push(`${HEADER_BY_KEY[key]} must be a number`);
    else if (value !== null) payload[key] = value;
  });

  return { payload, errors };
};

/** Joi's messages name the field by key; the sheet calls it by its header. */
const joiErrors = (error) =>
  (error?.details ?? []).map((detail) => {
    const key = detail.path?.[0];
    const header = HEADER_BY_KEY[key] ?? key;
    if (detail.type === 'any.only') return `${header} must be one of: ${detail.context.valids.filter(Boolean).join(', ')}`;
    return detail.message.replace(/^"[^"]+"/, header);
  });

/**
 * Validates every row before writing any, and in `dryRun` writes nothing.
 * Valid rows are imported and invalid ones reported by row number -- the same
 * partial-import behaviour as the employee import.
 */
export const importAssets = async (buffer, { dryRun = false } = {}, req) => {
  const tenantId = req.user.tenantId ?? null;

  let parsed;
  try {
    parsed = await parseWorkbook(buffer, { columns: IMPORT_COLUMNS });
  } catch (error) {
    // ExcelJS reads .xlsx only; a legacy .xls or a renamed file fails here.
    throw ApiError.badRequest(
      error.message?.includes('header')
        ? error.message
        : 'The file could not be read. Save it as an Excel Workbook (.xlsx) based on the template and try again.',
    );
  }

  const { rows, truncated } = parsed;
  if (!rows.length) throw ApiError.badRequest('The uploaded file contains no data rows');

  /* --- lookups, one query each ------------------------------------------ */
  const codesInFile = rows.map(({ data }) => text(data.assetCode)?.toUpperCase()).filter(Boolean);
  const serialsInFile = rows.map(({ data }) => text(data.serialNumber)).filter(Boolean);
  const holdersInFile = rows.map(({ data }) => text(data.issueTo)?.toUpperCase()).filter(Boolean);

  const [existingCodes, existingSerials, employees] = await Promise.all([
    codesInFile.length
      ? Asset.find({ tenantId, assetCode: { $in: codesInFile } }).select('assetCode').lean()
      : [],
    serialsInFile.length
      ? Asset.find({ tenantId, serialNumber: { $in: serialsInFile } }).select('serialNumber assetCode').lean()
      : [],
    holdersInFile.length
      ? Employee.find({
          tenantId,
          deletedAt: null,
          $or: [{ employeeCode: { $in: holdersInFile } }, { employeeId: { $in: holdersInFile } }],
        })
          .select('employeeCode employeeId')
          .lean()
      : [],
  ]);

  const takenCodes = new Set(existingCodes.map((asset) => asset.assetCode));
  const takenSerials = new Map(existingSerials.map((asset) => [asset.serialNumber, asset.assetCode]));
  const employeeByReference = new Map();
  employees.forEach((employee) => {
    employeeByReference.set(String(employee.employeeCode).toUpperCase(), employee);
    if (employee.employeeId) employeeByReference.set(String(employee.employeeId).toUpperCase(), employee);
  });

  // Issuing is an update on the register; a role that may only add assets
  // cannot issue them through a spreadsheet either.
  const canIssue = can(req.user.role, RESOURCES.PAYROLL, ACTIONS.UPDATE);

  /* --- validation pass -------------------------------------------------- */
  const valid = [];
  const failed = [];
  const seenCodes = new Set();
  const seenSerials = new Set();

  for (const { rowNumber, data } of rows) {
    const { payload, errors } = toAssetPayload(data);

    const { error, value } = createAssetSchema.body.validate(payload, { abortEarly: false, convert: true });
    errors.push(...joiErrors(error));

    if (payload.assetCode) {
      if (payload.assetCode.startsWith('SAMPLE')) errors.push('This is the template example row; remove it');
      else if (takenCodes.has(payload.assetCode)) errors.push(`Asset Code ${payload.assetCode} already exists`);
      else if (seenCodes.has(payload.assetCode)) errors.push(`Asset Code ${payload.assetCode} is duplicated within this file`);
      seenCodes.add(payload.assetCode);
    }

    if (payload.serialNumber) {
      if (takenSerials.has(payload.serialNumber)) {
        errors.push(`Serial Number ${payload.serialNumber} is already registered as ${takenSerials.get(payload.serialNumber)}`);
      } else if (seenSerials.has(payload.serialNumber)) {
        errors.push(`Serial Number ${payload.serialNumber} is duplicated within this file`);
      }
      seenSerials.add(payload.serialNumber);
    }

    let issue = null;
    const reference = text(data.issueTo)?.toUpperCase();
    const issuedOn = parseDate(data.issuedOn);

    if (issuedOn === undefined) errors.push('Issued On is not a valid date');
    if (!reference && issuedOn) errors.push('Issued On is set but Issue To is blank');

    if (reference) {
      const employee = employeeByReference.get(reference);
      if (!employee) errors.push(`No employee found with code or ID ${text(data.issueTo)}`);
      else if (!canIssue) errors.push('You do not have permission to issue assets');
      else issue = { employeeId: employee._id, assignedOn: issuedOn || undefined };
    }

    if (errors.length) failed.push({ row: rowNumber, errors });
    else valid.push({ rowNumber, payload: value, issue });
  }

  const summary = {
    totalRows: rows.length,
    valid: valid.length,
    failed: failed.length,
    truncated,
    dryRun,
    errors: failed.slice(0, MAX_ERRORS),
    errorsTruncated: failed.length > MAX_ERRORS,
  };

  if (dryRun || !valid.length) return { ...summary, imported: 0, issued: 0 };

  /* --- write pass ------------------------------------------------------- */
  // Rows with their own code first, so a generated code can never take a code
  // that a later row in the same file asked for.
  const ordered = [...valid].sort((a, b) => Number(!a.payload.assetCode) - Number(!b.payload.assetCode));

  let imported = 0;
  let issued = 0;

  for (const { rowNumber, payload, issue } of ordered) {
    let asset;
    try {
      // eslint-disable-next-line no-await-in-loop -- sequential: codes are allocated one at a time
      asset = await assetService.createAsset(payload, req);
      imported += 1;
    } catch (error) {
      failed.push({
        row: rowNumber,
        errors: [error.code === 11000 ? 'Asset Code already exists' : (error.message ?? 'The asset could not be saved')],
      });
      continue;
    }

    if (!issue) continue;

    try {
      // eslint-disable-next-line no-await-in-loop
      await assetService.assignAsset(asset._id, { ...issue, condition: asset.condition }, req);
      issued += 1;
    } catch (error) {
      failed.push({
        row: rowNumber,
        errors: [`Added as ${asset.assetCode} but not issued: ${error.message ?? 'the issue failed'}. Issue it from the register.`],
      });
    }
  }

  failed.sort((a, b) => a.row - b.row);
  summary.failed = failed.length;
  summary.errors = failed.slice(0, MAX_ERRORS);
  summary.errorsTruncated = failed.length > MAX_ERRORS;

  await recordAudit({
    req,
    entity: 'Asset',
    entityId: new mongoose.Types.ObjectId(),
    action: AUDIT_ACTIONS.IMPORT,
    metadata: { totalRows: rows.length, imported, issued, failed: summary.failed },
  });

  logger.info('Asset import completed', { total: rows.length, imported, issued, failed: summary.failed });

  return { ...summary, imported, issued };
};

export default { buildAssetImportTemplate, importAssets, IMPORT_COLUMNS };
