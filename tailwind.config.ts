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
        // Tribuna Caliente canonical tokens — map to CSS variables so a theme
        // swap only needs globals.css.
        "bg-base": "var(--bg-base)",
        "bg-card": "var(--bg-card)",
        "bg-elevated": "var(--bg-elevated)",
        "bg-subtle": "var(--bg-subtle)",
        gold: "var(--gold)",
        amber: "var(--amber)",
        "amber-dim": "var(--amber-dim)",
        turf: "var(--turf)",
        "turf-dim": "var(--turf-dim)",
        "red-alert": "var(--red-alert)",
        "text-primary": "var(--text-primary)",
        "text-secondary": "var(--text-secondary)",
        "text-muted": "var(--text-muted)",
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
