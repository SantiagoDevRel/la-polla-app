// app/(app)/preview/logo-halo/page.tsx
// Playground para tunear el halo detrás de los logos de torneo.
// Sliders en vivo: color del bg, opacidad del bg, color del ring,
// opacidad del ring, tamaño del logo, tamaño del halo. Render-side
// muestra los logos tal como se verían en una PollaCard real.
"use client";

import { useState } from "react";
import Image from "next/image";
import { TOURNAMENTS } from "@/lib/tournaments";

type ColorChoice = "white" | "gold" | "gray" | "black" | "amber" | "turf";

const COLOR_VALUES: Record<ColorChoice, string> = {
  white: "255, 255, 255",
  gold: "255, 215, 0",
  gray: "174, 183, 199",
  black: "8, 12, 16",
  amber: "255, 159, 28",
  turf: "31, 216, 127",
};

export default function LogoHaloPreview() {
  const [bgColor, setBgColor] = useState<ColorChoice>("white");
  const [bgOpacity, setBgOpacity] = useState(50);
  const [ringColor, setRingColor] = useState<ColorChoice>("white");
  const [ringOpacity, setRingOpacity] = useState(15);
  const [haloSize, setHaloSize] = useState(28);
  const [logoSize, setLogoSize] = useState(20);
  const [bgVariant, setBgVariant] = useState<"card" | "header" | "elevated">("card");

  const bgRgba = `rgba(${COLOR_VALUES[bgColor]}, ${bgOpacity / 100})`;
  const ringRgba = `rgba(${COLOR_VALUES[ringColor]}, ${ringOpacity / 100})`;

  // Mostrar el className equivalente cuando el color base es blanco.
  // Para otros colores damos el inline-style (Tailwind no permite
  // arbitrary RGBA con presets fijos sin custom config).
  const bgClass =
    bgColor === "white" ? `bg-white/${bgOpacity}` : `bg-[${bgRgba}]`;
  const ringClass =
    ringColor === "white"
      ? `ring-1 ring-white/${ringOpacity}`
      : `ring-1 ring-[${ringRgba}]`;
  const cssSnippet = `${bgClass} ${ringClass}`;

  const cardBg =
    bgVariant === "card"
      ? "#0e1420"
      : bgVariant === "header"
        ? "rgba(255,215,0,0.08)"
        : "#131b2b";

  return (
    <div className="min-h-screen p-4 max-w-2xl mx-auto space-y-5">
      <header>
        <h1 className="lp-section-title text-[20px]">Preview · Halo de logos</h1>
        <p className="text-[12px] text-text-muted mt-1">
          Tuneá el halo detrás de los logos. Mandame los valores finales y los aplico en producción.
        </p>
      </header>

      {/* Live preview area */}
      <section
        className="rounded-2xl p-5 border border-border-subtle"
        style={{ background: cardBg }}
      >
        <p className="text-[10px] uppercase tracking-[0.1em] text-text-muted mb-3">
          Preview con fondo: {bgVariant}
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {TOURNAMENTS.map((t) => (
            <span
              key={t.slug}
              className="inline-flex items-center justify-center"
              style={{
                width: haloSize,
                height: haloSize,
                borderRadius: "9999px",
                background: bgRgba,
                boxShadow: `inset 0 0 0 1px ${ringRgba}`,
              }}
              title={t.name}
            >
              <Image
                src={t.logoPath}
                alt={t.name}
                width={logoSize}
                height={logoSize}
                className="object-contain"
              />
            </span>
          ))}
        </div>
        <p className="text-[10px] text-text-muted mt-3">
          {TOURNAMENTS.length} logos · halo {haloSize}px / logo {logoSize}px
        </p>
      </section>

      {/* Background variant */}
      <section className="rounded-2xl p-4 lp-card space-y-2">
        <p className="text-[10px] uppercase tracking-[0.1em] text-text-muted">
          Fondo de prueba
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(["card", "header", "elevated"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setBgVariant(v)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                bgVariant === v
                  ? "bg-gold text-bg-base border-gold"
                  : "bg-bg-elevated text-text-secondary border-border-subtle"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
        <p className="text-[10px] text-text-muted">
          card = #0e1420 (PollaCard) · header = pill amber translúcido (detail header) · elevated = #131b2b
        </p>
      </section>

      {/* Background color */}
      <section className="rounded-2xl p-4 lp-card space-y-3">
        <p className="text-[10px] uppercase tracking-[0.1em] text-text-muted">
          Color del halo
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(COLOR_VALUES) as ColorChoice[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setBgColor(c)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                bgColor === c
                  ? "bg-gold text-bg-base border-gold"
                  : "bg-bg-elevated text-text-secondary border-border-subtle"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ background: `rgb(${COLOR_VALUES[c]})` }}
              />
              {c}
            </button>
          ))}
        </div>
        <RangeSlider
          label="Opacidad del halo"
          value={bgOpacity}
          onChange={setBgOpacity}
          min={0}
          max={100}
        />
      </section>

      {/* Ring */}
      <section className="rounded-2xl p-4 lp-card space-y-3">
        <p className="text-[10px] uppercase tracking-[0.1em] text-text-muted">
          Borde / ring
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(COLOR_VALUES) as ColorChoice[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setRingColor(c)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5 ${
                ringColor === c
                  ? "bg-gold text-bg-base border-gold"
                  : "bg-bg-elevated text-text-secondary border-border-subtle"
              }`}
            >
              <span
                className="w-3 h-3 rounded-full inline-block"
                style={{ background: `rgb(${COLOR_VALUES[c]})` }}
              />
              {c}
            </button>
          ))}
        </div>
        <RangeSlider
          label="Opacidad del ring"
          value={ringOpacity}
          onChange={setRingOpacity}
          min={0}
          max={100}
        />
      </section>

      {/* Sizes */}
      <section className="rounded-2xl p-4 lp-card space-y-3">
        <p className="text-[10px] uppercase tracking-[0.1em] text-text-muted">Tamaños</p>
        <RangeSlider
          label={`Tamaño del halo (${haloSize}px)`}
          value={haloSize}
          onChange={setHaloSize}
          min={16}
          max={48}
        />
        <RangeSlider
          label={`Tamaño del logo (${logoSize}px)`}
          value={logoSize}
          onChange={setLogoSize}
          min={10}
          max={40}
        />
      </section>

      {/* Output snippet — para que copies y me mandes */}
      <section className="rounded-2xl p-4 lp-card space-y-2 border border-gold/30">
        <p className="text-[10px] uppercase tracking-[0.1em] text-gold">
          Valores actuales (mandame esto)
        </p>
        <pre
          className="text-[11px] text-text-primary bg-bg-base border border-border-subtle rounded-lg p-3 overflow-auto"
          style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
        >
          {`bg-color    = ${bgColor}  (rgba: ${COLOR_VALUES[bgColor]})
bg-opacity  = ${bgOpacity}%
ring-color  = ${ringColor}
ring-opacity= ${ringOpacity}%
halo-size   = ${haloSize}px
logo-size   = ${logoSize}px

className aproximada (cuando bg=white/ring=white):
  ${cssSnippet}`}
        </pre>
        <button
          type="button"
          onClick={() => {
            const text = `bg=${bgColor} ${bgOpacity}% / ring=${ringColor} ${ringOpacity}% / halo=${haloSize}px / logo=${logoSize}px`;
            void navigator.clipboard.writeText(text).catch(() => {});
          }}
          className="text-[12px] px-3 py-1.5 rounded-lg bg-gold/15 border border-gold/30 text-gold hover:bg-gold/20 transition-colors"
        >
          Copiar resumen
        </button>
      </section>
    </div>
  );
}

function RangeSlider({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-text-secondary">
        <span>{label}</span>
        <span className="tabular-nums" style={{ fontFeatureSettings: '"tnum"' }}>
          {value}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="w-full accent-gold"
      />
    </div>
  );
}
