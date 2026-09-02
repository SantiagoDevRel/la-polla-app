// components/street/TribunaArt.tsx — el heroe visual de la app.
//
// Por que SVG y no una foto: las tres vias de generacion de imagen estaban
// caidas la noche del 2026-08-25 (AI Studio daba error interno, ChatGPT no
// tiene sesion en el Chrome dedicado, Pixa sin creditos). Pero ademas, una
// foto de stock generada por IA se ve generica; un grafico propio se lee como
// MARCA. Esto pesa ~3KB, escala perfecto y no depende de nadie.
//
// Si mas adelante conseguimos fotografia de verdad, `<HeroFrame image="...">`
// ya la acepta y este componente pasa a ser el fallback.

interface TribunaArtProps {
  className?: string;
  /** Intensidad de los haces de luz (0-1). Default 1. */
  glow?: number;
}

/**
 * Tribuna de noche: siluetas de hinchada, haces de reflector y humo.
 * Todo en currentColor + el acento, para que herede el tema.
 */
export function TribunaArt({ className, glow = 1 }: TribunaArtProps) {
  return (
    <svg
      viewBox="0 0 390 220"
      preserveAspectRatio="xMidYMax slice"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <defs>
        {/* Haz de reflector: cono suave que baja desde arriba. */}
        <linearGradient id="ta-beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD700" stopOpacity={0.16 * glow} />
          <stop offset="55%" stopColor="#FFD700" stopOpacity={0.05 * glow} />
          <stop offset="100%" stopColor="#FFD700" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="ta-beam-warm" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFD9A0" stopOpacity={0.13 * glow} />
          <stop offset="100%" stopColor="#FFD9A0" stopOpacity="0" />
        </linearGradient>
        {/* Humo: manchas difusas que cruzan la tribuna. */}
        <radialGradient id="ta-smoke" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        {/* Desvanecido inferior: entrega la imagen al fondo solido sin corte. */}
        <linearGradient id="ta-fade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#080c10" stopOpacity="0" />
          <stop offset="72%" stopColor="#080c10" stopOpacity="0.82" />
          <stop offset="100%" stopColor="#080c10" stopOpacity="1" />
        </linearGradient>
      </defs>

      {/* Haces de luz — van detras de la gente. */}
      <polygon points="60,-20 96,-20 150,220 8,220" fill="url(#ta-beam)" />
      <polygon points="250,-20 292,-20 356,220 206,220" fill="url(#ta-beam-warm)" />

      {/* Humo entre los haces. */}
      <ellipse cx="120" cy="118" rx="140" ry="46" fill="url(#ta-smoke)" />
      <ellipse cx="290" cy="96" rx="118" ry="38" fill="url(#ta-smoke)" />

      {/* Gradas del fondo: barras verticales, cada vez mas oscuras. */}
      <g opacity="0.5">
        {Array.from({ length: 26 }).map((_, i) => (
          <rect
            key={`g-${i}`}
            x={i * 15.4}
            y={128 - ((i * 7) % 19)}
            width="13"
            height="120"
            fill="#131b2b"
          />
        ))}
      </g>

      {/* Hinchada, tres profundidades. La de atras mas chica y mas apagada,
          la de adelante casi negra: eso es lo que da sensacion de multitud. */}
      <CrowdRow y={150} scale={0.74} fill="#141416" seed={3} />
      <CrowdRow y={172} scale={0.9} fill="#0F0F11" seed={7} />
      <CrowdRow y={196} scale={1.08} fill="#080c10" seed={11} />

      {/* Desvanecido al fondo. */}
      <rect x="0" y="0" width="390" height="220" fill="url(#ta-fade)" />
    </svg>
  );
}

/**
 * Una fila de gente: cabeza + hombros, con separacion pseudo-aleatoria pero
 * determinista (el `seed` evita que SSR y cliente dibujen distinto y Next
 * marque un hydration mismatch).
 */
function CrowdRow({
  y,
  scale,
  fill,
  seed,
}: {
  y: number;
  scale: number;
  fill: string;
  seed: number;
}) {
  const people = [];
  let x = -10;
  let i = 0;
  while (x < 400) {
    // Pseudo-random determinista: seno con un seed distinto por fila.
    const jitter = Math.abs(Math.sin((i + seed) * 12.9898) * 43758.5453) % 1;
    const headR = (4.2 + jitter * 1.6) * scale;
    const armsUp = jitter > 0.68;
    const cy = y - headR * (armsUp ? 1.5 : 0.6);

    people.push(
      <g key={`p-${seed}-${i}`}>
        <circle cx={x} cy={cy} r={headR} fill={fill} />
        {/* hombros */}
        <path
          d={`M ${x - headR * 2.1} ${y + headR * 2.6}
              Q ${x} ${cy + headR * 0.9} ${x + headR * 2.1} ${y + headR * 2.6} Z`}
          fill={fill}
        />
        {/* brazos arriba — solo algunos, si no parece un peine */}
        {armsUp && (
          <>
            <rect
              x={x - headR * 2.0}
              y={cy - headR * 2.4}
              width={headR * 0.52}
              height={headR * 3.0}
              fill={fill}
              transform={`rotate(14 ${x - headR * 2.0} ${cy})`}
            />
            <rect
              x={x + headR * 1.5}
              y={cy - headR * 2.4}
              width={headR * 0.52}
              height={headR * 3.0}
              fill={fill}
              transform={`rotate(-14 ${x + headR * 1.5} ${cy})`}
            />
          </>
        )}
      </g>,
    );

    x += (9.5 + jitter * 5) * scale;
    i += 1;
  }
  return <>{people}</>;
}

export default TribunaArt;
