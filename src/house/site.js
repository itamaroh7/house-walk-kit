// The plot and the neighbourhood around a house: the plot's boundary wall with its gates and
// mailbox, an optional parking pad, the street in front (sidewalks, kerbs, asphalt, a dashed
// centre line, lamps, trees in pits, bins, repairs, parked cars), and made-up neighbour houses on
// both sides, across the street and on the streets behind, all generated from the plot rectangle
// with a fixed seed, so the same plan always gets the same neighbourhood. For a semi-detached
// house (site.party) the other half of the pair stands against the party wall as plain volumes,
// the house's rooms mirrored.
//
// site: {
//   plot: [x0, z0, x1, z1]   the plot wall's centre lines; the street runs along z1 (south)
//   gate: [x0, x1]           the pedestrian gate in the front wall (drawn open)
//   carGate: [x0, x1]        optional sliding car gate (closed) with a paved parking pad inside
//   party: 'east' | 'west'   optional: the house is half of a semi-detached pair
//   north: degrees           where true north is, clockwise from the plan's up (-z); 0 = up
//   neighbours: false        leave out the made-up neighbourhood (an empty field around the plot)
//   wall: { h, material, cap }   the boundary wall (1.5 m plaster with a stone cap)
// }
const EXT = 0.25;

export function makeSite(house, site = {}, { problem = () => {} } = {}) {
  const level = house.level;
  const TOP = level.floor + level.ceiling + level.slab + level.parapet;
  const xs = house.rooms.flatMap((r) => r.poly.map((p) => p[0])), zs = house.rooms.flatMap((r) => r.poly.map((p) => p[1]));
  const [hx0, hx1, hz0, hz1] = [Math.min(...xs) - EXT / 2, Math.max(...xs) + EXT / 2, Math.min(...zs) - EXT / 2, Math.max(...zs) + EXT / 2];
  let [x0, z0, x1, z1] = site.plot ?? [hx0 - 4, hz0 - 4, hx1 + 4, hz1 + 6];
  // the party wall's outer face is the boundary with the other half
  const B = site.partyLine == null ? null : site.party === 'east' ? site.partyLine + EXT / 2 : site.partyLine - EXT / 2;
  if (B != null) { if (site.party === 'east') x1 = B; else x0 = B; }
  if (hx0 < x0 - 0.01 && site.party !== 'west' || hx1 > x1 + 0.01 && site.party !== 'east' || hz0 < z0 || hz1 > z1) problem(`the house (${hx0.toFixed(2)}..${hx1.toFixed(2)} x ${hz0.toFixed(2)}..${hz1.toFixed(2)}) does not fit inside the plot [${[x0, z0, x1, z1].join(', ')}]`);
  const F = z1, cx = (x0 + x1) / 2;
  const gate = site.gate ?? [cx - 0.8, cx + 0.8];
  const car = site.carGate;
  const wall = { h: 1.5, t: 0.25, material: 'plaster_exterior', cap: 'stone_travertine', ...site.wall };

  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const surfaces = [], panels = [], neighbours = [], gates = [], trees = [], furniture = [];
  const details = { streetLights: [], bins: [], patches: [], mailboxes: [], streetZ: F + 5.8 };

  // ---- our plot: gates, mailbox, parking
  gates.push([gate[0], gate[1], F, 1.45, 85]);
  details.mailboxes.push([gate[0] - 0.6, F + 0.125]);
  if (car) {
    gates.push([car[0], car[1], F, 1.45, 0]);
    surfaces.push({ box: [car[0], F - 4.8, car[1], F + 0.13], top: 0.06, material: 'paving_stone' });
    furniture.push(['street/car_suv', (car[0] + car[1]) / 2, F - 2.5, 180]);
  }

  // ---- the other half of a semi-detached pair: our rooms mirrored about the boundary, and its
  // own front wall along the street
  const otherPlot = B == null ? null : site.party === 'east' ? [B, B + (B - x0)] : [B - (x1 - B), B];
  if (B != null) {
    for (const r of house.rooms) {
      const px = r.poly.map((p) => p[0]), pz = r.poly.map((p) => p[1]);
      const [rx0, rx1] = [Math.min(...px) - EXT / 2, Math.max(...px) + EXT / 2];
      panels.push([r.facade ?? house.finishes.exterior, 2 * B - rx1, 2 * B - rx0, Math.min(...pz) - EXT / 2, Math.max(...pz) + EXT / 2, 0, TOP]);
    }
    const [o0, o1] = otherPlot, g = 2 * B - (gate[0] + gate[1]) / 2;
    panels.push([wall.material, o0, Math.min(g - 0.8, o1), F - 0.125, F + 0.125, 0, wall.h]);
    if (g + 0.8 < o1) panels.push([wall.material, g + 0.8, o1, F - 0.125, F + 0.125, 0, wall.h]);
    gates.push([g - 0.8, g + 0.8, F, 1.45, 0]);
  }

  // ---- the street
  const S0 = cx - 260, S1 = cx + 260;
  surfaces.push(
    { box: [S0, F + 0.13, S1, F + 2.13], top: 0.14, material: 'paving_stone' },
    { box: [S0, F + 2.13, S1, F + 2.3], top: 0.15, material: 'lacquer_grey' },
    { box: [S0, F + 2.3, S1, F + 9.3], top: 0.01, material: 'asphalt' },
    { box: [S0, F + 9.3, S1, F + 9.47], top: 0.15, material: 'lacquer_grey' },
    { box: [S0, F + 9.47, S1, F + 11.47], top: 0.14, material: 'paving_stone' },
  );
  // a dashed centre line: 3 m dashes every 6 m
  for (let x = S0; x < S1 - 3; x += 6) panels.push(['paint_matte_white', x, x + 3, F + 5.74, F + 5.86, 0.01, 0.016]);
  // lamps every 14.5 m on alternating sides, a tree in a pit between each pair (none in front of a gate)
  const clear = (x) => ![gate, car].some((g) => g && x > g[0] - 2.5 && x < g[1] + 2.5);
  for (let i = 0; i < 34; i++) {
    const x = cx - 240 + i * 14.5;
    details.streetLights.push(i % 2 ? [x, F + 9.7, -1] : [x, F + 1.9, 1]);
    const tz = i % 2 ? F + 1.1 : F + 10.5, tx = x + 7.25;
    if (Math.abs(tx - cx) < 120 && (tz > F + 5 || clear(tx))) {
      trees.push([i % 3 ? 'Ash Small' : 'Oak Small', tx, tz, 31 + i * 2, 5 + (i % 2) * 0.6]);
      panels.push(['gravel', tx - 0.6, tx + 0.6, tz - 0.6, tz + 0.6, 0.14, 0.146]);
    }
  }
  details.patches.push([cx - 60, cx + 70, F + 4.0, F + 4.45], [cx - 13, cx - 10.6, F + 6.3, F + 7.8], [cx + 30, cx + 32.6, F + 6.3, F + 8.5]);
  details.bins.push([x0 + 1.2, F + 0.55, 0], [x0 + 1.95, F + 0.55, 0], [cx - 25, F + 10.9, 180], [cx + 18, F + 10.9, 180]);
  // parked cars along both kerbs, facing the way their lane runs
  const parked = [['street/car_hatchback', -14, 3.25, -90], ['street/car_sedan', 26, 3.25, -90], ['street/car_suv_blue', -6, 8.15, 90],
    ['street/car_hatchback_red', 21, 8.15, 90], ['street/car_sedan_black', -34, 8.15, 90]];
  for (const [m, dx, dz, yaw] of parked) if (dz > 5 || clear(cx + dx)) furniture.push([m, cx + dx, F + dz, yaw]);

  // ---- the neighbourhood: rows of lots about 16 m wide, house sizes, storeys and finishes varied
  if (site.neighbours !== false) {
    const lot = (lx, lz0, depth, front) => {
      const w = 10 + rnd() * 3, d = depth + rnd() * 2.5, z = lz0 + rnd() * 1.5;
      neighbours.push([lx + 1.5, z, lx + 1.5 + w, z + d, rnd() > 0.45 ? 6.8 : 3.9, rnd() > 0.7 ? 'cladding_anthracite' : 'plaster_exterior']);
      // its wall along our street, with a gate 3 m in
      if (front != null) {
        panels.push([wall.material, lx, lx + 3, front - 0.125, front + 0.125, 0, wall.h], [wall.material, lx + 4.5, lx + 16, front - 0.125, front + 0.125, 0, wall.h]);
        gates.push([lx + 3, lx + 4.5, front, 1.45, 0]);
      }
    };
    // lots from `west` and `east` outward, 16 m each, out to `reach` from the middle
    const row = (west, east, reach, lz0, front) => {
      for (let lx = east; lx < cx + reach; lx += 16) lot(lx, lz0, 9, front);
      for (let lx = west - 16; lx > cx - reach; lx -= 16) lot(lx, lz0, 9, front);
    };
    // this side of the street, beside our plot (and the other half of a pair)
    row(Math.min(x0, otherPlot?.[0] ?? x0), Math.max(x1, otherPlot?.[1] ?? x1), 210, F - 19.5, F);
    // across the street, the street behind and the one beyond
    row(cx - 8, cx - 8, 210, F + 14.5, F + 11.6);
    row(cx - 8, cx - 8, 110, Math.min(z0, hz0) - 30, null);
    row(cx - 8, cx - 8, 110, F + 32, null);
  }

  return {
    ...house,
    site: { plot: [x0, z0, x1, z1], gate, carGate: car ?? null, party: site.party ?? null, north: site.north ?? 0 },
    lawn: [cx - 215, Math.min(z0, hz0) - 40, cx + 225, F + 52],
    outdoor: { ...house.outdoor, surfaces: [...house.outdoor.surfaces, ...surfaces] },
    details: {
      ...house.details, ...details,
      gates: [...(house.details.gates ?? []), ...gates],
      panels: [...house.details.panels, ...panels],
      neighbours,
    },
    garden: {
      ...house.garden,
      wall: { ...wall, rect: [x0, z0, x1, z1], gates: [gate, ...(car ? [car] : [])] },
      trees: [...house.garden.trees, ...trees],
    },
    furniture: [...house.furniture, ...furniture],
  };
}
