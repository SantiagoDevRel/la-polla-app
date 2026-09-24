import { z } from "zod";

/** This delivery request is only for the existing POLLA REGALO campaign. */
export const QUENTRO_POLLA_ID = "85b88f91-7680-4241-9bf5-b37614cb520b";

export const prizeContactSchema = z.object({
  email: z.string().trim().max(254).email(),
  confirmation: z.string().trim().max(254).email(),
}).strict().refine(({ email, confirmation }) => email === confirmation, {
  message: "Los correos no coinciden.", path: ["confirmation"],
});

export interface PrizeContactData {
  email: string | null;
  winner: boolean;
  editable: boolean;
}

export function isQuentroPolla(polla: { id: string; prize_kind: string }) {
  return polla.id === QUENTRO_POLLA_ID && polla.prize_kind === "objeto";
}
