// app/layout.tsx — Layout raíz de la aplicación La Polla App con configuración PWA
import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "La Polla App — Polla Deportiva Colombiana",
  description:
    "La mejor polla deportiva de Colombia. Creá tu polla, invitá a tus parceros y ganá prediciendo resultados de fútbol.",
  manifest: "/manifest.json",
  icons: {
    icon: "/pollitos/logo_realistic.webp",
    apple: "/pollitos/logo_realistic.webp",
  },
};

export const viewport: Viewport = {
  themeColor: "#FCD116",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
