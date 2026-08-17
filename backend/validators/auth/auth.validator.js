import Joi from 'joi';
import { checkPasswordStrength, PASSWORD_POLICY } from '../../helpers/password.helper.js';

const objectId = Joi.string().hex().length(24).messages({
  'string.hex': 'Must be a valid identifier',
  'string.length': 'Must be a valid identifier',
});

/**
 * `tlds: { allow: false }` disables Joi's ICANN allowlist on purpose. Corporate
 * HRMS deployments routinely use internal domains (`.local`, `.internal`, a
 * private TLD), and a baked-in public list would reject legitimate staff
 * addresses while also going stale as new TLDs are delegated.
 */
const email = Joi.string()
  .email({ minDomainSegments: 2, tlds: { allow: false } })
  .lowercase()
  .trim()
  .max(255)
  .required()
  .messages({
    'string.email': 'Enter a valid email address',
    'any.required': 'Email is required',
  });

/**
 * Delegates to the shared policy rather than duplicating it as a regex, so the
 * client receives every unmet rule at once and the policy has a single source
 * of truth.
 */
const strongPassword = Joi.string()
  .min(PASSWORD_POLICY.minLength)
  .max(PASSWORD_POLICY.maxLength)
  .required()
  .custom((value, helpers) => {
    const failures = checkPasswordStrength(value);
    // Joined into one string because Joi renders template variables as text;
    // an array would stringify as "[object Object]"-adjacent noise.
    if (failures.length) return helpers.error('password.weak', { failures: failures.join('; ') });
    return value;
  })
  .messages({
    'password.weak': '{{#failures}}',
    'any.required': 'Password is required',
  });

const name = (label) =>
  Joi.string().trim().min(2).max(60).required().messages({
    'string.min': `${label} must be at least 2 characters`,
    'any.required': `${label} is required`,
  });

/* -------------------------------------------------------------- schemas */

export const registerSchema = {
  body: Joi.object({
    firstName: name('First name'),
    lastName: name('Last name'),
    email,
    password: strongPassword,
    confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({
      'any.only': 'Passwords do not match',
      'any.required': 'Please confirm your password',
    }),
    phone: Joi.string().trim().pattern(/^[+\d][\d\s-]{6,19}$/).allow('', null).messages({
      'string.pattern.base': 'Enter a valid phone number',
    }),
    tenantId: objectId.allow(null),
  }),
};

export const loginSchema = {
  body: Joi.object({
    email,
    // Not strength-validated: an existing password predating a policy change
    // must still be usable to sign in.
    password: Joi.string().required().messages({ 'any.required': 'Password is required' }),
    rememberMe: Joi.boolean().default(false),
    tenantId: objectId.allow(null),
  }),
};

export const refreshSchema = {
  // The refresh token normally arrives in an httpOnly cookie; the body form is
  // the fallback for non-browser clients that cannot hold one.
  body: Joi.object({ refreshToken: Joi.string().allow('', null) }).default({}),
};

export const verifyEmailSchema = {
  body: Joi.object({
    token: Joi.string().hex().length(64).required().messages({
      'string.hex': 'Invalid verification link',
      'string.length': 'Invalid verification link',
      'any.required': 'Verification token is required',
    }),
  }),
};

export const resendVerificationSchema = {
  body: Joi.object({ email, tenantId: objectId.allow(null) }),
};

export const forgotPasswordSchema = {
  body: Joi.object({ email, tenantId: objectId.allow(null) }),
};

export const resetPasswordSchema = {
  body: Joi.object({
    token: Joi.string().hex().length(64).required().messages({
      'string.hex': 'Invalid reset link',
      'string.length': 'Invalid reset link',
      'any.required': 'Reset token is required',
    }),
    newPassword: strongPassword,
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
      'any.only': 'Passwords do not match',
    }),
  }),
};

export const changePasswordSchema = {
  body: Joi.object({
    currentPassword: Joi.string().required().messages({
      'any.required': 'Your current password is required',
    }),
    newPassword: strongPassword.disallow(Joi.ref('currentPassword')).messages({
      'any.invalid': 'Your new password must be different from the current one',
    }),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required().messages({
      'any.only': 'Passwords do not match',
    }),
  }),
};

export const loginHistorySchema = {
  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

export default {
  registerSchema,
  loginSchema,
  refreshSchema,
  verifyEmailSchema,
  resendVerificationSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  loginHistorySchema,
};
