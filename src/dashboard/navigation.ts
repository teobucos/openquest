import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type MouseEvent,
} from "react";

export type WorkFilter = "all" | "review" | "open" | "resolved";

export interface RouteState {
  scope:
    | { kind: "network" }
    | { kind: "not_found" }
    | { kind: "quest"; slug: string };
  filter: WorkFilter;
  challengeId: string | null;
}

export type RouteNavigationHandler = (next: RouteState) => (event: MouseEvent<HTMLAnchorElement>) => void;

const filters: readonly WorkFilter[] = ["all", "review", "open", "resolved"];
const questSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const challengeIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const locationChangedEvent = "openquest:location-changed";

function readQuestSlug(encodedSlug: string): string | null {
  try {
    const slug = decodeURIComponent(encodedSlug);
    return questSlugPattern.test(slug) ? slug : null;
  } catch {
    return null;
  }
}

export function readRoute(location: Location = window.location): RouteState {
  const match = /^\/q\/([^/]+)$/.exec(location.pathname);
  const query = new URLSearchParams(location.search);
  const candidate = query.get("status");
  const filter = filters.find((value) => value === candidate) ?? "all";
  const challengeCandidate = query.get("challenge")?.trim();
  const challengeId = challengeCandidate && challengeIdPattern.test(challengeCandidate)
    ? challengeCandidate
    : null;
  const slug = match ? readQuestSlug(match[1]) : null;
  const scope = location.pathname === "/"
    ? { kind: "network" } as const
    : slug
      ? { kind: "quest", slug } as const
      : { kind: "not_found" } as const;
  return {
    scope,
    filter,
    challengeId,
  };
}

export function routeHref(route: RouteState): string {
  const query = new URLSearchParams();
  if (route.filter !== "all") query.set("status", route.filter);
  if (route.challengeId) query.set("challenge", route.challengeId);
  const path = route.scope.kind === "quest" ? `/q/${encodeURIComponent(route.scope.slug)}` : "/";
  const search = query.toString();
  return search ? `${path}?${search}` : path;
}

function subscribeToLocation(onStoreChange: () => void): () => void {
  window.addEventListener("popstate", onStoreChange);
  window.addEventListener(locationChangedEvent, onStoreChange);
  return () => {
    window.removeEventListener("popstate", onStoreChange);
    window.removeEventListener(locationChangedEvent, onStoreChange);
  };
}

function locationSnapshot(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function shouldHandleNavigation(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0
    && !event.defaultPrevented
    && !event.metaKey
    && !event.altKey
    && !event.ctrlKey
    && !event.shiftKey
    && (!event.currentTarget.target || event.currentTarget.target === "_self");
}

export function useRouteState() {
  const snapshot = useSyncExternalStore(
    subscribeToLocation,
    locationSnapshot,
    locationSnapshot,
  );
  const route = useMemo(() => readRoute(), [snapshot]);

  const navigate = useCallback((next: RouteState, replace = false) => {
    const href = routeHref(next);
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    window.dispatchEvent(new Event(locationChangedEvent));
  }, []);

  const onNavigate: RouteNavigationHandler = useCallback((next: RouteState) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!shouldHandleNavigation(event)) return;
    event.preventDefault();
    navigate(next);
  }, [navigate]);

  return { navigate, onNavigate, route };
}
