// components/nav/BottomNav.tsx — Tribuna Caliente §3.8
//
// Floating pill + center FAB. Tapping the FAB now opens a small choice
// sheet: "Crear polla" (navigates to createHref) or "Unirme con código"
// (opens the JoinByCodeSheet). Keeping both affordances inside the nav
// keeps the FAB the single entry point for "add a polla to my home".
"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Drawer } from "vaul";
import { motion, useReducedMotion } from "framer-motion";
import { Home, Bookmark, User, Plus, KeyRound } from "lucide-react";
import { WorldCupTrophy } from "@/components/icons/WorldCupTrophy";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { JoinByCodeSheet } from "@/components/pollas/JoinByCodeSheet";
import { useIsIOSApp } from "@/components/platform/PlatformProvider";

type NavKey = "inicio" | "worldcup" | "pollas" | "perfil";

export interface BottomNavProps {
  active?: NavKey;
  createHref?: string;
  onCreatePolla?: () => void;
  /** Count of unread avisos; shows a red badge on the Avisos tab when > 0. */
  notifUnread?: number;
  /** Count of partidos por pronosticar across all the viewer's active
   *  pollas; gold badge on the Pollas tab when > 0. Distinto color que
   *  Avisos para que el viewer mayor distinga "tienes algo que hacer
   *  acá" (gold) vs "te avisaron de algo" (red). */
  pollasPending?: number;
}

const TABS: Array<{ key: NavKey; href: string; Icon: typeof Home; labelKey: "tabInicio" | "tabPollas" | "tabWorldcup" | "tabPerfil" }> = [
  { key: "inicio", href: "/inicio", Icon: Home, labelKey: "tabInicio" },
  { key: "pollas", href: "/pollas", Icon: Bookmark, labelKey: "tabPollas" },
  // "Avisos" reemplazado por las Llaves del Mundial (Road to World Cup).
  { key: "worldcup", href: "/road-to-worldcup", Icon: WorldCupTrophy as unknown as typeof Home, labelKey: "tabWorldcup" },
  { key: "perfil", href: "/perfil", Icon: User, labelKey: "tabPerfil" },
];

function deriveActive(pathname: string | null): NavKey | undefined {
  if (!pathname) return undefined;
  // Match /inicio as the canonical home. /dashboard also resolves here
  // during the cutover window because it redirects to /inicio server-side,
  // so the tab still highlights correctly for users hitting the old URL.
  if (pathname === "/inicio" || pathname.startsWith("/inicio")) return "inicio";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard")) return "inicio";
  if (pathname.startsWith("/road-to-worldcup")) return "worldcup";
  if (pathname.startsWith("/perfil")) return "perfil";
  // Match /pollas and /pollas/... but NOT /pollas/crear (that's the FAB target)
  if (pathname === "/pollas" || (pathname.startsWith("/pollas/") && !pathname.startsWith("/pollas/crear"))) {
    return "pollas";
  }
  return undefined;
}

function TabItem({
  tab,
  active,
  badge,
  badgeTone = "red",
  badgeLabelPrefix,
}: {
  tab: (typeof TABS)[number];
  active: boolean;
  badge?: number;
  /** "red" para avisos sin leer; "gold" para acciones pendientes (pronósticos). */
  badgeTone?: "red" | "gold";
  /** Prefijo del aria-label del badge. Default es "sin leer" / "unread". */
  badgeLabelPrefix?: string;
}) {
  const t = useTranslations("Nav");
  const reduceMotion = useReducedMotion();
  const { Icon, labelKey, href } = tab;
  const showBadge = typeof badge === "number" && badge > 0;
  const badgeLabel = showBadge ? (badge! > 9 ? "9+" : String(badge)) : null;
  const badgeBg = badgeTone === "gold" ? "bg-gold text-bg-base" : "bg-red-alert text-white";
  return (
    <Link
      href={href}
      aria-label={t(labelKey)}
      aria-current={active ? "page" : undefined}
      className={cn(
        // Estilo Instagram (2026-06-11): solo ícono, sin label visible
        // (el nombre vive en aria-label). El "lozenge" de vidrio detrás
        // del ícono activo se desliza entre tabs via framer layoutId.
        "flex items-center justify-center flex-1 min-w-0 min-h-[48px] relative",
        "active:scale-90 transition-transform duration-150",
        active ? "text-gold" : "text-text-muted",
      )}
    >
      {active && (
        <motion.span
          layoutId="nav-active-lozenge"
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 600, damping: 38, mass: 0.7 }
          }
          className="absolute w-[52px] h-[40px] rounded-full bg-white/[0.12] border border-white/[0.08]"
          aria-hidden="true"
        />
      )}
      <span className="relative">
        <Icon
          className="w-6 h-6"
          strokeWidth={active ? 2.4 : 2}
          aria-hidden="true"
        />
        {showBadge && (
          <span
            className={cn(
              "absolute -top-1 -right-1.5 min-w-[14px] h-[14px] px-[3px] rounded-full text-[9px] font-bold leading-[14px] text-center border-[2px] border-bg-base",
              badgeBg,
            )}
            aria-label={`${badge} ${badgeLabelPrefix ?? t("ariaUnread")}`}
          >
            {badgeLabel}
          </span>
        )}
      </span>
    </Link>
  );
}

export function BottomNav({
  active,
  createHref,
  onCreatePolla,
  pollasPending = 0,
}: BottomNavProps) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const isIOSApp = useIsIOSApp();
  const resolvedActive = active ?? deriveActive(pathname);
  const [left, middleLeft, middleRight, right] = TABS;

  // Hide the entire navbar inside flows that need full-screen focus
  // (currently only the create-polla wizard). The wizard renders its
  // own sticky Cancelar/Atrás/Continuar bar at the bottom, so the
  // BottomNav would just collide with it.
  const hideNav = pathname?.startsWith("/pollas/crear") ?? false;

  // Tapping the FAB opens the small choice sheet. That sheet hands off
  // either to createHref (or the onCreatePolla callback, if no href) or
  // to the join-by-code sheet.
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const effectiveCreateHref = createHref ?? "/pollas/crear";

  // FAB sits FULLY INSIDE the navbar, centered vertically. We reserve a
  // 64px slot in the middle of the row (`w-16`) so the FAB doesn't crash
  // visually with the Pollas/Avisos tabs to either side. With a 48px
  // FAB and 8px breathing room on each side it sits cleanly between
  // the two flex groups.
  const fabClass =
    "absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 w-[48px] h-[48px] rounded-full bg-gold flex items-center justify-center active:scale-95 transition-transform duration-150";
  const fabStyle: React.CSSProperties = {
    boxShadow: "0 4px 16px -4px rgba(255,215,0,0.45)",
  };

  if (hideNav) return null;

  return (
    <>
      {/* Glass bar estilo Instagram (2026-06-11): bien translúcida
          (0.42 + blur-3xl + saturate-180) — el blur fuerte es lo que
          mantiene legibles los íconos aunque el fondo sea ruidoso.
          Highlight interior arriba + borde claro = canto de vidrio.
          h-64 porque ya no hay labels. */}
      <nav
        aria-label={t("ariaNav")}
        className="fixed left-[14px] right-[14px] bottom-[14px] z-50 rounded-full backdrop-blur-3xl backdrop-saturate-[1.8] border border-white/[0.12] h-[64px] max-w-[480px] mx-auto shadow-[0_8px_32px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)]"
        style={{ background: "rgba(14, 20, 32, 0.42)" }}
      >
        <div className="relative h-full flex items-center px-4">
          <div className="flex-1 flex">
            <TabItem tab={left} active={resolvedActive === left.key} />
            <TabItem
              tab={middleLeft}
              active={resolvedActive === middleLeft.key}
              badge={pollasPending}
              badgeTone="gold"
              badgeLabelPrefix={t("ariaToPredict")}
            />
          </div>

          {/* Reserved center slot — 64px wide. Stops the FAB from sitting
              on top of the Pollas/Avisos tabs. */}
          <div className="w-16 flex-shrink-0" aria-hidden="true" />

          <button
            type="button"
            onClick={(e) => {
              // Blur first: Vaul drawers slap aria-hidden on background
              // elements (including this nav) when they open. If the FAB
              // keeps focus, React warns ("Blocked aria-hidden on an
              // element because its descendant retained focus") and on
              // some browsers the focus trap leaves the button in a
              // limbo state where subsequent clicks no-op.
              e.currentTarget.blur();
              // En iOS no ofrecemos crear (App Store 5.1.1(ix)) — el FAB
              // abre directo el sheet de "unirme con código", sin el
              // choice sheet intermedio que tendría una opción "crear".
              if (isIOSApp) {
                setJoinOpen(true);
              } else {
                setChoiceOpen(true);
              }
            }}
            aria-label={isIOSApp ? t("joinWithCode") : t("ariaCreateJoin")}
            className={fabClass}
            style={fabStyle}
          >
            {isIOSApp ? (
              <KeyRound className="w-6 h-6 text-bg-base" strokeWidth={2.5} aria-hidden="true" />
            ) : (
              <Plus className="w-6 h-6 text-bg-base" strokeWidth={3} aria-hidden="true" />
            )}
          </button>

          <div className="flex-1 flex">
            <TabItem tab={middleRight} active={resolvedActive === middleRight.key} />
            <TabItem tab={right} active={resolvedActive === right.key} />
          </div>
        </div>
      </nav>

      {/* FAB choice sheet */}
      <Drawer.Root open={choiceOpen} onOpenChange={setChoiceOpen}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[55]" />
          <Drawer.Content
            className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-xl border border-border-default bg-bg-card"
          >
            <Drawer.Title className="sr-only">{t("newPolla")}</Drawer.Title>
            <Drawer.Description className="sr-only">
              {t("newPollaDescription")}
            </Drawer.Description>
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border-default" />
            <div className="p-5 pb-8 flex flex-col gap-3">
              <h3 className="font-display text-[22px] tracking-[0.04em] uppercase text-text-primary leading-none mb-1">
                {t("newPolla")}
              </h3>
              <Link
                href={effectiveCreateHref}
                onClick={() => {
                  setChoiceOpen(false);
                  onCreatePolla?.();
                }}
                className="flex items-center gap-3 rounded-full bg-gold text-bg-base font-display tracking-[0.06em] uppercase text-[16px] h-[52px] px-5 shadow-[0_8px_24px_-6px_rgba(255,215,0,0.4)]"
              >
                <Plus className="w-5 h-5" strokeWidth={3} aria-hidden="true" />
                {t("createNew")}
              </Link>
              <button
                type="button"
                onClick={() => {
                  setChoiceOpen(false);
                  // Small delay so the first drawer can fully close before the
                  // second opens; avoids Vaul overlay flicker.
                  window.setTimeout(() => setJoinOpen(true), 200);
                }}
                className="flex items-center gap-3 rounded-full bg-bg-elevated border border-border-default text-text-primary font-display tracking-[0.06em] uppercase text-[16px] h-[52px] px-5"
              >
                <KeyRound className="w-5 h-5 text-gold" strokeWidth={2} aria-hidden="true" />
                {t("joinWithCode")}
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>

      <JoinByCodeSheet
        open={joinOpen}
        onOpenChange={setJoinOpen}
        onSuccess={(polla) => {
          setJoinOpen(false);
          showToast(t("joinedToast", { name: polla.name }), "success");
          router.push(`/pollas/${polla.slug}`);
        }}
      />
    </>
  );
}

export default BottomNav;
