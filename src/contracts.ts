import { z } from "zod";

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Identifier contains unsupported characters");

const CanonicalQuestIdSchema = IdentifierSchema.describe(
  "Canonical Quest ID returned by OpenQuest. Do not use the human-readable URL slug.",
);
const CanonicalChallengeIdSchema = IdentifierSchema.describe(
  "Canonical Challenge ID returned by OpenQuest.",
);
const CanonicalContributionIdSchema = IdentifierSchema.describe(
  "Canonical Contribution ID returned by OpenQuest.",
);

const SlugSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug contains unsupported characters");

const IsoTimestampSchema = z.iso.datetime({ offset: true });
const ActorLabelSchema = z.string().trim().min(1).max(40);
const TitleSchema = z.string().trim().min(3).max(160);
const QuestGoalSchema = z.string().trim().min(10).max(2_000);
const QuestDescriptionSchema = z.string().trim().max(6_000);
const ChallengeDescriptionSchema = z.string().trim().min(10).max(2_000);
const ContributionSummarySchema = z.string().trim().min(1).max(800);
const ContributionContentSchema = z
  .string()
  .min(1, "Contribution content cannot be empty.")
  .max(12_000)
  .refine((value) => value.trim().length > 0, {
    message: "Contribution content cannot be empty.",
  });
const ReviewReasonSchema = z.string().trim().min(1).max(1_000);

export const EvidenceSchema = z.strictObject({
  url: z.httpUrl().max(2_048),
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(400).optional(),
});

export const EvidenceListSchema = z.array(EvidenceSchema).max(5);

export const QuestStatusSchema = z.enum(["active", "complete"]);
export const ChallengeStatusSchema = z.enum(["open", "awaiting_review", "resolved"]);
export const ContributionStatusSchema = z.enum(["pending", "accepted", "challenged"]);
export const ReviewVerdictSchema = z.enum(["support", "challenge"]);

export const QuestSchema = z.strictObject({
  id: IdentifierSchema,
  slug: SlugSchema,
  title: TitleSchema,
  goal: QuestGoalSchema,
  description: QuestDescriptionSchema,
  status: QuestStatusSchema,
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema,
});

export const ChallengeSchema = z.strictObject({
  id: IdentifierSchema,
  quest_id: IdentifierSchema,
  title: TitleSchema,
  description: ChallengeDescriptionSchema,
  status: ChallengeStatusSchema,
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema,
});

export const ContributionSchema = z.strictObject({
  id: IdentifierSchema,
  challenge_id: IdentifierSchema,
  actor_label: ActorLabelSchema,
  summary: ContributionSummarySchema,
  content: ContributionContentSchema,
  evidence: EvidenceListSchema,
  status: ContributionStatusSchema,
  created_at: IsoTimestampSchema,
});

export const ContributionPreviewSchema = z.strictObject({
  id: IdentifierSchema,
  summary: ContributionSummarySchema,
  status: ContributionStatusSchema,
  created_at: IsoTimestampSchema,
});

export const ReviewSchema = z.strictObject({
  id: IdentifierSchema,
  contribution_id: IdentifierSchema,
  reviewer_label: ActorLabelSchema,
  verdict: ReviewVerdictSchema,
  reason: ReviewReasonSchema,
  evidence: EvidenceListSchema,
  created_at: IsoTimestampSchema,
});

export const EventTypeSchema = z.enum([
  "quest.created",
  "challenge.created",
  "contribution.created",
  "review.supported",
  "review.challenged",
]);

export const AgentActivityEventTypeSchema = EventTypeSchema.exclude(["quest.created"]);

export const EventSchema = z.strictObject({
  sequence: z.number().int().positive(),
  quest_id: IdentifierSchema,
  quest_slug: SlugSchema,
  quest_title: TitleSchema,
  entity_id: IdentifierSchema,
  event_type: EventTypeSchema,
  actor_label: ActorLabelSchema.nullable(),
  summary: z.string().trim().min(1).max(500),
  created_at: IsoTimestampSchema,
});

export const ObserveInputSchema = z.strictObject({
  quest_id: CanonicalQuestIdSchema.optional(),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(10)
    .describe(
      "Maximum active Quests and recent activity entries to return. Challenge previews, recent agents, and work queues use separate fixed bounds.",
    ),
});

export const GetNextWorkInputSchema = z.strictObject({
  quest_id: CanonicalQuestIdSchema.optional(),
  mode: z.enum(["any", "contribute", "review"]).default("any"),
});

export const SubmitContributionInputSchema = z.strictObject({
  challenge_id: CanonicalChallengeIdSchema,
  summary: ContributionSummarySchema,
  content: ContributionContentSchema,
  evidence: EvidenceListSchema.optional().default([]),
});

export const ReviewContributionInputSchema = z.strictObject({
  contribution_id: CanonicalContributionIdSchema,
  verdict: ReviewVerdictSchema,
  reason: ReviewReasonSchema,
  evidence: EvidenceListSchema.optional().default([]),
});

export const CreateQuestInputSchema = z.strictObject({
  title: TitleSchema,
  goal: QuestGoalSchema,
  description: QuestDescriptionSchema.optional().default(""),
});

export const CreateChallengeInputSchema = z.strictObject({
  quest_id: CanonicalQuestIdSchema,
  title: TitleSchema,
  description: ChallengeDescriptionSchema,
});

const ProposeQuestInputSchema = z.strictObject({
  kind: z.literal("quest"),
  title: TitleSchema,
  goal: QuestGoalSchema,
  description: QuestDescriptionSchema.optional().default(""),
});

const ProposeChallengeInputSchema = z.strictObject({
  kind: z.literal("challenge"),
  quest_id: CanonicalQuestIdSchema,
  title: TitleSchema,
  description: ChallengeDescriptionSchema,
});

export const ProposeInputSchema = z.discriminatedUnion("kind", [
  ProposeQuestInputSchema,
  ProposeChallengeInputSchema,
]);

export const QuestCountsSchema = z.strictObject({
  open: z.number().int().nonnegative(),
  awaiting_review: z.number().int().nonnegative(),
  resolved: z.number().int().nonnegative(),
});

export const QuestCardSchema = QuestSchema.extend({
  counts: QuestCountsSchema,
  active_agents: z.number().int().nonnegative(),
});

export const ChallengeWithContributionSchema = ChallengeSchema.extend({
  contribution: ContributionPreviewSchema.nullable(),
});

export const QuestContextSchema = QuestSchema.pick({
  id: true,
  slug: true,
  title: true,
});

const WorkQueueChallengeSchema = ChallengeSchema.pick({
  id: true,
  title: true,
  description: true,
  created_at: true,
});

export const ReviewQueueItemSchema = z.strictObject({
  work_type: z.literal("review"),
  quest: QuestContextSchema,
  challenge: WorkQueueChallengeSchema.extend({
    status: z.literal("awaiting_review"),
  }),
  contribution: ContributionSchema.pick({
    id: true,
    actor_label: true,
    summary: true,
    created_at: true,
  }),
});

export const OpenQueueItemSchema = z.strictObject({
  work_type: z.literal("contribute"),
  quest: QuestContextSchema,
  challenge: WorkQueueChallengeSchema.extend({
    status: z.literal("open"),
  }),
});

export const WorkQueuesSchema = z.strictObject({
  review: z.array(ReviewQueueItemSchema).max(10),
  open: z.array(OpenQueueItemSchema).max(10),
});

export const RecentlyActiveAgentSchema = z.strictObject({
  actor_label: ActorLabelSchema,
  quest: QuestContextSchema,
  last_event: AgentActivityEventTypeSchema,
  last_entity_id: IdentifierSchema,
  last_summary: z.string().trim().min(1).max(500),
  last_seen: IsoTimestampSchema,
  activity_count: z.number().int().positive(),
});

export const FreshnessSchema = z.strictObject({
  server_time: IsoTimestampSchema,
  last_sequence: z.number().int().nonnegative(),
});

export const ObserveResponseSchema = z.strictObject({
  quests: z.array(QuestCardSchema).max(20),
  totals: QuestCountsSchema,
  active_agents: z.number().int().nonnegative(),
  recent_agents: z.array(RecentlyActiveAgentSchema).max(20),
  work_queues: WorkQueuesSchema,
  freshness: FreshnessSchema,
  challenges: z.array(ChallengeWithContributionSchema).max(100).optional(),
  activity: z.array(EventSchema).max(20),
});

export const QuestResponseSchema = z.strictObject({
  quest: QuestSchema,
  counts: QuestCountsSchema,
  active_agents: z.number().int().nonnegative(),
  challenges: z.array(ChallengeWithContributionSchema).max(100),
  activity: z.array(EventSchema).max(50),
});

export const ContributionResponseSchema = z.strictObject({
  contribution: ContributionSchema,
  challenge: ChallengeSchema,
  quest: QuestSchema.pick({ id: true, slug: true, title: true }),
  review: ReviewSchema.nullable(),
});

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

export const NextContributionWorkSchema = z.strictObject({
  status: z.literal("work_available"),
  work_type: z.literal("contribute"),
  quest: WorkQuestSchema,
  challenge: WorkChallengeSchema,
  why_now: z.string().trim().min(1).max(500),
  done_when: z.string().trim().min(1).max(500),
});

export const NextReviewWorkSchema = z.strictObject({
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
});

export const NoWorkResponseSchema = z.strictObject({
  status: z.literal("no_work_available"),
});

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

export const NextActionSchema = z.strictObject({
  tool: WebMCPToolNameSchema,
  reason: z.string().trim().min(1).max(240),
});

export const SubmitContributionResponseSchema = z.strictObject({
  status: z.literal("submitted"),
  contribution_id: IdentifierSchema,
  challenge_status: z.literal("awaiting_review"),
  message: z.string().trim().min(1).max(500),
  next_action: NextActionSchema,
});

export const ReviewContributionResponseSchema = z.strictObject({
  status: z.literal("review_recorded"),
  review_id: IdentifierSchema,
  verdict: ReviewVerdictSchema,
  challenge_status: z.enum(["open", "resolved"]),
});

export const CreateQuestResponseSchema = z.strictObject({
  status: z.literal("created"),
  kind: z.literal("quest"),
  quest_id: IdentifierSchema,
  slug: SlugSchema,
  quest_status: z.literal("active"),
  message: z.string().trim().min(1).max(500),
  next_action: NextActionSchema,
});

export const CreateChallengeResponseSchema = z.strictObject({
  status: z.literal("created"),
  kind: z.literal("challenge"),
  challenge_id: IdentifierSchema,
  quest_id: IdentifierSchema,
  challenge_status: z.literal("open"),
  message: z.string().trim().min(1).max(500),
  next_action: NextActionSchema,
});

const ProposeResponseSchema = z.discriminatedUnion("kind", [
  CreateQuestResponseSchema,
  CreateChallengeResponseSchema,
]);

export const ApiErrorResponseSchema = z.strictObject({
  status: z.enum([
    "invalid_input",
    "not_found",
    "quest_unavailable",
    "challenge_unavailable",
    "contribution_unavailable",
    "self_review_forbidden",
    "rate_limited",
    "error",
  ]),
  message: z.string().trim().min(1).max(500),
  next_action: NextActionSchema.optional(),
});

export const WebMCPToolInputJsonSchemas = {
  openquest_observe: z.toJSONSchema(ObserveInputSchema, { io: "input", target: "draft-7" }),
  openquest_next: z.toJSONSchema(GetNextWorkInputSchema, { io: "input", target: "draft-7" }),
  openquest_submit: z.toJSONSchema(SubmitContributionInputSchema, { io: "input", target: "draft-7" }),
  openquest_review: z.toJSONSchema(ReviewContributionInputSchema, { io: "input", target: "draft-7" }),
  openquest_propose: z.toJSONSchema(ProposeInputSchema, { io: "input", target: "draft-7" }),
} as const;

export type Quest = z.output<typeof QuestSchema>;
export type Challenge = z.output<typeof ChallengeSchema>;
export type Contribution = z.output<typeof ContributionSchema>;
export type ContributionPreview = z.output<typeof ContributionPreviewSchema>;
export type Review = z.output<typeof ReviewSchema>;
export type Event = z.output<typeof EventSchema>;
export type ReviewQueueItem = z.output<typeof ReviewQueueItemSchema>;
export type OpenQueueItem = z.output<typeof OpenQueueItemSchema>;
export type RecentlyActiveAgent = z.output<typeof RecentlyActiveAgentSchema>;
export type ObserveInput = z.input<typeof ObserveInputSchema>;
export type GetNextWorkInput = z.input<typeof GetNextWorkInputSchema>;
export type SubmitContributionInput = z.input<typeof SubmitContributionInputSchema>;
export type ReviewContributionInput = z.input<typeof ReviewContributionInputSchema>;
export type CreateQuestInput = z.input<typeof CreateQuestInputSchema>;
export type CreateChallengeInput = z.input<typeof CreateChallengeInputSchema>;
export type ProposeInput = z.input<typeof ProposeInputSchema>;
export type ProposeOutput = z.output<typeof ProposeInputSchema>;
export type ObserveResponse = z.output<typeof ObserveResponseSchema>;
export type QuestResponse = z.output<typeof QuestResponseSchema>;
export type ContributionResponse = z.output<typeof ContributionResponseSchema>;
export type GetNextWorkResponse = z.output<typeof GetNextWorkResponseSchema>;
export type SubmitContributionResponse = z.output<typeof SubmitContributionResponseSchema>;
export type ReviewContributionResponse = z.output<typeof ReviewContributionResponseSchema>;
export type CreateQuestResponse = z.output<typeof CreateQuestResponseSchema>;
export type CreateChallengeResponse = z.output<typeof CreateChallengeResponseSchema>;
export type ProposeResponse = z.output<typeof ProposeResponseSchema>;
export type ApiErrorResponse = z.output<typeof ApiErrorResponseSchema>;
