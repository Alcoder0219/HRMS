import asyncHandler from '../../utils/asyncHandler.js';
import ApiResponse from '../../utils/ApiResponse.js';
import payrollService from '../../services/payroll/payroll.service.js';
import structureService from '../../services/payroll/salaryStructure.service.js';
import loanService from '../../services/payroll/loan.service.js';
import reportService from '../../services/payroll/payrollReport.service.js';
import payrollRepository from '../../repositories/payroll/payroll.repository.js';

const query = (req) => req.validatedQuery ?? {};

/* ---------------------------------------------------- salary structure -- */

export const createStructure = asyncHandler(async (req, res) => {
  const structure = await structureService.createStructure(req.body, req);
  return ApiResponse.created(res, structure, 'Salary structure saved');
});

export const currentStructure = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await structureService.getCurrentStructure(req.params.employeeId, req)),
);

export const structureHistory = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await structureService.getStructureHistory(req.params.employeeId, req), 'Revision history'),
);

/** Suggests a component split from an annual CTC. A starting point, not a rule. */
export const ctcPreview = asyncHandler(async (req, res) => {
  const { annualCtc, ...options } = query(req);
  return ApiResponse.ok(res, structureService.previewFromCtc(annualCtc, options), 'Suggested split');
});

/* --------------------------------------------------------- payroll run -- */

export const processRun = asyncHandler(async (req, res) => {
  const run = await payrollService.processRun(req.body, req);

  return ApiResponse.ok(
    res,
    run,
    `Priced ${run.employeeCount} employee(s)${run.exclusions?.length ? `, ${run.exclusions.length} excluded` : ''}`,
  );
});

export const listRuns = asyncHandler(async (req, res) => {
  const result = await payrollService.listRuns(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getRun = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await payrollService.getRun(req.params.id, req)),
);

export const submitRun = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await payrollService.submitRun(req.params.id, req), 'Submitted for approval'),
);

export const approveRun = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await payrollService.approveRun(req.params.id, req), 'Payroll approved and payslips published'),
);

export const markPaid = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await payrollService.markPaid(req.params.id, req.body, req), 'Marked as paid'),
);

export const cancelRun = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await payrollService.cancelRun(req.params.id, req.body, req), 'Payroll run cancelled'),
);

/* ------------------------------------------------------------ payslips -- */

export const listPayslips = asyncHandler(async (req, res) => {
  const result = await payrollService.listPayslips(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getPayslip = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await payrollService.getPayslip(req.params.id, req)),
);

export const holdPayslip = asyncHandler(async (req, res) => {
  const payslip = await payrollService.holdPayslip(req.params.id, req.body, req);
  return ApiResponse.ok(res, payslip, req.body.hold ? 'Payslip held' : 'Hold released');
});

/** Streams the payslip PDF. */
export const payslipPdf = asyncHandler(async (req, res) => {
  const { buffer, filename } = await payrollService.generatePayslipPdf(req.params.id, req);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Length', buffer.length);

  return res.status(200).send(buffer);
});

/* --------------------------------------------------------- bank file --- */

export const bankFile = asyncHandler(async (req, res) => {
  const file = await payrollService.generateBankFile(req.params.id, query(req), req);

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
  // Surfaced as headers so the client can warn about excluded rows without
  // parsing the file it just downloaded.
  res.setHeader('X-Total-Count', String(file.included));
  res.setHeader('X-Skipped-Count', String(file.skipped.length));
  res.setHeader('X-Total-Amount', String(file.totalAmount));

  return res.status(200).send(file.content);
});

/* --------------------------------------------------------------- loans -- */

export const createLoan = asyncHandler(async (req, res) =>
  ApiResponse.created(res, await loanService.createLoan(req.body, req), 'Loan created and awaiting approval'),
);

export const listLoans = asyncHandler(async (req, res) => {
  const result = await loanService.listLoans(query(req), req);

  return ApiResponse.paginated(res, result.items, {
    page: result.page,
    limit: result.limit,
    total: result.total,
  });
});

export const getLoan = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await loanService.getLoan(req.params.id, req)),
);

export const decideLoan = asyncHandler(async (req, res) => {
  const loan = await loanService.decideLoan(req.params.id, req.body, req);
  return ApiResponse.ok(res, loan, `Loan ${loan.status.toLowerCase()}`);
});

export const disburseLoan = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await loanService.disburseLoan(req.params.id, req.body, req), 'Loan disbursed'),
);

export const loanHold = asyncHandler(async (req, res) => {
  const loan = await loanService.setLoanHold(req.params.id, req.body, req);
  return ApiResponse.ok(res, loan, req.body.hold ? 'Recovery paused' : 'Recovery resumed');
});

export const loanRepayment = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await loanService.recordManualRepayment(req.params.id, req.body, req), 'Repayment recorded'),
);

/* ------------------------------------------------------------- reports -- */

export const salaryRegister = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.salaryRegister(req.params.id, req), 'Salary register'),
);

export const exportRegister = asyncHandler(async (req, res) => {
  const { buffer, rowCount, period } = await reportService.exportSalaryRegister(req.params.id, req);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="salary-register-${String(period).toLowerCase().replace(/\s+/g, '-')}.xlsx"`,
  );
  res.setHeader('X-Total-Count', String(rowCount));

  return res.status(200).send(Buffer.from(buffer));
});

export const statutoryReport = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.statutoryReport(query(req), req), 'Statutory summary'),
);

export const costByDepartment = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.costByDepartment(query(req), req), 'Cost by department'),
);

export const yearlyTrend = asyncHandler(async (req, res) =>
  ApiResponse.ok(res, await reportService.yearlyTrend(query(req), req), 'Yearly trend'),
);

/* ------------------------------------------------------------ settings -- */

export const getSettings = asyncHandler(async (req, res) => {
  const settings = await payrollRepository.findSettings(req.user.tenantId ?? null);
  return ApiResponse.ok(res, settings, settings ? 'Payroll settings' : 'No settings configured');
});

export const upsertSettings = asyncHandler(async (req, res) => {
  const settings = await payrollRepository.upsertSettings(req.user.tenantId ?? null, {
    ...req.body,
    updatedBy: req.user.id,
  });

  return ApiResponse.ok(res, settings, 'Payroll settings saved');
});

export default {
  createStructure,
  currentStructure,
  structureHistory,
  ctcPreview,
  processRun,
  listRuns,
  getRun,
  submitRun,
  approveRun,
  markPaid,
  cancelRun,
  listPayslips,
  getPayslip,
  holdPayslip,
  payslipPdf,
  bankFile,
  createLoan,
  listLoans,
  getLoan,
  decideLoan,
  disburseLoan,
  loanHold,
  loanRepayment,
  salaryRegister,
  exportRegister,
  statutoryReport,
  costByDepartment,
  yearlyTrend,
  getSettings,
  upsertSettings,
};
