// lib/auth/auth-error-page.ts — Páginas mínimas para los enlaces de login que
// se abren desde otra app (WhatsApp, Telegram). Un JSON crudo no le sirve a
// quien tocó un botón: se muestra un mensaje y un botón de vuelta.
// HTML autocontenido (sin JS ni recursos externos), nunca cacheable.

import { NextResponse } from "next/server";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const COPY = {
  es: { lang: "es", title: "La Polla · Error", heading: "Algo no anda bien", back: "Volver a /login" },
  en: { lang: "en", title: "Chicken Picks · Error", heading: "Something went wrong", back: "Back to /login" },
} as const;

type Locale = "es" | "en";

function page(locale: Locale, title: string, inner: string): string {
  return `<!doctype html>
<html lang="${COPY[locale].lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex" />
  <meta name="referrer" content="same-origin" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { background:#080c10; color:#F5F7FA; font-family:system-ui,sans-serif;
           min-height:100vh; margin:0; display:flex; align-items:center;
           justify-content:center; padding:24px; box-sizing:border-box; }
    .card { max-width:380px; width:100%; text-align:center; background:#0e1420;
            border:1px solid rgba(255,255,255,0.08); border-radius:18px;
            padding:28px; box-sizing:border-box; }
    h1 { color:#FFD700; font-size:22px; margin:0 0 12px; }
    p  { color:#AEB7C7; font-size:15px; margin:0 0 18px; line-height:1.45;
         overflow-wrap:anywhere; }
    .phone { color:#F5F7FA; font-size:20px; font-weight:700; letter-spacing:0.04em;
             margin:0 0 18px; }
    .warn { color:#FF9F1C; }
    form { margin:0 0 14px; }
    a, button { display:inline-flex; align-items:center; justify-content:center;
         box-sizing:border-box; background:#FFD700; color:#080c10;
         font:inherit; font-size:15px; font-weight:700; padding:12px 22px;
         border:0; border-radius:9999px; text-decoration:none; cursor:pointer;
         min-height:44px; }
    a.secondary { background:transparent; color:#AEB7C7;
                  border:1px solid rgba(255,255,255,0.16); }
  </style>
</head>
<body>
  <div class="card">
${inner}
  </div>
</body>
</html>`;
}

const NO_STORE_HTML = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "Referrer-Policy": "same-origin",
};

export function authErrorPage(
  message: string,
  status = 400,
  locale: Locale = "es",
): NextResponse {
  const c = COPY[locale];
  const inner = `    <h1>${c.heading}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/login">${c.back}</a>`;
  return new NextResponse(page(locale, c.title, inner), {
    status,
    headers: NO_STORE_HTML,
  });
}

export interface AuthConfirmPageInput {
  locale: Locale;
  title: string;
  heading: string;
  /** Párrafo antes del número. */
  lead: string;
  /** Número ya enmascarado ("+57 ••• ••• 4567"). */
  maskedPhone: string;
  /** Advertencias, en orden. */
  warnings: string[];
  /** POST same-origin; los campos viajan ocultos. */
  action: string;
  fields: Record<string, string>;
  submit: string;
  cancel: string;
}

export interface AuthAutoSubmitPageInput {
  locale: Locale;
  title: string;
  heading: string;
  lead: string;
  action: string;
  fields: Record<string, string>;
  submit: string;
}

/**
 * Página que envía sola un POST del mismo origen. Solo para el caso en que el
 * servidor ya comprobó que este navegador es el que pidió el ingreso (cookie
 * propia): no hay nada que confirmar. Sin JS, el botón hace lo mismo.
 */
export function authAutoSubmitPage(input: AuthAutoSubmitPageInput): NextResponse {
  const hidden = Object.entries(input.fields)
    .map(
      ([name, value]) =>
        `      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
    )
    .join("\n");
  const inner = `    <h1>${escapeHtml(input.heading)}</h1>
    <p role="status">${escapeHtml(input.lead)}</p>
    <form id="lp-auto" method="post" action="${escapeHtml(input.action)}">
${hidden}
      <noscript><button type="submit">${escapeHtml(input.submit)}</button></noscript>
    </form>
    <script>document.getElementById("lp-auto").submit();</script>`;
  return new NextResponse(page(input.locale, input.title, inner), {
    status: 200,
    headers: NO_STORE_HTML,
  });
}

/**
 * Confirmación antes de abrir una sesión desde un enlace: muestra a qué número
 * se va a entrar y solo un POST del mismo origen la abre.
 */
export function authConfirmPage(input: AuthConfirmPageInput): NextResponse {
  const hidden = Object.entries(input.fields)
    .map(
      ([name, value]) =>
        `      <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}" />`,
    )
    .join("\n");
  const warnings = input.warnings
    .map((w) => `    <p class="warn">${escapeHtml(w)}</p>`)
    .join("\n");
  const inner = `    <h1>${escapeHtml(input.heading)}</h1>
    <p>${escapeHtml(input.lead)}</p>
    <p class="phone">${escapeHtml(input.maskedPhone)}</p>
${warnings}
    <form method="post" action="${escapeHtml(input.action)}">
${hidden}
      <button type="submit">${escapeHtml(input.submit)}</button>
    </form>
    <a class="secondary" href="/login" rel="noreferrer">${escapeHtml(input.cancel)}</a>`;
  return new NextResponse(page(input.locale, input.title, inner), {
    status: 200,
    headers: NO_STORE_HTML,
  });
}
