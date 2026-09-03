import { useState } from "react";
import { clampPage, pageCountFor } from "./panelPage";

export function usePanelPage(itemCount: number, identity: string) {
  const [page, setPageState] = useState(1);
  const [seenIdentity, setSeenIdentity] = useState(identity);
  const identityChanged = seenIdentity !== identity;
  if (identityChanged) {
    setSeenIdentity(identity);
    setPageState(1);
  }

  const pageCount = pageCountFor(itemCount);
  const current = clampPage(identityChanged ? 1 : page, itemCount);
  if (!identityChanged && current !== page) setPageState(current);

  return {
    page: current,
    pageCount,
    setPage(next: number) {
      setPageState(clampPage(next, itemCount));
    },
  };
}
