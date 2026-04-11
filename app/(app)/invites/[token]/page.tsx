// app/(app)/invites/[token]/page.tsx — Accept a polla invite via token
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function AcceptInvitePage({
  params,
}: {
  params: { token: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const admin = createAdminClient();

  // Look up invite
  const { data: invite, error: inviteError } = await admin
    .from("polla_invites")
    .select("id, polla_id, status, expires_at")
    .eq("token", params.token)
    .single();

  if (inviteError || !invite) {
    return <InviteError message="Invitación no encontrada" />;
  }

  if (invite.status !== "pending") {
    return <InviteError message="Esta invitación ya fue usada" />;
  }

  if (new Date(invite.expires_at) < new Date()) {
    return <InviteError message="Esta invitación expiró" />;
  }

  // Get polla slug for redirect
  const { data: polla } = await admin
    .from("pollas")
    .select("slug")
    .eq("id", invite.polla_id)
    .single();

  if (!polla) {
    return <InviteError message="La polla ya no existe" />;
  }

  // Check if user is already a participant
  const { data: existing } = await admin
    .from("polla_participants")
    .select("id")
    .eq("polla_id", invite.polla_id)
    .eq("user_id", user.id)
    .single();

  if (existing) {
    // Already a participant — just redirect
    redirect(`/pollas/${polla.slug}`);
  }

  // Insert participant
  const { error: insertError } = await admin
    .from("polla_participants")
    .insert({
      polla_id: invite.polla_id,
      user_id: user.id,
      role: "player",
      status: "approved",
      paid: false,
    });

  if (insertError) {
    console.error("[invite accept] Error inserting participant:", insertError);
    return <InviteError message="Error al unirse. Intenta de nuevo." />;
  }

  // Mark invite as accepted
  await admin
    .from("polla_invites")
    .update({ status: "accepted" })
    .eq("id", invite.id);

  redirect(`/pollas/${polla.slug}`);
}

function InviteError({ message }: { message: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="rounded-2xl p-8 text-center bg-bg-card border border-border-subtle max-w-sm w-full">
        <p className="text-4xl mb-4">😕</p>
        <h2 className="text-lg font-bold text-text-primary mb-2">
          Invitación inválida
        </h2>
        <p className="text-sm text-text-secondary mb-6">{message}</p>
        <a
          href="/dashboard"
          className="inline-block bg-gold text-bg-base font-semibold py-3 px-6 rounded-xl hover:brightness-110 transition-all"
        >
          Ir al inicio
        </a>
      </div>
    </div>
  );
}
