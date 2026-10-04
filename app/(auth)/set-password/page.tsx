import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { phonePasswordEnabled } from "@/lib/auth/password-config";
import { safeReturnTo } from "@/lib/auth/safe-return-to";
import PasswordSetup from "@/components/auth/PasswordSetup";
import { hasPhonePassword } from "@/lib/auth/password-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contraseña", robots: { index: false, follow: false } };

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const params = await searchParams;
  const candidate = safeReturnTo(params.returnTo ?? null);
  const returnTo = candidate && !candidate.startsWith("/set-password") ? candidate : "/inicio";
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  if (!phonePasswordEnabled()) redirect(returnTo);
  return <PasswordSetup returnTo={returnTo} manage={returnTo === "/perfil"} hasPassword={await hasPhonePassword(user)} />;
}
