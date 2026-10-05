"use client";

import { useRef, useState } from "react";

/** A response only acknowledges the draft revision that was actually sent. */
export function useDraftSave() {
  const revision = useRef(0);
  const [dirty, setDirty] = useState(false);
  return {
    dirty,
    changed() { revision.current += 1; setDirty(true); },
    snapshot() { return revision.current; },
    acknowledge(sentRevision: number) {
      if (sentRevision !== revision.current) return false;
      setDirty(false);
      return true;
    },
  };
}
