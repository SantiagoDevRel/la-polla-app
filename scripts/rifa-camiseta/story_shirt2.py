# Static front shirt for the story templates: the clean ghost-mannequin front, cut out, with its
# signature strokes redrawn bolder in gold so they read at ~270 px tall. Output: 356x420 RGBA.
import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
sys.path.insert(0, '.')
from seg import load, mask
src, out = sys.argv[1], sys.argv[2]
F = load(src); m = mask(F)
im = F * 255
ink = np.load('ink.npy')
bold = ndi.binary_dilation(ink, iterations=3)
a_ink = np.asarray(Image.fromarray((bold*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))).astype(float)/255
gold = np.array([236, 200, 116], float)
rgb = im*(1 - a_ink[..., None]*0.95) + gold*(a_ink[..., None]*0.95)
alpha = np.asarray(Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(float)
img = Image.fromarray(np.dstack([rgb, alpha]).clip(0, 255).astype(np.uint8))
ys, xs = np.nonzero(m); pad = 6
img = img.crop((xs.min()-pad, ys.min()-pad, xs.max()+pad+1, ys.max()+pad+1))
TW, TH = 356, 420
s = min(TW/img.width, TH/img.height)
img = img.convert('RGBa').resize((round(img.width*s), round(img.height*s)), Image.LANCZOS).convert('RGBA')
canvas = Image.new('RGBA', (TW, TH), (0, 0, 0, 0)); canvas.alpha_composite(img, ((TW-img.width)//2, (TH-img.height)//2))
canvas.save(out, optimize=True); print(canvas.size, img.size)
