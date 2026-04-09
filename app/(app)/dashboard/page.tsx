// app/(app)/dashboard/page.tsx — Dashboard principal del usuario autenticado
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import PollaCard from "@/components/polla/PollaCard";

export default async function DashboardPage() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Obtener IDs de pollas donde el usuario es participante
  const { data: participantRows } = await supabase
    .from("polla_participants")
    .select("polla_id")
    .eq("user_id", user.id);

  const pollaIds = participantRows?.map((r) => r.polla_id) || [];

  const { data: pollas } = pollaIds.length > 0
    ? await supabase
        .from("pollas")
        .select("*")
        .in("id", pollaIds)
        .order("created_at", { ascending: false })
        .limit(10)
    : { data: [] };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-colombia-blue text-white p-4 shadow-lg">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">⚽ La Polla</h1>
          <span className="text-colombia-yellow text-sm">
            {user.email || user.phone}
          </span>
        </div>
      </header>

      {/* Contenido */}
      <main className="max-w-lg mx-auto p-4 space-y-6">
        {/* Acciones rápidas */}
        <section className="grid grid-cols-2 gap-3">
          <a
            href="/pollas/crear"
            className="bg-colombia-yellow text-colombia-blue font-bold p-4 rounded-xl text-center hover:bg-yellow-400 transition-colors shadow-md"
          >
            ➕ Crear Polla
          </a>
          <a
            href="/pollas"
            className="bg-white text-colombia-blue font-bold p-4 rounded-xl text-center hover:bg-gray-50 transition-colors shadow-md border border-gray-200"
          >
            🏆 Mis Pollas
          </a>
        </section>

        {/* Pollas recientes */}
        <section>
          <h2 className="text-lg font-bold text-colombia-blue mb-3">
            Tus pollas recientes
          </h2>
          {pollas && pollas.length > 0 ? (
            <div className="space-y-3">
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {pollas.map((polla: any) => (
                <PollaCard key={polla.id} polla={polla} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-xl p-6 text-center shadow-sm">
              <p className="text-gray-500">
                Aún no tenés pollas. ¡Creá una o unite a una existente!
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
