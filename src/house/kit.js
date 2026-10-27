// The plan kit: a house is described the way an architect sketches it, and the kit works out the
// rest. A plan file (src/plans/*.js) calls makePlan({ ... }) with
//   - rooms: rectangles [x0, z0, x1, z1] or orthogonal outlines on wall centre lines, each with a
//     `use` (bedroom, living, kitchen, office, bath, wc, laundry, hall, store, ...) and a
//     `storey` (0, the ground floor, by default; up to four storeys); `void: true` on an upper
//     room makes it the upper part of a double-height room (no floor; the same outline below)
//   - openings at world positions: { kind, x, z, w?, h?, sill?, shutter?, storey?, into? }
//   - stairs: straight flights { from, box: [x0, z0, x1, z1], up: 'north' | 'south' | 'east' | 'west' },
//     or U and L stairs { from, box: the well, flights: [{ box, up }, ...], landings: [box, ...] }
//   - a site: the plot, the gates, an optional party wall (semi-detached), where north is
// and the kit
//   - draws the walls, storey by storey: wherever two rooms meet (unless they are one open space:
//     the same `zone`, or listed in each other's `open`) and along the outline (exterior walls,
//     finished with the facade of the room inside; where the next storey's outside wall stands on
//     one, it stops at that floor instead of rising to a parapet)
//   - puts every opening on the wall it lies on
//   - adds the plot, the street and the neighbourhood (site.js)
//   - checks the design and lists what is wrong in plan.problems (it never throws, so one bad plan
//     does not stop the others from loading): openings off a wall, openings in the party wall,
//     rooms without daylight, rooms that overlap, upper rooms with nothing under them, stairs that
//     are too steep or lead nowhere, rooms that cannot be reached from outside, rooms too small
//     for their use
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
  const level = { ...LEVEL, ...spec.level };
  const H = level.ceiling + level.slab;            // floor to floor
  const rooms = spec.rooms.map((r) => ({ ...r, poly: r.poly ?? rectPoly(r.rect), storey: r.storey ?? 0 }));
  const storeys = Math.max(...rooms.map((r) => r.storey)) + 1;
  // one grid of room coordinates for every storey, so the walls of one storey line up with the
  // walls above and below it
  const xs = [...new Set(rooms.flatMap((r) => r.poly.map((p) => p[0])))].sort((a, b) => a - b);
  const zs = [...new Set(rooms.flatMap((r) => r.poly.map((p) => p[1])))].sort((a, b) => a - b);
  const roomAt = (x, z, s = 0) => rooms.find((r) => r.storey === s && inside(r.poly, x, z));
  const on = (s) => (s ? ` on storey ${s}` : '');
  const separated = (a, b) => {
    if (a === b) return false;
    if (!a || !b) return true;
    if (a.zone && a.zone === b.zone) return false;
    return !(a.open?.includes(b.id) || b.open?.includes(a.id));
  };

  // ---- rooms that overlap, and upper rooms with nothing under them
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
    for (let st = 0; st < storeys; st++) {
      const over = rooms.filter((r) => r.storey === st && inside(r.poly, cx, cz));
      if (over.length > 1) problem(`rooms overlap at (${cx.toFixed(2)}, ${cz.toFixed(2)})${on(st)}: ${over.map(label).join(', ')}`);
      if (st > 0 && over.length && !roomAt(cx, cz, st - 1)) problem(`${label(over[0])} (storey ${st}) overhangs at (${cx.toFixed(2)}, ${cz.toFixed(2)}): every upper room must stand on rooms of the storey below`);
    }
  }
  // a void sits exactly over one room of the storey below: that room rises through both
  for (const r of rooms.filter((q) => q.void)) {
    const same = (p, q) => p.length === q.length && p.every(([x, z]) => q.some(([x2, z2]) => Math.abs(x - x2) < E && Math.abs(z - z2) < E));
    if (!r.storey || !rooms.some((q) => q.storey === r.storey - 1 && same(q.poly, r.poly))) problem(`${label(r)} is a void: it must have exactly the outline of a room on the storey below`);
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

  // ---- walls, storey by storey: unit segments between grid lines, merged along each line
  const merged = [];
  for (let st = 0; st < storeys; st++) {
    const segs = [];
    const scan = (alongX, lines, cross) => {
      for (const v of lines) {
        for (let i = 0; i < cross.length - 1; i++) {
          const m = (cross[i] + cross[i + 1]) / 2;
          const a = alongX ? roomAt(m, v - 1e-3, st) : roomAt(v - 1e-3, m, st), b = alongX ? roomAt(m, v + 1e-3, st) : roomAt(v + 1e-3, m, st);
          if (!separated(a, b)) continue;
          const ext = !a || !b;
          // an outside wall with the next storey's outside wall standing on it stops at that
          // storey's floor (no parapet, no coping); elsewhere it rises to the parapet
          const above = ext && st + 1 < storeys && (() => {
            const c = alongX ? roomAt(m, v - 1e-3, st + 1) : roomAt(v - 1e-3, m, st + 1), d = alongX ? roomAt(m, v + 1e-3, st + 1) : roomAt(v + 1e-3, m, st + 1);
            return !c !== !d;
          })();
          segs.push({ st, alongX, v, u0: cross[i], u1: cross[i + 1], ext, cov: above ? [[cross[i], cross[i + 1]]] : [], facade: ext ? (a ?? b).facade : null });
        }
      }
    };
    scan(true, zs, xs);
    scan(false, xs, zs);
    for (const sg of segs) {
      const last = merged[merged.length - 1];
      if (last && last.st === sg.st && last.alongX === sg.alongX && Math.abs(last.v - sg.v) < E && Math.abs(last.u1 - sg.u0) < E && last.ext === sg.ext && last.facade === sg.facade) {
        last.u1 = sg.u1;
        // the stretches covered by the storey above, joined where they meet
        for (const [c0, c1] of sg.cov) {
          const prev = last.cov[last.cov.length - 1];
          if (prev && Math.abs(prev[1] - c0) < E) prev[1] = c1; else last.cov.push([c0, c1]);
        }
      } else merged.push({ ...sg, cov: [...sg.cov.map((c) => [...c])] });
    }
  }
  const walls = merged.map((sg) => ({
    a: sg.alongX ? [sg.u0, sg.v] : [sg.v, sg.u0], b: sg.alongX ? [sg.u1, sg.v] : [sg.v, sg.u1],
    t: sg.ext ? EXT : INT, exterior: sg.ext, ...(sg.ext && sg.facade ? { finish: sg.facade } : {}),
    // covered: [u0, u1] stretches (in x for a wall along x, else in z) with the next storey's
    // outside wall standing on them
    ...(sg.st ? { storey: sg.st } : {}), ...(sg.cov.length ? { covered: sg.cov } : {}), openings: [], seg: sg,
  }));

  // ---- openings onto their walls; the doors make the graph of which room leads to which
  const lit = new Set();
  const links = new Map(rooms.map((r) => [r, new Set()]));
  const OUT = 'outside';
  links.set(OUT, new Set());
  const link = (a, b) => { links.get(a ?? OUT).add(b ?? OUT); links.get(b ?? OUT).add(a ?? OUT); };
  for (const o of spec.openings) {
    const d = OPENING[o.kind], st = o.storey ?? 0;
    if (!d) { problem(`unknown opening kind '${o.kind}' at (${o.x}, ${o.z})`); continue; }
    const w = walls.find(({ seg }) => seg.st === st && (seg.alongX
      ? Math.abs(seg.v - o.z) < E && o.x > seg.u0 + E && o.x < seg.u1 - E
      : Math.abs(seg.v - o.x) < E && o.z > seg.u0 + E && o.z < seg.u1 - E));
    if (!w) { problem(`${o.kind} at (${o.x}, ${o.z})${on(st)} is not on a wall`); continue; }
    if (w.exterior && onParty(w.seg)) { problem(`${o.kind} at (${o.x}, ${o.z})${on(st)} is in the party wall`); continue; }
    if (st > 0 && (o.kind === 'front' || o.kind === 'gap') && w.exterior) { problem(`${o.kind} at (${o.x}, ${o.z}) on storey ${st} opens onto thin air`); continue; }
    const u = w.seg.alongX ? o.x : o.z;
    const width = o.w ?? d.w;
    if (u - width / 2 < w.seg.u0 - E || u + width / 2 > w.seg.u1 + E) { problem(`${o.kind} at (${o.x}, ${o.z})${on(st)}, ${width} m wide, runs past its wall (${w.seg.u0}..${w.seg.u1})`); continue; }
    const op = { kind: d.kind ?? o.kind, at: u - w.seg.u0, w: width, h: o.h ?? d.h };
    const sill = o.sill ?? d.sill;
    if (sill != null) op.sill = sill;
    if (o.shutter != null) op.shutter = o.shutter;
    // into: the id of the room an inside door opens into (by default away from the hall)
    if (o.into) op.into = o.into;
    w.openings.push(op);
    const [sa, sb] = w.seg.alongX ? [roomAt(o.x, o.z - 0.3, st), roomAt(o.x, o.z + 0.3, st)] : [roomAt(o.x - 0.3, o.z, st), roomAt(o.x + 0.3, o.z, st)];
    // a door from an upper storey to the outside opens onto the roof below: no way in or out
    if (op.kind !== 'window' && (st === 0 || (sa && sb))) link(sa, sb);
    // the room behind an outside window, glazed door or opening gets its daylight from it
    if (w.exterior && op.kind !== 'door' && op.kind !== 'front') { const r = sa ?? sb; if (r) lit.add(r); }
  }

  // ---- stairs from one storey to the next: a straight flight (`box`, `up` the way one climbs),
  // or flights joined by landings (`flights: [{ box, up }, ...]`, `landings: [box, ...]`, one
  // between each two flights: a U or L stair) with `box` the stairwell, the opening in the floor
  // above. The risers are shared out over the flights by their length, each flight's last riser
  // stepping onto the landing (or the floor above)
  const RISE_MAX = 0.19, TREAD = [0.24, 0.32];
  const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
  const stairs = [];
  const cornersOf = ([x0, z0, x1, z1]) => [[x0 + 0.05, z0 + 0.05], [x1 - 0.05, z0 + 0.05], [x0 + 0.05, z1 - 0.05], [x1 - 0.05, z1 - 0.05]];
  const inOneRoom = (b, st) => { const c = cornersOf(b).map(([x, z]) => roomAt(x, z, st)); return c[0] && c.every((r) => r === c[0]); };
  for (const sp of spec.stairs ?? []) {
    const from = sp.from ?? 0;
    const specFlights = sp.flights ?? [{ box: sp.box, up: sp.up }];
    const landings = sp.landings ?? [];
    const bad = specFlights.find((f) => !DIRS[f.up]);
    if (bad) { problem(`stairs at [${bad.box}]: up must be 'north', 'south', 'east' or 'west'`); continue; }
    if (from + 1 >= storeys) { problem(`stairs at [${sp.box}] climb from storey ${from} to a storey with no rooms`); continue; }
    if (landings.length !== specFlights.length - 1) { problem(`stairs at [${sp.box}]: ${specFlights.length} flights need ${specFlights.length - 1} landings`); continue; }
    const runs = specFlights.map((f) => (DIRS[f.up][0] ? f.box[2] - f.box[0] : f.box[3] - f.box[1]));
    const risers = Math.ceil(H / RISE_MAX), treads = risers - specFlights.length, total = runs.reduce((a, b) => a + b, 0);
    // treads per flight in proportion to its run, the last flight taking what is left
    const counts = runs.map((r) => Math.max(1, Math.round((r / total) * treads)));
    counts[counts.length - 1] = treads - counts.slice(0, -1).reduce((a, b) => a + b, 0);
    let climbed = 0;
    const flights = specFlights.map((f, i) => {
      const dir = DIRS[f.up], width = dir[0] ? f.box[3] - f.box[1] : f.box[2] - f.box[0], tread = runs[i] / counts[i];
      if (counts[i] < 1 || tread < TREAD[0] || tread > TREAD[1]) problem(`stairs at [${f.box}]: ${counts[i]} treads in ${runs[i].toFixed(2)} m of run (${(tread * 100).toFixed(1)} cm each; ${TREAD.map((t) => t * 100).join('-')} cm), risers of ${(H / risers * 100).toFixed(1)} cm`);
      if (width < 0.8) problem(`stairs at [${f.box}] are ${width.toFixed(2)} m wide (at least 0.8 m)`);
      if (!inOneRoom(f.box, from)) problem(`stairs at [${f.box}] must stand inside one room of storey ${from}`);
      const flight = { box: f.box, up: f.up, risers: counts[i] + 1, start: climbed };
      climbed += counts[i] + 1;
      return flight;
    });
    for (const l of landings) if (!inOneRoom(l, from)) problem(`the landing [${l}] must lie inside one room of storey ${from}`);
    const well = sp.box ?? specFlights[0].box;
    // the well within one room above (its floor, and the ceiling below, are cut for it)
    if (!inOneRoom(well, from + 1)) problem(`the stairwell [${well}] must lie inside one room of storey ${from + 1} (the opening in its floor)`);
    // where one steps on (before the first step) and off (past the last), 0.4 m out
    const end = (f, sign) => {
      const [x0, z0, x1, z1] = f.box, dir = DIRS[f.up], cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      const half = (dir[0] ? x1 - x0 : z1 - z0) / 2 + 0.4;
      return [cx + sign * dir[0] * half, cz + sign * dir[1] * half];
    };
    const bottom = end(specFlights[0], -1), top = end(specFlights[specFlights.length - 1], 1);
    const a = roomAt(...bottom, from), b = roomAt(...top, from + 1);
    if (!a) problem(`nowhere to step onto the stairs at [${well}] (${bottom.map((v) => v.toFixed(2))}, storey ${from})`);
    if (!b) problem(`nowhere to step off the stairs at [${well}] (${top.map((v) => v.toFixed(2))}, storey ${from + 1})`);
    if (a && b) link(a, b);
    // the way up, for the tests' walker: each flight's foot and head (0.2 m in from its ends),
    // across each landing, then off at the top
    const inner = (f, sign) => { const [x0, z0, x1, z1] = f.box, dir = DIRS[f.up], half = (dir[0] ? x1 - x0 : z1 - z0) / 2 - 0.2; return [(x0 + x1) / 2 + sign * dir[0] * half, (z0 + z1) / 2 + sign * dir[1] * half]; };
    const path = specFlights.flatMap((f, i) => [inner(f, -1), inner(f, 1), ...(landings[i] ? [[(landings[i][0] + landings[i][2]) / 2, (landings[i][1] + landings[i][3]) / 2]] : [])]).concat([top]);
    // a straight flight keeps the shape it always had (it is part of the light bake's key: a new
    // shape would make every house with stairs bake its light again)
    const entry = { from, box: well, up: flights[0].up, risers, bottom, top, ...(sp.material ? { material: sp.material } : {}) };
    stairs.push(sp.flights ? { ...entry, flights, landings, path } : entry);
  }

  // one open space (zone / open) is one room for walking and for daylight
  const touches = (r, q) => r.storey === q.storey && xs.some((x) => zs.some((z) => {
    const set = [roomAt(x - 0.01, z - 0.01, r.storey), roomAt(x + 0.01, z + 0.01, r.storey), roomAt(x - 0.01, z + 0.01, r.storey), roomAt(x + 0.01, z - 0.01, r.storey)];
    return set.includes(r) && set.includes(q);
  }));
  for (const r of rooms) for (const q of rooms) if (r !== q && !separated(r, q) && touches(r, q)) link(r, q);
  for (let pass = 0; pass < 3; pass++) {
    for (const r of rooms) if (!lit.has(r) && rooms.some((q) => lit.has(q) && q !== r && !separated(r, q) && touches(r, q))) lit.add(r);
  }
  const dark = rooms.filter((r) => NEEDS_LIGHT.has(r.use) && !lit.has(r));
  if (dark.length) problem(`no daylight (a window or glazed door in an outside wall${party ? ' other than the party wall' : ''}) in ${dark.map(label).join(', ')}`);
  // every room reachable from outside through doors, gaps, sliders, open spaces and stairs
  const reached = new Set([OUT]);
  const queue = [OUT];
  while (queue.length) for (const n of links.get(queue.shift())) if (!reached.has(n)) { reached.add(n); queue.push(n); }
  const shut = rooms.filter((r) => !reached.has(r));
  if (shut.length) problem(`cannot be reached from outside (no door or stairs lead there): ${shut.map(label).join(', ')}`);
  for (const w of walls) delete w.seg;

  // ---- the house's finished rooms, and the site around it
  const house = {
    id: spec.id,
    name: spec.name,
    level,
    finishes: { ...FINISHES, ...spec.finishes },
    walls,
    rooms: rooms.map((r) => {
      const wet = r.wet ?? WET.has(r.use);
      return {
        id: r.id, name: r.name ?? r.id, use: r.use ?? 'room', poly: r.poly, ...(r.storey ? { storey: r.storey } : {}), ...(r.facade ? { facade: r.facade } : {}),
        floor: r.floor ?? (wet ? 'tiles_floor_dark' : 'floor_porcelain_light'),
        ...(r.walls ? { walls: r.walls } : wet ? { walls: 'tiles_wall_white' } : {}),
        ...((r.hall ?? HALL.has(r.use)) ? { hall: true } : {}), ...(r.safe ? { safe: true } : {}),
        // void: the upper part of a double-height room below (no floor of its own)
        ...(r.void ? { void: true } : {}),
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
    ...(stairs.length ? { stairs } : {}),
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
