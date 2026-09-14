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
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { needsName } from "@/lib/users/needs-name";
import { acceptsCasaMatchPicks, canEditCasaMatch } from "@/lib/casa/match-rules";
import type { CasaPollaStatus } from "@/lib/casa/types";

export const dynamic = "force-dynamic";

async function getNavContext(): Promise<{ isAdmin: boolean; pollasPending: number }> {
  try {
    const supabase = await createClient();
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
  // (2026-09-14) Solo cuentan inscripciones vivas (pagada, o pendiente con
  // comprobante) y partidos que TODAVÍA se pueden pronosticar: un partido que
  // ya empezó sin pronóstico no tiene arreglo y dejaba el aviso prendido para
  // siempre. La regla de edición es la misma de la pantalla (canEditCasaMatch).
  const { data: entries } = await admin
    .from("casa_entries")
    .select("id, polla_id, status, proof_path")
    .eq("user_id", userId) // ← filtro explícito: ver el TODO de auth.uid()
    .in("status", ["pagada", "pendiente"]);

  const vivasEntries = (entries ?? []).filter((e: { status: string; proof_path: string | null }) => e.status === "pagada" || Boolean(e.proof_path)) as { id: string; polla_id: string }[];
  if (vivasEntries.length === 0) return 0;

  const pollaIds = [...new Set(vivasEntries.map((e) => e.polla_id))];
  const { data: pollas } = await admin
    .from("casa_pollas")
    .select("id, status")
    .in("id", pollaIds)
    .eq("kind", "partidos")
    .is("archived_at", null);
  // Un desempate pendiente solo llega con todos los partidos jugados: no deja nada por pronosticar.
  const vivas = new Set((pollas ?? [])
    .filter((p: { status: CasaPollaStatus }) => acceptsCasaMatchPicks(p.status)).map((p: { id: string }) => p.id));
  const entradas = vivasEntries.filter((e) => vivas.has(e.polla_id));
  if (entradas.length === 0) return 0;

  const [{ data: links }, { data: picks }] = await Promise.all([
    admin.from("casa_polla_matches").select("polla_id, match_id, voided_at").in("polla_id", [...vivas]),
    admin.from("casa_picks").select("entry_id, match_id").in("entry_id", entradas.map((e) => e.id)).not("match_id", "is", null),
  ]);
  const matchIds = [...new Set((links ?? []).map((l: { match_id: string }) => l.match_id))];
  if (matchIds.length === 0) return 0;
  const { data: matches } = await admin
    .from("matches")
    .select("id, status, elapsed, scheduled_at, final_verified_at")
    .in("id", matchIds);
  const porId = new Map((matches ?? []).map((m: { id: string }) => [m.id, m]));
  const hechos = new Set((picks ?? []).map((p: { entry_id: string; match_id: string }) => `${p.entry_id}:${p.match_id}`));
  const now = Date.now();

  return entradas.filter((entry) =>
    (links ?? []).some((l: { polla_id: string; match_id: string; voided_at: string | null }) => {
      const match = porId.get(l.match_id) as Parameters<typeof canEditCasaMatch>[0] | undefined;
      return l.polla_id === entry.polla_id && match && canEditCasaMatch({ ...match, voided_at: l.voided_at }, now) && !hechos.has(`${entry.id}:${l.match_id}`);
    }),
  ).length;
}

async function getDisplayName(): Promise<string | null | undefined> {
  try {
    const supabase = await createClient();
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
