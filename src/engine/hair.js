import * as THREE from 'three';

// Strand hair for the player, grown at load time from the avatar's own hair cards.
//
// Rocketbox hair is mostly a photo of hair projected onto a faceted "helmet" that is part of
// the head mesh, plus a few alpha-textured fringe cards. Up close it reads as a helmet of
// plates however it is shaded. Here tens of thousands of thin strands are scattered over both:
//  - where a strand sits: random points on the head mesh where its texture shows hair (dark
//    32-texel blocks in the scalp part of the texture) and on the cards where they are opaque,
//    so the strands follow the photographed hairline;
//  - which way it runs: a little of the local orientation of the painted strands at that texel
//    (structure tensor of the texture's brightness: strands run across the strongest
//    gradient), mapped into 3D through the card's UV layout, mostly a combed flow away from
//    the crown, flattened onto the scalp; past its card's painted edge a strand fades out;
//  - its colour: half the photographed hair's colour at the root, half its mean colour, with
//    per-strand variation, darker at the root.
// Each strand is a camera-facing ribbon about 2 px wide with soft edges, blended over the
// shell (which stays as the dark, opaque base layer), and lit with a Kajiya-Kay highlight
// along the strand. All strands are one draw call, attached to the head bone.
const STRANDS = 90000;
const SEGMENTS = 3;

// textures: { 1: head colour map url, 2: hair card opacity map url } (by mesh part)
// strandCount: how many to grow (STRANDS for close-ups; a game seen from a few metres needs far fewer)
export async function buildStrandHair({ mesh, root }, headBone, sourceMaterials, textures, partOf, strandCount = STRANDS) {
  const imgs = { 1: await loadPixels(textures[1], true), 2: await loadPixels(textures[2], false) };
  root.updateMatrixWorld(true);
  const geo = mesh.geometry;
  const pos = geo.attributes.position, uv = geo.attributes.uv, index = geo.index;

  // hair triangles in the current (rest) pose, world space
  const tris = [];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const toWorld = (i, out) => mesh.applyBoneTransform(i, out.fromBufferAttribute(pos, i)).applyMatrix4(mesh.matrixWorld);
  for (const g of geo.groups) {
    const part = partOf(sourceMaterials[g.materialIndex] ?? sourceMaterials[0]);
    if (!imgs[part]) continue;
    for (let k = g.start; k < g.start + g.count; k += 3) {
      const ids = [0, 1, 2].map((j) => (index ? index.getX(k + j) : k + j));
      ids.forEach((id, j) => toWorld(id, v[j]));
      const area = new THREE.Vector3().crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0])).length() / 2;
      if (area < 1e-9) continue;
      const tuv = ids.map((id) => new THREE.Vector2(uv.getX(id), uv.getY(id)));
      // skip head triangles with no hair at all (face, neck, eyes, mouth)
      const mid = tuv[0].clone().add(tuv[1]).add(tuv[2]).divideScalar(3);
      if (part === 1 && !tuv.some((t) => imgs[1].sample(t.x, t.y).a > 0) && !imgs[1].sample(mid.x, mid.y).a) continue;
      tris.push({ p: v.map((x) => x.clone()), uv: tuv, area, img: imgs[part] });
    }
  }
  if (!tris.length) return null;

  // the head's centre and crown, from the hair shell's bounds
  const box = new THREE.Box3();
  for (const t of tris) for (const p of t.p) box.expandByPoint(p);
  const center = box.getCenter(new THREE.Vector3());
  center.y -= (box.max.y - box.min.y) * 0.15;
  const crown = new THREE.Vector3(center.x, box.max.y - (box.max.y - box.min.y) * 0.2, center.z);

  // Candidates are scattered over the cards by area (oversampled; opacity rejects about half).
  // The cards overlap in two or three layers, so area sampling alone would make the hair dense
  // where layers overlap and thin where one card is alone, which outlines every card. Each
  // candidate is binned by its direction from the head's centre and every bin keeps the same
  // number of strands, which spreads them evenly over the head.
  const totalArea = tris.reduce((s, t) => s + t.area, 0);
  const tries = strandCount * 3;
  const toLocal = headBone.matrixWorld.clone().invert();
  const rand = mulberry(7);
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const BINS = 48, BR = 2 * BINS + 1;
  const cand = [], binCount = new Uint16Array(BR * BR * BR);
  for (const t of tris) {
    let n = (t.area / totalArea) * tries;
    n = Math.floor(n) + (rand() < n % 1 ? 1 : 0);
    // UV -> surface derivatives of this card
    e1.subVectors(t.p[1], t.p[0]); e2.subVectors(t.p[2], t.p[0]);
    const du1 = t.uv[1].x - t.uv[0].x, dv1 = t.uv[1].y - t.uv[0].y, du2 = t.uv[2].x - t.uv[0].x, dv2 = t.uv[2].y - t.uv[0].y;
    const det = du1 * dv2 - du2 * dv1;
    if (Math.abs(det) < 1e-12) continue;
    t.dPdu = e1.clone().multiplyScalar(dv2).addScaledVector(e2, -dv1).divideScalar(det);
    t.dPdv = e2.clone().multiplyScalar(du1).addScaledVector(e1, -du2).divideScalar(det);
    t.N = new THREE.Vector3().crossVectors(e1, e2).normalize();
    for (let s = 0; s < n; s++) {
      let a = rand(), b = rand();
      if (a + b > 1) { a = 1 - a; b = 1 - b; }
      const u = t.uv[0].x + du1 * a + du2 * b, w = t.uv[0].y + dv1 * a + dv2 * b;
      const px = t.img.sample(u, w);
      if (px.a < 0.5) continue;
      const x = t.p[0].x + e1.x * a + e2.x * b - center.x, y = t.p[0].y + e1.y * a + e2.y * b - center.y, z = t.p[0].z + e1.z * a + e2.z * b - center.z;
      const r = Math.hypot(x, y, z);
      const bin = (Math.floor((x / r + 1) * BINS) * BR + Math.floor((y / r + 1) * BINS)) * BR + Math.floor((z / r + 1) * BINS);
      binCount[bin]++;
      cand.push({ t, u, w, a, b, bin, px });
    }
  }
  // the per-bin cap that keeps about `strandCount` strands
  const counts = binCount.filter((c) => c > 0);
  const most = counts.reduce((m, c) => Math.max(m, c), 0);
  let cap = 1, total = 0;
  for (; cap <= most; cap++) {
    total = counts.reduce((sum, c) => sum + Math.min(c, cap), 0);
    if (total >= strandCount) break;
  }
  const kept = new Uint16Array(binCount.length);
  const VPS = (SEGMENTS + 1) * 2; // vertices per strand
  const out = {
    pos: new Float32Array(total * VPS * 3), dir: new Float32Array(total * VPS * 3), nor: new Float32Array(total * VPS * 3),
    col: new Float32Array(total * VPS * 3), side: new Float32Array(total * VPS), alpha: new Float32Array(total * VPS),
  };
  const p = new THREE.Vector3(), tip = new THREE.Vector3(), nl = new THREE.Vector3();
  let made = 0, vi = 0;
  for (const c of cand) {
    if (kept[c.bin] >= cap) continue;
    const { t, u, w } = c, img = t.img;
    const o = img.orientation(u, w); // strand direction in uv space
    if (!o) continue;
    const T = t.dPdu.clone().multiplyScalar(o.x).addScaledVector(t.dPdv, o.y);
    const metresPerUv = T.length();
    if (metresPerUv < 1e-9) continue;
    kept[c.bin]++;
    const P = t.p[0].clone().addScaledVector(e1.subVectors(t.p[1], t.p[0]), c.a).addScaledVector(e2.subVectors(t.p[2], t.p[0]), c.b);
    const outward = P.clone().sub(center).normalize();
    T.divideScalar(metresPerUv);
    const q = P.clone().sub(crown);
    const sign = T.dot(q) < 0 ? -1 : 1;
    T.multiplyScalar(sign);
    // mostly a combed flow away from the crown with a little of the painted direction, lying
    // on the scalp: the painted directions jump from card to card, and so would the highlight
    T.lerp(q.normalize(), 0.85);
    T.addScaledVector(outward, -T.dot(outward) * 0.85).normalize();
    const len = 0.014 + rand() * 0.022;
    const uvLen = len / metresPerUv;
    // past the painted edge of its card a strand fades out instead of ending abruptly
    const fadeAt = [];
    for (let k = 0; k <= SEGMENTS; k++) fadeAt.push(img.sample(u + o.x * sign * uvLen * k / SEGMENTS, w + o.y * sign * uvLen * k / SEGMENTS).a);
    const nOut = t.N.dot(outward) < 0 ? t.N.clone().negate() : t.N;
    // strands on the head take half the photographed hair's colour at their root (keeps some of
    // its lighter and darker locks; all of it would repeat the photo's own light and shadow) and
    // half its mean colour; the fringe cards' colours differ per card, so their strands take the
    // mean. x1.6: the photo's hair is darkened by the lighting it was taken in
    const m = imgs[1].mean, own = img === imgs[1] ? c.px : m;
    const col = { r: (own.r + m.r) * 0.8, g: (own.g + m.g) * 0.8, b: (own.b + m.b) * 0.8 };
    const lift = rand() * 0.0025; // layered depth over the shell
    const shade = 0.7 + rand() * 0.9; // visible strand-to-strand variation
    nl.copy(outward).transformDirection(toLocal);
    for (let k = 0; k <= SEGMENTS; k++) {
      const f = k / SEGMENTS;
      // a slight arc away from the shell in the middle, the tip settling back onto it
      p.copy(P).addScaledVector(T, len * f).addScaledVector(nOut, lift + Math.sin(f * Math.PI) * 0.001 + 0.0005);
      tip.copy(p).add(T);
      p.applyMatrix4(toLocal);
      tip.applyMatrix4(toLocal).sub(p).normalize();
      const root = 0.55 + 0.45 * f; // darker at the root, like hair shadowing itself
      const al = 0.85 * (1 - f * f) * Math.max(0.15, Math.min(1, fadeAt[k] * 1.5));
      for (let sd = -1; sd <= 1; sd += 2, vi++) {
        p.toArray(out.pos, vi * 3);
        tip.toArray(out.dir, vi * 3);
        nl.toArray(out.nor, vi * 3);
        out.col[vi * 3] = col.r * shade * root; out.col[vi * 3 + 1] = col.g * shade * root; out.col[vi * 3 + 2] = col.b * shade * root;
        out.side[vi] = sd;
        out.alpha[vi] = al;
      }
    }
    made++;
  }

  const g = new THREE.BufferGeometry();
  const used = (a, n) => new THREE.BufferAttribute(a.subarray(0, vi * n), n);
  g.setAttribute('position', used(out.pos, 3));
  g.setAttribute('normal', used(out.nor, 3));
  g.setAttribute('aDir', used(out.dir, 3));
  g.setAttribute('aSide', used(out.side, 1));
  g.setAttribute('color', used(out.col, 3));
  g.setAttribute('aAlpha', used(out.alpha, 1));
  const idx = new Uint32Array(made * SEGMENTS * 6);
  for (let s = 0, o = 0; s < made; s++) {
    const base = s * (SEGMENTS + 1) * 2;
    for (let k = 0; k < SEGMENTS; k++) {
      const a = base + k * 2;
      idx.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], o);
      o += 6;
    }
  }
  g.setIndex(new THREE.BufferAttribute(idx, 1));

  const strands = new THREE.Mesh(g, strandMaterial());
  strands.frustumCulled = false;
  strands.renderOrder = 2;
  strands.receiveShadow = false;
  headBone.add(strands);
  return strands;
}

function strandMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.9, metalness: 0, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    // three draws transparent double-sided materials in two passes, the back faces with flipped
    // normals; a ribbon faces front or back only according to which way its strand runs, so
    // that pass would light half the strands from the wrong side
    forceSinglePass: true,
  });
  const px = { value: 1.0 }, res = { value: 768 };
  mat.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.hairPx = px;
    shader.uniforms.hairRes = res;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        attribute vec3 aDir;
        attribute float aSide;
        attribute float aAlpha;
        uniform float hairPx;
        uniform float hairRes;
        varying vec3 vStrand;
        varying float vSide;
        varying float vAlpha;`)
      .replace('#include <project_vertex>', /* glsl */`
        vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
        vec3 tv = normalize((modelViewMatrix * vec4(aDir, 0.0)).xyz);
        vec3 across = normalize(cross(tv, mvPosition.xyz));
        float pxToView = -mvPosition.z * 2.0 / (projectionMatrix[1][1] * hairRes);
        mvPosition.xyz += across * aSide * hairPx * pxToView;
        gl_Position = projectionMatrix * mvPosition;
        vStrand = tv; vSide = aSide; vAlpha = aAlpha;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStrand;\nvarying float vSide;\nvarying float vAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vAlpha * (1.0 - smoothstep(0.2, 1.0, abs(vSide)));')
      // a ribbon's facing depends only on which way its strand runs relative to the camera, so
      // the double-sided normal flip would darken half the strands at random: every strand
      // keeps the outward, head-shaped normal
      .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
        #if NUM_DIR_LIGHTS > 0
        {
          vec3 L = directionalLights[0].direction;
          vec3 V = normalize(vViewPosition);
          vec3 H = normalize(L + V);
          vec3 T = normalize(vStrand);
          // Kajiya-Kay: a white primary band and a coloured secondary band shifted toward the root
          vec3 t1 = normalize(T + normal * 0.1), t2 = normalize(T - normal * 0.12);
          float d1 = dot(t1, H), d2 = dot(t2, H);
          float s1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), 220.0);
          float s2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 30.0);
          float lit = smoothstep(-0.2, 0.4, dot(normal, L));
          reflectedLight.directDiffuse += (s1 * 0.12 + s2 * 0.15 * diffuseColor.rgb * 2.5) * lit * directionalLights[0].color;
        }
        #endif
        // the PBR sky reflection on the smooth head-shaped normal turns the hair grey from above;
        // the strand highlight above is the hair's specular
        reflectedLight.indirectSpecular *= 0.15;
        reflectedLight.directSpecular *= 0.2;`);
  };
  mat.onBeforeRender = (renderer) => {
    const t = renderer.getRenderTarget();
    res.value = t ? t.viewport.w : renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  };
  mat.customProgramCacheKey = () => 'strand-hair';
  return mat;
}

// RGBA pixels of an image (point sampling) and a strand orientation estimate. With hairMask the
// alpha is replaced by a hair mask: the photographed hair is dark (sRGB luminance of a
// 32-texel block and its neighbours below 0.27, skin is 0.4-0.7) and lies in the upper half of
// the head texture (the lower half holds the eyes, teeth and the mouth).
async function loadPixels(url, hairMask) {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const W = bmp.width, H = bmp.height;
  const cv = new OffscreenCanvas(W, H);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, W, H).data;
  const LIN = new Float32Array(256).map((_, c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const lin = (c) => LIN[c];
  const at = (x, y) => (Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))) * 4;
  const L = new Float32Array(W * H); // brightness x alpha
  for (let i = 0, j = 0; j < L.length; i += 4, j++) L[j] = (d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11) * d[i + 3] / 65025;
  const lum = (x, y) => L[Math.min(H - 1, Math.max(0, y)) * W + Math.min(W - 1, Math.max(0, x))];
  let mask = null;
  const B = 32, BW = Math.ceil(W / B), BH = Math.ceil(H / B);
  if (hairMask) {
    const block = new Float32Array(BW * BH);
    for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
      let sum = 0;
      for (let y = 0; y < B; y += 4) for (let x = 0; x < B; x += 4) sum += lum(bx * B + x, by * B + y);
      block[by * BW + bx] = sum / ((B / 4) * (B / 4));
    }
    mask = new Uint8Array(BW * BH);
    for (let by = 0; by < BH / 2; by++) for (let bx = 0; bx < BW; bx++) {
      let sum = 0, n = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const xx = bx + i, yy = by + j;
        if (xx < 0 || yy < 0 || xx >= BW || yy >= BH) continue;
        sum += block[yy * BW + xx]; n++;
      }
      const c = block[by * BW + bx];
      mask[by * BW + bx] = c > 0.02 && c < 0.3 && sum / n < 0.27 ? 255 : 0;
    }
  }
  // one colour for the whole head of hair: the cards' own colours differ per card
  const mean = { r: 0, g: 0, b: 0 };
  let cnt = 0;
  for (let i = 0; i < d.length; i += 4 * 97) {
    const p = i / 4;
    if (d[i + 3] < 200 || (mask && !mask[Math.floor(Math.floor(p / W) / B) * BW + Math.floor((p % W) / B)])) continue;
    mean.r += lin(d[i]); mean.g += lin(d[i + 1]); mean.b += lin(d[i + 2]); cnt++;
  }
  mean.r /= cnt || 1; mean.g /= cnt || 1; mean.b /= cnt || 1;
  // uv (0,0) is the bottom-left of the image (textures are flipped on upload)
  const xy = (u, v) => [Math.floor(u * W), Math.floor((1 - v) * H)];
  return {
    mean,
    sample(u, v) {
      const [x, y] = xy(u, v), i = at(x, y);
      const a = mask ? (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[Math.floor(y / B) * BW + Math.floor(x / B)]) : d[i + 3];
      return { r: lin(d[i]), g: lin(d[i + 1]), b: lin(d[i + 2]), a: a / 255 };
    },
    // structure tensor over a 9x9 window; strands run perpendicular to the dominant gradient
    orientation(u, v) {
      const [x0, y0] = xy(u, v);
      let jxx = 0, jyy = 0, jxy = 0;
      if (x0 < 5 || y0 < 5 || x0 >= W - 5 || y0 >= H - 5) return null;
      for (let y = y0 - 4; y <= y0 + 4; y++) {
        for (let x = x0 - 4, i = y * W + x; x <= x0 + 4; x++, i++) {
          const gx = L[i + 1] - L[i - 1], gy = L[i + W] - L[i - W];
          jxx += gx * gx; jyy += gy * gy; jxy += gx * gy;
        }
      }
      if (jxx + jyy < 1e-6) return null;
      const theta = 0.5 * Math.atan2(2 * jxy, jxx - jyy); // gradient direction (image space, y down)
      const sx = -Math.sin(theta), sy = Math.cos(theta);   // perpendicular: along the strands
      return { x: sx, y: -sy }; // image y runs down, uv v runs up
    },
  };
}

function mulberry(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
