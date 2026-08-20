import Joi from 'joi';
import { RESOURCE_VALUES, ACTION_VALUES } from '../../utils/constants.js';

const objectId = Joi.string().hex().length(24);

export const createRoleSchema = Joi.object({
  label: Joi.string().trim().min(2).max(60).required(),
  description: Joi.string().trim().max(300).allow('', null),
  cloneFromCode: Joi.string().trim().max(40).allow('', null),
});

export const updateRoleSchema = Joi.object({
  label: Joi.string().trim().min(2).max(60),
  description: Joi.string().trim().max(300).allow('', null),
})
  .min(1)
  .messages({ 'object.min': 'Nothing to update' });

/**
 * The bulk matrix save. `resource`/`action` are checked against the fixed
 * vocabulary -- the wildcard grant is not a value a client ever sends; it is
 * only ever stored by `ensureSystemRoles()` seeding Super Admin, and the first
 * edit to any role replaces it with an explicit list.
 */
export const updateRolePermissionsSchema = Joi.object({
  updates: Joi.array()
    .items(
      Joi.object({
        roleId: objectId.required(),
        permissions: Joi.array()
          .items(
            Joi.object({
              resource: Joi.string()
                .valid(...RESOURCE_VALUES)
                .required(),
              actions: Joi.array()
                .items(Joi.string().valid(...ACTION_VALUES))
                .default([]),
            }),
          )
          .required(),
      }),
    )
    .min(1)
    .required(),
});

export default { createRoleSchema, updateRoleSchema, updateRolePermissionsSchema };
