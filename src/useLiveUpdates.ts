import { useEffect, useRef, useState } from "react";
import { parseLiveInvalidation } from "./liveProtocol";
import { OPENQUEST_CHANGED_EVENT } from "./useRemoteData";

const DEGRADED_AFTER_MS = 5_000;
const FALLBACK_REFRESH_MS = 12_000;
const INITIAL_CATCH_UP_RETRY_MS = 750;
const MAX_CATCH_UP_RETRY_MS = 8_000;
const MAX_RECONNECT_DELAY_MS = 10_000;

export type LiveConnectionStatus = "connecting" | "live" | "reconnecting" | "degraded";

export interface LiveScope {
  questId?: string;
}

export interface UseLiveUpdatesOptions {
  lastSequence: number;
  scope: LiveScope | null;
}

interface ScopeLifecycle {
  scopeKey: string;
  reconcile(): void;
}

function scopeKeyFor(scope: LiveScope | null): string {
  if (!scope) return "pending";
  return scope.questId ? `quest:${scope.questId}` : "network";
}

function scopeForKey(scopeKey: string): LiveScope | null {
  if (scopeKey === "pending") return null;
  if (scopeKey === "network") return {};
  return { questId: scopeKey.slice("quest:".length) };
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

function catchUpDelay(attempt: number): number {
  return Math.min(INITIAL_CATCH_UP_RETRY_MS * (2 ** attempt), MAX_CATCH_UP_RETRY_MS);
}

function dispatchSnapshotInvalidation(): void {
  window.dispatchEvent(new Event(OPENQUEST_CHANGED_EVENT));
}

export function useLiveUpdates({
  lastSequence,
  scope,
}: UseLiveUpdatesOptions): LiveConnectionStatus {
  const [status, setStatus] = useState<LiveConnectionStatus>("connecting");
  const scopeKey = scopeKeyFor(scope);
  const appliedSequences = useRef(new Map<string, number>());
  const targetSequences = useRef(new Map<string, number>());
  const lifecycle = useRef<ScopeLifecycle | null>(null);

  useEffect(() => {
    const applied = Math.max(appliedSequences.current.get(scopeKey) ?? 0, lastSequence);
    appliedSequences.current.set(scopeKey, applied);
    const target = Math.max(targetSequences.current.get(scopeKey) ?? 0, applied);
    targetSequences.current.set(scopeKey, target);
    if (lifecycle.current?.scopeKey === scopeKey) lifecycle.current.reconcile();
  }, [lastSequence, scopeKey]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let degradedTimer: number | undefined;
    let fallbackTimer: number | undefined;
    let catchUpTimer: number | undefined;
    let reconcile: (() => void) | undefined;

    const cleanup = () => {
      active = false;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      if (degradedTimer !== undefined) window.clearTimeout(degradedTimer);
      if (fallbackTimer !== undefined) window.clearInterval(fallbackTimer);
      if (catchUpTimer !== undefined) window.clearTimeout(catchUpTimer);
      if (reconcile && lifecycle.current?.reconcile === reconcile) lifecycle.current = null;
      socket?.close();
    };
    const activeScope = scopeForKey(scopeKey);
    if (!activeScope) {
      lifecycle.current = null;
      setStatus("connecting");
      return cleanup;
    }
    if (typeof WebSocket === "undefined") {
      setStatus("degraded");
      fallbackTimer = window.setInterval(dispatchSnapshotInvalidation, FALLBACK_REFRESH_MS);
      return cleanup;
    }

    let attempt = 0;
    let catchUpAttempt = 0;

    const clearCatchUpTimer = () => {
      if (catchUpTimer !== undefined) window.clearTimeout(catchUpTimer);
      catchUpTimer = undefined;
    };

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
      if (degradedTimer !== undefined) return;
      degradedTimer = window.setTimeout(() => {
        if (!active) return;
        setStatus("degraded");
        startFallback();
      }, DEGRADED_AFTER_MS);
    };

    const reconcileCurrentScope = () => {
      if (!active) return;
      const applied = appliedSequences.current.get(scopeKey) ?? 0;
      const target = targetSequences.current.get(scopeKey) ?? 0;
      if (applied >= target) {
        catchUpAttempt = 0;
        clearCatchUpTimer();
        return;
      }
      if (catchUpTimer !== undefined) return;
      catchUpTimer = window.setTimeout(() => {
        catchUpTimer = undefined;
        if (!active) return;
        dispatchSnapshotInvalidation();
        catchUpAttempt += 1;
        reconcileCurrentScope();
      }, catchUpDelay(catchUpAttempt));
    };

    const announceTarget = (latestSequence: number) => {
      const target = targetSequences.current.get(scopeKey) ?? 0;
      if (latestSequence <= target) return;
      targetSequences.current.set(scopeKey, latestSequence);
      dispatchSnapshotInvalidation();
      reconcileCurrentScope();
    };

    const connect = () => {
      if (!active) return;
      setStatus(attempt === 0 ? "connecting" : "reconnecting");
      startDisconnectedTimers();
      const currentSocket = new WebSocket(socketUrl(activeScope));
      socket = currentSocket;
      currentSocket.addEventListener("open", () => {
        if (!active || socket !== currentSocket || currentSocket.readyState !== WebSocket.OPEN) return;
        attempt = 0;
        clearDisconnectedTimers();
        setStatus("live");
        dispatchSnapshotInvalidation();
        reconcileCurrentScope();
      });
      currentSocket.addEventListener("message", (event) => {
        if (!active || socket !== currentSocket || typeof event.data !== "string") return;
        const message = parseLiveInvalidation(event.data);
        if (!message) return;
        announceTarget(message.latest_sequence);
      });
      currentSocket.addEventListener("close", () => {
        if (!active || socket !== currentSocket) return;
        setStatus("reconnecting");
        startDisconnectedTimers();
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = undefined;
          attempt += 1;
          connect();
        }, reconnectDelay(attempt));
      });
      currentSocket.addEventListener("error", () => currentSocket.close());
    };

    reconcile = reconcileCurrentScope;
    lifecycle.current = { reconcile: reconcileCurrentScope, scopeKey };
    connect();
    return cleanup;
  }, [scopeKey]);

  return status;
}
