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
import { Home, Search, Bookmark, User, Plus, KeyRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/ui/Toast";
import { JoinByCodeSheet } from "@/components/pollas/JoinByCodeSheet";

type NavKey = "inicio" | "explorar" | "pollas" | "perfil";

export interface BottomNavProps {
  active?: NavKey;
  createHref?: string;
  onCreatePolla?: () => void;
}

const TABS: Array<{ key: NavKey; href: string; Icon: typeof Home; label: string }> = [
  { key: "inicio", href: "/inicio", Icon: Home, label: "Inicio" },
  { key: "explorar", href: "/explorar", Icon: Search, label: "Explorar" },
  { key: "pollas", href: "/pollas", Icon: Bookmark, label: "Pollas" },
  { key: "perfil", href: "/perfil", Icon: User, label: "Perfil" },
];

function deriveActive(pathname: string | null): NavKey | undefined {
  if (!pathname) return undefined;
  // Match /inicio as the canonical home. /dashboard also resolves here
  // during the cutover window because it redirects to /inicio server-side,
  // so the tab still highlights correctly for users hitting the old URL.
  if (pathname === "/inicio" || pathname.startsWith("/inicio")) return "inicio";
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard")) return "inicio";
  if (pathname.startsWith("/explorar")) return "explorar";
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
}: {
  tab: (typeof TABS)[number];
  active: boolean;
}) {
  const { Icon, label, href } = tab;
  return (
    <Link
      href={href}
      className={cn(
        "flex flex-col items-center justify-center flex-1 min-h-[44px] gap-0.5",
        active ? "text-gold" : "text-text-muted",
      )}
    >
      <Icon className="w-[22px] h-[22px]" strokeWidth={2} aria-hidden="true" />
      <span className="font-body text-[10px] font-semibold">{label}</span>
    </Link>
  );
}

export function BottomNav({ active, createHref, onCreatePolla }: BottomNavProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { showToast } = useToast();
  const resolvedActive = active ?? deriveActive(pathname);
  const [left, middleLeft, middleRight, right] = TABS;

  // Tapping the FAB opens the small choice sheet. That sheet hands off
  // either to createHref (or the onCreatePolla callback, if no href) or
  // to the join-by-code sheet.
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const effectiveCreateHref = createHref ?? "/pollas/crear";

  const fabClass =
    "absolute left-1/2 -translate-x-1/2 -top-6 w-[58px] h-[58px] rounded-full bg-gold flex items-center justify-center active:scale-95 transition-transform duration-150";
  const fabStyle: React.CSSProperties = {
    boxShadow:
      "0 0 0 4px var(--bg-base), 0 10px 24px -6px rgba(255,215,0,0.55)",
  };

  return (
    <>
      <nav
        aria-label="Navegación inferior"
        className="fixed left-[14px] right-[14px] bottom-[14px] z-50 rounded-full backdrop-blur-md border border-border-subtle h-[76px] max-w-[480px] mx-auto"
        style={{ background: "rgba(14, 20, 32, 0.92)" }}
      >
        <div className="relative h-full flex items-center px-4">
          <div className="flex-1 flex">
            <TabItem tab={left} active={resolvedActive === left.key} />
            <TabItem tab={middleLeft} active={resolvedActive === middleLeft.key} />
          </div>

          <button
            type="button"
            onClick={() => setChoiceOpen(true)}
            aria-label="Crear o unirme a una polla"
            className={fabClass}
            style={fabStyle}
          >
            <Plus className="w-7 h-7 text-bg-base" strokeWidth={3} aria-hidden="true" />
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
            <Drawer.Title className="sr-only">Nueva polla</Drawer.Title>
            <Drawer.Description className="sr-only">
              Crea una polla nueva o únete a una existente con un código.
            </Drawer.Description>
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border-default" />
            <div className="p-5 pb-8 flex flex-col gap-3">
              <h3 className="font-display text-[22px] tracking-[0.04em] uppercase text-text-primary leading-none mb-1">
                Nueva polla
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
                Crear polla nueva
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
                Unirme con código
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
          showToast(`Te uniste a ${polla.name}`, "success");
          router.push(`/pollas/${polla.slug}`);
        }}
      />
    </>
  );
}

export default BottomNav;
