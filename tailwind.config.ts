// tailwind.config.ts — Sistema de diseño "estadio de noche" + colores legacy
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Nuevo sistema de diseño
        "bg-base": "#080c10",
        "bg-card": "#0e1420",
        "bg-card-hover": "#152032",
        "bg-elevated": "#192840",
        "border-subtle": "#1a2535",
        "border-medium": "#243448",
        gold: "#FFD700",
        "gold-dim": "rgba(255, 215, 0, 0.15)",
        "green-live": "#00e676",
        "green-dim": "rgba(0, 230, 118, 0.12)",
        "red-alert": "#ff3d57",
        "red-dim": "rgba(255, 61, 87, 0.12)",
        "blue-info": "#4fc3f7",
        "text-primary": "#eef2ff",
        "text-secondary": "#7089aa",
        "text-muted": "#3d5470",
        // Card elevated for intermediate surfaces
        "bg-card-elevated": "#192840",
      },
      fontFamily: {
        sans: ["'Outfit'", "Arial", "sans-serif"],
        display: ["'Bebas Neue'", "cursive"],
      },
      keyframes: {
        "fade-in-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(100%)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.2s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
