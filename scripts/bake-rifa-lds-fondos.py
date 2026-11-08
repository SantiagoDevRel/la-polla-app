#!/usr/bin/env python3
# scripts/bake-rifa-lds-fondos.py <fotos_dir> [fondo ...]
#
# Fondos de las seis plantillas de historia de Los Del Sur (lib/rifas/partner.ts):
# fotos REALES de la barra, publicadas en el Instagram oficial @ldsoficial
# (2026-11-07, pedido del dueño: «fotos de la barra de verdad, no cosa de AI»;
# el dueño tiene permiso de la barra). Reemplazan los fondos generados de la
# app de LDS (tribuna-sur.webp), que traían textos y marcas deformados.
#
# <fotos_dir>: los JPEG originales de cada publicación, nombrados <post>_<n>.jpg
# (n = posición en el carrusel, desde 0). Se guardan fuera del repo
# (Downloads/agent-work/la-polla-lds-fotos-20261107/originales/); para volver a
# bajarlos, abrir https://www.instagram.com/p/<post>/ con sesión.
#
# Cada fondo es un recorte vertical 9:16 a 1080×1920 (JPEG: satori no decodifica
# WebP). El encabezado y el título tapan la franja de arriba, así que el recorte
# deja ahí lo más reconocible (banderas, escudos, humo). Requiere Pillow.
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STORY = os.path.join(ROOT, "assets", "rifas-story", "lds")
fotos_dir = sys.argv[1]

# fondo → (foto, centro x, centro y, zoom). Centros en fracción de la foto;
# zoom 1 = todo el alto. El crédito de cada foto está en su publicación.
FONDOS = {
    # Banderas con el escudo y trapos de los combos, de noche.
    "tribuna": ("De1p5lyoLey_3", 0.5, 0.6, 1.2),
    # Trapos «Comuna 13», «De trapos» (📷 @luispabon_photography).
    "combos": ("Dc7zloogPEe_0", 0.62, 0.5, 1.0),
    # Humo verde y pólvora sobre la tribuna, de noche.
    "humo": ("Ddst4sikWaR_0", 0.55, 0.4, 1.14),
    # Trapo gigante «Los Del Sur» y banderas.
    "trapo": ("De8MbpboLb5_3", 0.32, 0.55, 1.1),
    # Banderas con el escudo de la barra arriba del trapo «Córdoba».
    "escudo": ("Dch8PWCAC3p_2", 0.6, 0.5, 1.0),
    # Sombrillas verdes y blancas en la baranda, arriba del trapo.
    "sombrillas": ("Ddxeoj2IMjW_3", 0.78, 0.55, 1.15),
}


# (2026-11-08) Plantilla «Tablero»: el diseño cuadrado 1080×1350 aprobado por el
# dueño y su versión vertical 1080×1920 (el mismo cuadrado con fondo arriba y
# abajo). Misma foto que «tribuna», recortada como `background-size: cover;
# background-position: 50% 40%` del diseño original.
TABLERO = {
    "tablero-cuadrada": ("De1p5lyoLey_3", 0.5, 0.4, 1.0, (1080, 1350)),
    "tablero-vertical": ("De1p5lyoLey_3", 0.5, 0.4, 1.0, (1080, 1920)),
}


def bake(name, foto, cx, cy, zoom, size=(1080, 1920)):
    im = Image.open(os.path.join(fotos_dir, f"{foto}.jpg")).convert("RGB")
    w, h = im.size
    tw, th = size
    ch = round(h / zoom)
    cw = round(ch * tw / th)
    if cw > w:
        cw, ch = w, round(w * th / tw)
    left = min(max(round(w * cx - cw / 2), 0), w - cw)
    top = min(max(round(h * cy - ch / 2), 0), h - ch)
    im.crop((left, top, left + cw, top + ch)).resize(size, Image.Resampling.LANCZOS).save(
        os.path.join(STORY, f"fondo-{name}.jpg"), quality=80, optimize=True, progressive=True)
    return f"{name}: {foto} {w}x{h} -> recorte {cw}x{ch} en ({left},{top})"


only = set(sys.argv[2:])
for name, spec in {**FONDOS, **TABLERO}.items():
    if not only or name in only:
        print(bake(name, *spec))
