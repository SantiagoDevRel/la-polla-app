// lib/share-card/copy.ts — deterministic quote picker for share cards
//
// Each moment type has a bank of colombiano one-liners. Selection is
// deterministic on a seed so regenerating the same card (same user,
// same event, same polla) always yields the same quote — prevents the
// "shuffled copy" feel when a user reshares. No emojis.

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export type ShareMoment =
  | "subiste"
  | "clavada"
  | "rival"
  | "ultimo"
  | "podio"
  | "semana"
  | "matchday";

const COPY_BANK: Record<ShareMoment, readonly string[]> = {
  subiste: [
    "No es suerte, es talento",
    "Arriba. Siempre arriba.",
    "Así se juega, papá",
    "Puesto #1 me lo gané",
    "A aguantar atrás mío",
    "La polla es mía",
  ],
  clavada: [
    "Clavada. Como lo dije.",
    "Dije que iba así. Lo cumplí.",
    "Marcador exacto. De papel.",
    "Nada de suerte. Puro ojo.",
    "Los pronósticos son de los que saben",
    "Te lo dije.",
  ],
  rival: [
    "Papá, te toca responder",
    "Respondé si podés",
    "Tu movida, parce",
    "La polla no se juega sola",
    "Aguantá el reto",
    "Vení por mí",
  ],
  ultimo: [
    "Alguien tenía que ser último",
    "Suma y sigue. Nada perdido.",
    "Este mes no fue, pero vuelvo",
    "De acá solo se sube",
    "Último con honor",
    "Mañana arranca otra",
  ],
  podio: [
    "Polla cerrada, podio ganado",
    "El podio se respeta",
    "Cierre con sabor",
    "Medalla al cuello",
    "Así se termina una polla",
    "Del podio no me bajo",
  ],
  semana: [
    "Semana redonda",
    "Sumando sumando",
    "La polla no para",
    "Todo el mes, todos los días",
    "Así se juega la semana",
    "A la próxima, más",
  ],
  matchday: [
    "Voy con todo",
    "Esta no se me va",
    "Marcador cantado",
    "Apostá conmigo",
    "Ya quedó escrito",
    "Anotá y decime",
  ],
};

export function pickCopy(type: ShareMoment, seed: string): string {
  const bank = COPY_BANK[type];
  const idx = hash(seed) % bank.length;
  return bank[idx];
}
