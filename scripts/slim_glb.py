"""Slim a .glb for the web: drop unused vertex data, int8 normals (KHR_mesh_quantization),
16-bit indices where possible, and downscaled JPEG/PNG textures. Writes a compact new GLB."""
import io, json, struct, sys
import numpy as np
from PIL import Image

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}

def read_glb(path):
    d = open(path, 'rb').read()
    clen = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + clen])
    off = 20 + clen
    blen = struct.unpack('<I', d[off:off + 4])[0]
    return j, d[off + 8: off + 8 + blen]

def accessor_array(j, binb, ai):
    a = j['accessors'][ai]
    assert 'sparse' not in a, 'sparse accessors not supported'
    bv = j['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']]); n = NC[a['type']]
    stride = bv.get('byteStride', dt.itemsize * n)
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    raw = np.frombuffer(binb, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=start)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dt.itemsize * n), strides=(stride, 1)).copy()
    return out.view(dt).reshape(a['count'], n)

def slim(src, dst, max_tex=1024, jpeg_q=85):
    j, binb = read_glb(src)
    out = bytearray(); views = []
    def add_view(data, target=None, stride=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        out.extend(data); views.append(v); return len(views) - 1

    keep_attr = {'POSITION', 'NORMAL', 'TEXCOORD_0'}
    used_acc = set(); normal_acc = set(); index_acc = set()
    for m in j['meshes']:
        for p in m['primitives']:
            assert not p.get('targets'), 'morph targets not supported'
            p['attributes'] = {k: v for k, v in p['attributes'].items() if k in keep_attr}
            for k, v in p['attributes'].items():
                used_acc.add(v)
                if k == 'NORMAL': normal_acc.add(v)
            if 'indices' in p: used_acc.add(p['indices']); index_acc.add(p['indices'])
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: used_acc.add(s['inverseBindMatrices'])
    for an in j.get('animations', []):
        for smp in an['samplers']: used_acc.update([smp['input'], smp['output']])

    new_acc = []; remap = {}
    for ai in sorted(used_acc):
        a = dict(j['accessors'][ai]); arr = accessor_array(j, binb, ai)
        a.pop('byteOffset', None)
        if ai in normal_acc and a['componentType'] == 5126:
            q = np.round(np.clip(arr, -1, 1) * 127).astype(np.int8)
            padded = np.zeros((len(q), 4), np.int8); padded[:, :3] = q
            a.update(componentType=5120, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = add_view(padded.tobytes(), 34962, 4)
        elif ai in index_acc:
            if a['componentType'] == 5125 and arr.max() < 65535:
                arr = arr.astype(np.uint16); a['componentType'] = 5123
            data = arr.tobytes()
            a['bufferView'] = add_view(data, 34963)
        else:
            a['bufferView'] = add_view(arr.tobytes(), 34962 if ai not in index_acc else None)
        remap[ai] = len(new_acc); new_acc.append(a)

    def r(x): return remap[x]
    for m in j['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: r(v) for k, v in p['attributes'].items()}
            if 'indices' in p: p['indices'] = r(p['indices'])
    for s in j.get('skins', []):
        if 'inverseBindMatrices' in s: s['inverseBindMatrices'] = r(s['inverseBindMatrices'])
    for an in j.get('animations', []):
        for smp in an['samplers']: smp['input'] = r(smp['input']); smp['output'] = r(smp['output'])
    j['accessors'] = new_acc

    for img in j.get('images', []):
        if 'bufferView' not in img: continue
        bv = j['bufferViews'][img['bufferView']]
        o = bv.get('byteOffset', 0)
        im = Image.open(io.BytesIO(binb[o:o + bv['byteLength']])); im.load()
        if max(im.size) > max_tex:
            s = max_tex / max(im.size)
            im = im.resize((max(1, round(im.width * s)), max(1, round(im.height * s))), Image.LANCZOS)
        has_alpha = im.mode in ('RGBA', 'LA', 'PA') or (im.mode == 'P' and 'transparency' in im.info)
        if has_alpha:
            al = im.convert('RGBA').getchannel('A')
            has_alpha = al.getextrema()[0] < 250
        buf = io.BytesIO()
        if has_alpha:
            im.convert('RGBA').save(buf, 'PNG', optimize=True); img['mimeType'] = 'image/png'
        else:
            im.convert('RGB').save(buf, 'JPEG', quality=jpeg_q, optimize=True); img['mimeType'] = 'image/jpeg'
        img['bufferView'] = add_view(buf.getvalue())

    j['bufferViews'] = views
    j['buffers'] = [{'byteLength': len(out)}]
    ext = set(j.get('extensionsUsed', [])) | {'KHR_mesh_quantization'}
    j['extensionsUsed'] = sorted(ext)
    j['extensionsRequired'] = sorted(set(j.get('extensionsRequired', [])) | {'KHR_mesh_quantization'})
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((4 - len(js) % 4) % 4)
    while len(out) % 4: out.append(0)
    total = 12 + 8 + len(js) + 8 + len(out)
    with open(dst, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack('<II', len(out), 0x004E4942)); f.write(out)

if __name__ == '__main__':
    slim(sys.argv[1], sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 1024)
