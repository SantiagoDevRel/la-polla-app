// components/pollito/PollitoMoment.tsx — Tribuna Caliente §5
"use client";

import { useEffect, useMemo, useState } from "react";
import { Drawer } from "vaul";
import { X } from "lucide-react";
import {
  MOMENTS,
  type MomentKey,
  isDismissed,
  markDismissed,
} from "@/lib/pollito/moments";
import {
  type PollitoEstado,
  getPollitoAssetPath,
} from "@/lib/pollito/state";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";

export interface PollitoMomentProps {
  moment: MomentKey;
  estado: PollitoEstado;
  userPollitoType: string;
  vars?: Record<string, string | number>;
  onDismiss?: () => void;
  cta?: { label: string; onClick: () => void };
  // For /design previews: skip the dismissal persistence check.
  forceShow?: boolean;
  // Override the default sheet/inline display from MOMENTS config. Useful
  // when a moment should render inline in a specific surface even though
  // its canonical display is sheet (e.g. empty states on Mis Pollas).
  forceDisplay?: "sheet" | "inline";
}

const ACCENT: Record<
  PollitoEstado,
  { border: string; bgTint: string; glow?: string }
> = {
  lider: {
    border: "border-gold/40",
    bgTint: "rgba(255, 215, 0, 0.06)",
    glow: "shadow-[0_0_30px_-10px_rgba(255,215,0,0.25)]",
  },
  peleando: {
    border: "border-amber/40",
    bgTint: "rgba(255, 159, 28, 0.06)",
  },
  triste: {
    border: "border-red-alert/40",
    bgTint: "rgba(255, 61, 87, 0.06)",
  },
  base: {
    border: "border-border-subtle",
    bgTint: "var(--bg-card)",
  },
};

function PollitoImg({
  type,
  estado,
  size = 96,
}: {
  type: string;
  estado: PollitoEstado;
  size?: number;
}) {
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const src =
    stage === 0
      ? getPollitoAssetPath(type, estado)
      : stage === 1
      ? "/pollitos/Pollito_esperando.webp"
      : "";

  if (stage === 2) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        aria-label="Pollito"
        className="rounded-full"
      >
        <circle cx="32" cy="32" r="30" fill="#FFD700" />
        <circle cx="24" cy="26" r="3" fill="#080c10" />
        <circle cx="40" cy="26" r="3" fill="#080c10" />
        <path
          d="M22 40 Q32 48 42 40"
          stroke="#080c10"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return (
    <img
      src={src}
      alt="Pollito"
      width={size}
      height={size}
      onError={() => setStage((s) => (s < 2 ? ((s + 1) as 0 | 1 | 2) : s))}
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

function MomentBody({
  title,
  dialog,
  type,
  estado,
  cta,
  onClose,
  showClose,
}: {
  title: string;
  dialog: string;
  type: string;
  estado: PollitoEstado;
  cta?: PollitoMomentProps["cta"];
  onClose: () => void;
  showClose: boolean;
}) {
  return (
    <div className="flex items-start gap-4 p-5">
      <PollitoImg type={type} estado={estado} size={80} />
      <div className="flex-1 min-w-0">
        <h3 className="font-display text-[20px] tracking-[0.04em] uppercase text-text-primary leading-none">
          {title}
        </h3>
        <p className="mt-2 font-body text-[14px] leading-[1.45] text-text-secondary">
          {dialog}
        </p>
        {cta ? (
          <div className="mt-3">
            <Button variant="primary" size="sm" onClick={cta.onClick}>
              {cta.label}
            </Button>
          </div>
        ) : null}
      </div>
      {showClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="text-text-muted hover:text-text-primary transition-colors"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>
      ) : null}
    </div>
  );
}

export function PollitoMoment({
  moment,
  estado,
  userPollitoType,
  vars,
  onDismiss,
  cta,
  forceShow = false,
  forceDisplay,
}: PollitoMomentProps) {
  const config = MOMENTS[moment];
  const displayMode = forceDisplay ?? config.display;
  const accent = ACCENT[estado];
  const [hidden, setHidden] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (forceShow) {
      if (displayMode === "sheet") setSheetOpen(true);
      return;
    }
    if (isDismissed(moment)) {
      setHidden(true);
      return;
    }
    if (displayMode === "sheet") setSheetOpen(true);
  }, [moment, displayMode, forceShow]);

  const dialog = useMemo(() => config.dialog(vars ?? {}), [config, vars]);

  const handleDismiss = () => {
    if (!forceShow) markDismissed(moment);
    setHidden(true);
    setSheetOpen(false);
    onDismiss?.();
  };

  if (hidden) return null;

  if (displayMode === "sheet") {
    return (
      <Drawer.Root
        open={sheetOpen}
        onOpenChange={(open) => {
          if (!open) handleDismiss();
          else setSheetOpen(true);
        }}
      >
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/60 z-[55]" />
          <Drawer.Content
            className={cn(
              "fixed bottom-0 left-0 right-0 z-[60] rounded-t-xl border",
              accent.border,
              accent.glow,
            )}
            style={{
              background: `linear-gradient(180deg, ${accent.bgTint} 0%, var(--bg-card) 100%)`,
            }}
          >
            <Drawer.Title className="sr-only">{config.title}</Drawer.Title>
            <Drawer.Description className="sr-only">{dialog}</Drawer.Description>
            <div className="mx-auto mt-2 h-1.5 w-10 rounded-full bg-border-default" />
            <MomentBody
              title={config.title}
              dialog={dialog}
              type={userPollitoType}
              estado={estado}
              cta={cta}
              onClose={handleDismiss}
              showClose={true}
            />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    );
  }

  // inline
  return (
    <div
      className={cn("rounded-lg border", accent.border, accent.glow)}
      style={{
        background: `linear-gradient(180deg, ${accent.bgTint} 0%, var(--bg-card) 100%)`,
      }}
    >
      <MomentBody
        title={config.title}
        dialog={dialog}
        type={userPollitoType}
        estado={estado}
        cta={cta}
        onClose={handleDismiss}
        showClose={true}
      />
    </div>
  );
}

export default PollitoMoment;
