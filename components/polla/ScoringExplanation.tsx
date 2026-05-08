// components/polla/ScoringExplanation.tsx — Modal que explica el sistema de puntaje
"use client";

import { useEffect, useMemo, useState } from "react";
import { HelpCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";

export default function ScoringExplanation({
  compact = false,
}: {
  /** When true, renders a bare icon button (no "Cómo se puntúa?" label).
   *  Used in the polla detail pot band so the helper coexists with the
   *  pot copy without fighting for space. */
  compact?: boolean;
} = {}) {
  const t = useTranslations("Scoring");
  const TIERS = useMemo(
    () => [
      {
        points: 5,
        label: t("tier1Label"),
        pred: "2-1",
        result: "2-1",
        desc: t("expDescTier1"),
        color: "text-gold",
        bg: "bg-gold/10 border-gold/20",
      },
      {
        points: 3,
        label: t("tier2Label"),
        pred: "3-2",
        result: "2-1",
        desc: t("expDescTier2"),
        color: "text-green-live",
        bg: "bg-green-live/10 border-green-live/20",
      },
      {
        points: 2,
        label: t("tier3Label"),
        pred: "3-0",
        result: "2-1",
        desc: t("expDescTier3"),
        color: "text-blue-info",
        bg: "bg-blue-info/10 border-blue-info/20",
      },
      {
        points: 1,
        label: t("tier4Label"),
        pred: "2-3",
        result: "2-1",
        desc: t("expDescTier4"),
        color: "text-text-secondary",
        bg: "bg-bg-elevated border-border-subtle",
      },
      {
        points: 0,
        label: t("expLabelTier5"),
        pred: "0-0",
        result: "2-1",
        desc: t("expDescTier5"),
        color: "text-text-muted",
        bg: "bg-bg-card border-border-subtle",
      },
    ],
    [t],
  );
  const [open, setOpen] = useState(false);

  // Lock body scroll mientras el card está abierto. overscroll-contain en el
  // contenedor interno ya corta el scroll chaining en navegadores modernos;
  // este toggle sobre document.body es el respaldo para móviles más viejos.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label={t("expModalAria")}
        className={
          compact
            ? "inline-flex items-center justify-center w-5 h-5 rounded-full text-text-primary hover:text-gold transition-colors cursor-pointer"
            : "flex items-center gap-1.5 text-xs text-text-primary hover:text-gold transition-colors cursor-pointer"
        }
      >
        <HelpCircle className="w-4 h-4" />
        {compact ? null : t("expModalCTA")}
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-bg-base/80 backdrop-blur-sm">
          <div className="w-full max-w-md lp-card max-h-[85vh] overflow-y-auto overscroll-contain">
            <div className="sticky top-0 flex items-center justify-between p-4 bg-bg-card border-b border-border-subtle">
              <h2 className="font-display text-xl text-gold tracking-wide">{t("expModalTitle")}</h2>
              <button onClick={() => setOpen(false)} className="text-text-muted hover:text-text-primary transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {TIERS.map((tier) => (
                <div key={tier.points} className={`rounded-xl p-3 border ${tier.bg}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`font-bold text-sm ${tier.color}`}>{tier.label}</span>
                    <span className={`font-display text-lg tabular-nums ${tier.color}`}>{t("ptsCount", { count: tier.points })}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs mb-1.5">
                    <span className="text-text-muted">{t("yourPred")}: <strong className="text-text-primary">{tier.pred}</strong></span>
                    <span className="text-text-muted">{t("result")}: <strong className="text-text-primary">{tier.result}</strong></span>
                  </div>
                  <p className="text-xs text-text-secondary">{tier.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
