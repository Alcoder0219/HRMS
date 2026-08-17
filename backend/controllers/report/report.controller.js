import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import reportService from '../../services/report/report.service.js';
import { buildWorkbook } from '../../helpers/excel.helper.js';
import { buildTablePdf } from '../../helpers/pdf.helper.js';

const query = (req) => req.validatedQuery ?? req.query ?? {};

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const slugify = (label) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * The summary cards rendered as one line of text for the PDF subtitle.
 *
 * A printed report without "net paid: 41,20,000" at the top makes the reader
 * recompute a number the report already knew. The Excel export leaves it out
 * deliberately -- a title band above the header would break the frozen row
 * and the autofilter that make an exported sheet usable.
 */
const summaryLine = (summary) =>
  (summary ?? []).map((entry) => `${entry.label}: ${entry.value}`).join('  •  ');

export const catalog = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, reportService.getCatalog(), 'Report catalog'),
);

export const run = asyncHandler(async (req, res) => {
  const report = await reportService.runReport(req.params.slug, query(req), req);
  return ApiResponse.ok(res, report, report.label);
});

export const exportExcel = asyncHandler(async (req, res) => {
  const { label, columns, rows } = await reportService.runReportForExport(req.params.slug, query(req), req);

  const buffer = await buildWorkbook({
    sheetName: label.slice(0, 31),
    // Point widths converted to the character widths ExcelJS expects.
    columns: columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: Math.max(12, Math.round((column.width ?? 90) / 6)),
    })),
    rows,
  });

  const filename = `${slugify(label)}.xlsx`;

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Total-Count', String(rows.length));

  return res.status(200).send(Buffer.from(buffer));
});

export const exportPdf = asyncHandler(async (req, res) => {
  const { label, columns, rows, summary } = await reportService.runReportForExport(
    req.params.slug,
    query(req),
    req,
  );

  // Landscape A4 stops being legible past about ten columns. The descriptor
  // orders columns by how much a reader needs them, so taking the first ten
  // drops the least useful rather than an arbitrary tail.
  const printable = columns.slice(0, 10);

  const buffer = await buildTablePdf({
    title: label,
    subtitle: `${rows.length} record(s)  —  ${summaryLine(summary)}`,
    columns: printable.map((column) => ({
      header: column.label,
      key: column.key,
      width: column.width ?? 90,
      align: column.align ?? 'left',
    })),
    rows,
  });

  const filename = `${slugify(label)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  return res.status(200).send(buffer);
});

export default { catalog, run, exportExcel, exportPdf };
