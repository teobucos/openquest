import { z } from "zod";

const IdentifierSchema = z.string().trim().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Identifier contains unsupported characters");
const CanonicalQuestIdSchema = IdentifierSchema.describe(
  "Canonical Quest ID returned by OpenQuest. Do not use the human-readable URL slug.",
);
const CanonicalChallengeIdSchema = IdentifierSchema.describe("Canonical Challenge ID returned by OpenQuest.");
const CanonicalContributionIdSchema = IdentifierSchema.describe("Canonical Contribution ID returned by OpenQuest.");
const SlugSchema = z.string().trim().min(3).max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug contains unsupported characters");
const IsoTimestampSchema = z.iso.datetime({ offset: true });
const ActorLabelSchema = z.string().trim().min(1).max(40);
const TitleSchema = z.string().trim().min(3).max(160);
const QuestGoalSchema = z.string().trim().min(10).max(2_000);
const QuestDescriptionSchema = z.string().trim().max(6_000);
const ChallengeDescriptionSchema = z.string().trim().min(10).max(2_000);
const ContributionSummarySchema = z.string().trim().min(1).max(800);
const ContributionContentSchema = z.string().min(1).max(12_000).refine((value) => value.trim().length > 0, {
  message: "Contribution content cannot be empty.",
});
const ReviewReasonSchema = z.string().trim().min(1).max(1_000);
const CanonicalRorIdSchema = z.string().regex(
  /^https:\/\/ror\.org\/0[a-z0-9]{8}$/,
  "ROR ID must use the canonical https://ror.org/0xxxxxxxx form",
);

export const EvidenceSchema = z.strictObject({
  url: z.httpUrl().max(2_048),
  title: z.string().trim().min(1).max(200),
  note: z.string().trim().max(400).optional(),
}).strict();
export const EvidenceListSchema = z.array(EvidenceSchema).max(5);

export const QuestStatusSchema = z.enum(["active", "complete"]);
export const ChallengeStatusSchema = z.enum(["open", "awaiting_review", "resolved"]);
export const ContributionStatusSchema = z.enum(["pending", "accepted", "challenged"]);
export const ReviewVerdictSchema = z.enum(["support", "challenge"]);
export const OrganizationCategorySchema = z.enum([
  "research", "education", "healthcare", "company", "nonprofit", "government", "funder", "other",
]);
export const OrganizationVerificationStatusSchema = z.enum(["unverified", "verified"]);

export const OrganizationSummarySchema = z.strictObject({
  id: IdentifierSchema,
  slug: SlugSchema,
  name: z.string().trim().min(1).max(160),
  category: OrganizationCategorySchema,
  verification_status: OrganizationVerificationStatusSchema,
  is_demo: z.boolean(),
  ror_id: CanonicalRorIdSchema.nullable(),
}).strict();

export const QuestSchema = z.strictObject({
  id: IdentifierSchema,
  slug: SlugSchema,
  title: TitleSchema,
  goal: QuestGoalSchema,
  description: QuestDescriptionSchema,
  status: QuestStatusSchema,
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema,
}).strict();
export const QuestWithOrganizationSchema = QuestSchema.extend({
  organization: OrganizationSummarySchema.nullable(),
}).strict();
export const ChallengeSchema = z.strictObject({
  id: IdentifierSchema,
  quest_id: IdentifierSchema,
  title: TitleSchema,
  description: ChallengeDescriptionSchema,
  status: ChallengeStatusSchema,
  created_at: IsoTimestampSchema,
  updated_at: IsoTimestampSchema,
}).strict();
export const ContributionSchema = z.strictObject({
  id: IdentifierSchema,
  challenge_id: IdentifierSchema,
  actor_label: ActorLabelSchema,
  summary: ContributionSummarySchema,
  content: ContributionContentSchema,
  evidence: EvidenceListSchema,
  status: ContributionStatusSchema,
  created_at: IsoTimestampSchema,
}).strict();
export const ContributionPreviewSchema = ContributionSchema.pick({ id: true, summary: true, status: true, created_at: true }).strict();
export const ReviewSchema = z.strictObject({
  id: IdentifierSchema,
  contribution_id: IdentifierSchema,
  reviewer_label: ActorLabelSchema,
  verdict: ReviewVerdictSchema,
  reason: ReviewReasonSchema,
  evidence: EvidenceListSchema,
  created_at: IsoTimestampSchema,
}).strict();

export const EventTypeSchema = z.enum(["quest.created", "challenge.created", "contribution.created", "review.supported", "review.challenged"]);
export const ContributorEventTypeSchema = EventTypeSchema.exclude(["quest.created"]);
export const EventSchema = z.strictObject({
  sequence: z.number().int().positive(), quest_id: IdentifierSchema, quest_slug: SlugSchema, quest_title: TitleSchema,
  entity_id: IdentifierSchema, event_type: EventTypeSchema, actor_label: ActorLabelSchema.nullable(),
  summary: z.string().trim().min(1).max(500), created_at: IsoTimestampSchema,
}).strict();

export const ObserveInputSchema = z.strictObject({
  quest_id: CanonicalQuestIdSchema.optional(),
  limit: z.number().int().min(1).max(20).default(10).describe(
    "Maximum active Quest cards and recent public events to return. Contributors and work stream use fixed bounds.",
  ),
}).strict();
export const GetNextWorkInputSchema = z.strictObject({ quest_id: CanonicalQuestIdSchema.optional(), mode: z.enum(["any", "contribute", "review"]).default("any") }).strict();
export const SubmitContributionInputSchema = z.strictObject({ challenge_id: CanonicalChallengeIdSchema, summary: ContributionSummarySchema, content: ContributionContentSchema, evidence: EvidenceListSchema.optional().default([]) }).strict();
export const ReviewContributionInputSchema = z.strictObject({ contribution_id: CanonicalContributionIdSchema, verdict: ReviewVerdictSchema, reason: ReviewReasonSchema, evidence: EvidenceListSchema.optional().default([]) }).strict();
export const CreateQuestInputSchema = z.strictObject({ title: TitleSchema, goal: QuestGoalSchema, description: QuestDescriptionSchema.optional().default("") }).strict();
export const CreateChallengeInputSchema = z.strictObject({ quest_id: CanonicalQuestIdSchema, title: TitleSchema, description: ChallengeDescriptionSchema }).strict();
const ProposeQuestInputSchema = z.strictObject({ kind: z.literal("quest"), title: TitleSchema, goal: QuestGoalSchema, description: QuestDescriptionSchema.optional().default("") }).strict();
const ProposeChallengeInputSchema = z.strictObject({ kind: z.literal("challenge"), quest_id: CanonicalQuestIdSchema, title: TitleSchema, description: ChallengeDescriptionSchema }).strict();
export const ProposeInputSchema = z.discriminatedUnion("kind", [ProposeQuestInputSchema, ProposeChallengeInputSchema]);

export const QuestCountsSchema = z.strictObject({ open: z.number().int().nonnegative(), awaiting_review: z.number().int().nonnegative(), resolved: z.number().int().nonnegative() }).strict();
export const QuestCardSchema = QuestWithOrganizationSchema.extend({ counts: QuestCountsSchema }).strict();
export const QuestContextSchema = QuestWithOrganizationSchema.pick({ id: true, slug: true, title: true, organization: true });
export const ContributorSchema = z.strictObject({
  actor_label: ActorLabelSchema, quest: QuestContextSchema, last_event: ContributorEventTypeSchema,
  last_entity_id: IdentifierSchema, last_summary: z.string().trim().min(1).max(500), last_active_at: IsoTimestampSchema,
  activity_count: z.number().int().positive(),
}).strict();
const WorkStreamChallengeSchema = ChallengeSchema.pick({ id: true, title: true, description: true, status: true, created_at: true, updated_at: true }).strict();
const WorkStreamContributionSchema = ContributionSchema.pick({ id: true, actor_label: true, summary: true, status: true, created_at: true }).strict();
export const WorkStreamItemSchema = z.strictObject({
  stream_state: z.enum(["review", "open", "resolved"]), quest: QuestContextSchema,
  challenge: WorkStreamChallengeSchema, contribution: WorkStreamContributionSchema.nullable(),
}).strict().superRefine((item, context) => {
  if (item.stream_state === "review" && (item.challenge.status !== "awaiting_review" || item.contribution?.status !== "pending")) context.addIssue({ code: "custom", message: "Review work must contain a pending Contribution." });
  if (item.stream_state === "open" && (item.challenge.status !== "open" || item.contribution !== null)) context.addIssue({ code: "custom", message: "Open work cannot contain a Contribution." });
  if (item.stream_state === "resolved" && (item.challenge.status !== "resolved" || item.contribution?.status !== "accepted")) context.addIssue({ code: "custom", message: "Resolved work must contain the accepted Contribution." });
});
export const WorkStreamSchema = z.array(WorkStreamItemSchema).max(30);
export const FreshnessSchema = z.strictObject({ server_time: IsoTimestampSchema, last_sequence: z.number().int().nonnegative(), event_count: z.number().int().nonnegative() }).strict();
export const ChallengePreviewSchema = ChallengeSchema.extend({ contribution: ContributionPreviewSchema.nullable() }).strict();
export const ChallengeDetailContributionSchema = ContributionSchema.extend({ review: ReviewSchema.nullable() }).strict();
export const ChallengeDetailResponseSchema = z.strictObject({ quest: QuestWithOrganizationSchema, challenge: ChallengeSchema, contributions: z.array(ChallengeDetailContributionSchema).max(20) }).strict();
export const ObserveResponseSchema = z.strictObject({
  quests: z.array(QuestCardSchema).max(20), totals: QuestCountsSchema, contributor_count: z.number().int().nonnegative(),
  recent_contributors: z.array(ContributorSchema).max(20), work_stream: WorkStreamSchema, freshness: FreshnessSchema,
  challenges: z.array(ChallengePreviewSchema).max(30).optional(), activity: z.array(EventSchema).max(20),
}).strict();
export const QuestResponseSchema = z.strictObject({ quest: QuestWithOrganizationSchema, counts: QuestCountsSchema, contributor_count: z.number().int().nonnegative(), challenges: z.array(ChallengePreviewSchema).max(30), activity: z.array(EventSchema).max(20) }).strict();
export const ContributionResponseSchema = z.strictObject({ contribution: ContributionSchema, challenge: ChallengeSchema, quest: QuestWithOrganizationSchema, review: ReviewSchema.nullable() }).strict();

const WorkQuestSchema = QuestWithOrganizationSchema.pick({ id: true, slug: true, title: true, goal: true, description: true, organization: true });
const WorkChallengeSchema = ChallengeSchema.pick({ id: true, title: true, description: true });
export const NextContributionWorkSchema = z.strictObject({ status: z.literal("work_available"), work_type: z.literal("contribute"), quest: WorkQuestSchema, challenge: WorkChallengeSchema, why_now: z.string().trim().min(1).max(500), done_when: z.string().trim().min(1).max(500) }).strict();
export const NextReviewWorkSchema = z.strictObject({ status: z.literal("work_available"), work_type: z.literal("review"), quest: WorkQuestSchema, challenge: WorkChallengeSchema, contribution: ContributionSchema.pick({ id: true, summary: true, content: true, evidence: true }), why_now: z.string().trim().min(1).max(500), done_when: z.string().trim().min(1).max(500) }).strict();
export const NoWorkResponseSchema = z.strictObject({ status: z.literal("no_work_available") }).strict();
export const GetNextWorkResponseSchema = z.union([NextContributionWorkSchema, NextReviewWorkSchema, NoWorkResponseSchema]);
export const WebMCPToolNameSchema = z.enum(["openquest_observe", "openquest_next", "openquest_submit", "openquest_review", "openquest_propose"]);
export const NextActionSchema = z.strictObject({ tool: WebMCPToolNameSchema, reason: z.string().trim().min(1).max(240) }).strict();
export const SubmitContributionResponseSchema = z.strictObject({ status: z.literal("submitted"), contribution_id: IdentifierSchema, challenge_status: z.literal("awaiting_review"), message: z.string().trim().min(1).max(500), next_action: NextActionSchema }).strict();
export const ReviewContributionResponseSchema = z.strictObject({ status: z.literal("review_recorded"), review_id: IdentifierSchema, verdict: ReviewVerdictSchema, challenge_status: z.enum(["open", "resolved"]) }).strict();
export const CreateQuestResponseSchema = z.strictObject({ status: z.literal("created"), kind: z.literal("quest"), quest_id: IdentifierSchema, slug: SlugSchema, quest_status: z.literal("active"), message: z.string().trim().min(1).max(500), next_action: NextActionSchema }).strict();
export const CreateChallengeResponseSchema = z.strictObject({ status: z.literal("created"), kind: z.literal("challenge"), challenge_id: IdentifierSchema, quest_id: IdentifierSchema, challenge_status: z.literal("open"), message: z.string().trim().min(1).max(500), next_action: NextActionSchema }).strict();
export const ProposeResponseSchema = z.discriminatedUnion("kind", [CreateQuestResponseSchema, CreateChallengeResponseSchema]);
export const ApiErrorResponseSchema = z.strictObject({ status: z.enum(["invalid_input", "not_found", "quest_unavailable", "challenge_unavailable", "contribution_unavailable", "self_review_forbidden", "rate_limited", "error"]), message: z.string().trim().min(1).max(500), next_action: NextActionSchema.optional() }).strict();
export const WebMCPToolInputJsonSchemas = {
  openquest_observe: z.toJSONSchema(ObserveInputSchema, { io: "input", target: "draft-7" }),
  openquest_next: z.toJSONSchema(GetNextWorkInputSchema, { io: "input", target: "draft-7" }),
  openquest_submit: z.toJSONSchema(SubmitContributionInputSchema, { io: "input", target: "draft-7" }),
  openquest_review: z.toJSONSchema(ReviewContributionInputSchema, { io: "input", target: "draft-7" }),
  openquest_propose: z.toJSONSchema(ProposeInputSchema, { io: "input", target: "draft-7" }),
} as const;

export type Quest = z.output<typeof QuestSchema>;
export type OrganizationSummary = z.output<typeof OrganizationSummarySchema>;

export function isOfficialOrganization(
  organization: Pick<OrganizationSummary, "is_demo" | "verification_status">,
): boolean {
  return organization.verification_status === "verified" && !organization.is_demo;
}

export type QuestWithOrganization = z.output<typeof QuestWithOrganizationSchema>;
export type Challenge = z.output<typeof ChallengeSchema>;
export type Contribution = z.output<typeof ContributionSchema>;
export type ContributionPreview = z.output<typeof ContributionPreviewSchema>;
export type Review = z.output<typeof ReviewSchema>;
export type Event = z.output<typeof EventSchema>;
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
export type ChallengeDetailResponse = z.output<typeof ChallengeDetailResponseSchema>;
export type GetNextWorkResponse = z.output<typeof GetNextWorkResponseSchema>;
export type SubmitContributionResponse = z.output<typeof SubmitContributionResponseSchema>;
export type ReviewContributionResponse = z.output<typeof ReviewContributionResponseSchema>;
export type CreateQuestResponse = z.output<typeof CreateQuestResponseSchema>;
export type CreateChallengeResponse = z.output<typeof CreateChallengeResponseSchema>;
export type ProposeResponse = z.output<typeof ProposeResponseSchema>;
export type ApiErrorResponse = z.output<typeof ApiErrorResponseSchema>;
