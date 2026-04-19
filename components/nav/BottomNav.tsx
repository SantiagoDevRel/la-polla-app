// components/nav/BottomNav.tsx — Tribuna Caliente §3.8
"use client";

import Link from "next/link";
import { Home, Search, Bookmark, User, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

type NavKey = "inicio" | "explorar" | "pollas" | "perfil";

export interface BottomNavProps {
  active: NavKey;
  onCreatePolla?: () => void;
}

const TABS: Array<{ key: NavKey; href: string; Icon: typeof Home; label: string }> = [
  { key: "inicio", href: "/dashboard", Icon: Home, label: "Inicio" },
  { key: "explorar", href: "/explorar", Icon: Search, label: "Explorar" },
  { key: "pollas", href: "/pollas", Icon: Bookmark, label: "Pollas" },
  { key: "perfil", href: "/perfil", Icon: User, label: "Perfil" },
];

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

export function BottomNav({ active, onCreatePolla }: BottomNavProps) {
  const [left, middleLeft, middleRight, right] = TABS;
  return (
    <nav
      aria-label="Navegación inferior"
      className="fixed left-[14px] right-[14px] bottom-[14px] z-50 rounded-full backdrop-blur-md border border-border-subtle h-[76px] max-w-[480px] mx-auto"
      style={{ background: "rgba(14, 20, 32, 0.92)" }}
    >
      <div className="relative h-full flex items-center px-4">
        <div className="flex-1 flex">
          <TabItem tab={left} active={active === left.key} />
          <TabItem tab={middleLeft} active={active === middleLeft.key} />
        </div>

        {/* FAB */}
        <button
          type="button"
          onClick={onCreatePolla}
          aria-label="Crear polla"
          className="absolute left-1/2 -translate-x-1/2 -top-6 w-[58px] h-[58px] rounded-full bg-gold flex items-center justify-center shadow-[0_10px_24px_-6px_rgba(255,215,0,0.55)] active:scale-95 transition-transform duration-150"
          style={{ boxShadow: "0 0 0 4px var(--bg-base), 0 10px 24px -6px rgba(255,215,0,0.55)" }}
        >
          <Plus
            className="w-7 h-7 text-bg-base"
            strokeWidth={3}
            aria-hidden="true"
          />
        </button>

        <div className="flex-1 flex">
          <TabItem tab={middleRight} active={active === middleRight.key} />
          <TabItem tab={right} active={active === right.key} />
        </div>
      </div>
    </nav>
  );
}

export default BottomNav;
