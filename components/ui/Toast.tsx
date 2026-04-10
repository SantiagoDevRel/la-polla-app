// components/ui/Toast.tsx — Sistema global de toasts "estadio de noche"
// Borde izquierdo colored, fondo bg-elevated, animación slide-up
"use client";

import { createContext, useContext, useState, useCallback } from "react";

type ToastType = "success" | "error" | "info";
interface Toast { id: string; message: string; type: ToastType; }
interface ToastContextValue { showToast: (message: string, type?: ToastType) => void; }

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

const BORDER_COLORS: Record<ToastType, string> = {
  success: "var(--green-live)",
  error: "var(--red-alert)",
  info: "var(--gold)",
};

const ICONS: Record<ToastType, string> = {
  success: "✅",
  error: "❌",
  info: "ℹ️",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-20 left-0 right-0 z-50 flex flex-col items-center gap-2 px-4 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="max-w-sm w-full pointer-events-auto animate-slide-up"
            style={{
              backgroundColor: "var(--bg-card-elevated)",
              border: "1px solid var(--border-medium)",
              borderLeft: `3px solid ${BORDER_COLORS[toast.type]}`,
              borderRadius: "12px",
              padding: "12px 16px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            }}
          >
            <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
              {ICONS[toast.type]} {toast.message}
            </span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
