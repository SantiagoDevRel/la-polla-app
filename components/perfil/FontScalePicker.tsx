// components/perfil/FontScalePicker.tsx — A− / A / A+ control inside
// /perfil. Toggling applies the new scale immediately and persists it
// to localStorage so the next page load lands at the same size.
"use client";

import { useEffect, useState } from "react";
import { Type } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  applyScale,
  getStoredScale,
  setStoredScale,
  type FontScale,
} from "@/lib/font-scale";

// Labels are real percentages so the buttons look like the standard
// "zoom out / 100% / zoom in" trio users expect. Numbers match the
// multipliers in lib/font-scale.ts.
const OPTIONS: { value: FontScale; label: string }[] = [
  { value: "sm", label: "−30%" },
  { value: "md", label: "100%" },
  { value: "lg", label: "+60%" },
];

export default function FontScalePicker() {
  const t = useTranslations("Settings");
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
    <section className="lp-card p-3.5">
      <div className="mb-2.5 flex items-center gap-1.5 text-[13px] font-bold text-text-primary">
        <Type className="h-3.5 w-3.5 text-text-secondary" aria-hidden="true" />
        {t("fontSizeLabel")}
      </div>
      <div
        role="radiogroup"
        aria-label={t("fontSizeLabel")}
        className="flex gap-2"
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
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-xl border px-2 text-[13px] leading-none transition-all ${
                active
                  ? "border-gold/40 bg-gold/10 font-bold text-gold"
                  : "border-border-subtle bg-bg-elevated font-medium text-text-primary hover:border-gold/30"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </section>
  );
}
