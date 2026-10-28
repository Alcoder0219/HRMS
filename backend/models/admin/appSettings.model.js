import mongoose from 'mongoose';
import { CURRENCY } from '../../utils/constants.js';

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
    // The employer's own registrations, quoted on the monthly returns.
    tinNumber: { type: String, trim: true, uppercase: true, maxlength: 20, default: null },
    nssfCode: { type: String, trim: true, uppercase: true, maxlength: 30, default: null },
    nhifCode: { type: String, trim: true, uppercase: true, maxlength: 30, default: null },
    wcfCode: { type: String, trim: true, uppercase: true, maxlength: 30, default: null },

    email: { type: String, trim: true, lowercase: true, maxlength: 120, default: null },
    phone: { type: String, trim: true, maxlength: 20, default: null },
    website: { type: String, trim: true, maxlength: 150, default: null },

    addressLine1: { type: String, trim: true, maxlength: 150, default: null },
    addressLine2: { type: String, trim: true, maxlength: 150, default: null },
    city: { type: String, trim: true, maxlength: 80, default: null },
    state: { type: String, trim: true, maxlength: 80, default: null },
    country: { type: String, trim: true, maxlength: 80, default: 'Tanzania' },
    postalCode: { type: String, trim: true, maxlength: 12, default: null },

    logoPath: { type: String, default: null },
    // Tanzania's tax year is the calendar year.
    financialYearStartMonth: { type: Number, min: 1, max: 12, default: 1 },
    dateFormat: { type: String, trim: true, maxlength: 20, default: 'dd MMM yyyy' },
    // The ISO code; the symbol shown to a reader is TSH. See CURRENCY.
    currency: { type: String, trim: true, uppercase: true, maxlength: 3, default: CURRENCY.CODE },
    timezone: { type: String, trim: true, maxlength: 60, default: 'Africa/Dar_es_Salaam' },
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

/* -------------------------------------------------------------------------- */
/*                             Biometric devices                              */
/* -------------------------------------------------------------------------- */

/**
 * One device enrolment mapped to one employee.
 *
 * A biometric terminal knows its own user IDs -- usually a short number typed
 * in when the finger was enrolled -- and knows nothing about employee codes.
 * Nothing can reconcile the two automatically, so the mapping is held here and
 * maintained by an administrator.
 *
 * Deliberately NOT a field on the employee. The same person can be enrolled on
 * two devices under two different IDs, and a single field on the employee could
 * only ever record one of them.
 */
const biometricUserMappingSchema = new Schema(
  {
    deviceUserId: { type: String, required: true, trim: true, maxlength: 30 },
    employeeCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    // Carried across from the device so the mapping screen can show who a
    // device ID belongs to without a second round trip.
    deviceUserName: { type: String, trim: true, maxlength: 120, default: null },
  },
  { _id: false },
);

/**
 * A command waiting for an ADMS terminal to collect it.
 *
 * Persisted rather than held in memory: the terminal's next poll may land on a
 * different instance from the one that queued the command, and a queue that
 * lived in one process would be lost on every deploy.
 */
const admsCommandSchema = new Schema(
  {
    commandId: { type: Number, required: true },
    type: { type: String, required: true, trim: true, maxlength: 30 },
    // The time window, for an attendance re-upload request.
    from: { type: Date, default: null },
    to: { type: Date, default: null },
    status: { type: String, enum: ['QUEUED', 'SENT', 'DONE', 'FAILED', 'EXPIRED'], default: 'QUEUED' },
    returnCode: { type: Number, default: null },
    queuedAt: { type: Date, default: Date.now },
    sentAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

/**
 * Someone enrolled on an ADMS terminal, as the terminal announced them.
 *
 * An ADMS device cannot be read on demand the way a LAN terminal can -- it
 * calls in, it is never called -- so the mapping screen works from what the
 * device last reported. PIN, name and privilege only: the user's device
 * passcode and card number arrive on the same row and are never kept.
 */
const admsEnrolmentSchema = new Schema(
  {
    userId: { type: String, required: true, trim: true, maxlength: 30 },
    name: { type: String, trim: true, maxlength: 120, default: null },
    privilege: { type: Number, default: null },
    reportedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

/**
 * What the HRMS knows about an ADMS terminal's push session.
 *
 * Everything here is written by the receiver, never by the settings form --
 * the same rule `lastSyncAt` follows, for the same reason.
 */
const admsStateSchema = new Schema(
  {
    lastSeenAt: { type: Date, default: null },
    lastSeenIp: { type: String, trim: true, maxlength: 64, default: null },
    lastHandshakeAt: { type: Date, default: null },
    pushVersion: { type: String, trim: true, maxlength: 30, default: null },
    firmware: { type: String, trim: true, maxlength: 80, default: null },
    deviceModel: { type: String, trim: true, maxlength: 80, default: null },

    // Resume points the terminal sends with each upload and is handed back on
    // its next handshake, so a reboot does not resend the whole log.
    attlogStamp: { type: String, trim: true, maxlength: 30, default: null },
    operlogStamp: { type: String, trim: true, maxlength: 30, default: null },

    lastEventAt: { type: Date, default: null },
    lastEventReceivedAt: { type: Date, default: null },

    nextCommandId: { type: Number, default: 1 },
    commands: { type: [admsCommandSchema], default: [] },

    enrolments: { type: [admsEnrolmentSchema], default: [] },
    enrolmentsReportedAt: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * A physical attendance terminal.
 *
 * Kept inside AppSettings rather than in a collection of its own, for the same
 * reason the mail configuration is: it is administrator-configured, read
 * whenever the settings screen renders, written by the same person on the same
 * page, and a tenant has a handful of them rather than thousands.
 */
const biometricDeviceSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    // Where the terminal is and anything worth knowing about it. Free text for
    // the administrator; nothing reads it.
    location: { type: String, trim: true, maxlength: 120, default: null },
    notes: { type: String, trim: true, maxlength: 500, default: null },
    /**
     * Not required for ADMS_PUSH: that terminal calls in from whatever address
     * the office router gives it, and is identified by its serial instead.
     */
    ipAddress: {
      type: String,
      trim: true,
      maxlength: 45,
      default: null,
      required: function requiredUnlessPush() {
        return this.protocol !== 'ADMS_PUSH';
      },
    },
    // 4370 is the ZKTeco SDK port. Web firmware and WDMS both answer on 8081.
    port: { type: Number, required: true, min: 1, max: 65535, default: 4370 },
    /**
     * How this endpoint is spoken to.
     *
     * The first two are the SDK over a raw socket and reach a TERMINAL on the
     * local network. The last three are HTTP:
     *
     *   ZK_WEB / GENERIC_API -- a terminal whose own firmware serves its logs
     *     over HTTP, as tab-separated text.
     *   WDMS_API -- a ZKTeco WDMS/BioTime SERVER that terminals push to, which
     *     is a different thing entirely: it aggregates many devices, it is
     *     reachable over the internet, and it needs credentials.
     *
     * And one that inverts the direction:
     *
     *   ADMS_PUSH -- the terminal's own "Cloud Server / ADMS" setting pointed at
     *     THIS server. Nothing is polled; the device calls the `/iclock`
     *     receiver and is recognised by its serial number.
     */
    protocol: {
      type: String,
      enum: ['ZK_UDP', 'ZK_TCP', 'ZK_WEB', 'GENERIC_API', 'WDMS_API', 'ADMS_PUSH'],
      default: 'ZK_UDP',
    },
    // Required for ADMS_PUSH, where it is the device's identity -- enforced by
    // the validator and the service, which also keep it unique across tenants.
    serialNumber: { type: String, trim: true, maxlength: 60, default: null },

    /**
     * Punches timed before this are stored but not applied to attendance.
     *
     * A terminal connecting for the first time uploads its entire memory --
     * months of punches -- and recomputing all of those days would rewrite
     * attendance payroll may already have paid. Pull devices bound this with
     * their first-sync window; a push device has no window, so it has this.
     * Back-dating it and reprocessing IGNORED events is the deliberate way to
     * import the backlog.
     */
    acceptPunchesFrom: { type: Date, default: null },

    adms: { type: admsStateSchema, default: () => ({}) },

    /**
     * Credentials, for the endpoints that need them.
     *
     * WDMS is a multi-tenant server holding every employee's attendance, so it
     * authenticates -- unlike a terminal on the office LAN, which answers
     * anyone who can reach the socket.
     *
     * `select: false` on the password for the same reason the mail password
     * carries it: a service that forgets to strip it gets undefined rather than
     * the secret. It is never returned to a client in any form.
     */
    username: { type: String, trim: true, maxlength: 150, default: null },
    password: { type: String, default: null, select: false },

    /**
     * Restricts a WDMS pull to one terminal.
     *
     * A WDMS server carries punches from every device registered to it, which
     * for a multi-site tenant is not what a single HRMS device row should
     * import. Null means take everything the server has.
     */
    wdmsTerminalSerial: { type: String, trim: true, maxlength: 60, default: null },

    isActive: { type: Boolean, default: true },
    autoSync: { type: Boolean, default: true },
    syncIntervalMinutes: { type: Number, min: 1, max: 1440, default: 5 },

    /**
     * The high-water mark, and the only thing that stops a sync re-importing
     * the device's entire log every few minutes.
     *
     * It is the timestamp of the newest punch actually taken, not the clock
     * time of the last run -- a device whose clock is behind the server's would
     * otherwise have its punches skipped forever.
     */
    lastSyncAt: { type: Date, default: null },
    lastSyncStatus: {
      type: String,
      enum: ['SUCCESS', 'FAILED', 'PARTIAL', 'NEVER', null],
      default: null,
    },
    lastSyncMessage: { type: String, trim: true, maxlength: 500, default: null },
    lastSyncPunchCount: { type: Number, default: 0 },
    // Clock time of the last attempt, successful or not. Drives the "is this
    // device due?" test, which must advance even when a device is offline so a
    // dead terminal is not retried on every tick of the job.
    lastAttemptAt: { type: Date, default: null },

    userMappings: { type: [biometricUserMappingSchema], default: [] },
  },
  { _id: true, timestamps: true },
);

/**
 * The address an ADMS terminal must be told to call.
 *
 * A property of where the receiver (or the gateway in front of it) was
 * deployed -- a VM's public IP, say -- which the HRMS cannot discover by
 * itself. Stored so an administrator can enter it without a redeploy; the
 * ADMS_DEVICE_SERVER_ADDRESS environment variable, when set, takes precedence.
 * Display only: nothing routes by it.
 */
const admsReceiverSchema = new Schema(
  {
    serverAddress: { type: String, trim: true, maxlength: 253, default: null },
    serverPort: { type: Number, min: 1, max: 65535, default: 8081 },
    https: { type: Boolean, default: false },
    updatedAt: { type: Date, default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
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
    biometricDevices: { type: [biometricDeviceSchema], default: [] },
    admsReceiver: { type: admsReceiverSchema, default: () => ({}) },

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

// The ADMS receiver resolves every request -- a heartbeat every few seconds --
// from a serial number to its tenant and device. Without this that is a scan.
appSettingsSchema.index({ 'biometricDevices.serialNumber': 1 });

export default model('AppSettings', appSettingsSchema);
