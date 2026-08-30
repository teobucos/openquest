import { describe, expect, it } from "bun:test";
import {
  ApiErrorResponseSchema,
  ContributionPreviewSchema,
  ContributionResponseSchema,
  CreateChallengeInputSchema,
  CreateQuestInputSchema,
  EventSchema,
  FreshnessSchema,
  GetNextWorkInputSchema,
  ObserveInputSchema,
  ObserveResponseSchema,
  ProposeInputSchema,
  RecentlyActiveAgentSchema,
  ReviewContributionInputSchema,
  SubmitContributionInputSchema,
  WebMCPToolInputJsonSchemas,
  WorkQueuesSchema,
} from "../src/contracts";

describe("OpenQuest public contracts", () => {
  it("defaults observation and automatic work selection", () => {
    expect(ObserveInputSchema.parse({})).toEqual({ limit: 10 });
    expect(GetNextWorkInputSchema.parse({})).toEqual({ mode: "any" });
    expect(
      GetNextWorkInputSchema.parse({ quest_id: "quest_research", mode: "review" }),
    ).toEqual({ quest_id: "quest_research", mode: "review" });
    expect(GetNextWorkInputSchema.safeParse({ mode: "reserve" }).success).toBe(false);
  });

  it("accepts only support and challenge Review verdicts", () => {
    const validInput = {
      contribution_id: "contribution_1",
      reason: "The public evidence supports this conclusion.",
    };

    for (const verdict of ["support", "challenge"]) {
      expect(ReviewContributionInputSchema.safeParse({ ...validInput, verdict }).success).toBe(
        true,
      );
    }

    expect(
      ReviewContributionInputSchema.safeParse({ ...validInput, verdict: "reject" }).success,
    ).toBe(false);
  });

  it("enforces Contribution bounds, meaningful content, and safe evidence", () => {
    const validInput = {
      challenge_id: "challenge_1",
      summary: "A bounded public result",
      content: "The complete public Contribution.",
    };

    expect(SubmitContributionInputSchema.safeParse(validInput).success).toBe(true);
    expect(
      SubmitContributionInputSchema.parse({ ...validInput, content: "  preserved\n" }).content,
    ).toBe("  preserved\n");
    expect(
      SubmitContributionInputSchema.safeParse({ ...validInput, content: " \n\t " }).success,
    ).toBe(false);
    expect(
      SubmitContributionInputSchema.safeParse({ ...validInput, summary: "x".repeat(801) })
        .success,
    ).toBe(false);
    expect(
      SubmitContributionInputSchema.safeParse({ ...validInput, content: "x".repeat(12_001) })
        .success,
    ).toBe(false);

    for (const url of ["javascript:alert(1)", "data:text/plain,public", "file:///tmp/a"]) {
      expect(
        SubmitContributionInputSchema.safeParse({
          ...validInput,
          evidence: [{ url, title: "Unsafe URL" }],
        }).success,
      ).toBe(false);
    }

    expect(
      SubmitContributionInputSchema.safeParse({
        ...validInput,
        evidence: [{ url: "https://example.com/evidence", title: "   " }],
      }).success,
    ).toBe(false);
  });

  it("keeps Quest, Challenge, and proposal inputs strictly closed", () => {
    const questInput = {
      title: "Open Research Quest",
      goal: "Build a source-backed map of an open research question.",
    };
    const challengeInput = {
      quest_id: "quest_research",
      title: "Cross-check one published claim",
      description: "Compare the claim directly with its cited primary source.",
    };

    expect(CreateQuestInputSchema.safeParse(questInput).success).toBe(true);
    expect(CreateChallengeInputSchema.safeParse(challengeInput).success).toBe(true);
    expect(
      CreateQuestInputSchema.safeParse({ ...questInput, unexpected_field: true }).success,
    ).toBe(false);
    expect(
      CreateChallengeInputSchema.safeParse({ ...challengeInput, unexpected_field: true }).success,
    ).toBe(false);
    expect(
      ProposeInputSchema.safeParse({
        kind: "quest",
        ...questInput,
        unexpected_field: true,
      }).success,
    ).toBe(false);
  });

  it("accepts both proposal variants and rejects mixed proposals", () => {
    expect(
      ProposeInputSchema.safeParse({
        kind: "quest",
        title: "Open Research Quest",
        goal: "Build a source-backed map of an open research question.",
      }).success,
    ).toBe(true);
    expect(
      ProposeInputSchema.safeParse({
        kind: "challenge",
        quest_id: "quest_research",
        title: "Cross-check one published claim",
        description: "Compare the claim directly with its cited primary source.",
      }).success,
    ).toBe(true);
    expect(
      ProposeInputSchema.safeParse({
        kind: "quest",
        title: "Mixed proposal",
        goal: "This proposal incorrectly combines both contract variants.",
        quest_id: "quest_research",
      }).success,
    ).toBe(false);
  });

  it("publishes compact public previews and direct event summaries", () => {
    const timestamp = "2026-08-30T12:00:00.000Z";

    expect(
      ContributionPreviewSchema.safeParse({
        id: "contribution_1",
        summary: "A public result",
        status: "pending",
        created_at: timestamp,
      }).success,
    ).toBe(true);
    expect(
      ContributionPreviewSchema.safeParse({
        id: "contribution_1",
        summary: "A public result",
        status: "pending",
        created_at: timestamp,
        unexpected_field: true,
      }).success,
    ).toBe(false);
    expect(
      EventSchema.safeParse({
        sequence: 1,
        quest_id: "quest_research",
        quest_slug: "open-research",
        quest_title: "Open Research Quest",
        entity_id: "challenge_1",
        event_type: "challenge.created",
        actor_label: null,
        summary: "New Challenge: Cross-check one published claim",
        created_at: timestamp,
      }).success,
    ).toBe(true);
    expect(
      ApiErrorResponseSchema.safeParse({
        status: "contribution_unavailable",
        message: "The Contribution is no longer available.",
      }).success,
    ).toBe(true);
  });

  it("keeps observe compact and Contribution Review singular", () => {
    const timestamp = "2026-08-30T12:00:00.000Z";
    const quest = {
      id: "quest_research",
      slug: "open-research",
      title: "Open Research Quest",
      goal: "Build a source-backed map of an open research question.",
      description: "",
      status: "active" as const,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const challenge = {
      id: "challenge_1",
      quest_id: quest.id,
      title: "Cross-check one published claim",
      description: "Compare the claim directly with a primary public source.",
      status: "awaiting_review" as const,
      created_at: timestamp,
      updated_at: timestamp,
    };
    const commandCenter = {
      recent_agents: [],
      work_queues: { review: [], open: [] },
      freshness: { server_time: timestamp, last_sequence: 0 },
    };

    const unscopedObservation = ObserveResponseSchema.parse({
      quests: [{ ...quest, counts: { open: 0, awaiting_review: 1, resolved: 0 }, active_agents: 1 }],
      totals: { open: 0, awaiting_review: 1, resolved: 0 },
      active_agents: 1,
      ...commandCenter,
      activity: [],
    });
    expect(unscopedObservation).not.toHaveProperty("challenges");

    const scopedObservation = ObserveResponseSchema.parse({
      quests: [{ ...quest, counts: { open: 0, awaiting_review: 1, resolved: 0 }, active_agents: 1 }],
      totals: { open: 0, awaiting_review: 1, resolved: 0 },
      active_agents: 1,
      ...commandCenter,
      challenges: [],
      activity: [],
    });
    expect(scopedObservation.challenges).toEqual([]);
    expect(
      ObserveResponseSchema.safeParse({
        quests: [],
        totals: { open: 0, awaiting_review: 0, resolved: 0 },
        active_agents: 0,
        ...commandCenter,
        activity: [],
        suggested_next: "Call openquest_next.",
      }).success,
    ).toBe(false);

    expect(
      ContributionResponseSchema.safeParse({
        contribution: {
          id: "contribution_1",
          challenge_id: challenge.id,
          actor_label: "Agent ABC123",
          summary: "A concise public result",
          content: "The complete public Contribution.",
          evidence: [],
          status: "pending",
          created_at: timestamp,
        },
        challenge,
        quest: { id: quest.id, slug: quest.slug, title: quest.title },
        review: null,
      }).success,
    ).toBe(true);
  });

  it("keeps command-center activity truthful, closed, and bounded", () => {
    const timestamp = "2026-08-30T12:00:00.000Z";
    const quest = {
      id: "quest_research",
      slug: "open-research",
      title: "Open Research Quest",
    };
    const agent = {
      actor_label: "Agent A1B2C3D4",
      quest,
      last_event: "contribution.created" as const,
      last_entity_id: "contribution_1",
      last_summary: "Contribution submitted: Cross-check one claim",
      last_seen: timestamp,
      activity_count: 2,
    };
    expect(RecentlyActiveAgentSchema.safeParse(agent).success).toBe(true);
    expect(
      RecentlyActiveAgentSchema.safeParse({ ...agent, last_event: "quest.created" }).success,
    ).toBe(false);
    expect(
      RecentlyActiveAgentSchema.safeParse({ ...agent, session_id: "private" }).success,
    ).toBe(false);

    const reviewItem = {
      work_type: "review" as const,
      quest,
      challenge: {
        id: "challenge_1",
        title: "Cross-check one claim",
        description: "Compare the claim directly with its cited primary source.",
        created_at: timestamp,
        status: "awaiting_review" as const,
      },
      contribution: {
        id: "contribution_1",
        actor_label: "Agent A1B2C3D4",
        summary: "A public result",
        created_at: timestamp,
      },
    };
    const openItem = {
      work_type: "contribute" as const,
      quest,
      challenge: {
        id: "challenge_2",
        title: "Document another source",
        description: "Find and document another reliable public primary source.",
        created_at: timestamp,
        status: "open" as const,
      },
    };
    expect(WorkQueuesSchema.safeParse({ review: [reviewItem], open: [openItem] }).success).toBe(true);
    expect(
      WorkQueuesSchema.safeParse({ review: Array.from({ length: 11 }, () => reviewItem), open: [] }).success,
    ).toBe(false);
    expect(FreshnessSchema.safeParse({ server_time: timestamp, last_sequence: 0 }).success).toBe(true);
    expect(FreshnessSchema.safeParse({ server_time: timestamp, last_sequence: -1 }).success).toBe(false);
  });

  it("publishes exactly five canonical WebMCP input schemas", () => {
    expect(Object.keys(WebMCPToolInputJsonSchemas).sort()).toEqual([
      "openquest_next",
      "openquest_observe",
      "openquest_propose",
      "openquest_review",
      "openquest_submit",
    ]);

    expect(WebMCPToolInputJsonSchemas.openquest_next.required ?? []).not.toContain("mode");
    expect(WebMCPToolInputJsonSchemas.openquest_observe.required ?? []).not.toContain("limit");
    expect(WebMCPToolInputJsonSchemas.openquest_submit.required ?? []).not.toContain("evidence");
    expect(WebMCPToolInputJsonSchemas.openquest_review.required ?? []).not.toContain("evidence");
    expect(WebMCPToolInputJsonSchemas.openquest_submit.properties?.content).toMatchObject({
      minLength: 1,
      maxLength: 12_000,
    });
    expect(WebMCPToolInputJsonSchemas.openquest_observe.properties?.limit).toMatchObject({
      description: "Maximum active Quests and recent activity entries to return. Challenge previews, recent agents, and work queues use separate fixed bounds.",
    });
    expect(WebMCPToolInputJsonSchemas.openquest_observe.properties?.quest_id).toMatchObject({
      description: "Canonical Quest ID returned by OpenQuest. Do not use the human-readable URL slug.",
    });
    expect(WebMCPToolInputJsonSchemas.openquest_submit.properties?.challenge_id).toMatchObject({
      description: "Canonical Challenge ID returned by OpenQuest.",
    });
    expect(WebMCPToolInputJsonSchemas.openquest_review.properties?.contribution_id).toMatchObject({
      description: "Canonical Contribution ID returned by OpenQuest.",
    });
    expect(() => JSON.stringify(WebMCPToolInputJsonSchemas)).not.toThrow();
    expect([
      WebMCPToolInputJsonSchemas.openquest_observe,
      WebMCPToolInputJsonSchemas.openquest_next,
      WebMCPToolInputJsonSchemas.openquest_submit,
      WebMCPToolInputJsonSchemas.openquest_review,
    ].every((schema) => schema.additionalProperties === false)).toBe(true);
    const proposalVariants = WebMCPToolInputJsonSchemas.openquest_propose.oneOf ?? [];
    expect(proposalVariants).toHaveLength(2);
    const serializedVariants = proposalVariants.map((variant) => JSON.stringify(variant));
    expect(serializedVariants.some((variant) => variant.includes('"const":"challenge"'))).toBe(true);
    expect(serializedVariants.some((variant) => variant.includes('"const":"quest"'))).toBe(true);
    expect(serializedVariants.every((variant) => variant.includes('"additionalProperties":false')))
      .toBe(true);
    const questVariant = serializedVariants.find((variant) => variant.includes('"const":"quest"'));
    expect(questVariant).toContain('"required":["kind","title","goal"]');
    expect(ApiErrorResponseSchema.safeParse({ status: "conflict", message: "Unused." }).success)
      .toBe(false);
  });
});
