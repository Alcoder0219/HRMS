import mongoose from 'mongoose';
import {
  INTERVIEW_MODE,
  INTERVIEW_STATUS,
  INTERVIEW_RECOMMENDATION,
} from '../../utils/constants.js';

const { Schema, model } = mongoose;

/**
 * One interviewer's verdict.
 *
 * Held per person rather than as a single field on the interview: a panel
 * disagreeing is the most useful signal there is, and averaging it away before
 * anyone reads it destroys exactly that.
 */
const feedbackSchema = new Schema(
  {
    interviewerId: { type: Schema.Types.ObjectId, ref: 'Employee', default: null },
    interviewerName: { type: String, trim: true, maxlength: 120, default: null },
    rating: { type: Number, min: 1, max: 5, default: null },
    recommendation: { type: String, enum: [...Object.values(INTERVIEW_RECOMMENDATION), null], default: null },
    strengths: { type: String, trim: true, maxlength: 1000, default: null },
    concerns: { type: String, trim: true, maxlength: 1000, default: null },
    comment: { type: String, trim: true, maxlength: 2000, default: null },
    submittedAt: { type: Date, default: null },
  },
  { _id: true },
);

/** A scheduled conversation with a candidate. */
const interviewSchema = new Schema(
  {
    tenantId: { type: Schema.Types.ObjectId, ref: 'Tenant', default: null, index: true },

    candidateId: { type: Schema.Types.ObjectId, ref: 'Candidate', required: true, index: true },
    jobOpeningId: { type: Schema.Types.ObjectId, ref: 'JobOpening', required: true, index: true },

    // 1 is the first conversation. Rounds are per candidate, not global.
    round: { type: Number, required: true, min: 1, max: 20, default: 1 },
    title: { type: String, trim: true, maxlength: 120, default: null },

    scheduledAt: { type: Date, required: true, index: true },
    durationMinutes: { type: Number, default: 45, min: 5, max: 480 },

    mode: { type: String, enum: Object.values(INTERVIEW_MODE), default: INTERVIEW_MODE.VIDEO },
    location: { type: String, trim: true, maxlength: 200, default: null },
    meetingLink: { type: String, trim: true, maxlength: 500, default: null },

    interviewerIds: { type: [Schema.Types.ObjectId], ref: 'Employee', default: [] },

    status: {
      type: String,
      enum: Object.values(INTERVIEW_STATUS),
      default: INTERVIEW_STATUS.SCHEDULED,
      index: true,
    },

    feedback: { type: [feedbackSchema], default: [] },
    // The panel's overall call, recorded when the round is closed.
    outcome: { type: String, enum: [...Object.values(INTERVIEW_RECOMMENDATION), null], default: null },

    cancelReason: { type: String, trim: true, maxlength: 300, default: null },
    completedAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } },
);

interviewSchema.index({ tenantId: 1, scheduledAt: 1 });
interviewSchema.index({ tenantId: 1, candidateId: 1, round: 1 });

/** Mean of the ratings actually given; null when the panel has not scored. */
interviewSchema.virtual('averageRating').get(function averageRating() {
  const scored = (this.feedback ?? []).filter((entry) => typeof entry.rating === 'number');
  if (!scored.length) return null;

  return Number((scored.reduce((sum, entry) => sum + entry.rating, 0) / scored.length).toFixed(1));
});

export default model('Interview', interviewSchema);
