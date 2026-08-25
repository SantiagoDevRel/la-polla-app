// components/pollas/SeasonClosedCreate.tsx — Pantalla de cierre que
// reemplaza al wizard de /pollas/crear mientras SEASON_CLOSED.
//
// Por qué existe: con CREATABLE_TOURNAMENT_SLUGS vacío el paso 1 del
// wizard renderizaba la sección "Torneos" sin un solo chip — un form
// roto del que no se puede salir hacia adelante. Preferimos contar el
// cierre de frente (decisión del owner 2026-07-26).
//
// El BottomNav se auto-oculta en /pollas/crear, así que esta pantalla
// tiene que ofrecer su propia salida: flecha atrás + CTA a /pollas +
// link secundario a /inicio.
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { fadeUp } from "@/lib/animations";

export default function SeasonClosedCreate() {
  const router = useRouter();
  const t = useTranslations("Closure");

  return (
    <div className="min-h-screen">
      <header className="px-4 pt-4 pb-2">
        <div className="max-w-lg mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label={t("createSecondary")}
            className="text-text-secondary hover:text-gold transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 pb-16">
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="rounded-xl border border-gold/25 bg-bg-card/80 backdrop-blur-sm px-5 py-7 text-center"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/pollitos/Pollito_esperando.webp"
            alt=""
            width={112}
            height={112}
            className="h-28 w-28 max-w-none mx-auto"
            style={{ objectFit: "contain" }}
          />

          <h1 className="mt-4 font-display text-gold text-[26px] leading-none tracking-[0.04em] [overflow-wrap:anywhere]">
            {t("createTitle")}
          </h1>

          <p className="mt-3 text-[14px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
            {t("createBody")}
          </p>

          <p className="mt-3 text-[14px] leading-relaxed text-text-secondary [overflow-wrap:anywhere]">
            {t("createThanks")}
          </p>

          <p className="mt-3 text-[13px] leading-relaxed text-text-muted [overflow-wrap:anywhere]">
            {t("createComeback")}
          </p>

          <Link
            href="/casa"
            className="mt-6 inline-flex items-center justify-center rounded-full bg-gold text-bg-base font-semibold px-6 py-3 cursor-pointer transition-all duration-200 hover:brightness-110 hover:shadow-[0_0_24px_rgba(255,215,0,0.25)] active:scale-[0.98]"
          >
            {t("createCta")}
          </Link>

          <div className="mt-3">
            <Link
              href="/pollas"
              className="inline-flex items-center justify-center rounded-full px-4 py-2 text-[13px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated cursor-pointer transition-all duration-200"
            >
              {t("createSecondary")}
            </Link>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
