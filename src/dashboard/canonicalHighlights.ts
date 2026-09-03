import type { ObserveResponse } from "../contracts";
import type { RouteState } from "./navigation";

export const LIVE_EFFECT_MS = 1250;

export interface CanonicalMetricSnapshot {
  readonly awaiting_review: number;
  readonly contributor_count: number;
  readonly event_count: number;
  readonly open: number;
  readonly resolved: number;
}

export interface CanonicalMetricDeltas {
  readonly awaiting_review: number | null;
  readonly contributor_count: number | null;
  readonly event_count: number | null;
  readonly open: number | null;
  readonly resolved: number | null;
}

export const emptyMetricDeltas: CanonicalMetricDeltas = {
  awaiting_review: null,
  contributor_count: null,
  event_count: null,
  open: null,
  resolved: null,
};

export function dashboardScopeKey(scope: RouteState["scope"], questId: string | null): string {
  return scope.kind === "quest" && questId ? `quest:${questId}` : "network";
}

export function metricDelta(previous: number, next: number): number | null {
  const delta = next - previous;
  return delta === 0 ? null : delta;
}

export function formatMetricDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta);
}

export function canonicalMetricSnapshot(data: ObserveResponse): CanonicalMetricSnapshot {
  return {
    awaiting_review: data.totals.awaiting_review,
    contributor_count: data.contributor_count,
    event_count: data.freshness.event_count,
    open: data.totals.open,
    resolved: data.totals.resolved,
  };
}

export function canonicalMetricDeltas(
  previous: CanonicalMetricSnapshot,
  next: CanonicalMetricSnapshot,
): CanonicalMetricDeltas {
  return {
    awaiting_review: metricDelta(previous.awaiting_review, next.awaiting_review),
    contributor_count: metricDelta(previous.contributor_count, next.contributor_count),
    event_count: metricDelta(previous.event_count, next.event_count),
    open: metricDelta(previous.open, next.open),
    resolved: metricDelta(previous.resolved, next.resolved),
  };
}

export function changedWorkChallengeIds(
  previous: ObserveResponse["work_stream"],
  next: ObserveResponse["work_stream"],
): ReadonlySet<string> {
  const precedingStates = new Map(
    previous.map((item) => [item.challenge.id, item.stream_state]),
  );
  const changed = new Set<string>();
  for (const item of next) {
    if (precedingStates.get(item.challenge.id) !== item.stream_state) {
      changed.add(item.challenge.id);
    }
  }
  return changed;
}
