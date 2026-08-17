import ExcelJS from 'exceljs';

/**
 * Parser and template builder for the monthly attendance workbook.
 *
 * The layout is wide: four identifying columns followed by an In/Out pair for
 * every day of the month.
 *
 *   Month | Unit | Employee ID | Employee Name | Day 1        | Day 2        | ...
 *                                              | In    | Out  | In    | Out  |
 *
 * Two header shapes are accepted, because a spreadsheet that has been through
 * a few hands rarely comes back byte-identical:
 *
 *   - Two rows: "Day 1" merged across a pair, with "In Time" / "Out Time" beneath.
 *   - One row:  "Day 1 In Time" / "Day 1 Out Time" in a single cell each.
 *
 * The file format itself is unchanged either way -- this only makes reading it
 * tolerant of how the header was saved.
 */

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];

const normalise = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** Unwraps the shapes ExcelJS returns for formula, hyperlink and rich-text cells. */
const cellText = (cell) => {
  let value = cell?.value;
  if (value === null || value === undefined) return '';

  if (typeof value === 'object') {
    if ('result' in value) value = value.result;
    else if ('text' in value) value = value.text;
    else if ('richText' in value) value = value.richText.map((part) => part.text).join('');
  }

  return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
};

/**
 * Normalises a cell to `HH:mm`.
 *
 * Times arrive in three shapes depending on how the sheet was produced, and all
 * three are legitimate:
 *   - text, "9:30" or "09:30:00"
 *   - an Excel serial, where 0.395833 is a fraction of a day
 *   - a Date, when the cell was formatted as a time
 *
 * Returns `null` for an empty cell and `undefined` for something present but
 * unreadable, so the caller can tell "no punch" from "bad data".
 */
export const parseTimeCell = (rawValue) => {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;

  let value = rawValue;
  if (typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) value = value.result;
    else if ('text' in value) value = value.text;
    else if ('richText' in value) value = value.richText.map((part) => part.text).join('');
  }

  if (value instanceof Date) {
    // ExcelJS returns time-only cells as a Date on the epoch date, in UTC.
    const hours = value.getUTCHours();
    const minutes = value.getUTCMinutes();
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  if (typeof value === 'number') {
    // Excel stores a time as a fraction of a day; anything at or above 1 is a
    // date serial, whose fractional part is still the time.
    const fraction = value % 1;
    const totalMinutes = Math.round(fraction * 24 * 60);
    if (!Number.isFinite(totalMinutes)) return undefined;

    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }

  const text = String(value).trim();
  if (!text || /^(-|--|n\/?a|nil|off|abs(ent)?)$/i.test(text)) return null;

  // Accepts 9:30, 09:30, 09:30:00 and a trailing am/pm.
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(text);
  if (!match) return undefined;

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const meridiem = match[3]?.toLowerCase();

  if (meridiem === 'pm' && hours < 12) hours += 12;
  if (meridiem === 'am' && hours === 12) hours = 0;

  if (hours > 23 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

/** Accepts "July", "july", "07" or 7. */
export const parseMonthCell = (value) => {
  if (value === null || value === undefined || value === '') return undefined;

  const text = String(value).trim();
  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 12) return numeric;

  const index = MONTH_NAMES.findIndex((name) => name.startsWith(normalise(text).slice(0, 3)));
  return index === -1 ? undefined : index + 1;
};

/* -------------------------------------------------------------------------- */
/*                               Header mapping                               */
/* -------------------------------------------------------------------------- */

const IDENTITY_ALIASES = {
  month: ['month', 'attendance month', 'period'],
  unit: ['unit', 'plant', 'location', 'branch'],
  employeeId: ['employee id', 'emp id', 'employee code', 'emp code', 'employee no', 'employee number'],
  employeeName: ['employee name', 'emp name', 'name'],
};

/**
 * Locates the identity columns and builds a day -> {in, out} column map.
 *
 * Scans the first few rows rather than assuming row 1, because exported sheets
 * often carry a title or a blank line above the header.
 */
export const mapHeader = (sheet, { maxHeaderRow = 6 } = {}) => {
  const identity = {};
  const days = new Map();
  let headerRow = null;

  for (let rowNumber = 1; rowNumber <= Math.min(maxHeaderRow, sheet.rowCount); rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const found = {};

    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const text = normalise(cellText(cell));
      if (!text) return;

      for (const [key, aliases] of Object.entries(IDENTITY_ALIASES)) {
        if (aliases.includes(text)) found[key] = colNumber;
      }
    });

    // The header row is the one carrying the employee identifier.
    if (found.employeeId !== undefined) {
      Object.assign(identity, found);
      headerRow = rowNumber;
      break;
    }
  }

  if (headerRow === null) {
    throw new Error(
      'Could not find an "Employee ID" column. Download the sample workbook and keep its header row.',
    );
  }

  const dayRow = sheet.getRow(headerRow);
  const subRow = sheet.getRow(headerRow + 1);

  const remember = (dayNumber, colNumber, kind) => {
    if (!days.has(dayNumber)) days.set(dayNumber, {});
    days.get(dayNumber)[kind] = colNumber;
  };

  /**
   * A merged "Day N" cell reports its text only on the first column of the
   * merge, so the label is carried forward until the next one appears.
   */
  let currentDay = null;

  for (let colNumber = 1; colNumber <= sheet.columnCount; colNumber += 1) {
    const dayLabel = normalise(cellText(dayRow.getCell(colNumber)));
    const subLabel = normalise(cellText(subRow.getCell(colNumber)));

    // Single-row form: "Day 1 In Time" in one cell.
    const combined = /^day\s*(\d{1,2})\b.*\b(in|out)\b/.exec(dayLabel);
    if (combined) {
      remember(Number(combined[1]), colNumber, combined[2] === 'in' ? 'in' : 'out');
      continue;
    }

    const dayMatch = /^day\s*(\d{1,2})$/.exec(dayLabel);
    if (dayMatch) currentDay = Number(dayMatch[1]);

    if (currentDay && /\bin\b/.test(subLabel)) remember(currentDay, colNumber, 'in');
    else if (currentDay && /\bout\b/.test(subLabel)) remember(currentDay, colNumber, 'out');
  }

  if (!days.size) {
    throw new Error(
      'No "Day 1 ... Day 31" columns were found. Each day needs an In Time and an Out Time column.',
    );
  }

  // Two-row header: data starts below the In/Out row.
  const usesSubHeader = [...days.values()].some((entry) => entry.in && entry.out) &&
    /\b(in|out)\b/.test(normalise(cellText(subRow.getCell([...days.values()][0].in ?? 1))));

  return { identity, days, headerRow, firstDataRow: headerRow + (usesSubHeader ? 2 : 1) };
};

/* -------------------------------------------------------------------------- */
/*                                   Parse                                    */
/* -------------------------------------------------------------------------- */

/**
 * Reads the workbook into one record per employee.
 *
 * Structural problems throw -- there is no useful partial result from a sheet
 * whose header cannot be read. Row-level problems are collected and returned,
 * so the caller can report every bad row at once instead of one per attempt.
 */
export const parseAttendanceWorkbook = async (buffer, { maxRows = 20_000 } = {}) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The uploaded file contains no worksheets');

  const { identity, days, firstDataRow } = mapHeader(sheet);
  const dayNumbers = [...days.keys()].sort((a, b) => a - b);

  const rows = [];
  let truncated = false;

  for (let rowNumber = firstDataRow; rowNumber <= sheet.rowCount; rowNumber += 1) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }

    const row = sheet.getRow(rowNumber);
    const employeeId = identity.employeeId ? cellText(row.getCell(identity.employeeId)) : '';

    /**
     * A row with no identifier is only skipped when it is entirely empty --
     * a spacer or a totals line. A row that carries a name or punches but no
     * Employee ID is a data-entry error and must be REPORTED, not silently
     * dropped: somebody's month would otherwise go missing without a trace.
     */
    if (!employeeId) {
      const hasAnyValue = row.values?.some?.(
        (value) => value !== null && value !== undefined && String(value).trim() !== '',
      );
      if (!hasAnyValue) continue;
    }

    const attendance = [];
    const timeErrors = [];

    for (const dayNumber of dayNumbers) {
      const columns = days.get(dayNumber);
      const rawIn = columns.in ? row.getCell(columns.in).value : null;
      const rawOut = columns.out ? row.getCell(columns.out).value : null;

      const inTime = parseTimeCell(rawIn);
      const outTime = parseTimeCell(rawOut);

      if (inTime === undefined) timeErrors.push(`Day ${dayNumber} in-time "${cellText(row.getCell(columns.in))}"`);
      if (outTime === undefined) timeErrors.push(`Day ${dayNumber} out-time "${cellText(row.getCell(columns.out))}"`);

      // Days with no punch at all are omitted rather than stored as nulls --
      // a 31-entry array of empties says nothing a missing entry does not.
      if (inTime || outTime) {
        attendance.push({ day: dayNumber, inTime: inTime ?? null, outTime: outTime ?? null });
      }
    }

    rows.push({
      rowNumber,
      employeeId,
      employeeName: identity.employeeName ? cellText(row.getCell(identity.employeeName)) : null,
      unit: identity.unit ? cellText(row.getCell(identity.unit)) : null,
      rawMonth: identity.month ? cellText(row.getCell(identity.month)) : null,
      month: identity.month ? parseMonthCell(cellText(row.getCell(identity.month))) : undefined,
      attendance,
      timeErrors,
    });
  }

  return { rows, truncated, dayColumns: dayNumbers.length };
};

/* -------------------------------------------------------------------------- */
/*                                  Template                                  */
/* -------------------------------------------------------------------------- */

/**
 * Builds the sample workbook in the two-row header form, which is the shape
 * the specification describes and the one the parser prefers.
 */
export const buildAttendanceTemplate = async ({ month = 7, year = new Date().getFullYear() } = {}) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'HRMS';

  const sheet = workbook.addWorksheet('Attendance', {
    views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }],
  });

  const daysInMonth = new Date(year, month, 0).getDate();
  const identityHeaders = ['Month', 'Unit', 'Employee ID', 'Employee Name'];

  const dayRow = [...identityHeaders];
  const subRow = ['', '', '', ''];

  for (let day = 1; day <= daysInMonth; day += 1) {
    dayRow.push(`Day ${day}`, '');
    subRow.push('In Time', 'Out Time');
  }

  sheet.addRow(dayRow);
  sheet.addRow(subRow);

  // Merge each "Day N" across its In/Out pair, and the identity headers down
  // across both header rows.
  identityHeaders.forEach((_, index) => sheet.mergeCells(1, index + 1, 2, index + 1));
  for (let day = 0; day < daysInMonth; day += 1) {
    const startColumn = identityHeaders.length + day * 2 + 1;
    sheet.mergeCells(1, startColumn, 1, startColumn + 1);
  }

  [1, 2].forEach((rowNumber) => {
    const row = sheet.getRow(rowNumber);
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
    row.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  sheet.getColumn(1).width = 12;
  sheet.getColumn(2).width = 16;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 26;
  for (let column = 5; column <= 4 + daysInMonth * 2; column += 1) sheet.getColumn(column).width = 10;

  // One worked example row, so the expected time format is unambiguous.
  const example = [
    new Date(year, month - 1).toLocaleString('en-US', { month: 'long' }),
    'Corporate',
    'EMP000001',
    'Sample Employee',
  ];
  for (let day = 1; day <= daysInMonth; day += 1) example.push('09:30', '18:00');
  sheet.addRow(example);

  return workbook.xlsx.writeBuffer();
};

export default { parseAttendanceWorkbook, buildAttendanceTemplate, parseTimeCell, parseMonthCell, mapHeader };
