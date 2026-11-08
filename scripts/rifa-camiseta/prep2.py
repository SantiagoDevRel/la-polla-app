# Front (AI ghost-mannequin product shot) + back (same framing) -> textures + volumetric height field.
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage as ndi, optimize
from skimage import transform, morphology, draw
sys.path.insert(0, '.')
from seg import load, mask, gaps2
F = load(sys.argv[1]); B = load(sys.argv[2])[:, ::-1]   # back mirrored into the front frame
out = sys.argv[3] if len(sys.argv) > 3 else '.'
mF, mB = mask(F), mask(B)
H, W = mF.shape
# 1) register mirrored back to the front silhouette: affine (sx, sy, shear, tx, ty) maximising IoU
def warp_mask(p, m, s=4):
    sx, sy, sh, tx, ty = p
    A = np.array([[sx, sh, tx], [0, sy, ty], [0, 0, 1]])
    t = transform.AffineTransform(matrix=np.linalg.inv(A))
    return transform.warp(m.astype(np.float32), t, output_shape=m.shape, order=1) > 0.5
small = lambda m: m[::4, ::4]
def cost(p):
    q = [p[0], p[1], p[2], p[3]/4, p[4]/4]
    w = warp_mask(q, small(mB)); f = small(mF)
    return -((w & f).sum() / (w | f).sum())
ysF, xsF = np.nonzero(mF); ysB, xsB = np.nonzero(mB)
sx0 = (xsF.max()-xsF.min())/(xsB.max()-xsB.min()); sy0 = (ysF.max()-ysF.min())/(ysB.max()-ysB.min())
p0 = [sx0, sy0, 0.0, xsF.min()-xsB.min()*sx0, ysF.min()-ysB.min()*sy0]
r = optimize.minimize(cost, p0, method='Nelder-Mead', options=dict(xatol=1e-4, fatol=1e-5, maxiter=3000))
p = r.x; print('affine', np.round(p, 4).tolist(), 'IoU', -r.fun)
A = np.array([[p[0], p[2], p[3]], [0, p[1], p[4]], [0, 0, 1]])
tA = transform.AffineTransform(matrix=np.linalg.inv(A))
Bw = transform.warp(B, tA, output_shape=(H, W), order=3, mode='edge').astype(np.float32)
mBw = transform.warp(mB.astype(np.float32), tA, output_shape=(H, W), order=1) > 0.5
print('IoU full', (mBw & mF).sum() / (mBw | mF).sum())
# 2) textures: alpha from the front mask; colours bled outward so edges never pick up background
def bleed(img, m):
    core = morphology.erosion(m, morphology.disk(2))
    idx = ndi.distance_transform_edt(~core, return_distances=False, return_indices=True)
    return img[idx[0], idx[1]]
pad = 48
def canvas(a):
    o = np.zeros((H + 2*pad, W + 2*pad) + a.shape[2:], a.dtype); o[pad:pad+H, pad:pad+W] = a; return o
mFc = canvas(mF)
Fc = canvas(bleed(F, mF)); Bc = canvas(bleed(Bw, mBw & mF))
# fill canvas border too
idx = ndi.distance_transform_edt(~canvas(np.ones((H, W), bool)), return_distances=False, return_indices=True)
Fc = Fc[idx[0], idx[1]]; Bc = Bc[idx[0], idx[1]]
Image.fromarray((Fc.clip(0, 1)*255 + .5).astype(np.uint8)).save(f'{out}/front_tex.png')
Image.fromarray((Bc.clip(0, 1)*255 + .5).astype(np.uint8)).save(f'{out}/back_tex.png')
# 3) height: distance to the outline, with the sleeve/torso pockets extended up toward the armpits
cut = mFc.copy()
g, _ = gaps2(mF)
for gg in g:
    x = int(round(gg['topx'])) + pad; y0 = gg['top'] + pad
    y1 = y0 - int(sys.argv[4]) if len(sys.argv) > 4 else y0 - 150
    cut[y1:y0+1, x-1:x+2] = False
# Poisson inflation (lap(phi) = -1 inside, 0 on the outline and on the cuts), solved at 1/3 scale:
# phi^EXP gives round, ridge-free cross-sections; wide parts get relatively flatter than narrow ones.
import scipy.sparse as sp, scipy.sparse.linalg as spl
from skimage.transform import resize
SC = 3
cs = resize(cut.astype(np.float32), (cut.shape[0]//SC, cut.shape[1]//SC), order=1, anti_aliasing=True) > 0.5
n = int(cs.sum()); idx = -np.ones(cs.shape, np.int64); idx[cs] = np.arange(n)
ys_, xs_ = np.nonzero(cs)
rows = [np.arange(n)]; cols = [np.arange(n)]; vals = [np.full(n, 4.0)]
for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
    yy, xx = ys_ + dy, xs_ + dx
    ok = (yy >= 0) & (yy < cs.shape[0]) & (xx >= 0) & (xx < cs.shape[1])
    j = np.full(n, -1); j[ok] = idx[yy[ok], xx[ok]]
    k = j >= 0
    rows.append(np.arange(n)[k]); cols.append(j[k]); vals.append(np.full(k.sum(), -1.0))
Amat = sp.csr_matrix((np.concatenate(vals), (np.concatenate(rows), np.concatenate(cols))), shape=(n, n))
phi_s = np.zeros(cs.shape); phi_s[cs] = spl.spsolve(Amat.tocsc(), np.ones(n))
phi = resize(phi_s, cut.shape, order=1) * (SC*SC)
EXP = float(sys.argv[6]) if len(sys.argv) > 6 else 0.35
K = float(sys.argv[5]) if len(sys.argv) > 5 else 2.6
h = (K * np.power(np.maximum(phi, 0), EXP)).astype(np.float32)
h = ndi.gaussian_filter(h, 1.5) * morphology.erosion(mFc, morphology.disk(1))
ys, xs = np.nonzero(mFc)
meta = dict(W=W + 2*pad, H=H + 2*pad, axis_x=float((xs.min() + xs.max())/2), top=float(ys.min()), bot=float(ys.max()), K=K,
            hmax=float(h.max()), affine=p.tolist(), gaps=g)
np.savez_compressed(f'{out}/geo.npz', m=morphology.dilation(mFc, morphology.disk(2)), h=h, **{k: v for k, v in meta.items() if k in ('W','H','axis_x','top','bot')})
json.dump(meta, open(f'{out}/meta.json', 'w'), indent=1)
print(json.dumps({k: meta[k] for k in ('W','H','axis_x','top','bot','hmax')}))
# previews
ov = np.zeros((H, W, 3), np.uint8); ov[..., 0] = mF*255; ov[..., 1] = mBw*255; ov[..., 2] = (mF & mBw)*255
Image.fromarray(ov).resize((W//2, H//2)).save(f'{out}/_overlay.png')
Image.fromarray((h / h.max() * 255).astype(np.uint8)).resize(((W+2*pad)//2, (H+2*pad)//2)).save(f'{out}/_height.png')
