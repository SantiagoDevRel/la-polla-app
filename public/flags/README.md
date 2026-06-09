# Banderas nacionales (self-hosted)

SVGs de banderas nacionales en aspect ratio 4x3, servidos same-origin
para las vistas de partidos (selecciones del Mundial, Copa América, etc.).

- **Fuente:** [lipis/flag-icons](https://github.com/lipis/flag-icons) tag `7.0.0`.
- **Licencia:** el código de flag-icons es MIT; las banderas en sí son
  símbolos nacionales de dominio público (CC0). Re-distribuibles sin
  restricción.
- **Por qué self-hosted (2026-06-09):** antes se cargaban desde el CDN de
  jsDelivr. La dependencia remota rompía las banderas en el WebView iOS y
  cuando el Service Worker cacheaba una respuesta mala → caía al fallback
  de iniciales ("MEX"/"COL"). Same-origin: sin CSP/CORS, offline-friendly,
  sin rate limits, más rápido.

Los nombres de archivo son ISO 3166-1 alpha-2 (`mx.svg`, `co.svg`) más los
sub-codes de UK que flag-icons soporta (`gb-eng`, `gb-sct`, `gb-wls`,
`gb-nir`). El mapeo nombre-de-selección → ISO vive en
`lib/flags/country-iso.ts`.

Para agregar una bandera nueva: agregá el alias en `country-iso.ts` y bajá
el SVG correspondiente a esta carpeta con el nombre del ISO code.
