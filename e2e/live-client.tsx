import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useLiveUpdates, type LiveScope } from "../src/useLiveUpdates";
import { OPENQUEST_CHANGED_EVENT } from "../src/useRemoteData";

interface LiveClientState {
  events: number;
  refreshes: number;
  scope: LiveScope;
  status: string;
}

declare global {
  interface Window {
    __openquestLiveTest?: LiveClientState;
    __setOpenQuestLiveScope?: (questId?: string) => void;
  }
}

function scopeFromQuery(): LiveScope {
  const questId = new URL(window.location.href).searchParams.get("quest_id");
  return questId ? { questId } : {};
}

function LiveClient() {
  const [scope, setScope] = useState(scopeFromQuery);
  const [events, setEvents] = useState(0);
  const [refreshes, setRefreshes] = useState(0);
  const status = useLiveUpdates({ lastSequence: 0, scope });
  const scopeKey = scope.questId ?? "network";

  useEffect(() => {
    const changed = () => {
      setEvents((current) => current + 1);
      void fetch(`/api/world?${scope.questId ? `quest_id=${encodeURIComponent(scope.questId)}` : "limit=1"}`)
        .then(() => setRefreshes((current) => current + 1));
    };
    window.addEventListener(OPENQUEST_CHANGED_EVENT, changed);
    return () => window.removeEventListener(OPENQUEST_CHANGED_EVENT, changed);
  }, [scopeKey]);

  useEffect(() => {
    window.__setOpenQuestLiveScope = (questId) => setScope(questId ? { questId } : {});
    return () => {
      delete window.__setOpenQuestLiveScope;
    };
  }, []);

  window.__openquestLiveTest = { events, refreshes, scope, status };
  return <output data-testid="live-client-state">{JSON.stringify(window.__openquestLiveTest)}</output>;
}

createRoot(document.getElementById("root")!).render(<LiveClient />);
