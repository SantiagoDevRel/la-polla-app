// components/nav/BottomNav.tsx — Tribuna Caliente §3.8
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, Bookmark, User, Plus } from "lucide-react";
import { cn } from "@/lib/cn";

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
  const resolvedActive = active ?? deriveActive(pathname);
  const [left, middleLeft, middleRight, right] = TABS;

  const fabClass =
    "absolute left-1/2 -translate-x-1/2 -top-6 w-[58px] h-[58px] rounded-full bg-gold flex items-center justify-center active:scale-95 transition-transform duration-150";
  const fabStyle: React.CSSProperties = {
    boxShadow:
      "0 0 0 4px var(--bg-base), 0 10px 24px -6px rgba(255,215,0,0.55)",
  };

  return (
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

        {/* FAB — Link if createHref is provided, else button calling onCreatePolla */}
        {createHref ? (
          <Link
            href={createHref}
            aria-label="Crear polla"
            className={fabClass}
            style={fabStyle}
          >
            <Plus className="w-7 h-7 text-bg-base" strokeWidth={3} aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={onCreatePolla}
            aria-label="Crear polla"
            className={fabClass}
            style={fabStyle}
          >
            <Plus className="w-7 h-7 text-bg-base" strokeWidth={3} aria-hidden="true" />
          </button>
        )}

        <div className="flex-1 flex">
          <TabItem tab={middleRight} active={resolvedActive === middleRight.key} />
          <TabItem tab={right} active={resolvedActive === right.key} />
        </div>
      </div>
    </nav>
  );
}

export default BottomNav;
