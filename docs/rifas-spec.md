# Rifas de creadores habilitados — especificación

## Objetivo de negocio
Que cualquier persona pueda usar La Polla para crear y administrar SUS rifas (las que hoy maneja
en un pantallazo de WhatsApp/Instagram), para que sus compradores se registren en La Polla. La
rifa es la puerta de entrada: cada comprador nuevo es una cuenta nueva que después ve las pollas.
Métrica que importa: compradores de rifas que crean cuenta y luego entran a una polla.

## Antes de escribir código (obligatorio)
1. Trabaja en la rama `feat/rifas-usuarios` (sale de main y ya contiene este documento).
   Traer main actualizado antes de empezar. PR a main.
2. Lee `CLAUDE.md` completo, `docs/casa-admin-rules.md`, `docs/casa-v2-production.md` y
   `docs/design-system.md`. Reglas que aplican directo: RLS + GRANT explícitos en tablas nuevas,
   nunca `select("*")`, dinero calculado en SQL, fechas en Colombia con `lib/time/colombia.ts`,
   copy en tú con tono neutro (sin "parce", "plata", "pantallazo"), sin emojis en la UI,
   textos mínimos, oro máximo 3 veces por pantalla, y text-zoom al 200 %.
3. **Reutiliza, no dupliques.** Casa ya tiene una modalidad `rifa` (`casa_pollas.kind='rifa'`,
   `components/casa/Boletas.tsx`, `app/api/casa/pollas/[slug]/tickets`, `ResolverPolla.tsx`),
   un flujo completo de comprobantes (subida, revisión, aprobar/rechazar, bucket privado), la
   cuenta de pago por polla (migración 085) y la cuenta donde cobra el usuario (payout por
   defecto, migraciones 052/053). También hay `app/api/share-card` para generar imágenes.
   Antes de diseñar, haz un inventario de qué se reutiliza tal cual, qué se generaliza y qué es
   nuevo, y muéstralo en el PR.
4. Diferencia de fondo con Casa: en Casa solo el administrador crea y cobra. Acá **cada creador
   habilitado por un admin crea las suyas**, la plata va directo a SU cuenta (nunca pasa por La Polla) y él revisa los
   comprobantes. Decide y justifica si esto va en tablas propias (`rifa_*`) o extendiendo
   `casa_*`; no rompas las reglas de liquidación de Casa ni sus rifas existentes.

## Permiso para crear rifas (decidido)
Crear rifas NO es para todos: solo usuarios que un administrador habilite.
- **Panel admin → "Creadores de rifas"** (`/admin/rifas/creadores` o dentro del admin
  existente): buscar un usuario por nombre o celular, asignarle el permiso y quitárselo. Lista de
  creadores actuales con cuántas rifas tiene activas.
- El permiso vive en la DB (tabla o columna con `granted_by`, `granted_at`, `revoked_at`), nunca
  en variables de entorno ni en el cliente. Se valida en el servidor y en RLS/RPC al crear.
  Solo `users.is_admin` puede asignar o quitar.
- Quitar el permiso impide crear rifas nuevas, pero sus rifas en curso siguen funcionando hasta
  cerrarse (los compradores ya pagaron). El admin puede además ocultar una rifa puntual.
- Queda registro de quién asignó/quitó y cuándo.

## Dónde vive la interfaz del creador (decidido)
- En **Perfil**, un botón **"Crear mi rifa"**, visible SOLO para creadores habilitados. A quien
  no tiene el permiso no se le muestra nada (ni botón apagado ni texto explicando).
- Debajo, en Perfil, **"Mis rifas"**: las rifas que creé, con acceso a su tablero, comprobantes
  pendientes (con contador), venta por fuera, exportar y resultado.
- La pestaña RIFAS de la pantalla de Pollas queda para el lado comprador.

## Creador de la rifa
- Crear rifa con:
  - **Visibilidad: Privada o Pública** (Privada por defecto).
    - **Privada**: solo la ven el creador y los administradores (`users.is_admin`). Nadie más
      puede abrirla ni por enlace (validado en servidor y RLS, no solo ocultando botones). Sirve
      para probar: tablero, venta por fuera, estados, exportar imagen y resultado funcionan
      igual que en una pública.
    - **Pública**: la puede abrir y comprar cualquiera con cuenta (ver decisión de listado).
    - Se puede pasar de Privada a Pública; de Pública a Privada solo si todavía no hay
      números reservados ni pagados por otras personas.
  - Nombre y premio: **dinero** (número en COP) o **texto** (ej. "Boleta Sur para el clásico").
    Foto opcional del premio.
  - Números: de 00 a 99 (100 como máximo). Deja preparado permitir menos (ej. 00–49).
  - Valor por número (COP).
  - "¿Con qué se juega?": lotería por nombre (texto libre con sugerencias: Lotería de Medellín,
    Astro Sol, Chontico, etc.) y qué cifras cuentan (por defecto las dos últimas).
  - Fecha y hora de cierre = fecha/hora del sorteo por ahora (hora Colombia). Al cierre no se
    aceptan más reservas; los comprobantes pendientes sí se pueden seguir revisando.
  - Dónde recibe el pago: método (Nequi, Bancolombia, Daviplata, otro), número y titular.
    Prellenado con lo último que usó.
- Tablero de 100 casillas con tres estados:
  - **Libre**: fondo claro.
  - **Reservado** (escogido, pago pendiente): verde claro.
  - **Pagado**: verde oscuro.
  Además de color, cada estado se distingue por forma o ícono (no solo color, por accesibilidad).
- Revisar comprobantes: ver el comprobante, aprobar (el número pasa a Pagado) o rechazar (vuelve
  a Libre y se le avisa al comprador). Revertir una aprobación deja rastro de auditoría.
- Venta por fuera de la app: tocar un número Libre → nombre + celular → marcar "Reservado" o
  "Pagado". Esa persona no necesita cuenta; si más adelante se registra con ese celular, que la
  rifa le aparezca.
- Liberar un número reservado a mano.
- Resultado: después del sorteo el creador escribe el número ganador. Se muestra a todos.
  Definir y mostrar qué pasa si el número ganador **no se vendió** (propuesta: el creador elige
  entre "se vuelve a jugar con otro sorteo" o "queda desierta"; nunca queda en silencio).
- Exportar imagen para historia (1080×1920, PNG): nombre de la rifa, premio, tablero con los
  números tomados marcados, fecha, lotería, valor, y el enlace o QR para comprar. Referencia
  adjunta en el chat, no versionada (historia de Instagram de una rifa "Boleta Sur,
  Nacional vs Medellín": título grande, escudos, tablero 10×10 con chulos verdes en los tomados,
  franja inferior con "Juega el 13 de octubre · Lotería Astro Sol · Valor $6.000").
- Plantillas para exportar: varias, siempre con la marca La Polla. Arranca con una neutra y un
  pollito con los colores de un club (reutiliza el catálogo de `docs/pollito-clubes.md`, no
  inventes camisetas nuevas). Ojo con usar escudos oficiales de clubes en piezas de promoción:
  por defecto usa colores y pollito, y los escudos solo si el creador los elige.
- Compartir enlace de la rifa por WhatsApp (enlace `wa.me/?text=` que abre los contactos del
  creador; La Polla NO envía mensajes desde su número, WhatsApp saliente está apagado).

## Comprador
- En la pantalla principal de Pollas, pestañas arriba **POLLAS | RIFAS** (POLLAS por defecto).
- En RIFAS: las rifas donde compré, las que creé y las abiertas por enlace. **Decidir** si las
  rifas de otros usuarios se listan públicamente para todos o solo se llega por enlace
  (recomendación: solo por enlace + las mías; un listado público convierte a La Polla en vitrina
  de rifas de terceros, con riesgo legal y de fraude).
- Entrar por enlace sin cuenta: ve el tablero y, al elegir número, se le pide registrarse (SMS).
  Ese es el embudo de registro: medirlo.
- Elegir uno o varios números → quedan Reservados a su nombre → ve la cuenta del creador con
  botón Copiar → sube el comprobante (mismo flujo de comprobantes de Casa).
- **Vencimiento de reservas**: una reserva sin comprobante vuelve a Libre después de un tiempo
  (propuesta: 30 min, configurable). Sin esto, alguien bloquea los 100 números sin pagar.
- Si el premio es dinero: se usa la cuenta de cobro que la persona ya tiene en su perfil; si no
  tiene, se la pide antes de confirmar la compra.
- Si el premio es texto: se le avisa que el creador lo contactará por WhatsApp al celular con el
  que se registró. El creador ve un botón que abre WhatsApp al número del ganador.

## Reglas técnicas no negociables
- Reserva de números **atómica en SQL** (RPC con bloqueo; unicidad por rifa + número). Dos
  personas tocando el 07 al mismo tiempo: solo una lo obtiene y la otra ve un mensaje claro.
- Autorización en el servidor: solo el creador aprueba, rechaza, vende por fuera o cierra su
  rifa. Validar sesión antes de tocar la DB. RLS en todas las tablas nuevas.
- Privacidad (Ley 1581): los celulares y nombres de los compradores solo los ve el creador. El
  tablero público y la imagen exportada muestran estados, nunca nombres ni celulares.
- Comprobantes en bucket privado con URLs firmadas; solo el creador y el dueño del comprobante.
- Límites anti-abuso (además del permiso de creador): rifas activas por creador, reservas por comprador, y botón "Reportar
  rifa". Los administradores de La Polla pueden ocultar una rifa.
- Rutas autenticadas `NetworkOnly` en el service worker. Imágenes en tamaño real, sin
  `next/image` (free tier).
- Todo detrás de un flag (`RIFAS_ENABLED`, apagado por defecto). No aplicar migraciones en
  producción sin mi OK explícito.

## Decisiones que necesito tomar (pregúntamelas al inicio, no las asumas)
1. **Legal**: en Colombia las rifas son juegos de suerte y azar regulados (Coljuegos / Ley 643).
   Que La Polla aloje rifas de terceros con dinero puede exponer a la plataforma. Antes de abrirlo
   al público, corre una revisión con `agent-legal-colombia` y propón cómo presentarlo
   (herramienta de gestión, dinero directo al creador, términos y aviso visibles, quién responde).
2. ¿La Polla cobra algo por rifa o es gratis para atraer usuarios?
3. ¿Listado público de rifas o solo por enlace? (ver arriba)
4. Tiempo de vencimiento de una reserva sin comprobante.
5. Qué pasa si sale un número que nadie compró.

## Modo de trabajo: sin pararte a preguntar
No voy a estar pendiente mientras trabajas. NO te detengas a esperar respuestas: para cada
decisión pendiente toma la recomendación de este documento (listado solo por enlace, reserva
de 30 min, número no vendido = el creador elige "volver a jugar" o "desierta", sin cobro de La
Polla), déjala en un solo lugar configurable y anótala en la descripción del PR para que yo la
confirme. La revisión legal va como informe en el PR; no bloquea, porque la primera prueba es
con rifas Privadas entre administradores.

## Entregables y orden
1. Inventario de reutilización + modelo de datos + decisiones tomadas (en el PR, sin parar).
2. MVP: permiso de creador en admin, "Crear mi rifa" en Perfil, crear rifa, tablero, reservar, comprobante, aprobar/rechazar, venta por fuera, cierre y
   ganador.
3. Exportar imagen con 2 plantillas; después más plantillas por club.
4. Pestaña RIFAS y embudo de registro medido.

## Verificación antes de decir "listo"
- `npm run build` y las pruebas del repo; pruebas SQL de concurrencia de reservas (dos
  reservas simultáneas del mismo número) y de permisos (un usuario sin permiso no puede crear rifas ni por la API; un no-creador no puede
  aprobar; solo un admin asigna creadores).
- E2E con Supabase local (nunca contra producción): admin asigna creador → aparece "Crear mi
  rifa" en su Perfil → crear rifa → comprador reserva → sube
  comprobante → creador aprueba → número Pagado → vence una reserva → exportar imagen.
- Playwright en 320, 390 y 768 px, modo oscuro, text-zoom 200 %; revisa que el tablero 10×10 se
  lea en 320 px y que la imagen exportada se vea bien en una historia real.
- Si en este entorno no puedes levantar Supabase local, dilo explícito en el PR y deja las
  pruebas SQL y el paso a paso listos para correrlos en local. Nunca digas "listo" sin prueba.
- Actualiza README y CLAUDE.md con la sección de Rifas.
- Al final del PR: lista corta de "cómo probarlo" (migraciones a aplicar, flag a prender, cómo
  asignar creador, y el recorrido a hacer con una rifa Privada).
