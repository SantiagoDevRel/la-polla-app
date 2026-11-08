import numpy as np
from PIL import Image
from scipy import ndimage as ndi
im=np.asarray(Image.open('../qwen/out2/ghost44-3.png').convert('RGB')).astype(float)
R,G,B=im[...,0],im[...,1],im[...,2]
ink=(G-0.6*B>12)&(B<200)&(R<215)
logos=((R>175)&(G>175)&(B>175))|((G>R+25)&(G>B+10))
ink&=~ndi.binary_dilation(logos,iterations=4)
reg=np.zeros(ink.shape,bool); reg[250:510,250:470]=True
ink&=reg
lab,n=ndi.label(ink,np.ones((3,3))); sizes=ndi.sum(ink,lab,range(1,n+1))
ink=np.isin(lab,np.nonzero(sizes>=6)[0]+1)
print('ink px',ink.sum())
vis=im.copy(); vis[ink]=[255,255,0]
Image.fromarray(vis[230:530,220:500].astype(np.uint8)).resize((560,600),Image.NEAREST).save('_ink.png')
np.save('ink.npy',ink)
