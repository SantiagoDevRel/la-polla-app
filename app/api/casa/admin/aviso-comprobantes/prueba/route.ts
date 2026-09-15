// app/api/casa/admin/aviso-comprobantes/prueba/route.ts — manda un aviso
// (TEST) a los administradores de CASA_PROOF_WATCHER_USER_IDS para comprobar
// que el aviso de comprobantes les llega por Telegram. `?copia=1` le manda
// además una copia al admin que hace la prueba; `?copia=solo`, solo a él
// (ver cómo se ve sin volver a escribirles a los destinatarios). Solo
// admins; no toca inscripciones ni pagos.

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthenticatedUser } from "@/lib/auth/admin";
import { notifyProofWatchers, proofWatcherUserIds } from "@/lib/telegram-player/proof-watchers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const headers = { "Cache-Control": "private, no-store" };
  const user = await getAuthenticatedUser();
  if (!user?.is_admin) {
    return NextResponse.json({ error: "Solo el admin." }, { status: 403, headers });
  }
  const copia = req.nextUrl.searchParams.get("copia");
  const sent = await notifyProofWatchers(createAdminClient(), {
    test: true,
    pollaName: "Polla de prueba",
    userName: "Jugador de prueba",
    amountCop: 20000,
    ticketNumber: null,
    entryNumber: null,
  }, {
    extraUserIds: copia === "1" || copia === "solo" ? [user.id] : [],
    onlyExtra: copia === "solo",
  });
  return NextResponse.json({ configured: proofWatcherUserIds().length, sent }, { headers });
}
