import { describe, expect, it } from "bun:test";
import {
  ApiErrorResponseSchema,
  ContributionPreviewSchema,
  CreateChallengeInputSchema,
  CreateQuestInputSchema,
  EventSchema,
  GetNextWorkInputSchema,
  ObserveInputSchema,
  ProposeInputSchema,
  ReviewContributionInputSchema,
  SubmitContributionInputSchema,
  WebMCPToolInputJsonSchemas,
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
  });
});
