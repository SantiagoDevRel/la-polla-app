"use client";

// components/admin/SmsSaldoCard.tsx — saldo de SMS (LabsMobile) en /admin.
// Sin créditos no llegan los códigos de acceso: el aviso en ámbar/rojo existe
// para recargar antes de que eso pase.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ExternalLink, MessageSquare, RefreshCw } from "lucide-react";
import { Label, SectionHead } from "@/components/street";
import { cn } from "@/lib/cn";

interface Saldo {
  ok: true;
  cuenta: string | null;
  creditos: number;
  smsEstimados: number;
  promedioDiario: number | null;
  diasRestantes: number | null;
  nivel: "ok" | "bajo" | "critico";
  enviadosVentana: number | null;
  diasVentana: number;
  consultadoEn: string;
}

const RECARGA_URL = "https://websms.labsmobile.com";

const numero = new Intl.NumberFormat("es-CO");
const creditosFmt = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

const ERRORES: Record<string, string> = {
  labsmobile_no_configurado: "Faltan las credenciales de LabsMobile en el servidor.",
  credenciales_invalidas: "LabsMobile rechazó el usuario o el token configurados.",
};

export default function SmsSaldoCard() {
  const [saldo, setSaldo] = useState<Saldo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/sms-saldo", { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setSaldo(null);
        setError(ERRORES[j.error as string] ?? "No se pudo consultar el saldo de LabsMobile.");
        return;
      }
      setSaldo(j as Saldo);
    } catch {
      setSaldo(null);
      setError("Se cayó la conexión. Intenta otra vez.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const alerta = saldo && saldo.nivel !== "ok";

  return (
    <section className="mb-9">
      <SectionHead title="Saldo de SMS" meta="LabsMobile" />

      <div
        className={cn(
          "bg-bg-card p-4",
          saldo?.nivel === "critico" && "border-l-4 border-red-alert",
          saldo?.nivel === "bajo" && "border-l-4 border-amber",
        )}
      >
        {error ? (
          <div role="alert" className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-alert" aria-hidden="true" />
            <p className="text-[15px] text-text-primary">{error}</p>
          </div>
        ) : saldo ? (
          <>
            {alerta ? (
              <p
                role="status"
                className={cn(
                  "mb-4 flex items-start gap-2 text-[15px] font-semibold",
                  saldo.nivel === "critico" ? "text-red-alert" : "text-amber",
                )}
              >
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                {saldo.nivel === "critico"
                  ? "Saldo casi agotado. Recarga ya para no cortar los códigos de acceso."
                  : "El saldo se está acabando. Conviene recargar pronto."}
              </p>
            ) : null}

            <div className="flex items-start gap-4">
              <MessageSquare className="mt-1 h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <Label>SMS disponibles (Colombia)</Label>
                <p className="lp-money mt-1 text-[40px] leading-none text-text-primary">
                  {numero.format(saldo.smsEstimados)}
                </p>
                <p className="mt-2 text-[13px] leading-snug text-text-muted">
                  {creditosFmt.format(saldo.creditos)} créditos. Estimado para mensajes
                  de un solo segmento; con tildes o emojis cada mensaje gasta más.
                </p>
              </div>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-px bg-bg-base/40">
              <div className="bg-bg-card p-3">
                <dt><Label>Enviados en {saldo.diasVentana} días</Label></dt>
                <dd className="lp-money mt-1 text-[24px] text-text-primary">
                  {saldo.enviadosVentana == null ? "—" : numero.format(saldo.enviadosVentana)}
                </dd>
              </div>
              <div className="bg-bg-card p-3">
                <dt><Label>Alcanza para</Label></dt>
                <dd className="lp-money mt-1 text-[24px] text-text-primary">
                  {saldo.diasRestantes == null
                    ? "—"
                    : `${numero.format(saldo.diasRestantes)} ${saldo.diasRestantes === 1 ? "día" : "días"}`}
                </dd>
              </div>
            </dl>
            <p className="mt-2 text-[13px] leading-snug text-text-muted">
              Según los códigos de acceso enviados. Los envíos masivos no se cuentan aquí.
              {saldo.cuenta ? ` Cuenta: ${saldo.cuenta}.` : ""}
            </p>
          </>
        ) : (
          <p className="text-[15px] text-text-muted">Consultando saldo...</p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <a
            href={RECARGA_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn("lp-btn flex-1 gap-2", alerta ? "lp-btn-primary" : "lp-btn-ghost")}
          >
            Recargar en LabsMobile
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
          </a>
          <button
            type="button"
            onClick={cargar}
            disabled={cargando}
            className="lp-btn lp-btn-ghost flex-1 gap-2"
          >
            <RefreshCw className={cn("h-4 w-4 shrink-0", cargando && "animate-spin")} aria-hidden="true" />
            {cargando ? "Consultando..." : "Actualizar"}
          </button>
        </div>
      </div>
    </section>
  );
}
