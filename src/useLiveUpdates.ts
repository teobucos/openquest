import { useEffect, useRef, useState } from "react";
import { parseLiveInvalidation } from "./liveProtocol";
import { OPENQUEST_CHANGED_EVENT } from "./useRemoteData";

const DEGRADED_AFTER_MS = 5_000;
const FALLBACK_REFRESH_MS = 12_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export type LiveConnectionStatus = "connecting" | "live" | "reconnecting" | "degraded";

export interface LiveScope {
  questId?: string;
}

export interface UseLiveUpdatesOptions {
  lastSequence: number;
  scope: LiveScope | null;
}

function socketUrl(scope: LiveScope): string {
  const url = new URL("/api/live", window.location.origin);
  if (scope.questId) url.searchParams.set("quest_id", scope.questId);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function reconnectDelay(attempt: number): number {
  return Math.min(500 * (2 ** attempt), MAX_RECONNECT_DELAY_MS);
}

export function useLiveUpdates({
  lastSequence,
  scope,
}: UseLiveUpdatesOptions): LiveConnectionStatus {
  const [status, setStatus] = useState<LiveConnectionStatus>("connecting");
  const scopeKey = scope?.questId ? `quest:${scope.questId}` : scope ? "network" : "pending";
  const sequencesByScope = useRef(new Map<string, number>());
  const currentSequence = sequencesByScope.current.get(scopeKey) ?? 0;
  if (lastSequence > currentSequence) {
    sequencesByScope.current.set(scopeKey, lastSequence);
  }

  useEffect(() => {
    if (!scope) {
      setStatus("connecting");
      return;
    }
    if (typeof WebSocket === "undefined") {
      setStatus("degraded");
      const fallback = window.setInterval(dispatchSnapshotInvalidation, FALLBACK_REFRESH_MS);
      return () => window.clearInterval(fallback);
    }

    let active = true;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let degradedTimer: number | undefined;
    let fallbackTimer: number | undefined;

    const clearDisconnectedTimers = () => {
      if (degradedTimer !== undefined) window.clearTimeout(degradedTimer);
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
      degradedTimer = undefined;
      fallbackTimer = undefined;
    };

    const startFallback = () => {
      if (fallbackTimer !== undefined) return;
      dispatchSnapshotInvalidation();
      fallbackTimer = window.setInterval(dispatchSnapshotInvalidation, FALLBACK_REFRESH_MS);
    };

    const startDisconnectedTimers = () => {
      if (degradedTimer === undefined) {
        degradedTimer = window.setTimeout(() => {
          if (!active) return;
          setStatus("degraded");
          startFallback();
        }, DEGRADED_AFTER_MS);
      }
    };

    const connect = () => {
      if (!active) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      startDisconnectedTimers();
      const currentSocket = new WebSocket(socketUrl(scope));
      socket = currentSocket;
      currentSocket.addEventListener("open", () => {
        if (!active || socket !== currentSocket || currentSocket.readyState !== WebSocket.OPEN) return;
        attempt = 0;
        clearDisconnectedTimers();
        setStatus("live");
        dispatchSnapshotInvalidation();
      });
      currentSocket.addEventListener("message", (event) => {
        if (!active || socket !== currentSocket || typeof event.data !== "string") return;
        const message = parseLiveInvalidation(event.data);
        const knownSequence = sequencesByScope.current.get(scopeKey) ?? 0;
        if (!message || message.latest_sequence <= knownSequence) return;
        sequencesByScope.current.set(scopeKey, message.latest_sequence);
        dispatchSnapshotInvalidation();
      });
      currentSocket.addEventListener("close", () => {
        if (!active || socket !== currentSocket) return;
        setStatus("reconnecting");
        startDisconnectedTimers();
        reconnectTimer = window.setTimeout(() => {
          attempt += 1;
          connect();
        }, reconnectDelay(attempt));
      });
      currentSocket.addEventListener("error", () => currentSocket.close());
    };

    connect();
    return () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      clearDisconnectedTimers();
      socket?.close();
    };
  }, [scopeKey]);

  return status;
}

function dispatchSnapshotInvalidation(): void {
  window.dispatchEvent(new Event(OPENQUEST_CHANGED_EVENT));
}
