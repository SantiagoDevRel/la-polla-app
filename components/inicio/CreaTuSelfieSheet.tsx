"use client";

// CreaTuSelfieSheet — bottom-sheet del flujo "Crea tu Selfie" (admin-only).
// 3 selfies (frente/perfil1/perfil2) + elegir 1 jugador del Mundial + radio de pintura
// de cara → POST /api/ai-image → polling → resultado (descargar / compartir).
// Toda la generación corre en el NVIDIA DGX (vía la cola ai_image_jobs).

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Camera, X, Search, Download, Share2, Loader2, Check, Sparkles, RotateCcw } from "lucide-react";
import PLAYERS from "@/lib/ai-selfie/players.json";

type Player = { name: string; country: string };
type FacePaint = "none" | "cheek" | "full";
type Phase = "form" | "pending" | "done" | "error";
type SlotKey = "front" | "left" | "right";

const SLOTS: { key: SlotKey; label: string }[] = [
  { key: "front", label: "Frente" },
  { key: "left", label: "Perfil 1" },
  { key: "right", label: "Perfil 2" },
];

const PAINT_OPTS: { value: FacePaint; label: string; hint: string }[] = [
  { value: "none", label: "Sin pintura", hint: "Tu cara tal cual (default)" },
  { value: "cheek", label: "Banderitas en el cachete", hint: "Bandera de tu selección" },
  { value: "full", label: "Cara completa pintada", hint: "Hincha full" },
];

export default function CreaTuSelfieSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("form");
  const [files, setFiles] = useState<Record<SlotKey, File | null>>({ front: null, left: null, right: null });
  const [previews, setPreviews] = useState<Record<SlotKey, string | null>>({ front: null, left: null, right: null });
  const [query, setQuery] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [paint, setPaint] = useState<FacePaint>("none");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  // Escape para cerrar
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // limpiar polling al desmontar
  useEffect(() => () => { if (pollRef.current) clearTimeout(pollRef.current); }, []);

  const players = PLAYERS as Player[];
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return players.slice(0, 0);
    return players
      .filter((p) => p.name.toLowerCase().includes(q) || p.country.toLowerCase().includes(q))
      .slice(0, 30);
  }, [query, players]);

  function setSlot(key: SlotKey, file: File | null) {
    setFiles((f) => ({ ...f, [key]: file }));
    setPreviews((p) => {
      if (p[key]) URL.revokeObjectURL(p[key]!);
      return { ...p, [key]: file ? URL.createObjectURL(file) : null };
    });
  }

  const hasSelfie = !!files.front || !!files.left || !!files.right;
  const canSubmit = hasSelfie && (!!player || paint !== "none");

  async function submit() {
    setErrorMsg(null);
    const fd = new FormData();
    if (files.front) fd.append("selfie1", files.front);
    if (files.left) fd.append("selfie2", files.left);
    if (files.right) fd.append("selfie3", files.right);
    if (player) { fd.append("player_name", player.name); fd.append("player_team", player.country); }
    fd.append("face_paint", paint);
    setPhase("pending");
    try {
      const res = await fetch("/api/ai-image", { method: "POST", body: fd });
      const j = await res.json();
      if (!res.ok) { setErrorMsg(j.error || "No se pudo crear"); setPhase("error"); return; }
      poll(j.job_id);
    } catch {
      setErrorMsg("Error de red"); setPhase("error");
    }
  }

  function poll(id: string) {
    const tick = async () => {
      try {
        const res = await fetch(`/api/ai-image/${id}`);
        const j = await res.json();
        if (j.status === "done" && j.result_url) { setResultUrl(j.result_url); setPhase("done"); return; }
        if (j.status === "error") { setErrorMsg(j.error || "Falló la generación"); setPhase("error"); return; }
      } catch { /* reintenta */ }
      pollRef.current = setTimeout(tick, 4000);
    };
    pollRef.current = setTimeout(tick, 4000);
  }

  function reset() {
    if (pollRef.current) clearTimeout(pollRef.current);
    setPhase("form"); setErrorMsg(null); setResultUrl(null);
  }

  async function share() {
    if (!resultUrl) return;
    try {
      const blob = await (await fetch(resultUrl)).blob();
      const file = new File([blob], "la-polla-selfie.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: "Mi selfie de La Polla 🐥" });
        return;
      }
    } catch { /* fallback abajo */ }
    window.open(resultUrl, "_blank");
  }

  if (!mounted || !open) return null;

  const spring = reduce ? { duration: 0 } : { type: "spring" as const, stiffness: 360, damping: 34 };

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="backdrop"
        className="fixed inset-0 z-[70] bg-black/60 backdrop-blur-sm"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        onClick={onClose}
      />
      <motion.div
        key="sheet"
        role="dialog"
        aria-label="Crea tu Selfie"
        className="fixed bottom-0 inset-x-0 z-[71] mx-auto w-full sm:max-w-md sm:bottom-6 px-0"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={spring}
      >
        <div
          className="bg-card border border-subtle rounded-t-[24px] sm:rounded-[24px] shadow-[0_-8px_40px_rgba(0,0,0,0.5)] max-h-[88vh] flex flex-col overflow-hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* header */}
          <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-subtle shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              <Sparkles className="w-5 h-5 text-gold shrink-0" />
              <h2 className="font-display text-2xl leading-none text-text-primary truncate">CREA TU SELFIE</h2>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-4 grow">
            {phase === "form" && (
              <div className="space-y-6">
                {/* selfies */}
                <section>
                  <p className="font-display text-lg text-text-primary mb-1">1 · Tus selfies</p>
                  <p className="text-xs text-muted mb-3">Frente + 2 perfiles para que salga más fiel. Tu cara se procesa en nuestro hardware y se borra.</p>
                  <div className="grid grid-cols-3 gap-3">
                    {SLOTS.map((s) => (
                      <label key={s.key} className="relative aspect-[3/4] rounded-xl border border-subtle bg-elevated overflow-hidden cursor-pointer flex flex-col items-center justify-center gap-1 hover:border-gold/30 transition-colors">
                        {previews[s.key] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={previews[s.key]!} alt={s.label} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <>
                            <Camera className="w-5 h-5 text-muted" />
                            <span className="text-[11px] text-muted">{s.label}</span>
                          </>
                        )}
                        <input
                          type="file" accept="image/*" capture="user" className="hidden"
                          onChange={(e) => setSlot(s.key, e.target.files?.[0] ?? null)}
                        />
                      </label>
                    ))}
                  </div>
                </section>

                {/* jugador */}
                <section>
                  <p className="font-display text-lg text-text-primary mb-1">2 · Tu crack del Mundial</p>
                  <p className="text-xs text-muted mb-3">Buscá un jugador para salir a su lado (opcional si solo querés pintura).</p>
                  {player ? (
                    <div className="flex items-center justify-between rounded-xl border border-gold/30 bg-gold/10 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gold truncate">{player.name}</p>
                        <p className="text-xs text-text-secondary truncate">{player.country}</p>
                      </div>
                      <button onClick={() => { setPlayer(null); setQuery(""); }} className="text-text-secondary hover:text-text-primary p-1" aria-label="Quitar jugador"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 rounded-xl bg-elevated border border-subtle px-3 py-2.5 focus-within:ring-1 focus-within:ring-gold/40">
                        <Search className="w-4 h-4 text-muted shrink-0" />
                        <input
                          value={query} onChange={(e) => setQuery(e.target.value)}
                          placeholder="Messi, Luis Díaz, Diomandé…"
                          className="bg-transparent outline-none text-sm text-text-primary placeholder:text-muted w-full"
                        />
                      </div>
                      {matches.length > 0 && (
                        <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-subtle divide-y divide-subtle">
                          {matches.map((p) => (
                            <button key={p.name + p.country} onClick={() => { setPlayer(p); }} className="w-full text-left px-4 py-2.5 hover:bg-card-hover transition-colors">
                              <span className="text-sm text-text-primary">{p.name}</span>
                              <span className="text-xs text-muted ml-2">{p.country}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </section>

                {/* pintura */}
                <section>
                  <p className="font-display text-lg text-text-primary mb-3">3 · Pintura de cara</p>
                  <div className="space-y-2">
                    {PAINT_OPTS.map((o) => (
                      <button
                        key={o.value} onClick={() => setPaint(o.value)}
                        className={`w-full flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all ${paint === o.value ? "border-gold/40 bg-gold/10" : "border-subtle bg-elevated hover:border-gold/20"}`}
                      >
                        <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${paint === o.value ? "border-gold bg-gold" : "border-subtle"}`}>
                          {paint === o.value && <Check className="w-3 h-3 text-bg-base" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm text-text-primary">{o.label}</span>
                          <span className="block text-xs text-muted">{o.hint}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            )}

            {phase === "pending" && (
              <div className="py-12 flex flex-col items-center text-center gap-4">
                <Loader2 className="w-10 h-10 text-gold animate-spin" />
                <div>
                  <p className="font-display text-xl text-text-primary">Generando tu imagen…</p>
                  <p className="text-sm text-muted mt-1">Corriendo en el DGX. Puede tardar 1-3 min — podés esperar acá.</p>
                </div>
              </div>
            )}

            {phase === "done" && resultUrl && (
              <div className="py-2 flex flex-col items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={resultUrl} alt="Tu selfie de La Polla" className="w-full rounded-xl border border-subtle" />
                <div className="grid grid-cols-2 gap-3 w-full">
                  <a href={resultUrl} download="la-polla-selfie.png" className="flex items-center justify-center gap-2 rounded-full border border-subtle text-text-primary px-4 py-3 text-sm font-medium hover:border-gold/30 transition-colors">
                    <Download className="w-4 h-4" /> Descargar
                  </a>
                  <button onClick={share} className="flex items-center justify-center gap-2 rounded-full bg-gold text-bg-base px-4 py-3 text-sm font-semibold hover:brightness-110 transition-all">
                    <Share2 className="w-4 h-4" /> Compartir
                  </button>
                </div>
                <button onClick={reset} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mt-1">
                  <RotateCcw className="w-4 h-4" /> Crear otra
                </button>
              </div>
            )}

            {phase === "error" && (
              <div className="py-12 flex flex-col items-center text-center gap-3">
                <p className="font-display text-xl text-red-alert">Algo salió mal</p>
                <p className="text-sm text-muted">{errorMsg || "Reintentá en un momento."}</p>
                <button onClick={reset} className="rounded-full border border-subtle text-text-primary px-5 py-2.5 text-sm hover:border-gold/30 transition-colors mt-1">Volver</button>
              </div>
            )}
          </div>

          {/* footer CTA */}
          {phase === "form" && (
            <div className="px-5 py-4 border-t border-subtle shrink-0">
              <button
                disabled={!canSubmit} onClick={submit}
                className={`w-full rounded-full px-5 py-3.5 font-semibold transition-all ${canSubmit ? "bg-gold text-bg-base hover:brightness-110 active:scale-[0.98]" : "bg-elevated text-muted cursor-not-allowed"}`}
              >
                Generar mi imagen
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
