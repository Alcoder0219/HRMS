import { BANK_FILE_FORMATS, CURRENCY } from '../utils/constants.js';

/**
 * Bank transfer (salary disbursement) file generation.
 *
 * Banks each define their own upload layout, so the format is a per-tenant
 * setting rather than a constant. Every format here produces a text/CSV payload
 * -- the common denominator all of them accept -- and the differences are
 * column order and header presence, not structure.
 *
 * The three named layouts cover CRDB, NMB and NBC, which between them clear
 * most Tanzanian payrolls. All three identify the receiving institution by
 * SWIFT/BIC rather than by a domestic routing code.
 *
 * The account number is read from the live employee record, never from the
 * payslip snapshot, which stores it masked.
 */

/** RFC 4180 quoting. A name containing a comma must not shift every column. */
const csvCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csvRow = (cells) => cells.map(csvCell).join(',');

/** Amounts go out with exactly two decimals and no grouping separators. */
const amount = (value) => (Number(value) || 0).toFixed(2);

/**
 * Bank files reject most punctuation in narration fields, and length limits
 * are strict -- an over-long narration is a rejected transaction, not a
 * truncated one.
 */
const sanitize = (value, maxLength = 35) =>
  String(value ?? '')
    .replace(/[^A-Za-z0-9 ./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

const FORMATS = {
  [BANK_FILE_FORMATS.GENERIC_CSV]: {
    header: [
      'Employee Code',
      'Employee Name',
      'Bank Name',
      'Account Number',
      'SWIFT Code',
      'Branch Code',
      'Currency',
      'Amount',
      'Narration',
    ],
    row: (entry, context) => [
      entry.employeeCode,
      sanitize(entry.fullName, 50),
      sanitize(entry.bankName, 40),
      entry.accountNumber,
      entry.swiftCode,
      entry.branchCode,
      context.currency,
      amount(entry.netPayable),
      sanitize(`${context.narration} ${context.period}`),
    ],
  },

  [BANK_FILE_FORMATS.CRDB]: {
    // SimBanking bulk payment: beneficiary first, currency explicit.
    header: ['BENEFICIARY_NAME', 'ACCOUNT_NUMBER', 'BANK_SWIFT', 'BRANCH_CODE', 'CURRENCY', 'AMOUNT', 'NARRATION'],
    row: (entry, context) => [
      sanitize(entry.fullName, 50),
      entry.accountNumber,
      entry.swiftCode,
      entry.branchCode,
      context.currency,
      amount(entry.netPayable),
      sanitize(`${context.narration} ${context.period}`, 30),
    ],
  },

  [BANK_FILE_FORMATS.NMB]: {
    // Corporate bulk salary layout: no header row, payment type first.
    header: null,
    row: (entry, context) => [
      'SALARY',
      entry.accountNumber,
      amount(entry.netPayable),
      context.currency,
      entry.swiftCode,
      sanitize(entry.fullName, 50),
      sanitize(`${context.narration}${context.period}`, 30),
      entry.employeeCode,
    ],
  },

  [BANK_FILE_FORMATS.NBC]: {
    header: null,
    row: (entry, context) => [
      entry.accountNumber,
      sanitize(entry.fullName, 50),
      amount(entry.netPayable),
      context.currency,
      entry.swiftCode,
      sanitize(`${context.narration} ${context.period}`, 30),
    ],
  },
};

/**
 * Builds the transfer file.
 *
 * Rows missing an account number or SWIFT code are separated out rather than
 * written with blanks: a malformed row usually causes the bank to reject the
 * entire upload, so one incomplete record would stop everyone else being paid.
 *
 * @returns {{ content, filename, mimeType, included, skipped, totalAmount }}
 */
export const buildBankTransferFile = ({ entries = [], settings = {}, period, format = null }) => {
  const chosen = format ?? settings.bank?.format ?? BANK_FILE_FORMATS.GENERIC_CSV;
  const spec = FORMATS[chosen] ?? FORMATS[BANK_FILE_FORMATS.GENERIC_CSV];

  const context = {
    period: sanitize(period, 20),
    narration: sanitize(settings.bank?.debitNarration ?? 'SALARY', 12),
    // The ISO code, not the local symbol: a bank file is read by a machine
    // that has never heard of TSH.
    currency: sanitize(settings.currency ?? CURRENCY.CODE, 3),
  };

  const included = [];
  const skipped = [];

  entries.forEach((entry) => {
    if (!entry.accountNumber || !entry.swiftCode) {
      skipped.push({
        employeeCode: entry.employeeCode,
        fullName: entry.fullName,
        reason: !entry.accountNumber ? 'Missing bank account number' : 'Missing SWIFT code',
      });
      return;
    }

    // A zero or negative payment is not a transaction the bank will accept.
    if (!(Number(entry.netPayable) > 0)) {
      skipped.push({
        employeeCode: entry.employeeCode,
        fullName: entry.fullName,
        reason: 'Net payable is zero',
      });
      return;
    }

    included.push(entry);
  });

  const lines = [];
  if (spec.header) lines.push(csvRow(spec.header));
  included.forEach((entry) => lines.push(csvRow(spec.row(entry, context))));

  const totalAmount = included.reduce((sum, entry) => sum + Number(entry.netPayable || 0), 0);

  return {
    // CRLF: bank upload portals are overwhelmingly Windows-oriented and several
    // reject bare LF outright.
    content: `${lines.join('\r\n')}\r\n`,
    filename: `salary-transfer-${String(period).toLowerCase().replace(/\s+/g, '-')}-${chosen.toLowerCase()}.csv`,
    mimeType: 'text/csv',
    format: chosen,
    included: included.length,
    skipped,
    totalAmount: Number(totalAmount.toFixed(2)),
  };
};

export default { buildBankTransferFile };
