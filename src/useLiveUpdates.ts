import { useEffect, useRef, useState } from "react";
import { parseLiveInvalidation } from "./liveProtocol";

const DEGRADED_AFTER_MS = 5_000;
const FALLBACK_REFRESH_MS = 12_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export type LiveConnectionStatus = "connecting" | "live" | "reconnecting" | "degraded";

export interface LiveScope {
  questId?: string;
}

export interface UseLiveUpdatesOptions {
  lastSequence: number;
  onInvalidate: () => void;
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
  onInvalidate,
  scope,
}: UseLiveUpdatesOptions): LiveConnectionStatus {
  const [status, setStatus] = useState<LiveConnectionStatus>("connecting");
  const invalidateRef = useRef(onInvalidate);
  const sequenceRef = useRef(lastSequence);

  invalidateRef.current = onInvalidate;
  sequenceRef.current = lastSequence;

  const scopeKey = scope?.questId ? `quest:${scope.questId}` : scope ? "network" : "pending";

  useEffect(() => {
    if (!scope) {
      setStatus("connecting");
      return;
    }
    if (typeof WebSocket === "undefined") {
      setStatus("degraded");
      const fallback = window.setInterval(() => invalidateRef.current(), FALLBACK_REFRESH_MS);
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
      invalidateRef.current();
      fallbackTimer = window.setInterval(() => invalidateRef.current(), FALLBACK_REFRESH_MS);
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
      const currentSocket = new WebSocket(socketUrl(scope));
      socket = currentSocket;
      currentSocket.addEventListener("open", () => {
        if (!active || socket !== currentSocket || currentSocket.readyState !== WebSocket.OPEN) return;
        attempt = 0;
        clearDisconnectedTimers();
        setStatus("live");
        invalidateRef.current();
      });
      currentSocket.addEventListener("message", (event) => {
        if (!active || socket !== currentSocket || typeof event.data !== "string") return;
        const message = parseLiveInvalidation(event.data);
        if (!message || message.sequence <= sequenceRef.current) return;
        sequenceRef.current = message.sequence;
        invalidateRef.current();
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
