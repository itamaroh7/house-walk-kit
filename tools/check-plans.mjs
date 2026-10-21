// Runs the checks on every plan in src/plans (or the ones named) and prints a summary: rooms and
// their areas, the plot, and every problem found. Two kinds of checks:
//   - the plan kit's (src/house/kit.js): walls, openings, daylight, overlapping rooms, doors
//   - the layout check (src/house/layout-check.js), once the assets are in public/: furniture in
//     walls, in each other or in doorways, and a walk from the street gate into every room
// Exits with 1 if any plan has a problem, so CI and agents can rely on it.
//   npm run check
//   node tools/check-plans.mjs src/plans/example.js
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkLayout } from '../src/house/layout-check.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'src', 'plans');
const files = process.argv.slice(2).length
  ? process.argv.slice(2).map((f) => path.resolve(f))
  : (await readdir(dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f));
const catalog = await readFile(path.join(ROOT, 'public', 'library', 'catalog.json'), 'utf8').then(JSON.parse).catch(() => null);
if (!catalog) console.log('(no assets in public/ yet: the layout check is skipped - run npm run assets)');

const area = (poly) => Math.abs(poly.reduce((a, [x, z], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return a + x * z2 - x2 * z; }, 0) / 2);
const name = (n) => (typeof n === 'string' ? n : n?.en ?? Object.values(n ?? {})[0]);
let failed = 0;
for (const file of files) {
  let plan;
  try {
    plan = (await import(pathToFileURL(file).href)).default;
  } catch (e) {
    failed++;
    console.log(`\n${path.relative(ROOT, file)}: could not load\n  ${e.stack ?? e}`);
    continue;
  }
  if (!plan?.rooms) continue;
  const total = plan.rooms.reduce((a, r) => a + area(r.poly), 0);
  const [x0, z0, x1, z1] = plan.site.plot;
  console.log(`\n${plan.id} - ${name(plan.name)}`);
  console.log(`  ${plan.rooms.length} rooms, ${total.toFixed(1)} m2 on wall centre lines; plot ${(x1 - x0).toFixed(1)} x ${(z1 - z0).toFixed(1)} m = ${((x1 - x0) * (z1 - z0)).toFixed(0)} m2${plan.site.party ? `, party wall ${plan.site.party}` : ''}`);
  const layout = catalog ? checkLayout(plan, catalog) : { problems: [], rooms: [] };
  const reach = new Map(layout.rooms.map((s) => [s.slice(0, s.lastIndexOf(':')), s.slice(s.lastIndexOf(':') + 2)]));
  for (const r of plan.rooms) console.log(`    ${name(r.name).padEnd(28)} ${r.use.padEnd(8)} ${area(r.poly).toFixed(1).padStart(6)} m2${reach.has(name(r.name)) ? `   walkable ${reach.get(name(r.name))}` : ''}`);
  const problems = [...plan.problems, ...layout.problems];
  if (problems.length) {
    failed++;
    console.log(`  PROBLEMS (${problems.length}):`);
    for (const p of problems) console.log(`    - ${p}`);
  } else console.log(`  checks: OK${catalog ? ' (plan and layout)' : ' (plan only)'}`);
}
console.log(failed ? `\n${failed} plan(s) with problems` : '\nall plans pass');
process.exitCode = failed ? 1 : 0;
