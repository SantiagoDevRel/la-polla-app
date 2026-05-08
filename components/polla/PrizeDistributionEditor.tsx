// components/polla/PrizeDistributionEditor.tsx
// Sección "Premios" del panel admin. Envuelve PrizeDistributionForm con
// botones de Guardar / Borrar contra la API.
"use client";

import { useState } from "react";
import axios from "axios";
import { Trophy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/ui/Toast";
import PrizeDistributionForm, {
  type PrizeDistribution,
} from "@/components/polla/PrizeDistributionForm";

interface Props {
  pollaSlug: string;
  pot: number;
  initial: PrizeDistribution | null;
}

export default function PrizeDistributionEditor({ pollaSlug, pot, initial }: Props) {
  const t = useTranslations("Prizes");
  const { showToast } = useToast();
  const [pending, setPending] = useState<PrizeDistribution | null>(initial);
  const [hasInitial, setHasInitial] = useState(!!initial);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);

  async function save() {
    if (!pending) {
      showToast(t("errIncomplete"), "error");
      return;
    }
    setSaving(true);
    try {
      await axios.patch(`/api/pollas/${pollaSlug}/prize-distribution`, pending);
      showToast(t("savedToast"), "success");
      setHasInitial(true);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      showToast(e.response?.data?.error || t("errSave"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function clearDistribution() {
    if (!hasInitial) return;
    if (!confirm(t("confirmDelete"))) return;
    setRemoving(true);
    try {
      await axios.delete(`/api/pollas/${pollaSlug}/prize-distribution`);
      showToast(t("deletedToast"), "success");
      setHasInitial(false);
      setPending(null);
    } catch {
      showToast(t("errDelete"), "error");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="rounded-2xl p-5 lp-card space-y-4">
      <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
        <Trophy className="w-5 h-5 text-gold" /> {t("title")}
      </h3>

      <PrizeDistributionForm pot={pot} initial={initial} onChange={setPending} />

      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || !pending}
          className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-gold text-bg-base font-semibold text-sm hover:brightness-110 transition-all disabled:opacity-50"
        >
          {saving ? t("saving") : t("savePrizes")}
        </button>
        {hasInitial && (
          <button
            type="button"
            onClick={clearDistribution}
            disabled={removing}
            className="px-3 py-2 rounded-xl border border-border-subtle text-text-muted text-sm hover:border-red-alert/40 hover:text-red-alert transition-colors disabled:opacity-50"
          >
            {removing ? "…" : t("delete")}
          </button>
        )}
      </div>
    </section>
  );
}
