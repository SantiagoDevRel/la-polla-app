// app/api/pollas/join-by-code/route.ts
//
// POST endpoint: authenticated user trades a 6-char code for a
// polla_participants row. Thin HTTP shell over lib/pollas/join.ts —
// the shared helper owns validation, rate limiting, lookup, and the
// insert, so the web API and the WhatsApp bot stay in lockstep.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { joinByCode } from "@/lib/pollas/join";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  // Read body early so an empty or malformed payload returns a clean 400
  // before we hit the DB.
  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Código inválido" }, { status: 400 });
  }
  const codeInput = typeof body.code === "string" ? body.code : "";

  // Fetch the user's phone for rate limiting. The admin client bypasses
  // the known auth.uid() propagation issue on public.users reads.
  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("users")
    .select("whatsapp_number")
    .eq("id", user.id)
    .single();
  const phone = profile?.whatsapp_number ?? user.phone ?? "";
  if (!phone) {
    return NextResponse.json(
      { error: "Tu perfil no tiene número registrado" },
      { status: 400 },
    );
  }

  const result = await joinByCode({
    userId: user.id,
    phone,
    code: codeInput,
  });

  if (result.ok) {
    return NextResponse.json({
      ok: true,
      polla: { slug: result.polla.slug, name: result.polla.name },
    });
  }

  // Map the shared helper's error codes to HTTP statuses + Spanish copy.
  switch (result.code) {
    case "invalid_format":
      return NextResponse.json({ error: "Código inválido" }, { status: 400 });
    case "rate_limited":
      return NextResponse.json(
        {
          error: "Demasiados intentos. Espera 10 minutos.",
          retryAfter: result.retryAfter?.toISOString() ?? null,
        },
        { status: 429 },
      );
    case "not_found":
      return NextResponse.json(
        {
          error:
            "Código inválido o expirado. Pídele al organizador que te comparta el código actualizado.",
        },
        { status: 404 },
      );
    case "not_active":
      return NextResponse.json(
        { error: "Esta polla ya no acepta nuevos jugadores" },
        { status: 400 },
      );
    case "already_member":
      return NextResponse.json(
        { error: "Ya eres parte de esta polla" },
        { status: 409 },
      );
  }
}
