# Build turntable atlases + stills + fallbacks from 144 rendered 1024px frames.
import sys, os, glob, subprocess, json
import numpy as np
from PIL import Image
frames_dir, out, prefix = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out, exist_ok=True)
fs = sorted(glob.glob(os.path.join(frames_dir, 'f*.png')))
assert len(fs) == 144, len(fs)
def down(im, size):
    return im.convert('RGBa').resize((size, size), Image.LANCZOS).convert('RGBA')
frames = [Image.open(f).convert('RGBA') for f in fs]
union = [9999, 9999, 0, 0]
for im in frames:
    a = np.asarray(im)[..., 3]; ys, xs = np.nonzero(a > 8)
    union = [min(union[0], xs.min()), min(union[1], ys.min()), max(union[2], xs.max()), max(union[3], ys.max())]
report = {'union_bbox_1024': [int(v) for v in union]}
for size in (512, 192):
    small = [down(im, size) for im in frames]
    for page in range(24):
        sheet = Image.new('RGBA', (size * 3, size * 2), (0, 0, 0, 0))
        for j in range(6):
            sheet.paste(small[page * 6 + j], (j % 3 * size, j // 3 * size))
        sheet.save(os.path.join(out, f'{prefix}-atlas-{size}-{page:02d}.webp'), 'WEBP', quality=84, method=6, alpha_quality=100)
    if size == 512:
        small[6].save(os.path.join(out, f'{prefix}-front.png'), optimize=True)
        small[78].save(os.path.join(out, f'{prefix}-back.png'), optimize=True)
        small[0].save(os.path.join(out, f'{prefix}-poster.png'), optimize=True)
        anim = small[::2]  # 72 frames, 5 degrees apart
        anim[0].save(os.path.join(out, f'{prefix}-turntable.webp'), 'WEBP', save_all=True, append_images=anim[1:], duration=83, loop=0, quality=72, method=6)
        tmp = os.path.join(out, '_seq'); os.makedirs(tmp, exist_ok=True)
        for i, im in enumerate(small):
            im.save(os.path.join(tmp, f'{i:03d}.png'))
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', '24', '-i', os.path.join(tmp, '%03d.png'),
                        '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '34', '-row-mt', '1', '-auto-alt-ref', '0',
                        os.path.join(out, f'{prefix}-turntable.webm')], check=True)
        for f in glob.glob(os.path.join(tmp, '*.png')): os.remove(f)
        os.rmdir(tmp)
        contact = Image.new('RGBA', (256 * 12, 256 * 2), (30, 32, 40, 255))
        for i, k in enumerate(range(0, 144, 6)):
            t = down(frames[k], 256); bg = Image.new('RGBA', (256, 256), (30, 32, 40, 255)); bg.alpha_composite(t)
            contact.paste(bg, (i % 12 * 256, i // 12 * 256))
        contact.convert('RGB').save(os.path.join(out, '_contact.png'))
report['files'] = {f: os.path.getsize(os.path.join(out, f)) for f in sorted(os.listdir(out)) if not f.startswith('_')}
report['total'] = sum(report['files'].values())
json.dump(report, open(os.path.join(out, '_report.json'), 'w'), indent=1)
print(json.dumps({'union': report['union_bbox_1024'], 'n': len(report['files']), 'total': report['total']}))
