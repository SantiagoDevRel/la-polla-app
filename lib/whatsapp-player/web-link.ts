// lib/whatsapp-player/web-link.ts — «Entrar a la página web» desde el bot de
// WhatsApp.
//
// Reutiliza el enlace de un solo uso del login por WhatsApp (migración 159,
// /login/whatsapp?t=…): mismo consumo, mismo límite de 5 por hora y número, y
// el token solo existe en la base como hash. El número es el que WhatsApp
// verificó para este chat. Si ese login no está habilitado, el bot manda la
// dirección de la web y la persona entra con su número de celular.

import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { whatsappLoginAllowed, whatsappTokenHash } from "@/lib/auth/whatsapp-login";
import { loginLinkOrigin } from "@/lib/auth/telegram-login/links";
import type { WebLink } from "./handler";

const TTL_MS = 10 * 60_000;

export async function whatsappWebLink(db: SupabaseClient, phone: string): Promise<WebLink> {
  const origin = loginLinkOrigin("es");
  const plain: WebLink = { kind: "plain", url: `${origin}/login` };
  if (!whatsappLoginAllowed(phone)) return plain;
  const token = randomBytes(32).toString("hex");
  const { data, error } = await db.rpc("wa_issue_login_link", {
    p_token_hash: whatsappTokenHash(token),
    p_phone: phone,
    p_expires_at: new Date(Date.now() + TTL_MS).toISOString(),
  });
  if (error) {
    console.warn("[whatsapp-player] enlace a la web no emitido:", error.code);
    return plain;
  }
  if (data === "limited") return { kind: "limited", url: plain.url };
  if (data !== "issued" && data !== "retry") return plain;
  return { kind: "magic", url: `${origin}/login/whatsapp?t=${token}` };
}
