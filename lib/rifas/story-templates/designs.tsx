import type { ReactNode } from "react";
import { INK, PAPER, StoryFrame, type Treatment } from "./common";
import type { StoryProps } from "./types";

/** Vector art is deterministic, embedded and font-free. No external image requests. */
function Art({ children }: { children: ReactNode }) {
  return <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{ position: "absolute", top: 0, left: 0 }}>{children}</svg>;
}
const light: Partial<Treatment> = { ink: INK, muted: "#43515E", panel: "#E9ECF0" };

export function neutra(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    background: INK, title: "RIFA", boardStyle: { background: "#0E1420" },
    backdrop: <Art><circle cx="920" cy="160" r="480" fill="#131B2B" /><path d="M0 640H1080" stroke="#26374D" strokeWidth="2" /></Art>,
  });
}

export function club(props: StoryProps) {
  return StoryFrame(props, {
    background: props.club.primary, title: "RIFA", panel: "#101A25", ink: PAPER,
    backdrop: <Art>{Array.from({ length: 6 }, (_, i) => <rect key={i} x={i * 180} y="0" width="90" height="1920" fill={props.club.secondary} opacity="0.22" />)}
      <rect x="40" y="40" width="1000" height="1880" rx="32" fill={INK} opacity="0.78" /></Art>,
  });
}

export function estadio(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    background: "#081B2D", centered: true, title: "GRAN RIFA", accent: "#DFF9FF", panel: "#102B3C",
    boardStyle: { border: "2px solid #436477", background: "#0B1D2C" },
    backdrop: <Art>
      <path d="M80 0L650 660H220Z M1000 0L430 660H860Z" fill="#CAEFFF" opacity="0.10" />
      {[44, 920].map((x) => <g key={x}><path d={`M${x + 58} 24V570`} stroke="#4E6578" strokeWidth="12" />
        {[0, 1, 2, 3].map((n) => <rect key={n} x={x + n * 28} y="24" width="22" height="22" rx="3" fill="#E0F7FF" />)}</g>)}
      {[0, 1, 2, 3, 4].map((n) => <path key={n} d={`M0 ${1300 + n * 65}Q540 ${1580 + n * 40} 1080 ${1300 + n * 65}`} fill="none" stroke="#315169" strokeWidth="12" />)}
    </Art>,
  });
}

export function boleta(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    ...light, background: "#173944", panel: "#F0E9D9", title: "GRAN RIFA", titleSize: 116,
    radius: 3, cell: "#FFFDF6", cellBorder: "#B7A98B", accent: "#163E49",
    prizeStyle: { background: "#193F48" },
    backdrop: <Art><rect x="30" y="32" width="1020" height="1856" rx="28" fill="#F8F1E1" />
      <path d="M40 640H1040 M40 1589H1040" stroke="#8F9D97" strokeWidth="3" strokeDasharray="12 10" />
      {[640, 1589].map((y) => <g key={y}><circle cx="30" cy={y} r="25" fill="#173944" /><circle cx="1050" cy={y} r="25" fill="#173944" /></g>)}
      {Array.from({ length: 26 }, (_, i) => <rect key={i} x={710 + i * 11} y="66" width={i % 3 === 0 ? 6 : 3} height="52" fill="#193F48" />)}
    </Art>,
  });
}

export function marcador(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    background: "#080E14", title: "RIFA", titleSize: 144, accent: "#A1F3DC", radius: 0,
    panel: "#14222D", cell: "#102B31", cellInk: "#C4FFEF", cellBorder: "#3E676A",
    centered: true, boardStyle: { border: "8px solid #38505C", borderRadius: 8 },
    titleStyle: { letterSpacing: 26 },
    backdrop: <Art>{Array.from({ length: 144 }, (_, i) => <circle key={i} cx={36 + (i % 24) * 44} cy={166 + Math.floor(i / 24) * 37} r="3" fill="#3D7A75" />)}
      {[48, 1014].map((x) => <g key={x}>{[650, 1540].map((y) => <circle key={y} cx={x} cy={y} r="8" fill="#6A8791" />)}</g>)}
    </Art>,
  });
}

export function cuaderno(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    ...light, background: "#FCF9EF", panel: "#FCF9EF", title: "RIFA", accent: "#214BB1", radius: 3,
    titleStyle: { transform: "rotate(-4deg)" }, cell: "#FFFDF8", cellBorder: "#7A91B1",
    boardStyle: { background: "transparent" }, prizeStyle: { border: "3px solid #214BB1", color: "#214BB1", borderRadius: 3 },
    backdrop: <Art>{Array.from({ length: 33 }, (_, i) => <path key={i} d={`M34 ${72 + i * 56}H1060`} stroke="#CFDBE6" strokeWidth="2" />)}
      <path d="M48 0V1920" stroke="#D99096" strokeWidth="3" />
      {Array.from({ length: 10 }, (_, i) => <circle key={i} cx="24" cy={120 + i * 180} r="10" fill="#D1CCC1" />)}
      <path d="M80 287Q235 272 410 290 M82 299Q255 284 396 299" fill="none" stroke="#214BB1" strokeWidth="7" strokeLinecap="round" />
    </Art>,
  });
}

export function camiseta(props: StoryProps) {
  return StoryFrame(props, {
    background: props.club.primary, panel: "#111D28", title: "RIFA", titleSize: 124,
    titleStyle: { letterSpacing: 12 }, radius: 6, boardStyle: { border: "3px solid #8FA2B1" },
    backdrop: <Art>
      <path d="M0 80L190 0H400L540 95L680 0H890L1080 80V520L920 420V1920H160V420L0 520Z" fill={props.club.primary} />
      {[220, 420, 620, 820].map((x) => <rect key={x} x={x} y="120" width="86" height="1800" fill={props.club.secondary} opacity="0.65" />)}
      <path d="M385 0Q540 180 695 0L655 0Q540 106 425 0Z" fill={props.club.secondary} />
      <path d="M168 200V1850 M912 200V1850" stroke="#FFFFFF" opacity="0.6" strokeWidth="3" strokeDasharray="5 9" />
      <rect x="46" y="44" width="988" height="1832" rx="30" fill={INK} opacity="0.65" />
    </Art>,
    ornament: <div style={{ display: "flex", position: "absolute", top: 65, right: 80, fontSize: 23, letterSpacing: 4 }}>EDICIÓN HINCHA</div>,
  });
}

export function pizarra(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    background: "#123C30", panel: "#173F34", title: "RIFA", accent: "#F2F6E8", radius: 36,
    cell: "#F0F3E6", cellBorder: "#D9E6CE", boardStyle: { background: "#1C4C3D", border: "3px solid #C0D7BC", borderRadius: 0 },
    backdrop: <Art><rect x="28" y="28" width="1024" height="1864" fill="none" stroke="#749782" strokeWidth="3" />
      <path d="M28 1100H1052 M270 28V210H810V28 M270 1892V1700H810V1892" fill="none" stroke="#749782" strokeWidth="3" />
      <circle cx="540" cy="1100" r="250" fill="none" stroke="#749782" strokeWidth="3" />
      <path d="M700 245Q900 260 940 155 M910 182L940 155L950 195 M695 165l40 40m0-40l-40 40 M818 214l30 30m0-30l-30 30" fill="none" stroke="#C3DAC8" strokeWidth="6" />
    </Art>,
  });
}

export function retro(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    ...light, background: "#F2E6CB", ink: "#233E42", muted: "#4F5B55", panel: "#E5D5AF",
    centered: true, title: "GRAN RIFA", titleSize: 128, accent: "#B83136", radius: 38,
    titleStyle: { textShadow: "4px 4px #D5BDA0" }, cell: "#FFF6DE", cellBorder: "#43656A",
    prizeStyle: { background: "#233E42" }, boardStyle: { border: "4px solid #233E42", borderRadius: 4 },
    backdrop: <Art><rect x="22" y="22" width="1036" height="1876" fill="none" stroke="#B83136" strokeWidth="6" />
      <rect x="36" y="36" width="1008" height="1848" fill="none" stroke="#233E42" strokeWidth="2" />
      {[44, 1036].map((x) => <g key={x}>{Array.from({ length: 28 }, (_, i) => <circle key={i} cx={x} cy={80 + i * 65} r="5" fill="#B83136" />)}</g>)}
      <path d="M380 104H660 M420 116H620" stroke="#B83136" strokeWidth="4" />
    </Art>,
  });
}

export function premium(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    ...light, background: "#FFFFFF", panel: "#FFFFFF", title: "RIFA", titleSize: 116, radius: 0,
    centered: true, titleStyle: { letterSpacing: 32 }, cell: "#FFFFFF", cellBorder: "#1A2026",
    prizeStyle: { background: INK, borderRadius: 0 },
    boardStyle: { borderTop: "2px solid #080c10", borderBottom: "2px solid #080c10", borderRadius: 0 },
    footerStyle: { borderBottom: "2px solid #080c10", borderRadius: 0 },
    backdrop: <Art><path d="M70 142H1010 M70 34H1010" stroke={INK} strokeWidth="2" /></Art>,
    ornament: <div style={{ display: "flex", position: "absolute", top: 80, right: 80, fontSize: 21, letterSpacing: 6 }}>EDICIÓN ESPECIAL</div>,
  });
}

export function neon(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    background: "#170B2B", panel: "#231538", title: "RIFA", titleSize: 140, centered: true,
    accent: "#F0DBFF", titleStyle: { letterSpacing: 18, textShadow: "0 0 18px #EF6BFF" },
    cell: "#F8F0FF", cellBorder: "#C083E7", radius: 20,
    boardStyle: { border: "3px solid #C88BFF", boxShadow: "0 0 24px #863CAD" },
    backdrop: <Art><path d="M28 580V36H380 M1052 1330V1884H730" fill="none" stroke="#4EDBDD" strokeWidth="6" />
      <circle cx="910" cy="210" r="180" fill="none" stroke="#7A378C" strokeWidth="36" />
      <path d="M0 1600L180 1780L0 1900" fill="none" stroke="#773899" strokeWidth="34" />
    </Art>,
  });
}

export function confeti(props: StoryProps) {
  return StoryFrame({ ...props, pollito: null }, {
    background: "#40216A", panel: "#30194E", title: "GRAN RIFA", titleSize: 108, centered: true,
    prizeFirst: true, prizeStyle: { background: "#201334", borderRadius: 32 },
    radius: 26, cell: "#FFF3EE", cellBorder: "#E4B5CD",
    backdrop: <Art>{Array.from({ length: 64 }, (_, i) => {
      const x = (i * 173 + 21) % 1080;
      const y = (i * 239 + 14) % 1920;
      return <rect key={i} x={x} y={y} width={i % 2 ? 8 : 18} height="28"
        fill={["#EE85AF", "#78E5D0", "#A08BEC", "#F5F7FA"][i % 4]} transform={`rotate(${i * 31 % 180} ${x} ${y})`} />;
    })}</Art>,
  });
}
