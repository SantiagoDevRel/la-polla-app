# Copy a built armani-v2 asset set + the two real photos into public/prizes/armani-<sha12>/.
import hashlib, os, shutil, sys
src, wt = sys.argv[1], sys.argv[2]
old = sys.argv[3]
files = {f: os.path.join(src, f) for f in sorted(os.listdir(src)) if f.startswith('armani-v2-')}
for f in ('armani-real-front.jpg', 'armani-real-back.jpg'): files[f] = os.path.join(old, f)
h = hashlib.sha256()
for name in sorted(files):
    h.update(name.encode()); h.update(open(files[name], 'rb').read())
dest = os.path.join(wt, 'public', 'prizes', 'armani-' + h.hexdigest()[:12])
assert not os.path.exists(dest), dest
os.makedirs(dest)
for name, p in files.items(): shutil.copyfile(p, os.path.join(dest, name))
print(os.path.basename(dest), len(files), sum(os.path.getsize(p) for p in files.values()))
