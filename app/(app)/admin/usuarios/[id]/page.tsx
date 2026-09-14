import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import UserReceiptHistory from "@/components/admin/UserReceiptHistory";

export const dynamic = "force-dynamic";

/** Historial de comprobantes de un usuario. El layout de /admin ya exige admin;
 * se repite acá para que la ruta no dependa solo del layout. */
export default async function AdminUserHistoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser();
  if (!user) redirect(`/login?returnTo=/admin`);
  if (!user.is_admin) redirect("/casa");

  return <div className="px-4 pb-28 pt-5">
    <Link href="/admin" className="mb-4 inline-flex min-h-11 items-center gap-2 text-[15px] text-text-secondary transition-colors hover:text-text-primary">
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" /> Administración
    </Link>
    {z.string().uuid().safeParse(id).success
      ? <UserReceiptHistory userId={id} />
      : <div role="alert" className="rounded-md border border-border-default p-4">
          <p className="text-[15px] font-semibold text-text-primary">Usuario no encontrado</p>
          <p className="mt-1 text-[13px] text-text-secondary">El enlace no corresponde a ningún usuario. Búscalo otra vez desde Administración.</p>
        </div>}
  </div>;
}
