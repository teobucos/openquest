import { describe, expect, it } from "bun:test";
import {
  ChallengeDetailResponseSchema,
  CreateQuestInputSchema,
  FreshnessSchema,
  isOfficialOrganization,
  ObserveInputSchema,
  ObserveResponseSchema,
  OrganizationCategorySchema,
  OrganizationSummarySchema,
  OrganizationVerificationStatusSchema,
  ProposeInputSchema,
  WebMCPToolInputJsonSchemas,
  WorkStreamSchema,
} from "../src/contracts";

const timestamp = "2026-09-01T12:00:00.000Z";
const organization = { id: "organization_demo", slug: "fictional-lab", name: "Fictional Lab", category: "research" as const, verification_status: "unverified" as const, is_demo: true, ror_id: null };
const quest = { id: "quest_research", slug: "open-research", title: "Open Research Quest", goal: "Build a source-backed map of an open research question.", description: "", status: "active" as const, is_demo: true, created_at: timestamp, updated_at: timestamp, organization };
const challenge = { id: "challenge_1", quest_id: quest.id, title: "Cross-check one claim", description: "Compare the claim directly with its cited primary public source.", status: "awaiting_review" as const, created_at: timestamp, updated_at: timestamp };

describe("OpenQuest live-domain contracts", () => {
  it("keeps public write inputs closed and organization-free", () => {
    const input = { title: "Community Quest", goal: "Establish an open problem that public contributors can move forward." };
    expect(CreateQuestInputSchema.safeParse(input).success).toBe(true);
    expect(CreateQuestInputSchema.safeParse({ ...input, organization_id: "organization_demo" }).success).toBe(false);
    expect(ProposeInputSchema.safeParse({ kind: "quest", ...input, primary_organization_id: "organization_demo" }).success).toBe(false);
    expect(ObserveInputSchema.parse({})).toEqual({ limit: 10 });
    expect(ObserveInputSchema.safeParse({ quest_slug: quest.slug }).success).toBe(false);
    expect(CreateQuestInputSchema.safeParse({ ...input, is_demo: true }).success).toBe(false);
  });

  it("projects server-controlled Quest demo provenance", () => {
    expect(ObserveResponseSchema.safeParse({
      activity: [],
      contributor_count: 0,
      freshness: { event_count: 0, last_sequence: 0, server_time: timestamp },
      quests: [{ ...quest, counts: { awaiting_review: 0, open: 0, resolved: 0 } }],
      recent_contributors: [],
      totals: { awaiting_review: 0, open: 0, resolved: 0 },
      work_stream: [],
    }).success).toBe(true);
    expect(ObserveResponseSchema.safeParse({
      activity: [],
      contributor_count: 0,
      freshness: { event_count: 0, last_sequence: 0, server_time: timestamp },
      quests: [{ ...quest, counts: { awaiting_review: 0, open: 0, resolved: 0 }, is_demo: undefined }],
      recent_contributors: [],
      totals: { awaiting_review: 0, open: 0, resolved: 0 },
      work_stream: [],
    }).success).toBe(false);
  });

  it("projects only bounded, strict public organization metadata", () => {
    expect(OrganizationSummarySchema.parse(organization).ror_id).toBeNull();
    expect(OrganizationSummarySchema.safeParse({ ...organization, ror_id: "https://ror.org/03yrm5c26" }).success).toBe(true);
    expect(OrganizationSummarySchema.safeParse({ ...organization, ror_id: "ror.org/03yrm5c26" }).success).toBe(false);
    expect(OrganizationSummarySchema.safeParse({ ...organization, ror_id: "https://ror.org/03yrm5c2" }).success).toBe(false);
    expect(OrganizationSummarySchema.safeParse({ ...organization, category: "university" }).success).toBe(false);
    expect(OrganizationSummarySchema.safeParse({ ...organization, verification_status: "pending" }).success).toBe(false);
    expect(OrganizationSummarySchema.safeParse({ ...organization, verification_notes: "private" }).success).toBe(false);
    expect(OrganizationSummarySchema.safeParse({ ...organization, official: true }).success).toBe(false);
    expect(OrganizationCategorySchema.options).toEqual(["research", "education", "healthcare", "company", "nonprofit", "government", "funder", "other"]);
    expect(OrganizationVerificationStatusSchema.options).toEqual(["unverified", "verified"]);
  });

  it("derives official provenance without accepting or storing an official field", () => {
    expect(isOfficialOrganization({ is_demo: false, verification_status: "verified" })).toBe(true);
    expect(isOfficialOrganization({ is_demo: true, verification_status: "verified" })).toBe(false);
    expect(isOfficialOrganization({ is_demo: false, verification_status: "unverified" })).toBe(false);
    expect(CreateQuestInputSchema.safeParse({
      goal: "Keep organization provenance derived from reviewed metadata rather than public writes.",
      official: true,
      title: "No official input",
    }).success).toBe(false);
  });

  it("uses one compact work stream with pending, open, and accepted presentation", () => {
    const { quest_id: _questId, ...streamChallenge } = challenge;
    const review = { stream_state: "review" as const, quest: { id: quest.id, slug: quest.slug, title: quest.title, is_demo: true, organization }, challenge: streamChallenge, contribution: { id: "contribution_pending", actor_label: "Contributor A", summary: "Pending public work", status: "pending" as const, created_at: timestamp } };
    const open = { stream_state: "open" as const, quest: { id: quest.id, slug: quest.slug, title: quest.title, is_demo: false, organization: null }, challenge: { ...streamChallenge, id: "challenge_2", status: "open" as const }, contribution: null };
    const resolved = { stream_state: "resolved" as const, quest: { id: quest.id, slug: quest.slug, title: quest.title, is_demo: true, organization }, challenge: { ...streamChallenge, id: "challenge_3", status: "resolved" as const }, contribution: { id: "contribution_accepted", actor_label: "Contributor B", summary: "Accepted public work", status: "accepted" as const, created_at: timestamp } };
    expect(WorkStreamSchema.parse([review, open, resolved])).toHaveLength(3);
    expect(WorkStreamSchema.safeParse([{ ...open, contribution: review.contribution }]).success).toBe(false);
    expect(WorkStreamSchema.safeParse([{ ...resolved, contribution: review.contribution }]).success).toBe(false);
    expect(WorkStreamSchema.safeParse(Array.from({ length: 31 }, () => open)).success).toBe(false);
  });

  it("publishes truthful contributor and freshness totals", () => {
    const observation = ObserveResponseSchema.parse({
      quests: [{ ...quest, counts: { open: 1, awaiting_review: 1, resolved: 1 } }], totals: { open: 1, awaiting_review: 1, resolved: 1 }, contributor_count: 4,
      recent_contributors: [{ actor_label: "Contributor A", quest: { id: quest.id, slug: quest.slug, title: quest.title, is_demo: true, organization }, last_event: "contribution.created", last_entity_id: "contribution_pending", last_summary: "Contribution submitted: Cross-check one claim", last_active_at: timestamp, activity_count: 2 }],
      work_stream: [], freshness: { server_time: timestamp, last_sequence: 42, event_count: 41 }, activity: [],
    });
    expect(observation.contributor_count).toBe(4);
    expect(FreshnessSchema.safeParse({ server_time: timestamp, last_sequence: 2 }).success).toBe(false);
    expect(ObserveResponseSchema.safeParse({ ...observation, active_agents: 2 }).success).toBe(false);
  });

  it("returns bounded chronological Challenge history with nullable Reviews", () => {
    expect(ChallengeDetailResponseSchema.safeParse({
      quest, challenge,
      contributions: [{ id: "contribution_pending", challenge_id: challenge.id, actor_label: "Contributor A", summary: "Pending public work", content: "Complete public contribution content.", evidence: [{ url: "https://example.com/evidence", title: "Public evidence" }], status: "pending", created_at: timestamp, review: null }],
    }).success).toBe(true);
  });

  it("continues to publish exactly five WebMCP input schemas", () => {
    expect(Object.keys(WebMCPToolInputJsonSchemas).sort()).toEqual(["openquest_next", "openquest_observe", "openquest_propose", "openquest_review", "openquest_submit"]);
    expect(WebMCPToolInputJsonSchemas.openquest_observe.properties?.quest_id).toMatchObject({ description: "Canonical Quest ID returned by OpenQuest. Do not use the human-readable URL slug." });
    expect(WebMCPToolInputJsonSchemas.openquest_observe.properties).not.toHaveProperty("quest_slug");
  });
});
