import {
  liveHubName,
  parseLiveInvalidation,
  serializeLiveInvalidation,
} from "./liveProtocol";
import { validateLiveSocketRequest } from "./liveScope";
import { broadcastLiveInvalidation as broadcastInvalidation } from "./liveTransport";
import { questExists } from "./store";
import { DurableObject } from "cloudflare:workers";

export interface LiveHubEnvironment {
  DB: D1Database;
  LIVE_HUB: DurableObjectNamespace;
}

function invalidLiveRequest(message: string, status = 400): Response {
  return new Response(message, { status });
}

export async function broadcastLiveInvalidation(
  env: LiveHubEnvironment,
  questId: string,
  latestSequence: number,
): Promise<void> {
  await broadcastInvalidation(env.LIVE_HUB, questId, latestSequence);
}

export async function upgradeLiveSocket(
  request: Request,
  env: LiveHubEnvironment,
): Promise<Response> {
  const scope = await validateLiveSocketRequest(
    request,
    (questId) => questExists(env.DB, questId),
  );
  if (scope instanceof Response) return scope;
  const hub = env.LIVE_HUB.get(env.LIVE_HUB.idFromName(liveHubName(scope.questId)));
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

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
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
