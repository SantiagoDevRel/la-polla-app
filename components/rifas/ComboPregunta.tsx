"use client";
// components/rifas/ComboPregunta.tsx — «¿Eres de un combo de Los Del Sur?» (migración 180).
//
// (2026-11-07, pedido del dueño) Se abre una vez al entrar a la rifa de la
// barra, solo con sesión y sin respuesta guardada. Si marca la casilla escribe
// el combo; si no, Continuar y sigue normal. Escape la cierra sin guardar y
// vuelve a salir en la próxima visita. No bloquea la compra.
import { useEffect, useRef, useState } from "react";
import { COMBO_MAX } from "@/lib/rifas/combo-shared";

export function ComboPregunta({ slug, partnerName, escudo }: { slug: string; partnerName: string; escudo: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [inCombo, setInCombo] = useState(false);
  const [combo, setCombo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);

  const valid = !inCombo || combo.trim().length >= 2;

  async function continuar() {
    if (!valid) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/rifas/${slug}/combo`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inCombo ? { in_combo: true, combo } : { in_combo: false }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "No se pudo guardar. Intenta de nuevo.");
      dialog.current?.close();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} aria-labelledby="combo-title" onCancel={(e) => { if (busy) e.preventDefault(); }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-border-default bg-bg-card p-4 text-text-primary backdrop:bg-bg-base/80">
      <form method="dialog" onSubmit={(e) => { e.preventDefault(); void continuar(); }}>
        <div className="flex min-w-0 items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- WebP en su tamaño real, sin Image Optimization */}
          <img src={escudo} alt="" width={44} height={44} className="h-11 w-11 max-w-none shrink-0" />
          <h2 id="combo-title" className="lp-display-sm min-w-0 text-[22px] leading-tight [overflow-wrap:anywhere]">
            ¿Eres de un combo de {partnerName}?
          </h2>
        </div>
        <label className="mt-4 flex min-h-11 cursor-pointer items-center gap-3 text-[15px]">
          <input type="checkbox" checked={inCombo} onChange={(e) => setInCombo(e.target.checked)}
            className="h-5 w-5 shrink-0 cursor-pointer accent-turf" />
          Sí, soy de un combo
        </label>
        {inCombo && (
          <div className="mt-2">
            <label htmlFor="combo-nombre" className="block text-[13px] text-text-secondary">¿Cuál combo?</label>
            <input id="combo-nombre" value={combo} onChange={(e) => setCombo(e.target.value)} maxLength={COMBO_MAX}
              autoComplete="off" autoFocus className="lp-input mt-1 w-full" />
          </div>
        )}
        {error && <p role="alert" className="mt-2 text-[13px] text-red-alert">{error}</p>}
        <button type="submit" disabled={busy || !valid} className="lp-btn lp-btn-primary mt-4 w-full">Continuar</button>
      </form>
    </dialog>
  );
}
