"use client";

// CreaTuSelfieCard — entrada (featured card) de la feature "Crea tu Selfie".
// Admin-only: el gating se hace server-side en /inicio (solo se monta para admins).
import { useState } from "react";
import { Sparkles, ChevronRight } from "lucide-react";
import CreaTuSelfieSheet from "./CreaTuSelfieSheet";

export default function CreaTuSelfieCard() {
  const [open, setOpen] = useState(false);
  return (
    <section className="px-4">
      <button
        onClick={() => setOpen(true)}
        className="relative w-full flex items-center gap-3 overflow-hidden rounded-2xl border border-gold/40 bg-gradient-to-br from-gold/[0.12] via-bg-card to-bg-card px-4 py-4 text-left shadow-[0_0_28px_-8px_rgba(255,215,0,0.35)] transition-[box-shadow,border-color,transform] duration-300 hover:border-gold/60 hover:shadow-[0_0_36px_-6px_rgba(255,215,0,0.5)] active:scale-[0.99]"
      >
        <span className="shrink-0 w-11 h-11 rounded-full bg-gold/15 border border-gold/30 flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-gold" />
        </span>
        <span className="min-w-0 grow">
          <span className="flex items-center gap-2">
            <span className="font-display text-xl leading-none text-text-primary">CREA TU SELFIE</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gold border border-gold/30 rounded-full px-1.5 py-0.5">Beta · admin</span>
          </span>
          <span className="block text-sm text-text-secondary mt-1">Posá con tu crack del Mundial y pintate la cara de tu selección.</span>
        </span>
        <ChevronRight className="w-5 h-5 text-gold shrink-0" />
      </button>
      <CreaTuSelfieSheet open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
