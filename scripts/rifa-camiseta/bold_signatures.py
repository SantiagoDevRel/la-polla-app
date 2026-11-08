import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi
ink=np.load('ink.npy'); pad=48
T=np.asarray(Image.open('front_tex.png').convert('RGB')).astype(float)
inkc=np.zeros(T.shape[:2],bool); inkc[pad:pad+ink.shape[0], pad:pad+ink.shape[1]]=ink
bold=ndi.binary_dilation(inkc,iterations=3)
a=np.asarray(Image.fromarray((bold*255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float)/255
gold=np.array([236,200,116],float)
out=T*(1-a[...,None]*0.95)+gold*(a[...,None]*0.95)
Image.fromarray(out.clip(0,255).astype(np.uint8)).save('front_tex_bold.png')
print('ok')
