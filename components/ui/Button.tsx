// components/ui/Button.tsx — Componente de botón reutilizable con variantes del design system colombiano
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
    primary: "bg-colombia-yellow text-colombia-blue hover:bg-yellow-400",
    secondary: "bg-white text-colombia-blue border border-gray-200 hover:bg-gray-50",
    danger: "bg-colombia-red text-white hover:bg-red-700",
  };

  return (
    <button
      className={`font-bold py-3 px-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? "Cargando..." : children}
    </button>
  );
}
