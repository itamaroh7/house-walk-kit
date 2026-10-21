// Development check of the loaded plan, run from the browser console (or by a skill) with
//   await import('/src/dev/fulltest.js'); await __fullTest()
// (the dev server serves it; nothing imports it, so it stays out of the build):
//   - every room reachable on a 10 cm grid from the street gate, doors open, furniture in the way,
//     with the walker's own collision (radius 0.25, steps up to 0.36, 1.75 tall: main.js)
//   - rooms one can hardly move in (under 12% of the floor reachable; wet rooms and stores excepted)
//   - the walk from the gate in through the front door along that grid path
//   - furniture standing in other furniture or in an open door leaf's way
//   - the images on the GPU and what is still held in memory
// Returns { ok, unreachable, tight, overlaps, walk, rooms, ... }; ok is false if any check fails.
window.__fullTest = async () => {
  const H = window.__house, h = H.house, p = H.player.position, plan = H.plan;
  for (const d of h.doors) d.target = 1;
  for (let i = 0; i < 90; i++) H.tick(1 / 30);
  const R = 0.25, CELL = 0.1;
  const blocks = h.obstacles.filter((b) => b.bottom < 1.75 && b.top > 0.36);
  // the plot and a strip of street in front of it
  const [px0, pz0, px1, pz1] = plan.site.plot;
  const [x0, z0, x1, z1] = [px0 - 1, pz0 - 1, px1 + 1, pz1 + 3];
  const W = Math.round((x1 - x0) / CELL), Hh = Math.round((z1 - z0) / CELL);
  const free = (x, z) => !blocks.some((b) => {
    const dx = x - Math.min(Math.max(x, b.minX), b.maxX), dz = z - Math.min(Math.max(z, b.minZ), b.maxZ);
    return dx * dx + dz * dz < R * R;
  });
  // start on the sidewalk in front of the pedestrian gate
  const gate = plan.site.gate;
  const start = [(gate[0] + gate[1]) / 2, pz1 + 1.5];
  const seen = new Uint8Array(W * Hh), from = new Int32Array(W * Hh).fill(-1), q = [];
  const idx = (x, z) => Math.round((z - z0) / CELL) * W + Math.round((x - x0) / CELL);
  seen[idx(...start)] = 1;
  q.push(idx(...start));
  const reached = new Map();
  for (let head = 0; head < q.length; head++) {
    const c = q[head], cx = x0 + (c % W) * CELL, cz = z0 + Math.floor(c / W) * CELL;
    const room = h.roomAt(cx, cz);
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
  // every room of the plan, and the share of its floor one can stand on
  const cells = new Map();
  for (let z = z0; z < z1; z += CELL) for (let x = x0; x < x1; x += CELL) {
    const r = h.roomAt(x, z);
    if (r) cells.set(r, (cells.get(r) ?? 0) + 1);
  }
  const share = (r) => Math.round((100 * (reached.get(r) ?? 0)) / cells.get(r));
  const rooms = [...cells.keys()].map((r) => `${r.name}: ${share(r)}%`);
  const unreachable = [...cells.keys()].filter((r) => !reached.has(r)).map((r) => r.name);
  const SMALL_OK = new Set(['bath', 'shower', 'wc', 'store', 'laundry']);
  const tight = [...cells.keys()].filter((r) => reached.has(r) && share(r) < 12 && !SMALL_OK.has(r.use)).map((r) => `${r.name}: ${share(r)}%`);

  // walk in from the gate to the front door nearest the street, along the grid path
  const front = h.doors.filter((d) => d.kind === 'front').sort((a, b) => Math.hypot(a.x - start[0], a.z - start[1]) - Math.hypot(b.x - start[0], b.z - start[1]))[0];
  const walk = [];
  if (front) {
    // a metre inside the door, across the wall it is in (its collider is long along the wall)
    const c = front.collider, alongX = c.maxX - c.minX > c.maxZ - c.minZ;
    const inward = alongX ? (h.roomAt(front.x, front.z - 0.6) ? [0, -1] : [0, 1]) : (h.roomAt(front.x - 0.6, front.z) ? [-1, 0] : [1, 0]);
    const [gx, gz] = [front.x + inward[0], front.z + inward[1]];
    let goal = -1, gd = 1e9;
    for (let n = 0; n < from.length; n++) {
      if (from[n] < 0) continue;
      const cx = x0 + (n % W) * CELL, cz = z0 + Math.floor(n / W) * CELL, dd = Math.hypot(cx - gx, cz - gz);
      if (dd < gd) { gd = dd; goal = n; }
    }
    const path = [];
    for (let n = goal; n >= 0; n = from[n]) path.unshift([x0 + (n % W) * CELL, z0 + Math.floor(n / W) * CELL]);
    H.freeCam = false;
    H.cam.first = true;
    p.set(start[0], 0.15, start[1]);
    H.player.velocity.set(0, 0, 0);
    for (const [tx, tz] of path.filter((_, i) => i % 5 === 4 || i === path.length - 1)) {
      let best = 1e9, stall = 0, ok = false;
      for (let i = 0; i < 900; i++) {
        const dx = tx - p.x, dz = tz - p.z, dist = Math.hypot(dx, dz);
        if (dist < 0.3) { ok = true; break; }
        H.cam.yaw = Math.atan2(-dx, -dz);
        H.keys.add('KeyW');
        H.tick(1 / 30);
        if (dist < best - 0.01) { best = dist; stall = 0; } else if (++stall > 90) break;
      }
      H.keys.delete('KeyW');
      if (!ok) { walk.push(`STUCK at (${p.x.toFixed(2)}, ${p.z.toFixed(2)}) heading for (${tx.toFixed(1)}, ${tz.toFixed(1)})`); break; }
    }
    if (!walk.length) walk.push(`OK ${(path.length / 10).toFixed(1)} m from the gate to (${p.x.toFixed(1)}, ${p.z.toFixed(1)}) ${h.roomAt(p.x, p.z)?.name ?? 'outside'}`);
  } else walk.push('no front door in the plan');

  // furniture in furniture or in an open door's way (floor plan boxes overlapping by more than
  // 5 cm); curtains hang behind things, rugs lie under them, and doors count by their leaves
  const items = [];
  H.scene.traverse((o) => {
    if (!o.isLOD || /^door|curtain|rug/.test(o.name)) return;
    const bx = new H.THREE.Box3().setFromObject(o.levels[0].object);
    if (bx.min.y < 0.9) items.push({ n: o.name, b: bx });
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
    ok: !unreachable.length && !tight.length && !overlaps.length && walk[0].startsWith('OK') && !plan.problems?.length,
    plan: plan.id, problems: plan.problems ?? [], unreachable, tight, overlaps, walk, rooms,
    images: srcs.size, glTextures: H.renderer.info.memory.textures, imageMB: Math.round(gpu / 1e6), ramImagesMB: Math.round(ram / 1e6),
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
  };
};
