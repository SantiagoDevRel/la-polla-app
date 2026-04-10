// app/(app)/unirse/[slug]/layout.tsx — OG meta tags para links de invitacion
import { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

const TRN: Record<string, string> = {
  worldcup_2026: "Mundial 2026",
  champions_2025: "Champions League",
  liga_betplay_2025: "Liga BetPlay",
};

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  try {
    const supabase = createAdminClient();
    const { data: polla } = await supabase
      .from("pollas")
      .select("name, tournament, buy_in_amount")
      .eq("slug", params.slug)
      .single();

    if (!polla) return { title: "Unite a La Polla" };

    const { count } = await supabase
      .from("polla_participants")
      .select("id", { count: "exact", head: true })
      .eq("polla_id", params.slug);

    const trnLabel = TRN[polla.tournament] || polla.tournament;
    const title = `Unite a ${polla.name} en La Polla`;
    const description = `Torneo: ${trnLabel} | Valor: $${polla.buy_in_amount.toLocaleString("es-CO")} | ${count || 0} jugadores`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "La Polla",
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return { title: "Unite a La Polla" };
  }
}

export default function UnirseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
