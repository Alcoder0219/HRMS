import mongoose from 'mongoose';
import { ASSET_CATEGORY, ASSET_STATUS, ASSET_CONDITION } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * One assignment of an asset to a person, kept as history rather than being
 * overwritten. A laptop passes through several holders, and "who had it when
 * it was damaged" is exactly the question the register exists to answer.
 */
const assignmentSchema = new Schema(
  {
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', required: true },
    assignedOn: { type: Date, required: true, default: Date.now },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    conditionOnIssue: { type: String, enum: Object.values(ASSET_CONDITION), default: ASSET_CONDITION.GOOD },

    returnedOn: { type: Date, default: null },
    returnedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    conditionOnReturn: { type: String, enum: [...Object.values(ASSET_CONDITION), null], default: null },

    // Charged at settlement when the item comes back damaged or not at all.
    recoveryAmount: { type: Number, default: 0, min: 0 },
    remarks: { type: String, trim: true, maxlength: 300, default: null },
  },
  { _id: true },
);

/**
 * Company asset register.
 *
 * Exists primarily so exit settlement has something authoritative to recover
 * against -- "did they return the laptop" cannot be answered from a
 * spreadsheet at the moment someone's final payment is being calculated.
 */
const assetSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    assetCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 30 },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: Object.values(ASSET_CATEGORY), default: ASSET_CATEGORY.OTHER, index: true },

    serialNumber: { type: String, trim: true, maxlength: 60, default: null },
    make: { type: String, trim: true, maxlength: 60, default: null },
    model: { type: String, trim: true, maxlength: 60, default: null },

    purchaseDate: { type: Date, default: null },
    purchaseCost: { type: Number, default: 0, min: 0 },
    /**
     * What is charged if the item is not returned. Separate from purchase cost
     * because recovery is normally the depreciated or agreed value, and using
     * the original price would over-recover on a four-year-old laptop.
     */
    recoveryValue: { type: Number, default: 0, min: 0 },

    status: {
      type: String,
      enum: Object.values(ASSET_STATUS),
      default: ASSET_STATUS.AVAILABLE,
      index: true,
    },
    condition: { type: String, enum: Object.values(ASSET_CONDITION), default: ASSET_CONDITION.NEW },

    // Denormalised current holder, so the exit checklist is one query.
    currentHolderId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    assignments: { type: [assignmentSchema], default: [] },

    notes: { type: String, trim: true, maxlength: 500, default: null },
    isActive: { type: Boolean, default: true },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

assetSchema.index({ tenantId: 1, assetCode: 1 }, { unique: true });
// The exit query: everything still held by this person.
assetSchema.index({ currentHolderId: 1, status: 1 });

assetSchema.virtual('currentAssignment').get(function currentAssignment() {
  return (this.assignments ?? []).find((entry) => !entry.returnedOn) ?? null;
});

export default model('Asset', assetSchema);
