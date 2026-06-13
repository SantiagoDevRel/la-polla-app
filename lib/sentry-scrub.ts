// lib/sentry-scrub.ts — Scrubbing de PII antes de mandar cualquier evento a
// Sentry. La Polla maneja teléfonos (login por OTP) y datos de usuarios reales
// en Colombia → Habeas Data (Ley 1581). Sentry NUNCA debe recibir teléfonos,
// emails, tokens ni cookies. Esto corre en client + server + edge.
//
// Defense-in-depth: además de `sendDefaultPii: false` en cada Sentry.init
// (que ya evita IP/cookies por default), este beforeSend limpia el contenido
// textual de los eventos (mensajes, stacktraces, URLs, breadcrumbs).
import type { ErrorEvent } from "@sentry/nextjs";

// Teléfonos E.164 / locales: secuencias largas de dígitos con separadores.
// Requiere >=9 dígitos para no pisar IDs cortos o códigos de status.
const PHONE = /(\+?\d[\d\s().-]{7,}\d)/g;
const EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Query params sensibles en URLs (OTP, tokens de Supabase, secrets).
const SENSITIVE_QS =
  /\b(token|access_token|refresh_token|code|otp|password|secret|api[_-]?key)=[^&\s"']+/gi;

function scrubString(input: string): string {
  return input
    .replace(EMAIL, "[email]")
    .replace(SENSITIVE_QS, "$1=[redacted]")
    .replace(PHONE, "[phone]");
}

const SENSITIVE_HEADER = /^(cookie|authorization|x-.*token|.*api[_-]?key|x-hub-signature.*)$/i;

/** Limpia un evento de Sentry de PII in-place y lo devuelve. */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // Usuario: nunca mandar email/username/IP. Conservamos solo un id opaco.
  if (event.user) {
    delete event.user.email;
    delete event.user.username;
    delete event.user.ip_address;
    if (typeof event.user.id === "string") event.user.id = scrubString(event.user.id);
  }

  // Request: dropear cookies y headers sensibles, scrubbear url/query.
  if (event.request) {
    delete event.request.cookies;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADER.test(key)) delete event.request.headers[key];
      }
    }
    if (typeof event.request.url === "string") event.request.url = scrubString(event.request.url);
    if (typeof event.request.query_string === "string") {
      event.request.query_string = scrubString(event.request.query_string);
    }
    if (event.request.data && typeof event.request.data === "string") {
      event.request.data = scrubString(event.request.data);
    }
  }

  if (typeof event.message === "string") event.message = scrubString(event.message);

  if (event.exception?.values) {
    for (const ex of event.exception.values) {
      if (typeof ex.value === "string") ex.value = scrubString(ex.value);
    }
  }

  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (typeof crumb.message === "string") crumb.message = scrubString(crumb.message);
      if (crumb.data) {
        for (const k of Object.keys(crumb.data)) {
          const v = crumb.data[k];
          if (typeof v === "string") crumb.data[k] = scrubString(v);
        }
      }
    }
  }

  return event;
}
