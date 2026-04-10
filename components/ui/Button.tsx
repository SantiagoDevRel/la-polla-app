// components/ui/Button.tsx — Componente de botón reutilizable con variantes "estadio de noche"
interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger";
  loading?: boolean;
}

export default function Button({
  children,
  variant = "primary",
  loading = false,
  className = "",
  disabled,
  ...props
}: ButtonProps) {
  const variants = {
    primary: "bg-gold text-bg-base hover:brightness-110",
    secondary: "bg-bg-card text-text-secondary border border-border-subtle hover:bg-bg-card-hover",
    danger: "bg-red-alert text-bg-base hover:brightness-110",
  };

  return (
    <button
      className={`font-bold py-3 px-4 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? "Cargando..." : children}
    </button>
  );
}
