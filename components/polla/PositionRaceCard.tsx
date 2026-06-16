"use client";

/**
 * PositionRaceCard — loader del bump chart de evolución de posiciones.
 * Trae la data real de /api/pollas/[slug]/standings-history (lazy: solo se
 * monta cuando el usuario abre la sub-vista "Evolución") y se la pasa a
 * PositionRaceChart. Maneja loading / vacío (<2 días verificados) / error.
 */

import { useEffect, useState } from "react";
import axios from "axios";
import { LineChart } from "lucide-react";
import PositionRaceChart, { type RaceRacer } from "./PositionRaceChart";

interface Props {
  pollaSlug: string;
}

interface HistoryState {
  loading: boolean;
  error: boolean;
  days: string[];
  racers: RaceRacer[];
}

export default function PositionRaceCard({ pollaSlug }: Props) {
  const [state, setState] = useState<HistoryState>({
    loading: true,
    error: false,
    days: [],
    racers: [],
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(
          `/api/pollas/${pollaSlug}/standings-history`,
        );
        if (cancelled) return;
        setState({
          loading: false,
          error: false,
          days: data.days || [],
          racers: data.racers || [],
        });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false, error: true }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pollaSlug]);

  if (state.loading) {
    return (
      <div className="rounded-2xl lp-card p-3">
        <div className="h-5 w-40 rounded bg-bg-elevated animate-pulse mb-3" />
        <div className="h-[300px] rounded-xl bg-bg-elevated animate-pulse" />
      </div>
    );
  }

  // Necesita al menos 2 días verificados para que la "carrera" tenga sentido
  // (un solo día = la tabla ya lo dice todo).
  if (state.error || state.days.length < 2) {
    return (
      <div className="rounded-2xl lp-card p-6 flex flex-col items-center text-center gap-2">
        <div className="w-12 h-12 rounded-full bg-gold/10 border border-gold/20 flex items-center justify-center">
          <LineChart className="w-6 h-6 text-gold" />
        </div>
        <h3 className="font-display text-[20px] tracking-[0.03em] text-text-primary uppercase">
          La carrera apenas arranca
        </h3>
        <p className="text-sm text-text-secondary max-w-xs leading-snug">
          {state.error
            ? "No pudimos cargar la evolución. Intenta de nuevo en un momento."
            : "Necesitamos al menos 2 días con partidos verificados para dibujar cómo se mueven las posiciones. Vuelve después de la próxima fecha. 🐥"}
        </p>
      </div>
    );
  }

  return <PositionRaceChart racers={state.racers} fechaLabels={state.days} />;
}
