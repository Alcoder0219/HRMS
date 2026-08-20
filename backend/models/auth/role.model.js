import mongoose from 'mongoose';
import { SCOPES } from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * A role and the permissions it grants. Global across every tenant, not
 * tenant-scoped -- the same guarantee `backend/config/permissions.js` used to
 * make in code (the description on `Role.isSystem` explains why the ten
 * built-in rows are still protected).
 *
 * `permissions` mirrors the shape `PERMISSION_MATRIX` used in code:
 * `{ resource: 'payroll', actions: ['read', 'approve'] }`, with `'*'` as a
 * wildcard resource or action (Super Admin's grant).
 */
const roleSchema = new Schema(
  {
    code: { type: String, required: true, trim: true, uppercase: true, unique: true, maxlength: 40 },
    label: { type: String, required: true, trim: true, maxlength: 60 },
    description: { type: String, trim: true, maxlength: 300, default: '' },
    scope: { type: String, enum: Object.values(SCOPES), required: true },

    // Seniority rank for "this role or above" checks -- see ROLE_RANK's caveat
    // in utils/constants.js. Not a permission; a purely hierarchical ordering.
    rank: { type: Number, required: true, default: 10 },

    // The ten roles seeded from PERMISSION_MATRIX. Protected from rename and
    // delete so business logic that names them (User.role default, seed
    // scripts, rank comparisons) can keep relying on their identity.
    isSystem: { type: Boolean, default: false },

    // True only for Super Admin. Lets it operate across every tenant; every
    // created role is confined to its own, same as every other seeded role.
    isCrossTenant: { type: Boolean, default: false },

    permissions: [
      {
        resource: { type: String, required: true },
        actions: { type: [String], default: [] },
        _id: false,
      },
    ],

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

export default model('Role', roleSchema);
