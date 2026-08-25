// app/(app)/layout.tsx — Layout para páginas autenticadas
// Fondo bg-base, ToastProvider global, BottomNav mobile, padding inferior
// para la barra. El wrapper max-w-[480px] mx-auto centra una columna
// ancho-móvil en desktop sin afectar mobile. Coincide con el ancho
// máximo del BottomNav para que la nav y el contenido queden alineados.
//
// (2026-08-25) El shell se adelgazó junto con la app. Ya no hay FAB de
// crear polla ni badge de avisos: en la casa centralizada lo único que el
// usuario tiene pendiente es marcar los partidos de una polla que ya pagó.
// El layout resuelve dos cosas para el nav — si sos admin (para mostrar el
// tab de armar pollas) y cuántas pollas te falta marcar — y las dos son
// best-effort: si la consulta falla, el nav igual funciona.
import { redirect } from "next/navigation";
import { ToastProvider } from "@/components/ui/Toast";
import BottomNav from "@/components/nav/BottomNav";
import { AppBackground } from "@/components/layout/AppBackground";
import AnnouncementTicker from "@/components/layout/AnnouncementTicker";
import BrandHeader from "@/components/layout/BrandHeader";
import FontScaleApplier from "@/components/layout/FontScaleApplier";
import SWAutoReload from "@/components/layout/SWAutoReload";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { needsName } from "@/lib/users/needs-name";

export const dynamic = "force-dynamic";

async function getNavContext(): Promise<{ isAdmin: boolean; pollasPending: number }> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { isAdmin: false, pollasPending: 0 };

    const admin = createAdminClient();

    // ¿Es admin? La autorización es la columna users.is_admin, nunca el
    // teléfono. Acá solo decide si se DIBUJA el tab; cada ruta de admin
    // vuelve a verificar del lado del server.
    const { data: perfil } = await admin
      .from("users")
      .select("is_admin")
      .eq("id", user.id)
      .maybeSingle();

    // Cuántas pollas de la casa tienen partidos sin marcar. Se cuenta sobre
    // casa_entries/casa_picks (el modelo nuevo), no sobre el P2P viejo.
    const pollasPending = await contarPendientes(admin, user.id);

    return { isAdmin: perfil?.is_admin === true, pollasPending };
  } catch {
    return { isAdmin: false, pollasPending: 0 };
  }
}

/**
 * Pollas abiertas donde ya pagaste (o estás esperando aprobación) pero te
 * faltan partidos por marcar. Es el único "tenés algo que hacer" que existe
 * en este producto.
 */
async function contarPendientes(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<number> {
  const { data: entries } = await admin
    .from("casa_entries")
    .select("id, polla_id")
    .eq("user_id", userId) // ← filtro explícito: ver el TODO de auth.uid()
    .in("status", ["pagada", "pendiente"]);

  if (!entries || entries.length === 0) return 0;

  const pollaIds = entries.map((e: { polla_id: string }) => e.polla_id);

  const { data: abiertas } = await admin
    .from("casa_pollas")
    .select("id")
    .in("id", pollaIds)
    .eq("status", "abierta")
    .gt("closes_at", new Date().toISOString());

  if (!abiertas || abiertas.length === 0) return 0;
  const vivas = new Set(abiertas.map((p: { id: string }) => p.id));

  let pendientes = 0;
  for (const entry of entries as { id: string; polla_id: string }[]) {
    if (!vivas.has(entry.polla_id)) continue;

    const [{ count: total }, { count: hechos }] = await Promise.all([
      admin
        .from("casa_polla_matches")
        .select("match_id", { count: "exact", head: true })
        .eq("polla_id", entry.polla_id),
      admin
        .from("casa_picks")
        .select("id", { count: "exact", head: true })
        .eq("entry_id", entry.id),
    ]);

    if ((total ?? 0) > (hechos ?? 0)) pendientes += 1;
  }
  return pendientes;
}

async function getDisplayName(): Promise<string | null | undefined> {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return undefined; // no auth → la pagina de login se encarga
    const admin = createAdminClient();
    const { data } = await admin
      .from("users")
      .select("display_name")
      .eq("id", user.id)
      .maybeSingle();
    return data?.display_name ?? null;
  } catch {
    return undefined;
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gate de onboarding: si el viewer esta autenticado pero su display_name
  // todavia es NULL o phone-shaped (cuenta creada por bot/web sin nombre),
  // forzar /onboarding antes de dejarlo ver cualquier ruta autenticada.
  // Esto evita que aparezcan usuarios "573114685089" en pollas.
  const dn = await getDisplayName();
  if (dn !== undefined && needsName(dn)) {
    redirect("/onboarding");
  }

  const { isAdmin, pollasPending } = await getNavContext();

  return (
    <ToastProvider>
      <SWAutoReload />
      {/* Los dos popups de encuesta (ScoringSurveyModal y
          DoublePointsSurveyModal) SE DESMONTARON de acá (2026-08-25).
          Estaban globales en el shell, o sea que aparecían encima de /casa
          preguntando por cosas que en este producto no existen: cambiar la
          escala 5/3/2/1 por goles_v2, y duplicar puntos desde octavos de
          final. Son experimentos de puntaje POR POLLA de la etapa Mundial, y
          en la casa el puntaje lo fija Tama al armar cada polla. Los
          componentes y sus endpoints siguen en el repo por si alguna vez se
          quiere volver a encuestar algo. */}
      <FontScaleApplier />
      <AppBackground />
      <div className="relative z-10 pb-[110px] mx-auto max-w-[480px] w-full">
        <BrandHeader />
        {/* La cinta del alargue vuelve a aplicar: hay partidos reales otra
            vez y el puntaje de la casa se calcula con el marcador de los 90
            minutos (REGLA #4). El SeasonClosedBanner NO se usa más acá — su
            copy anuncia que la app se despide, que dejó de ser cierto
            cuando el producto se relanzó como la casa. El componente sigue
            existiendo por si alguna vez hay que cerrar de verdad. */}
        <AnnouncementTicker
          messageKey="ninetyMinutes"
          dismissKey="lp_ticker_dismissed:results-90min"
        />
        {/* Pequeño respiro entre el header sticky y el contenido de la
            página. Antes el "Hola santi" del inicio (y otros titulares)
            quedaban pegados al header. */}
        <div className="pt-3">{children}</div>
      </div>
      <BottomNav isAdmin={isAdmin} pollasPending={pollasPending} />
    </ToastProvider>
  );
}
