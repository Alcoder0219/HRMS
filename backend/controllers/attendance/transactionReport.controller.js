import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import service from '../../services/attendance/transactionReport.service.js';

const query = (req) => req.validatedQuery ?? {};

/** The Transaction Report rows for one unit and day. */
export const transactionReport = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await service.transactionReport(query(req), req), 'Transaction report'),
);

/** The same rows as the PDF the Export button downloads. */
export const transactionReportPdf = asyncHandler(async (req, res) => {
  const { buffer, filename, rowCount } = await service.transactionReportPdf(query(req), req);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Total-Count', String(rowCount));
  return res.status(200).send(buffer);
});

export default { transactionReport, transactionReportPdf };
