// lib/whatsapp/menu-intent.ts — Detects "show me the menu" intent in
// inbound bot text. Lives outside bot.ts so it can be unit-tested without
// triggering bot.ts's env-var hard-fail check (META_WA_ACCESS_TOKEN etc.)
// at module load.
//
// Returns true when the message looks like a greeting or an explicit
// "show me the menu" request. The list intentionally covers the WhatsApp
// bubble's default pre-text ("Hola parce! muestrame el menu de la polla
// colombia porfa") plus the most common Colombian openers, so users
// rarely fall into the fallback "no entendí bien" branch on their first
// message.

export function looksLikeMenuIntent(body: string): boolean {
  const t = body.trim().toLowerCase();
  if (!t) return false;
  const exactGreetings = new Set([
    "hola", "ola", "hi", "hey", "ey", "ola parce",
    "buenas", "buenas tardes", "buenos dias", "buenos días", "buenas noches",
    "menu", "menú", "inicio", "start",
    "que mas", "qué más", "que mas parce", "qué más parce",
    "parce", "parcero",
  ]);
  if (exactGreetings.has(t)) return true;
  if (/\bmen[uú]\b/.test(t)) return true;
  if (/^(hola|ola|hey|buenas|parce|que\s*m[aá]s|qu[eé]\s*onda)\b/.test(t)) return true;
  if (/(mu[eé]stra(me)?|mostr(a|á)me|d[aá]me)\s+(el\s+)?men[uú]/.test(t)) return true;
  return false;
}
