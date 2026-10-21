// The plan kit: a house is described the way an architect sketches it, and the kit works out the
// rest. A plan file (src/plans/*.js) calls makePlan({ ... }) with
//   - rooms: rectangles [x0, z0, x1, z1] or orthogonal outlines on wall centre lines, each with a
//     `use` (bedroom, living, kitchen, office, bath, wc, laundry, hall, store, ...)
//   - openings at world positions: { kind, x, z, w?, h?, sill?, shutter? }
//   - a site: the plot, the gates, an optional party wall (semi-detached), where north is
// and the kit
//   - draws the walls: wherever two rooms meet (unless they are one open space: the same `zone`,
//     or listed in each other's `open`) and along the outline (exterior walls, finished with the
//     facade of the room inside)
//   - puts every opening on the wall it lies on
//   - adds the plot, the street and the neighbourhood (site.js)
//   - checks the design and lists what is wrong in plan.problems (it never throws, so one bad plan
//     does not stop the others from loading): openings off a wall, openings in the party wall,
//     rooms without daylight, rooms that overlap, rooms that cannot be reached from outside,
//     rooms too small for their use
// It runs in the browser and in Node (tools/check-plans.mjs): no three.js, no DOM.
//
// Units are metres. x runs west -> east, z north -> south (the street is always on the south,
// +z; site.north turns the sun instead of the house).
import { makeSite } from './site.js';

export const EXT = 0.25, INT = 0.12;
export const GREY = 'cladding_anthracite';
const E = 1e-6;

export const LEVEL = { floor: 0.15, ceiling: 3.0, slab: 0.3, parapet: 0.45 };
export const FINISHES = {
  exterior: 'plaster_exterior', interior: 'paint_matte_white', ceiling: 'paint_matte_white',
  plinth: 'stone_travertine', coping: 'aluminium_black',
};

// default sizes of each kind of opening (w, h, sill in metres)
export const OPENING = {
  door: { w: 0.9, h: 2.1 }, front: { w: 0.9, h: 2.2 }, window: { w: 1.4, h: 1.3, sill: 0.9 },
  high: { w: 0.6, h: 0.5, sill: 1.7, kind: 'window' }, slider: { w: 2.4, h: 2.4 }, gap: { w: 1.2, h: 2.3 },
};
// rooms that must get daylight through an outside wall that is not the party wall
export const NEEDS_LIGHT = new Set(['bedroom', 'living', 'kitchen', 'office', 'dining']);
// rooms whose walls are tiled and whose floors take the dark tile
export const WET = new Set(['bath', 'shower', 'wc', 'laundry']);
// rooms that are part of the circulation: inside doors open away from them, into the rooms
export const HALL = new Set(['hall', 'entry', 'living', 'kitchen', 'dining']);
// smallest sensible net area per use (m2, on centre lines); smaller ones are reported
const MIN_AREA = { bedroom: 7, living: 12, kitchen: 5, office: 5, bath: 2.5, shower: 2, wc: 1.1, laundry: 1.5 };

export function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export const rectPoly = ([x0, z0, x1, z1]) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
const areaOf = (poly) => Math.abs(poly.reduce((a, [x, z], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return a + x * z2 - x2 * z; }, 0) / 2);
const label = (r) => (typeof r.name === 'string' ? r.name : r.name?.en ?? Object.values(r.name ?? {})[0] ?? r.id);

export function makePlan(spec) {
  const problems = [];
  const problem = (text) => problems.push(text);
  const rooms = spec.rooms.map((r) => ({ ...r, poly: r.poly ?? rectPoly(r.rect) }));
  const xs = [...new Set(rooms.flatMap((r) => r.poly.map((p) => p[0])))].sort((a, b) => a - b);
  const zs = [...new Set(rooms.flatMap((r) => r.poly.map((p) => p[1])))].sort((a, b) => a - b);
  const roomAt = (x, z) => rooms.find((r) => inside(r.poly, x, z));
  const separated = (a, b) => {
    if (a === b) return false;
    if (!a || !b) return true;
    if (a.zone && a.zone === b.zone) return false;
    return !(a.open?.includes(b.id) || b.open?.includes(a.id));
  };

  // ---- rooms that overlap: a cell of the grid of room coordinates inside two outlines
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    const over = rooms.filter((r) => inside(r.poly, cx, cz));
    if (over.length > 1) problem(`rooms overlap at (${cx.toFixed(2)}, ${cz.toFixed(2)}): ${over.map(label).join(', ')}`);
  }
  for (const r of rooms) {
    const min = MIN_AREA[r.use];
    const a = areaOf(r.poly);
    if (min && a < min) problem(`${label(r)} is ${a.toFixed(1)} m2, small for a ${r.use} (at least ${min} m2)`);
  }

  // ---- the party wall: the outline's outermost line on that side (semi-detached houses)
  const party = spec.site?.party;
  const partyLine = party === 'east' ? xs[xs.length - 1] : party === 'west' ? xs[0] : null;
  if (party && partyLine == null) problem(`site.party must be 'east' or 'west', not '${party}'`);
  const onParty = (seg) => partyLine != null && !seg.alongX && Math.abs(seg.v - partyLine) < E;

  // ---- walls: unit segments between grid lines, merged along each line
  const segs = [];
  const scan = (alongX, lines, cross) => {
    for (const v of lines) {
      for (let i = 0; i < cross.length - 1; i++) {
        const m = (cross[i] + cross[i + 1]) / 2;
        const a = alongX ? roomAt(m, v - 1e-3) : roomAt(v - 1e-3, m), b = alongX ? roomAt(m, v + 1e-3) : roomAt(v + 1e-3, m);
        if (!separated(a, b)) continue;
        const ext = !a || !b;
        segs.push({ alongX, v, u0: cross[i], u1: cross[i + 1], ext, facade: ext ? (a ?? b).facade : null });
      }
    }
  };
  scan(true, zs, xs);
  scan(false, xs, zs);
  const merged = [];
  for (const s of segs) {
    const last = merged[merged.length - 1];
    if (last && last.alongX === s.alongX && Math.abs(last.v - s.v) < E && Math.abs(last.u1 - s.u0) < E && last.ext === s.ext && last.facade === s.facade) last.u1 = s.u1;
    else merged.push({ ...s });
  }
  const walls = merged.map((s) => ({
    a: s.alongX ? [s.u0, s.v] : [s.v, s.u0], b: s.alongX ? [s.u1, s.v] : [s.v, s.u1],
    t: s.ext ? EXT : INT, exterior: s.ext, ...(s.ext && s.facade ? { finish: s.facade } : {}), openings: [], seg: s,
  }));

  // ---- openings onto their walls; the doors make the graph of which room leads to which
  const lit = new Set();
  const links = new Map(rooms.map((r) => [r, new Set()]));
  const OUT = 'outside';
  links.set(OUT, new Set());
  const link = (a, b) => { links.get(a ?? OUT).add(b ?? OUT); links.get(b ?? OUT).add(a ?? OUT); };
  for (const o of spec.openings) {
    const d = OPENING[o.kind];
    if (!d) { problem(`unknown opening kind '${o.kind}' at (${o.x}, ${o.z})`); continue; }
    const w = walls.find(({ seg }) => (seg.alongX
      ? Math.abs(seg.v - o.z) < E && o.x > seg.u0 + E && o.x < seg.u1 - E
      : Math.abs(seg.v - o.x) < E && o.z > seg.u0 + E && o.z < seg.u1 - E));
    if (!w) { problem(`${o.kind} at (${o.x}, ${o.z}) is not on a wall`); continue; }
    if (w.exterior && onParty(w.seg)) { problem(`${o.kind} at (${o.x}, ${o.z}) is in the party wall`); continue; }
    const u = w.seg.alongX ? o.x : o.z;
    const width = o.w ?? d.w;
    if (u - width / 2 < w.seg.u0 - E || u + width / 2 > w.seg.u1 + E) { problem(`${o.kind} at (${o.x}, ${o.z}), ${width} m wide, runs past its wall (${w.seg.u0}..${w.seg.u1})`); continue; }
    const op = { kind: d.kind ?? o.kind, at: u - w.seg.u0, w: width, h: o.h ?? d.h };
    const sill = o.sill ?? d.sill;
    if (sill != null) op.sill = sill;
    if (o.shutter != null) op.shutter = o.shutter;
    w.openings.push(op);
    const [sa, sb] = w.seg.alongX ? [roomAt(o.x, o.z - 0.3), roomAt(o.x, o.z + 0.3)] : [roomAt(o.x - 0.3, o.z), roomAt(o.x + 0.3, o.z)];
    if (op.kind !== 'window') link(sa, sb);
    // the room behind an outside window, glazed door or opening gets its daylight from it
    if (w.exterior && op.kind !== 'door' && op.kind !== 'front') { const r = sa ?? sb; if (r) lit.add(r); }
  }
  // one open space (zone / open) is one room for walking and for daylight
  const touches = (r, q) => xs.some((x) => zs.some((z) => {
    const set = [roomAt(x - 0.01, z - 0.01), roomAt(x + 0.01, z + 0.01), roomAt(x - 0.01, z + 0.01), roomAt(x + 0.01, z - 0.01)];
    return set.includes(r) && set.includes(q);
  }));
  for (const r of rooms) for (const q of rooms) if (r !== q && !separated(r, q) && touches(r, q)) link(r, q);
  for (let pass = 0; pass < 3; pass++) {
    for (const r of rooms) if (!lit.has(r) && rooms.some((q) => lit.has(q) && q !== r && !separated(r, q) && touches(r, q))) lit.add(r);
  }
  const dark = rooms.filter((r) => NEEDS_LIGHT.has(r.use) && !lit.has(r));
  if (dark.length) problem(`no daylight (a window or glazed door in an outside wall${party ? ' other than the party wall' : ''}) in ${dark.map(label).join(', ')}`);
  // every room reachable from outside through doors, gaps, sliders and open spaces
  const reached = new Set([OUT]);
  const queue = [OUT];
  while (queue.length) for (const n of links.get(queue.shift())) if (!reached.has(n)) { reached.add(n); queue.push(n); }
  const shut = rooms.filter((r) => !reached.has(r));
  if (shut.length) problem(`cannot be reached from outside (no door leads there): ${shut.map(label).join(', ')}`);
  for (const w of walls) delete w.seg;

  // ---- the house's finished rooms, and the site around it
  const level = { ...LEVEL, ...spec.level };
  const house = {
    id: spec.id,
    name: spec.name,
    level,
    finishes: { ...FINISHES, ...spec.finishes },
    walls,
    rooms: rooms.map((r) => {
      const wet = r.wet ?? WET.has(r.use);
      return {
        id: r.id, name: r.name ?? r.id, use: r.use ?? 'room', poly: r.poly, ...(r.facade ? { facade: r.facade } : {}),
        floor: r.floor ?? (wet ? 'tiles_floor_dark' : 'floor_porcelain_light'),
        ...(r.walls ? { walls: r.walls } : wet ? { walls: 'tiles_wall_white' } : {}),
        ...((r.hall ?? HALL.has(r.use)) ? { hall: true } : {}), ...(r.safe ? { safe: true } : {}),
      };
    }),
    outdoor: {
      surfaces: [...(spec.outdoor?.surfaces ?? [])],
      pergolas: spec.outdoor?.pergolas ?? [],
      canopies: spec.outdoor?.canopies ?? [],
    },
    details: { ...spec.details, panels: [...(spec.details?.panels ?? [])] },
    garden: { trees: [...(spec.garden?.trees ?? [])], bushes: [...(spec.garden?.bushes ?? [])], beds: [...(spec.garden?.beds ?? [])] },
    furniture: [...(spec.furniture ?? [])],
  };
  const plan = makeSite(house, { ...spec.site, partyLine }, { problem });
  plan.problems = problems;
  return plan;
}

// a row of stepping slabs from (x0, z0) to (x1, z1)
export const stones = (x0, z0, x1, z1, n) => Array.from({ length: n }, (_, i) => {
  const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
  const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
  const [hx, hz] = alongX ? [0.25, 0.35] : [0.35, 0.25];
  return { box: [x - hx, z - hz, x + hx, z + hz], top: 0.015, material: 'concrete_precast' };
});
// a hedge of shrubs along a line
export const hedge = (x0, z0, x1, z1, n, seed = 60) => Array.from({ length: n }, (_, i) => {
  const t = (i + 0.5) / n;
  return [i % 2 ? 'Bush 2' : 'Bush 1', x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, seed + i * 3, 1.2 + (i % 3) * 0.15];
});
// lavender drifts along a bed [x0, z0, x1, z1]
export const lavender = ([x0, z0, x1, z1], b = 0) => {
  const alongX = x1 - x0 > z1 - z0, len = alongX ? x1 - x0 : z1 - z0, n = Math.max(1, Math.floor(len / 0.45));
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n, a = 0.5 + ((i % 2) - 0.5) * 0.3;
    return [alongX ? x0 + t * (x1 - x0) : x0 + a * (x1 - x0), alongX ? z0 + a * (z1 - z0) : z0 + t * (z1 - z0), 0.6 + ((i * 7 + b) % 5) * 0.07];
  });
};
