import { parseLiveQuestId } from "./liveProtocol";

export interface ValidatedLiveScope {
  questId: string | undefined;
}

type QuestScopeLookup = (questId: string) => Promise<boolean>;

function hasWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function invalidLiveRequest(message: string, status = 400): Response {
  return new Response(message, { status });
}

export interface LiveOriginEnvironment {
  OPENQUEST_PUBLIC_ORIGIN?: string;
  OPENQUEST_PUBLIC_ORIGINS?: string;
}

export const OPENQUEST_CANONICAL_PUBLIC_ORIGIN = "https://openquest.acronew.dev" as const;

// Comma-separated allowlist so the dashboard can be served live from more
// than one public origin (e.g. a public domain plus a private tailnet URL).
// Falls back to the legacy single-origin variable, then to same-origin.
export function resolveAllowedLiveOrigins(env: LiveOriginEnvironment): string[] | undefined {
  const raw = env.OPENQUEST_PUBLIC_ORIGINS?.trim()
    ? env.OPENQUEST_PUBLIC_ORIGINS
    : (env.OPENQUEST_PUBLIC_ORIGIN ?? "");
  const origins = raw.split(",").map((origin) => origin.trim()).filter((origin) => origin.length > 0);
  return origins.length > 0 ? origins : undefined;
}

export function mergeConfiguredLiveOrigins(env: LiveOriginEnvironment): string[] | undefined {
  const origins = resolveAllowedLiveOrigins(env);
  if (origins === undefined) return undefined;
  if (origins.includes(OPENQUEST_CANONICAL_PUBLIC_ORIGIN)) return origins;
  return [...origins, OPENQUEST_CANONICAL_PUBLIC_ORIGIN];
}

export async function validateLiveSocketRequest(
  request: Request,
  hasQuest: QuestScopeLookup,
  allowedOrigins: readonly string[] | string | undefined = new URL(request.url).origin,
): Promise<Response | ValidatedLiveScope> {
  if (request.method !== "GET") {
    return invalidLiveRequest("Live transport only accepts GET WebSocket upgrades.", 405);
  }
  if (!hasWebSocketUpgrade(request)) {
    return invalidLiveRequest("WebSocket upgrade required.", 426);
  }
  const origin = request.headers.get("origin");
  const allowed = Array.isArray(allowedOrigins) ? allowedOrigins : [allowedOrigins];
  if (origin && !allowed.includes(origin)) {
    return invalidLiveRequest("Live transport origin is not allowed.", 403);
  }
  const questId = parseLiveQuestId(new URL(request.url));
  if (questId === null) {
    return invalidLiveRequest("Live transport scope is invalid.");
  }
  if (questId && !await hasQuest(questId)) {
    return invalidLiveRequest("Quest live transport scope was not found.", 404);
  }
  return { questId };
}
