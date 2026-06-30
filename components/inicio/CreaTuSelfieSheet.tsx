"use client";

// CreaTuSelfieSheet — bottom-sheet del flujo "Crea tu Selfie" (admin-only).
// 3 selfies (frente/perfil1/perfil2) + elegir 1 jugador del Mundial + radio de pintura
// de cara → POST /api/ai-image → la cola corre en el DGX → el resultado queda en una
// GALERÍA PRIVADA persistente (GET /api/ai-image): mandás, podés cerrar/salir de la app,
// y al volver tus fotos están acá. Tocás cualquiera para verla grande / descargar / compartir.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Camera, X, Search, Download, Share2, Loader2, Check, Sparkles, Plus, ChevronLeft, ImageOff } from "lucide-react";
import PLAYERS from "@/lib/ai-selfie/players.json";

type Player = { name: string; country: string };
type FacePaint = "none" | "cheek" | "full";
type Phase = "gallery" | "form" | "viewer";
type SlotKey = "front" | "left" | "right";
type Job = {
  id: string;
  status: "pending" | "done" | "error";
  player_name: string | null;
  face_paint: string;
  error: string | null;
  result_url: string | null;
  created_at: string;
};

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

function jobLabel(j: Job) {
  return j.player_name || (j.face_paint !== "none" ? "Pintura" : "Selfie");
}

// Las fotos de celular pesan 2-6MB; el POST multipart de 3 superaría el límite de body
// de Vercel (~4.5MB) y fallaría sin crear el job. Las redimensionamos/comprimimos en el
// cliente (lado largo 1280px, JPEG 0.82) → ~200-400KB c/u → sube rápido y entra holgado.
function loadImg(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
async function compressImage(file: File, max = 1280, quality = 0.82): Promise<Blob> {
  const img = await loadImg(file);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no ctx");
  ctx.drawImage(img, 0, 0, w, h);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob null"))), "image/jpeg", quality);
  });
}
async function prepareFile(file: File): Promise<Blob> {
  try { return await compressImage(file); } catch { return file; }
}

export default function CreaTuSelfieSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [phase, setPhase] = useState<Phase>("gallery");
  const [files, setFiles] = useState<Record<SlotKey, File | null>>({ front: null, left: null, right: null });
  const [previews, setPreviews] = useState<Record<SlotKey, string | null>>({ front: null, left: null, right: null });
  const [query, setQuery] = useState("");
  const [player, setPlayer] = useState<Player | null>(null);
  const [paint, setPaint] = useState<FacePaint>("none");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);
  const [submitting, setSubmitting] = useState(false);
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

  async function loadJobs(): Promise<Job[]> {
    try {
      const res = await fetch("/api/ai-image");
      const j = await res.json();
      const list: Job[] = Array.isArray(j.jobs) ? j.jobs : [];
      setJobs(list);
      return list;
    } catch {
      return [];
    }
  }

  function poll(id: string) {
    const tick = async () => {
      try {
        const res = await fetch(`/api/ai-image/${id}`);
        const j = await res.json();
        if (j.status === "done" || j.status === "error") { await loadJobs(); return; }
      } catch { /* reintenta */ }
      pollRef.current = setTimeout(tick, 4000);
    };
    if (pollRef.current) clearTimeout(pollRef.current);
    pollRef.current = setTimeout(tick, 4000);
  }

  // al abrir: cargar la galería del server (persiste aunque hayas cerrado/salido de la app).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoadingJobs(true);
      const list = await loadJobs();
      if (cancelled) return;
      setLoadingJobs(false);
      const pend = list.find((x) => x.status === "pending");
      if (pend) poll(pend.id);
      // no piso un formulario que el user ya esté armando
      setPhase((prev) => {
        if (prev === "form" && (files.front || files.left || files.right || player)) return prev;
        return list.length > 0 ? "gallery" : "form";
      });
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  function clearForm() {
    setPreviews((p) => {
      Object.values(p).forEach((u) => u && URL.revokeObjectURL(u));
      return { front: null, left: null, right: null };
    });
    setFiles({ front: null, left: null, right: null });
    setPlayer(null); setQuery(""); setPaint("none"); setErrorMsg(null);
  }

  const hasSelfie = !!files.front || !!files.left || !!files.right;
  const canSubmit = hasSelfie && (!!player || paint !== "none");

  async function submit() {
    if (submitting) return;
    setErrorMsg(null);
    setSubmitting(true);
    try {
      const fd = new FormData();
      if (files.front) fd.append("selfie1", await prepareFile(files.front), "selfie1.jpg");
      if (files.left) fd.append("selfie2", await prepareFile(files.left), "selfie2.jpg");
      if (files.right) fd.append("selfie3", await prepareFile(files.right), "selfie3.jpg");
      if (player) { fd.append("player_name", player.name); fd.append("player_team", player.country); }
      fd.append("face_paint", paint);
      const res = await fetch("/api/ai-image", { method: "POST", body: fd });
      let j: { error?: string; job_id?: string } = {};
      try { j = await res.json(); } catch { /* respuesta no-JSON (ej. 413) */ }
      if (!res.ok || !j.job_id) {
        setErrorMsg(j.error || (res.status === 413 ? "Las fotos pesan demasiado" : `No se pudo crear (${res.status})`));
        return;
      }
      // a la galería: el job nuevo aparece como tile "generándose"; podés cerrar y volver
      clearForm();
      setPhase("gallery");
      await loadJobs();
      poll(j.job_id);
    } catch {
      setErrorMsg("Error de red. Reintentá.");
    } finally {
      setSubmitting(false);
    }
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
  const pendingCount = jobs.filter((j) => j.status === "pending").length;
  const showBack = (phase === "form" || phase === "viewer") && jobs.length > 0;

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
              {showBack ? (
                <button onClick={() => setPhase("gallery")} aria-label="Volver a la galería" className="p-1 -ml-1 rounded-full text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors shrink-0">
                  <ChevronLeft className="w-5 h-5" />
                </button>
              ) : (
                <Sparkles className="w-5 h-5 text-gold shrink-0" />
              )}
              <h2 className="font-display text-2xl leading-none text-text-primary truncate">
                {phase === "form" ? "NUEVA SELFIE" : phase === "viewer" ? "TU SELFIE" : "CREA TU SELFIE"}
              </h2>
            </div>
            <button onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-full text-text-secondary hover:text-text-primary hover:bg-card-hover transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="overflow-y-auto px-5 py-4 grow">
            {/* ===== GALERÍA ===== */}
            {phase === "gallery" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-display text-lg text-text-primary">Tu galería</p>
                  {pendingCount > 0 && (
                    <span className="text-xs text-gold flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" /> {pendingCount} generándose
                    </span>
                  )}
                </div>

                {loadingJobs && jobs.length === 0 ? (
                  <div className="py-12 text-center text-sm text-muted">Cargando tu galería…</div>
                ) : jobs.length === 0 ? (
                  <div className="py-12 flex flex-col items-center text-center gap-2">
                    <Sparkles className="w-8 h-8 text-muted" />
                    <p className="text-sm text-muted">Todavía no tenés selfies.<br />Creá la primera 👇</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    {jobs.map((j) => {
                      const label = jobLabel(j);
                      if (j.status === "done" && j.result_url) {
                        return (
                          <button
                            key={j.id} onClick={() => { setResultUrl(j.result_url!); setPhase("viewer"); }}
                            className="relative aspect-square rounded-xl overflow-hidden border border-subtle hover:border-gold/40 transition-colors"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={j.result_url} alt={label} className="absolute inset-0 w-full h-full object-cover" />
                            <span className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/75 to-transparent px-2 py-1 text-[11px] text-white truncate text-left">{label}</span>
                          </button>
                        );
                      }
                      if (j.status === "pending") {
                        return (
                          <div key={j.id} className="aspect-square rounded-xl border border-gold/30 bg-gold/5 flex flex-col items-center justify-center gap-2 text-center px-2">
                            <Loader2 className="w-6 h-6 text-gold animate-spin" />
                            <span className="text-[11px] text-muted leading-tight">Generando…<br />{label}</span>
                          </div>
                        );
                      }
                      return (
                        <div key={j.id} className="aspect-square rounded-xl border border-subtle bg-elevated flex flex-col items-center justify-center gap-1 text-center px-2">
                          <ImageOff className="w-5 h-5 text-red-alert" />
                          <span className="text-[11px] text-red-alert">Falló</span>
                          <span className="text-[10px] text-muted line-clamp-2">{j.error || "Reintentá"}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="text-[11px] text-muted text-center pt-1">Galería privada — solo vos la ves. Las fotos quedan acá aunque cierres la app.</p>
              </div>
            )}

            {/* ===== FORM ===== */}
            {phase === "form" && (
              <div className="space-y-6">
                {errorMsg && (
                  <div className="rounded-xl border border-red-alert/30 bg-red-alert/10 px-4 py-2.5 text-sm text-red-alert">{errorMsg}</div>
                )}
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

            {/* ===== VIEWER (una foto grande) ===== */}
            {phase === "viewer" && resultUrl && (
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
                <button onClick={() => setPhase("gallery")} className="flex items-center gap-1.5 text-sm text-text-secondary hover:text-text-primary mt-1">
                  <ChevronLeft className="w-4 h-4" /> Volver a la galería
                </button>
              </div>
            )}
          </div>

          {/* footer CTA */}
          {phase === "form" && (
            <div className="px-5 py-4 border-t border-subtle shrink-0">
              <button
                disabled={!canSubmit || submitting} onClick={submit}
                className={`w-full flex items-center justify-center gap-2 rounded-full px-5 py-3.5 font-semibold transition-all ${canSubmit && !submitting ? "bg-gold text-bg-base hover:brightness-110 active:scale-[0.98]" : "bg-elevated text-muted cursor-not-allowed"}`}
              >
                {submitting ? (<><Loader2 className="w-5 h-5 animate-spin" /> Enviando…</>) : "Generar mi imagen"}
              </button>
            </div>
          )}
          {phase === "gallery" && (
            <div className="px-5 py-4 border-t border-subtle shrink-0">
              <button
                onClick={() => { setErrorMsg(null); setPhase("form"); }}
                className="w-full flex items-center justify-center gap-2 rounded-full px-5 py-3.5 font-semibold bg-gold text-bg-base hover:brightness-110 active:scale-[0.98] transition-all"
              >
                <Plus className="w-5 h-5" /> Crear nueva selfie
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
