import {
  liveHubName,
  parseLiveInvalidation,
  parseLiveQuestId,
  serializeLiveInvalidation,
} from "./liveProtocol";
import { DurableObject } from "cloudflare:workers";

export interface LiveHubEnvironment {
  LIVE_HUB: DurableObjectNamespace;
}

function hasWebSocketUpgrade(request: Request): boolean {
  return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}

function invalidLiveRequest(message: string, status = 400): Response {
  return new Response(message, { status });
}

async function notifyHub(
  namespace: DurableObjectNamespace,
  name: string,
  latestSequence: number,
): Promise<void> {
  const hub = namespace.get(namespace.idFromName(name));
  const response = await hub.fetch("https://openquest-live-hub.invalid/broadcast", {
    body: serializeLiveInvalidation(latestSequence),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(`Live hub ${name} rejected invalidation with HTTP ${response.status}.`);
  }
}

export async function broadcastLiveInvalidation(
  env: LiveHubEnvironment,
  questId: string,
  latestSequence: number,
): Promise<void> {
  const names = [liveHubName(), liveHubName(questId)];
  const outcomes = await Promise.allSettled(
    names.map((name) => notifyHub(env.LIVE_HUB, name, latestSequence)),
  );
  for (const [index, outcome] of outcomes.entries()) {
    if (outcome.status === "rejected") {
      console.error("OpenQuest live transport notification failed", {
        hub: names[index],
        reason: outcome.reason,
      });
    }
  }
}

export async function upgradeLiveSocket(
  request: Request,
  env: LiveHubEnvironment,
): Promise<Response> {
  if (request.method !== "GET") {
    return invalidLiveRequest("Live transport only accepts GET WebSocket upgrades.", 405);
  }
  if (!hasWebSocketUpgrade(request)) {
    return invalidLiveRequest("WebSocket upgrade required.", 426);
  }
  const questId = parseLiveQuestId(new URL(request.url));
  if (questId === null) {
    return invalidLiveRequest("Live transport scope is invalid.");
  }
  const hub = env.LIVE_HUB.get(env.LIVE_HUB.idFromName(liveHubName(questId)));
  return hub.fetch(request);
}

export class LiveHub extends DurableObject<LiveHubEnvironment> {
  public constructor(ctx: DurableObjectState, env: LiveHubEnvironment) {
    super(ctx, env);
  }

  public async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const message = parseLiveInvalidation(await request.text());
      if (!message) return invalidLiveRequest("Live invalidation is invalid.");
      this.broadcast(message.latest_sequence);
      return new Response(null, { status: 204 });
    }

    if (!hasWebSocketUpgrade(request)) {
      return invalidLiveRequest("WebSocket upgrade required.", 426);
    }
    try {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    } catch (cause) {
      console.error("OpenQuest live socket upgrade failed", cause);
      return invalidLiveRequest("OpenQuest could not open a live socket.", 500);
    }
  }

  public webSocketMessage(socket: WebSocket): void {
    socket.close(1008, "OpenQuest live sockets do not accept client messages.");
  }

  public webSocketClose(socket: WebSocket, code: number, reason: string): void {
    socket.close(code, reason);
  }

  public webSocketError(socket: WebSocket): void {
    socket.close(1011, "OpenQuest live socket failed.");
  }

  private broadcast(latestSequence: number): void {
    const payload = serializeLiveInvalidation(latestSequence);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch (cause) {
        console.error("OpenQuest live socket send failed", cause);
      }
    }
  }
}
