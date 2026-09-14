// scripts/bake-og-image.cjs — hornea app/og-la-polla-colombiana.jpg (1200×630, <250 KB para que WhatsApp muestre la vista previa).
// (2026-09-14) Pedido del dueño: pollitos de la app + «La Polla Colombiana». El texto usa Arial Black del sistema (Windows).
// Uso: node scripts/bake-og-image.cjs app/og-la-polla-colombiana.jpg
const path = require("path");
const repo = path.join(__dirname, "..");
const sharp = (() => { try { return require("sharp"); } catch { return require(path.join(repo, "node_modules/next/node_modules/sharp")); } })();
const P = (n) => path.join(repo, "public/pollitos", n + ".webp");
const W = 1200, H = 630;
const out = process.argv[2] || path.join(__dirname, "og.jpg");
(async () => {
  const bg = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="g" cx="62%" cy="50%" r="75%"><stop offset="0" stop-color="#14416f"/><stop offset="0.55" stop-color="#0b2747"/><stop offset="1" stop-color="#050f1d"/></radialGradient>
    <pattern id="hex" width="84" height="97" patternUnits="userSpaceOnUse" patternTransform="scale(1)">
      <path d="M42 0 L84 24 L84 73 L42 97 L0 73 L0 24 Z" fill="none" stroke="#2a5d93" stroke-opacity="0.18" stroke-width="2"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
  <rect width="100%" height="100%" fill="url(#hex)"/>
  <g fill="#e2b33a" opacity="0.85">
    <polygon points="0,40 250,105 0,70"/><polygon points="40,0 210,60 80,0"/>
    <polygon points="1200,70 930,150 1200,110"/><polygon points="1160,0 990,70 1120,0"/>
    <polygon points="0,560 240,520 0,600"/><polygon points="1200,560 960,530 1200,600"/>
    <polygon points="300,630 420,560 350,630"/><polygon points="900,630 800,570 860,630"/>
  </g>
</svg>`);
  const pollito = async (n, s) => sharp(P(n)).resize(s, s, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const shadow = Buffer.from(`<svg width="560" height="60"><ellipse cx="280" cy="30" rx="250" ry="18" fill="#000" fill-opacity="0.45"/></svg>`);
  const stroke = (t, y, size, fill) => `<text x="0" y="${y}" font-family="Arial Black, Arial" font-weight="900" font-size="${size}" fill="${fill}" stroke="#ffffff" stroke-width="10" paint-order="stroke" stroke-linejoin="round" letter-spacing="2">${t}</text>`;
  const wordmark = Buffer.from(`<svg width="620" height="400" xmlns="http://www.w3.org/2000/svg">
    <g transform="translate(14,6)">
    <g transform="translate(6,8)" fill="#000" fill-opacity="0.35" font-family="Arial Black, Arial" font-weight="900" letter-spacing="2">
      <text x="0" y="118" font-size="128">LA</text><text x="0" y="252" font-size="140">POLLA</text><text x="0" y="350" font-size="68">COLOMBIANA</text>
    </g>
    ${stroke("LA", 118, 128, "#FCD116")}
    ${stroke("POLLA", 252, 140, "#1f4fbf")}
    ${stroke("COLOMBIANA", 346, 68, "#e63232")}
    </g></svg>`);
  await sharp(bg).composite([
    { input: shadow, left: 20, top: 505 },
    { input: await pollito("pollito_arquero_lider", 300), left: 10, top: 250 },
    { input: await pollito("pollito_goleador_lider", 300), left: 300, top: 250 },
    { input: await pollito("logo_realistic", 440), left: 95, top: 120 },
    { input: wordmark, left: 590, top: 112 },
  ]).jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: "4:4:4" }).toFile(out);
  const { size } = require("fs").statSync(out);
  console.log(out, Math.round(size / 1024) + "KB");
})();
