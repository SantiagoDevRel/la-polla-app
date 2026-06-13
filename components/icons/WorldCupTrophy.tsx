// components/icons/WorldCupTrophy.tsx — Ícono del trofeo de la Copa del
// Mundo. Vectorizado por el user (su "icono world cup" trazado a SVG) y
// pasado a `currentColor` para que matchee la navbar (gold cuando el tab
// está activo, muted cuando no). Silueta sólida (fill), escalable.
import type { SVGProps } from "react";

export function WorldCupTrophy(props: SVGProps<SVGSVGElement>) {
  return (
    // viewBox cuadrado, centrado en el bbox REAL del trazo (centro 427,478)
    // y dimensionado para que el trofeo llene ~82% de la altura, igual que
    // los íconos lucide de la navbar. Medido rasterizando el path (ver
    // commit). El path-fantasma diminuto que traía el SVG vectorizado
    // (un punto en ~935,3) se removió: contaminaba el bbox y descentraba.
    <svg
      viewBox="115 166 624 624"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...props}
    >
      <g transform="translate(0,966) scale(0.1,-0.1)">
        <path d="M4102 7440 c-703 -99 -1202 -759 -1097 -1450 7 -52 30 -149 49 -215 19 -66 86 -311 149 -545 64 -234 201 -742 306 -1130 208 -768 209 -771 167 -870 -12 -30 -123 -214 -244 -408 -122 -195 -225 -364 -228 -377 -3 -12 1 -38 9 -58 30 -71 -34 -67 1057 -67 1091 0 1027 -4 1057 67 8 20 12 46 9 59 -3 12 -106 181 -228 376 -122 194 -232 378 -244 408 -15 34 -24 76 -24 110 0 54 94 411 518 1960 74 272 143 524 152 560 164 611 -201 1295 -810 1515 -129 46 -234 65 -390 70 -80 2 -173 0 -208 -5z m384 -224 c356 -75 648 -332 782 -690 19 -50 35 -100 36 -111 0 -11 -57 -111 -127 -221 l-128 -202 -48 47 c-178 179 -446 173 -617 -12 -31 -33 -59 -56 -63 -51 -4 5 -99 118 -209 251 -111 133 -211 247 -221 253 -48 25 -121 -1 -142 -52 -16 -39 -8 -78 43 -198 41 -96 128 -342 128 -361 0 -12 -137 28 -208 61 -98 45 -203 124 -294 218 -81 84 -188 230 -188 257 0 26 51 168 86 238 162 321 475 542 832 587 87 11 250 4 338 -14z m-1079 -1349 c143 -109 331 -192 498 -217 39 -6 73 -14 77 -18 10 -11 44 -181 67 -332 35 -232 44 -389 38 -635 -9 -346 -46 -570 -143 -865 -53 -162 -69 -199 -77 -190 -4 5 -67 234 -452 1655 -70 259 -142 522 -160 585 -18 63 -35 135 -39 160 l-7 44 70 -71 c39 -39 96 -91 128 -116z m1754 -474 c-404 -1481 -521 -1917 -531 -1977 -15 -97 6 -221 54 -315 l17 -31 -432 0 -431 0 41 73 c291 514 413 946 428 1517 6 242 -5 430 -37 651 -21 136 -84 441 -101 486 -5 14 -8 27 -6 29 2 2 26 -24 54 -59 38 -47 55 -78 67 -127 32 -125 113 -223 232 -281 66 -32 74 -34 179 -34 103 0 114 2 177 32 125 59 210 165 242 301 10 46 37 98 108 208 53 85 94 140 96 131 2 -9 -69 -281 -157 -604z m-354 531 c116 -67 135 -233 39 -329 -69 -69 -157 -83 -245 -39 -76 38 -111 96 -111 182 0 78 19 121 72 167 70 59 163 67 245 19z m130 -3229 c51 -82 93 -153 93 -157 0 -4 -342 -8 -760 -8 -418 0 -760 4 -760 8 0 6 101 172 176 290 l15 22 571 -2 571 -3 94 -150z" />
      </g>
    </svg>
  );
}
