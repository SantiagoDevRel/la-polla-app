import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPrivateCampaign } from "@/lib/casa/private-draft-query";
import { PrivateCampaignPreview } from "@/components/casa/PrivateCampaignPreview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vista previa privada", robots: { index: false, follow: false } };

export default async function PrivateCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getAuthenticatedUser();
  if (!actor?.is_admin) notFound();
  const { id } = await params;
  const result = await getPrivateCampaign(id, actor);
  if (!result) notFound();
  return <PrivateCampaignPreview polla={result.polla} slots={result.draft.slots}
    presentation={result.draft.presentation ?? { competitionLabel: "Finales de fútbol", tagline: "El fútbol tiene premio.", prizeCaption: "Un premio para el mayor puntaje", imageAlt: "Foto del premio" }}
    imageUrl={`/api/casa/admin/pollas/${id}/draft-image`} />;
}
