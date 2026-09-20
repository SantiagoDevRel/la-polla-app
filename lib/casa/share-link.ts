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
