// Plantillas de Los Del Sur (lib/rifas/partner.ts). Mismo contrato de datos que
// las de La Polla (StoryFrame): cambia el arte. Encabezado con el escudo de la
// barra, pollito barrista grande arriba a la derecha y La Polla solo en el pie,
// pequeña, junto al dominio. Fotos y escudo vienen como data URIs locales.
import type { ReactNode } from "react";
import { display, StoryFrame, type Treatment } from "./common";
import type { StoryProps } from "./types";

const GREEN = "#1E9A44";
const GREEN_LIGHT = "#5BE08A";
const NIGHT = "#06140C";
const WHITE = "#F5F7FA";
const PANEL = "rgba(5, 18, 11, 0.9)";

function Art({ children }: { children: ReactNode }) {
  return <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{ position: "absolute", top: 0, left: 0 }}>{children}</svg>;
}

function Photo({ src, shade }: { src: string | null; shade: string }) {
  return <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: 1080, height: 1920 }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- JPEG embedded in next/og */}
    {src && <img src={src} width={1080} height={1920} alt="" style={{ position: "absolute", top: 0, left: 0 }} />}
    <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: 1080, height: 1920, backgroundImage: shade }} />
  </div>;
}

function Header({ escudo }: { escudo: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 22, position: "absolute", left: 56, top: 40 }}>
    {/* eslint-disable-next-line @next/next/no-img-element -- PNG embedded in next/og */}
    <img src={escudo} width={132} height={132} alt="" />
    <div style={{ display: "flex", flexDirection: "column" }}>
      <span style={{ ...display, fontSize: 76, color: WHITE }}>LOS DEL SUR</span>
      <span style={{ fontSize: 24, letterSpacing: 5, color: GREEN_LIGHT }}>LA BARRA Y SUS COMBOS</span>
    </div>
  </div>;
}

/** Base común: encabezado de la barra, pollito grande, casillas blancas con borde verde, La Polla al pie. */
function lds(props: StoryProps, theme: Partial<Treatment> & { background: string }) {
  const art = props.partner;
  return StoryFrame(props, {
    panel: PANEL, accent: GREEN_LIGHT, cell: WHITE, cellBorder: GREEN, radius: 10,
    title: "RIFA SUREÑA", titleSize: 100, titleTop: 190, nameWidth: 640,
    pollitoSize: 320, pollitoTop: -170, pollitoRight: -50, footerLogo: true,
    boardStyle: { border: `3px solid ${GREEN}` },
    header: art ? <Header escudo={art.escudo} /> : undefined,
    ...theme,
  });
}

export function tribuna(props: StoryProps) {
  return lds(props, {
    background: NIGHT,
    backdrop: <Photo src={props.partner?.background ?? null}
      shade="linear-gradient(180deg, rgba(3,10,6,0.45) 0%, rgba(3,10,6,0.7) 30%, rgba(3,10,6,0.86) 60%, rgba(3,10,6,0.92) 100%)" />,
  });
}

export function combos(props: StoryProps) {
  return lds(props, {
    background: NIGHT, title: "RIFA DEL BARRIO",
    backdrop: <Photo src={props.partner?.background ?? null}
      shade="linear-gradient(180deg, rgba(3,10,6,0.5) 0%, rgba(3,10,6,0.78) 35%, rgba(3,10,6,0.9) 100%)" />,
  });
}

export function humo(props: StoryProps) {
  return lds(props, {
    background: "#0B3A1E",
    backdrop: <Photo src={props.partner?.background ?? null}
      shade="linear-gradient(180deg, rgba(4,26,12,0.55) 0%, rgba(4,26,12,0.72) 40%, rgba(4,26,12,0.85) 100%)" />,
  });
}

export function trapo(props: StoryProps) {
  const art = props.partner;
  return lds(props, {
    background: "#070B08",
    // El trapo de la barra hace de título.
    titleNode: art
      ? <img src={art.trapo} width={620} height={104} alt="" style={{ marginBottom: 4 }} /> /* eslint-disable-line @next/next/no-img-element */
      : undefined,
    backdrop: <Art>{Array.from({ length: 6 }, (_, i) => <rect key={i} x={i * 180 + 45} y="0" width="90" height="1920" fill={GREEN} opacity="0.32" />)}
      <rect x="28" y="28" width="1024" height="1864" rx="28" fill="none" stroke={WHITE} strokeOpacity="0.35" strokeWidth="3" /></Art>,
  });
}

export function escudo(props: StoryProps) {
  const art = props.partner;
  return lds(props, {
    background: NIGHT, title: "SIEMPRE PRESENTES", titleSize: 84,
    backdrop: <div style={{ display: "flex", position: "absolute", top: 0, left: 0, width: 1080, height: 1920 }}>
      <Art><circle cx="540" cy="1080" r="520" fill="none" stroke={GREEN} strokeWidth="26" opacity="0.5" />
        <circle cx="540" cy="1080" r="470" fill="none" stroke={WHITE} strokeWidth="6" opacity="0.25" /></Art>
      {/* eslint-disable-next-line @next/next/no-img-element -- PNG embedded in next/og */}
      {art && <img src={art.escudo} width={900} height={900} alt="" style={{ position: "absolute", left: 90, top: 630, opacity: 0.16 }} />}
    </div>,
  });
}

/** Sombrillas verdes y blancas vistas desde arriba, como en la tribuna. */
function umbrella({ x, y, r }: { x: number; y: number; r: number }, key: number) {
  // Función, no componente: satori solo acepta elementos intrínsecos dentro de <svg>.
  return <g key={key}>{Array.from({ length: 8 }, (_, i) => {
    const a0 = (i * Math.PI) / 4;
    const a1 = ((i + 1) * Math.PI) / 4;
    const d = `M${x} ${y}L${x + r * Math.cos(a0)} ${y + r * Math.sin(a0)}A${r} ${r} 0 0 1 ${x + r * Math.cos(a1)} ${y + r * Math.sin(a1)}Z`;
    return <path key={i} d={d} fill={i % 2 ? WHITE : GREEN} />;
  })}<circle cx={x} cy={y} r={r * 0.08} fill="#0B3A1E" /></g>;
}

export function sombrillas(props: StoryProps) {
  const spots = Array.from({ length: 30 }, (_, i) => ({ x: (i % 5) * 230 + (Math.floor(i / 5) % 2 ? 115 : 0) + 20, y: Math.floor(i / 5) * 330 + 60, r: 110 + (i * 37) % 40 }));
  return lds(props, {
    background: "#0B3A1E",
    backdrop: <Art>{spots.map((s, i) => umbrella(s, i))}
      <rect x="0" y="0" width="1080" height="1920" fill={NIGHT} opacity="0.55" /></Art>,
  });
}
