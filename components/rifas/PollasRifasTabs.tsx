// components/rifas/PollasRifasTabs.tsx — pestañas POLLAS | RIFAS arriba de /inicio.
//
// Enlaces (?tab=rifas), no estado de cliente: la pestaña RIFAS se renderiza en
// el servidor sin cargar las pollas, y el enlace se puede compartir o volver
// con «atrás». POLLAS es la de siempre. Solo existen con RIFAS_ENABLED.
import Link from "next/link";

export function PollasRifasTabs({ active }: { active: "pollas" | "rifas" }) {
  const tab = (key: "pollas" | "rifas", label: string, href: string) => (
    <Link href={href} aria-current={active === key ? "page" : undefined}
      className={`flex min-h-11 flex-1 items-center justify-center rounded-full px-4 text-[15px] font-semibold tracking-[0.02em] transition-colors ${
        active === key ? "bg-text-primary text-bg-base" : "text-text-secondary hover:text-text-primary"}`}>
      {label}
    </Link>
  );
  return (
    <nav aria-label="Pollas o rifas" className="px-4 pb-3">
      <div className="flex gap-1 rounded-full border border-border-default bg-bg-card/80 p-1 backdrop-blur-sm">
        {tab("pollas", "POLLAS", "/inicio")}
        {tab("rifas", "RIFAS", "/inicio?tab=rifas")}
      </div>
    </nav>
  );
}
