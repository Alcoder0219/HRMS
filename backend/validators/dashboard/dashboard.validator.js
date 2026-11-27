import Joi from 'joi';

const objectId = Joi.string().hex().length(24);

/** The dashboard's filters. Month and year default to now; unit and department are optional. */
export const overviewQuerySchema = {
  query: Joi.object({
    year: Joi.number().integer().min(2000).max(2100).default(() => new Date().getFullYear()),
    month: Joi.number().integer().min(1).max(12).default(() => new Date().getMonth() + 1),
    unitId: objectId.allow('', null),
    departmentId: objectId.allow('', null),
  }),
};

export default { overviewQuerySchema };
