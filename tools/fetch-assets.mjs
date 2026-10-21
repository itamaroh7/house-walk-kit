// Puts the 3D assets (models, materials, sky, character) into public/: downloads the asset pack
// named in assets.json (a GitHub Release asset), checks its SHA-256, and unpacks it.
//   npm run assets                         download (kept in dist-assets/ for next time)
//   npm run assets -- --from <pack.zip>    use a pack already on this computer
//   npm run assets -- --url <url>          download from somewhere else (a mirror)
//   npm run assets -- --force              unpack again even if this version is already there
// Also copies three.js's Basis transcoder into public/basis (for the KTX2 textures).
import { readFile, writeFile, mkdir, cp, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readZip } from './zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };
const config = JSON.parse(await readFile(path.join(ROOT, 'assets.json'), 'utf8'));
const marker = path.join(PUBLIC, 'library', '.pack-version');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

async function copyBasis() {
  const dst = path.join(PUBLIC, 'basis');
  if (await stat(path.join(dst, 'basis_transcoder.wasm')).catch(() => null)) return;
  const src = path.join(ROOT, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis');
  if (!(await stat(src).catch(() => null))) { console.log('note: run npm install first, then npm run assets again (for the Basis transcoder)'); return; }
  await cp(src, dst, { recursive: true });
}

if (!process.argv.includes('--force') && !arg('--from') && (await readFile(marker, 'utf8').catch(() => '')).trim() === config.version) {
  await copyBasis();
  console.log(`assets ${config.version} are already in public/ (--force to unpack again)`);
  process.exit(0);
}

let zip;
const from = arg('--from');
const cached = path.join(ROOT, 'dist-assets', path.basename(new URL(arg('--url') ?? config.url).pathname));
if (from) {
  zip = await readFile(path.resolve(from));
  console.log(`using ${from} (${mb(zip.length)})`);
} else if ((await stat(cached).catch(() => null)) && sha(await readFile(cached)) === config.sha256) {
  zip = await readFile(cached);
  console.log(`using the pack downloaded before: ${path.relative(ROOT, cached)}`);
} else {
  const url = arg('--url') ?? config.url;
  if (url.includes('/OWNER/')) {
    console.error('assets.json has no download address yet (OWNER placeholder). Use --from <pack.zip>, or set the repository with node tools/set-owner.mjs <github-user>.');
    process.exit(2);
  }
  console.log(`downloading ${url}${config.bytes ? ` (${mb(config.bytes)})` : ''}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) { console.error(`download failed: HTTP ${res.status} ${res.statusText}`); process.exit(1); }
  const total = +res.headers.get('content-length') || config.bytes || 0;
  const chunks = [];
  let got = 0, shown = -1;
  for await (const chunk of res.body) {
    chunks.push(chunk);
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 100) : -1;
    if (pct !== shown && pct % 5 === 0) { shown = pct; process.stdout.write(`\r  ${pct}% of ${mb(total)}   `); }
  }
  process.stdout.write('\n');
  zip = Buffer.concat(chunks);
  await mkdir(path.dirname(cached), { recursive: true });
  await writeFile(cached, zip);
}

const hash = sha(zip);
if (config.sha256 && hash !== config.sha256) {
  console.error(`the pack's SHA-256 is ${hash}, assets.json expects ${config.sha256}: not unpacked (a damaged download, or a pack of another version)`);
  process.exit(1);
}
console.log(`SHA-256 ${hash} ${config.sha256 ? 'matches assets.json' : '(assets.json has none to compare)'}`);

// a fresh copy of what the pack holds; nothing outside public/library and public/models is touched
await rm(path.join(PUBLIC, 'library'), { recursive: true, force: true });
await rm(path.join(PUBLIC, 'models'), { recursive: true, force: true });
let n = 0, bytes = 0;
for (const { name, data } of readZip(zip)) {
  const dst = path.resolve(PUBLIC, name);
  // only paths inside public/library or public/models (a crafted pack cannot write elsewhere)
  if (!['library', 'models'].some((top) => dst.startsWith(path.join(PUBLIC, top) + path.sep))) throw new Error(`unexpected path in the pack: ${name}`);
  await mkdir(path.dirname(dst), { recursive: true });
  await writeFile(dst, data);
  n++;
  bytes += data.length;
}
await writeFile(marker, `${config.version}\n`);
await copyBasis();
console.log(`unpacked ${n} files (${mb(bytes)}) into public/library and public/models`);
