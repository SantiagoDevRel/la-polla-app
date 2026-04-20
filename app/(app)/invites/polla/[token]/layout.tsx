// app/(app)/invites/polla/[token]/layout.tsx — OG meta tags para los
// links abiertos de invitación (polla_invites.token). Refleja el patrón
// usado por /unirse/[slug]/layout.tsx para que WhatsApp, Twitter y otros
// crawlers muestren un preview rico de la polla. La página interna es
// un client component y no puede exportar generateMetadata, por eso el
// metadata vive acá en el layout server-side.
import { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTournamentBySlug } from "@/lib/tournaments";

const APP_URL =
  (process.env.NEXT_PUBLIC_APP_URL ?? "").trim() || "https://la-polla.vercel.app";
const FALLBACK_OG_IMAGE = `${APP_URL}/pollitos/logo_realistic.webp`;

export async function generateMetadata({
  params,
}: {
  params: { token: string };
}): Promise<Metadata> {
  const fallbackTitle = "Unite a una polla en La Polla";
  try {
    const supabase = createAdminClient();
    const { data: polla } = await supabase
      .from("pollas")
      .select("id, name, tournament, buy_in_amount")
      .eq("invite_token", params.token)
      .maybeSingle();

    if (!polla) {
      return {
        title: fallbackTitle,
        openGraph: {
          title: fallbackTitle,
          images: [FALLBACK_OG_IMAGE],
        },
        twitter: { card: "summary_large_image", title: fallbackTitle },
      };
    }

    const { count } = await supabase
      .from("polla_participants")
      .select("*", { count: "exact", head: true })
      .eq("polla_id", polla.id)
      .eq("status", "approved");

    const tournament = getTournamentBySlug(polla.tournament);
    // Construimos un URL absoluto para el logo. El logoPath ya incluye el
    // cache-bust (?v=N) desde lib/tournaments.ts, así que ya sale firmado.
    const ogImage = tournament?.logoPath
      ? `${APP_URL}${tournament.logoPath}`
      : FALLBACK_OG_IMAGE;

    const tournamentLabel = tournament?.name || polla.tournament;
    const buyInLabel =
      polla.buy_in_amount > 0
        ? `$${polla.buy_in_amount.toLocaleString("es-CO")}`
        : "Gratis";

    const title = `Unite a ${polla.name} en La Polla`;
    const description = `Torneo: ${tournamentLabel} · Valor: ${buyInLabel} · ${count || 0} jugadores`;

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: "La Polla",
        images: [{ url: ogImage, alt: tournamentLabel }],
      },
      twitter: {
        card: "summary_large_image",
        title,
        description,
        images: [ogImage],
      },
    };
  } catch {
    return {
      title: fallbackTitle,
      openGraph: {
        title: fallbackTitle,
        images: [FALLBACK_OG_IMAGE],
      },
      twitter: { card: "summary_large_image", title: fallbackTitle },
    };
  }
}

export default function InvitesPollaTokenLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
