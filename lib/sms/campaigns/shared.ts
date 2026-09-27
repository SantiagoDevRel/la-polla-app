import { necesitaUnicode } from "../labsmobile";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { PAISES_SMS } from "../paises";

export type CampaignPolla = {
  id: string; slug: string; name: string; entry: number; prize: string;
  closesAt: string; game: string;
};
export type AudienceUser = { id: string; name: string; phone: string; country: string };
export type AudienceFilter = {
  countries: string[]; selectedIds: string[] | null;
  excludedPollaIds: string[]; exceptionIds: string[];
};
export type CampaignInput = {
  pollaId: string; template: "opening" | "closing"; days: number;
  message: string; scheduledAt: string | null; audience: AudienceFilter;
};

export function smsSize(message: string) {
  const unicode = necesitaUnicode(message);
  const units = unicode ? message.length : [...message].reduce((n, c) => n + ("^{}\\[~]|€\f".includes(c) ? 2 : 1), 0);
  return { unicode, units, segments: Math.max(1, Math.ceil(units / (units <= (unicode ? 70 : 160) ? (unicode ? 70 : 160) : (unicode ? 67 : 153)))) };
}

/** An explicit editing action, never applied silently to custom copy. */
export function smsPlainText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function campaignTemplate(polla: CampaignPolla, kind: "opening" | "closing", days = 1) {
  const deadline = days === 0 ? "hoy" : days === 1 ? "mañana" : `en ${days} días`;
  return `${kind === "opening" ? `¡Ya está abierta ${polla.name} en La Polla Colombiana!` : `¡${polla.name} se cierra ${deadline}!`}

Entrada: $${polla.entry.toLocaleString("es-CO")} COP

${polla.game} y participa por ${polla.prize}.

Inscríbete aquí:
https://lapollacolombiana.com/polla/${polla.slug}`;
}

export function audienceUser(row: { id: string; display_name: string | null; whatsapp_number: string | null }): AudienceUser | null {
  const phone = parsePhoneNumberFromString(`+${(row.whatsapp_number ?? "").replace(/\D/g, "")}`);
  if (!phone?.isValid() || !phone.country || !(PAISES_SMS as readonly string[]).includes(phone.country)) return null;
  return { id: row.id, name: row.display_name || "Sin nombre", phone: phone.number, country: phone.country };
}

export function selectAudience(users: AudienceUser[], filter: AudienceFilter, excludedMembers: Set<string>, suppressedPhones: Set<string>) {
  const selected = filter.selectedIds === null ? null : new Set(filter.selectedIds);
  const exceptions = new Set(filter.exceptionIds);
  const phones = new Set<string>();
  return users.filter(user => {
    if (!filter.countries.includes(user.country) || (selected && !selected.has(user.id))) return false;
    if (excludedMembers.has(user.id) && !exceptions.has(user.id)) return false;
    if (suppressedPhones.has(user.phone) || phones.has(user.phone)) return false;
    phones.add(user.phone);
    return true;
  });
}

export const CAMPAIGN_STATES: Record<string, string> = {
  ready: "Revisión pendiente", dispatching: "Enviando · no repetir", scheduled: "Programado",
  accepted: "Aceptado por el proveedor", rejected: "Rechazado", unknown: "Pendiente de conciliación · no reenviar",
};
