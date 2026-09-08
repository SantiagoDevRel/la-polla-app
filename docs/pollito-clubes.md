# Pollitos con camisetas de clubes colombianos

## Coordinación de infraestructura — 2026-09-08

Santiago acepta Supabase o Neon, en modalidad gratuita, pero pidió explícitamente
evitar crear bases duplicadas entre chats. Este trabajo NO crea ninguna base,
proyecto ni bucket: los avatares son archivos estáticos dentro de `public/pollitos`.
La elección sigue siendo la clave existente de `users.avatar_url`.
Al revisar el workspace se encontró Supabase ya integrado y `supabase/config.toml`
con `project_id = "la-polla"`; no se encontró configuración de Neon.
Cualquier trabajo de datos debe coordinarse con la configuración existente antes
de crear otro proyecto. El permiso para usar cualquiera no solicita una migración.

## Catálogo y compatibilidad

`lib/pollitos.ts` contiene los 20 clubes y conserva las 16 claves históricas.
`getPollitoImage`, `getPollitoBase`, `getPollitoByPosition` y
`lib/pollito/state.ts` resuelven el mismo catálogo. No hay migración de perfiles.
Las rutas versionadas `/pollitos/clubes-v1/` evitan servir el avatar anterior
desde la caché del navegador o del service worker.

Cada club tiene `base`, `lider`, `peleando` y `triste`, con imágenes WebP
transparentes de 256 × 256 para la interfaz (80 archivos, aproximadamente 1,52 MB
en total). Las rutas históricas `/pollitos/pollito_<id>_<estado>.webp` también
contienen la colección nueva, a 512 × 512, para los consumidores existentes como
las tarjetas compartidas. Los recursos de marca con sufijos `-128`, etc. son
independientes del catálogo de avatares.

Los originales de generación son imágenes
editadas con el generador integrado de ChatGPT, partiendo de los pollitos previos.
Los escudos son ilustraciones aproximadas; las camisetas conservan los colores
y patrones característicos, sin depender de patrocinadores ni de una temporada.

El selector de registro usa dos columnas por debajo de 400 px y cuatro desde
400 px: 20 opciones forman diez o cinco filas completas. Los nombres pueden
envolverse y la tarjeta permite desplazarse hasta el botón de continuar.

## Verificación (2026-09-08)

- Compilación completa `npm run build`, `npm run typecheck` y lint de los cuatro
  archivos TypeScript modificados. Lint sin errores; los avisos por `<img>` son
  intencionales porque servimos WebP preparados sin Image Optimization.
- Las 16 claves históricas siguen en el catálogo; los tres helpers de imágenes
  resuelven las mismas rutas y las claves desconocidas usan el avatar por defecto.
- 80 imágenes distintas con alfa real y dimensiones comprobadas. Las 160 rutas
  (versionadas e históricas) respondieron 200 con hashes iguales a los archivos.
- Playwright, Chrome aislado y modo oscuro: perfil a 320/390/768/1280 px;
  registro a 320/390/399/400/768/1280 px. Sin imágenes rotas, desbordamientos de
  cuadrícula ni etiquetas recortadas. Registro también con texto al 150% en 320 px.
- Selección y petición de guardado comprobadas con datos de prueba y la escritura
  interceptada. No se modificaron perfiles en la base para estas pruebas. No se
  verificó un guardado real ni una publicación en producción.
- Los 64 archivos originales y las evidencias de generación/revisión quedaron
  respaldados en Downloads, fuera del repositorio.

## Prompt de generación

Edición con preservación de identidad: cambiar solamente la camiseta del pollito
original por la del club. Mantener rostro, plumaje, peinado, expresión, pose,
proporciones, accesorios y estilo ilustrado. Para cada estado, usar la imagen
original de ese estado como objetivo y la nueva camiseta base como referencia.
Encuadre cuadrado de cuerpo completo, margen exterior, sin textos añadidos ni
patrocinadores. Fondo blanco uniforme para preparar el canal alfa; no cuadrícula
de transparencia dibujada. Exportar WebP con alfa real y comprobar sobre fondo
oscuro las zonas blancas de camisetas, balones y accesorios.

| Clave conservada/nueva | Club | Patrón de camiseta |
| --- | --- | --- |
| verde | Atlético Nacional | Franjas verticales verdes y blancas |
| millos | Millonarios | Azul, cuello y puños blancos |
| capitan | América de Cali | Roja, ribetes blancos |
| costeno | Junior | Franjas verticales rojas y blancas |
| dim | Independiente Medellín | Cuerpo rojo, mangas azules |
| rolo | Santa Fe | Cuerpo rojo, mangas blancas |
| gambeteador | Deportivo Cali | Verde, ribetes blancos |
| goleador | Deportes Tolima | Vinotinto y oro |
| arbitro | Once Caldas | Blanca, ribetes negros |
| negro | Deportivo Pereira | Franjas rojas y amarillas |
| arquero | Atlético Bucaramanga | Amarilla, hombros y ribetes verdes |
| pasto | Deportivo Pasto | Roja, detalles azules |
| tigre | Cúcuta Deportivo | Mitad roja, mitad negra |
| pibe | Unión Magdalena | Franjas verticales azules y rojas |
| rasta | Real Cartagena | Amarilla, mangas verdes |
| paisa | Atlético Huila | Amarilla con franja verde |
| envigado | Envigado | Naranja con ribetes verdes |
| chico | Boyacá Chicó | Cuadros blancos y negros |
| equidad | La Equidad | Blanca con mangas y franja verdes |
| aguilas | Águilas Doradas | Dorada con detalles negros |
