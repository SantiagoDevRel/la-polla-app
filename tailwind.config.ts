// tailwind.config.ts — "Parche" v1.0 · el lenguaje visual de calle
//
// Reemplaza a Tribuna Caliente v0.1 (premium, dorado, redondeado). Los NOMBRES
// de los tokens se mantienen a proposito: repuntando los valores, los ~600 usos
// de `bg-card`, `text-gold`, `border-subtle`, etc. que ya existen en la app se
// reskinnean solos, sin tocar 100 componentes a mano.
//
// La jugada clave: `borderRadius` queda en 0 ENTERO, incluido `full`. Eso mata
// de un golpe las 201 `rounded-full` y las 400 y pico `rounded-xl/lg/2xl` que
// daban el look burbuja. Si algun dia hace falta una esquina redonda puntual,
// esta `rounded-pill` — pero es la excepcion, no el default.
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
        // Superficies: concreto, no vidrio.
        "bg-base": "rgb(var(--bg-base-rgb) / <alpha-value>)",
        "bg-card": "rgb(var(--bg-card-rgb) / <alpha-value>)",
        "bg-elevated": "rgb(var(--bg-elevated-rgb) / <alpha-value>)",
        "bg-subtle": "rgb(var(--bg-subtle-rgb) / <alpha-value>)",

        // El acento. `gold` ahora es CAL (verde limon de spray): conserva el
        // nombre para no romper los usos existentes, pero ya no es premium.
        gold: "rgb(var(--gold-rgb) / <alpha-value>)",
        cal: "rgb(var(--gold-rgb) / <alpha-value>)", // alias legible
        amber: "rgb(var(--amber-rgb) / <alpha-value>)",
        "amber-dim": "var(--amber-dim)",
        turf: "rgb(var(--turf-rgb) / <alpha-value>)",
        "turf-dim": "var(--turf-dim)",
        "red-alert": "rgb(var(--red-alert-rgb) / <alpha-value>)",

        "text-primary": "rgb(var(--text-primary-rgb) / <alpha-value>)",
        "text-secondary": "rgb(var(--text-secondary-rgb) / <alpha-value>)",
        "text-muted": "rgb(var(--text-muted-rgb) / <alpha-value>)",

        // Bordes SOLIDOS. El look de calle es linea dura, no velo translucido.
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
        sans: ["var(--font-body)", "'Barlow'", "Arial", "sans-serif"],
        display: ["var(--font-display)", "'Anton'", "Impact", "sans-serif"],
        body: ["var(--font-body)", "'Barlow'", "sans-serif"],
      },
      // Todo cuadrado. `full` incluido: es lo que borra el look burbuja.
      borderRadius: {
        none: "0",
        DEFAULT: "0",
        sm: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        "3xl": "0",
        full: "0",
        // Escotilla de escape para el caso puntual que de verdad la pida.
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
        // Cinta de peligro amarillo/negro para avisos.
        hazard:
          "repeating-linear-gradient(45deg, var(--hazard-a) 0 10px, var(--hazard-b) 10px 20px)",
        // Concreto: ruido finito, casi imperceptible, que le quita el plano
        // digital al fondo.
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
