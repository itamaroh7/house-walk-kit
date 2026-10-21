// Builds a house from a plan (src/house/plans/*.js) out of the model library's materials and
// models: walls with their door and window openings cut out, a finish chosen per wall face by
// the room it faces (tiles in bathrooms, paint elsewhere, plaster or cladding outside), floors,
// ceilings, roof slab with parapet, outdoor decks and paving, a pergola, doors, windows and
// furniture. Returns the scene group plus what a walker needs: obstacle boxes, walkable
// surfaces, doors that open and close, and room lookup.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadLibraryModel } from '../engine/lib/load-model.js';
import { loadLibraryMaterial, metreUVs } from '../engine/lib/load-material.js';
import { createTree } from '../engine/lib/trees.js';
import { createPlantBed } from '../engine/lib/plants.js';

const LIB = '/library';
const LOD_BIAS = 0.35;
const EPS = 0.002;
// which library model fills each kind of opening, and the opening size it was built for
const OPENING_MODELS = {
  door: { model: 'interior/door_interior', w: 0.9, h: 2.1 },
  front: { model: 'interior/door_front', w: 1.0, h: 2.2 },
  window: { model: 'interior/window_aluminium', w: 1.2, h: 1.2 },
  slider: { model: 'interior/sliding_door', w: 3.0, h: 2.4 },
};

// a soft rounded rectangle, opaque in the middle and fading to nothing at the edges (alpha)
function contactTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const dx = Math.max(0, Math.abs(x - 31.5) - 18) / 14, dy = Math.max(0, Math.abs(y - 31.5) - 18) / 14;
    const a = Math.max(0, 1 - Math.hypot(dx, dy));
    img.data[(y * 64 + x) * 4 + 3] = Math.round(255 * Math.pow(a, 1.4));
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// faint rain streaks: soft vertical runs fading downward, a little uneven across (alpha)
function streakTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  let seed = 5;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cols = Array.from({ length: 128 }, () => 0.35 + rnd() * 0.65);
  for (let i = 0; i < 3; i++) for (let x = 1; x < 127; x++) cols[x] = (cols[x - 1] + cols[x] * 2 + cols[x + 1]) / 4;
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const edge = Math.min(x, 127 - x) / 18, fall = Math.pow(1 - y / 127, 1.6) * Math.min(1, y / 4 + 0.3);
    img.data[(y * 128 + x) * 4 + 3] = Math.round(255 * Math.min(1, edge) * fall * cols[x]);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

// a room outline made of axis-aligned edges as rectangles [x0, x1, z0, z1] that cover it
function rectsOf(poly) {
  const xs = [...new Set(poly.map((q) => q[0]))].sort((a, b) => a - b);
  const zs = [...new Set(poly.map((q) => q[1]))].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
    if (inPoly(poly, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2)) out.push([xs[i], xs[i + 1], zs[j], zs[j + 1]]);
  }
  return out;
}

const inPoly = (poly, x, z) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};

// ceiling lights: a grid about LIGHT_SPACING apart in every room, kept away from the walls
const LIGHT_SPACING = 2.4;
function roomLights(room, y) {
  const xs = room.poly.map((q) => q[0]), zs = room.poly.map((q) => q[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const nx = Math.max(1, Math.round((x1 - x0) / LIGHT_SPACING)), nz = Math.max(1, Math.round((z1 - z0) / LIGHT_SPACING));
  const out = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / nx, z = z0 + ((j + 0.5) * (z1 - z0)) / nz;
    if (inPoly(room.poly, x, z)) out.push(new THREE.Vector3(x, y, z));
  }
  return out;
}

export async function buildHouse(plan) {
  const group = new THREE.Group();
  group.name = plan.id;
  const { floor: FL, ceiling: CH, slab: SLAB, parapet: PARAPET } = plan.level;
  const TOP = FL + CH;
  const roomAt = (x, z) => plan.rooms.find((r) => inPoly(r.poly, x, z)) ?? null;

  // geometry is collected per material and merged: one draw call per material
  const parts = new Map();
  const addGeo = (matId, geo) => {
    if (!parts.has(matId)) parts.set(matId, []);
    parts.get(matId).push(metreUVs(geo));
  };
  const obstacles = [];   // { minX, maxX, minZ, maxZ, bottom, top }
  const walkable = [];    // { minX, maxX, minZ, maxZ, top }
  const box = (minX, maxX, minZ, maxZ, bottom, top) => ({ minX, maxX, minZ, maxZ, bottom, top });

  // ---------- walls ----------
  // A box split into its six faces, each face with its own material:
  // order of BoxGeometry groups: +x, -x, +y, -y, +z, -z
  const addBox = (cx, cy, cz, sx, sy, sz, faceMat) => {
    const g = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    g.translate(cx, cy, cz);
    for (let f = 0; f < 6; f++) {
      const { start, count } = g.groups[f];
      const sub = new THREE.BufferGeometry();
      for (const name of ['position', 'normal']) {
        const a = g.attributes[name];
        sub.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * 3, (start + count) * 3), 3));
      }
      addGeo(faceMat(f), sub);
    }
  };
  const cladAt = (wi, u) => plan.cladding?.find((c) => c.wall === wi && u >= c.from && u <= c.to)?.material;

  plan.walls.forEach((w, wi) => {
    const alongX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    const u0 = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
    const u1 = alongX ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
    const v = alongX ? w.a[1] : w.a[0];
    const t = w.t;
    // h: a half-height inside wall (a fraction of the room height below 1), open above
    const yTop = w.exterior ? TOP + SLAB + PARAPET : w.h ? FL + (w.h <= 1 ? w.h * (TOP - FL) : w.h) : TOP;
    const yBottom = w.exterior ? 0 : FL;
    // cut along the wall at openings and wherever a room corner touches it, so each piece
    // faces a single room on each side
    // exterior walls run on half their thickness past their ends, so two meeting at a corner
    // overlap instead of leaving the corner notched (their end faces showed as white strips)
    // (not where the wall carries straight on as another exterior wall: that would overlap
    // two facades in one plane)
    const continues = (u) => plan.walls.some((o) => o !== w && o.exterior && (Math.abs(o.a[1] - o.b[1]) < 1e-6) === alongX
      && Math.abs((alongX ? o.a[1] : o.a[0]) - v) < 1e-6 && [o.a, o.b].some((q) => Math.abs((alongX ? q[0] : q[1]) - u) < 1e-6));
    // only walls along x reach over: if both walls of a corner did, their faces would overlap
    // in the same plane and flicker
    const reach = w.exterior && alongX;
    const ext0 = reach && !continues(u0) ? u0 - t / 2 : u0, ext1 = reach && !continues(u1) ? u1 + t / 2 : u1;
    const cuts = new Set([ext0, ext1]);
    const openings = (w.openings ?? []).map((o) => ({ ...o, s: u0 + o.at - o.w / 2, e: u0 + o.at + o.w / 2 }));
    for (const o of openings) { cuts.add(o.s); cuts.add(o.e); }
    for (const r of plan.rooms) {
      for (const [x, z] of r.poly) {
        const pu = alongX ? x : z, pv = alongX ? z : x;
        if (Math.abs(pv - v) < t / 2 + 0.01 && pu > ext0 && pu < ext1) cuts.add(pu);
      }
    }
    if (w.exterior) for (const c of plan.cladding ?? []) if (c.wall === wi) { cuts.add(u0 + c.from); cuts.add(u0 + c.to); }
    const us = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i < us.length - 1; i++) {
      const s = us[i], e = us[i + 1];
      if (e - s < 1e-4) continue;
      const mid = (s + e) / 2;
      const o = openings.find((op) => mid > op.s && mid < op.e);
      // vertical spans of solid wall in this stretch
      const spans = [];
      if (!o) spans.push([yBottom, yTop]);
      else {
        const sill = FL + (o.sill ?? 0), head = sill + o.h;
        if (sill - yBottom > 0.01) spans.push([yBottom, sill]);
        if (yTop - head > 0.01) spans.push([head, yTop]);
      }
      // exterior walls: a stone plinth up to the floor level, then the facade
      const split = [];
      // and at the ceiling, so the room side below it takes the room's finish and the parapet
      // above takes the facade's
      for (const [a, b] of spans) {
        const cuts = [a, ...(w.exterior ? [FL, TOP] : []).filter((y) => y > a + 0.01 && y < b - 0.01), b];
        for (let k = 0; k < cuts.length - 1; k++) split.push([cuts[k], cuts[k + 1], cuts[k] < FL - 0.01]);
      }
      for (const [a, b, plinth] of split) {
        const cy = (a + b) / 2, sy = b - a;
        const cx = alongX ? mid : v, cz = alongX ? v : mid;
        const sx = alongX ? e - s : t, sz = alongX ? t : e - s;
        // the finish of each face from the room it looks into (or the outside)
        const clad = w.exterior && (cladAt(wi, mid - u0) ?? w.finish) === 'cladding_anthracite';
        const side = (nx, nz, isEnd) => {
          const px = cx + nx * (sx / 2 + 0.05), pz = cz + nz * (sz / 2 + 0.05);
          if (isEnd) {
            // an exterior wall's end that is not a reveal is its corner overhang, seen from
            // outside: the facade's finish (it took the room's white paint, a white strip down
            // the corner of the anthracite volume)
            if (w.exterior && !o) return plinth ? plan.finishes.plinth : cladAt(wi, mid - u0) ?? w.finish ?? plan.finishes.exterior;
            // opening reveals and wall ends: the finish of the room on the inner side
            const r = roomAt(cx + (alongX ? 0 : 0.2), cz + (alongX ? 0.2 : 0)) ?? roomAt(cx - (alongX ? 0 : 0.2), cz - (alongX ? 0.2 : 0));
            return r ? (r.walls ?? plan.finishes.interior) : plan.finishes.exterior;
          }
          const r = roomAt(px, pz);
          if (r && cy < TOP + 0.01) return r.walls ?? plan.finishes.interior;
          if (plinth) return plan.finishes.plinth;
          return cladAt(wi, mid - u0) ?? w.finish ?? plan.finishes.exterior;
        };
        // the top of an inside wall is painted like the rooms (a half wall shows it)
        const cap = clad ? 'aluminium_black' : w.exterior ? plan.finishes.exterior : plan.finishes.interior;
        // in an opening, the sill's top and the head's soffit are reveals too
        const top = o && b < yTop - 0.01 ? side(0, 0, true) : cap, bottom = o && a > yBottom + 0.01 ? side(0, 0, true) : cap;
        const faces = [side(1, 0, alongX), side(-1, 0, alongX), top, bottom, side(0, 1, !alongX), side(0, -1, !alongX)];
        addBox(cx, cy, cz, sx, sy, sz, (f) => faces[f]);
        // skirting along the foot of each room-side face: porcelain rooms in the floor's own tile;
        // tiled walls go down to the floor without one
        if (a <= FL + 0.01 && b > FL + 0.1) {
          for (const sgn of [1, -1]) {
            const px = cx + (alongX ? 0 : sgn * (sx / 2 + 0.05)), pz = cz + (alongX ? sgn * (sz / 2 + 0.05) : 0);
            const r = roomAt(px, pz);
            if (!r || r.walls) continue;
            const len = alongX ? sx : sz;
            const g = new THREE.BoxGeometry(alongX ? len : 0.015, 0.08, alongX ? 0.015 : len);
            g.translate(alongX ? cx : cx + sgn * (sx / 2 + 0.0075), FL + 0.04, alongX ? cz + sgn * (sz / 2 + 0.0075) : cz);
            // wood floors get a white painted skirting (in the floor's own oak it vanished)
            addGeo(/oak/.test(r.floor) ? 'lacquer_white' : r.floor, g);
          }
        }
        obstacles.push(box(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2, a, b));
      }
    }
  });

  // ---------- floors, ceilings, the slab under the house and the roof ----------
  const xs = plan.walls.filter((w) => w.exterior).flatMap((w) => [w.a[0], w.b[0]]);
  const zs = plan.walls.filter((w) => w.exterior).flatMap((w) => [w.a[1], w.b[1]]);
  const ext = plan.walls.find((w) => w.exterior).t / 2;
  const [X0, X1, Z0, Z1] = [Math.min(...xs) - ext, Math.max(...xs) + ext, Math.min(...zs) - ext, Math.max(...zs) + ext];
  // the floor level inside: each room, reaching under its walls and door thresholds
  for (const r of plan.rooms) {
    for (const [a, b2, c2, d] of rectsOf(r.poly)) walkable.push({ minX: a - 0.14, maxX: b2 + 0.14, minZ: c2 - 0.14, maxZ: d + 0.14, top: FL });
  }
  const shapeOf = (poly, flip) => new THREE.Shape(poly.map(([x, z]) => new THREE.Vector2(x, flip ? -z : z)));
  for (const r of plan.rooms) {
    const f = new THREE.ShapeGeometry(shapeOf(r.poly, true));
    f.rotateX(-Math.PI / 2);
    f.translate(0, FL + EPS, 0);
    addGeo(r.floor, f);
    const c = new THREE.ShapeGeometry(shapeOf(r.poly, false));
    c.rotateX(Math.PI / 2);
    c.translate(0, TOP, 0);
    addGeo(plan.finishes.ceiling, c);
  }
  // roof slab over every room (the parapet is the top of the exterior walls); room outlines
  // run along wall centre lines, so the slab reaches into the walls and no light leaks along
  // their tops
  const roofParts = [];
  for (const r of plan.rooms) {
    const g = new THREE.ExtrudeGeometry(shapeOf(r.poly, true), { depth: SLAB, bevelEnabled: false });
    g.rotateX(-Math.PI / 2);
    g.translate(0, TOP, 0);
    roofParts.push(g);
    // lifted 1 cm: its underside lay exactly on the ceiling and showed through it (z-fighting).
    // Its top is the roof: a grey concrete screed by default (in facade plaster it read as a
    // clipped white plastic sheet from above)
    addGeo(plan.finishes.roof ?? 'concrete_precast', g.clone().translate(0, 0.01, 0));
  }

  // ---------- outdoor surfaces and pergola ----------
  for (const s of plan.outdoor?.surfaces ?? []) {
    const [x0, z0, x1, z1] = s.box;
    const g = new THREE.BoxGeometry(x1 - x0, s.top, z1 - z0);
    g.translate((x0 + x1) / 2, s.top / 2, (z0 + z1) / 2);
    addGeo(s.material, g);
    walkable.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, top: s.top });
  }
  // pergolas and canopies: posts and a beam along the open side `side`, a ledger on the house
  // side; pergolas get slats across, canopies a solid roof. Built in a frame where the open side
  // is +u (u across, v along the open side), then placed.
  const frame = (bx, side) => {
    const [x0, z0, x1, z1] = bx;
    const acrossX = side === 'east' || side === 'west';
    const flip = side === 'west' || side === 'north' ? -1 : 1;
    const [u0, u1] = acrossX ? [x0, x1] : [z0, z1], [v0, v1] = acrossX ? [z0, z1] : [x0, x1];
    const open = flip > 0 ? u1 : u0, wall = flip > 0 ? u0 : u1;
    // a box given in (u, v): centre, size; returns world geometry
    const part = (cu, cy, cv, su, sy, sv) => {
      const g = new THREE.BoxGeometry(acrossX ? su : sv, sy, acrossX ? sv : su);
      g.translate(acrossX ? cu : cv, cy, acrossX ? cv : cu);
      return g;
    };
    return { open, wall, v0, v1, u0, u1, flip, part, xz: (u, v) => (acrossX ? [u, v] : [v, u]) };
  };
  const postsAndBeam = (f, H, mat, post = 0.14) => {
    const n = Math.max(2, Math.round((f.v1 - f.v0) / 3) + 1);
    const pu = f.open - f.flip * 0.1;
    for (let i = 0; i < n; i++) {
      // inset from the ends, so the end posts and their footings stand on the paving, not its edge
      const v = f.v0 + 0.25 + ((f.v1 - f.v0 - 0.5) * i) / (n - 1);
      addGeo(mat, f.part(pu, H / 2, v, post, H, post));
      // a concrete footing pad under every post (hidden where it stands on paving)
      addGeo('stone_travertine', f.part(pu, 0.04, v, 0.34, 0.08, 0.34));
      const [x, z] = f.xz(pu, v);
      obstacles.push(box(x - 0.07, x + 0.07, z - 0.07, z + 0.07, 0, H));
    }
    addGeo(mat, f.part(pu, H + 0.13, (f.v0 + f.v1) / 2, 0.14, 0.26, f.v1 - f.v0));
    addGeo(mat, f.part(f.wall + f.flip * 0.05, H + 0.1, (f.v0 + f.v1) / 2, 0.1, 0.2, f.v1 - f.v0));
  };
  for (const pg of plan.outdoor?.pergolas ?? []) {
    const f = frame(pg.box, pg.side);
    postsAndBeam(f, pg.height, pg.material);
    for (let v = f.v0 + 0.05; v < f.v1; v += 0.32) addGeo(pg.material, f.part((f.u0 + f.u1) / 2 + f.flip * 0.15, pg.height + 0.34, v, f.u1 - f.u0 + 0.3, 0.16, 0.05));
  }
  for (const cn of plan.outdoor?.canopies ?? []) {
    const f = frame(cn.box, cn.side);
    postsAndBeam(f, cn.height, cn.material, 0.22);   // a solid roof wants stouter posts
    addGeo(cn.material, f.part((f.u0 + f.u1) / 2 + f.flip * 0.1, cn.height + 0.36, (f.v0 + f.v1) / 2, f.u1 - f.u0 + 0.2, 0.2, f.v1 - f.v0 + 0.2));
  }

  // coping along the top of the parapet (one continuous cap, finishes.coping)
  for (const w of plan.walls.filter((wl) => wl.exterior)) {
    const alongX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    // along x the coping covers the corners, along z it stops at them (no overlapping tops)
    const len = alongX ? Math.abs(w.b[0] - w.a[0]) + w.t + 0.05 : Math.abs(w.b[1] - w.a[1]) - w.t - 0.05;
    const g = new THREE.BoxGeometry(alongX ? len : w.t + 0.05, 0.05, alongX ? w.t + 0.05 : len);
    g.translate((w.a[0] + w.b[0]) / 2, TOP + SLAB + PARAPET + 0.025, (w.a[1] + w.b[1]) / 2);
    addGeo(plan.finishes.coping ?? plan.finishes.plinth, g);
  }

  // ---------- fittings outside: solar heaters, AC units, downpipes, lamps, the street ----------
  const det = plan.details ?? {};
  const ROOF = TOP + SLAB;
  // solar water heater: two collectors tilted toward the sun on a steel frame, the tank above
  const solarHeater = (x, y, z, yaw) => {
    const put = (mat, g) => { g.rotateY(THREE.MathUtils.degToRad(yaw)); g.translate(x, y, z); addGeo(mat, g); };
    for (const dx of [-0.55, 0.55]) {
      const panel = new THREE.BoxGeometry(1.0, 0.07, 2.0);
      panel.rotateX(-0.7); panel.translate(dx, 0.85, 0.1);
      put('black_matte', panel);
      const glass = new THREE.BoxGeometry(0.94, 0.01, 1.94);
      glass.rotateX(-0.7); glass.translate(dx, 0.885, 0.1 - 0.02);
      put('glass_clear', glass);
    }
    for (const [fx, fz, fh] of [[-1.05, -0.6, 1.55], [1.05, -0.6, 1.55], [-1.05, 0.8, 0.25], [1.05, 0.8, 0.25]]) {
      const leg = new THREE.BoxGeometry(0.04, fh, 0.04); leg.translate(fx, fh / 2, fz); put('metal_brushed', leg);
    }
    const tank = new THREE.CylinderGeometry(0.29, 0.29, 1.5, 20).rotateZ(Math.PI / 2);
    tank.translate(0, 1.72, -0.75);
    put('lacquer_white', tank);
  };
  for (const [x, z, yaw = 0] of det.solarHeaters ?? []) {
    solarHeater(x, ROOF, z, yaw);
    obstacles.push(box(x - 1.1, x + 1.1, z - 1.1, z + 1.1, ROOF, ROOF + 2.0));
  }
  // outdoor AC condensers: a white casing with a dark round fan grille
  for (const [x, y, z, yaw = 0] of det.acUnits ?? []) {
    const put = (mat, g) => { g.rotateY(THREE.MathUtils.degToRad(yaw)); g.translate(x, y, z); addGeo(mat, g); };
    put('lacquer_white', new THREE.BoxGeometry(0.85, 0.6, 0.32).translate(0, 0.3, 0));
    put('black_matte', new THREE.CylinderGeometry(0.22, 0.22, 0.01, 24).rotateX(Math.PI / 2).translate(-0.12, 0.3, 0.165));
    for (const fx of [-0.33, 0.33]) put('metal_brushed', new THREE.BoxGeometry(0.05, 0.06, 0.4).translate(fx, -0.03, 0));
  }
  // rainwater downpipes from the roof scuppers down to the ground
  for (const [x, z] of det.downpipes ?? []) {
    // painted grey (bare steel mirrored the sky and read blue against the facades)
    addGeo('lacquer_grey', new THREE.CylinderGeometry(0.045, 0.045, ROOF - 0.1, 10).translate(x, (ROOF - 0.1) / 2, z));
    // at the top a funnel-shaped rainwater hopper fed by a spout through the parapet (flat roofs
    // drain through scuppers: there is no gutter)
    addGeo('lacquer_grey', new THREE.CylinderGeometry(0.2, 0.07, 0.3, 4, 1).rotateY(Math.PI / 4).translate(x, ROOF - 0.05, z));
    addGeo('black_matte', new THREE.BoxGeometry(0.12, 0.08, 0.12).translate(x, ROOF + 0.16, z));
    // wall clips, and at the foot a concrete drain box with a dark grate the pipe runs into
    for (const y of [1.0, 2.4]) addGeo('lacquer_grey', new THREE.BoxGeometry(0.11, 0.03, 0.11).translate(x, y, z));
    addGeo('stone_travertine', new THREE.BoxGeometry(0.34, 0.06, 0.34).translate(x, 0.03, z));
    addGeo('black_matte', new THREE.BoxGeometry(0.24, 0.005, 0.24).translate(x, 0.062, z));
  }
  // wall lights: a small black box with a frosted lens below
  for (const [x, y, z] of det.wallLights ?? []) {
    addGeo('black_matte', new THREE.BoxGeometry(0.12, 0.2, 0.12).translate(x, y, z));
    // its frosted lens, the opening the light shines down through
    addGeo('ceramic_white', new THREE.BoxGeometry(0.09, 0.012, 0.09).translate(x, y - 0.104, z));
  }
  // flat panels on a wall (kitchen backsplash and the like): material, x0, x1, z0, z1, y0, y1
  for (const [mat, x0, x1, z0, z1, y0, y1] of det.panels ?? []) {
    addGeo(mat, new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    // low, sizeable pieces (a table top) are in the way of the walker
    if (y0 < 0.6 && y1 > 0.3 && (x1 - x0) * (z1 - z0) > 0.1) obstacles.push(box(x0, x1, z0, z1, 0, y1));
  }
  // power sockets: a white plate with two dark pin holes, on the wall face at (x, y, z);
  // normal 'x+', 'x-', 'z+' or 'z-' is the way the plate faces
  for (const [x, y, z, normal] of det.sockets ?? []) {
    const alongX = normal[0] === 'z', s = normal[1] === '+' ? 1 : -1;
    const plate = alongX ? new THREE.BoxGeometry(0.085, 0.085, 0.012) : new THREE.BoxGeometry(0.012, 0.085, 0.085);
    addGeo('lacquer_white', plate.translate(x + (alongX ? 0 : s * 0.006), y, z + (alongX ? s * 0.006 : 0)));
    for (const k of [-1, 1]) {
      const pin = alongX ? new THREE.BoxGeometry(0.008, 0.008, 0.002) : new THREE.BoxGeometry(0.002, 0.008, 0.008);
      addGeo('black_matte', pin.translate(x + (alongX ? k * 0.019 : s * 0.0125), y, z + (alongX ? s * 0.0125 : k * 0.019)));
    }
  }
  // split AC indoor units high on a wall: a white casing with the dark air outlet along its
  // bottom front, at (x, y, z) on the wall face, facing 'x+', 'x-', 'z+' or 'z-'
  for (const [x, y, z, normal] of det.splitACs ?? []) {
    const alongX = normal[0] === 'z', s = normal[1] === '+' ? 1 : -1;
    const put = (mat, w, h, d, out, dy) => addGeo(mat, (alongX ? new THREE.BoxGeometry(w, h, d) : new THREE.BoxGeometry(d, h, w))
      .translate(x + (alongX ? 0 : s * out), y + dy, z + (alongX ? s * out : 0)));
    put('lacquer_white', 0.86, 0.29, 0.2, 0.1, 0);
    put('black_matte', 0.7, 0.035, 0.01, 0.2, -0.105);
    put('lacquer_grey', 0.12, 0.02, 0.004, 0.2, 0.06);
  }
  // neighbouring houses seen across the street and over the plot walls, in the same idiom as
  // this one: [x0, z0, x1, z1, height, facade material]. A main volume and, at one end, a
  // second one in the other finish standing a little proud; framed windows set into the walls
  // (two rows on two storeys), parapet caps, a solar water heater on the roof
  const block = (bx0, bz0, bx1, bz1, h, mat) => {
    addGeo(mat, new THREE.BoxGeometry(bx1 - bx0, h, bz1 - bz0).translate((bx0 + bx1) / 2, h / 2, (bz0 + bz1) / 2));
    addGeo('aluminium_black', new THREE.BoxGeometry(bx1 - bx0 + 0.05, 0.05, bz1 - bz0 + 0.05).translate((bx0 + bx1) / 2, h + 0.025, (bz0 + bz1) / 2));
    const rows = h > 5 ? [0.15, 3.25] : [0.15];
    for (const [ax, az, ex, ez, nx, nz] of [[bx0, bz0, bx1, bz0, 0, -1], [bx0, bz1, bx1, bz1, 0, 1], [bx0, bz0, bx0, bz1, -1, 0], [bx1, bz0, bx1, bz1, 1, 0]]) {
      const len = Math.hypot(ex - ax, ez - az), n = Math.floor(len / 3.0);
      rows.forEach((floor, r) => {
        for (let i = 0; i < n; i++) {
          if ((i + r) % 4 === 3) continue;   // blank stretches of wall between windows
          const t = (i + 0.5) / n, cx = ax + (ex - ax) * t, cz = az + (ez - az) * t;
          const big = r === 0 && i % 3 === 1, w = big ? 2.4 : 1.4, wh = big ? 2.3 : 1.25, y = floor + (big ? 0 : 1.0);
          const pane = (mat2, sw, sh, out) => addGeo(mat2, (nx ? new THREE.BoxGeometry(0.03, sh, sw) : new THREE.BoxGeometry(sw, sh, 0.03))
            .translate(cx + nx * out, y + wh / 2, cz + nz * out));
          pane('aluminium_black', w + 0.1, wh + 0.1, 0.005);
          // behind the glass: a dark room, or drawn curtains in some windows
          pane((i * 7 + r * 3 + Math.round(cx + cz)) % 3 === 0 ? 'fabric_linen' : 'black_matte', w - 0.02, wh - 0.02, 0.02);
          pane('glass_clear', w - 0.02, wh - 0.02, 0.035);
          // a mullion splitting the sash and a stone sill under it, so it reads as a window from
          // close by rather than a flat grey panel
          addGeo('aluminium_black', (nx ? new THREE.BoxGeometry(0.05, wh, 0.045) : new THREE.BoxGeometry(0.045, wh, 0.05)).translate(cx + nx * 0.045, y + wh / 2, cz + nz * 0.045));
          addGeo('stone_travertine', (nx ? new THREE.BoxGeometry(0.1, 0.04, w + 0.12) : new THREE.BoxGeometry(w + 0.12, 0.04, 0.1)).translate(cx + nx * 0.05, y - 0.07, cz + nz * 0.05));
        }
      });
    }
  };
  for (const [x0, z0, x1, z1, h, mat] of det.neighbours ?? []) {
    const other = mat === 'cladding_anthracite' ? 'plaster_exterior' : 'cladding_anthracite';
    const alongX = x1 - x0 >= z1 - z0, cut = alongX ? x0 + (x1 - x0) * 0.62 : z0 + (z1 - z0) * 0.62;
    const h2 = h > 5 ? 3.6 : h + 0.5;
    if (alongX) { block(x0, z0, cut, z1, h, mat); block(cut, z0 - 0.4, x1, z1 + 0.4, h2, other); }
    else { block(x0, z0, x1, cut, h, mat); block(x0 - 0.4, cut, x1 + 0.4, z1, h2, other); }
    solarHeater(x0 + (x1 - x0) * 0.3, h, z0 + (z1 - z0) * 0.4, 0);
    // a front door with a small canopy on the side facing the street (details.streetZ)
    const front = (z0 + z1) / 2 > (det.streetZ ?? 28) ? z0 : z1, out = front === z0 ? -1 : 1, dx = x0 + (alongX ? (cut - x0) * 0.35 : (x1 - x0) * 0.3);
    addGeo('black_matte', new THREE.BoxGeometry(1.1, 2.25, 0.04).translate(dx, 1.12, front + out * 0.02));
    addGeo('cladding_anthracite', new THREE.BoxGeometry(1.8, 0.15, 1.1).translate(dx, 2.6, front + out * 0.55));
    // variety: every third house a timber pergola on its street side, every two-storey one a
    // glass balcony rail on the upper floor
    const pick = Math.abs(Math.round(x0 * 7 + z0 * 3)) % 3;
    if (pick === 0) {
      const px0 = x0 + (x1 - x0) * 0.45, px1 = Math.min(x1 - 0.3, px0 + 4.0), depth = 3.0;
      for (const px of [px0, px1]) addGeo('wood_walnut', new THREE.BoxGeometry(0.14, 2.7, 0.14).translate(px, 1.35, front + out * depth));
      addGeo('wood_walnut', new THREE.BoxGeometry(px1 - px0 + 0.3, 0.2, 0.14).translate((px0 + px1) / 2, 2.75, front + out * depth));
      for (let sx = px0; sx <= px1 + 0.01; sx += 0.45) addGeo('wood_walnut', new THREE.BoxGeometry(0.06, 0.16, depth).translate(sx, 2.93, front + out * depth / 2));
    }
    if (h > 5 && pick !== 0) {
      const bx0 = x0 + (x1 - x0) * 0.15, bx1 = bx0 + Math.min(4.0, (x1 - x0) * 0.4);
      addGeo('lacquer_white', new THREE.BoxGeometry(bx1 - bx0, 0.15, 1.3).translate((bx0 + bx1) / 2, 3.25, front + out * 0.65));
      addGeo('glass_clear', new THREE.BoxGeometry(bx1 - bx0, 1.0, 0.02).translate((bx0 + bx1) / 2, 3.85, front + out * 1.29));
      addGeo('aluminium_black', new THREE.BoxGeometry(bx1 - bx0, 0.04, 0.05).translate((bx0 + bx1) / 2, 4.36, front + out * 1.29));
    }
  }
  // slatted aluminium gates in the plot walls: [x0, x1, z, height, open] across a gap along x;
  // open: 0 closed, else the leaf turned that many degrees about its x1 hinge (into the plot, -z)
  for (const [x0, x1, z, h, open = 0] of det.gates ?? []) {
    const w = x1 - x0, a = THREE.MathUtils.degToRad(open);
    const leaf = (mat, lx, y, sx, sy, sz) => {
      const g = new THREE.BoxGeometry(sx, sy, sz).translate(lx - w, y, 0);   // hinge at the origin
      g.rotateY(-a);
      addGeo(mat, g.translate(x1, 0, z));
    };
    for (const lx of [0.03, w - 0.03]) leaf('aluminium_black', lx, h / 2 + 0.05, 0.05, h, 0.05);
    for (let y = 0.12; y < h; y += 0.14) leaf('aluminium_black', w / 2, y, w - 0.06, 0.12, 0.025);
    if (!open) obstacles.push(box(x0, x1, z - 0.05, z + 0.05, 0, h));
  }
  // street lamps [x, z, side]: a grey pole with an arm reaching over the road (side +1 / -1 in z)
  for (const [x, z, side] of det.streetLights ?? []) {
    addGeo('lacquer_grey', new THREE.CylinderGeometry(0.06, 0.09, 6.0, 10).translate(x, 3.0, z));
    addGeo('lacquer_grey', new THREE.BoxGeometry(0.08, 0.08, 1.4).translate(x, 5.95, z + side * 0.7));
    addGeo('lacquer_grey', new THREE.BoxGeometry(0.28, 0.1, 0.55).translate(x, 5.9, z + side * 1.4));
    addGeo('glass_clear', new THREE.BoxGeometry(0.22, 0.02, 0.45).translate(x, 5.84, z + side * 1.4));
    obstacles.push(box(x - 0.1, x + 0.1, z - 0.1, z + 0.1, 0, 6));
  }
  // mailbox with the house number, set into the plot wall by the gate (street face at z)
  for (const [x, z] of det.mailboxes ?? []) {
    addGeo('black_matte', new THREE.BoxGeometry(0.42, 0.32, 0.06).translate(x, 1.05, z + 0.03));
    addGeo('lacquer_grey', new THREE.BoxGeometry(0.3, 0.02, 0.005).translate(x, 1.14, z + 0.062));
    addGeo('lacquer_white', new THREE.BoxGeometry(0.22, 0.08, 0.005).translate(x, 1.32, z + 0.005));
    // the intercom beside it: a steel panel with a camera lens and a call button
    addGeo('metal_brushed', new THREE.BoxGeometry(0.12, 0.22, 0.03).translate(x + 0.42, 1.35, z + 0.015));
    addGeo('black_matte', new THREE.BoxGeometry(0.05, 0.05, 0.005).translate(x + 0.42, 1.41, z + 0.032));
  }

  // outdoor AC condensers on the ground against the facade [x, z, facing out], each with its
  // pipe duct running up the wall to the indoor unit's height
  for (const [x, z, facing] of det.groundACs ?? []) {
    const alongX = facing[0] === 'z', s = facing[1] === '+' ? 1 : -1;
    const put = (id, w, h, d, out, y, along = 0) => addGeo(id, (alongX ? new THREE.BoxGeometry(w, h, d) : new THREE.BoxGeometry(d, h, w))
      .translate(x + (alongX ? along : s * out), y, z + (alongX ? s * out : along)));
    put('lacquer_white', 0.82, 0.56, 0.3, 0.17, 0.38);
    put('black_matte', 0.42, 0.42, 0.01, 0.325, 0.38, -0.12);
    put('lacquer_grey', 0.05, 0.1, 0.36, 0.17, 0.05, -0.3);
    put('lacquer_grey', 0.05, 0.1, 0.36, 0.17, 0.05, 0.3);
    put('lacquer_white', 0.09, 2.2, 0.07, 0.035, 0.66 + 1.1, 0.32);
    obstacles.push(box(Math.min(x, x + (alongX ? 0 : s * 0.34)) - (alongX ? 0.42 : 0), Math.max(x, x + (alongX ? 0 : s * 0.34)) + (alongX ? 0.42 : 0),
      Math.min(z, z + (alongX ? s * 0.34 : 0)) - (alongX ? 0 : 0.42), Math.max(z, z + (alongX ? s * 0.34 : 0)) + (alongX ? 0 : 0.42), 0, 0.7));
  }
  // precast concrete garden edging along paving that meets the lawn: [x0, z0, x1, z1, top] runs
  // (one axis constant), 8 cm wide, 3 cm proud of the paving
  for (const [x0, z0, x1, z1, top] of det.edging ?? []) {
    const alongX = Math.abs(z1 - z0) < 1e-6, len = alongX ? Math.abs(x1 - x0) : Math.abs(z1 - z0);
    const g = alongX ? new THREE.BoxGeometry(len + 0.08, top + 0.03, 0.08) : new THREE.BoxGeometry(0.08, top + 0.03, len + 0.08);
    addGeo('concrete_precast', g.translate((x0 + x1) / 2, (top + 0.03) / 2, (z0 + z1) / 2));
  }
  // darker, newer asphalt where the road was dug up and patched [x0, x1, z0, z1]
  for (const [x0, x1, z0, z1] of det.patches ?? []) {
    addGeo('asphalt_patch', new THREE.BoxGeometry(x1 - x0, 0.004, z1 - z0).translate((x0 + x1) / 2, 0.012, (z0 + z1) / 2));
  }
  // wheelie bins (240 l) on the sidewalk against the plot walls [x, z, yaw degrees]: a tapered
  // body, an overhanging lid with its hinge bar at the back, two wheels
  for (const [x, z, yaw] of det.bins ?? []) {
    const put = (id, g) => addGeo(id, g.rotateY((yaw * Math.PI) / 180).translate(x, 0, z));
    const body = new THREE.CylinderGeometry(Math.SQRT1_2, Math.SQRT1_2 * 0.88, 1, 4, 1).rotateY(Math.PI / 4);
    put('lacquer_grey', body.scale(0.58, 0.95, 0.72).translate(0, 0.475 + 0.05, 0));
    put('lacquer_grey', new THREE.BoxGeometry(0.62, 0.04, 0.78).translate(0, 1.02, 0.02));
    put('black_matte', new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6).rotateZ(Math.PI / 2).translate(0, 0.98, -0.4));
    for (const sx of [-0.25, 0.25]) put('black_matte', new THREE.CylinderGeometry(0.1, 0.1, 0.05, 12).rotateZ(Math.PI / 2).translate(sx, 0.1, -0.3));
    obstacles.push(box(x - 0.4, x + 0.4, z - 0.4, z + 0.4, 0, 1.05));
  }

  // ---------- the plot: boundary wall with coping and gates, trees and bushes ----------
  const gw = plan.garden?.wall;
  if (gw) {
    const [x0, z0, x1, z1] = gw.rect;
    const run = (ax, az, bx, bz, gates = []) => {
      const alongX = az === bz;
      const u0 = alongX ? ax : az, u1 = alongX ? bx : bz;
      const cuts = [u0, ...gates.flat(), u1].sort((a, b) => a - b);
      for (let i = 0; i < cuts.length - 1; i += 2) {
        const s0 = cuts[i], s1 = cuts[i + 1], mid = (s0 + s1) / 2, len = s1 - s0;
        const cx = alongX ? mid : ax, cz = alongX ? az : mid;
        const sx = alongX ? len : gw.t, sz = alongX ? gw.t : len;
        const body = new THREE.BoxGeometry(sx, gw.h, sz);
        body.translate(cx, gw.h / 2, cz);
        addGeo(gw.material, body);
        const cap = new THREE.BoxGeometry(sx + (alongX ? 0 : 0.06), 0.06, sz + (alongX ? 0.06 : 0));
        cap.translate(cx, gw.h + 0.03, cz);
        addGeo(gw.cap, cap);
        obstacles.push(box(cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2, 0, gw.h));
      }
    };
    run(x0, z0, x1, z0);
    run(x0, z1, x1, z1, gw.gates);
    run(x0, z0, x0, z1);
    run(x1, z0, x1, z1);
  }
  // every tree and bush is two meshes (bark, leaves); the garden's dozens of them are merged
  // into one mesh per look (bark, leaf kind and tint), a handful of draw calls in all
  const plants = new Map();
  for (const [preset, x, z, seed, height, tint] of [...(plan.garden?.trees ?? []), ...(plan.garden?.bushes ?? [])]) {
    // street trees, outside the plot wall, are seen from further off: fewer, larger leaf cards
    const [px0, pz0, px1, pz1] = plan.garden?.wall?.rect ?? [-1e9, -1e9, 1e9, 1e9];
    const street = x < px0 || x > px1 || z < pz0 || z > pz1;
    const t = createTree(preset, seed, preset.startsWith('Bush') ? { height, leaves: 0.95, detail: 0.3, tint, leafType: preset === 'Bush 2' ? 'ash' : undefined } : { height, leaves: street ? 0.45 : 0.65, detail: street ? 0.35 : 0.5, tint, leafType: preset.startsWith('Aspen') ? 'ash' : undefined });
    t.position.set(x, 0, z);
    t.updateMatrixWorld(true);
    t.traverse((n) => {
      if (!n.isMesh) return;
      const m = n.material;
      const key = `${m.type}|${m.map?.uuid}|${m.color.getHexString()}|${m.alphaTest}|${m.side}`;
      if (!plants.has(key)) plants.set(key, { material: m, geos: [] });
      plants.get(key).geos.push(n.geometry.clone().applyMatrix4(n.matrixWorld));
    });
    if (!preset.startsWith('Bush')) obstacles.push(box(x - 0.2, x + 0.2, z - 0.2, z + 0.2, 0, height));
  }
  for (const { material, geos } of plants.values()) {
    const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.name = 'house:plants';
    group.add(mesh);
  }
  // low flowering plants in the gravel beds (lavender drifts)
  for (const bed of plan.garden?.beds ?? []) group.add(createPlantBed(bed.kind, bed.clumps, { y: 0.03 }));

  // door casings: a 7 cm painted architrave round every door on each side that faces a room
  plan.walls.forEach((w) => {
    const alongX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    const u0 = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
    const v = alongX ? w.a[1] : w.a[0];
    for (const o of w.openings ?? []) {
      if (o.kind !== 'door' && o.kind !== 'front') continue;
      const u = u0 + o.at;
      for (const sgn of [1, -1]) {
        const probe = v + sgn * (w.t / 2 + 0.3);
        if (!(alongX ? roomAt(u, probe) : roomAt(probe, u))) continue;
        const f = v + sgn * (w.t / 2 + 0.008), cw = 0.07, d = 0.016, top = FL + o.h;
        const put = (along, len, y, h) => addGeo('lacquer_white', alongX
          ? new THREE.BoxGeometry(len, h, d).translate(along, y, f)
          : new THREE.BoxGeometry(d, h, len).translate(f, y, along));
        for (const e of [-1, 1]) put(u + e * (o.w / 2 + cw / 2), cw, FL + (o.h + cw) / 2, o.h + cw);
        put(u, o.w + 2 * cw, top + cw / 2, cw);
      }
    }
  });

  // openings in the anthracite cladding: the outer half of the reveal (jambs and head, from the
  // frame out to the facade) is lined with dark aluminium flashing; the inner half is plastered
  // like the room (a fully black reveal read as a screen from inside)
  plan.walls.forEach((w, wi) => {
    if (!w.exterior) return;
    const alongX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    const u0 = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
    const v = alongX ? w.a[1] : w.a[0];
    for (const o of w.openings ?? []) {
      if ((cladAt(wi, o.at) ?? w.finish) !== 'cladding_anthracite' || o.kind === 'gap') continue;
      const x = alongX ? u0 + o.at : v, z = alongX ? v : u0 + o.at;
      const n = alongX ? (roomAt(x, z + 0.3) ? -1 : 1) : (roomAt(x + 0.3, z) ? -1 : 1);
      const d = w.t / 2, c = v + n * d / 2, y0 = FL + (o.sill ?? 0), y1 = y0 + o.h;
      const put = (along, len, across, h, y) => addGeo('aluminium_black', alongX
        ? new THREE.BoxGeometry(len, h, d).translate(along, y, c)
        : new THREE.BoxGeometry(d, h, len).translate(c, y, along));
      for (const sgn of [-1, 1]) put(u0 + o.at + sgn * (o.w / 2 - 0.003), 0.006, d, o.h, (y0 + y1) / 2);
      put(u0 + o.at, o.w, d, 0.006, y1 - 0.003);
    }
  });

  // stone sills under the windows, sticking out of the facade, and the faint grey streak that
  // rain washes down from each end of a sill on plaster
  const streaks = [];
  plan.walls.forEach((w) => {
    if (!w.exterior) return;
    const alongX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    const u0 = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
    const v = alongX ? w.a[1] : w.a[0];
    for (const o of w.openings ?? []) {
      if (o.kind !== 'window' || !o.sill) continue;
      const x = alongX ? u0 + o.at : v, z = alongX ? v : u0 + o.at;
      // outward: the side with no room
      const nx = alongX ? 0 : (roomAt(x + 0.3, z) ? -1 : 1), nz = alongX ? (roomAt(x, z + 0.3) ? -1 : 1) : 0;
      const depth = w.t / 2 + 0.05;
      const g = new THREE.BoxGeometry(alongX ? o.w + 0.1 : depth, 0.04, alongX ? depth : o.w + 0.1);
      g.translate(x + nx * depth / 2, FL + o.sill - 0.02, z + nz * depth / 2);
      // stone under plastered walls, an anthracite aluminium flashing on the cladding
      addGeo(w.finish === 'cladding_anthracite' ? 'aluminium_black' : plan.finishes.plinth, g);
      if (w.finish !== 'cladding_anthracite') {
        const sh = Math.min(0.9, FL + o.sill - 0.1), out = w.t / 2 + 0.003;
        const q = new THREE.PlaneGeometry(o.w + 0.15, sh).translate(0, -sh / 2, 0);
        q.rotateY(alongX ? (nz > 0 ? 0 : Math.PI) : (nx > 0 ? Math.PI / 2 : -Math.PI / 2));
        streaks.push(q.translate(x + nx * out, FL + o.sill - 0.04, z + nz * out));
      }
      // roller shutter (trisol) in the outer reveal: guide rails at both sides and, lowered by
      // o.shutter (0..1), aluminium slats 5 cm apart; the box is hidden in the lintel
      if (o.shutter === undefined) continue;
      const out = w.t / 2 - 0.035, top = FL + o.sill + o.h;
      const at = (along, y, sAlong, sy, sDepth, mat) => {
        const b = alongX ? new THREE.BoxGeometry(sAlong, sy, sDepth) : new THREE.BoxGeometry(sDepth, sy, sAlong);
        addGeo(mat, b.translate(alongX ? x + along : x + nx * out, y, alongX ? z + nz * out : z + along));
      };
      for (const k of [-1, 1]) at(k * (o.w / 2 - 0.015), top - o.h / 2, 0.03, o.h, 0.05, 'aluminium_black');
      const n = Math.round((o.h * o.shutter) / 0.05);
      for (let i = 0; i < n; i++) at(0, top - 0.025 - i * 0.05, o.w - 0.03, 0.043, 0.012, 'lacquer_grey');
    }
  });

  // ---------- merge into one mesh per material ----------
  const ids = [...parts.keys()];
  const mats = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await loadLibraryMaterial(LIB, id)])));
  for (const id of ids) {
    const mesh = new THREE.Mesh(mergeGeometries(parts.get(id), false), mats[id]);
    // clear glass lets the sun through (balconies, lamp covers)
    mesh.castShadow = id !== 'glass_clear';
    mesh.receiveShadow = true;
    mesh.name = `house:${id}`;
    group.add(mesh);
  }

  // an invisible shadow caster reaching a little below the ceiling: the thin ceiling and the
  // slab's underside are nearly level with the tops of the walls, and a low sun's shadow leaked
  // through that seam as a bright line along every wall just under the ceiling
  const slabGeo = mergeGeometries(roofParts.map((g) => g.toNonIndexed()), false);
  slabGeo.scale(1, (SLAB + 0.06) / SLAB, 1);
  slabGeo.translate(0, -(TOP * (SLAB + 0.06) / SLAB - TOP) - 0.06, 0);
  const shadowSlab = new THREE.Mesh(
    slabGeo,
    new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: THREE.DoubleSide }),
  );
  shadowSlab.castShadow = true;
  shadowSlab.name = 'house:shadow-slab';
  group.add(shadowSlab);

  if (streaks.length) {
    const mesh = new THREE.Mesh(mergeGeometries(streaks, false), new THREE.MeshBasicMaterial({
      map: streakTexture(), transparent: true, depthWrite: false, opacity: 0.8,   // the map is black with alpha
      polygonOffset: true, polygonOffsetFactor: -2,
    }));
    mesh.name = 'house:streaks';
    group.add(mesh);
  }

  // ---------- doors and windows ----------
  const doors = [];
  const protos = new Map();
  const proto = (path) => {
    if (!protos.has(path)) protos.set(path, loadLibraryModel(`${LIB}/${path}`).catch(() => null));
    return protos.get(path);
  };
  const fallbackGlass = await loadLibraryMaterial(LIB, 'glass_clear');
  const fallbackFrame = await loadLibraryMaterial(LIB, 'aluminium_black');
  const switchMat = await loadLibraryMaterial(LIB, 'lacquer_white');
  await Promise.all(plan.walls.flatMap((w, wi) => (w.openings ?? []).map(async (o) => {
    const alongX = Math.abs(w.a[1] - w.b[1]) < 1e-6;
    const u0 = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
    const v = alongX ? w.a[1] : w.a[0];
    const u = u0 + o.at;
    const x = alongX ? u : v, z = alongX ? v : u;
    // +Z of the opening model faces out of the house (or into the hall for inside doors)
    let outward = alongX ? (roomAt(x, z + 0.3) ? Math.PI : 0) : (roomAt(x + 0.3, z) ? -Math.PI / 2 : Math.PI / 2);
    if (o.kind === 'door') {
      // an inside door opens into the room, away from the hall: its +Z faces the hall
      const plus = alongX ? roomAt(x, z + 0.3) : roomAt(x + 0.3, z), minus = alongX ? roomAt(x, z - 0.3) : roomAt(x - 0.3, z);
      const toPlus = plus?.hall && !minus?.hall;
      outward = alongX ? (toPlus ? 0 : Math.PI) : (toPlus ? Math.PI / 2 : -Math.PI / 2);
    }
    if (o.kind === 'gap') return;
    const spec = OPENING_MODELS[o.kind];
    const lod = spec && (await proto(spec.model));
    const y = FL + (o.sill ?? 0);
    let obj;
    if (lod) {
      obj = lod.clone();
      for (const level of obj.levels) level.distance *= LOD_BIAS;
      obj.scale.set(o.w / spec.w, o.h / spec.h, w.t / (o.kind === 'door' ? 0.12 : 0.25));
    } else {
      obj = new THREE.Group();
      const fw = 0.05;
      for (const [sx, sy, px, py] of [[o.w, fw, 0, fw / 2], [o.w, fw, 0, o.h - fw / 2], [fw, o.h, -o.w / 2 + fw / 2, o.h / 2], [fw, o.h, o.w / 2 - fw / 2, o.h / 2]]) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, 0.07), fallbackFrame);
        m.position.set(px, py, 0);
        m.castShadow = true;
        obj.add(m);
      }
      if (o.kind !== 'door') {
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(o.w - 2 * fw, o.h - 2 * fw), fallbackGlass);
        gl.position.y = o.h / 2;
        obj.add(gl);
      }
    }
    // bathroom windows get frosted glass (a wet room is the one whose walls are tiled)
    const wet = [roomAt(x + 0.3, z), roomAt(x - 0.3, z), roomAt(x, z + 0.3), roomAt(x, z - 0.3)].some((r) => r?.walls);
    // a safe room (room flag `safe`, a reinforced room as in Israeli homes): a grey steel door, and a steel blast shutter slid aside inside
    // each window
    const safe = [roomAt(x + 0.3, z), roomAt(x - 0.3, z), roomAt(x, z + 0.3), roomAt(x, z - 0.3)].find((r) => r?.safe);
    if (safe && o.kind === 'window') {
      const inX = alongX ? 0 : (roomAt(x + 0.3, z) === safe ? 1 : -1), inZ = alongX ? (roomAt(x, z + 0.3) === safe ? 1 : -1) : 0;
      // in the reveal between the window and the room, half slid into its pocket in the wall
      const off = w.t / 2 - 0.04, slide = o.w * 0.55;
      const plate = alongX ? new THREE.BoxGeometry(o.w + 0.1, o.h + 0.1, 0.03) : new THREE.BoxGeometry(0.03, o.h + 0.1, o.w + 0.1);
      // painted grey steel (bare brushed metal mirrored the sky as a flat blue sheet); built after
      // the per-material merge, so it is a mesh of its own
      const steel = new THREE.Mesh(metreUVs(plate.translate(x + inX * off + (alongX ? slide : 0), FL + o.sill + o.h / 2, z + inZ * off + (alongX ? 0 : slide))), await loadLibraryMaterial(LIB, 'lacquer_grey'));
      steel.receiveShadow = true;
      group.add(steel);
      // its guide rails across the top and bottom of the reveal (the shutter's whole travel) and
      // a pull handle on the leading edge, so it reads as a sliding blast shutter, not a board
      const rail = await loadLibraryMaterial(LIB, 'aluminium_black');
      const at = (along, y, depth, sa, sy, sd, mat) => {
        const g = alongX ? new THREE.BoxGeometry(sa, sy, sd) : new THREE.BoxGeometry(sd, sy, sa);
        const m = new THREE.Mesh(g.translate(x + inX * depth + (alongX ? along : 0), y, z + inZ * depth + (alongX ? 0 : along)), mat);
        m.receiveShadow = true;
        group.add(m);
      };
      const travel = o.w + 0.1 + slide, mid = (slide + (o.w + 0.1) / 2 - o.w / 2) / 2;
      for (const y of [FL + o.sill - 0.08, FL + o.sill + o.h + 0.08]) at(mid, y, off, travel, 0.06, 0.07, rail);
      at(slide - (o.w + 0.1) / 2 + 0.07, FL + o.sill + o.h / 2, off + 0.035, 0.03, 0.32, 0.04, rail);
    }
    obj.traverse((n) => {
      if (!n.isMesh) return;
      if (wet && o.kind === 'window') {
        n.material = [].concat(n.material).map((m) => {
          if (m.name !== 'glass_clear') return m;
          const f = m.clone();
          f.userData.frosted = true;
          f.userData.clear = false;
          f.premultipliedAlpha = false;
          f.color.setRGB(0.75, 0.78, 0.78);
          f.opacity = 0.88;
          f.roughness = 0.45;
          return f;
        });
        if (n.material.length === 1) n.material = n.material[0];
      }
      if (safe && o.kind === 'door' && n.material.name === 'lacquer_white') {
        n.material = n.material.clone();
        n.material.map = null;
        n.material.color.setRGB(0.32, 0.33, 0.33);
        n.material.metalness = 0.5;
        n.material.roughness = 0.45;
      }
      // front doors are a flush charcoal leaf, not wood
      if (o.kind === 'front' && n.material.name === 'walnut_v') {
        n.material = n.material.clone();
        n.material.map = null;
        n.material.color.setRGB(0.03, 0.032, 0.035);
        n.material.roughness = 0.45;
      }
      for (const m of [].concat(n.material)) {
        if (m.name !== 'glass_clear' || m.userData.clear || m.userData.frosted) continue;
        // window glass: what passes through is barely tinted; what you see on it is the
        // reflection (the library's light glass read as frosted in daylight)
        m.userData.clear = true;
        m.color.setRGB(0.015, 0.02, 0.022);
        m.opacity = 0.32;
        m.roughness = 0.02;
        m.envMapIntensity = 1.5;
        // the reflection is added at full strength (premultiplied blending) and opacity only
        // holds back the view through the pane, more so at grazing angles (Fresnel): a plain
        // transparent material scaled the reflection by its opacity, so the glass read as an
        // open hole onto a bright interior
        m.premultipliedAlpha = true;
        m.onBeforeCompile = (sh) => {
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <opaque_fragment>', `
              float glassF = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 5.0);
              gl_FragColor = vec4(outgoingLight, mix(diffuseColor.a, 1.0, glassF));`)
            .replace('#include <premultiplied_alpha_fragment>', '');
        };
        m.customProgramCacheKey = () => 'glass-fresnel';
      }
      // the sun shines in through clear panes: casting shadows, the glass (and its sash, the same
      // mesh) kept every room out of direct sunlight
      if ([].concat(n.material).some((m) => m.userData.clear)) n.castShadow = false;
    });
    obj.position.set(x, y, z);
    obj.rotation.y = outward;
    group.add(obj);
    if (o.kind === 'door') {
      // a light switch on the room side of the wall, beside the latch edge of the door
      for (const sgn of [1, -1]) {
        const px = x + (alongX ? 0 : sgn * 0.3), pz = z + (alongX ? sgn * 0.3 : 0);
        if (!roomAt(px, pz) || roomAt(px, pz).hall) continue;
        const off = o.w / 2 + 0.12;
        const sxp = alongX ? x + off : x + sgn * (w.t / 2 + 0.006), szp = alongX ? z + sgn * (w.t / 2 + 0.006) : z + off;
        const plate = new THREE.Mesh(new THREE.BoxGeometry(alongX ? 0.085 : 0.012, 0.085, alongX ? 0.012 : 0.085), switchMat);
        plate.position.set(sxp, FL + 1.05, szp);
        group.add(plate);
      }
    }
    if (o.kind === 'door' || o.kind === 'front') {
      const leaves = [];
      obj.traverse((n) => { if (n.name === 'leaf') leaves.push(n); });
      const d = { x, z, leaves, open: 0, target: o.kind === 'door' ? 1 : 0, kind: o.kind, wall: wi,
        collider: box(x - (alongX ? o.w / 2 : 0.05), x + (alongX ? o.w / 2 : 0.05), z - (alongX ? 0.05 : o.w / 2), z + (alongX ? 0.05 : o.w / 2), FL, FL + o.h) };
      doors.push(d);
    }
  })));

  // ---------- furniture ----------
  const floorUnder = (x, z) => {
    let top = 0;
    for (const s of walkable) if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) top = Math.max(top, s.top);
    return top;
  };
  const missing = [];
  const interior = [];   // furniture inside the house (main.js hides it from far outside)
  const bb = new THREE.Box3();
  // contact shadows: a soft dark patch on the floor under each piece of indoor furniture that
  // stands on it (indoors nothing else grounds them: no sun reaches there), all in one mesh
  const contact = [];
  await Promise.all(plan.furniture.map(async ([path, x, z, yaw, opts = {}]) => {
    const lod = await proto(path);
    if (!lod) { missing.push(path); return; }
    const obj = lod.clone();
    obj.rotation.y = THREE.MathUtils.degToRad(yaw);
    if (opts.scale) obj.scale.setScalar(opts.scale);
    // a second copy of a model in another room: mirrored and recoloured so it doesn't read as the
    // same object twice. opts.mirror; opts.tint [r, g, b] for a picture's prints; opts.recolor
    // { materialName: [r, g, b] } (e.g. a bed's throw), each on its own copy of the material
    if (opts.mirror) obj.scale.x *= -1;
    const recolor = { ...opts.recolor };
    if (opts.tint) for (const k of ['print_1', 'print_2', 'print_3']) recolor[k] = opts.tint;
    if (Object.keys(recolor).length) {
      const own = new Map();
      obj.traverse((n) => {
        if (!n.isMesh) return;
        n.material = [].concat(n.material).map((m) => {
          const rgb = recolor[m.name];
          if (!rgb) return m;
          if (!own.has(m)) {
            const t = Object.assign(m.clone(), { onBeforeCompile: m.onBeforeCompile, customProgramCacheKey: m.customProgramCacheKey });
            t.name = `${m.name}:recoloured`;
            t.color.setRGB(...rgb);
            // a fabric's own dye (its colour map) would tint the new colour; its weave stays in
            // the normal map
            if (/^fabric/.test(m.name)) t.map = null;
            own.set(m, t);
          }
          return own.get(m);
        });
        if (n.material.length === 1) n.material = n.material[0];
      });
    }
    obj.updateMatrixWorld(true);
    bb.setFromObject(obj.levels[0].object);
    const c = bb.getCenter(new THREE.Vector3());
    const y = opts.ceiling ? TOP - bb.max.y : opts.mount ? floorUnder(x, z) : floorUnder(x, z) + (opts.y ?? 0) - bb.min.y;
    obj.position.set(x - c.x, y, z - c.z);
    // indoors the sun hardly reaches the furniture: its shading comes from the light bake and
    // ambient occlusion, and skipping it in the shadow map saves most of that pass
    const indoors = !!roomAt(x, z);
    if (indoors) interior.push(obj);
    obj.traverse((n) => { if (n.isMesh) { n.castShadow = !indoors; n.receiveShadow = true; } });
    // furniture is always seen from close by in a house: switch to the lighter levels sooner
    for (const level of obj.levels) level.distance *= LOD_BIAS;
    group.add(obj);
    obj.updateMatrixWorld(true);
    bb.setFromObject(obj.levels[0].object);
    const size = bb.getSize(new THREE.Vector3());
    // big pieces block the way; rugs, curtains, lamps and small things don't
    if (!/rug|curtain|pendant|ceiling|pillow|picture|vase|clock|lamp|plant|shrub|flower|bush/.test(path) && size.y > 0.3 && size.x * size.z > 0.12) {
      obstacles.push(box(bb.min.x, bb.max.x, bb.min.z, bb.max.z, bb.min.y, bb.max.y));
    }
    if (!opts.ceiling && !(opts.y > 0.2) && !/rug|curtain|pendant|ceiling|pillow|plant|shrub|flower|bush|planter/.test(path) && bb.min.y < floorUnder(x, z) + 0.6) {
      const m = 0.08 + Math.min(size.x, size.z) * 0.1;
      const g = new THREE.PlaneGeometry(size.x + 2 * m, size.z + 2 * m).rotateX(-Math.PI / 2);
      g.translate((bb.min.x + bb.max.x) / 2, floorUnder(x, z) + 0.004, (bb.min.z + bb.max.z) / 2);
      contact.push(g);
    }
  }));
  if (contact.length) {
    const mesh = new THREE.Mesh(mergeGeometries(contact, false), new THREE.MeshBasicMaterial({
      map: contactTexture(), transparent: true, depthWrite: false, color: 0x000000, opacity: 0.8, fog: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    }));
    mesh.name = 'house:contact-shadows';
    mesh.renderOrder = 1;
    group.add(mesh);
  }
  if (missing.length) console.warn('house: models not in the library yet:', [...new Set(missing)].join(', '));

  // recessed downlights on the ceilings; the light bake lights the rooms from them
  const lights = plan.rooms.flatMap((r) => roomLights(r, TOP));
  const downlight = await proto('interior/ceiling_light_recessed');
  let lampLens = null;
  if (downlight) {
    for (const p of lights) {
      const o = downlight.clone();
      // the library fitting is recessed (lens 6 cm above its trim) and the ceiling has no
      // cut-outs: lowered so the lens shows, it reads as a slim surface-mounted spot
      o.position.copy(p).setY(p.y - 0.085);
      // a 12 cm trim (the library fitting is 8 cm), and its glowing lens kept in view: the
      // light levels switched in at 2 m and turned every fitting into a grey dot
      o.scale.setScalar(1.5);
      for (const level of o.levels) level.distance *= 5;
      o.traverse((n) => {
        n.castShadow = false;
        // the lamps are on (they light the bake): the lens glows rather than reading as a white ring
        if (n.isMesh && n.material.name === 'lamp') {
          lampLens ??= Object.assign(n.material.clone(), { emissiveIntensity: 3 });
          n.material = lampLens;
        }
      });
      group.add(o);
    }
  }

  // the library's rust cushions and throws are a saturated orange; a muted terracotta suits the
  // grey and oak rooms (the models carry their own copy of the material)
  const muted = new Set();
  // the procedural kitchen island and dining tables map a texture tile over ~1.4 m, wider than
  // tall, so their oak and marble read huge and stretched sideways: their own copies at an even,
  // smaller repeat (per mesh-name prefix and material). The marble backsplash's veins read as
  // rock at the slab's 0.9 m tile, and the vertical panel under the wall units came out mid-grey
  // next to the lit worktop: finer veins and a brighter albedo (third item: colour factor)
  const REPEAT_FIX = [
    [/^island/, { oak: [2.8, 2.0], marble_white: [1.4, 1.0] }],
    [/^table_/, { oak: [2.8, 2.2] }],
    [/^house:marble_white$/, { marble_white: [1.6, 1.6] }, 1.5],
  ];
  const islandMats = new Map();
  group.traverse((n) => {
    const fix = n.isMesh && REPEAT_FIX.find(([re, mats]) => re.test(n.name) && mats[n.material?.name]);
    const rep = fix && fix[1][n.material.name];
    if (!rep) return;
    const key = `${fix[0]}|${n.material.name}`;
    if (!islandMats.has(key)) {
      const src = n.material;
      const m = Object.assign(src.clone(), { onBeforeCompile: src.onBeforeCompile, customProgramCacheKey: src.customProgramCacheKey });
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
        if (!src[k] || (k !== 'map' && src[k] === src.map)) continue;
        const t = m[k] = src[k].clone();
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(...rep);
        t.needsUpdate = true;
      }
      if (fix[2]) m.color.multiplyScalar(fix[2]);
      islandMats.set(key, m);
    }
    n.material = islandMats.get(key);
  });
  group.traverse((n) => {
    for (const m of n.isMesh ? [].concat(n.material) : []) {
      if (muted.has(m)) continue;
      muted.add(m);
      if (m.name === 'fabric_rust') m.color.setRGB(0.78, 0.88, 0.95);
      // the induction hob's black glass mirrored the white room at full strength and read as a
      // grey tray: a dimmer reflection keeps it black with a highlight
      if (m.name === 'black_glass') m.envMapIntensity = 0.4;
      // sheer curtains: at 55% the window frames ghosted through them; denser, with a faint glow
      // of the daylight behind them. They write depth: the AO pass works from depth alone, and
      // without the curtain in it the window frame behind darkened the cloth with grey halos
      if (m.name === 'sheer') { m.opacity = 0.72; m.emissive.setRGB(1, 0.99, 0.96); m.emissiveIntensity = 0.12; m.depthWrite = true; }
      // floor and bedside lamps are off in daylight (their shades glowed pure white)
      if (m.name === 'shade_linen' || m.name === 'shade_inner' || (m.name === 'opal' && n.parent?.name === 'lamp_mesh')) m.emissiveIntensity = 0.08;
      // furniture glass (shower screens): the library's pale tint at low opacity read as milky
      // plastic; clear glass is nearly colourless, seen mostly by its faint reflection
      if (m.name === 'glass_clear' && !m.userData.clear && !m.userData.frosted) {
        m.color.setRGB(0.02, 0.026, 0.026);
        m.opacity = 0.14;
        m.roughness = 0.02;
        m.envMapIntensity = 0.35;
      }
    }
  });
  // the dining pendants hang lit over the table: the opal diffuser glows and the white inside of
  // the black dome catches its warm light (unlit they read as two dead black domes)
  const pendantMats = new Map();
  group.traverse((n) => {
    if (!n.isMesh || n.parent?.name !== 'pendant_mesh' || !['opal', 'lacquer_white'].includes(n.material.name)) return;
    if (!pendantMats.has(n.material)) {
      const src = n.material;
      const m = Object.assign(src.clone(), { onBeforeCompile: src.onBeforeCompile, customProgramCacheKey: src.customProgramCacheKey });
      if (m.name === 'opal') m.emissiveIntensity = 4;
      else { m.emissive.setRGB(1, 0.86, 0.66); m.emissiveIntensity = 0.35; }
      pendantMats.set(src, m);
    }
    n.material = pendantMats.get(n.material);
  });

  return {
    group, obstacles, walkable, doors, roomAt, lights, interior,
    bounds: { minX: X0, maxX: X1, minZ: Z0, maxZ: Z1, floor: FL, ceiling: TOP, roof: TOP + SLAB + PARAPET },
  };
}
