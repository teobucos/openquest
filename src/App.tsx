import { useCallback } from "react";
import { observe, observeQuestSlug } from "./api";
import { Brand } from "./Brand";
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
  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand />
        <span className="header-context">PUBLIC NETWORK / CONTROL ROOM</span>
      </header>
      <main className="loading">Loading public state…</main>
    </div>
  );
}

function ErrorPanel({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Brand />
        <span className="header-context">PUBLIC NETWORK / CONTROL ROOM</span>
      </header>
      <main className="error-panel"><p>{message}</p><button type="button" onClick={retry}>Try again</button></main>
    </div>
  );
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
      <div className="app-shell">
        <header className="site-header">
          <Brand onClick={onNavigate({ scope: { kind: "network" }, filter: "all", challengeId: null })} />
          <span className="header-context">PUBLIC NETWORK / CONTROL ROOM</span>
        </header>
        <main className="not-found-panel">
          <p>404 / OPENQUEST ROUTE NOT FOUND</p>
          <a href="/" onClick={onNavigate({ scope: { kind: "network" }, filter: "all", challengeId: null })}>Return to the control center</a>
        </main>
      </div>
    );
  }
  return <Dashboard route={route} navigate={navigate} onNavigate={onNavigate} tools={tools} />;
}

function liveScopeFor(
  route: DashboardRoute,
  scopedQuest: ObserveResponse["quests"][number] | null,
) {
  if (route.scope.kind === "network") return {};
  if (!scopedQuest) return null;
  return { questId: scopedQuest.id };
}

function DashboardGate({
  error,
  retry,
}: {
  error: string | null;
  retry: () => void;
}) {
  if (error) return <ErrorPanel message={error} retry={retry} />;
  return <Loading />;
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
  const { data, error, refreshError, reload } = useRemoteData<ObserveResponse>(request);
  const scopedQuest = selectedQuestSlug
    ? data?.quests.find((quest) => quest.slug === selectedQuestSlug) ?? null
    : null;
  const liveStatus = useLiveUpdates({
    lastSequence: data?.freshness.last_sequence ?? 0,
    scope: liveScopeFor(route, scopedQuest),
  });
  if (!data || (route.scope.kind === "quest" && !scopedQuest)) {
    return <DashboardGate error={refreshError ?? error} retry={reload} />;
  }
  return <ControlCenter data={data} tools={tools} route={route} navigate={navigate} onNavigate={onNavigate} refreshError={refreshError} liveStatus={liveStatus} />;
}
