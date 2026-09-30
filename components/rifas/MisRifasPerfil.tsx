"use client";
// components/rifas/MisRifasPerfil.tsx — «Crear mi rifa» y «Mis rifas» en Perfil.
//
// Solo para creadores habilitados por un administrador. A quien no tiene el
// permiso (ni rifas creadas) no se le dibuja nada: ni botón apagado ni texto.
// Con RIFAS_ENABLED apagado, /api/rifas responde { enabled:false } y tampoco
// se dibuja nada. Fuera de la app iOS (rifas con dinero: App Store 5.3).
import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Plus, Ticket } from "lucide-react";
import ProfileSectionHeading from "@/components/perfil/ProfileSectionHeading";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";
import { drawLabel, type RifaMyList } from "@/lib/rifas/shared";

export function MisRifasPerfil() {
  const isIOSApp = useIsIOSApp();
  const [data, setData] = useState<(RifaMyList & { enabled: boolean }) | null>(null);

  useEffect(() => {
    if (isIOSApp) return;
    const controller = new AbortController();
    fetch("/api/rifas", { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.enabled) setData(d); })
      .catch(() => {});
    return () => controller.abort();
  }, [isIOSApp]);

  if (isIOSApp || !data || (!data.can_create && data.created.length === 0)) return null;

  return (
    <section aria-label="Mis rifas" className="lp-card space-y-3 border-amber/20 p-4 hover:border-amber/40">
      <ProfileSectionHeading icon={Ticket} tone="tickets" title="Mis rifas" meta={data.created.length ? `${data.created.length}` : undefined} />
      {data.can_create && (
        <Link href="/rifas/crear" className="lp-btn lp-btn-ghost w-full">
          <Plus aria-hidden="true" className="h-5 w-5" /> Crear mi rifa
        </Link>
      )}
      {data.created.length > 0 && (
        <ul className="mt-3 divide-y divide-border-subtle">
          {data.created.map((r) => (
            <li key={r.slug}>
              <Link href={`/rifa/${r.slug}/gestionar`} className="flex min-h-14 items-center gap-3 py-2 transition-colors hover:text-text-primary">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-text-primary">{r.name}</span>
                  <span className="block text-[13px] text-text-secondary">
                    {r.status === "abierta" ? drawLabel(r.draw_at) : r.status === "resuelta" ? "Con ganador" : "Desierta"}
                    {" · "}{r.paid}/{r.number_count} pagados{r.visibility === "privada" ? " · Privada" : ""}{r.hidden ? " · Oculta" : ""}
                  </span>
                </span>
                {r.pending_proofs > 0 && (
                  <span className="shrink-0 rounded-full bg-red-alert px-2 py-0.5 text-[13px] font-semibold text-text-primary"
                    aria-label={`${r.pending_proofs} comprobantes por revisar`}>{r.pending_proofs}</span>
                )}
                <ChevronRight aria-hidden="true" className="h-5 w-5 shrink-0 text-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
