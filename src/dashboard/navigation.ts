import { useCallback, useEffect, useState, type MouseEvent } from "react";

export type WorkFilter = "all" | "review" | "open" | "resolved";

export interface RouteState {
  scope: { kind: "network" } | { kind: "quest"; slug: string };
  filter: WorkFilter;
  challengeId: string | null;
}

export type RouteNavigationHandler = (next: RouteState) => (event: MouseEvent<HTMLAnchorElement>) => void;

const filters: readonly WorkFilter[] = ["all", "review", "open", "resolved"];
const questSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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
  const challengeId = query.get("challenge")?.trim() || null;
  const slug = match ? readQuestSlug(match[1]) : null;
  return {
    scope: slug ? { kind: "quest", slug } : { kind: "network" },
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
  const [route, setRoute] = useState<RouteState>(() => readRoute());

  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  const navigate = useCallback((next: RouteState, replace = false) => {
    const href = routeHref(next);
    if (replace) window.history.replaceState(null, "", href);
    else window.history.pushState(null, "", href);
    setRoute(next);
  }, []);

  const onNavigate: RouteNavigationHandler = useCallback((next: RouteState) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (!shouldHandleNavigation(event)) return;
    event.preventDefault();
    navigate(next);
  }, [navigate]);

  return { navigate, onNavigate, route };
}
