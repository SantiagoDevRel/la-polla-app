import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ColaDePagos } from "@/components/casa/ColaDePagos";

/** Name of the polla a filtered review belongs to. Admin-only, after the check. */
async function filteredPolla(pollaId: string): Promise<{ state: "found"; name: string } | { state: "missing" } | { state: "error" }> {
  if (!z.string().uuid().safeParse(pollaId).success) return { state: "missing" };
  const { data, error } = await createAdminClient().from("casa_pollas").select("name").eq("id", pollaId).maybeSingle();
  if (error) return { state: "error" };
  return data ? { state: "found", name: data.name as string } : { state: "missing" };
}

/** Typography: Bebas 32/1.1 title, 20 section; Outfit 15/1.45 controls,
 * 13/1.5 help. The two destinations wrap evenly at every viewport. */
export async function AdminPaymentReview({ status, pollaId }: { status: "pendiente" | "pagada"; pollaId?: string }) {
  const user = await getAuthenticatedUser();
  const route = status === "pagada" ? "/admin/pollas/pagos" : "/admin/pollas/recibos";
  if (!user) redirect(`/login?returnTo=${route}`);
  if (!user.is_admin) redirect("/casa");
  const polla = pollaId ? await filteredPolla(pollaId) : null;
  const suffix = pollaId && polla?.state !== "missing" ? `?pollaId=${encodeURIComponent(pollaId)}` : "";

  return <div className="px-4 pb-28 pt-5">
    <Link href="/admin/pollas" className="mb-4 inline-flex min-h-11 items-center gap-2 text-[15px] text-text-secondary transition-colors hover:text-text-primary">
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Administrar pollas
    </Link>
    <h1 className="font-display text-[32px] font-normal uppercase leading-[1.1] tracking-[0.04em] text-text-primary">Revisión de pagos</h1>
    {polla?.state === "found" && <p className="mt-2 text-[15px] leading-[1.45] text-text-primary [overflow-wrap:anywhere]">Polla: {polla.name}</p>}
    {polla?.state === "missing" ? <div role="alert" className="mt-5 rounded-md border border-border-default p-4">
      <p className="text-[15px] font-semibold leading-[1.45] text-text-primary">Polla no encontrada</p>
      <p className="mt-1 text-[13px] leading-[1.5] text-text-secondary">El enlace no corresponde a ninguna polla. Revisa los pagos de todas las pollas.</p>
      <Link href={route} className="mt-2 inline-flex min-h-11 items-center text-[15px] text-text-secondary underline underline-offset-4 transition-colors hover:text-text-primary">Ver todas las pollas</Link>
    </div> : <>
      <nav aria-label="Estado de los pagos" className="my-5 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {([{ status: "pendiente", href: "/admin/pollas/recibos", label: "Recibos pendientes" }, { status: "pagada", href: "/admin/pollas/pagos", label: "Pagos aprobados" }] as const).map((item) =>
          <Link key={item.status} href={`${item.href}${suffix}`} aria-current={status === item.status ? "page" : undefined}
            className={`flex min-h-12 min-w-0 items-center justify-center rounded-md border px-3 py-3 text-center text-[15px] font-semibold leading-snug transition-colors hover:border-border-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold ${status === item.status ? "border-border-strong bg-bg-elevated text-text-primary" : "border-border-default text-text-secondary"}`}>
            {item.label}
          </Link>)}
      </nav>
      {pollaId && <Link href={route} className="mb-4 inline-flex min-h-11 items-center text-[15px] text-text-secondary underline underline-offset-4 transition-colors hover:text-text-primary">Ver todas las pollas</Link>}
      <div className="lp-card p-4"><ColaDePagos key={`${status}:${pollaId ?? "all"}`} status={status} pollaId={pollaId} showPollaName /></div>
    </>}
  </div>;
}
