// app/(app)/layout.tsx — Layout para páginas autenticadas
// Fondo bg-base, ToastProvider global, BottomNav mobile, padding inferior
// para la barra. El wrapper max-w-[480px] mx-auto centra una columna
// ancho-móvil en desktop sin afectar mobile. Coincide con el ancho
// máximo del BottomNav para que la nav y el contenido queden alineados.
//
// This layout now pulls the authenticated user's pollito avatar and
// unread notifications count so BottomNav can render a personalized
// FAB and a live Avisos badge. Queries are best-effort — any failure
// falls back to BottomNav defaults (default pollito, zero badge) so the
// nav keeps working even when auth/DB hiccups during dev.
import { redirect } from "next/navigation";
import { ToastProvider } from "@/components/ui/Toast";
import BottomNav from "@/components/nav/BottomNav";
import { AppBackground } from "@/components/layout/AppBackground";
import AnnouncementTicker from "@/components/layout/AnnouncementTicker";
import BrandHeader from "@/components/layout/BrandHeader";
import FontScaleApplier from "@/components/layout/FontScaleApplier";
import SWAutoReload from "@/components/layout/SWAutoReload";
import ScoringSurveyModal from "@/components/polla/ScoringSurveyModal";
import DoublePointsSurveyModal from "@/components/polla/DoublePointsSurveyModal";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPendingPredictionsSummary } from "@/lib/predictions/pending";
import { needsName } from "@/lib/users/needs-name";

export const dynamic = "force-dynamic";

async function getNavContext(): Promise<{ unread: number; pollasPending: number }> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { unread: 0, pollasPending: 0 };
    const admin = createAdminClient();
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);
    // getPendingPredictionsSummary es cache()-ado: si /inicio también
    // lo llama dentro del mismo request, comparten el resultado.
    const pending = await getPendingPredictionsSummary(user.id);
    return { unread: count ?? 0, pollasPending: pending.count };
  } catch {
    return { unread: 0, pollasPending: 0 };
  }
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

  const { unread, pollasPending } = await getNavContext();

  return (
    <ToastProvider>
      <SWAutoReload />
      <ScoringSurveyModal />
      <DoublePointsSurveyModal />
      <FontScaleApplier />
      <AppBackground />
      <div className="relative z-10 pb-[110px] mx-auto max-w-[480px] w-full">
        <BrandHeader />
        {/* Cinta roja de advertencia con marquee: pronósticos hasta 10 min
            antes de cada partido (feedback 2026-06-11). Cerrable con X,
            persiste en localStorage. */}
        <AnnouncementTicker />
        {/* Pequeño respiro entre el header sticky y el contenido de la
            página. Antes el "Hola santi" del inicio (y otros titulares)
            quedaban pegados al header. */}
        <div className="pt-3">{children}</div>
      </div>
      <BottomNav
        createHref="/pollas/crear"
        notifUnread={unread}
        pollasPending={pollasPending}
      />
    </ToastProvider>
  );
}
