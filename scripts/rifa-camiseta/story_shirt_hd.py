import sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
sys.path.insert(0, '.')
from seg import load, mask
src, out = sys.argv[1], sys.argv[2]
F = load(src); m = mask(F); im = F*255
ink = np.load('ink.npy'); bold = ndi.binary_dilation(ink, iterations=3)
a = np.asarray(Image.fromarray((bold*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float)/255
gold = np.array([236,200,116], float)
rgb = im*(1-a[...,None]*0.95) + gold*(a[...,None]*0.95)
alpha = np.asarray(Image.fromarray((m*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0))).astype(float)
img = Image.fromarray(np.dstack([rgb, alpha]).clip(0,255).astype(np.uint8))
ys, xs = np.nonzero(m); pad = 8
img = img.crop((xs.min()-pad, ys.min()-pad, xs.max()+pad+1, ys.max()+pad+1))
img.save(out, optimize=True); print(img.size)
