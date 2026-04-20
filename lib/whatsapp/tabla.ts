// lib/whatsapp/tabla.ts — Formats polla standings as WhatsApp-readable monospace text

interface TablaRow {
  position: number;
  name: string;
  points: number;
  predictions: number;
  isCurrentUser?: boolean;
}

/**
 * Returns formatted string ready to send in WhatsApp triple-backtick block.
 * Max 5 rows shown + current user if outside top 5.
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

  // Render the top 5 rows as-is so the caller keeps their real rank and
  // medal. When the caller is outside the top 5, flows.ts appends a
  // separate userRow (isCurrentUser=true) at the tail; in that case we
  // drop it from the visible rows and show the "Tu posición" footer.
  const userRow = rows.find((r) => r.isCurrentUser);
  const isUserInTop =
    userRow !== undefined && rows.slice(0, 5).some((r) => r.isCurrentUser);
  const allRows = isUserInTop
    ? rows.slice(0, 5)
    : rows.filter((r) => !r.isCurrentUser).slice(0, 5);
  const maxPos = Math.max(...allRows.map((r) => r.position), 0);
  let text = `🏆 *Tabla — ${pollaName}*\n\n\`\`\`\n`;

  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i];
    const isLast = i === allRows.length - 1 && maxPos > 3;
    const isCurrent =
      userRow !== undefined && r.position === userRow.position;
    const medal = getMedal(r.position, isLast, isCurrent);
    const name = padRight(truncName(r.name, 12), 12);
    const pts = padLeft(`${r.points}`, 3);
    text += `${medal} ${name} ${pts} pts\n`;
  }

  text += `\`\`\``;

  // Add user position if outside top 5
  if (userRow && !isUserInTop) {
    text += `\n\n👤 Tu posición: *#${userRow.position}* con *${userRow.points} pts*`;
  }

  return text;
}
