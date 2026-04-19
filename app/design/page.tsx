// app/design/page.tsx
// Internal preview — shows palette swatches, type scale, and basic components.
// Not linked from any user-facing screen. Access via /design directly.

export default function DesignPage() {
  return (
    <div className="min-h-screen bg-bg-base text-text-primary p-6 max-w-4xl mx-auto">
      <h1 className="font-display text-5xl tracking-wide mb-6">TRIBUNA CALIENTE</h1>
      <p className="text-text-secondary mb-10">Design tokens preview · v0.1</p>

      <section className="mb-10">
        <h2 className="font-display text-2xl mb-4 text-gold">01 — Palette</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { name: "bg-base", hex: "#080c10", style: { background: "#080c10" } },
            { name: "bg-card", hex: "#0e1420", style: { background: "#0e1420" } },
            { name: "bg-elevated", hex: "#131b2b", style: { background: "#131b2b" } },
            { name: "gold", hex: "#FFD700", style: { background: "#FFD700", color: "#000" } },
            { name: "amber", hex: "#FF9F1C", style: { background: "#FF9F1C", color: "#000" } },
            { name: "turf", hex: "#1FD87F", style: { background: "#1FD87F", color: "#000" } },
            { name: "red-alert", hex: "#FF3D57", style: { background: "#FF3D57", color: "#000" } },
            { name: "text-primary", hex: "#F5F7FA", style: { background: "#F5F7FA", color: "#000" } },
            { name: "text-secondary", hex: "#AEB7C7", style: { background: "#AEB7C7", color: "#000" } },
          ].map((c) => (
            <div key={c.name} className="rounded-lg overflow-hidden border border-white/10">
              <div
                className="h-20 flex items-end p-3 font-display tracking-wider text-xs"
                style={c.style}
              >
                {c.hex}
              </div>
              <div className="p-3 bg-bg-card">
                <p className="text-sm font-semibold">{c.name}</p>
                <p className="text-xs text-text-muted font-mono">{c.hex}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl mb-4 text-gold">02 — Typography</h2>
        <div className="space-y-4 bg-bg-card p-6 rounded-lg border border-white/10">
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">Bebas 56</span>
            <p className="font-display text-[56px] leading-none">Santiago</p>
          </div>
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">Bebas 40 gold</span>
            <p className="font-display text-[40px] leading-none text-gold">2 — 1</p>
          </div>
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">
              Bebas 20 section
            </span>
            <p className="font-display text-[20px] leading-none tracking-wide">MIS POLLAS</p>
          </div>
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">Outfit 15 body</span>
            <p className="font-body text-[15px]">2 partidos te esperan hoy</p>
          </div>
          <div>
            <span className="text-xs text-text-muted uppercase tracking-wider">
              Outfit 11 label
            </span>
            <p className="font-body text-[11px] font-semibold tracking-[0.08em] uppercase text-text-muted">
              Próximo partido
            </p>
          </div>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="font-display text-2xl mb-4 text-gold">03 — Buttons</h2>
        <div className="flex flex-wrap gap-3">
          <button className="bg-gold text-bg-base font-display text-[18px] tracking-[0.06em] px-6 py-3.5 rounded-full shadow-[0_8px_24px_-6px_rgba(255,215,0,0.4)]">
            Crear polla
          </button>
          <button className="bg-bg-elevated text-text-primary font-display text-[18px] tracking-[0.06em] px-6 py-3.5 rounded-full border border-white/10">
            Ver detalles
          </button>
          <button className="bg-transparent text-red-alert font-display text-[18px] tracking-[0.06em] px-6 py-3.5 rounded-full border border-red-alert/40">
            Cerrar sesión
          </button>
        </div>
      </section>
    </div>
  );
}
