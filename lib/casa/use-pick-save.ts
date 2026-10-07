"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { requestJson } from "@/lib/http/json-request";
import {
  acknowledgesOperation, confirmedAfterAck, isPickSaveAck, isPickSaveState, isPickValues, normalizedPick, rebasePickDraft, samePick,
  type PickSaveAck, type PickSaveOperation, type PickSaveState, type PickValues,
} from "./picks-protocol";

interface Options {
  slug: string;
  entryNumber?: number | null;
  ownerId?: string;
  entryId?: string;
  initialRevision?: number;
  initialPicks: Record<string, PickValues>;
  targetIds: string[];
  kind: "match" | "question";
}

/** Manual saves, exact confirmations and a stable operation for uncertain writes. */
export function usePickSave(options: Options) {
  const router = useRouter();
  const { slug, entryNumber, ownerId, entryId, initialPicks, initialRevision, targetIds, kind } = options;
  const [picks, setPicks] = useState(initialPicks);
  const [saved, setSaved] = useState(initialPicks);
  const draftRef = useRef(picks);
  const savedRef = useRef(saved);
  const draftBaseline = useRef({ ...initialPicks });
  const revision = useRef(initialRevision);
  const operation = useRef<PickSaveOperation | null>(null);
  const running = useRef(false);
  const [saving, setSaving] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const restored = useRef(false);
  const [hydrated, setHydrated] = useState(false);
  const storageKey = ownerId && entryId ? `casa-pick-draft-v1:${ownerId}:${entryId}:${slug}` : null;
  const endpoint = `/api/casa/pollas/${encodeURIComponent(slug)}/picks`;
  const stateUrl = `${endpoint}?state=1${entryNumber ? `&p=${entryNumber}` : ""}${entryId ? `&entryId=${encodeURIComponent(entryId)}` : ""}`;
  const dirtyIds = targetIds.filter(id => !samePick(picks[id], saved[id]));
  const dirty = dirtyIds.length > 0;

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (!storageKey) { setHydrated(true); return; }
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw || raw.length > 100_000) return;
      const stored = JSON.parse(raw);
      if (stored.version !== 2 || stored.ownerId !== ownerId || stored.entryId !== entryId
        || typeof stored.time !== "number" || Date.now() - stored.time > 24 * 60 * 60_000) return;
      const draft: Record<string, PickValues> = { ...initialPicks };
      let conflict = false;
      for (const id of targetIds) {
        const change = stored.changes?.[id];
        if (!isPickValues(change?.draft) || !isPickValues(change?.baseline)) continue;
        draft[id] = change.draft;
        draftBaseline.current[id] = change.baseline;
        if (!samePick(change.baseline, initialPicks[id]) && !samePick(change.draft, initialPicks[id])) conflict = true;
      }
      draftRef.current = draft;
      setPicks(draft);
      const pending = stored.operation as PickSaveOperation | undefined;
      if (pending && typeof pending.requestId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pending.requestId)
        && pending.entryId === entryId && (pending.entryNumber ?? null) === (entryNumber ?? null) && Number.isSafeInteger(pending.expectedRevision)
        && pending.expectedRevision >= 0 && Array.isArray(pending.picks) && pending.picks.length >= 1 && pending.picks.length <= 60
        && pending.picks.every(p => targetIds.includes(p.matchId ?? p.questionId ?? "") && isPickValues(p))) {
        operation.current = pending;
        setUncertain(true);
        setMsg({ text: "Hay un envío por confirmar. Comprueba el guardado antes de enviar nuevos cambios.", bad: true });
      } else if (targetIds.some(id => !samePick(draft[id], initialPicks[id]))) {
        setMsg({ text: conflict ? "Hay pronósticos más recientes y recuperamos tus cambios. Revísalos antes de pulsar Guardar."
          : "Recuperamos tus cambios sin guardar. Revisa y pulsa Guardar.", bad: true });
      }
    } catch { /* Storage may be unavailable; the active in-memory draft remains. */ }
    finally { setHydrated(true); }
    // The board is keyed by authenticated entry. Restore only once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey || !hydrated) return;
    try {
      if (!dirty && !operation.current) sessionStorage.removeItem(storageKey);
      else {
        const changes = Object.fromEntries(targetIds.filter(id => !samePick(picks[id], saved[id]))
          .map(id => [id, { draft: normalizedPick(picks[id]), baseline: normalizedPick(draftBaseline.current[id]) }]));
        sessionStorage.setItem(storageKey, JSON.stringify({ version: 2, ownerId, entryId, time: Date.now(), changes, operation: operation.current }));
      }
    } catch { /* Never turn storage availability into a false server failure. */ }
  }, [storageKey, ownerId, entryId, dirty, picks, saved, targetIds, uncertain, saving, hydrated]);

  function acceptState(state: PickSaveState) {
    for (const id of targetIds) if (samePick(draftRef.current[id], savedRef.current[id])) draftBaseline.current[id] = normalizedPick(state.picks[id]);
    const nextDraft = rebasePickDraft(draftRef.current, savedRef.current, state.picks, targetIds);
    draftRef.current = nextDraft;
    setPicks(nextDraft);
    revision.current = state.revision;
    savedRef.current = state.picks;
    setSaved(state.picks);
  }

  async function readState() {
    const result = await requestJson(stateUrl, { method: "GET" }, (value): value is PickSaveState =>
      isPickSaveState(value) && (!entryId || value.entryId === entryId) && (!ownerId || value.ownerId === ownerId));
    if (!result.ok) {
      setSessionExpired(result.kind === "auth");
      setMsg({ text: result.error, bad: true });
      return null;
    }
    setSessionExpired(false);
    acceptState(result.data);
    return result.data;
  }

  function confirm(ack: PickSaveAck, state?: PickSaveState) {
    if (!operation.current || !acknowledgesOperation(ack, operation.current)) return false;
    const confirmed = state?.picks ?? confirmedAfterAck(savedRef.current, ack);
    for (const result of ack.results) if (result.status === "saved") draftBaseline.current[result.targetId] = normalizedPick(confirmed[result.targetId]);
    savedRef.current = confirmed;
    setSaved(confirmed);
    revision.current = state?.revision ?? ack.revision;
    operation.current = null;
    setUncertain(false);
    setSessionExpired(false);
    const pending = targetIds.some(id => !samePick(draftRef.current[id], confirmed[id]));
    const rejected = ack.results.find(r => r.status === "rejected");
    setMsg({ text: rejected ? `Guardamos ${ack.guardados}. ${rejected.error} Conservamos los cambios sin guardar.`
      : pending ? "Guardamos el envío anterior. Tienes cambios nuevos sin guardar." : "Guardado.", bad: Boolean(rejected || pending) });
    if (ack.guardados > 0) router.refresh();
    return true;
  }

  function changed(id: string, value: PickValues) {
    if (!hydrated) return;
    if (samePick(draftRef.current[id], savedRef.current[id])) draftBaseline.current[id] = normalizedPick(savedRef.current[id]);
    const next = { ...draftRef.current, [id]: value };
    draftRef.current = next;
    setPicks(next);
    if (!operation.current) setMsg(null);
  }

  async function save() {
    if (!hydrated || running.current) return;
    running.current = true;
    setSaving(true);
    setMsg(null);
    try {
      if (operation.current) {
        const state = await readState();
        if (!state) return;
        if (state.lastResult && confirm(state.lastResult, state)) return;
        if (state.revision !== operation.current.expectedRevision) {
          operation.current = null;
          setUncertain(false);
          setMsg({ text: "Hay pronósticos más recientes. Conservamos tus cambios; revísalos antes de pulsar Guardar.", bad: true });
          return;
        }
        // Same identity/version is safe even if the original request is still running.
      } else {
        if (revision.current === undefined && !await readState()) return;
        const changedIds = targetIds.filter(id => !samePick(draftRef.current[id], savedRef.current[id]));
        if (!changedIds.length) { setMsg({ text: "No hay cambios pendientes." }); return; }
        operation.current = { requestId: crypto.randomUUID(), expectedRevision: revision.current!, entryId,
          ...(entryNumber ? { entryNumber } : {}), picks: changedIds.map(id => ({ ...normalizedPick(draftRef.current[id]), ...(kind === "match" ? { matchId: id } : { questionId: id }) })) };
      }
      const sent = operation.current;
      setUncertain(true);
      const result = await requestJson(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sent) },
        (value): value is PickSaveAck => isPickSaveAck(value) && acknowledgesOperation(value, sent));
      if (result.ok) { confirm(result.data); return; }
      if (result.kind === "auth") { setSessionExpired(true); setMsg({ text: result.error, bad: true }); return; }
      if (result.kind === "rejected") {
        operation.current = null;
        setUncertain(false);
        if (result.status === 409) await readState();
        setMsg({ text: result.error, bad: true });
        return;
      }
      const state = await readState();
      if (state?.lastResult && confirm(state.lastResult, state)) return;
      if (state && state.revision !== sent.expectedRevision) {
        operation.current = null;
        setUncertain(false);
        setMsg({ text: "Hay pronósticos más recientes. Revisa tus cambios antes de volver a guardar.", bad: true });
      } else setMsg({ text: "No pudimos confirmar el guardado. Conservamos tus cambios; pulsa Comprobar guardado.", bad: true });
    } catch {
      setUncertain(Boolean(operation.current));
      setMsg({ text: "No pudimos confirmar el guardado. Conservamos tus cambios.", bad: true });
    } finally {
      running.current = false;
      setSaving(false);
    }
  }

  function discard() {
    if (operation.current || running.current) return;
    draftRef.current = savedRef.current;
    setPicks(savedRef.current);
    setMsg(null);
  }

  return { picks, saved, changed, save, discard, dirty, saving, uncertain, sessionExpired, msg, setMsg, hydrated };
}
