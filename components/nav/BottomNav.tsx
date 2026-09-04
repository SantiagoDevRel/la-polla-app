// components/nav/BottomNav.tsx — la navegación de la casa.
//
// ─── POR QUÉ SE REESCRIBIÓ (2026-08-25) ───
// La versión anterior tenía 4 tabs (Inicio · Pollas · Llaves del Mundial ·
// Perfil) más un botón central para CREAR polla o unirse con código. Todo
// eso era el producto viejo: cualquiera armaba su polla e invitaba amigos.
//
// En la casa centralizada eso está retirado — solo el admin arma pollas —
// así que el botón central no solo sobraba: invitaba a algo que ya no
// existe. Y las Llaves del Mundial son de un torneo que terminó en julio.
//
// Queda lo que el producto realmente tiene: ver las pollas, y tu perfil.
// Dos destinos. Si sos admin aparece un tercero para armarlas.
//
// (2026-09-04) La auditoría visual posterior al regreso de Tribuna Caliente
// restauró la píldora de vidrio del sistema vigente. Conserva los dos destinos
// del producto centralizado, respeta safe-area y reduce motion, y mantiene un
// único `position: fixed` para no repetir el bug de momentum-scroll de WebKit.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Ticket, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/cn";

type NavKey = "pollas" | "perfil";

export interface BottomNavProps {
  active?: NavKey;
  /**
   * Se sigue aceptando para no romper a quien lo pase, pero YA NO DIBUJA
   * NADA (2026-09-03): el nav es idéntico para todos. Ver el comentario en
   * el cuerpo del componente.
   */
  isAdmin?: boolean;
  /**
   * Pollas donde te falta marcar algo. Badge en el tab de pollas: es la
   * única notificación que importa en este producto — la plata ya está
   * puesta y el partido arranca igual.
   */
  pollasPending?: number;
}

interface Tab {
  key: NavKey;
  href: string;
  Icon: typeof Ticket;
  labelKey: "tabPollas" | "tabPerfil";
}

const TAB_POLLAS: Tab = { key: "pollas", href: "/casa", Icon: Ticket, labelKey: "tabPollas" };
const TAB_PERFIL: Tab = { key: "perfil", href: "/perfil", Icon: User, labelKey: "tabPerfil" };
function deriveActive(pathname: string | null): NavKey | undefined {
  if (!pathname) return undefined;
  // /admin/* no tiene tab propia: no se marca ninguna. Va ANTES que /casa
  // por si alguna ruta futura los comparte.
  if (pathname.startsWith("/admin")) return undefined;
  if (pathname.startsWith("/casa")) return "pollas";
  if (pathname.startsWith("/perfil")) return "perfil";
  // Las rutas del modelo viejo (/inicio, /pollas, /road-to-worldcup) ya no
  // tienen tab. Si alguien llega por una URL guardada, no se marca ninguna
  // en vez de mentir sobre dónde está.
  return undefined;
}

export function BottomNav({ active, isAdmin = false, pollasPending = 0 }: BottomNavProps) {
  const t = useTranslations("Nav");
  const pathname = usePathname();
  const reduceMotion = useReducedMotion();
  const resolvedActive = active ?? deriveActive(pathname);

  // (2026-09-03) DOS tabs, siempre, sea quien sea. Antes el admin veia una
  // tercera ("Casa") y eso tenia un costo que no valia la pena: el dueño no
  // podia mirar la app como la mira un jugador sin que le apareciera un
  // acceso que nadie mas tiene. Todo lo de administracion cuelga de /admin,
  // al que se entra desde el perfil.
  void isAdmin;
  const tabs: Tab[] = [TAB_POLLAS, TAB_PERFIL];

  return (
    <nav
      aria-label={t("ariaNav")}
      className="fixed bottom-[calc(14px+env(safe-area-inset-bottom))] left-[14px] right-[14px] z-50 mx-auto h-[64px] max-w-[480px] rounded-full border border-white/[0.12] bg-bg-card/[0.42] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_14px_40px_rgba(0,0,0,0.45)] backdrop-blur-3xl backdrop-saturate-[1.8]"
    >
      <div className="flex h-full">
        {tabs.map((tab) => (
          <TabItem
            key={tab.key}
            tab={tab}
            active={resolvedActive === tab.key}
            badge={tab.key === "pollas" ? pollasPending : 0}
            badgeLabelPrefix={t("ariaToPredict")}
            reduceMotion={reduceMotion}
          />
        ))}
      </div>
    </nav>
  );
}

function TabItem({
  tab,
  active,
  badge = 0,
  badgeLabelPrefix,
  reduceMotion,
}: {
  tab: Tab;
  active: boolean;
  badge?: number;
  badgeLabelPrefix?: string;
  reduceMotion: boolean | null;
}) {
  const t = useTranslations("Nav");
  const { Icon, labelKey, href } = tab;
  const showBadge = badge > 0;

  return (
    <Link
      href={href}
      aria-label={t(labelKey)}
      aria-current={active ? "page" : undefined}
      className={cn(
        "relative flex min-h-[48px] flex-1 items-center justify-center rounded-full",
        "transition-all duration-200 active:scale-90",
        active ? "text-gold" : "text-text-muted hover:text-text-secondary",
      )}
    >
      {active && (
        <motion.span
          aria-hidden="true"
          layoutId="nav-active-lozenge"
          transition={
            reduceMotion
              ? { duration: 0 }
              : { type: "spring", stiffness: 600, damping: 38 }
          }
          className="absolute h-[40px] w-[52px] rounded-full border border-white/[0.08] bg-white/[0.12] shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]"
        />
      )}

      <span className="relative z-10">
        <Icon className="h-[24px] w-[24px]" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
        {showBadge && (
          <span
            className="absolute -right-2 -top-1 min-w-[15px] border-2 border-bg-base bg-gold px-[3px] text-center text-[9px] font-bold leading-[13px] text-bg-base"
            aria-label={`${badge} ${badgeLabelPrefix ?? ""}`}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>

    </Link>
  );
}

export default BottomNav;
