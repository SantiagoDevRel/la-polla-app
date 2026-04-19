// tailwind.config.ts — Tribuna Caliente v0.1 tokens + legacy aliases (transition)
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
        // Tribuna Caliente canonical tokens — defined as rgb() with the
        // <alpha-value> placeholder so Tailwind alpha modifiers (`bg-gold/10`,
        // `border-amber/25`) produce the expected tint. RGB triplets live in
        // globals.css `--*-rgb` variables.
        "bg-base": "rgb(var(--bg-base-rgb) / <alpha-value>)",
        "bg-card": "rgb(var(--bg-card-rgb) / <alpha-value>)",
        "bg-elevated": "rgb(var(--bg-elevated-rgb) / <alpha-value>)",
        "bg-subtle": "rgb(var(--bg-subtle-rgb) / <alpha-value>)",
        gold: "rgb(var(--gold-rgb) / <alpha-value>)",
        amber: "rgb(var(--amber-rgb) / <alpha-value>)",
        "amber-dim": "var(--amber-dim)",
        turf: "rgb(var(--turf-rgb) / <alpha-value>)",
        "turf-dim": "var(--turf-dim)",
        "red-alert": "rgb(var(--red-alert-rgb) / <alpha-value>)",
        "text-primary": "rgb(var(--text-primary-rgb) / <alpha-value>)",
        "text-secondary": "rgb(var(--text-secondary-rgb) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted-rgb) / <alpha-value>)",
        "border-subtle": "var(--border-subtle)",
        "border-default": "var(--border-default)",
        "border-strong": "var(--border-strong)",

        // Legacy aliases — kept so existing Tailwind classes keep rendering.
        // Drop in Phase 2 after components migrate.
        "bg-card-hover": "var(--bg-card-hover)",
        "bg-card-elevated": "var(--bg-card-elevated)",
        "border-medium": "var(--border-medium)",
        "gold-dim": "var(--gold-dim)",
        "green-live": "var(--green-live)",
        "green-dim": "var(--green-dim)",
        "red-dim": "var(--red-dim)",
        "blue-info": "var(--blue-info)",
      },
      fontFamily: {
        sans: ["var(--font-body)", "'Outfit'", "Arial", "sans-serif"],
        display: ["var(--font-display)", "'Bebas Neue'", "sans-serif"],
        body: ["var(--font-body)", "'Outfit'", "sans-serif"],
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "18px",
        xl: "24px",
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
