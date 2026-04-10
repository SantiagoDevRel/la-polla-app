// components/ui/BottomNav.tsx — Barra de navegación inferior "estadio de noche"
// Fixed bottom, 5 items, botón central Crear en gold elevado, Lucide SVG icons
// Active state: icon in gold + pill background bg-gold/10
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
    <nav className="fixed bottom-0 left-0 right-0 z-50 safe-bottom max-w-2xl mx-auto" style={{ background: "rgba(8,12,16,0.98)", borderTop: "1px solid #1a2540", padding: "6px 0 16px" }}>
      <div className="max-w-lg mx-auto flex items-end justify-around px-2">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/dashboard" &&
              item.href !== "/pollas/crear" &&
              pathname.startsWith(item.href));

          const Icon = item.icon;

          // Botón central "Crear" — elevado, gold, visual focal point
          if (item.isCenter) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex flex-col items-center -mt-[18px] min-w-[56px] min-h-[44px]"
              >
                <div className="w-[46px] h-[46px] rounded-full bg-gold flex items-center justify-center cursor-pointer shadow-[0_0_20px_rgba(255,215,0,0.3),0_4px_12px_rgba(0,0,0,0.4)] hover:shadow-[0_0_28px_rgba(255,215,0,0.45)] hover:scale-105 active:scale-95 transition-all duration-200" style={{ border: "3px solid #080c10" }}>
                  <Icon className="w-5 h-5 text-bg-base" strokeWidth={2.5} />
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
              className="flex flex-col items-center py-2 min-w-[56px] min-h-[44px] transition-all duration-200 cursor-pointer"
            >
              <Icon
                className={`w-5 h-5 transition-colors duration-200 ${
                  isActive ? "text-gold" : "text-text-secondary"
                }`}
                strokeWidth={isActive ? 2.2 : 1.8}
              />
              <span
                className={`text-[10px] font-medium transition-colors duration-200 ${
                  isActive ? "text-gold" : "text-text-secondary"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
