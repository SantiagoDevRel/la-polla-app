// lib/auth/user-agent.ts — Parse a User-Agent string into a friendly device
// label for the /avisos login feed. We deliberately avoid pulling a full
// UA-parser dependency because we only need a single short noun that fits
// in "Iniciaste sesión desde {device}".

export function parseDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent) return "dispositivo desconocido";
  const ua = userAgent.toLowerCase();

  if (/iphone/.test(ua)) return "iPhone";
  if (/ipad/.test(ua)) return "iPad";
  if (/ipod/.test(ua)) return "iPod";
  if (/android/.test(ua)) {
    return /mobile/.test(ua) ? "Android" : "Android tablet";
  }
  if (/mac\s?os|macintosh/.test(ua)) return "Mac";
  if (/cros|chromebook/.test(ua)) return "Chromebook";
  if (/windows/.test(ua)) return "Windows";
  if (/linux/.test(ua)) return "Linux";

  return "otro dispositivo";
}
