"use client";
import { useCallback, useEffect, useState } from "react";
import { MessageCircle } from "lucide-react";
import { useTranslations } from "next-intl";

export default function WhatsAppPreference() {
  const t = useTranslations("WhatsAppPreference");
  const [state, setState] = useState<{ enabled: boolean; available: boolean } | null>(null);
  const [error, setError] = useState(false);
  const [saving, setSaving] = useState(false);
  const load = useCallback(async () => {
    setError(false);
    try {
      const r = await fetch("/api/users/me/whatsapp-preference", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setState(await r.json());
    } catch { setError(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function toggle() {
    if (!state || saving) return;
    setSaving(true); setError(false);
    try {
      const r = await fetch("/api/users/me/whatsapp-preference", { method: "PATCH",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled }) });
      if (!r.ok) throw new Error();
      setState(await r.json());
    } catch { setError(true); } finally { setSaving(false); }
  }
  return <section className="lp-card space-y-3 p-4" aria-labelledby="wa-preference-title">
    <h2 id="wa-preference-title" className="flex items-center gap-2 text-base font-semibold leading-snug text-text-primary">
      <MessageCircle className="h-5 w-5 shrink-0" aria-hidden="true" />{t("title")}
    </h2>
    <p className="text-sm leading-relaxed text-text-secondary">{t("description")}</p>
    {!state && !error && <div className="h-12 animate-pulse rounded-xl bg-bg-elevated" role="status" aria-label={t("loading")} />}
    {state && <>
      <p className="text-sm font-medium leading-relaxed text-text-primary" role="status">{state.available ? t(state.enabled ? "enabled" : "disabled") : t("unavailable")}</p>
      {state.available && <button type="button" disabled={saving} onClick={toggle}
        className="min-h-11 w-full cursor-pointer rounded-full border border-border-default px-4 py-3 text-sm font-semibold leading-snug text-text-primary transition-colors hover:bg-bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:cursor-wait disabled:opacity-60">
        {saving ? t("saving") : t(state.enabled ? "turnOff" : "turnOn")}
      </button>}
    </>}
    {error && <div role="alert" className="space-y-2 text-sm leading-relaxed text-red-alert"><p>{t("error")}</p>
      {!state && <button type="button" onClick={load} className="min-h-11 cursor-pointer underline">{t("retry")}</button>}
    </div>}
    <p className="text-sm leading-relaxed text-text-secondary">{t("help")}</p>
  </section>;
}
