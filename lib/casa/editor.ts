// lib/casa/editor.ts — reglas del editor administrativo de pollas Casa (2026-09-14).
//
// Funciones puras que la UI usa para mostrar u ocultar la tuerca y armar el
// envío. La autoridad es SQL (migración 122: casa_polla_edit_block y
// casa_edit_polla_v2): si esta copia y la base difieren, gana la base y la API
// devuelve el mensaje correspondiente.

import { DEFAULT_MAX_ENTRIES_PER_USER, type CasaPolla } from "@/lib/casa/types";

export type EditBlock = "NOT_FOUND" | "ARCHIVED" | "FINAL" | "DRAW" | "CLOSED";

/** Máximo de partidos por polla (mismo tope de la creación y de SQL). */
export const MAX_POLLA_MATCHES = 30;

export const EDIT_BLOCK_MESSAGES: Record<EditBlock, string> = {
  NOT_FOUND: "No existe esta polla.",
  ARCHIVED: "Esta polla está archivada; no se puede editar.",
  FINAL: "Esta polla ya finalizó; no se puede editar.",
  DRAW: "Esta polla tiene un desempate en curso; no se puede editar.",
  CLOSED: "Esta polla ya cerró; no se puede editar.",
};

type BlockFields = Pick<CasaPolla, "status" | "closes_at"> &
  Partial<Pick<CasaPolla, "settled_at" | "settlement_outcome" | "draw_pending">> & {
    archived_at?: string | null;
  };

/** Copia de casa_polla_edit_block: null = se puede editar. */
export function pollaEditBlock(polla: BlockFields | null | undefined, now: Date = new Date()): EditBlock | null {
  if (!polla) return "NOT_FOUND";
  if (polla.archived_at) return "ARCHIVED";
  if (polla.status === "resuelta" || polla.status === "anulada" || polla.settled_at || polla.settlement_outcome) return "FINAL";
  if (polla.draw_pending) return "DRAW";
  if ((polla.status !== "borrador" && polla.status !== "abierta") || !(Date.parse(polla.closes_at) > now.getTime())) {
    return "CLOSED";
  }
  return null;
}

export function canEditPolla(polla: BlockFields | null | undefined, now: Date = new Date()): boolean {
  return pollaEditBlock(polla, now) === null;
}

export function editorHref(pollaId: string): string {
  return `/admin/pollas/${pollaId}/editar`;
}

/** Campos que el editor puede enviar, con los nombres de la API (camelCase). */
export interface EditableFields {
  name: string;
  description: string;
  scoringMode: "1x2" | "marcador";
  entryPriceCop: number;
  houseCutPct: number;
  potMode: "proporcional" | "fijo";
  fixedPrizeCop: number | null;
  prizeObject: string;
  payoutMethod: string;
  payoutAccount: string;
  payoutAccountName: string;
  /** Participaciones por persona (migración 131). */
  maxEntriesPerUser: number;
}

export type EditChanges = Partial<{
  name: string;
  description: string | null;
  scoringMode: "1x2" | "marcador";
  entryPriceCop: number;
  houseCutPct: number;
  potMode: "proporcional" | "fijo";
  fixedPrizeCop: number;
  prizeObject: string;
  payoutMethod: string | null;
  payoutAccount: string | null;
  payoutAccountName: string | null;
  maxEntriesPerUser: number;
}>;

/** Valores del formulario a partir de la fila de la polla. */
export function editableFieldsFromPolla(
  polla: Pick<
    CasaPolla,
    | "name"
    | "description"
    | "scoring_mode"
    | "entry_price_cop"
    | "house_cut_pct"
    | "pot_mode"
    | "fixed_prize_cop"
    | "prize_object"
    | "payout_method"
    | "payout_account"
    | "payout_account_name"
  > & Partial<Pick<CasaPolla, "max_entries_per_user">>,
): EditableFields {
  return {
    name: polla.name,
    description: polla.description ?? "",
    scoringMode: polla.scoring_mode === "marcador" ? "marcador" : "1x2",
    entryPriceCop: polla.entry_price_cop,
    houseCutPct: polla.house_cut_pct,
    potMode: polla.pot_mode === "fijo" ? "fijo" : "proporcional",
    fixedPrizeCop: polla.fixed_prize_cop ?? null,
    prizeObject: polla.prize_object ?? "",
    payoutMethod: polla.payout_method ?? "",
    payoutAccount: polla.payout_account ?? "",
    payoutAccountName: polla.payout_account_name ?? "",
    maxEntriesPerUser: polla.max_entries_per_user ?? DEFAULT_MAX_ENTRIES_PER_USER,
  };
}

const blankToNull = (value: string) => (value.trim() ? value.trim() : null);

/**
 * Solo las claves que cambian. Con inscripciones, las condiciones no se
 * envían nunca (SQL las rechazaría con POLLA_HAS_ENTRIES). Un pozo en objeto
 * no lleva modo de pozo, premio fijo ni porcentaje: SQL los fija.
 */
export function buildEditChanges(
  original: EditableFields,
  draft: EditableFields,
  options: { hasEntries: boolean; kind: CasaPolla["kind"]; prizeKind: CasaPolla["prize_kind"] },
): EditChanges {
  const changes: EditChanges = {};
  if (draft.name.trim() !== original.name.trim()) changes.name = draft.name.trim();
  if (draft.description.trim() !== original.description.trim()) changes.description = blankToNull(draft.description);
  // El tope de participaciones se edita con o sin inscripciones (no en rifas).
  if (options.kind !== "rifa" && draft.maxEntriesPerUser !== original.maxEntriesPerUser) {
    changes.maxEntriesPerUser = draft.maxEntriesPerUser;
  }
  if (options.hasEntries) return changes;

  if (options.kind === "partidos" && draft.scoringMode !== original.scoringMode) changes.scoringMode = draft.scoringMode;
  if (draft.entryPriceCop !== original.entryPriceCop) changes.entryPriceCop = draft.entryPriceCop;
  if (options.prizeKind === "objeto") {
    if (draft.prizeObject.trim() !== original.prizeObject.trim()) changes.prizeObject = draft.prizeObject.trim();
  } else {
    if (draft.houseCutPct !== original.houseCutPct) changes.houseCutPct = draft.houseCutPct;
    if (draft.potMode !== original.potMode) changes.potMode = draft.potMode;
    if (draft.potMode === "fijo" && draft.fixedPrizeCop !== null && draft.fixedPrizeCop !== original.fixedPrizeCop) {
      changes.fixedPrizeCop = draft.fixedPrizeCop;
    }
  }
  if (draft.payoutMethod.trim() !== original.payoutMethod.trim()) changes.payoutMethod = blankToNull(draft.payoutMethod);
  if (draft.payoutAccount.trim() !== original.payoutAccount.trim()) changes.payoutAccount = blankToNull(draft.payoutAccount);
  if (draft.payoutAccountName.trim() !== original.payoutAccountName.trim()) {
    changes.payoutAccountName = blankToNull(draft.payoutAccountName);
  }
  return changes;
}

/** Validación de formulario antes de enviar; SQL vuelve a validar todo. */
export function validateEditDraft(
  draft: EditableFields,
  options: { hasEntries: boolean; prizeKind: CasaPolla["prize_kind"] },
): string | null {
  const name = draft.name.trim();
  if (name.length < 3 || name.length > 80) return "El nombre debe tener entre 3 y 80 caracteres.";
  if (draft.description.trim().length > 400) return "La descripción admite hasta 400 caracteres.";
  if (!Number.isInteger(draft.maxEntriesPerUser) || draft.maxEntriesPerUser < 1 || draft.maxEntriesPerUser > 50) {
    return "Las participaciones por persona deben estar entre 1 y 50.";
  }
  if (options.hasEntries) return null;
  if (!Number.isInteger(draft.entryPriceCop) || draft.entryPriceCop < 0 || draft.entryPriceCop > 10_000_000) {
    return "La entrada debe ser un valor entero entre 0 y 10.000.000.";
  }
  if (options.prizeKind === "objeto") {
    if (draft.prizeObject.trim().length < 3) return "Describe el premio en objeto.";
    return null;
  }
  if (!Number.isInteger(draft.houseCutPct) || draft.houseCutPct < 0 || draft.houseCutPct > 100) {
    return "El porcentaje de la casa debe estar entre 0 y 100.";
  }
  if (draft.potMode === "fijo" && (!draft.fixedPrizeCop || !Number.isInteger(draft.fixedPrizeCop) || draft.fixedPrizeCop < 1)) {
    return "Escribe el premio garantizado.";
  }
  return null;
}

/** Por qué un partido vinculado no se puede quitar; null = se puede. */
export function removeMatchBlock(match: { picks: number }, linkedCount: number): string | null {
  if (match.picks > 0) {
    return match.picks === 1
      ? "Tiene 1 pronóstico en esta polla; no se puede quitar."
      : `Tiene ${match.picks} pronósticos en esta polla; no se puede quitar.`;
  }
  if (linkedCount <= 1) return "La polla necesita al menos un partido.";
  return null;
}

const EDITOR_ERRORS: Record<string, string> = {
  POLLA_HAS_ENTRIES:
    "Esta polla ya tiene inscripciones: el modo de puntaje, la entrada, el premio, la publicación y la cuenta de cobro no cambian.",
  MATCH_HAS_PICKS: "Ese partido ya tiene pronósticos en esta polla; no se puede quitar.",
  MATCH_TOO_SOON: "Solo puedes agregar partidos que no han empezado y a los que les faltan más de 5 minutos.",
  MATCH_LIMIT: `Una polla admite hasta ${MAX_POLLA_MATCHES} partidos.`,
  MATCHES_REQUIRED: "La polla necesita al menos un partido.",
  INVALID_MATCHES: "Revisa los partidos elegidos.",
  INVALID_NAME: "El nombre debe tener entre 3 y 80 caracteres.",
  INVALID_CONFIG: "Revisa los datos de la polla.",
  INVALID_FIXED_PRIZE: "Elige un premio fijo mayor a cero.",
  OBJECT_REQUIRED: "Describe el premio en objeto.",
  PAYMENT_ACCOUNT_REQUIRED: "Una polla abierta con entrada necesita la cuenta de cobro.",
  INVALID_PUBLICATION_DATE: "El primer partido empezaría antes de la publicación programada. Cambia la publicación o los partidos.",
};

/**
 * Mensaje en español para un error del editor. Devuelve null si el código no
 * es propio del editor, para caer en el mapa general de Casa.
 */
export function editorErrorMessage(error: { message?: string; details?: string | null }): string | null {
  if (error.message === "POLLA_NOT_EDITABLE") {
    return EDIT_BLOCK_MESSAGES[(error.details ?? "") as EditBlock] ?? EDIT_BLOCK_MESSAGES.CLOSED;
  }
  return EDITOR_ERRORS[error.message ?? ""] ?? null;
}
