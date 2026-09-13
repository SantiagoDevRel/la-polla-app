// /admin/issues — partidos suspendidos, aplazados, cancelados o abandonados en
// pollas Casa activas. Nada se anula solo: el administrador decide cada caso.

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { listMatchIssues } from "@/lib/casa/match-issues";
import { MatchIssuesReview } from "@/components/casa/MatchIssuesReview";

export const dynamic = "force-dynamic";

export default async function MatchIssuesPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?returnTo=/admin/issues");
  if (!user.is_admin) redirect("/casa");

  const result = await listMatchIssues();

  return <div className="px-4 pb-28 pt-5">
    <Link href="/admin/pollas" className="mb-4 inline-flex min-h-11 items-center gap-2 text-[15px] text-text-secondary transition-colors hover:text-text-primary">
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Administrar pollas
    </Link>
    <h1 className="font-display text-[32px] font-normal uppercase leading-[1.1] tracking-[0.04em] text-text-primary">Issues de partidos</h1>
    <p className="mt-2 mb-5 text-[15px] leading-[1.45] text-text-secondary">Partidos suspendidos, aplazados, cancelados o abandonados en pollas activas. Decide qué pasa con cada uno.</p>
    {result.ok
      ? <MatchIssuesReview open={result.open} inactive={result.inactive} decided={result.decided} openTruncated={result.openTruncated} />
      : <div role="alert" className="rounded-md border border-red-alert/30 p-4">
        <p className="text-[15px] font-semibold leading-[1.45] text-text-primary">No se pudieron cargar los casos</p>
        <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">Actualiza la página para intentarlo de nuevo. Mientras tanto, no liquides pollas con partidos suspendidos o aplazados.</p>
        <Link href="/admin/issues" className="mt-2 inline-flex min-h-11 items-center text-[15px] text-text-secondary underline underline-offset-4 transition-colors hover:text-text-primary">Actualizar</Link>
      </div>}
  </div>;
}
