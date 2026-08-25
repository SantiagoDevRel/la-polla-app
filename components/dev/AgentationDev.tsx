"use client";
// Overlay de anotación de UI (agentation.com) — SOLO en dev.
// Click en un elemento → feedback estructurado (selector CSS + component tree + estilos)
// que Claude Code consume vía clipboard o el MCP `agentation` (localhost:4747).
// Los e2e lo apagan con window.__DISABLE_AGENTATION__ (addInitScript) para que el
// toolbar no contamine ni el scan de axe ni las baselines de screenshots.
import { useSyncExternalStore } from "react";
import dynamic from "next/dynamic";

const Agentation = dynamic(() => import("agentation").then((m) => m.Agentation), {
  ssr: false,
});

const subscribe = () => () => {};
const disabledInWindow = () =>
  (window as unknown as { __DISABLE_AGENTATION__?: boolean }).__DISABLE_AGENTATION__ === true;

export function AgentationDev() {
  const disabled = useSyncExternalStore(subscribe, disabledInWindow, () => true);
  if (process.env.NODE_ENV !== "development" || disabled) return null;
  return <Agentation />;
}
