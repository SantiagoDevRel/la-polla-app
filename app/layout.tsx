// app/layout.tsx — Layout raíz de la aplicación La Polla App con configuración PWA
import type { Metadata, Viewport } from "next";
import { Bebas_Neue, Outfit } from "next/font/google";
import "./globals.css";
import { SplashScreen } from "@/components/layout/SplashScreen";

const bebas = Bebas_Neue({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
  display: "swap",
});

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

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
    <html lang="es" className={`${bebas.variable} ${outfit.variable}`}>
      <body className="antialiased">
        <SplashScreen />
        {children}
      </body>
    </html>
  );
}
