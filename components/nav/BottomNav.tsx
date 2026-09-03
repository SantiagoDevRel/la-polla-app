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
// También cambió la forma: era una píldora de vidrio flotante con blur, que
// es exactamente el lenguaje "burbuja premium" que el skin nuevo dejó atrás.
// Ahora es una barra sólida pegada abajo, con hairline arriba y el tab
// activo marcado por una barra de acento. Bonus: sin blur ni backdrop-filter
// desaparece el bug de WebKit que hacía flotar la barra en medio de la
// pantalla durante el momentum-scroll en iPhone.
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border-default bg-bg-base"
    >
      <div className="mx-auto flex max-w-[480px] safe-bottom">
        {tabs.map((tab) => (
          <TabItem
            key={tab.key}
            tab={tab}
            active={resolvedActive === tab.key}
            badge={tab.key === "pollas" ? pollasPending : 0}
            badgeLabelPrefix={t("ariaToPredict")}
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
}: {
  tab: Tab;
  active: boolean;
  badge?: number;
  badgeLabelPrefix?: string;
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
        "relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1",
        "transition-colors duration-150",
        active ? "text-gold" : "text-text-muted hover:text-text-secondary",
      )}
    >
      {/* Marca del tab activo: una barra de acento arriba. Reemplaza al
          "lozenge" redondeado que se deslizaba — cuadrado y quieto. */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-[2px] bg-gold"
        />
      )}

      <span className="relative">
        <Icon className="h-[22px] w-[22px]" strokeWidth={active ? 2.4 : 2} aria-hidden="true" />
        {showBadge && (
          <span
            className="absolute -right-2 -top-1 min-w-[15px] border-2 border-bg-base bg-gold px-[3px] text-center text-[9px] font-bold leading-[13px] text-bg-base"
            aria-label={`${badge} ${badgeLabelPrefix ?? ""}`}
          >
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>

      {/* Con solo dos o tres destinos, la etiqueta cabe y ahorra que la gente
          adivine qué significa el ícono. El nav anterior las escondía porque
          tenía cinco elementos y no había espacio. */}
      <span className="lp-label text-[9px] leading-none" style={{ color: "inherit" }}>
        {t(labelKey)}
      </span>
    </Link>
  );
}

export default BottomNav;
