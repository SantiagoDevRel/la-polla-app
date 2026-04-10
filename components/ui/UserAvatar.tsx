// components/ui/UserAvatar.tsx — Avatar con Dicebear fallback
// Usa avatar_url si existe, sino genera un avatar Dicebear con el UUID como seed

interface UserAvatarProps {
  userId: string;
  avatarUrl?: string | null;
  displayName?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZES = {
  sm: "w-8 h-8",
  md: "w-10 h-10",
  lg: "w-12 h-12",
  xl: "w-20 h-20",
};

function getDicebearUrl(seed: string) {
  return `https://api.dicebear.com/9.x/adventurer/svg?seed=${seed}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffd5dc,ffdfbf`;
}

export default function UserAvatar({
  userId,
  avatarUrl,
  displayName,
  size = "md",
  className = "",
}: UserAvatarProps) {
  const src = avatarUrl || getDicebearUrl(userId);
  const alt = displayName || "Avatar";

  return (
    <img
      src={src}
      alt={alt}
      className={`${SIZES[size]} rounded-full object-cover flex-shrink-0 ${className}`}
    />
  );
}
