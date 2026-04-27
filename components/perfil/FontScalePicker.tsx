// components/perfil/FontScalePicker.tsx — A− / A / A+ control inside
// /perfil. Toggling applies the new scale immediately and persists it
// to localStorage so the next page load lands at the same size.
"use client";

import { useEffect, useState } from "react";
import { Type } from "lucide-react";
import {
  applyScale,
  getStoredScale,
  setStoredScale,
  type FontScale,
} from "@/lib/font-scale";

const OPTIONS: { value: FontScale; label: string; size: number }[] = [
  { value: "sm", label: "A", size: 14 },
  { value: "md", label: "A", size: 18 },
  { value: "lg", label: "A", size: 22 },
];

export default function FontScalePicker() {
  // SSR-safe init: render the default ("md") on the server, then sync to
  // the actual stored value on mount. Avoids a hydration mismatch when
  // the user has a non-default preference.
  const [scale, setScale] = useState<FontScale>("md");

  useEffect(() => {
    setScale(getStoredScale());
  }, []);

  function pick(next: FontScale) {
    setScale(next);
    setStoredScale(next);
    applyScale(next);
  }

  return (
    <section className="lp-card" style={{ padding: 14 }}>
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          color: "#f0f4ff",
          marginBottom: 10,
          display: "flex",
          alignItems: "center",
          gap: 5,
        }}
      >
        <Type className="w-3.5 h-3.5" style={{ color: "#FFD700" }} />
        Tamaño del texto
      </div>
      <p className="text-[11px] text-text-muted mb-3">
        Cambia el tamaño de toda la app. Se guarda en este dispositivo.
      </p>
      <div
        role="radiogroup"
        aria-label="Tamaño del texto"
        style={{ display: "flex", gap: 8 }}
      >
        {OPTIONS.map((opt) => {
          const active = scale === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(opt.value)}
              className="flex-1 rounded-xl flex items-center justify-center transition-all"
              style={{
                background: active
                  ? "rgba(255,215,0,0.12)"
                  : "var(--bg-elevated, #131b2b)",
                border: active
                  ? "1px solid rgba(255,215,0,0.4)"
                  : "1px solid rgba(255,255,255,0.08)",
                color: active ? "#FFD700" : "#F5F7FA",
                padding: "10px 6px",
                fontFamily: "'Outfit', sans-serif",
                fontWeight: active ? 700 : 500,
                fontSize: opt.size,
                lineHeight: 1,
                cursor: "pointer",
              }}
            >
              {opt.label}
              {opt.value === "sm" && (
                <span style={{ fontSize: 10, marginLeft: 2 }}>−</span>
              )}
              {opt.value === "lg" && (
                <span style={{ fontSize: 10, marginLeft: 2 }}>+</span>
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}
