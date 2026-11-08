import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import color, morphology, measure
def load(fn):
    return np.asarray(Image.open(fn).convert('RGB')).astype(np.float32)/255
def mask(im):
    hsv=color.rgb2hsv(im); s,v=hsv[...,1],hsv[...,2]
    m=(s>0.18)|(v<0.45)
    m=morphology.opening(m,morphology.disk(2))
    lab=measure.label(m); p=max(measure.regionprops(lab),key=lambda p:p.area)
    m=lab==p.label
    return ndi.binary_fill_holes(morphology.closing(m,morphology.disk(3)))
def gaps(m):
    # background pockets between sleeves and torso: background components that are not the outer
    # background once the bottom row is closed off
    H,W=m.shape
    closed=m.copy()
    ys,xs=np.nonzero(m); bot=ys.max()
    bg=~m
    lab=measure.label(bg)
    outer=lab[0,0]
    out=[]
    # pockets touching the bottom of the shirt: flood background below shirt bottom separately
    cut=bg.copy(); cut[bot-2:, :]=False
    lab2=measure.label(cut)
    for p in measure.regionprops(lab2):
        if lab2[0,0]==p.label or lab2[0,W-1]==p.label: continue
        if p.area<200: continue
        minr,minc,maxr,maxc=p.bbox
        out.append(dict(bbox=p.bbox, area=p.area, top=int(minr)))
    return out
def gaps2(m):
    H,W=m.shape
    inner=np.zeros_like(m)
    for y in range(H):
        xs=np.nonzero(m[y])[0]
        if len(xs)<2: continue
        inner[y, xs.min():xs.max()+1]=True
    pocket=inner & ~m
    lab=measure.label(pocket)
    out=[]
    for p in measure.regionprops(lab):
        if p.area<300: continue
        ys,xs=np.nonzero(lab==p.label)
        top=ys.min(); topx=xs[ys==top].mean()
        # direction near the top: mean x of rows top..top+60
        sel=ys<top+80; 
        out.append(dict(label=p.label, area=int(p.area), top=int(top), topx=float(topx), bottom=int(ys.max()),
                        x80=float(xs[(ys>top+70)&(ys<top+90)].mean())))
    return out, lab
