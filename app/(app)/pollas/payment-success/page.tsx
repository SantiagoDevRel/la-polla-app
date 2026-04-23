// app/(app)/pollas/payment-success/page.tsx — Wompi redirect URL.
// Polls /api/pollas/draft-status hasta que el webhook materialice la polla,
// luego redirige a /pollas/[slug]. Si expira o se agota el tiempo de polling,
// avisa al usuario que va a recibir un WhatsApp con el link.
"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import { Info } from "lucide-react";
import FootballLoader from "@/components/ui/FootballLoader";

type Status = "pending" | "completed" | "expired" | "timeout" | "error";

const MAX_ATTEMPTS = 15; // ~30s at 2s interval

function PaymentSuccessInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [state, setState] = useState<Status>("pending");
  const attemptsRef = useRef(0);

  useEffect(() => {
    const fromUrl = searchParams.get("reference");
    const fromSession =
      typeof window !== "undefined"
        ? window.sessionStorage.getItem("pollaDraftReference")
        : null;
    const reference = fromUrl || fromSession;

    if (!reference) {
      setState("error");
      return;
    }

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      attemptsRef.current += 1;

      try {
        const { data } = await axios.get<{ status: string; slug?: string }>(
          `/api/pollas/draft-status?reference=${encodeURIComponent(reference as string)}`
        );

        if (data.status === "completed" && data.slug) {
          if (typeof window !== "undefined") {
            window.sessionStorage.removeItem("pollaDraftReference");
          }
          // Organizer still needs to pay their buy-in — send to /unirse
          router.replace(`/unirse/${data.slug}`);
          return;
        }

        if (data.status === "expired") {
          setState("expired");
          return;
        }
      } catch {
        // transient — keep polling
      }

      if (attemptsRef.current >= MAX_ATTEMPTS) {
        setState("timeout");
        return;
      }

      setTimeout(tick, 2000);
    }

    tick();
    return () => {
      cancelled = true;
    };
  }, [router, searchParams]);

  return (
    <div className="rounded-2xl p-8 text-center max-w-sm w-full lp-card space-y-4">
      {state === "pending" && (
        <>
          <FootballLoader variant="plata" className="mx-auto" />
          <h1 className="text-lg font-bold text-text-primary">Procesando tu pago…</h1>
          <p className="text-sm text-text-secondary leading-snug">
            Confirmando con Wompi y creando tu polla. Esto tarda unos segundos.
          </p>
        </>
      )}

      {state === "timeout" && (
        <>
          <Info className="w-10 h-10 text-gold mx-auto" />
          <h1 className="text-lg font-bold text-text-primary">Tu pago fue procesado</h1>
          <p className="text-sm text-text-secondary leading-snug">
            Recibirás un mensaje de WhatsApp con el link a tu polla apenas la terminemos de crear.
          </p>
          <button
            onClick={() => router.push("/pollas")}
            className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all"
          >
            Ir a mis pollas
          </button>
        </>
      )}

      {state === "expired" && (
        <>
          <Info className="w-10 h-10 text-red-alert mx-auto" />
          <h1 className="text-lg font-bold text-text-primary">El pago expiró</h1>
          <p className="text-sm text-text-secondary leading-snug">
            El tiempo para completar el pago expiró. Por favor creá la polla de nuevo.
          </p>
          <button
            onClick={() => router.push("/pollas/crear")}
            className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all"
          >
            Crear polla
          </button>
        </>
      )}

      {state === "error" && (
        <>
          <Info className="w-10 h-10 text-red-alert mx-auto" />
          <h1 className="text-lg font-bold text-text-primary">No encontramos tu pago</h1>
          <p className="text-sm text-text-secondary leading-snug">
            Si ya pagaste, revisá tu WhatsApp — te enviaremos el link cuando la polla esté lista.
          </p>
          <button
            onClick={() => router.push("/inicio")}
            className="w-full bg-gold text-bg-base font-semibold py-3 rounded-xl hover:brightness-110 transition-all"
          >
            Volver al inicio
          </button>
        </>
      )}
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Suspense
        fallback={
          <div className="rounded-2xl p-8 text-center max-w-sm w-full lp-card">
            <FootballLoader variant="plata" className="mx-auto" />
            <p className="text-sm text-text-secondary mt-3">Cargando…</p>
          </div>
        }
      >
        <PaymentSuccessInner />
      </Suspense>
    </div>
  );
}
