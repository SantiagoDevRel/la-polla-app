// lib/rifas/shared.ts — tipos y formato de las rifas de creadores (migración 157).
//
// Sin dependencias de servidor: lo usan la web (cliente y servidor), las rutas
// y la imagen de historia. Las cifras de dinero NO se calculan acá: vienen de
// SQL (rifa_reserve_v1, rifa_creator_view_v1). Acá solo se escriben bonito.
import { formatColombiaDateTime } from "@/lib/time/colombia";

export type RifaBoardState = "libre" | "reservado" | "pagado";
export type RifaTicketState = "reservado" | "en_revision" | "pagado";
export type RifaPaymentMethod = "nequi" | "bancolombia" | "daviplata" | "otro";
export type RifaVisibility = "privada" | "publica";
export type RifaStatus = "abierta" | "resuelta" | "desierta";
export type RifaProofState = "subiendo" | "en_revision" | "aprobado" | "rechazado";

export interface RifaBoardCell { n: number; s: RifaBoardState; m: boolean }

export interface RifaDraw {
  number: number;
  lottery_name: string;
  draw_at: string;
  outcome: "ganador" | "volver_a_jugar" | "desierta";
  mine?: boolean;
}

export interface RifaPublicView {
  id: string;
  slug: string;
  name: string;
  creator_name: string | null;
  prize_kind: "dinero" | "texto";
  prize_cop: number | null;
  prize_text: string | null;
  has_prize_image: boolean;
  number_count: number;
  price_cop: number;
  lottery_name: string;
  digits_rule: "ultimas_dos" | "primeras_dos";
  draw_at: string;
  visibility: RifaVisibility;
  status: RifaStatus;
  winning_number: number | null;
  hidden: boolean;
  hidden_reason: string | null;
  closed: boolean;
  reservation_minutes: number;
  board: RifaBoardCell[];
  counts: { pagado: number; reservado: number };
  draws: RifaDraw[];
  viewer: {
    signed_in: boolean;
    is_creator: boolean;
    is_admin: boolean;
    can_reserve: boolean;
    reported: boolean;
    pending_amount_cop: number;
    has_payout_account: boolean;
    tickets: Array<{ number: number; state: RifaTicketState; origin: "app" | "fuera"; expires_at: string | null; proof_id: string | null }>;
    proofs: Array<{ id: string; state: RifaProofState; numbers: number[]; amount_cop: number; reject_reason: string | null;
      created_at: string; expires_at: string; content_sha256: string }>;
  };
  payment: { method: RifaPaymentMethod; account: string; holder: string } | null;
}

export interface RifaCreatorTicket {
  id: string;
  number: number;
  state: RifaTicketState;
  origin: "app" | "fuera";
  name: string | null;
  phone: string | null;
  expires_at: string | null;
  proof_id: string | null;
  paid_at: string | null;
}

export interface RifaCreatorProof {
  id: string;
  state: "en_revision" | "aprobado" | "rechazado";
  numbers: number[];
  amount_cop: number;
  submitted_at: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
  buyer_name: string | null;
  buyer_phone: string | null;
}

export interface RifaCreatorView {
  id: string;
  slug: string;
  name: string;
  prize_kind: "dinero" | "texto";
  prize_cop: number | null;
  prize_text: string | null;
  has_prize_image: boolean;
  number_count: number;
  price_cop: number;
  lottery_name: string;
  digits_rule: "ultimas_dos" | "primeras_dos";
  draw_at: string;
  visibility: RifaVisibility;
  status: RifaStatus;
  winning_number: number | null;
  hidden: boolean;
  hidden_reason: string | null;
  closed: boolean;
  payment: { method: RifaPaymentMethod; account: string; holder: string };
  tickets: RifaCreatorTicket[];
  proofs: RifaCreatorProof[];
  summary: { pagado: number; reservado: number; pending_proofs: number; collected_cop: number };
  draws: RifaDraw[];
  winner: {
    number: number; origin: "app" | "fuera"; name: string | null; phone: string | null;
    payout_method: string | null; payout_account: string | null; payout_account_name: string | null; payout_account_type: string | null;
  } | null;
  events: Array<{ kind: string; detail: Record<string, unknown>; created_at: string }>;
}

export interface RifaMyList {
  can_create: boolean;
  created: Array<{ slug: string; name: string; status: RifaStatus; visibility: RifaVisibility; draw_at: string; hidden: boolean;
    number_count: number; paid: number; pending_proofs: number }>;
  bought: Array<{ slug: string; name: string; status: RifaStatus; draw_at: string; winning_number: number | null;
    numbers: Array<{ number: number; state: RifaTicketState }> }>;
  visited: Array<{ slug: string; name: string; status: RifaStatus; draw_at: string; price_cop: number }>;
  listed: Array<{ slug: string; name: string; status: RifaStatus; draw_at: string; price_cop: number }>;
}

/** «lun 13 oct, 8:00 p. m.» en hora de Colombia: cuándo juega la rifa. */
export function drawLabel(iso: string): string {
  return formatColombiaDateTime(iso, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** 7 → «07». Todas las rifas tienen como máximo 100 números: dos cifras. */
export function rifaNumber(n: number): string {
  return String(n).padStart(2, "0");
}

export const RIFA_SLUG_RE = /^[a-z0-9]{8}$/;

/** Sugerencias para «¿Con qué se juega?»; el campo es texto libre. */
export const LOTTERY_SUGGESTIONS = [
  "Lotería de Medellín", "Lotería de Bogotá", "Lotería de Boyacá", "Lotería del Valle", "Lotería de Cundinamarca",
  "Lotería de Santander", "Lotería del Cauca", "Lotería de la Cruz Roja", "Lotería del Huila", "Lotería del Tolima",
  "Lotería del Meta", "Lotería de Manizales", "Lotería del Quindío", "Lotería de Risaralda",
  "Astro Sol", "Astro Luna", "Chontico", "Sinuano", "Paisita", "Culona", "Dorado",
] as const;

export const PAYMENT_METHOD_LABEL: Record<RifaPaymentMethod, string> = {
  nequi: "Nequi", bancolombia: "Bancolombia", daviplata: "Daviplata", otro: "Otro",
};

export const DIGITS_RULE_LABEL = {
  ultimas_dos: "las dos últimas cifras",
  primeras_dos: "las dos primeras cifras",
} as const;

export const RIFA_NUMBER_COUNT_MAX = 100;
export const RIFA_NUMBER_COUNT_MIN = 2;

/** Texto que el creador comparte por WhatsApp (se abre con sus contactos: La Polla no envía nada). */
export function rifaShareText(r: { name: string; price_cop: number; lottery_name: string }, url: string, priceLabel: string): string {
  return `${r.name}\nCada número vale ${priceLabel} y juega con ${r.lottery_name}.\nEscoge el tuyo aquí: ${url}`;
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Enlace para escribirle al ganador desde el WhatsApp del creador. */
export function whatsappChatUrl(phone: string, text: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (!/^[1-9]\d{7,14}$/.test(digits)) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** Celular para mostrar: +57 300 123 4567 (Colombia) o +<dígitos>. */
export function displayPhone(phone: string | null): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("57")) return `+57 ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  return `+${digits}`;
}

/**
 * Plantillas de la imagen de historia. Siempre con la marca La Polla. Los
 * colores de club salen de las camisetas del catálogo de pollitos
 * (docs/pollito-clubes.md): no se inventan camisetas ni se usan escudos.
 */
export const STORY_TEMPLATES = ["neutra", "club"] as const;
export type StoryTemplate = (typeof STORY_TEMPLATES)[number];

export interface StoryClub { key: string; label: string; primary: string; secondary: string; ink: string }

export const STORY_CLUBS: StoryClub[] = [
  { key: "verde", label: "Atlético Nacional", primary: "#0B7A3B", secondary: "#FFFFFF", ink: "#FFFFFF" },
  { key: "dim", label: "Independiente Medellín", primary: "#C8102E", secondary: "#123A8C", ink: "#FFFFFF" },
  { key: "millos", label: "Millonarios", primary: "#123A8C", secondary: "#FFFFFF", ink: "#FFFFFF" },
  { key: "capitan", label: "América de Cali", primary: "#C8102E", secondary: "#FFFFFF", ink: "#FFFFFF" },
  { key: "rolo", label: "Santa Fe", primary: "#B5121B", secondary: "#FFFFFF", ink: "#FFFFFF" },
  { key: "costeno", label: "Junior", primary: "#D0102C", secondary: "#FFFFFF", ink: "#FFFFFF" },
  { key: "gambeteador", label: "Deportivo Cali", primary: "#0E6B34", secondary: "#FFFFFF", ink: "#FFFFFF" },
  { key: "goleador", label: "Deportes Tolima", primary: "#6E1423", secondary: "#E6B800", ink: "#FFFFFF" },
  { key: "arbitro", label: "Once Caldas", primary: "#F2F2F2", secondary: "#1A1A1A", ink: "#111111" },
  { key: "negro", label: "Deportivo Pereira", primary: "#F2C200", secondary: "#C8102E", ink: "#111111" },
  { key: "arquero", label: "Atlético Bucaramanga", primary: "#F2C200", secondary: "#0E6B34", ink: "#111111" },
  { key: "pasto", label: "Deportivo Pasto", primary: "#C8102E", secondary: "#123A8C", ink: "#FFFFFF" },
  { key: "tigre", label: "Cúcuta Deportivo", primary: "#C8102E", secondary: "#111111", ink: "#FFFFFF" },
  { key: "pibe", label: "Unión Magdalena", primary: "#123A8C", secondary: "#C8102E", ink: "#FFFFFF" },
  { key: "rasta", label: "Real Cartagena", primary: "#F2C200", secondary: "#0E6B34", ink: "#111111" },
  { key: "paisa", label: "Atlético Huila", primary: "#F2C200", secondary: "#0E6B34", ink: "#111111" },
  { key: "envigado", label: "Envigado", primary: "#F07F13", secondary: "#0E6B34", ink: "#111111" },
  { key: "chico", label: "Boyacá Chicó", primary: "#F2F2F2", secondary: "#111111", ink: "#111111" },
  { key: "equidad", label: "La Equidad", primary: "#F2F2F2", secondary: "#0E6B34", ink: "#111111" },
  { key: "aguilas", label: "Águilas Doradas", primary: "#C9A227", secondary: "#111111", ink: "#111111" },
];

export function storyClub(key: string | null | undefined): StoryClub {
  return STORY_CLUBS.find((c) => c.key === key) ?? STORY_CLUBS[0];
}
