// components/ui/Button.tsx — Tribuna Caliente §3.1
"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "danger-outline";
type Size = "sm" | "md" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-gold text-bg-base shadow-[0_8px_24px_-6px_rgba(255,215,0,0.4)] hover:-translate-y-px hover:shadow-[0_10px_28px_-6px_rgba(255,215,0,0.55)]",
  secondary:
    "bg-bg-elevated text-text-primary border border-border-default hover:border-border-strong",
  "danger-outline":
    "bg-transparent text-red-alert border border-red-alert/40 hover:bg-red-alert/10",
};

const SIZE: Record<Size, string> = {
  sm: "h-9 px-4 text-[14px]",
  md: "h-11 px-5 text-[16px]",
  lg: "h-[52px] px-6 text-[18px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leftIcon,
    rightIcon,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-display tracking-[0.06em] uppercase",
        "transition-[transform,box-shadow,background,border-color] duration-150 active:scale-[0.98]",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANT[variant],
        SIZE[size],
        loading && "pointer-events-none",
        className,
      )}
      {...props}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
      ) : (
        leftIcon && <span className="inline-flex">{leftIcon}</span>
      )}
      <span>{children}</span>
      {!loading && rightIcon && <span className="inline-flex">{rightIcon}</span>}
    </button>
  );
});

export default Button;
