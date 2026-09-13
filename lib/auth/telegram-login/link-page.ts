// lib/auth/telegram-login/link-page.ts — Qué muestra la página del enlace de un
// solo uso (/login/telegram). Vive fuera de page.tsx para probarse sola (un
// page.tsx no puede exportar otra cosa que la página y su metadata).
//
// Nunca abre sesión ni quema el enlace: solo lo mira (peek).
//   - enlace vigente + cookie de ESA solicitud → "auto" (envía solo el canje)
//   - enlace vigente sin esa cookie → "confirm" con el número enmascarado
//   - usado, vencido o inválido → estado "gone"; sin token → ?estado=… o "gone"

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TelegramLoginConfig } from "./config";
import { LINK_PAGE_STATES, type LinkPageState } from "./links";
import { maskPhone } from "./messages";
import { peekLoginLink } from "./requests";

export type LinkPageView =
  | { kind: "auto"; token: string }
  | { kind: "confirm"; token: string; maskedPhone: string }
  | { kind: "state"; state: LinkPageState };

export type LinkPageParams = { t?: string | string[]; estado?: string | string[] };

function isState(value: unknown): value is LinkPageState {
  return typeof value === "string" && (LINK_PAGE_STATES as readonly string[]).includes(value);
}

export async function resolveLinkPageView(input: {
  params: LinkPageParams;
  config: Pick<TelegramLoginConfig, "botToken"> | null;
  browserHash: string | null;
  db: () => SupabaseClient;
}): Promise<LinkPageView> {
  const { params, config } = input;
  if (!config) return { kind: "state", state: "unavailable" };

  const token = typeof params.t === "string" ? params.t.trim() : "";
  if (!token) return { kind: "state", state: isState(params.estado) ? params.estado : "gone" };

  const result = await peekLoginLink(input.db(), config, token, input.browserHash);
  if (result.status === "ok") {
    return result.sameBrowser
      ? { kind: "auto", token }
      : { kind: "confirm", token, maskedPhone: maskPhone(result.phoneE164) };
  }
  if (result.status === "error") {
    console.error("[telegram-link] lectura falló");
    return { kind: "state", state: "failed" };
  }
  return { kind: "state", state: "gone" };
}
