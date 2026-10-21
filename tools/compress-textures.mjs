// Re-encodes the textures of the model library in public/library as KTX2 / Basis Universal,
// which stays compressed on the GPU: about a quarter of the memory of the WebP or JPEG images it
// replaces, which the GPU holds decoded at 4 bytes a pixel. Run it after adding or replacing a
// model or material (library format: <category>/<id>/meta.json + LOD GLBs):
//   npm run compress                                        everything not converted yet
//   node tools/compress-textures.mjs interior/my_sofa       just these folders
//   node tools/compress-textures.mjs --public <dir> ...     another copy of the public folder
// - colour images (base colour, emission): ETC1S, sRGB; models under 1.5 m capped at 512
// - bump, roughness/metal and occlusion maps: UASTC with Zstandard, capped at 512
// - the farther LOD levels: ETC1S at 128 / 64 (the runtime swaps in the near level's images)
// - the surface materials (library/materials/<id>/color|normal|orm): colour at 1024 as shipped,
//   the bump and roughness maps at 512 (UASTC at 1024 makes files ten times the WebP's), written
//   next to the WebP files, and meta.json pointed at them
// - the sky photos and the lawn (public/models/env/*_4k_bg.jpg, grass_*.jpg): a .ktx2 next to
//   each, which world.js loads instead once useKTX2 is on; the sky in UASTC, as ETC1S blocks show
//   in its smooth gradients, the lawn's bump and roughness at 1024
// - the player character's own maps (public/models/rb/<avatar>/hi_*): the same, colour at 2048,
//   bump and roughness at 1024, which character.js loads instead once useKTX2 is on
// Files already converted are left as they are, so a second run only does what is new.
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// --public <dir>: work on another copy of the public folder (the asset pack's staging copy); the
// worker threads get it through the environment
const at = process.argv.indexOf('--public');
if (at > 0) process.env.HOUSE_WALK_PUBLIC = path.resolve(process.argv[at + 1]);
const PUBLIC = process.env.HOUSE_WALK_PUBLIC ?? path.join(ROOT, 'public');
const LIB = path.join(PUBLIC, 'library');
const ENV = path.join(PUBLIC, 'models', 'env');
const SMALL = 1.5, SMALL_COLOUR = 512, DETAIL = 512, FAR = [0, 128, 64];

// raw RGBA for the encoder, scaled down to `cap` on its longer side; both sides a multiple of 4,
// as the GPU's compressed formats need (a 754 x 1024 print or a 64 x 14 number plate failed to
// upload and drew black)
async function rgba(buffer, cap, flipY = false) {
  let img = sharp(buffer).ensureAlpha();
  const { width, height } = await img.metadata();
  const k = cap && Math.max(width, height) > cap ? cap / Math.max(width, height) : 1;
  const [w, h] = [width, height].map((v) => Math.max(4, Math.round((v * k) / 4) * 4));
  if (w !== width || h !== height) img = img.resize({ width: w, height: h, fit: 'fill', kernel: 'lanczos3' });
  if (flipY) img = img.flip();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

async function encode(buffer, { colour, normal, cap, flipY, etc1s = colour }) {
  const raw = await rgba(buffer, cap, flipY);
  return encodeToKTX2(raw.data, {
    imageDecoder: async () => raw,
    generateMipmap: true, enableDebug: false,
    isPerceptual: colour, isSetKTX2SRGBTransferFunc: colour, isNormalMap: !!normal,
    // the detail maps' channels are independent (roughness, metal, occlusion; the two bump
    // slopes), which ETC1S's shared colour endpoints smear; UASTC keeps them, and RDO with
    // Zstandard brings its files down to about the WebP size
    ...(etc1s
      ? { isUASTC: false, qualityLevel: 192, compressionLevel: 2 }
      : { isUASTC: true, uastcLDRQualityLevel: 2, needSupercompression: true, enableRDO: true, rdoQualityLevel: 3 }),
  });
}

async function convertModel(dir) {
  const { NodeIO } = await import('@gltf-transform/core');
  const { ALL_EXTENSIONS, KHRTextureBasisu } = await import('@gltf-transform/extensions');
  const { MeshoptDecoder, MeshoptEncoder } = await import('meshoptimizer');
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
  const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf8'));
  const small = Math.max(...meta.size) < SMALL;
  const out = [];
  for (const [level, lod] of meta.lods.entries()) {
    const file = path.join(dir, lod.file);
    const doc = await io.read(file);
    const root = doc.getRoot();
    const todo = root.listTextures().filter((t) => t.getMimeType() !== 'image/ktx2');
    if (!todo.length) continue;
    const before = (await stat(file)).size;
    for (const tex of todo) {
      const slots = tex.listParents().flatMap((p) => p.propertyType === 'Material'
        ? ['baseColorTexture', 'emissiveTexture', 'normalTexture', 'metallicRoughnessTexture', 'occlusionTexture'].filter((s) => p[`get${s[0].toUpperCase()}${s.slice(1)}`]?.() === tex)
        : []);
      const colour = slots.some((s) => s === 'baseColorTexture' || s === 'emissiveTexture') || !slots.length;
      const normal = slots.includes('normalTexture');
      const cap = level > 0 ? FAR[level] ?? 64 : colour ? (small ? SMALL_COLOUR : 0) : DETAIL;
      tex.setImage(await encode(tex.getImage(), { colour, normal, cap, etc1s: colour || level > 0 }));
      tex.setMimeType('image/ktx2');
      if (tex.getURI()) tex.setURI(tex.getURI().replace(/\.\w+$/, '.ktx2'));
    }
    doc.createExtension(KHRTextureBasisu).setRequired(true);
    for (const ext of root.listExtensionsUsed()) {
      if (['EXT_texture_webp', 'EXT_texture_avif'].includes(ext.extensionName)) ext.dispose();
    }
    await io.write(file, doc);
    out.push(`${path.relative(LIB, file)}: ${todo.length} images, ${(before / 1e6).toFixed(2)} -> ${((await stat(file)).size / 1e6).toFixed(2)} MB`);
  }
  return out;
}

async function convertMaterial(dir) {
  const metaFile = path.join(dir, 'meta.json');
  const meta = JSON.parse(await readFile(metaFile, 'utf8'));
  const out = [];
  for (const [key, name] of Object.entries(meta.maps ?? {})) {
    if (name.endsWith('.ktx2')) continue;
    const src = path.join(dir, name), dst = src.replace(/\.\w+$/, '.ktx2');
    // the TextureLoader images were flipped on upload (flipY); a compressed image cannot be
    await writeFile(dst, await encode(await readFile(src), { colour: key === 'color', normal: key === 'normal', cap: key === 'color' ? 0 : DETAIL, flipY: true }));
    // a material may draw on another's images ('../asphalt/color.webp'): keep the relative path
    meta.maps[key] = name.replace(/\.\w+$/, '.ktx2');
    out.push(`${path.relative(LIB, dst)}: ${((await stat(src)).size / 1e6).toFixed(2)} -> ${((await stat(dst)).size / 1e6).toFixed(2)} MB`);
  }
  await writeFile(metaFile, JSON.stringify(meta, null, 2));
  return out;
}

async function convertEnv(file) {
  const dst = file.replace(/\.\w+$/, '.ktx2');
  if (await stat(dst).catch(() => null)) return [];
  const name = path.basename(file);
  const sky = name.endsWith('_bg.jpg'), colour = sky || /diff|color|opacity/.test(name);
  await writeFile(dst, await encode(await readFile(file), { colour, normal: name.includes('nor'), cap: colour ? 0 : 1024, flipY: true, etc1s: colour && !sky }));
  return [`${path.relative(PUBLIC, dst)}: ${((await stat(file)).size / 1e6).toFixed(2)} -> ${((await stat(dst)).size / 1e6).toFixed(2)} MB`];
}

if (isMainThread) {
  const only = process.argv.slice(2).filter((a, i, all) => a !== '--public' && all[i - 1] !== '--public');
  const jobs = [];
  for (const cat of ['interior', 'garden', 'street']) {
    for (const d of await readdir(path.join(LIB, cat), { withFileTypes: true }).catch(() => [])) {
      if (d.isDirectory() && (!only.length || only.includes(`${cat}/${d.name}`))) jobs.push({ kind: 'model', dir: path.join(LIB, cat, d.name) });
    }
  }
  for (const d of await readdir(path.join(LIB, 'materials'), { withFileTypes: true }).catch(() => [])) {
    if (d.isDirectory() && (!only.length || only.includes(`materials/${d.name}`))) jobs.push({ kind: 'material', dir: path.join(LIB, 'materials', d.name) });
  }
  for (const f of await readdir(ENV).catch(() => [])) {
    if (/(_4k_bg|^grass_.*)\.jpg$/.test(f) && (!only.length || only.includes(`env/${f}`))) jobs.push({ kind: 'env', dir: path.join(ENV, f) });
  }
  const RB = path.join(PUBLIC, 'models', 'rb');
  for (const avatar of await readdir(RB, { withFileTypes: true }).catch(() => [])) {
    if (!avatar.isDirectory()) continue;
    for (const f of await readdir(path.join(RB, avatar.name))) {
      if (/^hi_.*\.(jpg|webp)$/.test(f) && (!only.length || only.includes(`rb/${avatar.name}/${f}`))) jobs.push({ kind: 'env', dir: path.join(RB, avatar.name, f) });
    }
  }
  const t0 = Date.now();
  let next = 0, failed = 0;
  const run = () => new Promise((resolve) => {
    const w = new Worker(fileURLToPath(import.meta.url), { workerData: null });
    const take = () => {
      if (next >= jobs.length) { w.terminate(); resolve(); return; }
      w.postMessage(jobs[next++]);
    };
    w.on('message', (m) => {
      if (m.error) { failed++; console.error(`FAILED ${m.dir}: ${m.error}`); } else for (const line of m.lines) console.log(line);
      take();
    });
    w.on('error', (e) => { failed++; console.error(e); resolve(); });
    take();
  });
  await Promise.all(Array.from({ length: Math.min(jobs.length, Math.max(1, os.cpus().length - 2)) }, run));
  console.log(`${jobs.length} folders in ${((Date.now() - t0) / 1000).toFixed(0)} s, ${failed} failed`);
  if (failed) process.exitCode = 1;
} else {
  parentPort.on('message', async (job) => {
    try {
      const convert = { model: convertModel, material: convertMaterial, env: convertEnv }[job.kind];
      parentPort.postMessage({ lines: await convert(job.dir) });
    } catch (e) {
      parentPort.postMessage({ dir: job.dir, error: e.stack ?? String(e) });
    }
  });
}
