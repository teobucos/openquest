import { z } from "zod";

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Identifier contains unsupported characters");

const SlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug contains unsupported characters");

const IsoTimestampSchema = z.string().datetime({ offset: true });
const ActorLabelSchema = z.string().trim().min(1).max(40);
const TitleSchema = z.string().trim().min(3).max(160);
const QuestGoalSchema = z.string().trim().min(10).max(2_000);
const QuestDescriptionSchema = z.string().trim().max(6_000);
const ChallengeDescriptionSchema = z.string().trim().min(10).max(2_000);
const ContributionSummarySchema = z.string().trim().min(1).max(800);
const ContributionContentSchema = z.string().min(1).max(12_000);
const ReviewReasonSchema = z.string().trim().min(1).max(1_000);

export const EvidenceSchema = z
  .object({
    url: z.httpUrl().max(2_048),
    title: z.string().trim().max(200),
    note: z.string().trim().max(400).optional(),
  })
  .strict();

export const EvidenceListSchema = z.array(EvidenceSchema).max(5);

export const QuestStatusSchema = z.enum(["active", "complete"]);
export const ChallengeStatusSchema = z.enum(["open", "awaiting_review", "resolved"]);
export const ContributionStatusSchema = z.enum(["pending", "accepted", "challenged"]);
export const ReviewVerdictSchema = z.enum(["support", "challenge"]);

export const QuestSchema = z
  .object({
    id: IdentifierSchema,
    slug: SlugSchema,
    title: TitleSchema,
    goal: QuestGoalSchema,
    description: QuestDescriptionSchema,
    status: QuestStatusSchema,
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
  })
  .strict();

export const ChallengeSchema = z
  .object({
    id: IdentifierSchema,
    quest_id: IdentifierSchema,
    parent_challenge_id: IdentifierSchema.nullable(),
    title: TitleSchema,
    description: ChallengeDescriptionSchema,
    status: ChallengeStatusSchema,
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
  })
  .strict();

export const ContributionSchema = z
  .object({
    id: IdentifierSchema,
    challenge_id: IdentifierSchema,
    actor_label: ActorLabelSchema,
    summary: ContributionSummarySchema,
    content: ContributionContentSchema,
    evidence: EvidenceListSchema,
    status: ContributionStatusSchema,
    created_at: IsoTimestampSchema,
  })
  .strict();

export const ReviewSchema = z
  .object({
    id: IdentifierSchema,
    contribution_id: IdentifierSchema,
    reviewer_label: ActorLabelSchema,
    verdict: ReviewVerdictSchema,
    reason: ReviewReasonSchema,
    evidence: EvidenceListSchema,
    created_at: IsoTimestampSchema,
  })
  .strict();

export const EventTypeSchema = z.enum([
  "quest.created",
  "challenge.created",
  "contribution.created",
  "review.supported",
  "review.challenged",
]);

export const EventSchema = z
  .object({
    sequence: z.number().int().positive(),
    quest_id: IdentifierSchema,
    entity_type: z.enum(["quest", "challenge", "contribution", "review"]),
    entity_id: IdentifierSchema,
    event_type: EventTypeSchema,
    actor_label: ActorLabelSchema.nullable(),
    summary: z.string().trim().min(1).max(500),
    created_at: IsoTimestampSchema,
  })
  .strict();

export const ObserveQuestsInputSchema = z
  .object({
    quest_id: IdentifierSchema.optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export const GetNextWorkInputSchema = z
  .object({
    quest_id: IdentifierSchema.optional(),
    mode: z.enum(["any", "contribute", "review"]).default("any"),
  })
  .strict();

export const SubmitContributionInputSchema = z
  .object({
    challenge_id: IdentifierSchema,
    summary: ContributionSummarySchema,
    content: ContributionContentSchema,
    evidence: EvidenceListSchema.optional().default([]),
  })
  .strict();

export const ReviewContributionInputSchema = z
  .object({
    contribution_id: IdentifierSchema,
    verdict: ReviewVerdictSchema,
    reason: ReviewReasonSchema,
    evidence: EvidenceListSchema.optional().default([]),
  })
  .strict();

export const CreateQuestInputSchema = z
  .object({
    title: TitleSchema,
    goal: QuestGoalSchema,
    description: QuestDescriptionSchema.optional().default(""),
  })
  .strict();

export const CreateChallengeInputSchema = z
  .object({
    quest_id: IdentifierSchema,
    title: TitleSchema,
    description: ChallengeDescriptionSchema,
    parent_challenge_id: IdentifierSchema.optional(),
  })
  .strict();

const ProposeQuestInputSchema = z
  .object({
    kind: z.literal("quest"),
    title: TitleSchema,
    goal: QuestGoalSchema,
    description: QuestDescriptionSchema.optional().default(""),
  })
  .strict();

const ProposeChallengeInputSchema = z
  .object({
    kind: z.literal("challenge"),
    quest_id: IdentifierSchema,
    title: TitleSchema,
    description: ChallengeDescriptionSchema,
    parent_challenge_id: IdentifierSchema.optional(),
  })
  .strict();

export const ProposeInputSchema = z.discriminatedUnion("kind", [
  ProposeQuestInputSchema,
  ProposeChallengeInputSchema,
]);

export const QuestCountsSchema = z
  .object({
    open: z.number().int().nonnegative(),
    awaiting_review: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
  })
  .strict();

export const QuestCardSchema = QuestSchema.extend({
  counts: QuestCountsSchema,
  active_agents: z.number().int().nonnegative(),
}).strict();

export const ChallengeWithContributionSchema = ChallengeSchema.extend({
  contribution: ContributionSchema.nullable(),
}).strict();

export const ObserveQuestsResponseSchema = z
  .object({
    quests: z.array(QuestCardSchema).max(20),
    totals: QuestCountsSchema,
    active_agents: z.number().int().nonnegative(),
    challenges: z.array(ChallengeWithContributionSchema).max(100).optional(),
    activity: z.array(EventSchema).max(20),
    suggested_next: z.string().trim().min(1).max(240),
  })
  .strict();

export const QuestResponseSchema = z
  .object({
    quest: QuestSchema,
    counts: QuestCountsSchema,
    active_agents: z.number().int().nonnegative(),
    challenges: z.array(ChallengeWithContributionSchema).max(100),
    activity: z.array(EventSchema).max(50),
  })
  .strict();

export const ContributionResponseSchema = z
  .object({
    contribution: ContributionSchema,
    challenge: ChallengeSchema,
    quest: QuestSchema.pick({ id: true, slug: true, title: true }),
    reviews: z.array(ReviewSchema).max(20),
  })
  .strict();

const WorkQuestSchema = QuestSchema.pick({
  id: true,
  slug: true,
  title: true,
  goal: true,
  description: true,
});

const WorkChallengeSchema = ChallengeSchema.pick({
  id: true,
  title: true,
  description: true,
});

export const NextContributionWorkSchema = z
  .object({
    status: z.literal("work_available"),
    work_type: z.literal("contribute"),
    quest: WorkQuestSchema,
    challenge: WorkChallengeSchema,
    why_now: z.string().trim().min(1).max(500),
    done_when: z.string().trim().min(1).max(500),
  })
  .strict();

export const NextReviewWorkSchema = z
  .object({
    status: z.literal("work_available"),
    work_type: z.literal("review"),
    quest: WorkQuestSchema,
    challenge: WorkChallengeSchema,
    contribution: ContributionSchema.pick({
      id: true,
      summary: true,
      content: true,
      evidence: true,
    }),
    why_now: z.string().trim().min(1).max(500),
    done_when: z.string().trim().min(1).max(500),
  })
  .strict();

export const NoWorkResponseSchema = z
  .object({
    status: z.literal("no_work_available"),
  })
  .strict();

export const GetNextWorkResponseSchema = z.union([
  NextContributionWorkSchema,
  NextReviewWorkSchema,
  NoWorkResponseSchema,
]);

export const WebMCPToolNameSchema = z.enum([
  "openquest_observe",
  "openquest_next",
  "openquest_submit",
  "openquest_review",
  "openquest_propose",
]);

export const NextActionSchema = z
  .object({
    tool: WebMCPToolNameSchema,
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

export const SubmitContributionResponseSchema = z
  .object({
    status: z.literal("submitted"),
    contribution_id: IdentifierSchema,
    challenge_status: z.literal("awaiting_review"),
    message: z.string().trim().min(1).max(500),
    next_action: NextActionSchema,
  })
  .strict();

export const ReviewContributionResponseSchema = z
  .object({
    status: z.literal("review_recorded"),
    review_id: IdentifierSchema,
    verdict: ReviewVerdictSchema,
    challenge_status: z.enum(["open", "resolved"]),
  })
  .strict();

export const CreateQuestResponseSchema = z
  .object({
    status: z.literal("created"),
    kind: z.literal("quest"),
    quest_id: IdentifierSchema,
    slug: SlugSchema,
    quest_status: z.literal("active"),
    message: z.string().trim().min(1).max(500),
    next_action: NextActionSchema,
  })
  .strict();

export const CreateChallengeResponseSchema = z
  .object({
    status: z.literal("created"),
    kind: z.literal("challenge"),
    challenge_id: IdentifierSchema,
    quest_id: IdentifierSchema,
    challenge_status: z.literal("open"),
    message: z.string().trim().min(1).max(500),
    next_action: NextActionSchema,
  })
  .strict();

export const ProposeResponseSchema = z.discriminatedUnion("kind", [
  CreateQuestResponseSchema,
  CreateChallengeResponseSchema,
]);

export const ApiErrorResponseSchema = z
  .object({
    status: z.enum([
      "invalid_input",
      "not_found",
      "quest_unavailable",
      "challenge_unavailable",
      "contribution_unavailable",
      "self_review_forbidden",
      "duplicate_review",
      "rate_limited",
      "conflict",
      "error",
    ]),
    message: z.string().trim().min(1).max(500),
    next_action: NextActionSchema.optional(),
  })
  .strict();

export const WebMCPToolInputJsonSchemas = {
  openquest_observe: z.toJSONSchema(ObserveQuestsInputSchema, { io: "input", target: "draft-7" }),
  openquest_next: z.toJSONSchema(GetNextWorkInputSchema, { io: "input", target: "draft-7" }),
  openquest_submit: z.toJSONSchema(SubmitContributionInputSchema, { io: "input", target: "draft-7" }),
  openquest_review: z.toJSONSchema(ReviewContributionInputSchema, { io: "input", target: "draft-7" }),
  openquest_propose: z.toJSONSchema(ProposeInputSchema, { io: "input", target: "draft-7" }),
} as const;

export type Quest = z.infer<typeof QuestSchema>;
export type Challenge = z.infer<typeof ChallengeSchema>;
export type Contribution = z.infer<typeof ContributionSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type ObserveQuestsInput = z.infer<typeof ObserveQuestsInputSchema>;
export type GetNextWorkInput = z.infer<typeof GetNextWorkInputSchema>;
export type SubmitContributionInput = z.infer<typeof SubmitContributionInputSchema>;
export type ReviewContributionInput = z.infer<typeof ReviewContributionInputSchema>;
export type CreateQuestInput = z.infer<typeof CreateQuestInputSchema>;
export type CreateChallengeInput = z.infer<typeof CreateChallengeInputSchema>;
export type ProposeInput = z.infer<typeof ProposeInputSchema>;
export type ObserveQuestsResponse = z.infer<typeof ObserveQuestsResponseSchema>;
export type WorldResponse = ObserveQuestsResponse;
export type QuestResponse = z.infer<typeof QuestResponseSchema>;
export type ContributionResponse = z.infer<typeof ContributionResponseSchema>;
export type GetNextWorkResponse = z.infer<typeof GetNextWorkResponseSchema>;
export type SubmitContributionResponse = z.infer<typeof SubmitContributionResponseSchema>;
export type ReviewContributionResponse = z.infer<typeof ReviewContributionResponseSchema>;
export type CreateQuestResponse = z.infer<typeof CreateQuestResponseSchema>;
export type CreateChallengeResponse = z.infer<typeof CreateChallengeResponseSchema>;
export type ProposeResponse = z.infer<typeof ProposeResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
