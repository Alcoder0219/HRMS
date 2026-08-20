import mongoose from 'mongoose';
import env from '../../config/env.js';
import { ROLES, ACCOUNT_STATUS } from '../../utils/constants.js';
import { getRoleCache } from '../../services/auth/roleCache.service.js';

const { Schema, model } = mongoose;

/**
 * The authentication identity. Deliberately separate from the (future)
 * Employee document: an employee is HR data with a lifecycle of its own, while
 * this is a credential record. Keeping them apart means an employee can be
 * offboarded without destroying the audit trail, and a login can exist before
 * an employee profile does.
 */
const userSchema = new Schema(
  {
    tenantId: {
      type: Schema.Types.ObjectId,
      ref: 'Tenant',
      /**
       * Nullable on purpose, for two distinct cases: SUPER_ADMIN operates
       * above tenants and legitimately has none, and a self-registered
       * identity exists before it is attached to a customer organisation.
       * Tenant assignment is a provisioning concern, enforced by the Tenant
       * module's invite flow rather than by this schema.
       */
      default: null,
      index: true,
    },

    email: {
      type: String,
      required: [true, 'Email is required'],
      trim: true,
      lowercase: true,
      maxlength: 255,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Invalid email address'],
    },

    password: {
      type: String,
      required: [true, 'Password is required'],
      // Never returned unless a query opts in with .select('+password').
      select: false,
    },

    firstName: { type: String, required: true, trim: true, maxlength: 60 },
    lastName: { type: String, required: true, trim: true, maxlength: 60 },
    phone: { type: String, trim: true, maxlength: 20 },
    avatar: { type: String, default: null },

    role: {
      type: String,
      trim: true,
      uppercase: true,
      // Checked against the live Role collection (via its in-memory cache)
      // rather than a fixed enum, so a role created after the app was built
      // -- not just the ten seeded ones -- can be assigned. The cache lookup
      // is synchronous, so this stays an ordinary Mongoose validator.
      validate: {
        validator: (value) => Boolean(getRoleCache()[value]),
        message: '{VALUE} is not a valid role',
      },
      default: ROLES.EMPLOYEE,
      index: true,
    },

    /**
     * Link to the HR record and its department. Both stay null until the
     * Employee module populates them; the RBAC scope filters read them to
     * narrow SELF, TEAM and DEPARTMENT queries, and fall back to the user id
     * while they are absent.
     */
    employeeId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null, index: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'Department', default: null, index: true },

    status: {
      type: String,
      enum: Object.values(ACCOUNT_STATUS),
      default: ACCOUNT_STATUS.PENDING,
      index: true,
    },

    isEmailVerified: { type: Boolean, default: false },
    emailVerifiedAt: { type: Date, default: null },

    /* ------------------------------------------------ brute-force defence */
    failedLoginAttempts: { type: Number, default: 0 },
    lockUntil: { type: Date, default: null },
    lastFailedLoginAt: { type: Date, default: null },

    /* ------------------------------------------------------ password state */
    // Access tokens issued before this instant are rejected, which is what
    // makes "change password signs out every device" actually true.
    passwordChangedAt: { type: Date, default: null },
    mustChangePassword: { type: Boolean, default: false },
    // Hashes only, capped by PASSWORD_HISTORY_SIZE, to block immediate reuse.
    passwordHistory: { type: [String], default: [], select: false },

    /* ---------------------------------------------------------- last seen */
    lastLoginAt: { type: Date, default: null },
    lastLoginIp: { type: String, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform(_doc, ret) {
        // Defence in depth: even if a query selects them, credentials never
        // reach a JSON response.
        delete ret.password;
        delete ret.passwordHistory;
        delete ret.__v;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

/* --------------------------------------------------------------- indexes */

// Email is unique per tenant, not globally: the same person may hold accounts
// in two customer organisations, and a global unique index would block that.
userSchema.index({ tenantId: 1, email: 1 }, { unique: true });
userSchema.index({ tenantId: 1, status: 1, role: 1 });

/* -------------------------------------------------------------- virtuals */

/**
 * Both halves are required on the schema, so this looks over-careful -- but a
 * PROJECTED document has only the fields that were selected, and the virtual
 * still runs. Populating a user with `select: 'email role status'` produced
 * the string "undefined undefined" in every employee response, which is the
 * kind of value that gets rendered on a screen before anyone notices.
 */
userSchema.virtual('fullName').get(function fullName() {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockUntil && this.lockUntil.getTime() > Date.now());
});

/* --------------------------------------------------------------- methods */

/**
 * True when the token was issued before the last password change -- the check
 * that makes "changing your password signs out every device" actually hold.
 *
 * Prefers the token's millisecond `iatMs` claim. Comparing the standard
 * whole-second `iat` in either direction is wrong at the boundary: rounding
 * down lets a token issued earlier in the same second survive the change,
 * while rounding up rejects a token legitimately issued just after it. The
 * second-precision path remains only as a fallback for tokens minted before
 * this claim existed.
 */
userSchema.methods.isTokenStale = function isTokenStale(payload) {
  if (!this.passwordChangedAt) return false;
  const issuedAtMs = payload.iatMs ?? payload.iat * 1000;
  return issuedAtMs < this.passwordChangedAt.getTime();
};

userSchema.methods.canLogin = function canLogin() {
  if (this.isLocked) return { allowed: false, status: ACCOUNT_STATUS.LOCKED };
  if (this.status === ACCOUNT_STATUS.SUSPENDED) {
    return { allowed: false, status: ACCOUNT_STATUS.SUSPENDED };
  }
  if (this.status === ACCOUNT_STATUS.DEACTIVATED) {
    return { allowed: false, status: ACCOUNT_STATUS.DEACTIVATED };
  }
  if (env.auth.requireEmailVerification && !this.isEmailVerified) {
    return { allowed: false, status: ACCOUNT_STATUS.PENDING };
  }
  return { allowed: true };
};

export default model('User', userSchema);
