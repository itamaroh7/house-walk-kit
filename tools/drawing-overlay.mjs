// Checks a plan file against the drawing it was read from (see docs/reading-a-drawing.md):
//   - overlay: draws the plan's rooms (on their wall centre lines), doors, gaps and windows over
//     the drawing, so every edge can be seen to sit on a wall before the house is built
//       npm run drawing:overlay -- <image> <plan-id or plan file> --scale <px per metre> --origin <px,py> [--storey 0]
//     --origin: the drawing's pixel where the plan's (0, 0) is; --scale: pixels per metre
//     (from the drawing's own dimension strings)
//   - compare: a top view of the built house (a screenshot) beside the drawing, one image
//       npm run drawing:overlay -- <image> --compare <screenshot.png>
//     (with a plan id as well, the overlay goes beside the screenshot)
// Writes into drawing-work/ (git-ignored: a drawing and its overlays stay on this computer);
// --out <file.png> to choose the file.
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const scale = +opt('--scale', NaN), origin = opt('--origin', null), storey = +opt('--storey', 0);
const compare = opt('--compare', null), outArg = opt('--out', null);
const [image, planId] = args;
if (!image || (!planId && !compare) || (planId && (!Number.isFinite(scale) || !origin))) {
  console.error('usage: npm run drawing:overlay -- <image> <plan-id> --scale <px/m> --origin <px,py> [--storey 0] [--compare <screenshot.png>] [--out file.png]');
  console.error('       npm run drawing:overlay -- <image> --compare <screenshot.png>');
  process.exit(2);
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const nameOf = (n) => (typeof n === 'string' ? n : n?.en ?? Object.values(n ?? {})[0] ?? '');
const work = path.join(ROOT, 'drawing-work');
const base = path.parse(image).name;

let drawing = await sharp(image).png().toBuffer();
const meta = await sharp(drawing).metadata();
if (planId) {
  // a plan id (src/plans/<id>.js) or the path of a plan file
  const file = /\.m?js$/.test(planId) ? path.resolve(planId) : path.join(ROOT, 'src', 'plans', `${planId}.js`);
  const plan = (await import(pathToFileURL(file).href)).default;
  const [ox, oz] = origin.split(',').map(Number);
  const X = (x) => ox + x * scale, Z = (z) => oz + z * scale;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${meta.width}" height="${meta.height}" font-family="Arial, sans-serif" font-size="${Math.max(11, Math.round(scale * 0.18))}">`;
  // rooms: their outlines on the wall centre lines, a light fill, the name
  for (const r of plan.rooms.filter((q) => (q.storey ?? 0) === storey)) {
    const pts = r.poly.map(([x, z]) => `${X(x).toFixed(1)},${Z(z).toFixed(1)}`).join(' ');
    svg += `<polygon points="${pts}" fill="#005aff" fill-opacity="0.12" stroke="#005aff" stroke-width="3"/>`;
    const xs = r.poly.map((p) => p[0]), zs = r.poly.map((p) => p[1]);
    svg += `<text x="${X(Math.min(...xs)) + 6}" y="${Z(Math.min(...zs)) + 18}" fill="#0000c8">${esc(nameOf(r.name) || r.id)}</text>`;
  }
  // openings on their walls: doors green, sliders and gaps orange, windows magenta
  const COLOUR = { door: '#00c800', front: '#00c800', slider: '#ff8c00', gap: '#ff8c00', window: '#ff00ff' };
  for (const w of plan.walls.filter((q) => (q.storey ?? 0) === storey)) {
    const alongX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    const u0 = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), v = alongX ? w.a[1] : w.a[0];
    for (const o of w.openings ?? []) {
      const a = u0 + o.at - o.w / 2, b = u0 + o.at + o.w / 2;
      const [p, q] = alongX ? [[X(a), Z(v)], [X(b), Z(v)]] : [[X(v), Z(a)], [X(v), Z(b)]];
      svg += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${COLOUR[o.kind] ?? '#ff0000'}" stroke-width="7" stroke-opacity="0.9"/>`;
    }
  }
  for (const sp of (plan.stairs ?? []).filter((s) => s.from === storey || s.from + 1 === storey)) {
    const [x0, z0, x1, z1] = sp.box;
    svg += `<rect x="${X(x0)}" y="${Z(z0)}" width="${(x1 - x0) * scale}" height="${(z1 - z0) * scale}" fill="none" stroke="#c80000" stroke-width="3" stroke-dasharray="8 5"/>`;
  }
  svg += '</svg>';
  drawing = await sharp(drawing).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
}

let out;
if (compare) {
  // the two side by side at the same height
  const h = Math.max(meta.height, 600);
  const left = await sharp(drawing).resize({ height: h }).png().toBuffer();
  const right = await sharp(compare).resize({ height: h }).png().toBuffer();
  const [lw, rw] = [(await sharp(left).metadata()).width, (await sharp(right).metadata()).width];
  out = outArg ? path.resolve(outArg) : path.join(work, `${base}-compare.png`);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp({ create: { width: lw + rw + 20, height: h, channels: 3, background: '#ffffff' } })
    .composite([{ input: left, left: 0, top: 0 }, { input: right, left: lw + 20, top: 0 }]).png().toFile(out);
} else {
  out = outArg ? path.resolve(outArg) : path.join(work, `${base}-overlay-${path.parse(planId).name}${storey ? `-storey${storey}` : ''}.png`);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp(drawing).toFile(out);
}
console.log(out);
