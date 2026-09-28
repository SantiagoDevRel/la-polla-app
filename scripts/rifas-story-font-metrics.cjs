// Regenerate advances from our bundled TrueType fonts; no dependency or network.
// node scripts/rifas-story-font-metrics.cjs
// eslint-disable-next-line @typescript-eslint/no-require-imports -- directly executable CommonJS utility
const { readFileSync, writeFileSync } = require("node:fs");
function advances(path) {
  const b = readFileSync(path);
  const tables = {};
  for (let i = 0; i < b.readUInt16BE(4); i++) {
    const p = 12 + i * 16;
    tables[b.toString("ascii", p, p + 4)] = b.readUInt32BE(p + 8);
  }
  const units = b.readUInt16BE(tables.head + 18);
  const metrics = b.readUInt16BE(tables.hhea + 34);
  let cmap;
  for (let i = 0; i < b.readUInt16BE(tables.cmap + 2); i++) {
    const p = tables.cmap + 4 + i * 8;
    const offset = tables.cmap + b.readUInt32BE(p + 4);
    if (b.readUInt16BE(offset) === 4) cmap = offset;
  }
  if (!cmap) throw Error("Expected a Unicode format-4 cmap");
  const segments = b.readUInt16BE(cmap + 6) / 2;
  const ends = cmap + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const ranges = deltas + segments * 2;
  const result = {};
  for (let code = 32; code <= 255; code++) {
    for (let i = 0; i < segments; i++) {
      if (code < b.readUInt16BE(starts + i * 2) || code > b.readUInt16BE(ends + i * 2)) continue;
      const delta = b.readInt16BE(deltas + i * 2);
      const range = b.readUInt16BE(ranges + i * 2);
      let glyph = range ? b.readUInt16BE(ranges + i * 2 + range + (code - b.readUInt16BE(starts + i * 2)) * 2) : code;
      if (!range || glyph) glyph = (glyph + delta) & 65535;
      result[String.fromCharCode(code)] = b.readUInt16BE(tables.hmtx + Math.min(glyph, metrics - 1) * 4) / units;
      break;
    }
  }
  return result;
}
writeFileSync("lib/rifas/story-templates/font-metrics.json", JSON.stringify({
  Bebas: advances("assets/fonts/BebasNeue-latin.ttf"),
  Outfit: advances("assets/fonts/Outfit-SemiBold-latin.ttf"),
}, null, 2) + "\n");
console.log("Local font advances generated");
