import { z } from "zod";

const IdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Identifier contains unsupported characters");

const IsoTimestampSchema = z.string().datetime({ offset: true });

const UrlSchema = z.httpUrl().max(2_048);

const ShortTextSchema = z.string().trim().min(1).max(200);

export const EvidenceSchema = z
  .object({
    url: UrlSchema,
    title: ShortTextSchema,
    note: z.string().trim().max(400).optional(),
  })
  .strict();

export const EvidenceListSchema = z.array(EvidenceSchema).max(5);
export const evidenceListSchema = EvidenceListSchema;

const StructuredDataSchema = z.record(
  z.string().trim().min(1).max(64),
  z.string().trim().max(1_000),
);

export const MissionTypeSchema = z.enum(["discover", "structure", "build"]);
export const MissionStatusSchema = z.enum(["active", "complete"]);
export const NeedKindSchema = z.enum([
  "question",
  "gap",
  "check",
  "artifact",
  "dispute",
]);
export const NeedStatusSchema = z.enum(["open", "awaiting_review", "resolved"]);
export const ContributionStatusSchema = z.enum([
  "pending",
  "accepted",
  "challenged",
  "superseded",
]);
export const ReviewVerdictSchema = z.enum(["support", "challenge", "needs_work"]);

export const ContributionResultSchema = z
  .object({
    answer: z.string().trim().min(1).max(6_000),
    structured_data: StructuredDataSchema.optional(),
    artifact: z.string().trim().max(12_000).optional(),
  })
  .strict();
export const contributionResultSchema = ContributionResultSchema;

export const SessionSchema = z
  .object({
    id: IdentifierSchema,
    created_at: IsoTimestampSchema,
    last_seen_at: IsoTimestampSchema,
  })
  .strict();

export const MissionSchema = z
  .object({
    id: IdentifierSchema,
    slug: z.string().trim().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    title: ShortTextSchema,
    goal: z.string().trim().min(1).max(2_000),
    description: z.string().trim().max(6_000),
    type: MissionTypeSchema,
    status: MissionStatusSchema,
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
  })
  .strict();

export const NeedSchema = z
  .object({
    id: IdentifierSchema,
    mission_id: IdentifierSchema,
    parent_need_id: IdentifierSchema.nullable(),
    kind: NeedKindSchema,
    title: z.string().trim().min(3).max(160),
    instructions: z.string().trim().min(10).max(1_200),
    rationale: z.string().trim().max(800),
    acceptance_criteria: z.array(z.string().trim().min(1).max(240)).max(6),
    priority: z.number().int().min(1).max(5),
    status: NeedStatusSchema,
    created_at: IsoTimestampSchema,
    updated_at: IsoTimestampSchema,
  })
  .strict();

export const ContributionSchema = z
  .object({
    id: IdentifierSchema,
    need_id: IdentifierSchema,
    actor_label: z.string().trim().min(1).max(40),
    summary: z.string().trim().min(1).max(800),
    result: ContributionResultSchema,
    evidence: EvidenceListSchema,
    status: ContributionStatusSchema,
    created_at: IsoTimestampSchema,
  })
  .strict();

export const ReviewSchema = z
  .object({
    id: IdentifierSchema,
    contribution_id: IdentifierSchema,
    reviewer_label: z.string().trim().min(1).max(40),
    verdict: ReviewVerdictSchema,
    reason: z.string().trim().min(1).max(1_000),
    evidence: EvidenceListSchema,
    created_at: IsoTimestampSchema,
  })
  .strict();

export const EventTypeSchema = z.enum([
  "need.created",
  "contribution.created",
  "review.supported",
  "review.challenged",
  "review.needs_work",
]);

export const EventSchema = z
  .object({
    sequence: z.number().int().positive(),
    mission_id: IdentifierSchema,
    entity_type: z.enum(["need", "contribution", "review"]),
    entity_id: IdentifierSchema,
    event_type: EventTypeSchema,
    actor_label: z.string().trim().min(1).max(40).nullable(),
    summary: z.string().trim().min(1).max(500),
    created_at: IsoTimestampSchema,
  })
  .strict();

export const ObserveMissionsInputSchema = z
  .object({
    mission_id: IdentifierSchema.optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();

export const GetNextWorkInputSchema = z
  .object({
    mission_id: IdentifierSchema.optional(),
    mode: z.enum(["any", "contribute", "review"]).default("any"),
    budget_minutes: z.number().int().min(1).max(30).optional(),
  })
  .strict();

export const SubmitContributionInputSchema = z
  .object({
    need_id: IdentifierSchema,
    summary: z.string().trim().min(1).max(800),
    result: ContributionResultSchema,
    evidence: EvidenceListSchema.optional().default([]),
  })
  .strict();

export const ReviewContributionInputSchema = z
  .object({
    contribution_id: IdentifierSchema,
    verdict: ReviewVerdictSchema,
    reason: z.string().trim().min(1).max(1_000),
    evidence: EvidenceListSchema.optional().default([]),
  })
  .strict();

export const ProposeNeedInputSchema = z
  .object({
    mission_id: IdentifierSchema,
    parent_need_id: IdentifierSchema.optional(),
    title: z.string().trim().min(3).max(160),
    instructions: z.string().trim().min(10).max(1_200),
    rationale: z.string().trim().min(10).max(800),
    acceptance_criteria: z.array(z.string().trim().min(1).max(240)).max(6).optional(),
  })
  .strict();

export const MissionCountsSchema = z
  .object({
    open: z.number().int().nonnegative(),
    awaiting_review: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
  })
  .strict();

export const MissionCardSchema = MissionSchema.extend({
  counts: MissionCountsSchema,
  progress: z.number().int().min(0).max(100),
}).strict();

export const NeedWithContributionSchema = NeedSchema.extend({
  contribution: ContributionSchema.nullable(),
}).strict();

export const ObserveMissionsResponseSchema = z
  .object({
    missions: z.array(MissionCardSchema).max(20),
    totals: MissionCountsSchema,
    activity: z.array(EventSchema).max(20),
    suggested_next: z.string().trim().min(1).max(240),
  })
  .strict();

export const MissionResponseSchema = z
  .object({
    mission: MissionSchema,
    counts: MissionCountsSchema,
    needs: z.array(NeedWithContributionSchema).max(100),
    activity: z.array(EventSchema).max(50),
  })
  .strict();

export const ContributionResponseSchema = z
  .object({
    contribution: ContributionSchema,
    need: NeedSchema,
    mission: MissionSchema.pick({ id: true, slug: true, title: true }),
    reviews: z.array(ReviewSchema).max(20),
  })
  .strict();

const WorkNeedSchema = NeedSchema.pick({
  id: true,
  mission_id: true,
  kind: true,
  title: true,
  instructions: true,
  rationale: true,
  acceptance_criteria: true,
  priority: true,
});

export const NextContributionWorkSchema = z
  .object({
    status: z.literal("work_available"),
    work_type: z.literal("contribute"),
    mission: MissionSchema.pick({ id: true, slug: true, title: true, type: true }),
    need: WorkNeedSchema,
    why_now: z.string().trim().min(1).max(500),
    done_when: z.string().trim().min(1).max(500),
  })
  .strict();

export const NextReviewWorkSchema = z
  .object({
    status: z.literal("work_available"),
    work_type: z.literal("review"),
    mission: MissionSchema.pick({ id: true, slug: true, title: true, type: true }),
    need: WorkNeedSchema,
    contribution: ContributionSchema.pick({ id: true, summary: true, result: true, evidence: true }),
    why_now: z.string().trim().min(1).max(500),
    done_when: z.string().trim().min(1).max(500),
  })
  .strict();

export const NoWorkResponseSchema = z
  .object({
    status: z.literal("no_work_available"),
    message: z.string().trim().min(1).max(500),
    next_action: z.string().trim().min(1).max(240),
  })
  .strict();

export const GetNextWorkResponseSchema = z.union([
  NextContributionWorkSchema,
  NextReviewWorkSchema,
  NoWorkResponseSchema,
]);

const NextActionSchema = z
  .object({
    tool: z.enum(["observe_missions", "get_next_work", "submit_contribution", "review_contribution", "propose_need"]),
    reason: z.string().trim().min(1).max(240),
  })
  .strict();

export const SubmitContributionResponseSchema = z
  .object({
    status: z.literal("submitted"),
    contribution_id: IdentifierSchema,
    need_status: z.literal("awaiting_review"),
    message: z.string().trim().min(1).max(500),
    next_action: NextActionSchema,
  })
  .strict();

export const ReviewContributionResponseSchema = z
  .object({
    status: z.literal("review_recorded"),
    review_id: IdentifierSchema,
    verdict: ReviewVerdictSchema,
    need_status: z.enum(["open", "resolved"]),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const ProposeNeedResponseSchema = z
  .object({
    status: z.literal("proposed"),
    need_id: IdentifierSchema,
    mission_id: IdentifierSchema,
    need_status: z.literal("open"),
    message: z.string().trim().min(1).max(500),
    next_action: NextActionSchema,
  })
  .strict();

export const ApiErrorResponseSchema = z
  .object({
    status: z.enum([
      "invalid_input",
      "not_found",
      "need_unavailable",
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

export const observeMissionsInputSchema = ObserveMissionsInputSchema;
export const nextWorkInputSchema = GetNextWorkInputSchema;
export const submitContributionInputSchema = SubmitContributionInputSchema;
export const reviewContributionInputSchema = ReviewContributionInputSchema;
export const proposeNeedInputSchema = ProposeNeedInputSchema;
export const WorldResponseSchema = ObserveMissionsResponseSchema;
export const worldResponseSchema = WorldResponseSchema;
export const missionResponseSchema = MissionResponseSchema;
export const contributionResponseSchema = ContributionResponseSchema;
export const observeMissionsResponseSchema = ObserveMissionsResponseSchema;
export const nextWorkResponseSchema = GetNextWorkResponseSchema;
export const submitContributionResponseSchema = SubmitContributionResponseSchema;
export const reviewContributionResponseSchema = ReviewContributionResponseSchema;
export const proposeNeedResponseSchema = ProposeNeedResponseSchema;

export function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  input: z.input<Schema>,
): z.output<Schema> {
  return schema.parse(input);
}

export const WebMCPToolInputSchemas = {
  observe_missions: ObserveMissionsInputSchema,
  get_next_work: GetNextWorkInputSchema,
  submit_contribution: SubmitContributionInputSchema,
  review_contribution: ReviewContributionInputSchema,
  propose_need: ProposeNeedInputSchema,
};

export const toolInputSchemas = WebMCPToolInputSchemas;

export const WebMCPToolInputJsonSchemas = {
  observe_missions: z.toJSONSchema(ObserveMissionsInputSchema, { target: "draft-7" }),
  get_next_work: z.toJSONSchema(GetNextWorkInputSchema, { target: "draft-7" }),
  submit_contribution: z.toJSONSchema(SubmitContributionInputSchema, { target: "draft-7" }),
  review_contribution: z.toJSONSchema(ReviewContributionInputSchema, { target: "draft-7" }),
  propose_need: z.toJSONSchema(ProposeNeedInputSchema, { target: "draft-7" }),
};

export const ApiResponseJsonSchemas = {
  observe_missions: z.toJSONSchema(ObserveMissionsResponseSchema, { target: "draft-7" }),
  mission: z.toJSONSchema(MissionResponseSchema, { target: "draft-7" }),
  contribution: z.toJSONSchema(ContributionResponseSchema, { target: "draft-7" }),
  get_next_work: z.toJSONSchema(GetNextWorkResponseSchema, { target: "draft-7" }),
  submit_contribution: z.toJSONSchema(SubmitContributionResponseSchema, { target: "draft-7" }),
  review_contribution: z.toJSONSchema(ReviewContributionResponseSchema, { target: "draft-7" }),
  propose_need: z.toJSONSchema(ProposeNeedResponseSchema, { target: "draft-7" }),
  error: z.toJSONSchema(ApiErrorResponseSchema, { target: "draft-7" }),
};

export type Session = z.infer<typeof SessionSchema>;
export type Mission = z.infer<typeof MissionSchema>;
export type Need = z.infer<typeof NeedSchema>;
export type Contribution = z.infer<typeof ContributionSchema>;
export type Review = z.infer<typeof ReviewSchema>;
export type Event = z.infer<typeof EventSchema>;
export type ObserveMissionsInput = z.infer<typeof ObserveMissionsInputSchema>;
export type GetNextWorkInput = z.infer<typeof GetNextWorkInputSchema>;
export type SubmitContributionInput = z.infer<typeof SubmitContributionInputSchema>;
export type ReviewContributionInput = z.infer<typeof ReviewContributionInputSchema>;
export type ProposeNeedInput = z.infer<typeof ProposeNeedInputSchema>;
export type ObserveMissionsResponse = z.infer<typeof ObserveMissionsResponseSchema>;
export type WorldResponse = z.infer<typeof WorldResponseSchema>;
export type MissionResponse = z.infer<typeof MissionResponseSchema>;
export type ContributionResponse = z.infer<typeof ContributionResponseSchema>;
export type GetNextWorkResponse = z.infer<typeof GetNextWorkResponseSchema>;
export type SubmitContributionResponse = z.infer<typeof SubmitContributionResponseSchema>;
export type ReviewContributionResponse = z.infer<typeof ReviewContributionResponseSchema>;
export type ProposeNeedResponse = z.infer<typeof ProposeNeedResponseSchema>;
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
