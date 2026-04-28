// app/(app)/preview/payouts/page.tsx — DEV PREVIEW (no DB).
// Renderiza los 4 escenarios del flow de pago al ganador con state
// local. Sin migration, sin endpoints — solo para que el dueño vea
// cómo lucirían los componentes y nos pongamos de acuerdo en UX antes
// de cablearlo a la DB.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import WinnerPayoutModal, { type PayoutMethod } from "@/components/polla/WinnerPayoutModal";
import LoserPayoutModal from "@/components/polla/LoserPayoutModal";
import PayoutBanner from "@/components/polla/PayoutBanner";
import WinnerPayoutCard, { type WinnerRow } from "@/components/polla/WinnerPayoutCard";
import PayoutDefaultEditor from "@/components/perfil/PayoutDefaultEditor";

type Scenario =
  | "winner_collects"
  | "loser_owes"
  | "loser_owes_pending"
  | "tabla_card"
  | "profile_optin";

const FAKE_POLLA = "Primos - Champions League 20k";

export default function PayoutPreviewPage() {
  const router = useRouter();
  const [scenario, setScenario] = useState<Scenario | null>(null);

  // Local state simulating DB rows
  const [winnerMethod, setWinnerMethod] = useState<PayoutMethod | null>(null);
  const [winnerAccount, setWinnerAccount] = useState<string | null>(null);
  const [loserPaid, setLoserPaid] = useState(false);

  const [profileMethod, setProfileMethod] = useState<PayoutMethod | null>(null);
  const [profileAccount, setProfileAccount] = useState<string | null>(null);

  // Escenarios para el WinnerPayoutCard preview (Tabla post-ended)
  const tableRows: WinnerRow[] = [
    {
      position: 1,
      display_name: "Lucho",
      prize_amount: 84000,
      payout_method: "nequi",
      payout_account: "311 314 7831",
      paid_count: 3,
      total_to_collect: 5,
      isMe: true,
    },
    {
      position: 2,
      display_name: "Casvi",
      prize_amount: 24000,
      payout_method: "bancolombia",
      payout_account: "0123 4567 89",
    },
    {
      position: 3,
      display_name: "Daniela",
      prize_amount: 12000,
      payout_method: null,
      payout_account: null,
    },
  ];

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto space-y-4">
      <header className="flex items-center gap-3 mb-2">
        <button onClick={() => router.back()} className="text-text-secondary text-xl">
          ←
        </button>
        <h1 className="lp-section-title text-[20px]">Preview · Payouts</h1>
      </header>

      <p className="text-xs text-text-muted">
        Página de prueba sin DB. Tocá cada botón para ver el escenario. Nada se guarda.
      </p>

      <div className="grid grid-cols-1 gap-2">
        <ScenarioButton
          label="1 · Modal del ganador (sin info previa)"
          desc="Lucho ganó 84.000. Llena Nequi + número."
          onClick={() => setScenario("winner_collects")}
        />
        <ScenarioButton
          label="2 · Modal del perdedor (ganador ya llenó)"
          desc="Lucho ganó. Casvi debe 20.000 y ve la cuenta."
          onClick={() => setScenario("loser_owes")}
        />
        <ScenarioButton
          label="3 · Modal del perdedor (ganador NO llenó)"
          desc="Polla terminó pero Lucho no abrió la app."
          onClick={() => setScenario("loser_owes_pending")}
        />
        <ScenarioButton
          label="4 · Card en la Tabla post-ended"
          desc="Vista que queda en la pestaña Tabla siempre."
          onClick={() => setScenario("tabla_card")}
        />
        <ScenarioButton
          label="5 · Opt-in en perfil"
          desc="Setea cuenta default para pre-llenar futuros wins."
          onClick={() => setScenario("profile_optin")}
        />
      </div>

      <hr className="border-border-subtle" />

      {/* PayoutBanner: lo mostramos siempre, simula 'Pagar después' */}
      {loserPaid ? null : (
        <div>
          <p className="text-[10px] uppercase tracking-[0.1em] text-text-primary/60 mb-1.5">
            Banner pinned (cuando dijo &quot;Pagar después&quot;)
          </p>
          <PayoutBanner
            pollaName={FAKE_POLLA}
            amountOwed={20000}
            winnerName="Lucho"
            extraWinnerCount={1}
            onTap={() => setScenario("loser_owes")}
          />
        </div>
      )}

      {/* Escenario 4 inline */}
      {scenario === "tabla_card" ? (
        <div className="pt-2">
          <p className="text-[10px] uppercase tracking-[0.1em] text-text-primary/60 mb-2">
            Tab Tabla — bloque arriba del ranking
          </p>
          <WinnerPayoutCard winners={tableRows} />
          <button
            onClick={() => setScenario(null)}
            className="mt-3 text-xs text-text-muted underline"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {/* Escenario 5 inline */}
      {scenario === "profile_optin" ? (
        <div className="pt-2 space-y-3">
          <p className="text-[10px] uppercase tracking-[0.1em] text-text-primary/60">
            Sección dentro de /perfil
          </p>
          <PayoutDefaultEditor
            initialMethod={profileMethod ?? undefined}
            initialAccount={profileAccount ?? undefined}
            onSave={(m, a) => {
              setProfileMethod(m);
              setProfileAccount(a);
            }}
            onClear={() => {
              setProfileMethod(null);
              setProfileAccount(null);
            }}
          />
          {profileMethod ? (
            <p className="text-[11px] text-text-muted">
              Default actual: <span className="text-text-primary">{profileMethod} · {profileAccount}</span>
            </p>
          ) : null}
          <button onClick={() => setScenario(null)} className="text-xs text-text-muted underline">
            Cerrar
          </button>
        </div>
      ) : null}

      {/* Modales */}
      <WinnerPayoutModal
        open={scenario === "winner_collects"}
        pollaName={FAKE_POLLA}
        position={1}
        prizeAmount={84000}
        initialMethod={profileMethod ?? undefined}
        initialAccount={profileAccount ?? undefined}
        onSubmit={(m, a) => {
          setWinnerMethod(m);
          setWinnerAccount(a);
          setScenario(null);
        }}
        onClose={() => setScenario(null)}
      />

      <LoserPayoutModal
        open={scenario === "loser_owes"}
        pollaName={FAKE_POLLA}
        amountOwed={20000}
        winners={[
          {
            display_name: "Lucho",
            payout_method: winnerMethod ?? "nequi",
            payout_account: winnerAccount ?? "311 314 7831",
          },
          {
            display_name: "Casvi",
            payout_method: "bancolombia",
            payout_account: "0123 4567 89",
          },
        ]}
        onMarkPaid={() => {
          setLoserPaid(true);
          setScenario(null);
        }}
        onLater={() => setScenario(null)}
        onClose={() => setScenario(null)}
      />

      <LoserPayoutModal
        open={scenario === "loser_owes_pending"}
        pollaName={FAKE_POLLA}
        amountOwed={20000}
        winners={[
          {
            display_name: "Lucho",
            payout_method: null,
            payout_account: null,
          },
        ]}
        onMarkPaid={() => setScenario(null)}
        onLater={() => setScenario(null)}
        onClose={() => setScenario(null)}
      />

      {loserPaid ? (
        <p className="text-[11px] text-turf">
          ✓ Marcaste como pagado en este preview. Recargá para volver a empezar.
        </p>
      ) : null}
    </div>
  );
}

function ScenarioButton({
  label,
  desc,
  onClick,
}: {
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-xl px-4 py-3 lp-card hover:border-gold/30 transition-colors"
    >
      <p className="text-sm font-semibold text-text-primary">{label}</p>
      <p className="text-[11px] text-text-muted mt-0.5">{desc}</p>
    </button>
  );
}
