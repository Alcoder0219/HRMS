/**
 * Shared leave vocabulary for the screens.
 *
 * Mirrors LEAVE_STATUS and LEAVE_ACCRUAL in backend/utils/constants.js. Only
 * the names and their presentation live here -- never the rules, which the
 * server owns and re-checks on every request.
 */

export const LEAVE_STATUS_COLOR = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'error',
  CANCELLED: 'default',
};

export const ACCRUAL_OPTIONS = [
  { value: 'ANNUAL', label: 'Annual', help: 'The whole allowance is granted at the start of the year' },
  { value: 'MONTHLY', label: 'Monthly', help: 'Earned in twelfths as the year runs' },
  { value: 'NONE', label: 'None', help: 'No automatic entitlement — granted by adjustment only' },
];

export const GENDER_OPTIONS = [
  { value: '', label: 'Everyone' },
  { value: 'MALE', label: 'Male only' },
  { value: 'FEMALE', label: 'Female only' },
  { value: 'OTHER', label: 'Other only' },
];

/** Ledger movements, in the order they read on a statement. */
export const LEDGER_LABELS = {
  OPENING: 'Opening entitlement',
  ACCRUAL: 'Accrued',
  CARRY_FORWARD: 'Carried forward',
  TAKEN: 'Taken',
  RETURNED: 'Returned',
  ENCASHED: 'Encashed',
  ADJUSTMENT: 'Adjustment',
  LAPSED: 'Lapsed',
};

export const LEDGER_COLOR = {
  OPENING: 'default',
  ACCRUAL: 'success',
  CARRY_FORWARD: 'info',
  TAKEN: 'warning',
  RETURNED: 'success',
  ENCASHED: 'primary',
  ADJUSTMENT: 'default',
  LAPSED: 'error',
};

export default { LEAVE_STATUS_COLOR, ACCRUAL_OPTIONS, GENDER_OPTIONS, LEDGER_LABELS, LEDGER_COLOR };
