// lib/rifas/partner.ts — rifas hechas con una barra: su escudo en la portada y sus plantillas de historia.
//
// (2026-11-06, pedido del dueño) La rifa solidaria La Iguaná es en colaboración
// con Los Del Sur: el escudo va en la portada y en la tarjeta del inicio, y las
// imágenes para historia son de la barra (La Polla queda en una esquina). Se
// enlaza por uuid (portada) y por slug (la imagen de historia solo recibe el
// slug desde SQL), igual que lib/rifas/benefit.ts. Solo cambia lo que se ve.

export type RifaPartnerKey = "lds";

export interface RifaPartner {
  key: RifaPartnerKey;
  name: string;
  /** Escudo servido tal cual (WebP en su tamaño real, sin next/image). */
  escudo: string;
}

const LDS: RifaPartner = { key: "lds", name: "Los Del Sur", escudo: "/rifas/lds/escudo-128.webp" };

/** Cada entrada lleva el uuid y el slug de la MISMA rifa (tests/rifas-partner.test.ts). */
export const PARTNER_RIFAS: ReadonlyArray<{ id: string; slug: string; partner: RifaPartner }> = [
  { id: "495aa5b1-767c-47bb-8487-15223ab44f63", slug: "rifa-solidaria-la-iguana-camiseta", partner: LDS },
];

export function rifaPartner(rifaId: string): RifaPartner | null {
  return PARTNER_RIFAS.find((p) => p.id === rifaId)?.partner ?? null;
}

export function rifaPartnerBySlug(slug: string): RifaPartner | null {
  return PARTNER_RIFAS.find((p) => p.slug === slug)?.partner ?? null;
}
