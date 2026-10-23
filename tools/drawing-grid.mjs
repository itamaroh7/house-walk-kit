// A crop of a floor-plan drawing, enlarged, with a labelled pixel grid over it, so walls, door
// openings, windows and fixtures are read as pixel coordinates instead of guessed (see
// docs/reading-a-drawing.md). Thin lines every `step` pixels, bold and numbered every 5 steps;
// the numbers are the original drawing's pixel coordinates.
//   npm run drawing:grid -- <image> <x0> <y0> <x1> <y1> [--zoom 3] [--step 10] [--out file.png]
// Writes drawing-work/<image name>-grid-<x0>-<y0>-<x1>-<y1>.png (the folder is git-ignored: a
// drawing and its crops stay on this computer).
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : fallback; };
const zoom = +opt('--zoom', 3), step = +opt('--step', 10), outArg = opt('--out', null);
const [image, ...box] = args;
const [x0, y0, x1, y1] = box.map(Number);
if (!image || ![x0, y0, x1, y1].every(Number.isFinite) || x1 <= x0 || y1 <= y0) {
  console.error('usage: npm run drawing:grid -- <image> <x0> <y0> <x1> <y1> [--zoom 3] [--step 10] [--out file.png]');
  process.exit(2);
}
const meta = await sharp(image).metadata();
const [cx0, cy0] = [Math.max(0, Math.round(x0)), Math.max(0, Math.round(y0))];
const [cx1, cy1] = [Math.min(meta.width, Math.round(x1)), Math.min(meta.height, Math.round(y1))];
const W = (cx1 - cx0) * zoom, H = (cy1 - cy0) * zoom;

// the grid as an SVG laid over the enlarged crop
const major = step * 5;
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" font-family="Arial, sans-serif" font-size="12">`;
for (let x = Math.ceil(cx0 / step) * step; x < cx1; x += step) {
  const X = (x - cx0) * zoom, bold = x % major === 0;
  svg += `<line x1="${X}" y1="0" x2="${X}" y2="${H}" stroke="${bold ? '#0000ff' : '#78beff'}" stroke-width="${bold ? 2 : 1}" stroke-opacity="${bold ? 0.85 : 0.6}"/>`;
  if (bold) svg += `<text x="${X + 3}" y="13" fill="#0000ff">${x}</text><text x="${X + 3}" y="${H - 4}" fill="#0000ff">${x}</text>`;
}
for (let y = Math.ceil(cy0 / step) * step; y < cy1; y += step) {
  const Y = (y - cy0) * zoom, bold = y % major === 0;
  svg += `<line x1="0" y1="${Y}" x2="${W}" y2="${Y}" stroke="${bold ? '#008200' : '#96e696'}" stroke-width="${bold ? 2 : 1}" stroke-opacity="${bold ? 0.85 : 0.6}"/>`;
  if (bold) svg += `<text x="3" y="${Y - 3}" fill="#007800">${y}</text><text x="${W - 34}" y="${Y - 3}" fill="#007800">${y}</text>`;
}
svg += '</svg>';

const out = outArg ? path.resolve(outArg) : path.join(ROOT, 'drawing-work', `${path.parse(image).name}-grid-${cx0}-${cy0}-${cx1}-${cy1}.png`);
await mkdir(path.dirname(out), { recursive: true });
await sharp(image).extract({ left: cx0, top: cy0, width: cx1 - cx0, height: cy1 - cy0 })
  .resize(W, H, { kernel: 'lanczos3' })
  .composite([{ input: Buffer.from(svg) }])
  .png().toFile(out);
console.log(`${out} (${cx1 - cx0} x ${cy1 - cy0} px of the drawing, x${zoom}, grid every ${step} px)`);
