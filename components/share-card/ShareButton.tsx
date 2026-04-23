// components/share-card/ShareButton.tsx — client share trigger
//
// On mobile (Web Share API Level 2): fires navigator.share with the
// PNG as a File so the WhatsApp/Messages share sheet opens directly.
//
// On desktop (no Web Share API for files): opens a small preview modal
// with the rendered PNG + a "Descargar" action. Users drag the saved
// file into WhatsApp Web. `window.open` after an awaited fetch is
// unreliable because Chrome blocks popups once the user-gesture chain
// is broken — rendering the modal avoids that entirely.

"use client";

import { useEffect, useRef, useState } from "react";
import { Share2, Download, X } from "lucide-react";

type SubistePayload = {
  type: "subiste";
  name: string;
  polla: string;
  rank: number;
  pollito?: string | null;
};

type ClavadaPayload = {
  type: "clavada";
  name: string;
  polla: string;
  homeTeam: string;
  awayTeam: string;
  home: number;
  away: number;
  pollito?: string | null;
};

type RivalPayload = {
  type: "rival";
  name: string;
  polla: string;
  rival: string;
  gap: number;
  pollito?: string | null;
  rivalPollito?: string | null;
};

export type SharePayload = SubistePayload | ClavadaPayload | RivalPayload;

export interface ShareButtonProps {
  payload: SharePayload;
  className?: string;
  label?: string;
}

function buildUrl(payload: SharePayload): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  return `/api/share-card?${params.toString()}`;
}

function captionFor(payload: SharePayload): string {
  if (payload.type === "subiste") {
    return `Subí a #${payload.rank} en ${payload.polla}. — La Polla App`;
  }
  if (payload.type === "clavada") {
    return `Clavada ${payload.homeTeam} ${payload.home}-${payload.away} ${payload.awayTeam} en ${payload.polla}. — La Polla App`;
  }
  return `${payload.rival} vs ${payload.name} en ${payload.polla}. — La Polla App`;
}

export function ShareButton({ payload, className, label = "Compartir" }: ShareButtonProps) {
  const [busy, setBusy] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  // Revoke object URLs on unmount to avoid memory leaks.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function share(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const url = buildUrl(payload);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`share-card ${res.status}`);
      const blob = await res.blob();
      blobRef.current = blob;
      const file = new File([blob], `la-polla-${payload.type}.png`, { type: "image/png" });
      const caption = captionFor(payload);

      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], text: caption });
        return;
      }

      // Desktop fallback: open a preview modal so the user can see the
      // card and download it with one click.
      const objectUrl = URL.createObjectURL(blob);
      setPreviewUrl(objectUrl);
    } catch (err) {
      console.warn("[share-card] share failed", err);
      alert("No se pudo generar la imagen. Probá de nuevo.");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    const blob = blobRef.current;
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `la-polla-${payload.type}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function closePreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  return (
    <>
      <button
        type="button"
        onClick={share}
        disabled={busy}
        className={
          className ??
          "inline-flex items-center gap-1 px-2.5 py-1 rounded-full font-body text-[10px] font-semibold tracking-[0.06em] uppercase bg-gold/10 text-gold border border-gold/30 hover:bg-gold/20 transition-colors disabled:opacity-60"
        }
        aria-label={label}
      >
        <Share2 className="w-3 h-3" strokeWidth={2.5} aria-hidden="true" />
        {busy ? "..." : label}
      </button>

      {previewUrl ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Previsualización"
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          onClick={closePreview}
        >
          <div
            className="relative max-w-[380px] w-full lp-card p-4 flex flex-col gap-3"
            onClick={(ev) => ev.stopPropagation()}
          >
            <button
              type="button"
              onClick={closePreview}
              aria-label="Cerrar"
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-bg-elevated border border-border-subtle grid place-items-center text-text-muted hover:text-text-primary"
            >
              <X className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
            </button>
            <h3 className="font-display text-[18px] tracking-[0.06em] uppercase text-gold leading-none pt-1 pr-10">
              Lista para compartir
            </h3>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewUrl}
              alt=""
              className="w-full rounded-lg border border-border-subtle"
            />
            <p className="text-[11.5px] text-text-secondary leading-snug">
              Descargá la imagen y la soltás en el chat de WhatsApp. En celular
              aparece el selector nativo directo.
            </p>
            <button
              type="button"
              onClick={download}
              className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-full font-body text-[13px] font-extrabold tracking-[0.04em] text-bg-base bg-gradient-to-b from-gold to-amber"
            >
              <Download className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              Descargar imagen
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default ShareButton;
