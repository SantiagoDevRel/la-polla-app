// components/ui/BottomNav.tsx — Barra de navegación inferior "estadio de noche"
// Fixed bottom, 5 items, botón central Crear en gold elevado, Lucide SVG icons
"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Search, Plus, Trophy, User } from "lucide-react";

const NAV_ITEMS = [
  { href: "/dashboard", icon: Home, label: "Inicio" },
  { href: "/explorar", icon: Search, label: "Explorar" },
  { href: "/pollas/crear", icon: Plus, label: "Crear", isCenter: true },
  { href: "/pollas", icon: Trophy, label: "Pollas" },
  { href: "/perfil", icon: User, label: "Perfil" },
];

export default function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 safe-bottom"
      style={{
        backgroundColor: "rgba(8, 12, 16, 0.88)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderTop: "1px solid rgba(26, 37, 53, 0.6)",
      }}
    >
      <div className="max-w-lg mx-auto flex items-end justify-around h-[64px] px-2">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" &&
              item.href !== "/pollas/crear" &&
              pathname.startsWith(item.href));

          const Icon = item.icon;

          // Botón central "Crear" — elevado, gold
          if (item.isCenter) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center -mt-[14px]"
              >
                <div
                  className="w-[52px] h-[52px] rounded-full bg-gold flex items-center justify-center"
                  style={{ boxShadow: "0 0 24px rgba(255,215,0,0.35), 0 4px 12px rgba(0,0,0,0.4)" }}
                >
                  <Icon className="w-6 h-6 text-bg-base" strokeWidth={2.5} />
                </div>
                <span className="text-[10px] font-semibold text-gold mt-1">
                  {item.label}
                </span>
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center py-2 min-w-[52px] transition-colors duration-150"
            >
              <Icon
                className={`w-5 h-5 transition-colors ${
                  isActive ? "text-gold" : "text-text-secondary"
                }`}
                strokeWidth={isActive ? 2.2 : 1.8}
              />
              <span
                className={`text-[10px] font-medium mt-1 ${
                  isActive ? "text-gold" : "text-text-muted"
                }`}
              >
                {item.label}
              </span>
              {isActive && (
                <div className="w-1 h-1 rounded-full bg-gold mt-0.5" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
