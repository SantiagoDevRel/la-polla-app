#!/usr/bin/env python3
# scripts/bake-rifa-story-assets.py
#
# Pollitos y logo para la imagen de historia de rifas (app/api/rifas/[slug]/historia).
# next/og (satori) no decodifica WebP, así que se hornean PNG de paleta (256 colores,
# alfa conservado) desde los WebP del catálogo (docs/pollito-clubes.md): 300 px por
# club y el logo a 144 px, ~410 KB en total. Volver a correr si cambia el catálogo
# o STORY_CLUBS en lib/rifas/shared.ts. Requiere Pillow con soporte WebP.
import os
import re
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "assets", "rifas-story")
os.makedirs(OUT, exist_ok=True)

def bake(src, dst, size):
    im = Image.open(os.path.join(ROOT, src)).convert("RGBA").resize((size, size), Image.LANCZOS)
    im.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(os.path.join(OUT, dst), optimize=True)

keys = re.findall(r'key: "([a-z]+)"', open(os.path.join(ROOT, "lib", "rifas", "shared.ts")).read())
bake("public/pollitos/logo_realistic-192.webp", "logo.png", 144)
for key in keys:
    bake(f"public/pollitos/pollito_{key}_lider.webp", f"pollito_{key}.png", 300)
print(f"{len(keys)} pollitos + logo en {OUT}")
