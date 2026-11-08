# Blender 5.1 headless: inflated ghost-mannequin jersey (front + back textures on one closed mesh) on a turntable.
import bpy, bmesh, os, sys, math
import numpy as np
argv = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
job = os.environ['BLENDER_JOB_DIR']
data_dir = argv[0]
frames = [int(a) for a in argv[1].split(',')] if len(argv) > 1 and argv[1] != 'all' else list(range(144))
res = int(argv[2]) if len(argv) > 2 else 1024
MIXF = float(argv[3]) if len(argv) > 3 else 0.5     # share of the lit (Principled) shader vs flat emission
SAMPLES = int(argv[4]) if len(argv) > 4 else 96
g = np.load(os.path.join(data_dir, 'geo.npz'))
W, H = int(g['W']), int(g['H']); AX = float(g['axis_x']); top, bot = float(g['top']), float(g['bot'])
mask, hgt = g['m'].astype(bool), g['h'].astype(np.float64)
CY = (top + bot) / 2; S = 1000.0; STEP = 2
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

ys = np.arange(0, H, STEP); xs = np.arange(0, W, STEP)
gx, gy = np.meshgrid(xs, ys)
m = mask[gy, gx]
q = m[:-1,:-1] | m[1:,:-1] | m[:-1,1:] | m[1:,1:]
used = np.zeros_like(m); used[:-1,:-1] |= q; used[1:,:-1] |= q; used[:-1,1:] |= q; used[1:,1:] |= q
idx = -np.ones(m.shape, np.int64); n = int(used.sum()); idx[used] = np.arange(n)
vx, vy = gx[used].astype(np.float64), gy[used].astype(np.float64)
vh = hgt[gy[used], gx[used]]
qi, qj = np.nonzero(q)
co_f = np.stack([(vx - AX)/S, -vh/S, -(vy - CY)/S], 1)      # front surface faces the camera (-Y)
co_b = np.stack([(vx - AX)/S, +vh/S, -(vy - CY)/S], 1)
f_front = np.stack([idx[qi,qj], idx[qi+1,qj], idx[qi+1,qj+1], idx[qi,qj+1]], 1)
f_back = np.stack([idx[qi,qj], idx[qi,qj+1], idx[qi+1,qj+1], idx[qi+1,qj]], 1) + n
co = np.concatenate([co_f, co_b]); faces = np.concatenate([f_front, f_back]); nf = len(faces)
me = bpy.data.meshes.new('jersey')
me.vertices.add(len(co)); me.vertices.foreach_set('co', co.ravel())
me.loops.add(nf*4); me.loops.foreach_set('vertex_index', faces.ravel())
me.polygons.add(nf); me.polygons.foreach_set('loop_start', np.arange(0, nf*4, 4))
me.polygons.foreach_set('material_index', np.r_[np.zeros(len(f_front), np.int32), np.ones(len(f_back), np.int32)])
uv = me.uv_layers.new(name='UVMap')
lv = faces.ravel() % n
uv.data.foreach_set('uv', np.stack([(vx[lv] + 0.5)/W, 1 - (vy[lv] + 0.5)/H], 1).ravel())
me.update(calc_edges=True); me.validate()
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)   # weld the rim where both surfaces reach z = 0
bm.to_mesh(me); bm.free()
for p in me.polygons: p.use_smooth = True
ob = bpy.data.objects.new('jersey', me)

SW = float(argv[5]) if len(argv) > 5 else 0.30     # |n.y| below this: side swatch only
SW2 = float(argv[6]) if len(argv) > 6 else 0.62    # |n.y| above this: front/back photo only
def material(name, tex):
    img = bpy.data.images.load(os.path.join(data_dir, tex)); img.colorspace_settings.name = 'sRGB'
    sw = bpy.data.images.get('swatch.png') or bpy.data.images.load(os.path.join(data_dir, 'swatch.png'))
    sw.colorspace_settings.name = 'sRGB'
    mat = bpy.data.materials.new(name); mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear(); L = nt.links
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img; tx.interpolation = 'Cubic'; tx.extension = 'EXTEND'
    # sides (steep surface, where a front/back projection would smear): the same fabric pattern, box-projected
    tc = nt.nodes.new('ShaderNodeTexCoord')
    mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (1000/416, 1000/416, 1000/416)
    sx = nt.nodes.new('ShaderNodeTexImage'); sx.image = sw; sx.projection = 'BOX'; sx.projection_blend = 0.35
    sx.extension = 'REPEAT'; sx.interpolation = 'Cubic'
    L.new(tc.outputs['Object'], mp.inputs['Vector']); L.new(mp.outputs['Vector'], sx.inputs['Vector'])
    sep = nt.nodes.new('ShaderNodeSeparateXYZ'); L.new(tc.outputs['Normal'], sep.inputs['Vector'])
    ab = nt.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; L.new(sep.outputs['Y'], ab.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange'); mr.interpolation_type = 'SMOOTHSTEP'
    mr.inputs['From Min'].default_value = SW; mr.inputs['From Max'].default_value = SW2
    L.new(ab.outputs[0], mr.inputs['Value'])
    col = nt.nodes.new('ShaderNodeMix'); col.data_type = 'RGBA'
    L.new(mr.outputs['Result'], col.inputs['Factor']); L.new(sx.outputs['Color'], col.inputs[6]); L.new(tx.outputs['Color'], col.inputs[7])
    bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Roughness'].default_value = 0.78
    bs.inputs['Sheen Weight'].default_value = 0.25; bs.inputs['Sheen Roughness'].default_value = 0.5
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.0
    mix = nt.nodes.new('ShaderNodeMixShader'); mix.inputs['Fac'].default_value = MIXF
    L.new(col.outputs[2], bs.inputs['Base Color']); L.new(col.outputs[2], em.inputs['Color'])
    L.new(em.outputs[0], mix.inputs[1]); L.new(bs.outputs[0], mix.inputs[2]); L.new(mix.outputs[0], out.inputs['Surface'])
    return mat
me.materials.append(material('front', 'front_tex.png')); me.materials.append(material('back', 'back_tex.png'))

pivot = bpy.data.objects.new('pivot', None); scene.collection.objects.link(pivot)
scene.collection.objects.link(ob); ob.parent = pivot
# studio: soft key from front-left-top, fill from the right, rim from behind; world gives soft ambient
def area(name, loc, size, energy):
    ld = bpy.data.lights.new(name, 'AREA'); ld.size = size; ld.energy = energy
    lo = bpy.data.objects.new(name, ld); lo.location = loc
    c = lo.constraints.new('TRACK_TO'); c.target = pivot; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'
    scene.collection.objects.link(lo)
area('key', (-1.6, -2.2, 1.4), 2.4, 260)
area('fill', (2.0, -1.8, 0.3), 3.0, 110)
area('rim', (0.6, 2.4, 1.6), 1.6, 120)
world = bpy.data.worlds.new('w'); world.use_nodes = True; scene.world = world
world.node_tree.nodes['Background'].inputs['Color'].default_value = (1, 1, 1, 1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 200; cam_data.sensor_width = 36; cam_data.sensor_fit = 'AUTO'
cam = bpy.data.objects.new('cam', cam_data); scene.collection.objects.link(cam)
shirt_h = (bot - top)/S
dist = (shirt_h/0.82) / (2*math.tan(math.atan(18/200)))
cam.location = (0, -dist, 0); cam.rotation_euler = (math.radians(90), 0, 0)
scene.camera = cam
scene.render.engine = 'CYCLES'
prefs = bpy.context.preferences.addons['cycles'].preferences
prefs.compute_device_type = os.environ.get('BLENDER_BACKEND', 'OPTIX'); prefs.get_devices()
for d in prefs.devices: d.use = d.type != 'CPU'
scene.cycles.device = 'GPU'
scene.cycles.samples = SAMPLES; scene.cycles.use_denoising = True; scene.cycles.use_adaptive_sampling = True
scene.cycles.max_bounces = 3; scene.cycles.diffuse_bounces = 2; scene.cycles.glossy_bounces = 1; scene.cycles.transparent_max_bounces = 2
scene.cycles.filter_width = 1.2
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = res; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'Standard'; scene.view_settings.look = 'None'
scene.render.image_settings.file_format = 'PNG'; scene.render.image_settings.color_mode = 'RGBA'; scene.render.image_settings.color_depth = '8'
os.makedirs(os.path.join(job, 'frames'), exist_ok=True)
for k in frames:
    theta = k*2.5 - 15
    pivot.rotation_euler = (0, 0, math.radians(theta))
    scene.render.filepath = os.path.join(job, 'frames', f'f{k:03d}.png')
    bpy.ops.render.render(write_still=True)
    print('frame', k, theta, flush=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(job, 'turntable.blend'))
print('done', len(frames))
