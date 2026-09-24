import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { getPrivateCampaign } from "@/lib/casa/private-draft-query";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Vista previa privada", robots: { index: false, follow: false } };

export default async function PrivateCampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await getAuthenticatedUser();
  if (!actor?.is_admin) notFound();
  const { id } = await params;
  const result = await getPrivateCampaign(id, actor);
  if (!result) notFound();
  redirect(`/polla/${result.polla.slug}`);
}
