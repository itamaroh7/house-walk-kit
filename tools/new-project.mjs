// Copies the template (the app, the tools, CLAUDE.md, the example plan) into a folder for a new
// house project, without the plugin's own files (skills, marketplace) or anything downloaded or
// built. Files already in the folder (a floor plan someone dropped there) are kept; a template
// file that would overwrite one stops the copy before anything is written.
//   node tools/new-project.mjs <folder>
import { readdir, mkdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = process.argv[2] && path.resolve(process.argv[2]);
if (!target) { console.error('usage: node tools/new-project.mjs <folder>'); process.exit(2); }

const SKIP = new Set(['.git', '.github', '.claude-plugin', 'skills', 'node_modules', 'dist', 'dist-assets', 'drawing-work', 'PLAN.md']);
const SKIP_PUBLIC = new Set(['library', 'models', 'basis']);
async function files(dir, rel = '') {
  const out = [];
  for (const d of await readdir(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, d.name);
    if (!rel && SKIP.has(d.name)) continue;
    if (rel === 'public' && SKIP_PUBLIC.has(d.name)) continue;
    if (d.isDirectory()) out.push(...await files(dir, r));
    else out.push(r);
  }
  return out;
}

const list = await files(ROOT);
const clashes = [];
for (const f of list) if (await stat(path.join(target, f)).catch(() => null)) clashes.push(f);
if (clashes.length) {
  console.error(`${target} already has ${clashes.length} of the template's files (${clashes.slice(0, 5).join(', ')}${clashes.length > 5 ? ', ...' : ''}); nothing copied. Use an empty folder.`);
  process.exit(1);
}
for (const f of list) {
  await mkdir(path.dirname(path.join(target, f)), { recursive: true });
  await copyFile(path.join(ROOT, f), path.join(target, f));
}
console.log(`copied ${list.length} files into ${target}`);
console.log('next: npm install, npm run assets, npm run dev');
