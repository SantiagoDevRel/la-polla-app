// lib/whatsapp/tabla.ts — Formats polla standings as WhatsApp-readable monospace text

interface TablaRow {
  position: number;
  name: string;
  points: number;
  predictions: number;
  isCurrentUser?: boolean;
}

// WhatsApp text messages cap at 4096 chars. Leave headroom for header + code
// fence + truncation footer; keep a hard per-row cap so a pathological polla
// with hundreds of paid participants still fits.
const MAX_ROWS = 60;

/**
 * Returns a single formatted string with the FULL leaderboard inline.
 * Caller is responsible for passing only eligible rows (paid, approved, etc).
 */
export function formatTablaWA(rows: TablaRow[], pollaName: string): string {
  const getMedal = (pos: number, isLast: boolean, isCurrent: boolean) => {
    if (isCurrent) return "👤";
    if (pos === 1) return "🥇";
    if (pos === 2) return "🥈";
    if (pos === 3) return "🥉";
    if (isLast) return "💀";
    return "  ";
  };

  const truncName = (name: string, max: number) => {
    if (name.length <= max) return name;
    return name.slice(0, max - 1) + "…";
  };

  const padRight = (str: string, len: number) => {
    if (str.length >= len) return str;
    return str + " ".repeat(len - str.length);
  };

  const padLeft = (str: string, len: number) => {
    if (str.length >= len) return str;
    return " ".repeat(len - str.length) + str;
  };

  const totalRows = rows.length;
  const visibleRows = rows.slice(0, MAX_ROWS);
  const maxPos = Math.max(...visibleRows.map((r) => r.position), 0);
  let text = `🏆 *Tabla — ${pollaName}*\n\n\`\`\`\n`;

  for (let i = 0; i < visibleRows.length; i++) {
    const r = visibleRows[i];
    const isLast = i === visibleRows.length - 1 && maxPos > 3;
    const medal = getMedal(r.position, isLast, !!r.isCurrentUser);
    const name = padRight(truncName(r.name, 12), 12);
    const pts = padLeft(`${r.points}`, 3);
    text += `${medal} ${name} ${pts} pts\n`;
  }

  text += `\`\`\``;

  if (totalRows > visibleRows.length) {
    text += `\n\n_y ${totalRows - visibleRows.length} más_`;
  }

  return text;
}
