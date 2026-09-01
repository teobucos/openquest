import { useCallback } from "react";
import { observe, observeQuestSlug } from "./api";
import { ControlCenter } from "./dashboard/ControlCenter";
import { useRouteState } from "./dashboard/navigation";
import type { ObserveResponse } from "./contracts";
import { useLiveUpdates } from "./useLiveUpdates";
import { useRemoteData } from "./useRemoteData";
import { useWebMCPTools } from "./useWebMCPTools";

function Loading() {
  return <main className="loading">Loading public state…</main>;
}

function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return <main className="error-panel"><p>{message}</p><button type="button" onClick={retry}>Try again</button></main>;
}

export default function App() {
  const tools = useWebMCPTools();
  const { route, navigate, onNavigate } = useRouteState();
  const request = useCallback(() => route.scope.kind === "quest"
    ? observeQuestSlug(route.scope.slug, 20)
    : observe({ limit: 20 }), [route.scope]);
  const { data, error, loading, refreshError, reload } = useRemoteData<ObserveResponse>(request);
  const scopedQuest = route.scope.kind === "quest" && data?.quests[0]?.slug === route.scope.slug
    ? data.quests[0]
    : null;
  const liveScope = route.scope.kind === "network"
    ? {}
    : scopedQuest
      ? { questId: scopedQuest.id }
      : null;
  const liveStatus = useLiveUpdates({
    lastSequence: data?.freshness.last_sequence ?? 0,
    scope: liveScope,
  });
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <Loading />;
  return <ControlCenter data={data} tools={tools} route={route} navigate={navigate} onNavigate={onNavigate} refreshError={refreshError} liveStatus={liveStatus} />;
}
