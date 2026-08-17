import bcrypt from 'bcrypt';
import env from '../config/env.js';

/**
 * A pre-computed hash of a throwaway value. When a login targets an unknown
 * email we still run one bcrypt comparison against this, so the response time
 * of "no such user" matches "wrong password" and the endpoint cannot be used
 * to enumerate accounts.
 */
const DUMMY_HASH = bcrypt.hashSync('hrms::timing::equalizer', env.bcryptSaltRounds);

export const hashPassword = (plain) => bcrypt.hash(plain, env.bcryptSaltRounds);

export const comparePassword = (plain, hash) => bcrypt.compare(plain, hash);

/** Burns the same time as a real comparison without revealing anything. */
export const fakeComparePassword = (plain = '') => bcrypt.compare(plain, DUMMY_HASH);

export const PASSWORD_POLICY = {
  minLength: 10,
  maxLength: 128,
  // Rejected outright regardless of complexity score.
  blocklist: ['password', 'passw0rd', 'welcome', 'admin', 'hrms', 'qwerty', '12345678'],
};

/**
 * Returns the list of unmet rules. Empty array means the password is
 * acceptable. Used by the Joi validator so the client receives every failing
 * rule at once instead of one per submission.
 */
export const checkPasswordStrength = (password = '') => {
  const failures = [];

  if (password.length < PASSWORD_POLICY.minLength) {
    failures.push(`Must be at least ${PASSWORD_POLICY.minLength} characters`);
  }
  if (password.length > PASSWORD_POLICY.maxLength) {
    failures.push(`Must be at most ${PASSWORD_POLICY.maxLength} characters`);
  }
  if (!/[a-z]/.test(password)) failures.push('Must contain a lowercase letter');
  if (!/[A-Z]/.test(password)) failures.push('Must contain an uppercase letter');
  if (!/\d/.test(password)) failures.push('Must contain a number');
  if (!/[^A-Za-z0-9]/.test(password)) failures.push('Must contain a special character');

  const lowered = password.toLowerCase();
  if (PASSWORD_POLICY.blocklist.some((word) => lowered.includes(word))) {
    failures.push('Must not contain a common or predictable word');
  }

  return failures;
};
