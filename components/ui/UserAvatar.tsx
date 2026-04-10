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

export default function UserAvatar({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  userId: _userId,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  avatarUrl: _avatarUrl,
  displayName,
  size = "md",
  className = "",
}: UserAvatarProps) {
  // Temporary: all users get the same pollito logo until more variants are added
  const src = "/pollitos/logo.png";
  const alt = displayName || "Avatar";

  return (
    <img
      src={src}
      alt={alt}
      className={`${SIZES[size]} rounded-full object-cover flex-shrink-0 ${className}`}
    />
  );
}
