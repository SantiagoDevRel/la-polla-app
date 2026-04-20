// components/pollas/JoinByCodeSheet.tsx
//
// Vaul bottom-sheet for joining a polla via its 6-char code. Controlled
// by the caller via `open` + `onOpenChange`. The sheet owns the input
// and the submit call; on success it calls `onSuccess` with the polla
// slug + name so the caller can decide what to do (navigate + toast).
"use client";

import { useEffect, useRef, useState } from "react";
import { Drawer } from "vaul";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { JOIN_CODE_ALPHABET, JOIN_CODE_LENGTH } from "@/lib/pollas/join-code";

export interface JoinByCodeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (polla: { slug: string; name: string }) => void;
}

// Permit only alphabet characters. Users may paste with spaces or dashes
// (e.g. a code copied from a message); strip them before validating.
function sanitize(raw: string): string {
  const upper = raw.toUpperCase();
  let out = "";
  for (const ch of upper) {
    if (JOIN_CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length >= JOIN_CODE_LENGTH) break;
  }
  return out;
}

export function JoinByCodeSheet({
  open,
  onOpenChange,
  onSuccess,
}: JoinByCodeSheetProps) {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset state and focus input each time the sheet opens.
  useEffect(() => {
    if (open) {
      setCode("");
      setError(null);
      setSubmitting(false);
      const id = window.setTimeout(() => inputRef.current?.focus(), 150);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  const ready = code.length === JOIN_CODE_LENGTH;

  async function handleSubmit() {
    if (!ready || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/pollas/join-by-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        polla?: { slug: string; name: string };
      };
      if (res.ok && body.ok && body.polla) {
        onSuccess(body.polla);
        return;
      }
      setError(body.error ?? "No pudimos unirte a la polla");
    } catch {
      setError("Error de red. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[55]" />
        <Drawer.Content
          className="fixed bottom-0 left-0 right-0 z-[60] rounded-t-xl border border-gold/25 bg-bg-card"
        >
          <Drawer.Title className="sr-only">Únete con código</Drawer.Title>
          <Drawer.Description className="sr-only">
            Ingresa el código de 6 letras para unirte a una polla.
          </Drawer.Description>
          <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border-default" />
          <div className="p-5 pb-8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gold/10 border border-gold/25 flex items-center justify-center">
                <KeyRound className="w-5 h-5 text-gold" strokeWidth={2} aria-hidden="true" />
              </div>
              <div>
                <h3 className="font-display text-[22px] tracking-[0.04em] uppercase text-text-primary leading-none">
                  Únete con código
                </h3>
                <p className="mt-1 font-body text-[13px] text-text-secondary">
                  Pídele el código de 6 letras al admin de la polla.
                </p>
              </div>
            </div>

            <label className="block">
              <span className="sr-only">Código de 6 caracteres</span>
              <input
                ref={inputRef}
                value={code}
                onChange={(e) => {
                  setCode(sanitize(e.target.value));
                  if (error) setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && ready) handleSubmit();
                }}
                inputMode="text"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                maxLength={JOIN_CODE_LENGTH}
                placeholder="XXXXXX"
                className={cn(
                  "w-full h-14 rounded-md bg-bg-elevated border-2 text-center",
                  "font-mono text-[28px] tracking-[0.24em] uppercase text-gold",
                  "outline-none transition-colors",
                  error ? "border-red-alert/60" : "border-gold/60 focus:border-gold",
                )}
                style={{ fontFeatureSettings: '"tnum"' }}
                disabled={submitting}
              />
            </label>

            {error ? (
              <p className="mt-2 font-body text-[13px] text-red-alert">{error}</p>
            ) : (
              <p className="mt-2 font-body text-[12px] text-text-muted">
                {code.length}/{JOIN_CODE_LENGTH}
              </p>
            )}

            <div className="mt-5">
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                loading={submitting}
                disabled={!ready}
                onClick={handleSubmit}
              >
                Unirme a la polla
              </Button>
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

export default JoinByCodeSheet;
