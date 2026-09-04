// app/(app)/unirse/[slug]/page.tsx — Backward-compat redirect shim.
//
// The shareable invite landing lives at /invites/polla/[token] now. We keep
// this route alive because older links sent over WhatsApp/email still point
// here. If the old URL carries ?token=X, we bounce to the new canonical
// invite page. Without a token we fall through to the polla detail.
import { redirect } from "next/navigation";

export default async function UnirseLegacyRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const rawToken = (await searchParams).token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  if (token && token.length > 0) {
    redirect(`/invites/polla/${encodeURIComponent(token)}`);
  }
  redirect(`/pollas/${(await params).slug}`);
}
