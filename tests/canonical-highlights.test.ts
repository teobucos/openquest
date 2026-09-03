import { expect, test } from "bun:test";
import {
  LIVE_EFFECT_MS,
  canonicalMetricDeltas,
  changedWorkChallengeIds,
  dashboardScopeKey,
  formatMetricDelta,
  metricDelta,
} from "../src/dashboard/canonicalHighlights";
import type { ObserveResponse } from "../src/contracts";

const timestamp = "2026-09-01T12:00:00.000Z";
const quest = {
  id: "quest_research",
  is_demo: true,
  organization: null,
  slug: "open-research",
  title: "Open Research Quest",
};

function workItem(
  id: string,
  streamState: ObserveResponse["work_stream"][number]["stream_state"],
): ObserveResponse["work_stream"][number] {
  const challengeStatus = streamState === "review"
    ? "awaiting_review" as const
    : streamState === "resolved"
      ? "resolved" as const
      : "open" as const;
  return {
    challenge: {
      created_at: timestamp,
      description: "Compare the claim directly with its cited primary public source.",
      id,
      status: challengeStatus,
      title: `Challenge ${id}`,
      updated_at: timestamp,
    },
    contribution: streamState === "open"
      ? null
      : {
          actor_label: "Agent 9D2DB8BE",
          created_at: timestamp,
          id: `contribution_${id}`,
          status: streamState === "resolved" ? "accepted" as const : "pending" as const,
          summary: "Public work",
        },
    quest,
    stream_state: streamState,
  };
}

test("live effect duration stays in the demo-readable window", () => {
  expect(LIVE_EFFECT_MS).toBeGreaterThanOrEqual(1000);
  expect(LIVE_EFFECT_MS).toBeLessThanOrEqual(1500);
});

test("scope keys distinguish network navigation from Quest identity", () => {
  expect(dashboardScopeKey({ kind: "network" }, null)).toBe("network");
  expect(dashboardScopeKey({ kind: "quest", slug: "tide-notes" }, "quest_tide")).toBe("quest:quest_tide");
  expect(dashboardScopeKey({ kind: "quest", slug: "tide-notes" }, null)).toBe("network");
});

test("metric deltas omit zeros and format signed non-zero changes", () => {
  expect(metricDelta(12, 12)).toBeNull();
  expect(metricDelta(12, 11)).toBe(-1);
  expect(metricDelta(5, 6)).toBe(1);
  expect(formatMetricDelta(1)).toBe("+1");
  expect(formatMetricDelta(-1)).toBe("-1");
  expect(canonicalMetricDeltas(
    { awaiting_review: 5, contributor_count: 4, event_count: 126, open: 12, resolved: 20 },
    { awaiting_review: 6, contributor_count: 4, event_count: 127, open: 11, resolved: 21 },
  )).toEqual({
    awaiting_review: 1,
    contributor_count: null,
    event_count: 1,
    open: -1,
    resolved: 1,
  });
});

test("work-row highlights include state changes and newly appeared Challenges", () => {
  const previous = [workItem("challenge_existing", "open")];
  const next = [
    workItem("challenge_existing", "review"),
    workItem("challenge_new", "open"),
  ];
  expect([...changedWorkChallengeIds(previous, next)].sort()).toEqual([
    "challenge_existing",
    "challenge_new",
  ]);
  expect([...changedWorkChallengeIds(next, next)]).toEqual([]);
});
