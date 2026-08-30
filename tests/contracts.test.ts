import { describe, expect, it } from "bun:test";
import {
  CreateChallengeInputSchema,
  CreateQuestInputSchema,
  GetNextWorkInputSchema,
  ProposeInputSchema,
  ReviewContributionInputSchema,
  SubmitContributionInputSchema,
  WebMCPToolInputJsonSchemas,
} from "../src/contracts";

describe("OpenQuest public contracts", () => {
  it("defaults automatic work selection and accepts explicit Quest Review selection", () => {
    expect(GetNextWorkInputSchema.parse({})).toEqual({ mode: "any" });
    expect(
      GetNextWorkInputSchema.parse({ quest_id: "quest_research", mode: "review" }),
    ).toEqual({ quest_id: "quest_research", mode: "review" });
    expect(GetNextWorkInputSchema.safeParse({ mode: "reserve" }).success).toBe(false);
    expect(
      GetNextWorkInputSchema.safeParse({ mode: "any", budget_minutes: 10 }).success,
    ).toBe(false);
  });

  it("accepts only support and challenge Review verdicts", () => {
    for (const verdict of ["support", "challenge"]) {
      expect(
        ReviewContributionInputSchema.safeParse({
          contribution_id: "contribution_1",
          verdict,
          reason: "The public evidence supports this conclusion.",
        }).success,
      ).toBe(true);
    }

    for (const verdict of ["needs_work", "approve", "reject"]) {
      expect(
        ReviewContributionInputSchema.safeParse({
          contribution_id: "contribution_1",
          verdict,
          reason: "Unsupported verdict",
        }).success,
      ).toBe(false);
    }
  });

  it("enforces Contribution bounds, safe evidence URLs, and closed input", () => {
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
      SubmitContributionInputSchema.safeParse({ ...validInput, summary: "x".repeat(801) })
        .success,
    ).toBe(false);
    expect(
      SubmitContributionInputSchema.safeParse({ ...validInput, content: "x".repeat(12_001) })
        .success,
    ).toBe(false);

    for (const url of ["javascript:alert(1)", "data:text/plain,secret", "file:///tmp/a"]) {
      expect(
        SubmitContributionInputSchema.safeParse({
          ...validInput,
          evidence: [{ url, title: "Unsafe URL" }],
        }).success,
      ).toBe(false);
    }

    expect(
      SubmitContributionInputSchema.safeParse({ ...validInput, priority: 5 }).success,
    ).toBe(false);
    expect(
      SubmitContributionInputSchema.safeParse({
        ...validInput,
        result: { answer: "Legacy result" },
      }).success,
    ).toBe(false);
  });

  it("strictly validates Quest and Challenge creation", () => {
    expect(
      CreateQuestInputSchema.safeParse({
        title: "Open Research Quest",
        goal: "Build a source-backed map of an open research question.",
      }).success,
    ).toBe(true);
    expect(
      CreateQuestInputSchema.safeParse({
        title: "Open Research Quest",
        goal: "Build a source-backed map of an open research question.",
        kind: "discover",
      }).success,
    ).toBe(false);
    expect(
      CreateChallengeInputSchema.safeParse({
        quest_id: "quest_research",
        title: "Cross-check one published claim",
        description: "Compare the claim directly with its cited primary source.",
        priority: 5,
      }).success,
    ).toBe(false);
    expect(
      CreateChallengeInputSchema.safeParse({
        quest_id: "quest_research",
        title: "Cross-check one published claim",
        description: "Compare the claim directly with its cited primary source.",
        rationale: "Legacy field",
      }).success,
    ).toBe(false);
    expect(
      CreateChallengeInputSchema.safeParse({
        quest_id: "quest_research",
        title: "Cross-check one published claim",
        description: "Compare the claim directly with its cited primary source.",
        acceptance_criteria: ["Legacy field"],
      }).success,
    ).toBe(false);
  });

  it("accepts both proposal variants and rejects mixed proposals", () => {
    expect(
      ProposeInputSchema.safeParse({
        kind: "quest",
        title: "Open Research Quest",
        goal: "Build a source-backed map of an open research question.",
        description: "All work and source metadata will remain public.",
      }).success,
    ).toBe(true);
    expect(
      ProposeInputSchema.safeParse({
        kind: "challenge",
        quest_id: "quest_research",
        title: "Cross-check one published claim",
        description: "Compare the claim directly with its cited primary source.",
        parent_challenge_id: "challenge_parent",
      }).success,
    ).toBe(true);
    expect(
      ProposeInputSchema.safeParse({
        kind: "quest",
        quest_id: "quest_research",
        title: "Mixed proposal",
        goal: "This proposal incorrectly combines both contract variants.",
      }).success,
    ).toBe(false);
    expect(
      ProposeInputSchema.safeParse({
        kind: "challenge",
        quest_id: "quest_research",
        title: "Mixed proposal",
        description: "This proposal incorrectly includes a Quest-only goal field.",
        goal: "This field belongs only to a Quest proposal.",
      }).success,
    ).toBe(false);
  });

  it("publishes exactly five canonical, closed WebMCP tool schemas", () => {
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

    for (const [name, schema] of Object.entries(WebMCPToolInputJsonSchemas)) {
      if (name === "openquest_propose") {
        const alternatives = "oneOf" in schema ? schema.oneOf : schema.anyOf;
        expect(alternatives).toBeArray();
        for (const alternative of alternatives ?? []) {
          expect(alternative.additionalProperties).toBe(false);
        }
      } else {
        expect(schema.additionalProperties).toBe(false);
      }
    }
  });
});
