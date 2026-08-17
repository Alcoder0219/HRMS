/**
 * Client-side export helpers.
 *
 * The API already streams Excel for the lists that have a server-side exporter
 * (employees, the attendance register, the salary register) and PDF for the
 * documents that are legal artifacts (payslip, settlement sheet). Those are
 * always preferred -- they carry the server's formatting and its access rules.
 *
 * These cover the rest without adding a PDF library to the bundle: CSV is built
 * from the same column definitions the table renders, and PDF goes through the
 * browser's own print-to-PDF, which every desktop and mobile browser has.
 */

/** RFC 4180: quote everything, double any embedded quote. */
const csvCell = (value) => {
  if (value === null || value === undefined) return '""';

  const text = String(value)
    // A cell starting with =, +, - or @ is executed as a formula by Excel when
    // the file is opened. Prefixing a quote neutralises it.
    .replace(/^([=+\-@])/, "'$1");

  return `"${text.replace(/"/g, '""')}"`;
};

/**
 * Builds a CSV from table columns and rows.
 *
 * `exportValue` on a column takes precedence over `render`, because `render`
 * returns React elements -- a chip or a nested Box would stringify to
 * "[object Object]" in a spreadsheet.
 */
export const toCsv = (columns, rows) => {
  const exportable = columns.filter((column) => column.key !== 'actions' && column.label);

  const header = exportable.map((column) => csvCell(column.label)).join(',');

  const body = rows.map((row) =>
    exportable
      .map((column) => csvCell(column.exportValue ? column.exportValue(row) : row[column.key]))
      .join(','),
  );

  // A BOM, so Excel opens UTF-8 names (accents, Devanagari) correctly rather
  // than as mojibake.
  return `﻿${[header, ...body].join('\r\n')}`;
};

/** Triggers a browser download from a Blob without leaking the object URL. */
export const downloadBlob = (blob, filename) => {
  const href = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(href);
};

export const downloadCsv = (columns, rows, filename) =>
  downloadBlob(new Blob([toCsv(columns, rows)], { type: 'text/csv;charset=utf-8;' }), filename);

/**
 * Prints the current page, which the browser's print dialog can save as PDF.
 *
 * A print stylesheet (styles/print.css) hides the chrome -- sidebar, app bar,
 * toolbars -- so the output is the table and its heading rather than a
 * screenshot of the application.
 */
export const printPage = (title) => {
  const original = document.title;
  if (title) document.title = title;

  window.print();

  // Restored after the dialog closes. `print()` is synchronous in every
  // browser that matters, but a timeout covers the ones that defer it.
  window.setTimeout(() => {
    document.title = original;
  }, 500);
};

export default { toCsv, downloadCsv, downloadBlob, printPage };
