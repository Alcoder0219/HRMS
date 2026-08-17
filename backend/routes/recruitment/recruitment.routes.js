import { Router } from 'express';

import controller from '../../controllers/recruitment/recruitment.controller.js';
import validate from '../../middlewares/validate.js';
import { requirePermission } from '../../middlewares/authorize.js';
import { documentUpload } from '../../config/multer.js';
import { ACTIONS } from '../../utils/constants.js';
import schemas from '../../validators/recruitment/recruitment.validator.js';

const router = Router();

/**
 * Recruitment: requisitions, candidates, interviews, offers and joining.
 *
 * RBAC resource: RESOURCES.RECRUITMENT
 *
 * Mounted in routes/index.js behind authenticate and bound to its resource, so
 * every route below is already authenticated and gated to roles holding at
 * least one grant on it. Each route names its exact action.
 *
 * Action mapping is deliberate:
 *
 *   READ    -- viewing the pipeline.
 *   CREATE  -- adding a requisition, a candidate, an interview.
 *   UPDATE  -- moving a candidate along, recording feedback.
 *   APPROVE -- anything that commits the organisation: making an offer,
 *              changing its status, and turning it into an employee. Creating
 *              a person on the payroll is not an ordinary create.
 *
 * Literal paths precede `/:id`; Express matches in order and `report` would
 * otherwise be captured as a record id.
 */

/* ---------------------------------------------------------------- reports -- */

router.get('/reports/hiring', requirePermission(ACTIONS.READ), validate(schemas.reportSchema), controller.report);

/* ------------------------------------------------------------ job openings -- */

router.get('/jobs', requirePermission(ACTIONS.READ), validate(schemas.listJobsSchema), controller.listJobs);

router.post('/jobs', requirePermission(ACTIONS.CREATE), validate(schemas.createJobSchema), controller.createJob);

router.get('/jobs/:id', requirePermission(ACTIONS.READ), validate(schemas.idParamSchema), controller.getJob);

router.patch(
  '/jobs/:id',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.updateJobSchema),
  controller.updateJob,
);

router.delete(
  '/jobs/:id',
  requirePermission(ACTIONS.DELETE),
  validate(schemas.idParamSchema),
  controller.deleteJob,
);

/* ------------------------------------------------------------- candidates -- */

router.get(
  '/candidates',
  requirePermission(ACTIONS.READ),
  validate(schemas.listCandidatesSchema),
  controller.listCandidates,
);

router.post(
  '/candidates',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.createCandidateSchema),
  controller.createCandidate,
);

router.get(
  '/candidates/:id',
  requirePermission(ACTIONS.READ),
  validate(schemas.idParamSchema),
  controller.getCandidate,
);

router.post(
  '/candidates/:id/resume',
  requirePermission(ACTIONS.UPDATE),
  documentUpload.single('resume'),
  validate(schemas.idParamSchema),
  controller.uploadResume,
);

router.patch(
  '/candidates/:id/stage',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.moveStageSchema),
  controller.moveStage,
);

router.patch(
  '/candidates/:id',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.updateCandidateSchema),
  controller.updateCandidate,
);

/* ------------------------------------------------------------- interviews -- */

router.get(
  '/interviews',
  requirePermission(ACTIONS.READ),
  validate(schemas.listInterviewsSchema),
  controller.listInterviews,
);

router.post(
  '/interviews',
  requirePermission(ACTIONS.CREATE),
  validate(schemas.scheduleInterviewSchema),
  controller.scheduleInterview,
);

router.post(
  '/interviews/:id/feedback',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.feedbackSchema),
  controller.submitFeedback,
);

router.patch(
  '/interviews/:id',
  requirePermission(ACTIONS.UPDATE),
  validate(schemas.updateInterviewSchema),
  controller.updateInterview,
);

/* ----------------------------------------------------------------- offers -- */

router.get('/offers', requirePermission(ACTIONS.READ), validate(schemas.listOffersSchema), controller.listOffers);

router.post(
  '/offers',
  // An offer commits the organisation to a salary.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.createOfferSchema),
  controller.createOffer,
);

router.get(
  '/offers/:id/letter',
  // Read, not export: the letter is one document for one candidate, not a bulk
  // extract of the pipeline.
  requirePermission(ACTIONS.READ),
  validate(schemas.idParamSchema),
  controller.offerLetter,
);

router.post(
  '/offers/:id/convert',
  // Creates a person on the payroll. The strongest right in this module.
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.convertSchema),
  controller.convert,
);

router.get('/offers/:id', requirePermission(ACTIONS.READ), validate(schemas.idParamSchema), controller.getOffer);

router.patch(
  '/offers/:id/status',
  requirePermission(ACTIONS.APPROVE),
  validate(schemas.offerStatusSchema),
  controller.setOfferStatus,
);

export default router;
