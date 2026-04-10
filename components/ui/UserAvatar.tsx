// components/ui/UserAvatar.tsx — Pollito avatar component
// Uses avatar_url (pollito type string) from users table to render the correct pollito

import { getPollitoBase } from "@/lib/pollitos";

interface UserAvatarProps {
  avatarUrl?: string | null;
  displayName?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZES: Record<string, { css: string; px: number }> = {
  sm: { css: "w-8 h-8", px: 32 },
  md: { css: "w-10 h-10", px: 40 },
  lg: { css: "w-12 h-12", px: 48 },
  xl: { css: "w-20 h-20", px: 80 },
};

export default function UserAvatar({
  avatarUrl,
  displayName,
  size = "md",
  className = "",
}: UserAvatarProps) {
  const src = getPollitoBase(avatarUrl);
  const alt = displayName || "Avatar";
  const s = SIZES[size] || SIZES.md;

  return (
    <img
      src={src}
      alt={alt}
      width={s.px}
      height={s.px}
      className={`${s.css} rounded-full object-cover flex-shrink-0 ${className}`}
    />
  );
}
