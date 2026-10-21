// Development aid: with ?gpumem in the address, count every WebGL allocation (textures with their
// mip levels, render buffers, vertex and index buffers) as it is made and freed, so
// window.__gpuMemory() can say what the GPU memory is spent on. Without the parameter it does
// nothing. It must be imported before the renderer is created.
const ON = typeof location !== 'undefined' && new URLSearchParams(location.search).has('gpumem');

const BYTES = {
  0x8058: 4, 0x8c43: 4, 0x8051: 4, 0x1908: 4, 0x1907: 4, 0x881a: 8, 0x881b: 8, 0x8814: 16, 0x8815: 16,
  0x8229: 1, 0x822b: 2, 0x822d: 2, 0x822f: 4, 0x822e: 4, 0x8230: 8, 0x8c3a: 4, 0x8059: 4, 0x1903: 1, 0x1909: 1, 0x190a: 2,
  0x81a5: 2, 0x81a6: 4, 0x8cac: 4, 0x88f0: 4, 0x8cad: 8, 0x1902: 4, 0x84f9: 4,
  // compressed: BC7 (BPTC) and BC2/BC3 at a byte a pixel, BC1 at half
  0x8e8c: 1, 0x8e8d: 1, 0x8e8e: 1, 0x8e8f: 1, 0x83f2: 1, 0x83f3: 1, 0x8c4e: 1, 0x8c4f: 1, 0x83f0: 0.5, 0x83f1: 0.5, 0x8c4c: 0.5, 0x8c4d: 0.5,
};
const NAMES = {
  0x8058: 'RGBA8', 0x8c43: 'SRGB8_A8', 0x8051: 'RGB8', 0x1908: 'RGBA', 0x1907: 'RGB', 0x881a: 'RGBA16F', 0x881b: 'RGB16F', 0x8814: 'RGBA32F',
  0x8815: 'RGB32F', 0x8229: 'R8', 0x822b: 'RG8', 0x822d: 'R16F', 0x822f: 'RG16F', 0x822e: 'R32F', 0x8230: 'RG32F', 0x8c3a: 'R11G11B10F',
  0x8e8c: 'BC7', 0x8e8d: 'BC7_SRGB', 0x83f0: 'BC1', 0x83f1: 'BC1A', 0x8c4c: 'BC1_SRGB', 0x8c4d: 'BC1A_SRGB', 0x83f3: 'BC3', 0x8c4f: 'BC3_SRGB',
  0x81a5: 'DEPTH16', 0x81a6: 'DEPTH24', 0x8cac: 'DEPTH32F', 0x88f0: 'DEPTH24_STENCIL8', 0x8cad: 'DEPTH32F_STENCIL8', 0x1902: 'DEPTH', 0x84f9: 'DEPTH_STENCIL',
};
const CUBE = 0x8513, FACES = [0x8515, 0x8516, 0x8517, 0x8518, 0x8519, 0x851a];

if (ON) {
  const P = WebGL2RenderingContext.prototype;
  const textures = new Map(), renderbuffers = new Map(), buffers = new Map();
  const bound = new Map();
  let unit = 0, rb = null;
  const boundBuffers = new Map();
  const texOf = (target) => bound.get(`${unit}:${FACES.includes(target) ? CUBE : target}`);
  const entry = (t) => {
    if (!textures.has(t)) textures.set(t, { levels: new Map(), kind: '', w: 0, h: 0, d: 1, fmt: 0 });
    return textures.get(t);
  };
  const wrap = (name, after) => {
    const orig = P[name];
    P[name] = function (...a) { const r = orig.apply(this, a); after.call(this, a, r); return r; };
  };
  wrap('activeTexture', ([u]) => { unit = u - 0x84c0; });
  wrap('bindTexture', ([target, t]) => { bound.set(`${unit}:${target}`, t); });
  wrap('texStorage2D', ([target, levels, fmt, w, h]) => {
    const e = entry(texOf(target)), faces = target === CUBE ? 6 : 1;
    e.levels.clear();
    for (let l = 0; l < levels; l++) e.levels.set(`s${l}`, faces * (BYTES[fmt] ?? 4) * Math.max(1, w >> l) * Math.max(1, h >> l));
    Object.assign(e, { kind: target === CUBE ? 'cube' : '2d', w, h, fmt });
  });
  wrap('texStorage3D', ([target, levels, fmt, w, h, d]) => {
    const e = entry(texOf(target));
    e.levels.clear();
    for (let l = 0; l < levels; l++) e.levels.set(`s${l}`, (BYTES[fmt] ?? 4) * Math.max(1, w >> l) * Math.max(1, h >> l) * (target === 0x806f ? Math.max(1, d >> l) : d));
    Object.assign(e, { kind: target === 0x806f ? '3d' : 'array', w, h, d, fmt });
  });
  wrap('texImage2D', (a) => {
    const [target, level, fmt] = a;
    let w, h;
    if (a.length >= 8) { w = a[3]; h = a[4]; } else { const src = a[5]; w = src?.width ?? src?.videoWidth ?? 0; h = src?.height ?? src?.videoHeight ?? 0; }
    const e = entry(texOf(target));
    e.levels.set(`${target}:${level}`, (BYTES[fmt] ?? 4) * w * h);
    if (level === 0) Object.assign(e, { kind: FACES.includes(target) ? 'cube' : '2d', w, h, fmt });
  });
  wrap('texImage3D', ([target, level, fmt, w, h, d]) => {
    const e = entry(texOf(target));
    e.levels.set(`${target}:${level}`, (BYTES[fmt] ?? 4) * w * h * d);
    if (level === 0) Object.assign(e, { kind: '3d', w, h, d, fmt });
  });
  wrap('generateMipmap', ([target]) => {
    const e = textures.get(texOf(target));
    if (e && ![...e.levels.keys()].some((k) => k.startsWith('s'))) e.levels.set('mips', Math.round([...e.levels.values()].reduce((x, y) => x + y, 0) / 3));
  });
  wrap('deleteTexture', ([t]) => textures.delete(t));
  wrap('bindRenderbuffer', ([, r]) => { rb = r; });
  wrap('renderbufferStorage', ([, fmt, w, h]) => renderbuffers.set(rb, { bytes: (BYTES[fmt] ?? 4) * w * h, w, h, fmt, samples: 1 }));
  wrap('renderbufferStorageMultisample', ([, samples, fmt, w, h]) => renderbuffers.set(rb, { bytes: (BYTES[fmt] ?? 4) * w * h * Math.max(1, samples), w, h, fmt, samples }));
  wrap('deleteRenderbuffer', ([r]) => renderbuffers.delete(r));
  wrap('bindBuffer', ([target, b]) => boundBuffers.set(target, b));
  wrap('bufferData', ([target, data]) => {
    const b = boundBuffers.get(target);
    if (b) buffers.set(b, { bytes: typeof data === 'number' ? data : data?.byteLength ?? 0, target });
  });
  wrap('deleteBuffer', ([b]) => buffers.delete(b));

  // totals by kind, and the largest allocations with their size and format
  window.__gpuMemory = () => {
    const list = [];
    for (const e of textures.values()) {
      const bytes = [...e.levels.values()].reduce((x, y) => x + y, 0);
      list.push({ what: `${e.kind} ${e.w}x${e.h}${e.d > 1 ? 'x' + e.d : ''} ${NAMES[e.fmt] ?? e.fmt}${e.levels.size > 1 ? ' +mips' : ''}`, bytes, kind: `texture ${e.kind}` });
    }
    for (const r of renderbuffers.values()) list.push({ what: `renderbuffer ${r.w}x${r.h} ${NAMES[r.fmt] ?? r.fmt}${r.samples > 1 ? ` x${r.samples} samples` : ''}`, bytes: r.bytes, kind: 'renderbuffer' });
    for (const b of buffers.values()) list.push({ what: b.target === 0x8893 ? 'index buffer' : 'vertex buffer', bytes: b.bytes, kind: b.target === 0x8893 ? 'index buffers' : 'vertex buffers' });
    const byKind = {};
    for (const x of list) byKind[x.kind] = (byKind[x.kind] ?? 0) + x.bytes;
    const groups = new Map();
    for (const x of list) { const g = groups.get(x.what) ?? { what: x.what, n: 0, bytes: 0 }; g.n++; g.bytes += x.bytes; groups.set(x.what, g); }
    const MB = (b) => Math.round(b / 1e5) / 10;
    return {
      totalMB: MB(list.reduce((s, x) => s + x.bytes, 0)),
      byKindMB: Object.fromEntries(Object.entries(byKind).map(([k, v]) => [k, MB(v)])),
      largest: [...groups.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 40).map((g) => `${MB(g.bytes)} MB  ${g.n} x ${g.what}`),
    };
  };
}
