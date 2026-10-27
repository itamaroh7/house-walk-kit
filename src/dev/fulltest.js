// Development check of the loaded plan, run from the browser console (or by a skill) with
//   await import('/src/dev/fulltest.js'); await __fullTest()
// (the dev server serves it; nothing imports it, so it stays out of the build):
//   - every room reachable on a 10 cm grid from the street gate, doors open, furniture in the way,
//     with the walker's own collision (radius 0.25, steps up to 0.36, 1.75 tall: main.js), and
//     up the stairs to every storey
//   - rooms one can hardly move in (under 12% of the floor reachable; wet rooms and stores excepted)
//   - the walk from the gate in through the front door along that grid path, and a climb up every
//     flight of stairs
//   - furniture standing in other furniture or in an open door leaf's way
//   - the images on the GPU and what is still held in memory
// Returns { ok, unreachable, tight, overlaps, walk, climbs, rooms, ... }; ok is false if any check fails.
window.__fullTest = async () => {
  const H = window.__house, h = H.house, p = H.player.position, plan = H.plan;
  for (const d of h.doors) d.target = 1;
  for (let i = 0; i < 90; i++) H.tick(1 / 30);
  const R = 0.25, CELL = 0.1;
  // the plot and a strip of street in front of it
  const [px0, pz0, px1, pz1] = plan.site.plot;
  const [x0, z0, x1, z1] = [px0 - 1, pz0 - 1, px1 + 1, pz1 + 3];
  const W = Math.round((x1 - x0) / CELL), Hh = Math.round((z1 - z0) / CELL);
  const idx = (x, z) => Math.round((z - z0) / CELL) * W + Math.round((x - x0) / CELL);
  const gate = plan.site.gate;
  const start = [(gate[0] + gate[1]) / 2, pz1 + 1.5];
  const stairs = h.stairs ?? [];
  const reached = new Map();
  const seeds = Array.from({ length: h.storeys }, () => []);
  seeds[0].push(start);
  let from0 = null, seen0 = null;
  const climbsMissing = [];
  for (let st = 0; st < h.storeys; st++) {
    const base = h.floorOf(st);
    // what the walker bumps into on this storey, and (above the ground) where there is floor
    const blocks = h.obstacles.filter((b) => b.bottom < base + 1.75 && b.top > base + 0.36);
    const floors = h.walkable.filter((s) => !s.ramp && Math.abs(s.top - base) < 0.05);
    const free = (x, z) => (st === 0 || floors.some((s) => x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ)) && !blocks.some((b) => {
      const dx = x - Math.min(Math.max(x, b.minX), b.maxX), dz = z - Math.min(Math.max(z, b.minZ), b.maxZ);
      return dx * dx + dz * dz < R * R;
    });
    const seen = new Uint8Array(W * Hh), from = new Int32Array(W * Hh).fill(-1), q = [];
    for (const [x, z] of seeds[st]) { const i = idx(x, z); if (!seen[i]) { seen[i] = 1; q.push(i); } }
    for (let head = 0; head < q.length; head++) {
      const c = q[head], cx = x0 + (c % W) * CELL, cz = z0 + Math.floor(c / W) * CELL;
      const room = h.roomAt(cx, cz, base);
      if (room) reached.set(room, (reached.get(room) ?? 0) + 1);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx * CELL, nz = cz + dz * CELL;
        if (nx < x0 || nx >= x1 || nz < z0 || nz >= z1) continue;
        const n = idx(nx, nz);
        if (seen[n]) continue;
        seen[n] = 1;
        if (free(nx, nz)) { from[n] = c; q.push(n); }
      }
    }
    if (st === 0) { from0 = from; seen0 = seen; }
    for (const sp of stairs.filter((s) => s.from === st)) {
      if (seen[idx(...sp.bottom)]) seeds[st + 1].push(sp.top);
      else climbsMissing.push(`the foot of the stairs at [${sp.box}] cannot be reached`);
    }
  }
  // every room of the plan, and the share of its floor one can stand on
  // the floor of each room, less what its stairs (flights, landings, the well above) take up
  const onStairs = (x, z, st) => stairs.some((sp) => (st === sp.from ? [sp.box, ...(sp.flights ?? []).map((f) => f.box), ...(sp.landings ?? [])] : st === sp.from + 1 ? [sp.box] : [])
    .some(([a, b, c, d]) => x > a && x < c && z > b && z < d));
  const cells = new Map();
  for (let z = z0; z < z1; z += CELL) for (let x = x0; x < x1; x += CELL) {
    for (let st = 0; st < h.storeys; st++) {
      const r = h.roomAt(x, z, h.floorOf(st));
      // void rooms (the upper part of a double-height room) have no floor to stand on
      if (r && !r.void && !onStairs(x, z, st)) cells.set(r, (cells.get(r) ?? 0) + 1);
    }
  }
  const share = (r) => Math.round((100 * (reached.get(r) ?? 0)) / cells.get(r));
  const rooms = [...cells.keys()].map((r) => `${r.name}: ${share(r)}%`);
  const unreachable = [...cells.keys()].filter((r) => !reached.has(r)).map((r) => r.name);
  const SMALL_OK = new Set(['bath', 'shower', 'wc', 'store', 'laundry']);
  // a stair hall is mostly stairs: one only has to reach it
  const stairRoom = (r) => stairs.some((sp) => [sp.from, sp.from + 1].some((st) => h.roomAt((sp.box[0] + sp.box[2]) / 2, (sp.box[1] + sp.box[3]) / 2, h.floorOf(st)) === r));
  const tight = [...cells.keys()].filter((r) => reached.has(r) && share(r) < 12 && !SMALL_OK.has(r.use) && !stairRoom(r)).map((r) => `${r.name}: ${share(r)}%`);

  // walk the walker by hand toward (tx, tz); false if it gets stuck
  const walkTo = (tx, tz) => {
    let best = 1e9, stall = 0;
    for (let i = 0; i < 900; i++) {
      const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
      if (dist < 0.3) { H.keys.delete('KeyW'); return true; }
      H.cam.yaw = Math.atan2(-dx, -dz);
      H.keys.add('KeyW');
      H.tick(1 / 30);
      if (dist < best - 0.01) { best = dist; stall = 0; } else if (++stall > 90) break;
    }
    H.keys.delete('KeyW');
    return false;
  };
  // walk in from the gate to the front door nearest the street, along the grid path
  const front = h.doors.filter((d) => d.kind === 'front' && !d.storey).sort((a, b) => Math.hypot(a.x - start[0], a.z - start[1]) - Math.hypot(b.x - start[0], b.z - start[1]))[0];
  const walk = [];
  H.freeCam = false;
  H.cam.first = true;
  if (front) {
    // a metre inside the door, across the wall it is in (its collider is long along the wall)
    const c = front.collider, alongX = c.maxX - c.minX > c.maxZ - c.minZ;
    const inward = alongX ? (h.roomAt(front.x, front.z - 0.6) ? [0, -1] : [0, 1]) : (h.roomAt(front.x - 0.6, front.z) ? [-1, 0] : [1, 0]);
    const [gx, gz] = [front.x + inward[0], front.z + inward[1]];
    let goal = -1, gd = 1e9;
    for (let n = 0; n < from0.length; n++) {
      if (from0[n] < 0 || !seen0[n]) continue;
      const cx = x0 + (n % W) * CELL, cz = z0 + Math.floor(n / W) * CELL, dd = Math.hypot(cx - gx, cz - gz);
      if (dd < gd) { gd = dd; goal = n; }
    }
    const path = [];
    for (let n = goal; n >= 0; n = from0[n]) path.unshift([x0 + (n % W) * CELL, z0 + Math.floor(n / W) * CELL]);
    p.set(start[0], 0.15, start[1]);
    H.player.velocity.set(0, 0, 0);
    for (const [tx, tz] of path.filter((_, i) => i % 5 === 4 || i === path.length - 1)) {
      if (!walkTo(tx, tz)) { walk.push(`STUCK at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) heading for (${tx.toFixed(1)}, ${tz.toFixed(1)})`); break; }
    }
    if (!walk.length) walk.push(`OK ${(path.length / 10).toFixed(1)} m from the gate to (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ${h.roomAt(p.x, p.z)?.name ?? 'outside'}`);
  } else walk.push('no front door in the plan');

  // climb every flight: from its foot to where one steps off, and arrive on the floor above
  const climbs = [...climbsMissing];
  for (const sp of stairs) {
    p.set(sp.bottom[0], h.floorOf(sp.from) + 0.01, sp.bottom[1]);
    H.player.velocity.set(0, 0, 0);
    for (let i = 0; i < 10; i++) H.tick(1 / 30);
    const ok = (sp.path ?? [sp.top]).every((q) => walkTo(...q));
    for (let i = 0; i < 30; i++) H.tick(1 / 30);
    const arrived = Math.abs(p.y - h.floorOf(sp.from + 1)) < 0.05;
    climbs.push(ok && arrived ? `OK up the stairs [${sp.box}] to ${h.roomAt(p.x, p.z, p.y)?.name ?? '?'}` : `STUCK on the stairs [${sp.box}] at (${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`);
  }

  // furniture in furniture or in an open door's way (floor plan boxes overlapping by more than
  // 5 cm); curtains hang behind things, rugs lie under them, and doors count by their leaves
  const items = [];
  H.scene.traverse((o) => {
    if (!o.isLOD || /^door|curtain|rug/.test(o.name)) return;
    const bx = new H.THREE.Box3().setFromObject(o.levels[0].object);
    if (bx.min.y < h.floorOf(h.storeyAt(bx.min.y)) + 0.9) items.push({ n: o.name, b: bx });
  });
  for (const d of h.doors) {
    const bx = new H.THREE.Box3();
    d.leaves.forEach((l) => bx.expandByObject(l));
    if (!bx.isEmpty()) items.push({ n: `open ${d.kind} (${d.x.toFixed(1)}, ${d.z.toFixed(1)})`, b: bx });
  }
  const overlaps = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].b, c = items[j].b;
    const ox = Math.min(a.max.x, c.max.x) - Math.max(a.min.x, c.min.x), oz = Math.min(a.max.z, c.max.z) - Math.max(a.min.z, c.min.z);
    const oy = Math.min(a.max.y, c.max.y) - Math.max(a.min.y, c.min.y);
    if (ox > 0.05 && oz > 0.05 && oy > 0.05) overlaps.push(`${items[i].n} / ${items[j].n} at (${((a.min.x + a.max.x) / 2).toFixed(1)}, ${((a.min.z + a.max.z) / 2).toFixed(1)}) ${ox.toFixed(2)}x${oz.toFixed(2)}`);
  }

  const texs = new Set();
  H.scene.traverse((o) => { for (const m of o.material ? [].concat(o.material) : []) for (const v of Object.values(m)) if (v?.isTexture) texs.add(v); });
  let gpu = 0, ram = 0;
  const srcs = new Set([...texs].map((t) => t.source));
  for (const s of srcs) {
    const d = s.data;
    if (!d?.width) continue;
    gpu += d.width * d.height * 4 * 1.33;
    if (d instanceof ImageBitmap || d instanceof HTMLImageElement) ram += d.width * d.height * 4;
  }
  return {
    ok: !unreachable.length && !tight.length && !overlaps.length && walk[0].startsWith('OK') && climbs.every((c) => c.startsWith('OK')) && !plan.problems?.length,
    plan: plan.id, problems: plan.problems ?? [], unreachable, tight, overlaps, walk, climbs, rooms,
    images: srcs.size, glTextures: H.renderer.info.memory.textures, imageMB: Math.round(gpu / 1e6), ramImagesMB: Math.round(ram / 1e6),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
};
