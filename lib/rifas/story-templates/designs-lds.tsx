// Plantillas de Los Del Sur (lib/rifas/partner.ts). Mismo contrato de datos que
// las de La Polla (StoryFrame): cambia el arte. Encabezado con el escudo de la
// barra, pollito barrista grande arriba a la derecha y La Polla solo en el pie,
// pequeña, junto al dominio. Fotos y escudo vienen como data URIs locales.
//
// (2026-11-07, pedido del dueño) Las seis llevan de fondo una foto REAL de la
// barra, del Instagram oficial @ldsoficial (scripts/bake-rifa-lds-fondos.py):
// nada de arte generado. Los paneles dejan ver la foto alrededor del tablero.
import { display, StoryFrame, type Treatment } from "./common";
import type { StoryProps } from "./types";

const GREEN = "#1E9A44";
const GREEN_LIGHT = "#5BE08A";
const NIGHT = "#06140C";
const WHITE = "#F5F7FA";
/** Premio, fecha y dominio: casi opacos, el texto se lee sobre cualquier foto. */
const PANEL = "rgba(4, 16, 9, 0.84)";
/** El tablero tiene casillas blancas propias: su fondo deja pasar más foto. */
const BOARD = "rgba(4, 16, 9, 0.6)";
/** Sombra para el texto que va directo sobre la foto. */
const LIFT = "0 2px 4px rgba(0,0,0,0.9), 0 0 18px rgba(0,0,0,0.75)";
/** Lema bajo «LOS DEL SUR» (2026-11-07, pedido del dueño: «líderes del barrismo social» en algunas). */
const COMBOS = "LA BARRA Y SUS COMBOS";
const LIDERES = "LÍDERES DEL BARRISMO SOCIAL";

/**
 * Oscurece arriba (encabezado y título) y abajo (fecha y dominio) y deja la
 * foto más clara en el medio. `strength` sube todo para fotos de día.
 */
function shade(strength = 0) {
  const a = (v: number) => Math.min(0.95, v + strength).toFixed(2);
  return `linear-gradient(180deg, rgba(3,10,6,${a(0.56)}) 0%, rgba(3,10,6,${a(0.4)}) 14%, rgba(3,10,6,${a(0.36)}) 24%, rgba(3,10,6,${a(0.26)}) 45%, rgba(3,10,6,${a(0.4)}) 70%, rgba(3,10,6,${a(0.76)}) 100%)`;
}

function Photo({ src, strength }: { src: string | null; strength?: number }) {
  return <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: 1080, height: 1920 }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- JPEG embedded in next/og */}
    {src && <img src={src} width={1080} height={1920} alt="" style={{ position: "absolute", top: 0, left: 0 }} />}
    <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: 1080, height: 1920, backgroundImage: shade(strength) }} />
  </div>;
}

function Header({ escudo, tagline }: { escudo: string; tagline: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 22, position: "absolute", left: 56, top: 40 }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- PNG embedded in next/og */}
    <img src={escudo} width={132} height={132} alt="" />
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ ...display, fontSize: 76, color: WHITE, textShadow: LIFT }}>LOS DEL SUR</span>
      <span style={{ fontSize: 24, letterSpacing: tagline.length > 22 ? 3 : 5, color: GREEN_LIGHT, textShadow: LIFT }}>{tagline}</span>
    </div>
  </div>;
}

/** Base común: foto de la barra, encabezado, pollito grande, casillas blancas con borde verde, La Polla al pie. */
function lds(props: StoryProps, theme: Partial<Treatment> & { strength?: number; tagline?: string }) {
  const art = props.partner;
  const { strength, titleStyle, tagline = COMBOS, ...rest } = theme;
  return StoryFrame(props, {
    background: NIGHT, panel: PANEL, accent: GREEN_LIGHT, cell: WHITE, cellBorder: GREEN, radius: 10,
    title: "RIFA SUREÑA", titleSize: 100, titleTop: 190, nameWidth: 640,
    pollitoSize: 320, pollitoTop: -170, pollitoRight: -50, footerLogo: true, nameShadow: LIFT,
    titleStyle: { textShadow: LIFT, ...titleStyle },
    boardStyle: { border: `3px solid ${GREEN}`, background: BOARD },
    header: art ? <Header escudo={art.escudo} tagline={tagline} /> : undefined,
    backdrop: <Photo src={art?.background ?? null} strength={strength} />,
    ...rest,
  });
}

export function tribuna(props: StoryProps) {
  return lds(props, {});
}

export function combos(props: StoryProps) {
  return lds(props, { title: "RIFA DEL BARRIO", strength: 0.08 });
}

export function humo(props: StoryProps) {
  return lds(props, { tagline: LIDERES });
}

export function trapo(props: StoryProps) {
  const art = props.partner;
  return lds(props, {
    // El trapo de la barra hace de título.
    titleNode: art
      ? <img src={art.trapo} width={620} height={104} alt="" style={{ marginBottom: 4 }} /> /* eslint-disable-line @next/next/no-img-element */
      : undefined,
  });
}

export function escudo(props: StoryProps) {
  return lds(props, { title: "SIEMPRE PRESENTES", titleSize: 84, tagline: LIDERES });
}

export function sombrillas(props: StoryProps) {
  // Foto de día con cielo blanco: más sombra para que el texto blanco se lea igual.
  return lds(props, { strength: 0.16, tagline: LIDERES });
}
