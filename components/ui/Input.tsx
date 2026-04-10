// components/ui/Input.tsx — Componente de input reutilizable "estadio de noche"
import { forwardRef } from "react";

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = "", ...props }, ref) => {
    return (
      <div>
        {label && (
          <label className="block text-sm font-medium text-text-secondary mb-1.5">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-4 py-3 rounded-xl outline-none transition-colors bg-bg-base border text-text-primary placeholder:text-text-muted ${
            error ? "border-red-alert" : "border-border-subtle focus:border-gold/50"
          } ${className}`}
          {...props}
        />
        {error && <p className="text-red-alert text-xs mt-1">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
