import { referralLink } from "@/lib/casa/referrals-shared";

/**
 * Enlace público de una polla, con el código de invitación de quien comparte.
 * Siempre el dominio público, incluso desde localhost o un preview; Chicken
 * Picks conserva su dominio cuando la visita viene de allí.
 */
export function pollaShareUrl(slug: string, code: string | null): string {
  const english = ["chickenpicks.app", "www.chickenpicks.app"].includes(window.location.hostname);
  return referralLink(english ? "https://chickenpicks.app" : "https://lapollacolombiana.com", slug, code);
}

/**
 * Comparte únicamente el enlace, incluido su código de invitación o cortesía.
 * Un único campo `url` evita mezclar el destino con texto promocional.
 * Cancelar la hoja nativa nunca modifica el portapapeles.
 */
export async function shareLink(url: string): Promise<"shared" | "copied" | "cancelled"> {
  if (navigator.share) {
    try {
      await navigator.share({ url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  await navigator.clipboard.writeText(url);
  return "copied";
}
