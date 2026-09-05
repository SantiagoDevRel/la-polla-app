"use client";

// app/global-error.tsx — Fallback de último recurso cuando un error rompe el
// render del root layout.

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          padding: "24px",
          textAlign: "center",
          background: "#080c10",
          color: "#F5F7FA",
          fontFamily:
            "Outfit, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <h1 style={{ fontSize: "20px", fontWeight: 600, margin: 0 }}>
          Algo salió mal
        </h1>
        <p style={{ color: "#AEB7C7", maxWidth: "360px", margin: 0 }}>
          Tuvimos un problema cargando la app. Intenta nuevamente en unos
          segundos.
        </p>
        <button
          onClick={() => reset()}
          style={{
            marginTop: "8px",
            padding: "12px 20px",
            borderRadius: "9999px",
            border: "none",
            background: "#FFD700",
            color: "#080c10",
            fontWeight: 600,
            fontSize: "15px",
            cursor: "pointer",
          }}
        >
          Reintentar
        </button>
      </body>
    </html>
  );
}
