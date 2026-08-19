import bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';
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

/**
 * A random password that satisfies the policy above by construction.
 *
 * Used when an administrator enables portal access without choosing one. It is
 * shown to them once and never stored in the clear, so the account still has to
 * change it at first sign-in.
 *
 * One character is drawn from each required class before the remainder is
 * filled, then the whole thing is shuffled -- a purely random draw from the
 * combined alphabet satisfies the complexity rules only by luck, and would
 * occasionally produce a password its own validator rejects.
 *
 * `randomInt` rather than `Math.random`: this is a credential, and a
 * per-process seed that can repeat between workers started in the same tick is
 * not an acceptable source for one.
 *
 * The ambiguous glyphs are left out on purpose. This password gets read aloud
 * or copied off a screen, and O/0 and l/1 are where that goes wrong.
 */
const PASSWORD_ALPHABET = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*?',
};

export const generatePassword = (length = 14) => {
  const classes = Object.values(PASSWORD_ALPHABET);
  const all = classes.join('');

  const pick = (alphabet) => alphabet[randomInt(0, alphabet.length)];

  const characters = [
    ...classes.map(pick),
    ...Array.from({ length: Math.max(0, length - classes.length) }, () => pick(all)),
  ];

  // Fisher-Yates: without a shuffle the first four characters would always be
  // lower, upper, digit, symbol in that order, which is a pattern worth not
  // publishing.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swap = randomInt(0, index + 1);
    [characters[index], characters[swap]] = [characters[swap], characters[index]];
  }

  return characters.join('');
};
