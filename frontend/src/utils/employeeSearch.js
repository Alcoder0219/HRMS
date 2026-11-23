/**
 * Searching the employee list API by a typed phrase.
 *
 * The server matches each field (code, employee ID, first name, last name...)
 * from its start, so a full name such as "Abdalla Ali" matches no single field.
 * The first word goes to the server; the whole phrase then narrows what came
 * back, against the full name and the identifiers.
 */

export const employeeName = (employee) => [employee?.firstName, employee?.lastName].filter(Boolean).join(' ');

/** What to send as `search`: the first word typed, or nothing. */
export const serverSearchTerm = (term) => String(term ?? '').trim().split(/\s+/)[0] ?? '';

/** Whether an employee the server returned matches the whole phrase typed. */
export const matchesPhrase = (employee, term) => {
  const phrase = String(term ?? '').trim().toLowerCase();
  if (!phrase.includes(' ')) return true;
  return [employeeName(employee), employee?.employeeCode, employee?.employeeId].some((value) =>
    String(value ?? '').toLowerCase().includes(phrase),
  );
};

export default { employeeName, serverSearchTerm, matchesPhrase };
