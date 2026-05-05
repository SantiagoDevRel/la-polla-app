// lib/whatsapp/payment.ts — WhatsApp-native payment method capture.
//
// Triggered after user joins su primera polla con buy-in > 0 (sea
// admin_collects o pay_winner). Le pedimos su método de pago una sola
// vez — se guarda en users.default_payout_* y se reusa para todas las
// pollas futuras. Editable después con el comando "pago".
//
// UX estructurado (no texto libre por defecto): lista de bancos, selecciona
// uno, input numérico. Decisión del user 2026-05-04: free-text genera typos
// tipo "niqui" en vez de "nequi" y rompe matching downstream.

import { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "./bot";
import { sendListMessage } from "./interactive";
import { setState, getState, clearState } from "./state";

const FOOTER = "La Polla Colombiana 🐥";

// Catálogo de métodos de pago. El `id` se guarda en
// users.default_payout_method como slug canónico.
export const PAYMENT_METHODS: { id: string; label: string }[] = [
  { id: "nequi", label: "Nequi" },
  { id: "daviplata", label: "Daviplata" },
  { id: "bancolombia", label: "Bancolombia" },
  { id: "davivienda", label: "Davivienda" },
  { id: "bbva", label: "BBVA" },
  { id: "banco_bogota", label: "Banco de Bogotá" },
  { id: "caja_social", label: "Caja Social" },
  { id: "av_villas", label: "AV Villas" },
  { id: "otro", label: "Otro" },
];

/**
 * Returns true cuando el user todavía no tiene método de pago guardado.
 * Lo usamos como gate después de joinear primera polla con buy-in > 0.
 */
export async function userNeedsPaymentInfo(userId: string): Promise<boolean> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select("default_payout_method, default_payout_account")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return true;
  return !data.default_payout_method || !data.default_payout_account;
}

// ─── Step 1: pedir banco ───

export async function askPaymentMethod(phone: string): Promise<void> {
  await setState(phone, { action: "waiting_payment_method" });

  const rows = PAYMENT_METHODS.map((m) => ({
    id: `paymeth_${m.id}`,
    title: m.label.slice(0, 24),
  }));

  await sendListMessage(
    phone,
    "Si ganas una polla, ¿cómo te transfieren? 💸\n\n" +
      "Esto se guarda una sola vez y lo reusamos para todas las pollas.",
    "Elegir banco",
    [{ title: "💳 Elige tu medio de pago", rows }],
    "💳 Medio de pago",
    FOOTER,
  );
}

// ─── Step 2: usuario seleccionó banco → pedir número/cuenta ───

export async function handlePaymentMethodSelected(
  phone: string,
  methodId: string,
): Promise<void> {
  const method = PAYMENT_METHODS.find((m) => m.id === methodId);
  if (!method) {
    await sendTextMessage(
      phone,
      "No reconocí esa opción parce. Escribe *pago* para empezar de nuevo.",
    );
    await clearState(phone);
    return;
  }

  // Guardamos el método en state.joinCode (reutilizando el campo varchar
  // para no migrar). Lo leemos al recibir el número en el siguiente step.
  await setState(phone, {
    action: "waiting_payment_account",
    joinCode: methodId, // overload: contiene el método elegido
  });

  if (methodId === "otro") {
    await sendTextMessage(
      phone,
      "Mándame los detalles de tu cuenta (banco, tipo, número).\n\n" +
        "Ejemplo: *Bancolombia ahorros 37949312312*",
    );
    return;
  }

  // Para Nequi/Daviplata/etc: pedir solo el número.
  await sendTextMessage(
    phone,
    `Mándame tu número de *${method.label}* (solo números).\n\n` +
      `Ejemplo: *3001234567*`,
  );
}

// ─── Step 3: usuario mandó el número → validar + guardar ───

export async function handlePaymentAccountSubmit(
  phone: string,
  userId: string,
  body: string,
): Promise<void> {
  const state = await getState(phone);
  const methodId = state?.joinCode;
  if (!methodId) {
    // State perdido — re-iniciar.
    await askPaymentMethod(phone);
    return;
  }
  const method = PAYMENT_METHODS.find((m) => m.id === methodId);
  if (!method) {
    await askPaymentMethod(phone);
    return;
  }

  const trimmed = body.trim();

  if (methodId === "otro") {
    // Texto libre — solo validamos longitud razonable.
    if (trimmed.length < 6 || trimmed.length > 120) {
      await sendTextMessage(
        phone,
        "Eso no parece info válida parce. Mandame algo como *Bancolombia ahorros 379...*",
      );
      return;
    }
    await savePayoutInfo(userId, methodId, trimmed, null);
    await clearState(phone);
    await sendTextMessage(
      phone,
      `✅ Listo. Guardé tu info de pago:\n*${trimmed}*\n\n` +
        `_Para cambiarla, escribe_ *pago* _en cualquier momento._`,
    );
    return;
  }

  // Bancos estructurados: solo dígitos, 8-15 chars (cubre Nequi 10,
  // Daviplata 10, cuentas de ahorros 8-13).
  const digits = trimmed.replace(/[\s-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) {
    await sendTextMessage(
      phone,
      `Necesito solo *números*, sin espacios ni letras (entre 8 y 15 dígitos).\n\n` +
        `Mandame tu número de *${method.label}* otra vez.`,
    );
    return;
  }

  await savePayoutInfo(userId, methodId, digits, null);
  await clearState(phone);
  await sendTextMessage(
    phone,
    `✅ Listo parce. Guardé tu *${method.label}* al *${digits}*.\n\n` +
      `_Para cambiarla, escribe_ *pago* _en cualquier momento._`,
  );
}

async function savePayoutInfo(
  userId: string,
  method: string,
  account: string,
  accountName: string | null,
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("users")
    .update({
      default_payout_method: method,
      default_payout_account: account,
      default_payout_account_name: accountName,
      default_payout_set_at: new Date().toISOString(),
    })
    .eq("id", userId);
}

// ─── Comando "pago": ver/cambiar info actual ───

export async function handleShowPaymentInfo(
  phone: string,
  userId: string,
): Promise<void> {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("users")
    .select(
      "default_payout_method, default_payout_account, default_payout_account_name",
    )
    .eq("id", userId)
    .maybeSingle();

  const method = data?.default_payout_method;
  const account = data?.default_payout_account;

  if (!method || !account) {
    await askPaymentMethod(phone);
    return;
  }

  const label =
    PAYMENT_METHODS.find((m) => m.id === method)?.label ?? method;
  const display = method === "otro" ? account : `${label} ${account}`;

  await sendTextMessage(
    phone,
    `💳 *Tu medio de pago actual:*\n\n${display}\n\n` +
      `_Para cambiarlo, escribe_ *cambiar pago*`,
  );
}
