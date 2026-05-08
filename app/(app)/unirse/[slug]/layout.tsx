// app/(app)/unirse/[slug]/layout.tsx — OG meta tags para links de invitacion
import { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getTournamentName } from "@/lib/tournaments";

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const t = await getTranslations("Invites");
  const locale = await getLocale();
  const intlTag = locale === "en" ? "en-US" : "es-CO";
  try {
    const supabase = createAdminClient();
    const { data: polla } = await supabase
      .from("pollas")
      .select("id, name, tournament, buy_in_amount")
      .eq("slug", params.slug)
      .single();

    if (!polla) return { title: t("ogFallback") };

    const { count } = await supabase
      .from("polla_participants")
      .select("*", { count: "exact", head: true })
      .eq("polla_id", polla.id)
      .eq("status", "approved");

    const trnLabel = getTournamentName(polla.tournament) ?? polla.tournament;
    const title = t("ogTitle", { name: polla.name });
    const description = t("ogDescription", {
      tournament: trnLabel,
      amount: `$${polla.buy_in_amount.toLocaleString(intlTag)}`,
      count: count ?? 0,
    });

    return {
      title,
      description,
      openGraph: {
        title,
        description,
        type: "website",
        siteName: t("ogSiteName"),
      },
      twitter: {
        card: "summary",
        title,
        description,
      },
    };
  } catch {
    return { title: t("ogFallback") };
  }
}

export default function UnirseLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
