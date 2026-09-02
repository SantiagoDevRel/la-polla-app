// tailwind.config.ts — Tribuna Caliente v1.1 · el skin de siempre, de vuelta
//
// (2026-09-02) Deshace "Parche v1.0". Ese intento apago la app: radio 0 en
// TODO, dorado cambiado por verde cal y las dos familias cambiadas por Anton +
// Barlow. El resultado se leia como plantilla, no como producto.
//
// La mecanica que si valia la pena se conserva: los NOMBRES de los tokens no
// cambian nunca, solo sus valores. Por eso este archivo revierte los ~600 usos
// de `bg-card`, `text-gold`, `border-subtle` sin tocar un solo componente.
//
// `borderRadius` vuelve a la escala 8/12/18/24 y `full` vuelve a ser 9999px:
// eso solo devuelve las 201 `rounded-full` y las ~400 `rounded-xl/lg/2xl` que
// daban la silueta de la app. `rounded-pill` se queda como alias de `full`
// para no romper lo que ya lo escribio durante el interludio Parche.
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
        // Superficies: vidrio oscuro sobre el estadio, no concreto.
        "bg-base": "rgb(var(--bg-base-rgb) / <alpha-value>)",
        "bg-card": "rgb(var(--bg-card-rgb) / <alpha-value>)",
        "bg-elevated": "rgb(var(--bg-elevated-rgb) / <alpha-value>)",
        "bg-subtle": "rgb(var(--bg-subtle-rgb) / <alpha-value>)",

        // El acento. `gold` vuelve a ser ORO (#FFD700) y es SAGRADO: senal de
        // premio, maximo 3 apariciones por pantalla. `cal` queda apuntando al
        // mismo token para no romper lo que se escribio en el interludio.
        gold: "rgb(var(--gold-rgb) / <alpha-value>)",
        cal: "rgb(var(--gold-rgb) / <alpha-value>)", // alias heredado
        amber: "rgb(var(--amber-rgb) / <alpha-value>)",
        "amber-dim": "var(--amber-dim)",
        turf: "rgb(var(--turf-rgb) / <alpha-value>)",
        "turf-dim": "var(--turf-dim)",
        "red-alert": "rgb(var(--red-alert-rgb) / <alpha-value>)",

        "text-primary": "rgb(var(--text-primary-rgb) / <alpha-value>)",
        "text-secondary": "rgb(var(--text-secondary-rgb) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted-rgb) / <alpha-value>)",

        // Bordes: velo translucido otra vez — el fondo tiene que respirar.
        "border-subtle": "var(--border-subtle)",
        "border-default": "var(--border-default)",
        "border-strong": "var(--border-strong)",

        // Aliases heredados — siguen resolviendo para no romper nada viejo.
        "bg-card-hover": "var(--bg-card-hover)",
        "bg-card-elevated": "var(--bg-card-elevated)",
        "border-medium": "var(--border-default)",
        "gold-dim": "var(--gold-dim)",
        "green-live": "var(--turf)",
        "green-dim": "var(--green-dim)",
        "red-dim": "var(--red-dim)",
        "blue-info": "var(--blue-info)",
      },
      fontFamily: {
        sans: ["var(--font-body)", "'Outfit'", "Arial", "sans-serif"],
        display: ["var(--font-display)", "'Bebas Neue'", "sans-serif"],
        body: ["var(--font-body)", "'Outfit'", "sans-serif"],
      },
      // La escala de siempre. `full` vuelve a redondear de verdad; `pill` se
      // queda como alias para no romper lo escrito durante Parche.
      borderRadius: {
        none: "0",
        DEFAULT: "12px",
        sm: "8px",
        md: "12px",
        lg: "18px",
        xl: "24px",
        "2xl": "18px",
        "3xl": "24px",
        full: "9999px",
        pill: "9999px",
      },
      borderWidth: {
        DEFAULT: "1px",
        3: "3px",
      },
      letterSpacing: {
        stencil: "0.06em",
        shout: "0.12em",
      },
      backgroundImage: {
        // Cinta de aviso. Se conserva la utilidad (hay avisos que la usan) pero
        // en dorado sobre negro, que es la paleta de la casa.
        hazard:
          "repeating-linear-gradient(45deg, var(--hazard-a) 0 10px, var(--hazard-b) 10px 20px)",
        // Grano fino. Ya no hace de "concreto": protege del banding en OLED
        // sobre el video del fondo.
        concrete: "var(--concrete-noise)",
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
        "hazard-scroll": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "56.6px 0" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.2s ease-out",
        "slide-up": "slide-up 0.3s ease-out",
        hazard: "hazard-scroll 2s linear infinite",
      },
    },
  },
  plugins: [],
};
export default config;
