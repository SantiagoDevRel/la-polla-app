// components/ui/Input.tsx — Componente de input reutilizable con estilos del design system
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
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={`w-full px-4 py-3 border rounded-xl focus:ring-2 focus:ring-colombia-yellow focus:border-transparent outline-none ${
            error ? "border-colombia-red" : "border-gray-300"
          } ${className}`}
          {...props}
        />
        {error && <p className="text-colombia-red text-xs mt-1">{error}</p>}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
