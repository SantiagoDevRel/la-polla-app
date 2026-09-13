// lib/auth/auth-error-page.ts — Página mínima de error para los enlaces de
// login que se abren desde otra app (WhatsApp, Telegram). Un JSON crudo no le
// sirve a quien tocó un botón: se muestra un mensaje y un botón de vuelta.
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

export function authErrorPage(
  message: string,
  status = 400,
  locale: "es" | "en" = "es",
): NextResponse {
  const c = COPY[locale];
  const html = `<!doctype html>
<html lang="${c.lang}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${c.title}</title>
  <style>
    body { background:#080c10; color:#F5F7FA; font-family:system-ui,sans-serif;
           min-height:100vh; margin:0; display:flex; align-items:center;
           justify-content:center; padding:24px; }
    .card { max-width:380px; text-align:center; background:#0e1420;
            border:1px solid rgba(255,255,255,0.08); border-radius:18px;
            padding:28px; }
    h1 { color:#FFD700; font-size:22px; margin:0 0 12px; }
    p  { color:#AEB7C7; font-size:15px; margin:0 0 18px; line-height:1.45; }
    a  { display:inline-block; background:#FFD700; color:#080c10;
         font-weight:700; padding:12px 22px; border-radius:9999px;
         text-decoration:none; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${c.heading}</h1>
    <p>${escapeHtml(message)}</p>
    <a href="/login">${c.back}</a>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
