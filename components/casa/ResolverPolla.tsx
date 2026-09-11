"use client";

// components/casa/ResolverPolla.tsx — lo que faltaba para cerrar una polla
// manual o una rifa SIN el bot de Telegram.
//
// POR QUÉ EXISTE (2026-09-12): `casa_settle_polla` se niega a repartir si
// quedan preguntas sin resolver o si la rifa no tiene número. Y escribir esas
// dos cosas vivía ÚNICAMENTE en los comandos /resolver, /respuesta y /numero
// del bot. O sea: la casa podía crear y cobrar una polla manual o una rifa
// desde la web, la gente podía jugarla... y el pozo quedaba trabado hasta que
// alguien abriera Telegram. Es el mismo hueco que tenían cerrar y repartir
// antes de que se mudaran a la web, y se cierra igual.
//
// El bot sigue funcionando: las dos vías escriben lo mismo con los mismos
// guards (`resolved_at IS NULL` contra la doble resolución, rango de boletas
// contra un número que no existe).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Label } from "@/components/street";

interface Opcion { id: string; label: string }
interface Pregunta {
  id: string;
  prompt: string;
  points: number;
  input_kind: "opciones" | "texto";
  resolved_at: string | null;
  resolved_option_id: string | null;
  resolved_text: string | null;
  options: Opcion[];
}
interface Datos {
  polla: { kind: string; status: string; ticket_count: number | null; drawn_number: number | null; draw_method: string | null };
  preguntas: Pregunta[];
}

export function ResolverPolla({ id, kind }: { id: string; kind: string }) {
  const router = useRouter();
  const [datos, setDatos] = useState<Datos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [texto, setTexto] = useState<Record<string, string>>({});
  const [numero, setNumero] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/casa/admin/pollas/${id}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "No se pudo cargar.");
      setDatos(json);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar.");
    }
  }, [id]);

  useEffect(() => { void cargar(); }, [cargar]);

  async function enviar(body: Record<string, unknown>, clave: string) {
    setEnviando(clave);
    setError(null);
    setAviso(null);
    try {
      const res = await fetch(`/api/casa/admin/pollas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "No se pudo guardar.");
        return;
      }
      if (typeof json.faltan === "number") {
        setAviso(json.faltan > 0
          ? `Guardado. Faltan ${json.faltan} pregunta(s) por resolver.`
          : "Guardado. Ya puedes repartir el pozo.");
      }
      if (typeof json.numero === "number") {
        setAviso(json.vendida
          ? `Número ${json.numero} guardado. Esa boleta sí se vendió: ya puedes repartir.`
          : `Número ${json.numero} guardado, pero NADIE compró esa boleta. Registra otro número o anuncia qué pasa con el pozo.`);
      }
      await cargar();
      router.refresh();
    } catch {
      setError("Se cayó la conexión.");
    } finally {
      setEnviando(null);
    }
  }

  if (error && !datos) {
    return (
      <div className="bg-bg-card px-3 pb-3">
        <p role="alert" className="text-[13px] text-red-alert">{error}</p>
        <button type="button" onClick={() => void cargar()} className="lp-btn lp-btn-ghost mt-2 text-[13px]">Reintentar</button>
      </div>
    );
  }
  if (!datos) return null;

  const pendientes = datos.preguntas.filter((q) => !q.resolved_at).length;

  return (
    <div className="bg-bg-card px-3 pb-4 pt-1">
      {kind === "manual" && datos.preguntas.length > 0 && (
        <>
          <Label>
            {pendientes === 0 ? "Todas las respuestas están puestas" : `Faltan ${pendientes} respuesta(s)`}
          </Label>
          <ul className="mt-2 space-y-3">
            {datos.preguntas.map((q) => {
              const resuelta = Boolean(q.resolved_at);
              const respuesta = q.options.find((o) => o.id === q.resolved_option_id)?.label ?? q.resolved_text;
              return (
                <li key={q.id} className="border border-border-subtle p-3">
                  <p className="text-[14px] font-semibold text-text-primary [overflow-wrap:anywhere]">{q.prompt}</p>
                  {resuelta ? (
                    <p className="mt-2 flex items-center gap-2 text-[13px] text-turf">
                      <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className="[overflow-wrap:anywhere]">Respuesta: {respuesta}</span>
                    </p>
                  ) : q.input_kind === "opciones" ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {q.options.map((o) => (
                        <button
                          key={o.id}
                          type="button"
                          disabled={enviando !== null}
                          onClick={() => void enviar({ action: "responder", questionId: q.id, optionId: o.id }, o.id)}
                          className="lp-btn lp-btn-ghost min-h-11 grow basis-32 !px-3 !text-[13px]"
                        >
                          {enviando === o.id ? "Guardando..." : o.label}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        type="text"
                        value={texto[q.id] ?? ""}
                        onChange={(e) => setTexto((prev) => ({ ...prev, [q.id]: e.target.value }))}
                        placeholder="La respuesta correcta"
                        aria-label={`Respuesta correcta de: ${q.prompt}`}
                        className="lp-input min-h-11 grow basis-40 text-[14px]"
                      />
                      <button
                        type="button"
                        disabled={enviando !== null || !(texto[q.id] ?? "").trim()}
                        onClick={() => void enviar({ action: "responder", questionId: q.id, texto: (texto[q.id] ?? "").trim() }, q.id)}
                        className="lp-btn lp-btn-primary min-h-11 basis-32 !px-3 !text-[13px]"
                      >
                        {enviando === q.id ? "Guardando..." : "Guardar"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      {kind === "rifa" && (
        <>
          <Label>El número que salió</Label>
          {datos.polla.draw_method && (
            <p className="mt-1 text-[12px] text-text-secondary [overflow-wrap:anywhere]">{datos.polla.draw_method}</p>
          )}
          {datos.polla.drawn_number != null && (
            <p className="lp-money mt-2 text-[22px] text-gold">Número {datos.polla.drawn_number}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={datos.polla.ticket_count ?? 100000}
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder={`Del 1 al ${datos.polla.ticket_count ?? "?"}`}
              aria-label="Número ganador de la rifa"
              className="lp-input lp-money min-h-11 grow basis-32 text-[16px]"
            />
            <button
              type="button"
              disabled={enviando !== null || !numero.trim()}
              onClick={() => void enviar({ action: "numero", numero: Number(numero) }, "numero")}
              className="lp-btn lp-btn-primary min-h-11 basis-32 !px-3 !text-[13px]"
            >
              {enviando === "numero" ? "Guardando..." : "Guardar número"}
            </button>
          </div>
        </>
      )}

      {aviso && <p className="mt-3 border border-turf/40 bg-turf/10 p-2 text-[12px] text-turf">{aviso}</p>}
      {error && <p role="alert" className="mt-3 border border-red-alert/40 bg-red-alert/10 p-2 text-[12px] text-red-alert">{error}</p>}
    </div>
  );
}

export default ResolverPolla;
