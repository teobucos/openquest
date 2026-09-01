import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { ApiError } from "./api";

export const OPENQUEST_CHANGED_EVENT = "openquest:changed";

interface RemoteDataState<Value> {
  data: Value | null;
  error: string | null;
  loading: boolean;
  refreshError: string | null;
}

interface OpenQuestChangedDetail {
  waitUntil(promise: Promise<unknown>): void;
}

export function readableError(cause: unknown): string {
  if (cause instanceof ApiError) return cause.payload.message;
  if (cause instanceof Error) return cause.message;
  return "OpenQuest could not complete that action.";
}

export async function notifyOpenQuestChanged(): Promise<void> {
  const pending: Promise<unknown>[] = [];
  const detail: OpenQuestChangedDetail = {
    waitUntil(promise) {
      pending.push(promise);
    },
  };
  window.dispatchEvent(new CustomEvent(OPENQUEST_CHANGED_EVENT, { detail }));
  await Promise.allSettled(pending);
}

export function useRemoteData<Value>(request: () => Promise<Value>, refreshMs?: number) {
  const [{ data, error, loading, refreshError }, setState] = useState<RemoteDataState<Value>>({
    data: null,
    error: null,
    loading: true,
    refreshError: null,
  });
  const queued = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const commitWaiters = useRef<Array<() => void>>([]);

  useLayoutEffect(() => {
    const waiters = commitWaiters.current.splice(0);
    for (const resolve of waiters) resolve();
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const waiters = commitWaiters.current.splice(0);
      for (const resolve of waiters) resolve();
    };
  }, []);

  const commitState = useCallback(async (next: SetStateAction<RemoteDataState<Value>>) => {
    if (!mounted.current) return;
    const committed = new Promise<void>((resolve) => commitWaiters.current.push(resolve));
    setState(next);
    await committed;
  }, []);

  const recordReloadFailure = useCallback((cause: unknown) => {
    if (!mounted.current) return;
    const message = readableError(cause);
    setState((current) => current.data
      ? { ...current, loading: false, refreshError: message }
      : { ...current, error: message, loading: false, refreshError: null });
  }, []);

  const loadOnce = useCallback(async () => {
    try {
      const next = await request();
      await commitState({ data: next, error: null, loading: false, refreshError: null });
    } catch (cause: unknown) {
      const message = readableError(cause);
      await commitState((current) => current.data
        ? { ...current, loading: false, refreshError: message }
        : { ...current, error: message, loading: false, refreshError: null });
    }
  }, [commitState, request]);

  const reload = useCallback((): Promise<void> => {
    queued.current = true;
    if (running.current) return running.current;

    const run = async () => {
      try {
        do {
          queued.current = false;
          await loadOnce();
        } while (queued.current && mounted.current);
      } finally {
        running.current = null;
        if (queued.current && mounted.current) {
          reload().catch(recordReloadFailure);
        }
      }
    };
    const promise = run();
    running.current = promise;
    return promise;
  }, [loadOnce, recordReloadFailure]);

  useEffect(() => {
    const refresh = (event?: Event) => {
      const refreshed = reload();
      refreshed.catch(recordReloadFailure);
      if (event instanceof CustomEvent) {
        const detail = event.detail as Partial<OpenQuestChangedDetail> | undefined;
        detail?.waitUntil?.(refreshed);
      }
    };
    refresh();
    const timer = refreshMs ? window.setInterval(refresh, refreshMs) : undefined;
    window.addEventListener(OPENQUEST_CHANGED_EVENT, refresh);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener(OPENQUEST_CHANGED_EVENT, refresh);
    };
  }, [recordReloadFailure, refreshMs, reload]);

  return { data, error, loading, refreshError, reload };
}
