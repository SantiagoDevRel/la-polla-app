from PIL import Image
import numpy as np
B=Image.open('back_tex.png').convert('RGB')
# pattern-only patch from the lower back (no logo), 300x300
for box in [(330,620,630,920),(300,700,600,1000)]:
    pass
sw=B.crop((330,640,630,940)); sw.save('swatch.png'); print(sw.size)
