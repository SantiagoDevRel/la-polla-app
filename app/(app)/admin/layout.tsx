// app/(app)/admin/layout.tsx — Server-side guard for all /admin/* routes
// Non-admin users get redirected silently — no client-side bypass possible

import { redirect } from "next/navigation";
import { isCurrentUserAdmin } from "@/lib/auth/admin";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isAdmin = await isCurrentUserAdmin();

  if (!isAdmin) {
    redirect("/inicio");
  }

  return <>{children}</>;
}
