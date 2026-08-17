import mongoose from 'mongoose';
import { ATTENDANCE_SOURCE } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * One uploaded day within a monthly sheet.
 *
 * Times are `HH:mm` strings, exactly as they appear in the workbook. Storing
 * them as Dates here would bake a timezone into a figure the spreadsheet
 * expressed as wall-clock, and the sheet's job is to record what was uploaded.
 */
const sheetDaySchema = new Schema(
  {
    day: { type: Number, required: true, min: 1, max: 31 },
    inTime: { type: String, default: null, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'] },
    outTime: { type: String, default: null, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm'] },
    // Per-day note from validation, e.g. "out before in".
    remark: { type: String, trim: true, maxlength: 120, default: null },
  },
  { _id: false },
);

/**
 * A month of attendance for one employee, as uploaded.
 *
 * ONE DOCUMENT PER EMPLOYEE PER MONTH, per the import specification.
 *
 * This is the import artifact and the audit record of what the spreadsheet
 * contained -- not a replacement for the daily `Attendance` collection. The
 * daily records remain the operational store that the rules engine,
 * regularization, payroll and every existing report read from; a sheet is
 * projected onto them after validation.
 *
 * Keeping both is deliberate. Collapsing attendance into monthly documents
 * would make "show me everyone absent yesterday" a scan of every employee's
 * month, and would leave regularization with nothing to attach to.
 */
const attendanceSheetSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    /**
     * The identifier exactly as it appeared in the workbook.
     *
     * Retained verbatim alongside the resolved reference so a support query can
     * be answered from the sheet without re-reading the original file.
     */
    employeeId: { type: String, required: true, trim: true, index: true },
    employeeRef: { type: Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
    employeeName: { type: String, trim: true, maxlength: 150, default: null },

    month: { type: Number, required: true, min: 1, max: 12 },
    year: { type: Number, required: true, min: 2000, max: 2100 },

    // Free text from the sheet, plus the master it resolved to when one matched.
    unit: { type: String, trim: true, maxlength: 120, default: null },
    unitId: { type: Schema.Types.ObjectId, ref: 'Unit', default: null },

    attendance: { type: [sheetDaySchema], default: [] },

    /**
     * Totals derived when the sheet is projected onto daily records.
     *
     * Stored so a monthly report can be served from one document instead of
     * aggregating 31 daily rows per employee.
     */
    summary: {
      type: new Schema(
        {
          present: { type: Number, default: 0 },
          absent: { type: Number, default: 0 },
          halfDay: { type: Number, default: 0 },
          weeklyOff: { type: Number, default: 0 },
          holiday: { type: Number, default: 0 },
          lateComing: { type: Number, default: 0 },
          earlyGoing: { type: Number, default: 0 },
          missingPunch: { type: Number, default: 0 },
          workedMinutes: { type: Number, default: 0 },
          overtimeMinutes: { type: Number, default: 0 },
          payableDays: { type: Number, default: 0 },
        },
        { _id: false },
      ),
      default: () => ({}),
    },

    /* ----------------------------------------------------------- import -- */
    source: { type: String, enum: Object.values(ATTENDANCE_SOURCE), default: ATTENDANCE_SOURCE.CSV },
    // Groups every sheet written by one upload, so a bad import can be found
    // and reversed as a unit. Stands in for a transaction, which a standalone
    // MongoDB deployment cannot provide.
    // Indexed once, explicitly, below -- declaring it here as well would create
    // two indexes on the same key.
    importBatchId: { type: String, default: null },
    fileName: { type: String, trim: true, maxlength: 260, default: null },

    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    uploadedAt: { type: Date, default: Date.now },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

/* --------------------------------------------------------------- indexes */

// The invariant the whole import rests on: one sheet per employee per month.
// Every write upserts against it, so re-uploading a month replaces rather than
// duplicates.
attendanceSheetSchema.index({ employeeRef: 1, year: 1, month: 1 }, { unique: true });

// Period listing for a tenant, and the reverse lookup by uploaded identifier.
attendanceSheetSchema.index({ tenantId: 1, year: -1, month: -1 });
attendanceSheetSchema.index({ tenantId: 1, employeeId: 1, year: -1, month: -1 });
attendanceSheetSchema.index({ importBatchId: 1 });

attendanceSheetSchema.virtual('period').get(function period() {
  return `${String(this.month).padStart(2, '0')}-${this.year}`;
});

export default model('AttendanceSheet', attendanceSheetSchema);
