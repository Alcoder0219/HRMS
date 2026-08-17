import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * The company's identity as it appears on documents.
 *
 * Separate from the Employee-facing organisation masters: those describe the
 * shape of the company, this describes the legal entity that signs a payslip.
 */
const companyProfileSchema = new Schema(
  {
    name: { type: String, trim: true, maxlength: 150, default: null },
    legalName: { type: String, trim: true, maxlength: 200, default: null },
    registrationNumber: { type: String, trim: true, maxlength: 60, default: null },
    taxNumber: { type: String, trim: true, uppercase: true, maxlength: 30, default: null },
    pan: { type: String, trim: true, uppercase: true, maxlength: 10, default: null },
    pfCode: { type: String, trim: true, uppercase: true, maxlength: 30, default: null },
    esiCode: { type: String, trim: true, uppercase: true, maxlength: 30, default: null },

    email: { type: String, trim: true, lowercase: true, maxlength: 120, default: null },
    phone: { type: String, trim: true, maxlength: 20, default: null },
    website: { type: String, trim: true, maxlength: 150, default: null },

    addressLine1: { type: String, trim: true, maxlength: 150, default: null },
    addressLine2: { type: String, trim: true, maxlength: 150, default: null },
    city: { type: String, trim: true, maxlength: 80, default: null },
    state: { type: String, trim: true, maxlength: 80, default: null },
    country: { type: String, trim: true, maxlength: 80, default: 'India' },
    postalCode: { type: String, trim: true, maxlength: 12, default: null },

    logoPath: { type: String, default: null },
    financialYearStartMonth: { type: Number, min: 1, max: 12, default: 4 },
    dateFormat: { type: String, trim: true, maxlength: 20, default: 'dd MMM yyyy' },
    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: 'INR' },
    timezone: { type: String, trim: true, maxlength: 60, default: 'Asia/Kolkata' },
  },
  { _id: false },
);

/**
 * Outbound mail.
 *
 * The password is `select: false` so it cannot leave by accident -- a service
 * that forgets to strip it gets undefined rather than the secret. Reads go
 * through the settings service, which reports whether a password is set
 * without ever returning it.
 */
const emailConfigSchema = new Schema(
  {
    enabled: { type: Boolean, default: false },
    host: { type: String, trim: true, maxlength: 150, default: null },
    port: { type: Number, min: 1, max: 65535, default: 587 },
    secure: { type: Boolean, default: false },
    username: { type: String, trim: true, maxlength: 150, default: null },
    password: { type: String, default: null, select: false },
    fromName: { type: String, trim: true, maxlength: 100, default: null },
    fromAddress: { type: String, trim: true, lowercase: true, maxlength: 150, default: null },
    replyTo: { type: String, trim: true, lowercase: true, maxlength: 150, default: null },

    lastTestedAt: { type: Date, default: null },
    lastTestOk: { type: Boolean, default: null },
    lastTestError: { type: String, trim: true, maxlength: 500, default: null },
  },
  { _id: false },
);

/**
 * Which events send mail, and to whom.
 *
 * A flat list of switches rather than per-user preferences: this is the
 * organisation's policy on what the system announces. Individual opt-outs are
 * a different feature and would belong on the user.
 */
const notificationSettingsSchema = new Schema(
  {
    leaveRequested: { type: Boolean, default: true },
    leaveDecided: { type: Boolean, default: true },
    payslipPublished: { type: Boolean, default: false },
    attendanceMissing: { type: Boolean, default: false },
    regularizationRaised: { type: Boolean, default: true },
    loanDecided: { type: Boolean, default: true },
    settlementApproved: { type: Boolean, default: true },
    offerSent: { type: Boolean, default: true },
    interviewScheduled: { type: Boolean, default: true },
    accountLocked: { type: Boolean, default: true },
    passwordChanged: { type: Boolean, default: true },

    // Copied on everything above. Kept as a list because "who watches the
    // system" is usually two or three people, not a role.
    adminRecipients: { type: [String], default: [] },
    dailyDigestHour: { type: Number, min: 0, max: 23, default: null },
  },
  { _id: false },
);

/**
 * Everything an administrator configures, as one document per tenant.
 *
 * One document rather than three collections: company profile, mail and
 * notification policy are always read together when rendering a page or
 * sending anything, they are written by the same person on the same screen,
 * and splitting them would mean three near-identical CRUD paths guarding a
 * single logical record.
 */
const appSettingsSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, unique: true, index: true },

    company: { type: companyProfileSchema, default: () => ({}) },
    email: { type: emailConfigSchema, default: () => ({}) },
    notifications: { type: notificationSettingsSchema, default: () => ({}) },

    // Set while a restore is running so a second one cannot start alongside it.
    maintenanceMode: { type: Boolean, default: false },
    maintenanceMessage: { type: String, trim: true, maxlength: 300, default: null },

    lastBackupAt: { type: Date, default: null },
    lastBackupBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    lastRestoreAt: { type: Date, default: null },
    lastRestoreBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default model('AppSettings', appSettingsSchema);
