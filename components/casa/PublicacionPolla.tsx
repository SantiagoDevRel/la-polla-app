"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ColombiaDateTimeField } from "@/components/casa/ColombiaDateTimeField";
import { CASA_HEADERS } from "@/lib/casa/contract";
import { formatMatchTime } from "@/lib/casa/format";
import { colombiaDateTimeToIso, toColombiaDateTimeInput } from "@/lib/time/colombia";

export function PublicacionPolla({ id, opensAt, scheduled }: { id: string; opensAt?: string; scheduled: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [date, setDate] = useState(() => toColombiaDateTimeInput(scheduled && opensAt ? opensAt : new Date(Date.now() + 3600000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(mode: "ahora" | "programada" | "oculta") {
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/casa/admin/pollas/${id}`, { method: "PATCH", headers: CASA_HEADERS,
        body: JSON.stringify({ action: "publicacion", mode, opensAt: mode === "programada" ? colombiaDateTimeToIso(date) : undefined }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "No se pudo guardar la publicación.");
      setEditing(false); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar la publicación."); }
    finally { setBusy(false); }
  }
  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-text-secondary">
        {scheduled && opensAt ? `Se publicará ${formatMatchTime(opensAt)} (Colombia).` : "Esta polla está oculta. Solo la administración puede verla."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => save("ahora")} className="lp-btn lp-btn-primary grow basis-40">Publicar ahora</button>
        <button type="button" disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)} className="lp-btn lp-btn-ghost grow basis-40">{scheduled ? "Cambiar fecha" : "Programar publicación"}</button>
      </div>
      {editing && <div className="space-y-3">
        <ColombiaDateTimeField label="Publicación" value={date} onChange={setDate} disabled={busy} />
        <button type="button" disabled={busy} onClick={() => save("programada")} className="lp-btn lp-btn-ghost w-full">Guardar fecha de publicación</button>
      </div>}
      {scheduled && <button type="button" disabled={busy} onClick={() => save("oculta")} className="lp-btn lp-btn-ghost w-full">Dejar oculta sin fecha</button>}
      {error && <p role="alert" className="text-[13px] leading-relaxed text-red-alert">{error}</p>}
    </div>
  );
}
