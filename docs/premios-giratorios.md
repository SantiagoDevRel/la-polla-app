# Premios giratorios de James y el millón

El catálogo `components/casa/prize-media.ts` aporta los visuales de POLLA JAMES
y OFIGOLAZO4 en Inicio y en `/polla/[slug]`. El acceso y la publicación siguen
pasando por las reglas existentes de Casa. El catálogo no modifica datos.

Cada premio tiene 144 poses transparentes, cada 2,5 grados. `PrizeTurntable`
selecciona una pose sin mover el premio: 192 px en miniaturas y 512 px en el
visor, seis poses por página WebP y tres páginas referenciadas por instancia.
El dinero conserva diez objetos de papel, dos grupos de cinco, con curvatura,
espesor y cantos visibles al mostrar el perfil.

Arrastrar media anchura del control gira 180 grados. Admite mouse, touch y
cambios de dirección sin soltar. Al liberar continúa desde la pose alcanzada.
Conserva scroll vertical y zoom. Movimiento reducido y ahorro de datos detienen
el giro automático; el gesto manual sigue disponible. Flechas: 15 grados;
Home: frente; End: espalda; Enter o espacio: pausa/reanudación.

Las dos fotos originales permiten revisar el autógrafo y el dorsal. El giro
es una reconstrucción visual. Las fotos no tienen EXIF/GPS ni metadata personal.
Los billetes parten de referencias del Banco de la República; el microtexto
tapado por la sobreimpresión es una reconstrucción.

## Archivos y caché

Los 106 archivos aprobados están en `public/prizes/v3-30099c32d6c6/`: atlas,
poster, caras, fotos y los dos formatos de animación de respaldo de la camiseta.
Total: 16.292.903 bytes. Esta ruta tiene caché immutable por un año; cualquier
cambio de contenido debe crear otra carpeta versionada. No cambiar sus bytes.
Se cargan bajo demanda: el worker no los agrega al precache y las páginas/API
de Casa conservan NetworkOnly. No hay proveedor, bucket ni dependencia nueva.

Los renders fuente, modelos, manifiestos de custodia, sesiones sintéticas y
reportes permanecen en `C:/Users/STZTR/Downloads/la-polla-premios-20261004/`.
No se incluyen en Git ni en el upload de Vercel. `.vercelignore` conserva su
allowlist y admite `/assets` para las fuentes y personajes de historias de rifas.
Las variables para verificar el build viven fuera de la carpeta desplegable.

## Publicación

El usuario autorizó producción y publicación de ambas pollas el 4 de octubre
de 2026. Usar el endpoint administrativo existente, contrato v2: actualizar
solo `prizeObject` de James con el texto aprobado y después la acción
`publicacion`, `mode: ahora`. No crear pollas, inscripciones o pronósticos,
ni cambiar precios, fechas, partidos, cuentas de cobro o protocolos operativos.

UUID James: `e5e5719d-bdaf-407d-bf8d-b856338709a9`.
UUID OFIGOLAZO4: `05f83cb8-d16d-42fd-a6b8-a0840c9b0cf9`.

## Validación

Build de Next con configuración de producción, TypeScript, lint, pruebas de
borradores y recorrido visual de Inicio/detalles. Revisar 320, 390, 768 y
1440 px, texto al 200 %, fuentes, fotos y giro en ambos sentidos. Verificar
las respuestas de medios y que ambas filas de billetes sigan visibles durante
el giro. Touch se verifica por emulación en Chrome; iPhone físico pendiente.
