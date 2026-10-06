import { requestJson, type JsonRequestResult } from "@/lib/http/json-request";
import { PAYOUT_METHODS, type PayoutMethodId } from "@/lib/payout/account-format";

export interface PersistedProfile {
  id: string;
  profile_revision: number;
  display_name: string | null;
  whatsapp_number: string | null;
  avatar_url: string | null;
  is_admin: boolean;
  default_payout_method: PayoutMethodId | null;
  default_payout_account: string | null;
  default_payout_account_name: string | null;
  default_payout_account_type: "ahorros" | "corriente" | null;
}

export type ProfilePatch = Partial<Pick<PersistedProfile,
  "display_name" | "avatar_url" | "default_payout_method" | "default_payout_account" |
  "default_payout_account_name" | "default_payout_account_type"
>>;
export interface PendingProfileMutation {
  patch: ProfilePatch;
  ownerId: string;
  baselineRevision: number;
}
export type ProfileMutationResult = JsonRequestResult<PersistedProfile> & {
  pending?: PendingProfileMutation;
  latestProfile?: PersistedProfile;
};

const nullableString = (value: unknown): value is string | null => value === null || typeof value === "string";

export function isPersistedProfile(value: unknown): value is PersistedProfile {
  if (!value || typeof value !== "object") return false;
  const profile = value as Record<string, unknown>;
  return typeof profile.id === "string" && profile.id.length > 0 && Number.isSafeInteger(profile.profile_revision) &&
    (profile.profile_revision as number) >= 0 && nullableString(profile.display_name) && nullableString(profile.whatsapp_number) &&
    nullableString(profile.avatar_url) && typeof profile.is_admin === "boolean" &&
    (profile.default_payout_method === null || PAYOUT_METHODS.includes(profile.default_payout_method as PayoutMethodId)) &&
    nullableString(profile.default_payout_account) && nullableString(profile.default_payout_account_name) &&
    [null, "ahorros", "corriente"].includes(profile.default_payout_account_type as string | null);
}

function hasProfile(value: unknown): value is { profile: PersistedProfile } {
  return !!value && typeof value === "object" && "profile" in value && isPersistedProfile(value.profile);
}

function normalizedPatch(patch: ProfilePatch): ProfilePatch {
  const expected = { ...patch };
  for (const field of ["display_name", "default_payout_account", "default_payout_account_name"] as const) {
    if (typeof expected[field] === "string") expected[field] = expected[field]!.trim();
  }
  if ("default_payout_method" in expected || "default_payout_account" in expected ||
      "default_payout_account_name" in expected || "default_payout_account_type" in expected) {
    expected.default_payout_method ??= null;
    expected.default_payout_account ??= null;
    expected.default_payout_account_name = expected.default_payout_method === "bancolombia"
      ? expected.default_payout_account_name ?? null : null;
    expected.default_payout_account_type = expected.default_payout_method === "bancolombia"
      ? expected.default_payout_account_type ?? null : null;
  }
  return expected;
}

function matchesPatch(profile: PersistedProfile, expected: ProfilePatch): boolean {
  return Object.entries(expected).every(([field, value]) => profile[field as keyof ProfilePatch] === value);
}

export async function loadProfile(ownerId?: string): Promise<JsonRequestResult<PersistedProfile>> {
  const response = await requestJson("/api/users/me", { method: "GET" }, hasProfile);
  if (response.ok && ownerId && response.data.profile.id !== ownerId) {
    return { ok: false, kind: "rejected", status: 412, code: "SESSION_CHANGED", error: "Cambiaste de cuenta. Revisa tu perfil y vuelve a la cuenta original para confirmar tus cambios." };
  }
  return response.ok ? { ok: true, data: response.data.profile } : response;
}

/** Read back only. A missing acknowledgement must never cause an automatic PATCH retry. */
export async function confirmProfilePatch(pending: PendingProfileMutation): Promise<ProfileMutationResult> {
  const response = await loadProfile(pending.ownerId);
  if (!response.ok && (response.kind === "auth" || response.code === "SESSION_CHANGED")) return { ...response, pending };
  if (response.ok && response.data.profile_revision > pending.baselineRevision && matchesPatch(response.data, pending.patch)) return response;
  if (response.ok && response.data.profile_revision > pending.baselineRevision) {
    // The monotonic revision makes the old conditional UPDATE unable to commit later.
    return { ok: false, kind: "rejected", status: 409, code: "PROFILE_CHANGED", latestProfile: response.data,
      error: "Tu perfil cambió después de este envío. Conservamos tu edición; revisa los datos antes de guardar de nuevo." };
  }
  return {
    ok: false, kind: "uncertain", pending, ...(response.ok ? { latestProfile: response.data } : {}),
    error: "No pudimos confirmar el guardado. Conservamos tus cambios; reintenta para comprobarlos.",
  };
}

async function sendProfileMutation(pending: PendingProfileMutation, previouslyUncertain = false): Promise<ProfileMutationResult> {
  const { patch: expected, ownerId } = pending;
  const response = await requestJson("/api/users/me", {
    method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...expected, expected_user_id: ownerId, expected_revision: pending.baselineRevision }),
  }, (value): value is { success: true; profile: PersistedProfile } =>
    hasProfile(value) && value.profile.id === ownerId && value.profile.profile_revision > pending.baselineRevision &&
    "success" in value && value.success === true && matchesPatch(value.profile, expected));
  if (response.ok) return { ok: true, data: response.data.profile };
  if (response.status === 409 && response.code === "PROFILE_CHANGED") {
    const confirmation = await confirmProfilePatch(pending);
    if (confirmation.ok || (confirmation.latestProfile && confirmation.latestProfile.profile_revision > pending.baselineRevision)) return confirmation;
    // The conditional UPDATE was rejected. A fresh read failure cannot turn that into success.
    return { ...response, error: "Tu perfil cambió mientras guardabas. Conservamos tu edición; vuelve a comprobar tus datos antes de guardar." };
  }
  if (response.kind !== "uncertain") return previouslyUncertain ? { ...response, pending } : response;
  return confirmProfilePatch(pending);
}

/** Called only by an explicit retry action: replay the same owner, fields and revision. */
export async function retryProfilePatch(pending: PendingProfileMutation): Promise<ProfileMutationResult> {
  const confirmation = await confirmProfilePatch(pending);
  if (confirmation.ok || confirmation.kind !== "uncertain" || !confirmation.latestProfile ||
      confirmation.latestProfile.profile_revision !== pending.baselineRevision) return confirmation;
  // Whichever request wins advances the revision and fences out the other request.
  return sendProfileMutation(pending, true);
}

export async function saveProfilePatch(patch: ProfilePatch, ownerId: string): Promise<ProfileMutationResult> {
  const expected = normalizedPatch(patch);
  const current = await loadProfile(ownerId);
  if (!current.ok) return current;
  if (matchesPatch(current.data, expected)) return current;
  return sendProfileMutation({ patch: expected, ownerId, baselineRevision: current.data.profile_revision });
}
