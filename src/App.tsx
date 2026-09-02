import { useCallback } from "react";
import { observe, observeQuestSlug } from "./api";
import { ControlCenter } from "./dashboard/ControlCenter";
import {
  useRouteState,
  type RouteNavigationHandler,
  type RouteState,
} from "./dashboard/navigation";
import type { ObserveResponse } from "./contracts";
import { useLiveUpdates } from "./useLiveUpdates";
import { useRemoteData } from "./useRemoteData";
import { useWebMCPTools, type WebMCPToolsState } from "./useWebMCPTools";

function Loading() {
  return <main className="loading">Loading public state…</main>;
}

function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return <main className="error-panel"><p>{message}</p><button type="button" onClick={retry}>Try again</button></main>;
}

type DashboardRoute = RouteState & {
  scope: { kind: "network" } | { kind: "quest"; slug: string };
};

function isDashboardRoute(route: RouteState): route is DashboardRoute {
  return route.scope.kind !== "not_found";
}

export default function App() {
  const tools = useWebMCPTools();
  const { route, navigate, onNavigate } = useRouteState();
  if (!isDashboardRoute(route)) {
    return (
      <main className="not-found-panel">
        <p>404 / OPENQUEST ROUTE NOT FOUND</p>
        <a href="/" onClick={onNavigate({ scope: { kind: "network" }, filter: "all", challengeId: null })}>Return to the control center</a>
      </main>
    );
  }
  return <Dashboard route={route} navigate={navigate} onNavigate={onNavigate} tools={tools} />;
}

function Dashboard({
  route,
  navigate,
  onNavigate,
  tools,
}: {
  route: DashboardRoute;
  navigate: (route: RouteState) => void;
  onNavigate: RouteNavigationHandler;
  tools: WebMCPToolsState;
}) {
  const selectedQuestSlug = route.scope.kind === "quest" ? route.scope.slug : null;
  const request = useCallback(() => selectedQuestSlug
    ? observeQuestSlug(selectedQuestSlug, 20)
    : observe({ limit: 20 }), [selectedQuestSlug]);
  const { data, error, loading, refreshError, reload } = useRemoteData<ObserveResponse>(request);
  const scopedQuest = selectedQuestSlug
    ? data?.quests.find((quest) => quest.slug === selectedQuestSlug) ?? null
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
  const unresolvedScope = route.scope.kind === "quest" && !scopedQuest;
  if (unresolvedScope) {
    const scopeError = refreshError ?? error;
    if (scopeError) return <ErrorPanel message={scopeError} retry={reload} />;
    return <Loading />;
  }
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <Loading />;
  return <ControlCenter data={data} tools={tools} route={route} navigate={navigate} onNavigate={onNavigate} refreshError={refreshError} liveStatus={liveStatus} />;
}
