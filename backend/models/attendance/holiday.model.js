import mongoose from 'mongoose';
import { HOLIDAY_TYPES } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * Holiday calendar.
 *
 * Applicability is by exception: an empty `departmentIds` or `locations` means
 * "everyone". Regional holidays differ by office, and modelling the common case
 * as an empty list keeps the usual entry to one row.
 */
const holidaySchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    date: { type: Date, required: true, index: true },
    type: { type: String, enum: Object.values(HOLIDAY_TYPES), default: HOLIDAY_TYPES.PUBLIC },

    description: { type: String, trim: true, maxlength: 300, default: null },

    departmentIds: { type: [Schema.Types.ObjectId], ref: 'Department', default: [] },
    locations: { type: [String], default: [] },

    // Restricted holidays are elective: present in the calendar, but only a
    // holiday for employees who opt in.
    isOptional: { type: Boolean, default: false },
    year: { type: Number, required: true, index: true },

    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

holidaySchema.index({ tenantId: 1, date: 1 }, { unique: true, partialFilterExpression: { isActive: true } });
holidaySchema.index({ tenantId: 1, year: 1, isActive: 1 });

// Kept in sync automatically so the calendar screen can filter by year without
// a range scan, and without the caller having to remember to set it.
holidaySchema.pre('validate', function deriveYear(next) {
  if (this.date) this.year = new Date(this.date).getFullYear();
  next();
});

export default model('Holiday', holidaySchema);
