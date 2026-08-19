import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * Unit / plant / site master.
 *
 * A tenant with more than one location needs statutory registrations per site
 * -- NSSF and NHIF employer codes are issued to the establishment, not the
 * company -- so they live here rather than only on tenant settings. The
 * employee's unit is what decides which registration their filings go under.
 *
 * There is no per-region levy field here. Tanzanian statutory contributions are
 * national, unlike the Indian professional tax and labour welfare fund this
 * replaced, which were levied state by state and had to follow the site.
 */
const unitSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    name: { type: String, required: true, trim: true, maxlength: 120 },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },

    // Seeds the employee's work location when a unit is chosen.
    city: { type: String, trim: true, maxlength: 80, default: null },
    state: { type: String, trim: true, maxlength: 80, default: null },
    address: { type: String, trim: true, maxlength: 300, default: null },

    nssfEmployerCode: { type: String, trim: true, uppercase: true, maxlength: 40, default: null },
    nhifEmployerCode: { type: String, trim: true, uppercase: true, maxlength: 40, default: null },
    wcfEmployerCode: { type: String, trim: true, uppercase: true, maxlength: 40, default: null },

    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

unitSchema.index({ tenantId: 1, code: 1 }, { unique: true });

export default model('Unit', unitSchema);
