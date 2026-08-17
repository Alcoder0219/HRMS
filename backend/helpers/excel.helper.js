import ExcelJS from 'exceljs';

/**
 * Thin wrapper over ExcelJS so modules describe columns declaratively and
 * never touch workbook internals.
 */

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };

/**
 * Builds a styled worksheet and returns it as a Buffer.
 *
 * `columns` is `[{ header, key, width, format }]`. Rows are plain objects
 * keyed by `key`, which keeps the column definition the single description of
 * both the header and the data mapping.
 */
export const buildWorkbook = async ({ sheetName = 'Sheet1', columns, rows, meta = {} }) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = meta.creator ?? 'HRMS';
  workbook.created = meta.created ?? new Date();

  const sheet = workbook.addWorksheet(sheetName, {
    // Freezing the header keeps it visible while scrolling a few thousand rows.
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  sheet.columns = columns.map(({ header, key, width }) => ({ header, key, width: width ?? 18 }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' };
  headerRow.height = 22;

  rows.forEach((row) => sheet.addRow(row));

  columns.forEach((column, index) => {
    if (column.format) sheet.getColumn(index + 1).numFmt = column.format;
  });

  // Turns the header into a filter row, which is what makes an exported sheet
  // immediately usable rather than just a dump.
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };

  return workbook.xlsx.writeBuffer();
};

/**
 * Reads the first worksheet into plain objects keyed by the header row.
 *
 * Header matching is case- and space-insensitive because a template that has
 * been round-tripped through a spreadsheet app rarely comes back with byte
 * identical headers.
 */
export const parseWorkbook = async (buffer, { columns, maxRows = 5000 } = {}) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The uploaded file contains no worksheets');

  const normalize = (value) => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const headerToKey = new Map(columns.map(({ header, key }) => [normalize(header), key]));

  const headerRow = sheet.getRow(1);
  const indexToKey = new Map();

  headerRow.eachCell((cell, colNumber) => {
    const key = headerToKey.get(normalize(cell.value));
    if (key) indexToKey.set(colNumber, key);
  });

  if (!indexToKey.size) {
    throw new Error('No recognised column headers were found in the first row');
  }

  const rows = [];

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || rows.length >= maxRows) return;

    const record = {};
    let hasValue = false;

    indexToKey.forEach((key, colNumber) => {
      const cell = row.getCell(colNumber);
      let value = cell.value;

      // Formula cells carry both the expression and its computed result; the
      // result is what was meant. Hyperlink cells wrap their label the same way.
      if (value && typeof value === 'object') {
        if ('result' in value) value = value.result;
        else if ('text' in value) value = value.text;
        else if ('richText' in value) value = value.richText.map((part) => part.text).join('');
      }

      if (typeof value === 'string') value = value.trim();
      if (value !== null && value !== undefined && value !== '') hasValue = true;

      record[key] = value === '' ? null : value;
    });

    // Spreadsheets routinely carry thousands of formatted-but-empty rows.
    if (hasValue) rows.push({ rowNumber, data: record });
  });

  return { rows, truncated: sheet.rowCount - 1 > maxRows };
};

export default { buildWorkbook, parseWorkbook };
