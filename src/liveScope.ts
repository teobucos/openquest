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

export async function validateLiveSocketRequest(
  request: Request,
  hasQuest: QuestScopeLookup,
): Promise<Response | ValidatedLiveScope> {
  if (request.method !== "GET") {
    return invalidLiveRequest("Live transport only accepts GET WebSocket upgrades.", 405);
  }
  if (!hasWebSocketUpgrade(request)) {
    return invalidLiveRequest("WebSocket upgrade required.", 426);
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
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
