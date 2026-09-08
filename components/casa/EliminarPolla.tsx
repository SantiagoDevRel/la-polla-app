"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

/** Mount only inside an admin-gated surface; the endpoint checks is_admin too. */
export function EliminarPolla({ id, nombre, redirectTo }: {
  id: string;
  nombre: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const inputId = useId();
  const [confirmando, setConfirmando] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function eliminar() {
    if (confirmName.trim() !== nombre || enviando) return;
    setEnviando(true);
    setError(null);
    try {
      const response = await fetch(`/api/casa/admin/pollas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "eliminar", confirmName: confirmName.trim() }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "No se pudo eliminar la polla.");
      setConfirmando(false);
      if (redirectTo) router.replace(redirectTo);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error de conexión. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mt-4 border-t border-border-default pt-4">
      {confirmando ? (
        <div className="rounded-md border border-red-alert/40 bg-red-alert/10 p-3 [overflow-wrap:anywhere]">
          <h3 className="text-[15px] font-semibold text-text-primary">Eliminar {nombre}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-text-secondary">
            La polla dejará de aparecer y su enlace ya no estará disponible.
            Conservamos las inscripciones, los comprobantes, los pronósticos y
            los premios registrados. Esta acción no devuelve dinero ni hace pagos.
          </p>
          <label htmlFor={inputId} className="mt-3 block text-[13px] text-text-primary">
            Escribe <strong className="font-semibold">{nombre}</strong> para confirmar.
          </label>
          <input id={inputId} value={confirmName} onChange={(event) => setConfirmName(event.target.value)}
            autoComplete="off" disabled={enviando} className="lp-input mt-2" />
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={enviando || confirmName.trim() !== nombre} onClick={eliminar}
              className="lp-btn min-h-11 grow basis-40 bg-red-alert text-bg-base hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45">
              {enviando ? "Eliminando..." : "Confirmar eliminación"}
            </button>
            <button type="button" disabled={enviando} onClick={() => { setConfirmando(false); setConfirmName(""); setError(null); }}
              className="lp-btn lp-btn-ghost min-h-11 grow basis-40">Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirmando(true)}
          className="lp-btn lp-btn-ghost min-h-11 w-full border-red-alert/40 text-red-alert hover:border-red-alert hover:bg-red-alert/10">
          <Trash2 className="h-4 w-4 shrink-0" aria-hidden="true" /> Eliminar polla
        </button>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] text-red-alert">{error}</p>}
    </div>
  );
}
