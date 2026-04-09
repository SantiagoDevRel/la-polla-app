// app/(app)/pollas/[slug]/page.tsx — Página de detalle de una polla específica
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import MatchPredictionCard from "@/components/polla/MatchPredictionCard";

interface Props {
  params: { slug: string };
}

export default async function PollaDetailPage({ params }: Props) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: polla } = await supabase
    .from("pollas")
    .select("*")
    .eq("slug", params.slug)
    .single();

  if (!polla) notFound();

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-colombia-blue text-white p-4 shadow-lg">
        <div className="max-w-lg mx-auto">
          <a href="/dashboard" className="text-colombia-yellow text-sm">← Volver</a>
          <h1 className="text-xl font-bold mt-1">{polla.name}</h1>
          {polla.description && (
            <p className="text-blue-200 text-sm mt-1">{polla.description}</p>
          )}
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-4">
        {/* Info de la polla */}
        <div className="bg-white rounded-xl shadow-sm p-4 grid grid-cols-3 gap-2 text-center">
          <div>
            <p className="text-2xl font-bold text-colombia-blue">
              {polla.participants?.length || 0}
            </p>
            <p className="text-xs text-gray-500">Participantes</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-colombia-yellow">
              ${(polla.entry_fee || 0).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Entrada</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-colombia-red">
              ${((polla.entry_fee || 0) * (polla.participants?.length || 0)).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Pozo total</p>
          </div>
        </div>

        {/* Partidos para pronosticar */}
        <section>
          <h2 className="text-lg font-bold text-colombia-blue mb-3">
            Próximos partidos
          </h2>
          <div className="space-y-3">
            <MatchPredictionCard
              matchId={0}
              homeTeam="Equipo Local"
              awayTeam="Equipo Visitante"
              date="Por definir"
            />
          </div>
        </section>

        {/* Tabla de posiciones */}
        <section>
          <h2 className="text-lg font-bold text-colombia-blue mb-3">
            Tabla de posiciones
          </h2>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <p className="text-gray-500 text-center text-sm">
              La tabla se actualizará cuando se registren pronósticos
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
