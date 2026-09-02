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

class OpenQuestChangedEvent extends CustomEvent<OpenQuestChangedDetail> {}

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
  window.dispatchEvent(new OpenQuestChangedEvent(OPENQUEST_CHANGED_EVENT, { detail }));
  await Promise.allSettled(pending);
}

export function useRemoteData<Value>(request: () => Promise<Value>, refreshMs?: number) {
  const [{ data, error, loading, refreshError }, setState] = useState<RemoteDataState<Value>>({
    data: null,
    error: null,
    loading: true,
    refreshError: null,
  });
  const requestRef = useRef(request);
  const generation = useRef(0);
  const queuedGeneration = useRef<number | null>(null);
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

  const load = useCallback(async (requestGeneration: number) => {
    try {
      const next = await requestRef.current();
      if (requestGeneration !== generation.current) return;
      await commitState({ data: next, error: null, loading: false, refreshError: null });
    } catch (cause: unknown) {
      if (requestGeneration !== generation.current) return;
      const message = readableError(cause);
      await commitState((current) => current.data
        ? { ...current, loading: false, refreshError: message }
        : { ...current, error: message, loading: false, refreshError: null });
    }
  }, [commitState]);

  const reload = useCallback((): Promise<void> => {
    queuedGeneration.current = generation.current;
    if (running.current) return running.current;

    const run = async () => {
      try {
        while (mounted.current && queuedGeneration.current !== null) {
          const requestGeneration = queuedGeneration.current;
          queuedGeneration.current = null;
          await load(requestGeneration);
        }
      } finally {
        running.current = null;
        if (queuedGeneration.current !== null && mounted.current) {
          void reload();
        }
      }
    };
    const promise = run();
    running.current = promise;
    return promise;
  }, [load]);

  useEffect(() => {
    requestRef.current = request;
    generation.current += 1;
    void reload();
  }, [reload, request]);

  useEffect(() => {
    const refresh = (event?: Event) => {
      const refreshed = reload();
      if (event instanceof OpenQuestChangedEvent) {
        event.detail.waitUntil(refreshed);
      }
    };
    const timer = refreshMs ? window.setInterval(refresh, refreshMs) : undefined;
    window.addEventListener(OPENQUEST_CHANGED_EVENT, refresh);
    return () => {
      if (timer !== undefined) window.clearInterval(timer);
      window.removeEventListener(OPENQUEST_CHANGED_EVENT, refresh);
    };
  }, [refreshMs, reload]);

  return { data, error, loading, refreshError, reload };
}
