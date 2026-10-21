// Low garden plants that EZ-Tree's bushes can't do: lavender clumps, painted procedurally
// (grey-green stems topped with purple flower spikes) onto a few crossed cards. A bed of a
// hundred clumps merges into one mesh and one draw call.
//
//   const bed = createPlantBed('lavender', [[x, z, size], ...]);   // size: clump width, metres
//   scene.add(bed);
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const KINDS = {
  // stems, flower colour (sRGB), how much of the stem the spike covers
  lavender: { stem: [72, 88, 60], flower: [[120, 104, 160], [138, 122, 174], [102, 90, 142]], spike: 0.32, height: 0.65 },
  rosemary: { stem: [70, 92, 66], flower: [[86, 108, 80], [96, 120, 88], [78, 98, 74]], spike: 0.9, height: 0.8 },
};

const textures = new Map();
function plantTexture(kind) {
  if (textures.has(kind)) return textures.get(kind);
  const k = KINDS[kind];
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rgb = ([r, gg, b], f = 1) => `rgb(${Math.round(r * f)},${Math.round(gg * f)},${Math.round(b * f)})`;
  // the leafy base: narrow grey-green leaves in a low dome, flowers rise out of it
  for (let i = 0; i < 260; i++) {
    const side = rnd() - 0.5, x = 128 + side * 200, top = 256 - (1 - Math.abs(side) * 1.6) * (60 + rnd() * 40);
    const len = 14 + rnd() * 18, a = (rnd() - 0.5) * 1.2 + side * 1.2;
    g.strokeStyle = rgb(k.stem, 0.8 + rnd() * 0.6);
    g.lineWidth = 2 + rnd() * 1.5;
    g.beginPath();
    g.moveTo(x, Math.max(top, 150) + len);
    g.lineTo(x + Math.sin(a) * len, Math.max(top, 150));
    g.stroke();
  }
  // a mound: stems rise from a wide base and fan out, shorter toward the sides
  for (let i = 0; i < 110; i++) {
    const side = rnd() - 0.5, x0 = 128 + side * 120, lean = side * 70 + (rnd() - 0.5) * 40, top = 18 + Math.abs(side) * 110 + rnd() * 40;
    const x1 = x0 + lean;
    g.strokeStyle = rgb(k.stem, 0.7 + rnd() * 0.5);
    g.lineWidth = 1.5 + rnd() * 1.5;
    g.beginPath();
    g.moveTo(x0, 256);
    g.quadraticCurveTo(x0 + lean * 0.3, 140, x1, top);
    g.stroke();
    // the flower spike: small dots along the top part of the stem
    const len = (256 - top) * k.spike, col = k.flower[i % k.flower.length];
    for (let d = 0; d < len; d += 3) {
      const t = d / (256 - top), y = top + d, x = x1 - lean * 0.7 * t * t;
      g.fillStyle = rgb(col, 0.75 + rnd() * 0.45);
      g.beginPath();
      g.ellipse(x + (rnd() - 0.5) * 3, y, 2.2 + rnd() * 1.2, 2.6, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  textures.set(kind, tex);
  return tex;
}

// clumps: [x, z, size] with size the clump's width in metres; y: ground height
export function createPlantBed(kind, clumps, { y = 0 } = {}) {
  const k = KINDS[kind];
  const geos = [];
  clumps.forEach(([x, z, size], i) => {
    const h = size * k.height, turn = (i * 2.399) % Math.PI;
    for (let c = 0; c < 3; c++) {
      const q = new THREE.PlaneGeometry(size, h);
      q.translate(0, h / 2, 0);
      q.rotateY(turn + (c * Math.PI) / 3);
      q.translate(x, y, z);
      geos.push(q);
    }
  });
  const material = new THREE.MeshStandardMaterial({
    map: plantTexture(kind), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85,
    // light passes through the thin stems and petals
    emissive: 0xffffff, emissiveMap: plantTexture(kind), emissiveIntensity: 0.06,
  });
  const mesh = new THREE.Mesh(mergeGeometries(geos, false), material);
  // cards lit as if they faced up: crossed planes lit by their own normals flicker dark/bright
  const n = mesh.geometry.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = `plants:${kind}`;
  return mesh;
}
