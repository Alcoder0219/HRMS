import Role from '../../models/auth/role.model.js';
import User from '../../models/auth/user.model.js';

export const findAll = () => Role.find().sort({ isSystem: -1, rank: -1, label: 1 });

export const findById = (id) => Role.findById(id);

export const findByCode = (code) => Role.findOne({ code });

export const findByLabel = (label) => Role.findOne({ label: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') });

export const create = (payload) => Role.create(payload);

export const updateById = (id, update) => Role.findByIdAndUpdate(id, update, { new: true, runValidators: true });

export const deleteById = (id) => Role.findByIdAndDelete(id);

/** One count per role code, for "N users hold this role" across the whole catalogue. */
export const countUsersByRole = async () => {
  const rows = await User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((row) => [row._id, row.count]));
};

export const countUsersForRole = (code) => User.countDocuments({ role: code });

export default {
  findAll,
  findById,
  findByCode,
  findByLabel,
  create,
  updateById,
  deleteById,
  countUsersByRole,
  countUsersForRole,
};
