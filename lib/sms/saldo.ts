// lib/sms/saldo.ts — cuántos SMS quedan en LabsMobile y cuánto alcanzan.
//
// Puro (sin fetch ni DB) para poder probarlo. El endpoint
// /api/admin/sms-saldo le pasa los créditos que devuelve LabsMobile y los
// SMS registrados en `sms_entregas` durante los últimos días.
//
// ⚠️ LabsMobile cobra en CRÉDITOS, no en SMS. El número grande del panel web
// son SMS estimados; aquí se hace la misma conversión con el costo medido de
// un SMS estándar (GSM-7, un segmento) a Colombia. Un mensaje con tilde o
// emoji pasa a Unicode y puede ocupar 2–3 segmentos: por eso la cifra es un
// estimado y la pantalla lo dice.

/** Créditos por SMS estándar a Colombia (medido el 2026-08-09). */
export const CREDITOS_POR_SMS_CO = 0.043046;

/** Por debajo de esto el panel se pone en rojo. */
export const SMS_CRITICO = 150;
/** Por debajo de esto el panel avisa en ámbar. */
export const SMS_BAJO = 600;
/** Días de autonomía que disparan cada aviso, si hay consumo medible. */
export const DIAS_CRITICO = 3;
export const DIAS_BAJO = 10;

export type NivelSaldo = "ok" | "bajo" | "critico";

export interface ResumenSaldo {
  creditos: number;
  smsEstimados: number;
  /** SMS por día en la ventana medida; null si no hubo envíos. */
  promedioDiario: number | null;
  /** Días que alcanza el saldo al ritmo actual; null si no hay consumo. */
  diasRestantes: number | null;
  nivel: NivelSaldo;
}

export function resumirSaldo(
  creditos: number,
  enviadosEnVentana: number,
  diasVentana: number,
): ResumenSaldo {
  const credSeguros = Number.isFinite(creditos) && creditos > 0 ? creditos : 0;
  const smsEstimados = Math.floor(credSeguros / CREDITOS_POR_SMS_CO);

  const enviados = Number.isFinite(enviadosEnVentana) && enviadosEnVentana > 0
    ? enviadosEnVentana
    : 0;
  const promedioDiario = enviados > 0 && diasVentana > 0 ? enviados / diasVentana : null;
  const diasRestantes = promedioDiario ? Math.floor(smsEstimados / promedioDiario) : null;

  let nivel: NivelSaldo = "ok";
  if (smsEstimados < SMS_CRITICO || (diasRestantes !== null && diasRestantes < DIAS_CRITICO)) {
    nivel = "critico";
  } else if (smsEstimados < SMS_BAJO || (diasRestantes !== null && diasRestantes < DIAS_BAJO)) {
    nivel = "bajo";
  }

  return {
    creditos: credSeguros,
    smsEstimados,
    promedioDiario: promedioDiario === null ? null : Math.round(promedioDiario * 10) / 10,
    diasRestantes,
    nivel,
  };
}
