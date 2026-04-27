// app/api/_debug/auth-uid/route.ts — DIAGNOSTIC ONLY
// Hit this while logged in. Response tells us where auth.uid() drops.
// Delete this file once the bug is fixed.
//
// Auth: requires a valid Supabase session (returns 403 otherwise). Each
// caller only sees their own diagnostic info — no cross-user leak.
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  const cookieStore = cookies();
  const allCookies = cookieStore.getAll();
  const sbCookies = allCookies
    .filter((c) => c.name.startsWith("sb-"))
    .map((c) => ({
      name: c.name,
      length: c.value.length,
      preview: c.value.slice(0, 24) + "...",
    }));

  const supabase = createClient();
  const admin = createAdminClient();

  // Order matters: getUser first (it's what the codebase always does).
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  const userId = userRes?.user?.id ?? null;

  if (!userId) {
    return NextResponse.json(
      { error: "Login required to run diagnostic" },
      { status: 403 },
    );
  }

  const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
  const sessionInfo = sessionRes?.session
    ? {
        hasAccessToken: !!sessionRes.session.access_token,
        accessTokenLength: sessionRes.session.access_token?.length ?? 0,
        expiresAt: sessionRes.session.expires_at,
        userIdInSession: sessionRes.session.user?.id ?? null,
      }
    : null;

  // The smoking-gun query: if RLS works via auth.uid(), this returns this
  // user's participations. If auth.uid() is NULL, returns 0 rows.
  const { data: rlsRows, error: rlsErr } = await supabase
    .from("polla_participants")
    .select("id, user_id, polla_id");

  // Same query via admin: should return the user's rows scoped manually.
  let adminRowCount: number | null = null;
  let adminErr: string | null = null;
  if (userId) {
    const r = await admin
      .from("polla_participants")
      .select("id, user_id, polla_id")
      .eq("user_id", userId);
    adminRowCount = r.data?.length ?? null;
    adminErr = r.error?.message ?? null;
  }

  // RPC helper to confirm what auth.uid() resolves to inside Postgres.
  // Requires `public.get_my_uid()` SQL function to exist (creation snippet
  // in docs/auth-uid-handoff.md).
  let rpcUid: string | null = null;
  let rpcErr: string | null = null;
  try {
    const r = await supabase.rpc("get_my_uid");
    rpcUid = (r.data as string | null) ?? null;
    rpcErr = r.error?.message ?? null;
  } catch (e) {
    rpcErr = (e as Error).message;
  }

  return NextResponse.json({
    cookies: {
      total: allCookies.length,
      sbCount: sbCookies.length,
      sbCookies,
    },
    getUser: { userId, error: userErr?.message ?? null },
    getSession: { info: sessionInfo, error: sessionErr?.message ?? null },
    rlsQuery: {
      rowCount: rlsRows?.length ?? 0,
      error: rlsErr?.message ?? null,
      sample: rlsRows?.slice(0, 2) ?? [],
    },
    adminQuery: {
      rowCount: adminRowCount,
      error: adminErr,
    },
    postgresAuthUid: {
      uid: rpcUid,
      error: rpcErr,
    },
    diagnosis: {
      cookieReadOk: sbCookies.length > 0,
      sessionLoadOk: !!sessionInfo?.hasAccessToken,
      jwtPropagatesToPg: rpcUid !== null,
      mismatch: userId !== null && rpcUid === null,
    },
  });
}
