// For maintainers: builds the asset pack that tools/fetch-assets.mjs downloads, from a folder that
// holds a processed copy of the model library (library/ with KTX2 textures, models/ with the sky,
// lawn and character), and writes dist-assets/house-walk-assets-<version>.zip with its SHA-256
// into assets.json. Upload the zip as a GitHub Release asset afterwards.
//   node tools/build-asset-pack.mjs --from <folder with library/ and models/>
//
// On the way it
//   - renames the textures inside every GLB to neutral path-like names: the library's build tools
//     named them after the source file on the machine that made them (a drive, a user folder);
//     'C:\...\raw\ambientcg\Wood049\Wood049_2K-JPG_Color.jpg' becomes 'ambientcg/Wood049/Color.jpg'.
//     The loader shares textures by these names (load-model.js), so equal sources keep equal names
//   - leaves out what the app never loads: the WebP copies of the surface materials (meta.json
//     points at the KTX2 ones), JPEG copies of KTX2 textures, the skies not offered
//   - refuses to finish if any file still holds a local path or a name from PRIVATE
import { readdir, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeZip } from './zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const FROM = arg('--from');
if (!FROM) { console.error('usage: node tools/build-asset-pack.mjs --from <folder with library/ and models/>'); process.exit(2); }
const SRC = path.resolve(FROM);
const config = JSON.parse(await readFile(path.join(ROOT, 'assets.json'), 'utf8'));

// strings that must not ship (lower case); extend before building a pack on another machine
const PRIVATE = [/[a-z]:\\{1,2}users\\{1,2}(?!x+\\)/i, /\/users\/[^/]+\//i, /\/home\/[^/]+\//i,
  /[a-z0-9._%+-]{3,}@[a-z0-9-]{3,}\.(com|net|org|io|co|il|edu|gov)\b/i];
const SKIES = ['kloofendal_48d_partly_cloudy'];

// what goes in: [path relative to SRC, keep(file name) -> boolean]
async function list(dir, keep = () => true) {
  const out = [];
  for (const d of await readdir(path.join(SRC, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, d.name);
    if (d.isDirectory()) out.push(...await list(rel, keep));
    else if (keep(d.name, rel)) out.push(rel);
  }
  return out;
}
const files = [
  ...await list('library', (n, rel) => !(rel.startsWith('library/materials/') && n.endsWith('.webp'))),
  ...await list('models/env', (n) => SKIES.some((s) => n === `${s}_2k.hdr` || n === `${s}_4k_bg.ktx2`) || /^grass_.*\.ktx2$/.test(n)),
  ...await list('models/rb', (n) => !(/^hi_.*\.jpg$/.test(n) && n !== 'hi_head_color.jpg')),
  ...await list('models/crowd', (n) => n === 'player_ao.bin'),
];

// 'C:\\a\\b\\raw\\ambientcg\\Wood049\\Wood049_2K-JPG_Color.jpg' -> 'ambientcg/Wood049/Color.jpg'
function neutral(s) {
  if (!/^([a-z]:[\\/]|[\\/])/i.test(s)) return s;
  const parts = s.split(/[\\/]+/).filter(Boolean);
  const raw = parts.lastIndexOf('raw');
  const keep = raw >= 0 ? parts.slice(raw + 1) : parts.slice(-1);
  const file = keep.pop().replace(/^[A-Za-z0-9]+_\d+K-[A-Z]+_/, '');
  return [...keep, file].join('/');
}
const renamed = new Map();
function clean(v) {
  if (typeof v === 'string') {
    const n = neutral(v);
    if (n !== v) renamed.set(v, n);
    return n;
  }
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
}

// a GLB is a 12-byte header, a JSON chunk and a binary chunk: only the JSON is rewritten
function cleanGlb(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLen)));
  let text = new TextEncoder().encode(JSON.stringify(clean(json)));
  const pad = (4 - (text.length % 4)) % 4;
  text = Uint8Array.from([...text, ...new Array(pad).fill(0x20)]);
  const rest = buf.subarray(20 + jsonLen);
  const out = new Uint8Array(20 + text.length + rest.length);
  const ov = new DataView(out.buffer);
  out.set(buf.subarray(0, 12));
  ov.setUint32(12, text.length, true);
  ov.setUint32(16, 0x4e4f534a, true);   // 'JSON'
  out.set(text, 20);
  out.set(rest, 20 + text.length);
  ov.setUint32(8, out.length, true);
  return out;
}

function blankUserFolders(buf) {
  const text = Buffer.from(buf).toString('latin1');
  const out = Buffer.from(buf);
  for (const m of text.matchAll(/([a-z]:\\{1,2}users\\{1,2})([^\\\0]+)/gi)) out.fill(0x78, m.index + m[1].length, m.index + m[0].length);   // 'x'
  return new Uint8Array(out);
}

const entries = [];
const leaks = [];
let bytes = 0;
for (const rel of files) {
  let data = new Uint8Array(await readFile(path.join(SRC, rel)));
  if (rel.endsWith('.glb')) data = cleanGlb(data);
  // the Rocketbox animation files carry the folder they were exported from on their author's
  // machine: blanked in place, same length, so the FBX structure stays as it is
  else if (rel.endsWith('.fbx')) data = blankUserFolders(data);
  else if (rel.endsWith('.json')) data = new TextEncoder().encode(JSON.stringify(clean(JSON.parse(new TextDecoder().decode(data))), null, 2));
  // every file, binaries included, searched as text for anything personal
  const text = Buffer.from(data).toString('latin1');
  for (const re of PRIVATE) if (re.test(text)) leaks.push(`${rel}: ${text.match(re)[0]}`);
  // KTX2 and WebP are compressed already; models, the HDR sky and the rest still shrink
  entries.push({ name: rel, data, compress: !/\.(ktx2|webp|jpg)$/.test(rel) });
  bytes += data.length;
}
if (leaks.length) {
  console.error(`personal data left in ${leaks.length} files, pack not written:\n  ${leaks.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
const zip = writeZip(entries);
const name = `house-walk-assets-${config.version}.zip`;
await mkdir(path.join(ROOT, 'dist-assets'), { recursive: true });
const out = path.join(ROOT, 'dist-assets', name);
await writeFile(out, zip);
const sha256 = createHash('sha256').update(zip).digest('hex');
await writeFile(`${out}.sha256`, `${sha256}  ${name}\n`);
config.sha256 = sha256;
config.bytes = zip.length;
config.files = files.length;
await writeFile(path.join(ROOT, 'assets.json'), `${JSON.stringify(config, null, 2)}\n`);
console.log(`${files.length} files, ${(bytes / 1e6).toFixed(1)} MB -> ${path.relative(ROOT, out)} (${(zip.length / 1e6).toFixed(1)} MB)`);
console.log(`sha256 ${sha256}`);
console.log(`${renamed.size} texture names rewritten, e.g. ${[...renamed.values()].slice(0, 3).join(', ')}`);
console.log((await stat(out)).size === zip.length ? 'written' : 'size mismatch');
