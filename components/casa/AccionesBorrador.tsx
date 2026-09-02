// components/casa/AccionesBorrador.tsx — el boton que le faltaba al borrador.
//
// Una polla en borrador es invisible en todas partes: listPublicPollas la
// filtra, /casa/[slug] hace notFound y join devuelve 404. Hasta hoy tampoco
// habia gesto para publicarla, asi que "Guardar borrador" enterraba el trabajo.
// Este componente es la salida.
//
// Es client porque /casa/admin es Server Component y esto necesita onClick.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AccionesBorrador({ id }: { id: string }) {
  const router = useRouter();
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function publicar() {
    setEnviando(true);
    setError(null);
    try {
      const res = await fetch(`/api/casa/admin/pollas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "publicar" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? "No pude publicarla.");
        return;
      }
      // refresh y no push: el admin se queda en el panel viendo la lista
      // actualizada, que es donde va a seguir trabajando.
      router.refresh();
    } catch {
      setError("Se cayo la conexion.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="bg-bg-card px-3 pb-3">
      <button
        type="button"
        onClick={publicar}
        disabled={enviando}
        className="lp-btn lp-btn-primary h-10 min-h-0 w-full text-[14px]"
      >
        {enviando ? "Publicando..." : "Publicar"}
      </button>
      {error ? (
        <p className="mt-2 text-[12px] text-red-alert">{error}</p>
      ) : (
        <p className="mt-2 text-[11px] text-text-muted">
          Mientras este en borrador no la ve nadie.
        </p>
      )}
    </div>
  );
}

export default AccionesBorrador;
