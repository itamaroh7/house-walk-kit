// The layout check, without a browser: works out from the plan and the library's model sizes
// (public/library/catalog.json) what the browser's full test (src/dev/fulltest.js) finds in the
// built scene, so an agent with no browser can still verify a design:
//   - furniture standing in a wall, in other furniture, or in front of a door, slider or gap
//   - every room reachable on foot from the street gate (a 10 cm grid, the walker's 0.25 m
//     radius, doors open, up the stairs to the storeys above), and rooms where almost nothing of
//     the floor can be reached
// Approximate (boxes from catalog sizes, no door leaves): the browser test stays the final word.
//   const { problems, rooms } = checkLayout(plan, catalog);
const R = 0.25, CELL = 0.1;
// pieces the walker passes through or over, and things that hang high
const SOFT = /rug|curtain|pendant|ceiling|pillow|picture|vase|clock|lamp|plant|shrub|flower|bush|wall_art|towel/;
const HIGH = /wall_units|wall_art|towel_rail|picture|mirror|clock|ceiling_light/;
const SMALL_OK = new Set(['bath', 'shower', 'wc', 'store', 'laundry']);
const PASSAGE = new Set(['door', 'front', 'slider', 'gap']);

export function checkLayout(plan, catalog) {
  const problems = [];
  const sizes = new Map(catalog.models.map((m) => [m.path, m.size]));
  const inside = (poly, x, z) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const storeyOf = (r) => r.storey ?? 0;
  const storeys = Math.max(...plan.rooms.map(storeyOf)) + 1;
  const { floor: FL, ceiling: CH, slab: SLAB } = plan.level;
  const floorOf = (st) => FL + st * (CH + SLAB);
  const roomAt = (x, z, st = 0) => plan.rooms.find((r) => storeyOf(r) === st && inside(r.poly, x, z));
  // the floors one can stand on: void rooms (the upper part of a double-height room) have none
  const floorAt = (x, z, st) => { const r = roomAt(x, z, st); return r && !r.void ? r : null; };
  const nameOf = (r) => (typeof r.name === 'string' ? r.name : r.name?.en ?? Object.values(r.name ?? {})[0]);
  const on = (st) => (st ? `, storey ${st}` : '');
  const at = (x, z, st = 0) => `(${x.toFixed(2)}, ${z.toFixed(2)}${on(st)})`;
  const overlap = (a, b) => [Math.min(a[1], b[1]) - Math.max(a[0], b[0]), Math.min(a[3], b[3]) - Math.max(a[2], b[2])];
  const stairs = plan.stairs ?? [];

  // ---- furniture footprints [x0, x1, z0, z1], turned by their yaw, on their storey
  const pieces = [];
  for (const [path, x, z, yaw = 0, opts = {}] of plan.furniture) {
    const size = sizes.get(path);
    if (!size) { problems.push(`${path} at ${at(x, z)} is not in the library (public/library/catalog.json)`); continue; }
    const s = opts.scale ?? 1, a = (yaw * Math.PI) / 180, c = Math.abs(Math.cos(a)), n = Math.abs(Math.sin(a));
    const ex = ((c * size[0] + n * size[2]) * s) / 2, ez = ((n * size[0] + c * size[2]) * s) / 2;
    pieces.push({
      path, name: path.split('/').pop(), x, z, st: opts.storey ?? 0, box: [x - ex, x + ex, z - ez, z + ez], height: size[1] * s,
      floor: !opts.ceiling && !(opts.y > 0.2) && !(opts.mount && HIGH.test(path)),
      blocks: !opts.ceiling && !(opts.y > 0.2) && !SOFT.test(path) && !(opts.mount && HIGH.test(path)) && size[1] * s > 0.3 && 4 * ex * ez > 0.12,
    });
  }

  // ---- walls as boxes, cut at their openings; the passable openings remembered
  const walls = [], passages = [];
  for (const w of plan.walls) {
    const st = w.storey ?? 0, alongX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    const u0 = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), u1 = alongX ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
    const v = alongX ? w.a[1] : w.a[0], h = w.t / 2;
    const cuts = (w.openings ?? []).filter((o) => PASSAGE.has(o.kind)).map((o) => [u0 + o.at - o.w / 2, u0 + o.at + o.w / 2, o.kind]).sort((p, q) => p[0] - q[0]);
    let s = u0;
    const put = (a, b) => { if (b - a > 1e-3) walls.push({ st, box: alongX ? [a, b, v - h, v + h] : [v - h, v + h, a, b] }); };
    for (const [a, b, kind] of cuts) {
      put(s, a);
      s = b;
      passages.push({ st, kind, alongX, a, b, x: alongX ? (a + b) / 2 : v, z: alongX ? v : (a + b) / 2, box: alongX ? [a, b, v - h - 0.5, v + h + 0.5] : [v - h - 0.5, v + h + 0.5, a, b] });
    }
    put(s, u1);
  }

  // ---- furniture in walls, in each other, in front of doors (on the same storey)
  for (const p of pieces) {
    if (/curtain|rug/.test(p.path)) continue;
    for (const wb of walls) {
      if (wb.st !== p.st) continue;
      const [ox, oz] = overlap(p.box, wb.box);
      if (ox > 0.03 && oz > 0.03) { problems.push(`${p.name} at ${at(p.x, p.z, p.st)} stands ${(Math.min(ox, oz) * 100).toFixed(0)} cm into a wall`); break; }
    }
  }
  // a doorway (and 0.5 m in front of it on both sides) must keep 0.6 m clear for walking through
  for (const d of passages) {
    const taken = pieces.filter((p) => p.st === d.st && p.floor && !/curtain|rug/.test(p.path)).filter((p) => { const [ox, oz] = overlap(p.box, d.box); return ox > 0.01 && oz > 0.01; });
    if (!taken.length) continue;
    const spans = taken.map((p) => (d.alongX ? [p.box[0], p.box[1]] : [p.box[2], p.box[3]])).sort((s, t) => s[0] - t[0]);
    let clear = 0, from = d.a;
    for (const [s, e] of spans) { clear = Math.max(clear, s - from); from = Math.max(from, e); }
    clear = Math.max(clear, d.b - from);
    if (clear < Math.min(0.6, d.b - d.a - 0.05)) problems.push(`the ${d.kind} at ${at(d.x, d.z, d.st)} is blocked by ${taken.map((p) => `${p.name} at ${at(p.x, p.z)}`).join(', ')} (${Math.max(0, clear * 100).toFixed(0)} cm left clear)`);
  }
  const floorItems = pieces.filter((p) => p.floor && !/curtain|rug/.test(p.path));
  for (let i = 0; i < floorItems.length; i++) for (let j = i + 1; j < floorItems.length; j++) {
    if (floorItems[i].st !== floorItems[j].st) continue;
    const [ox, oz] = overlap(floorItems[i].box, floorItems[j].box);
    if (ox > 0.05 && oz > 0.05) problems.push(`${floorItems[i].name} at ${at(floorItems[i].x, floorItems[i].z, floorItems[i].st)} and ${floorItems[j].name} at ${at(floorItems[j].x, floorItems[j].z)} overlap by ${ox.toFixed(2)} x ${oz.toFixed(2)} m`);
  }
  // nothing may stand on the stairs (their flights and landings) or in the stairwell
  const stairBoxes = (sp) => [...(sp.flights ?? []).map((f) => f.box), ...(sp.landings ?? [])];
  for (const sp of stairs) {
    for (const p of floorItems) {
      if (p.st !== sp.from && p.st !== sp.from + 1) continue;
      for (const b of p.st === sp.from ? [sp.box, ...stairBoxes(sp)] : [sp.box]) {
        const [ox, oz] = overlap(p.box, [b[0], b[2], b[1], b[3]]);
        if (ox > 0.03 && oz > 0.03) { problems.push(`${p.name} at ${at(p.x, p.z, p.st)} stands on the stairs or over the stairwell [${b}]`); break; }
      }
    }
  }

  // ---- everything the walker bumps into, storey by storey
  const blocks = Array.from({ length: storeys }, () => []);
  for (const wb of walls) blocks[wb.st].push(wb.box);
  for (const p of pieces) if (p.blocks) blocks[p.st].push(p.box);
  const storeyOfY = (y) => Math.max(0, Math.min(storeys - 1, Math.floor((y - FL + 0.5) / (CH + SLAB))));
  for (const [, x0, x1, z0, z1, y0, y1] of plan.details?.panels ?? []) {
    const st = storeyOfY(y0), base = floorOf(st);
    if (y0 < base + 0.6 && y1 > base + 0.3 && (x1 - x0) * (z1 - z0) > 0.1) blocks[st].push([x0, x1, z0, z1]);
  }
  for (const pg of [...(plan.outdoor?.pergolas ?? []), ...(plan.outdoor?.canopies ?? [])]) {
    const [x0, z0, x1, z1] = pg.box, acrossX = pg.side === 'east' || pg.side === 'west';
    const [v0, v1] = acrossX ? [z0, z1] : [x0, x1], u = { east: x1 - 0.1, west: x0 + 0.1, south: z1 - 0.1, north: z0 + 0.1 }[pg.side];
    const n = Math.max(2, Math.round((v1 - v0) / 3) + 1);
    for (let i = 0; i < n; i++) {
      const v = v0 + 0.25 + ((v1 - v0 - 0.5) * i) / (n - 1), [x, z] = acrossX ? [u, v] : [v, u];
      blocks[0].push([x - 0.07, x + 0.07, z - 0.07, z + 0.07]);
    }
  }
  for (const [preset, x, z] of plan.garden?.trees ?? []) if (!preset.startsWith('Bush')) blocks[0].push([x - 0.2, x + 0.2, z - 0.2, z + 0.2]);
  for (const [x0, x1, z, , open = 0] of plan.details?.gates ?? []) if (!open) blocks[0].push([x0, x1, z - 0.05, z + 0.05]);
  const gw = plan.garden?.wall;
  if (gw) {
    const [x0, z0, x1, z1] = gw.rect, t = gw.t / 2;
    const run = (ax, az, bx, bz, gates = []) => {
      const alongX = az === bz, cuts = [alongX ? ax : az, ...gates.flat(), alongX ? bx : bz].sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i += 2) blocks[0].push(alongX ? [cuts[i], cuts[i + 1], az - t, az + t] : [ax - t, ax + t, cuts[i], cuts[i + 1]]);
    };
    run(x0, z0, x1, z0);
    run(x0, z1, x1, z1, gw.gates);
    run(x0, z0, x0, z1);
    run(x1, z0, x1, z1);
  }
  // the flight is in the way on its own storey (one climbs it from its foot), its well on the
  // storey above (one steps off it at the top)
  for (const sp of stairs) {
    const [x0, z0, x1, z1] = sp.box;
    for (const [a, b, c, d] of [sp.box, ...stairBoxes(sp)]) blocks[sp.from].push([a, c, b, d]);
    if (blocks[sp.from + 1]) blocks[sp.from + 1].push([x0, x1, z0, z1]);
  }

  // ---- walk from the street gate on a 10 cm grid, then up every flight one reaches
  const [px0, pz0, px1, pz1] = plan.site.plot;
  const [gx0, gz0, gx1, gz1] = [px0 - 1, pz0 - 1, px1 + 1, pz1 + 3];
  const W = Math.round((gx1 - gx0) / CELL), Hh = Math.round((gz1 - gz0) / CELL);
  const idx = (x, z) => Math.round((z - gz0) / CELL) * W + Math.round((x - gx0) / CELL);
  const reached = new Map();
  const seeds = Array.from({ length: storeys }, () => []);
  seeds[0].push([(plan.site.gate[0] + plan.site.gate[1]) / 2, pz1 + 1.5]);
  for (let st = 0; st < storeys; st++) {
    const near = blocks[st].map((b) => [b[0] - R, b[1] + R, b[2] - R, b[3] + R, b]);
    // above the ground there is only floor where there are rooms
    const free = (x, z) => (st === 0 || floorAt(x, z, st)) && !near.some(([a, b, c, d, bx]) => {
      if (x < a || x > b || z < c || z > d) return false;
      const dx = x - Math.min(Math.max(x, bx[0]), bx[1]), dz = z - Math.min(Math.max(z, bx[2]), bx[3]);
      return dx * dx + dz * dz < R * R;
    });
    const seen = new Uint8Array(W * Hh), q = [];
    for (const [x, z] of seeds[st]) { const i = idx(x, z); if (!seen[i]) { seen[i] = 1; q.push(i); } }
    for (let head = 0; head < q.length; head++) {
      const c = q[head], cx = gx0 + (c % W) * CELL, cz = gz0 + Math.floor(c / W) * CELL;
      const r = roomAt(cx, cz, st);
      if (r) reached.set(r, (reached.get(r) ?? 0) + 1);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx * CELL, nz = cz + dz * CELL;
        if (nx < gx0 || nx >= gx1 || nz < gz0 || nz >= gz1) continue;
        const n = idx(nx, nz);
        if (seen[n]) continue;
        seen[n] = 1;
        if (free(nx, nz)) q.push(n);
      }
    }
    // a flight whose foot one reaches leads to the storey above
    for (const sp of stairs.filter((s) => s.from === st)) {
      if (seen[idx(...sp.bottom)] && free(...sp.bottom)) seeds[st + 1].push(sp.top);
      else problems.push(`the foot of the stairs at [${sp.box}] (${sp.bottom.map((v) => v.toFixed(2))}${on(st)}) cannot be reached on foot`);
    }
  }
  // the floor of each room, less what its stairs (flights, landings, the well above) take up
  const onStairs = (x, z, st) => stairs.some((sp) => (st === sp.from ? [sp.box, ...stairBoxes(sp)] : st === sp.from + 1 ? [sp.box] : [])
    .some(([a, b, c, d]) => x > a && x < c && z > b && z < d));
  const cells = new Map();
  for (let z = gz0; z < gz1; z += CELL) for (let x = gx0; x < gx1; x += CELL) {
    for (let st = 0; st < storeys; st++) {
      const r = roomAt(x, z, st);
      if (r && !onStairs(x, z, st)) cells.set(r, (cells.get(r) ?? 0) + 1);
    }
  }
  const rooms = [];
  for (const [r, total] of cells) {
    if (r.void) continue;
    // a stair hall is mostly stairs: one only has to reach it
    const stairRoom = stairs.some((sp) => [sp.from, sp.from + 1].some((st) => roomAt((sp.box[0] + sp.box[2]) / 2, (sp.box[1] + sp.box[3]) / 2, st) === r));
    const share = Math.round((100 * (reached.get(r) ?? 0)) / total);
    rooms.push(`${nameOf(r)}: ${share}%`);
    if (!reached.has(r)) problems.push(`${nameOf(r)}${on(storeyOf(r))} cannot be reached on foot from the street gate (a doorway blocked by furniture, too narrow, or no stairs)`);
    else if (share < 12 && !SMALL_OK.has(r.use) && !stairRoom) problems.push(`${nameOf(r)} is too full: only ${share}% of its floor can be reached`);
  }
  return { problems, rooms };
}
