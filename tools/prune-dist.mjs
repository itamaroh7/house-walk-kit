// Runs after `vite build` (npm run build): trims dist/ to what the site's plans use, so an upload
// to a host is a fraction of the whole library and visitors' browsers can cache what remains.
//   - models: only the ones the plans place, plus those every house uses (doors, windows,
//     sliders, ceiling lights: build.js OPENING_MODELS and the downlight); materials stay whole
//   - light bakes (dist/gi): only each plan's current one; a plan without one is reported, as
//     every visitor's browser would then compute it (1-5 minutes) on the first visit
//   - a summary of sizes, and the first-visit download measured for the progress bar
import { readdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bakeFile } from '../src/house/bake-key.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ALWAYS = ['interior/door_interior', 'interior/door_front', 'interior/window_aluminium', 'interior/sliding_door', 'interior/ceiling_light_recessed'];

async function size(p) {
  const s = await stat(p).catch(() => null);
  if (!s) return 0;
  if (!s.isDirectory()) return s.size;
  let n = 0;
  for (const e of await readdir(p)) n += await size(path.join(p, e));
  return n;
}
const mb = (n) => `${(n / 1e6).toFixed(1)} MB`;

if (!(await stat(DIST).catch(() => null))) { console.error('no dist/: run vite build first'); process.exit(1); }
const before = await size(DIST);
const plans = [];
for (const f of (await readdir(path.join(ROOT, 'src', 'plans'))).filter((n) => n.endsWith('.js'))) {
  const p = (await import(pathToFileURL(path.join(ROOT, 'src', 'plans', f)).href)).default;
  if (p?.rooms) plans.push(p);
}

// models
const used = new Set([...ALWAYS, ...plans.flatMap((p) => p.furniture.map(([m]) => m))]);
let removed = 0;
for (const cat of ['interior', 'garden', 'street']) {
  for (const id of await readdir(path.join(DIST, 'library', cat)).catch(() => [])) {
    if (used.has(`${cat}/${id}`)) continue;
    await rm(path.join(DIST, 'library', cat, id), { recursive: true });
    removed++;
  }
}
const catalogFile = path.join(DIST, 'library', 'catalog.json');
const catalog = await readFile(catalogFile, 'utf8').then(JSON.parse).catch(() => null);
if (catalog) await writeFile(catalogFile, JSON.stringify({ models: catalog.models.filter((m) => used.has(m.path)) }, null, 2));

// light bakes
const keep = new Set(plans.map((p) => bakeFile(p)));
const bakes = await readdir(path.join(DIST, 'gi')).catch(() => []);
for (const f of bakes) if (!keep.has(f)) await rm(path.join(DIST, 'gi', f));
const missing = plans.filter((p) => !bakes.includes(bakeFile(p)));

const after = await size(DIST);
console.log(`dist: ${mb(before)} -> ${mb(after)} (${removed} unused models and ${bakes.filter((f) => !keep.has(f)).length} old light bakes left out)`);
console.log(`plans: ${plans.map((p) => p.id).join(', ')}; models shipped: ${used.size}`);
if (missing.length) {
  console.log(`WARNING: no light bake for ${missing.map((p) => p.id).join(', ')}: every visitor would compute it on the first visit.`);
  console.log('  Open each in the dev server (npm run dev, ?plan=<id>) until the light is done, then build again.');
}
