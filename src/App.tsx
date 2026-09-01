import { useCallback } from "react";
import { observe, observeQuestSlug } from "./api";
import { ControlCenter } from "./dashboard/ControlCenter";
import { useRouteState } from "./dashboard/navigation";
import type { ObserveResponse } from "./contracts";
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
  const { route, navigate } = useRouteState();
  const request = useCallback(() => route.scope.kind === "quest"
    ? observeQuestSlug(route.scope.slug, 20)
    : observe({ limit: 20 }), [route.scope]);
  const { data, error, loading, refreshError, reload } = useRemoteData<ObserveResponse>(request);
  if (error && !data) return <ErrorPanel message={error} retry={reload} />;
  if (loading && !data) return <Loading />;
  if (!data) return <Loading />;
  return <ControlCenter data={data} tools={tools} route={route} navigate={navigate} refreshError={refreshError} />;
}
