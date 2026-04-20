// app/api/webhooks/wompi/route.ts — Recibe eventos de Wompi y aprueba participantes.
//
// Wompi firma los eventos en el cuerpo (no en un header). Docs:
// https://docs.wompi.co/docs/colombia/eventos/
//   body.signature.properties: array de paths tipo "transaction.id"
//   body.signature.checksum:   SHA256( concat(values) + body.timestamp + WOMPI_EVENTS_KEY )
//
// Importante: `timestamp` en el body es un entero (segundos unix).
// WOMPI_INTEGRITY_KEY firma URLs salientes y NO debe usarse acá.
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendWhatsAppMessage } from "@/lib/whatsapp/bot";
import { notifyParticipantJoined } from "@/lib/notifications";
import { generateUniqueJoinCode } from "@/lib/pollas/join-code";

interface WompiTransaction {
  id: string;
  status: string;
  reference: string;
  amount_in_cents: number;
  currency: string;
}

interface WompiSignature {
  properties: string[];
  checksum: string;
}

interface WompiEvent {
  event: string;
  data: { transaction: WompiTransaction };
  timestamp: number;
  signature: WompiSignature;
  environment?: string;
  sent_at?: string;
}

function getValueAtPath(obj: unknown, path: string): string {
  const keys = path.split(".");
  let cur: unknown = obj;
  for (const k of keys) {
    if (cur && typeof cur === "object" && k in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[k];
    } else {
      return "";
    }
  }
  return cur == null ? "" : String(cur);
}

export async function POST(request: NextRequest) {
  const eventsKey = (process.env.WOMPI_EVENTS_KEY ?? "").trim();

  if (!eventsKey) {
    console.error("[wompi] WOMPI_EVENTS_KEY not configured");
    return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();

  let event: WompiEvent;
  try {
    event = JSON.parse(rawBody) as WompiEvent;
  } catch (err) {
    console.error("[wompi] Invalid JSON body", err);
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sig = event.signature;
  if (!sig?.properties || !sig?.checksum || typeof event.timestamp === "undefined") {
    console.error("[wompi] Missing signature block or timestamp");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // Wompi property paths ("transaction.id", "transaction.status", ...) resolve
  // against event.data, NOT the event root.
  const concatenated =
    sig.properties.map((p) => getValueAtPath(event.data, p)).join("") +
    String(event.timestamp) +
    eventsKey;

  const expected = crypto
    .createHash("sha256")
    .update(concatenated)
    .digest("hex");

  // Wompi returns checksum uppercase; normalize both sides to lowercase.
  if (expected.toLowerCase() !== sig.checksum.toLowerCase()) {
    console.error("[wompi] Signature mismatch", {
      expected,
      received: sig.checksum,
      properties: sig.properties,
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (
    event.event === "transaction.updated" &&
    event.data?.transaction?.status === "APPROVED"
  ) {
    const reference = event.data.transaction.reference;
    const adminSupabase = createAdminClient();

    // ── Path A: pay-first polla creation ──
    // References produced by POST /api/pollas for digital_pool pollas look
    // like "draft_<8hex>_<timestamp>". Materialize the polla from polla_drafts.
    if (reference.startsWith("draft_")) {
      const { data: draft } = await adminSupabase
        .from("polla_drafts")
        .select("*")
        .eq("reference", reference)
        .maybeSingle();

      if (!draft) {
        console.warn(`[wompi] Draft not found for reference ${reference}`);
        return NextResponse.json({ ok: true });
      }
      if (draft.completed_polla_slug) {
        console.log(`[wompi] Draft ${reference} already materialized as ${draft.completed_polla_slug}`);
        return NextResponse.json({ ok: true });
      }
      if (new Date(draft.expires_at) < new Date()) {
        console.warn(`[wompi] Draft ${reference} expired before payment landed`);
        return NextResponse.json({ ok: true });
      }

      const data = draft.polla_data as {
        name: string;
        description: string;
        slug: string;
        tournament: string;
        scope: string;
        type: string;
        buy_in_amount: number;
        payment_mode: string;
        admin_payment_instructions: string | null;
        match_ids: string[] | null;
      };

      // Generar el join_code antes del insert. Si no se puede mintear un
      // codigo unico despues de los reintentos internos, abortamos el
      // materializado y dejamos el draft pendiente para inspeccion manual.
      let joinCode: string;
      try {
        joinCode = await generateUniqueJoinCode(adminSupabase);
      } catch (codeErr) {
        console.error("[wompi] generateUniqueJoinCode failed:", codeErr);
        return NextResponse.json({ ok: true });
      }

      // Retry on slug collision, mirroring the non-draft POST logic.
      let finalSlug = data.slug;
      let pollaId: string | null = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const { data: polla, error: insertErr } = await adminSupabase
          .from("pollas")
          .insert({
            name: data.name,
            description: data.description,
            slug: finalSlug,
            tournament: data.tournament,
            scope: data.scope,
            type: data.type,
            buy_in_amount: data.buy_in_amount,
            currency: "COP",
            payment_mode: data.payment_mode,
            admin_payment_instructions: data.admin_payment_instructions,
            match_ids: data.match_ids,
            created_by: draft.creator_id,
            prize_pool: data.buy_in_amount,
            join_code: joinCode,
          })
          .select("id, slug")
          .single();

        if (polla) {
          pollaId = polla.id;
          finalSlug = polla.slug;
          break;
        }
        if (insertErr?.code === "23505" && insertErr.message.includes("slug")) {
          finalSlug = `${data.slug}-${Math.random().toString(36).substring(2, 6)}`;
          continue;
        }
        console.error("[wompi] Polla insert from draft failed:", insertErr);
        return NextResponse.json({ ok: true });
      }

      if (!pollaId) {
        console.error(`[wompi] Could not materialize draft ${reference} after retries`);
        return NextResponse.json({ ok: true });
      }

      // Creator paid the creation fee but NOT the buy-in yet. Insert as admin
      // with pending payment so they retain organizer powers but must pay the
      // buy-in through the normal /unirse/[slug] → Wompi join flow.
      await adminSupabase.from("polla_participants").insert({
        polla_id: pollaId,
        user_id: draft.creator_id,
        role: "admin",
        status: "approved",
        payment_status: "pending",
        paid: false,
      });

      await adminSupabase
        .from("polla_drafts")
        .update({
          completed_polla_slug: finalSlug,
          completed_at: new Date().toISOString(),
        })
        .eq("id", draft.id);

      console.log(`[wompi] Draft ${reference} → polla ${finalSlug}`);

      try {
        const { data: creator } = await adminSupabase
          .from("users")
          .select("whatsapp_number")
          .eq("id", draft.creator_id)
          .single();
        const whatsapp_number = creator?.whatsapp_number;
        if (whatsapp_number) {
          const joinLink = `https://la-polla.vercel.app/unirse/${finalSlug}`;
          const message =
            `Tu polla *${data.name}* fue creada exitosamente.\n\n` +
            `Ahora pagá tu entrada para participar:\n${joinLink}\n\n` +
            `Después de pagar, compartí el link con tus amigos.`;
          console.log("[wompi] Sending WA notification to:", whatsapp_number);
          await sendWhatsAppMessage(whatsapp_number, message);
          console.log("[wompi] WA notification sent");
        } else {
          console.warn(`[wompi] No whatsapp_number on creator ${draft.creator_id}, skipping notification`);
        }
      } catch (waErr) {
        console.error("[wompi] WA notification failed (non-fatal):", waErr);
      }

      return NextResponse.json({ ok: true });
    }

    // ── Path B: existing join-payment flow (reference = "<slug>-<8hex>") ──
    const parts = reference.split("-");
    const userIdPrefix = parts[parts.length - 1];
    const slug = parts.slice(0, -1).join("-");

    const { data: polla } = await adminSupabase
      .from("pollas")
      .select("id, prize_pool, buy_in_amount")
      .eq("slug", slug)
      .single();

    if (!polla) {
      console.warn(`[wompi] No polla found for slug ${slug} (ref ${reference})`);
      return NextResponse.json({ ok: true });
    }

    const { data: participants } = await adminSupabase
      .from("polla_participants")
      .select("id, user_id, payment_status")
      .eq("polla_id", polla.id)
      .eq("payment_status", "pending");

    const participant = participants?.find((p) =>
      p.user_id.replace(/-/g, "").startsWith(userIdPrefix)
    );

    if (participant) {
      await adminSupabase
        .from("polla_participants")
        .update({ payment_status: "approved", paid: true })
        .eq("id", participant.id);

      await adminSupabase
        .from("pollas")
        .update({
          prize_pool: (polla.prize_pool || 0) + (polla.buy_in_amount || 0),
        })
        .eq("id", polla.id);

      console.log(
        `[wompi] Approved payment for polla ${slug} participant ${participant.id}`
      );
      await notifyParticipantJoined(adminSupabase, polla.id, participant.user_id);
    } else {
      console.warn(
        `[wompi] No pending participant found for reference ${reference}`
      );
    }
  }

  // Always 200 — Wompi retries on non-200
  return NextResponse.json({ ok: true });
}
