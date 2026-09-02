// components/casa/AccionesPolla.tsx — el ciclo de vida de una polla, en la web.
//
// (2026-09-02) Reemplaza a AccionesBorrador, que solo sabía publicar.
//
// El dueño pidió sacar los bots de la UI ("por ahora nada de bots"), y con eso
// cerrar y repartir dejaron de tener camino: hasta hoy vivían SOLO como
// comandos de Telegram. O sea que la plata dependía de que un chat estuviera
// vinculado. Ahora el ciclo completo — publicar, cerrar, repartir — se hace
// desde acá.
//
// Repartir pide confirmación porque NO SE PUEDE DESHACER: escribe casa_payouts
// y deja la polla en 'resuelta'. Publicar y cerrar sí son reversibles en la
// práctica (se puede anular), así que van directo.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CasaPollaStatus } from "@/lib/casa/types";

type Accion = "publicar" | "cerrar" | "repartir";

export function AccionesPolla({
  id,
  status,
  nombre,
}: {
  id: string;
  status: CasaPollaStatus;
  nombre: string;
}) {
  const router = useRouter();
  const [enviando, setEnviando] = useState<Accion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  async function ejecutar(action: Accion) {
    setEnviando(action);
    setError(null);
    setOk(null);
    try {
      const res = await fetch(`/api/casa/admin/pollas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "No se pudo.");
        return;
      }
      if (action === "repartir" && json.reparto) {
        const r = json.reparto as { winners: number; each_cop: number };
        setOk(
          `Repartida entre ${r.winners} ${r.winners === 1 ? "ganador" : "ganadores"}.`,
        );
      }
      setConfirmando(false);
      router.refresh();
    } catch {
      setError("Se cayó la conexión.");
    } finally {
      setEnviando(null);
    }
  }

  // Una polla resuelta o anulada ya no tiene siguiente paso.
  if (status === "resuelta" || status === "anulada") return null;

  return (
    <div className="bg-bg-card px-3 pb-3">
      {status === "borrador" && (
        <>
          <button
            type="button"
            onClick={() => ejecutar("publicar")}
            disabled={enviando !== null}
            className="lp-btn lp-btn-primary h-10 min-h-0 w-full text-[14px]"
          >
            {enviando === "publicar" ? "Publicando..." : "Publicar"}
          </button>
          <p className="mt-2 text-[11px] text-text-muted">
            Mientras esté en borrador no la ve nadie.
          </p>
        </>
      )}

      {status === "abierta" && (
        <button
          type="button"
          onClick={() => ejecutar("cerrar")}
          disabled={enviando !== null}
          className="lp-btn lp-btn-ghost h-10 min-h-0 w-full text-[14px]"
        >
          {enviando === "cerrar" ? "Cerrando..." : "Cerrar inscripciones"}
        </button>
      )}

      {status === "cerrada" &&
        (confirmando ? (
          <div className="border border-red-alert/40 bg-red-alert/10 p-3">
            <p className="text-[13px] leading-relaxed text-text-primary">
              Vas a repartir <span className="font-semibold">{nombre}</span>.
              Esto escribe a quién le toca cuánto y{" "}
              <span className="font-semibold">no se puede deshacer</span>.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => ejecutar("repartir")}
                disabled={enviando !== null}
                className="lp-btn lp-btn-primary h-10 min-h-0 flex-1 text-[14px]"
              >
                {enviando === "repartir" ? "Repartiendo..." : "Sí, repartir"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmando(false)}
                disabled={enviando !== null}
                className="lp-btn lp-btn-ghost h-10 min-h-0 flex-1 text-[14px]"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmando(true)}
            className="lp-btn lp-btn-primary h-10 min-h-0 w-full text-[14px]"
          >
            Repartir el pozo
          </button>
        ))}

      {error && <p className="mt-2 text-[12px] text-red-alert">{error}</p>}
      {ok && <p className="mt-2 text-[12px] text-turf">{ok}</p>}
    </div>
  );
}

export default AccionesPolla;
