#!/usr/bin/env python3
# scripts/bake-rifa-lds-assets.py <pollitos_dir> [<lds_public_dir>]
#
# Arte de Los Del Sur para la rifa solidaria La Iguaná (lib/rifas/partner.ts):
# - assets/rifas-story/lds/: pollitos barristas (PNG con alfa), escudo y trapo
#   para la imagen de historia. next/og (satori) no decodifica WebP: todo va en
#   PNG. Los fondos (fotos reales de la barra) salen de
#   scripts/bake-rifa-lds-fondos.py.
# - public/rifas/lds/escudo-{128,256}.webp para la portada y el inicio.
#
# <pollitos_dir>: originales de Qwen Image Edit 2511 (DGX, ComfyUI), editados a
# partir de public/pollitos/pollito_verde_base.webp sobre fondo blanco. Se
# guardan fuera del repo (Downloads/agent-work/lds-pollitos-20261107/).
# <lds_public_dir> (opcional; sin él solo se hornean los pollitos):
# los-del-sur-app/apps/pwa-los-del-sur/public (escudo.png, trapos/los-del-sur.webp).
# Requiere Pillow con soporte WebP.
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY = os.path.join(ROOT, "assets", "rifas-story", "lds")
PUBLIC = os.path.join(ROOT, "public", "rifas", "lds")
pollitos_dir = sys.argv[1]
lds_dir = sys.argv[2] if len(sys.argv) > 2 else None
os.makedirs(STORY, exist_ok=True)
os.makedirs(PUBLIC, exist_ok=True)

# Pollito final → original elegido. (2026-11-07, pedido del dueño) La pava dice
# «BARRA POPULAR», nunca «barra brava»: una segunda edición de Qwen cambió solo
# ese texto (sufijo -pop<semilla>) y le quitó a la sombrilla unas letras de la cara.
POLLITOS = {"pava": "pavafix2-pop13", "bombo": "bombo-pop9", "bandera": "bandera-pop9",
            "trompeta": "trompeta-pop9", "sombrilla": "sombrillafix1-pop13", "trapo": "trapo"}


def cut_white(path):
    """Fondo blanco → alfa: relleno desde los bordes (el contorno negro encierra los blancos del dibujo)."""
    im = Image.open(path).convert("RGB")
    w, h = im.size
    marker = (255, 0, 255)
    probe = im.copy()
    for x in range(0, w, 16):
        for y in (0, h - 1):
            if probe.getpixel((x, y)) != marker and min(probe.getpixel((x, y))) > 225:
                ImageDraw.floodfill(probe, (x, y), marker, thresh=40)
    for y in range(0, h, 16):
        for x in (0, w - 1):
            if probe.getpixel((x, y)) != marker and min(probe.getpixel((x, y))) > 225:
                ImageDraw.floodfill(probe, (x, y), marker, thresh=40)
    mask = Image.new("L", (w, h), 0)
    mask.putdata([0 if p == marker else 255 for p in probe.get_flattened_data()])
    # Un píxel menos de borde: sin halo blanco sobre fondos oscuros.
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.6))
    out = im.convert("RGBA")
    out.putalpha(mask)
    box = out.getbbox()
    out = out.crop(box)
    side = max(out.size) + 16
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(out, ((side - out.width) // 2, side - out.height - 8))
    return square


def save_png(im, name, size):
    im = im.resize((size, size), Image.LANCZOS)
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(
        os.path.join(STORY, name), optimize=True)


for key, src in POLLITOS.items():
    save_png(cut_white(os.path.join(pollitos_dir, f"{src}.png")), f"pollito-{key}.png", 360)

if lds_dir:
    escudo = Image.open(os.path.join(lds_dir, "escudo.png")).convert("RGBA")
    escudo.resize((300, 300), Image.LANCZOS).save(os.path.join(STORY, "escudo.png"), optimize=True)
    for size in (128, 256):
        escudo.resize((size, size), Image.LANCZOS).save(os.path.join(PUBLIC, f"escudo-{size}.webp"), quality=86)

    trapo = Image.open(os.path.join(lds_dir, "trapos", "los-del-sur.webp")).convert("RGBA")
    trapo = trapo.resize((1240, round(1240 * trapo.height / trapo.width)), Image.LANCZOS)
    trapo.quantize(colors=128, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(os.path.join(STORY, "trapo.png"), optimize=True)

print("ok", sorted(os.listdir(STORY)), sorted(os.listdir(PUBLIC)))
