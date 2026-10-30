import { Router } from 'express';

import controller from '../../controllers/payroll/payroll.controller.js';
import settlementController from '../../controllers/payroll/settlement.controller.js';
import validate from '../../middlewares/validate.js';
import { spreadsheetUpload } from '../../config/multer.js';
import { requirePermission, requireScope } from '../../middlewares/authorize.js';
import { ACTIONS, SCOPES } from '../../utils/constants.js';

/**
 * Organisation-wide payroll aggregates.
 *
 * `payroll:read` is held by every employee so they can see their own payslip,
 * which makes the action alone too coarse for a register or a statutory
 * return. These endpoints additionally demand TENANT reach, so a SELF-scoped
 * employee or a TEAM-scoped manager cannot pull the whole company's figures.
 */
const orgWidePayroll = [requirePermission(ACTIONS.READ), requireScope(SCOPES.TENANT)];
import schemas from '../../validators/payroll/payroll.validator.js';
import settlementSchemas from '../../validators/payroll/settlement.validator.js';

const router = Router();

/**
 * Payroll: salary structures, runs, payslips, loans and statutory reporting.
 *
 * RBAC resource: RESOURCES.PAYROLL
 *
 * Mounted in routes/index.js behind authenticate and bound to its resource.
 * Literal paths precede `/:id` -- Express matches in order, and `/runs` would
 * otherwise be captured as a payslip id.
 *
 * Action mapping is deliberate. `APPROVE` guards everything that moves money
 * or changes what will be paid: processing a run, approving it, holding a
 * payslip, disbursing a loan. `PAYROLL` and `COMPANY_ADMIN` hold it; `HR` and
 * `ACCOUNTS` do not -- separation of duties over salary data.
 */

/* ---------------------------------------------------- salary structure -- */

router.get(
  '/structures/preview',
  requirePermission(ACTIONS.READ),
  validate(schemas.ctcPreviewSchema),
  controller.ctcPreview,
);

router.post(
  '/structures',
  // Setting pay is not an ordinary create -- it is the input every future
  // payslip is priced from.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.createStructureSchema),
  controller.createStructure,
);

router.get(
  '/structures/:employeeId',
  requirePermission(ACTIONS.READ),
  validate(schemas.employeeParamSchema),
  controller.currentStructure,
);

router.get(
  '/structures/:employeeId/history',
  requirePermission(ACTIONS.READ),
  validate(schemas.employeeParamSchema),
  controller.structureHistory,
);

/* --------------------------------------------------------- payroll run -- */

router.get('/runs', orgWidePayroll, validate(schemas.listRunsSchema), controller.listRuns);

router.post(
  '/runs/process',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.processRunSchema),
  controller.processRun,
);

router.get('/runs/:id', orgWidePayroll, validate(schemas.idParamSchema), controller.getRun);

router.post(
  '/runs/:id/submit',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.idParamSchema),
  controller.submitRun,
);

router.post(
  '/runs/:id/approve',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.idParamSchema),
  controller.approveRun,
);

router.post(
  '/runs/:id/paid',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.markPaidSchema),
  controller.markPaid,
);

router.post(
  '/runs/:id/cancel',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.cancelRunSchema),
  controller.cancelRun,
);

/* ---------------------------------------------------------- run outputs -- */

router.get(
  '/runs/:id/register',
  orgWidePayroll,
  validate(schemas.idParamSchema),
  controller.salaryRegister,
);

router.get(
  '/runs/:id/register/export',
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.idParamSchema),
  controller.exportRegister,
);

router.get(
  '/runs/:id/bank-file',
  // The bank file is a payment instruction carrying every account number in
  // the organisation. Export rights are the floor for it.
  requirePermission(ACTIONS.EXPORT),
  validate(schemas.bankFileSchema),
  controller.bankFile,
);

/* ------------------------------------------------------------ payslips -- */

router.get(
  '/payslips',
  requirePermission(ACTIONS.READ),
  validate(schemas.listPayslipsSchema),
  controller.listPayslips,
);

router.get(
  '/payslips/:id',
  requirePermission(ACTIONS.READ),
  validate(schemas.idParamSchema),
  controller.getPayslip,
);

router.get(
  '/payslips/:id/pdf',
  // Read, not print: an employee must be able to download their own payslip,
  // and the service scopes the record to them.
  requirePermission(ACTIONS.READ),
  validate(schemas.idParamSchema),
  controller.payslipPdf,
);

router.patch(
  '/payslips/:id/hold',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.holdPayslipSchema),
  controller.holdPayslip,
);

/* --------------------------------------------------------------- loans -- */

router.get('/loans', requirePermission(ACTIONS.READ), validate(schemas.listLoansSchema), controller.listLoans);

router.post(
  '/loans',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.createLoanSchema),
  controller.createLoan,
);

router.get('/loans/:id', requirePermission(ACTIONS.READ), validate(schemas.idParamSchema), controller.getLoan);

router.patch(
  '/loans/:id/decision',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.decideLoanSchema),
  controller.decideLoan,
);

router.post(
  '/loans/:id/disburse',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.disburseLoanSchema),
  controller.disburseLoan,
);

router.patch(
  '/loans/:id/hold',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.loanHoldSchema),
  controller.loanHold,
);

router.post(
  '/loans/:id/repayment',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.loanRepaymentSchema),
  controller.loanRepayment,
);

/* ------------------------------------------------------------- reports -- */

router.get(
  '/reports/statutory',
  // Names, TIN, membership numbers and contribution amounts for the whole organisation.
  orgWidePayroll,
  validate(schemas.periodQuerySchema),
  controller.statutoryReport,
);

router.get(
  '/reports/cost-by-department',
  requirePermission(ACTIONS.DASHBOARD),
  validate(schemas.periodQuerySchema),
  controller.costByDepartment,
);

router.get(
  '/reports/trend',
  requirePermission(ACTIONS.DASHBOARD),
  validate(schemas.yearQuerySchema),
  controller.yearlyTrend,
);

/* -------------------------------------------------- full & final exit -- */

/**
 * Settlement carries a two-stage approval: HR confirms the exit facts, finance
 * confirms the money. Both stages are gated on APPROVE, and the service
 * additionally refuses to let one person clear both.
 */

router.get('/settlements/dashboard', requirePermission(ACTIONS.DASHBOARD), settlementController.dashboard);

router.get(
  '/settlements',
  requirePermission(ACTIONS.READ),
  validate(settlementSchemas.listSettlementsSchema),
  settlementController.list,
);

router.post(
  '/settlements',
  requirePermission(ACTIONS.CREATE),
  validate(settlementSchemas.createSettlementSchema),
  settlementController.create,
);

router.get(
  '/settlements/:id',
  requirePermission(ACTIONS.READ),
  validate(settlementSchemas.idParamSchema),
  settlementController.getOne,
);

router.get(
  '/settlements/:id/pdf',
  // Read, not export: an ex-employee is entitled to their own settlement
  // sheet, and the service scopes the record to them.
  requirePermission(ACTIONS.READ),
  validate(settlementSchemas.idParamSchema),
  settlementController.pdf,
);

router.patch(
  '/settlements/:id/recalculate',
  requirePermission(ACTIONS.UPDATE),
  validate(settlementSchemas.recalculateSchema),
  settlementController.recalculate,
);

router.post(
  '/settlements/:id/submit',
  requirePermission(ACTIONS.UPDATE),
  validate(settlementSchemas.idParamSchema),
  settlementController.submit,
);

router.patch(
  '/settlements/:id/hr-decision',
  requirePermission(ACTIONS.APPROVE),
  validate(settlementSchemas.decisionSchema),
  settlementController.hrDecision,
);

router.patch(
  '/settlements/:id/finance-decision',
  requirePermission(ACTIONS.APPROVE),
  validate(settlementSchemas.decisionSchema),
  settlementController.financeDecision,
);

router.post(
  '/settlements/:id/paid',
  requirePermission(ACTIONS.APPROVE),
  validate(settlementSchemas.markPaidSchema),
  settlementController.markPaid,
);

router.post(
  '/settlements/:id/hold',
  requirePermission(ACTIONS.APPROVE),
  validate(settlementSchemas.holdSchema),
  settlementController.hold,
);

router.post(
  '/settlements/:id/release',
  requirePermission(ACTIONS.APPROVE),
  validate(settlementSchemas.releaseSchema),
  settlementController.release,
);

router.post(
  '/settlements/:id/cancel',
  requirePermission(ACTIONS.APPROVE),
  validate(settlementSchemas.cancelSchema),
  settlementController.cancel,
);

/* ---------------------------------------------------------------- assets -- */

/**
 * The asset register lives here rather than under /employees because its only
 * consumer today is exit recovery. It moves to the Organization module when
 * procurement and depreciation arrive.
 */

router.get(
  '/assets',
  requirePermission(ACTIONS.READ),
  validate(settlementSchemas.listAssetsSchema),
  settlementController.listAssets,
);

router.post(
  '/assets',
  requirePermission(ACTIONS.CREATE),
  validate(settlementSchemas.createAssetSchema),
  settlementController.createAsset,
);

// Bulk import. Declared before `/assets/:id`, which would capture "import".
router.get('/assets/import/template', requirePermission(ACTIONS.CREATE), settlementController.downloadAssetTemplate);

router.post(
  '/assets/import',
  requirePermission(ACTIONS.CREATE),
  spreadsheetUpload.single('file'),
  settlementController.importAssets,
);

router.get(
  '/assets/:id',
  requirePermission(ACTIONS.READ),
  validate(settlementSchemas.idParamSchema),
  settlementController.getAsset,
);

router.post(
  '/assets/:id/assign',
  requirePermission(ACTIONS.UPDATE),
  validate(settlementSchemas.assignAssetSchema),
  settlementController.assignAsset,
);

router.post(
  '/assets/:id/return',
  requirePermission(ACTIONS.UPDATE),
  validate(settlementSchemas.returnAssetSchema),
  settlementController.returnAsset,
);

router.post(
  '/assets/:id/lost',
  // Writing off company property is an approval-grade act.
  requirePermission(ACTIONS.APPROVE),
  validate(settlementSchemas.lostAssetSchema),
  settlementController.markAssetLost,
);

/* ------------------------------------------------------------ settings -- */

router.get('/settings', requirePermission(ACTIONS.READ), controller.getSettings);

router.put(
  '/settings',
  // Statutory rates decide every deduction in the system.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.upsertSettingsSchema),
  controller.upsertSettings,
);

export default router;
