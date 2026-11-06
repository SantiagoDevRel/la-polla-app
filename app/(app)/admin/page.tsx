// app/(app)/admin/page.tsx — arma el panel (AdminPanel, cliente) en el servidor.
//
// (2026-11-06) Los borradores privados se leen aquí y van al final del panel:
// salieron del inicio. El layout ya exige administrador; la consulta lo
// vuelve a exigir (listHiddenAdminPollas devuelve [] sin is_admin).
import { redirect } from "next/navigation";
import { AdminDrafts } from "@/components/admin/AdminDrafts";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { listHiddenAdminPollas } from "@/lib/casa/private-draft-query";
import { AdminPanel } from "./AdminPanel";

export default async function AdminPage() {
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) redirect("/");
  const drafts = await listHiddenAdminPollas({ id: user.id, is_admin: true }).catch(() => null);
  return <AdminPanel footer={drafts ? <AdminDrafts pollas={drafts} /> : null} />;
}
