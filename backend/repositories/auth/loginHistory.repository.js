import LoginHistory from '../../models/auth/loginHistory.model.js';

export const record = (payload) => LoginHistory.create(payload);

export const findByUser = async (userId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;

  // Count and page fetched together: the client needs both to render
  // pagination, and two round trips would let them disagree.
  const [items, total] = await Promise.all([
    LoginHistory.find({ userId }).sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
    LoginHistory.countDocuments({ userId }),
  ]);

  return { items, total, page, limit };
};

/** Powers the "N failed attempts since your last sign-in" security notice. */
export const countRecentFailures = (email, sinceMs) =>
  LoginHistory.countDocuments({
    email: String(email).toLowerCase(),
    status: 'FAILED',
    occurredAt: { $gt: new Date(Date.now() - sinceMs) },
  });

export default { record, findByUser, countRecentFailures };
