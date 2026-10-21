// Architectural dimensions over the top view: every room's net size between the faces of its
// walls and its net area, chains of outside dimensions along the four sides of the house (to the
// outer faces of the walls) with the overall size beyond them, the clear width of every door and
// window, and a legend with the gross and net areas. All of it is worked out from the same plan
// numbers the house is built from: walls are centre lines with a thickness, rooms are outlines on
// those centre lines (orthogonal polygons), openings sit at a distance along their wall.
//
//   const dims = createDimensions(plan, { y, container });   // y: height to draw the lines at
//   scene.add(dims.group);
//   dims.setVisible(true);
//   dims.update(camera, { detail });  // each frame: places the labels; detail shows door widths
import * as THREE from 'three';
import { t } from '../i18n.js';

const EPS = 1e-6;
const m = (v) => v.toFixed(2);
const cm = (v) => `${Math.round(v * 100)}`;
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// signed area of a polygon given as [[x, z], ...]
const signedArea = (poly) => poly.reduce((a, [x, z], i) => { const [x2, z2] = poly[(i + 1) % poly.length]; return a + x * z2 - x2 * z; }, 0) / 2;
function inside(poly, x, z) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
// drops points that lie on a straight run between their neighbours
function simplify(poly) {
  const out = poly.filter((p, i) => {
    const a = poly[(i + poly.length - 1) % poly.length], b = poly[(i + 1) % poly.length];
    return !((Math.abs(a[0] - p[0]) < EPS && Math.abs(p[0] - b[0]) < EPS) || (Math.abs(a[1] - p[1]) < EPS && Math.abs(p[1] - b[1]) < EPS));
  });
  return out.length >= 3 ? out : poly;
}

export function createDimensions(drawn, { y, container }) {
  const walls = drawn.walls.map((w) => ({ ...w, openings: w.openings ?? [] }));
  const rooms = drawn.rooms.map((r) => ({ ...r, poly: simplify(r.poly) }));
  const EXT = Math.max(...walls.filter((w) => w.exterior).map((w) => w.t));
  const e = EXT / 2;

  // the thickness of the wall along a room edge: the wall that covers most of it (none: an
  // opening between two parts of one space, measured to the centre line)
  function edgeThickness([x0, z0], [x1, z1]) {
    const alongX = Math.abs(z0 - z1) < EPS;
    const lo = alongX ? Math.min(x0, x1) : Math.min(z0, z1), hi = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    const line = alongX ? z0 : x0;
    let best = 0, t = 0;
    for (const w of walls) {
      const wAlongX = Math.abs(w.a[1] - w.b[1]) < EPS;
      if (wAlongX !== alongX || Math.abs((alongX ? w.a[1] : w.a[0]) - line) > EPS) continue;
      const wl = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]), wh = alongX ? Math.max(w.a[0], w.b[0]) : Math.max(w.a[1], w.b[1]);
      const overlap = Math.min(hi, wh) - Math.max(lo, wl);
      if (overlap > best) { best = overlap; t = w.t; }
    }
    return t;
  }

  // a room's net outline: each edge moved in by half its wall's thickness (orthogonal outlines,
  // so each new corner takes its x from the vertical edge and its z from the horizontal one)
  function netOutline(poly) {
    const n = poly.length;
    const edges = poly.map((p, i) => {
      const q = poly[(i + 1) % n];
      const alongX = Math.abs(p[1] - q[1]) < EPS;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      let nx = (q[1] - p[1]) / len, nz = -(q[0] - p[0]) / len;
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      if (!inside(poly, mx + nx * 0.01, mz + nz * 0.01)) { nx = -nx; nz = -nz; }
      const d = edgeThickness(p, q) / 2;
      return { alongX, value: alongX ? p[1] + nz * d : p[0] + nx * d, d };
    });
    return poly.map((_, i) => {
      const before = edges[(i + n - 1) % n], after = edges[i];
      const vx = before.alongX ? after : before, hz = before.alongX ? before : after;
      return [vx.value, hz.value];
    });
  }

  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 999;
  const lineMat = new THREE.LineBasicMaterial({ color: 0x1b1f24, depthTest: false, depthWrite: false, transparent: true, opacity: 0.9 });
  const segs = [];
  const seg = (x0, z0, x1, z1) => segs.push(x0, y, z0, x1, y, z1);
  const labels = [];
  const label = (text, x, z, cls) => {
    const el = document.createElement('div');
    el.className = `dim-label ${cls}`;
    el.innerHTML = text;
    container.appendChild(el);
    labels.push({ el, pos: new THREE.Vector3(x, y, z), cls });
  };

  // ---- rooms: net size (rectangles) and net area, at the middle of the room's largest part
  let netTotal = 0;
  for (const r of rooms) {
    const net = netOutline(r.poly);
    const area = Math.abs(signedArea(net));
    netTotal += area;
    // the label goes in the biggest cell of the room's grid, so it stays inside L-shaped rooms
    const xs = [...new Set(r.poly.map((p) => p[0]))].sort((a, b) => a - b), zs = [...new Set(r.poly.map((p) => p[1]))].sort((a, b) => a - b);
    let cell = null;
    for (let i = 0; i < xs.length - 1; i++) for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2, a = (xs[i + 1] - xs[i]) * (zs[j + 1] - zs[j]);
      if (inside(r.poly, cx, cz) && (!cell || a > cell.a)) cell = { cx, cz, a };
    }
    // a rectangular room also gets its net width and depth (x by z)
    const nx = net.map((p) => p[0]), nz = net.map((p) => p[1]);
    // (a narrow room stacks its numbers, so its label stays about as wide as the room)
    const wx = Math.max(...nx) - Math.min(...nx), wz = Math.max(...nz) - Math.min(...nz);
    const size = net.length === 4 ? `${t('metres', { v: `${m(wx)} ×${wx < 2 ? '<br>' : ' '}${m(wz)}` })}<br>` : '';
    // a room's name may be in any language: its own direction (dir=auto)
    label(`<b dir="auto">${escape(r.name)}</b><br>${size}${t('squareMetres', { v: area.toFixed(1) })}`, cell.cx, cell.cz, 'room');
  }

  // ---- the footprint on a grid of the room outlines' own coordinates
  const xs = [...new Set(rooms.flatMap((r) => r.poly.map((p) => p[0])))].sort((a, b) => a - b);
  const zs = [...new Set(rooms.flatMap((r) => r.poly.map((p) => p[1])))].sort((a, b) => a - b);
  const filled = xs.slice(0, -1).map((x0, i) => zs.slice(0, -1).map((z0, j) => {
    const cx = (x0 + xs[i + 1]) / 2, cz = (z0 + zs[j + 1]) / 2;
    return rooms.some((r) => inside(r.poly, cx, cz));
  }));
  const at = (i, j) => i >= 0 && j >= 0 && i < filled.length && j < filled[0].length && filled[i][j];
  // gross area to the outer faces: the footprint on centre lines, plus a strip of half the
  // outside wall along its perimeter, plus (or minus) a little square at each outer (inner) corner
  let footprint = 0, perimeter = 0, corners = 0;
  for (let i = 0; i < filled.length; i++) for (let j = 0; j < filled[0].length; j++) {
    if (!filled[i][j]) continue;
    const w = xs[i + 1] - xs[i], d = zs[j + 1] - zs[j];
    footprint += w * d;
    if (!at(i - 1, j)) perimeter += d;
    if (!at(i + 1, j)) perimeter += d;
    if (!at(i, j - 1)) perimeter += w;
    if (!at(i, j + 1)) perimeter += w;
  }
  for (let i = 0; i <= filled.length; i++) for (let j = 0; j <= filled[0].length; j++) {
    const n = [at(i - 1, j - 1), at(i, j - 1), at(i - 1, j), at(i, j)].filter(Boolean).length;
    if (n === 1) corners++;
    else if (n === 3) corners--;
  }
  const gross = footprint + perimeter * e + corners * e * e;

  // ---- outside chains: along each side, ticks where the facade seen from that side steps in or
  // out (on the outer faces), then the overall size one row further out
  const cols = filled.length, rows = filled[0].length;
  const chain = (ticks, line, along, offsetLabel) => {
    ticks.sort((a, b) => a - b);
    const pt = (u) => (along === 'x' ? [u, line] : [line, u]);
    const [a0, b0] = [pt(ticks[0]), pt(ticks[ticks.length - 1])];
    seg(a0[0], a0[1], b0[0], b0[1]);
    for (let i = 0; i < ticks.length; i++) {
      const [px, pz] = pt(ticks[i]);
      seg(px - 0.18, pz + 0.18, px + 0.18, pz - 0.18);   // the architect's slash
      if (along === 'x') seg(px, pz - 0.25, px, pz + 0.25); else seg(px - 0.25, pz, px + 0.25, pz);
      if (i < ticks.length - 1) {
        const len = ticks[i + 1] - ticks[i];
        if (len < 0.05) continue;
        const [mx, mz] = pt((ticks[i] + ticks[i + 1]) / 2);
        label(m(len), mx + (along === 'z' ? offsetLabel : 0), mz + (along === 'x' ? offsetLabel : 0), 'chain');
      }
    }
  };
  // per column (or row): how far the house reaches toward that side
  const reach = (side) => {
    const out = [];
    const n = side === 'north' || side === 'south' ? cols : rows;
    for (let i = 0; i < n; i++) {
      const cells = [];
      for (let j = 0; j < (side === 'north' || side === 'south' ? rows : cols); j++) {
        if (side === 'north' || side === 'south' ? filled[i][j] : filled[j][i]) cells.push(j);
      }
      out.push(cells.length ? (side === 'north' ? zs[cells[0]] : side === 'south' ? zs[cells[cells.length - 1] + 1] : side === 'west' ? xs[cells[0]] : xs[cells[cells.length - 1] + 1]) : null);
    }
    return out;
  };
  const sides = [
    { side: 'north', coords: xs, out: -1 },
    { side: 'south', coords: xs, out: 1 },
    { side: 'west', coords: zs, out: -1 },
    { side: 'east', coords: zs, out: 1 },
  ];
  const [minX, maxX, minZ, maxZ] = [xs[0] - e, xs[xs.length - 1] + e, zs[0] - e, zs[zs.length - 1] + e];
  for (const { side, coords, out } of sides) {
    const r = reach(side);
    const first = r.findIndex((v) => v != null), last = r.length - 1 - [...r].reverse().findIndex((v) => v != null);
    const ticks = [coords[first] - e, coords[last + 1] + e];
    for (let i = first; i < last; i++) {
      if (r[i] == null || r[i + 1] == null || Math.abs(r[i] - r[i + 1]) < EPS) continue;
      // the step's face belongs to whichever neighbour reaches further out, and looks toward the other
      const leftFurther = out < 0 ? r[i] < r[i + 1] : r[i] > r[i + 1];
      ticks.push(coords[i + 1] + (leftFurther ? e : -e));
    }
    const edge = out < 0 ? Math.min(...r.filter((v) => v != null)) - e : Math.max(...r.filter((v) => v != null)) + e;
    const line1 = edge + out * 1.2, line2 = edge + out * 2.2;
    const along = side === 'north' || side === 'south' ? 'x' : 'z';
    chain(ticks, line1, along, out * 0.32);
    chain([ticks[0], ticks[ticks.length - 1]], line2, along, out * 0.32);
  }

  // ---- doors, windows and sliders: their clear width in centimetres, at the opening
  for (const w of walls) {
    const alongX = Math.abs(w.a[1] - w.b[1]) < EPS;
    const u0 = alongX ? Math.min(w.a[0], w.b[0]) : Math.min(w.a[1], w.b[1]);
    const v = alongX ? w.a[1] : w.a[0];
    for (const o of w.openings) {
      if (o.kind === 'gap') continue;
      const u = u0 + o.at;
      label(cm(o.w), alongX ? u : v, alongX ? v : u, `opening ${o.kind === 'window' ? 'window' : 'door'}`);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
  const lines = new THREE.LineSegments(geo, lineMat);
  lines.renderOrder = 999;
  lines.frustumCulled = false;
  group.add(lines);

  // the plot, inside the line of its boundary wall
  const pr = drawn.garden?.wall?.rect;
  const plot = pr ? (pr[2] - pr[0]) * (pr[3] - pr[1]) : 0;
  // the patio area roofed by pergolas
  const roofed = (drawn.outdoor?.pergolas ?? []).reduce((a, pg) => a + (pg.box[2] - pg.box[0]) * (pg.box[3] - pg.box[1]), 0);
  const legend = document.createElement('div');
  legend.className = 'dim-legend';
  const ints = [...new Set(walls.filter((w) => !w.exterior).map((w) => cm(w.t)))].join(', ');
  legend.innerHTML = `${t('dimsTitle')}<br>`
    + `${t('dimsGross', { a: gross.toFixed(1), w: (maxX - minX).toFixed(2), d: (maxZ - minZ).toFixed(2) })}<br>`
    + `${t('dimsNet', { a: netTotal.toFixed(1) })}<br>`
    + (plot ? `${t('dimsPlot', { plot: plot.toFixed(0), yard: (plot - gross).toFixed(0) })}${roofed ? t('dimsRoofed', { a: roofed.toFixed(0) }) : ''}<br>` : '')
    + t('dimsWalls', { ext: cm(EXT), int: ints });
  container.appendChild(legend);

  const v = new THREE.Vector3();
  let visible = false;
  function setVisible(on) {
    visible = on;
    group.visible = on;
    container.style.display = on ? '' : 'none';
  }
  setVisible(false);

  function update(camera, { detail = true } = {}) {
    if (!visible) return;
    const w = innerWidth, h = innerHeight;
    for (const l of labels) {
      v.copy(l.pos).project(camera);
      const show = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && (detail || l.cls !== 'opening door' && l.cls !== 'opening window');
      l.el.style.display = show ? '' : 'none';
      if (show) l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  return { group, setVisible, update, get visible() { return visible; }, totals: { gross, netTotal, width: maxX - minX, depth: maxZ - minZ } };
}
