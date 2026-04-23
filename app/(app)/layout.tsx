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
import { ToastProvider } from "@/components/ui/Toast";
import BottomNav from "@/components/nav/BottomNav";
import { AppBackground } from "@/components/layout/AppBackground";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

async function getNavContext(): Promise<{ unread: number }> {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { unread: 0 };
    const admin = createAdminClient();
    const { count } = await admin
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);
    return { unread: count ?? 0 };
  } catch {
    return { unread: 0 };
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { unread } = await getNavContext();

  return (
    <ToastProvider>
      <AppBackground />
      <div className="relative z-10 pb-[110px] mx-auto max-w-[480px] w-full">
        {children}
      </div>
      <BottomNav createHref="/pollas/crear" notifUnread={unread} />
    </ToastProvider>
  );
}
