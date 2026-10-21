// Indoor light for a house lit by the sky: an irradiance volume baked when the house loads.
//
// Image-based lighting from the sky reaches every surface in the scene unobstructed, so inside a
// closed house ceilings came out black (they "see" the dark ground of the sky photo) and walls
// were lit as if outdoors. Here a grid of light probes is captured inside the house with a cube
// camera: the first pass sees only what comes in through the openings (sky, sunlit ground,
// sunlit floor patches), the second pass sees the rooms lit by the first, i.e. one more bounce.
// Each probe is stored as first-order spherical harmonics in three 3D textures (one per colour
// channel). Patched materials then take their ambient light inside the house from the volume
// and dim their sky reflections by the same ratio.
import * as THREE from 'three';

const GI_PARS_VERTEX = /* glsl */`
  varying vec3 vGiPos;
`;
const GI_POS_VERTEX = /* glsl */`
  vGiPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const GI_PARS_FRAGMENT = /* glsl */`
  varying vec3 vGiPos;
  uniform highp sampler3D giR, giG, giB;
  uniform sampler2D giMask;
  uniform vec3 giMin, giSize;
  // the ground floor's level, the height of a storey, and of a storey's middle probes above its floor
  uniform vec3 giStorey;
  uniform float giOn, giTop;
  // first-order SH irradiance with its directional part limited to 60% of the average: near a
  // ceiling lamp nearly all light comes from one side, and unclamped L1 then gives the ceiling
  // facing it negative light (black blotches around every lamp)
  float giEval(vec4 c, vec4 basis) {
    float l1 = length(c.yzw);
    c.yzw *= min(1.0, 0.6 * max(c.x, 0.0) / max(l1, 1e-5));
    return max(dot(c, basis), 0.0);
  }
`;
const GI_FRAGMENT = /* glsl */`
  {
    // inside the house's footprint and under its roof the volume applies (its top and bottom
    // levels reach up to the ceiling and down to the floor); outside, the open sky
    vec3 gp = (vGiPos - giMin) / giSize;
    vec2 edge = smoothstep(vec2(0.0), vec2(0.004), gp.xz) * smoothstep(vec2(0.0), vec2(0.004), 1.0 - gp.xz);
    // the mask holds the rooms of each storey in its own channel (up to four storeys)
    float st = clamp(floor((vGiPos.y - giStorey.x + 0.05) / giStorey.y), 0.0, 3.0);
    vec4 mk = texture2D(giMask, gp.xz);
    float w = giOn * edge.x * edge.y * step(vGiPos.y, giTop) * (st < 0.5 ? mk.r : st < 1.5 ? mk.g : st < 2.5 ? mk.b : mk.a);
    gp = clamp(gp, 0.0, 1.0);
    if (w > 0.0) {
      vec3 n = normalize((vec4(geometryNormal, 0.0) * viewMatrix).xyz);
      // ceilings take their light from the probes at mid-height: the top probes sit a few
      // centimetres below the lamps, whose direct light left a dark ring around every fitting
      if (n.y < -0.7) gp.y = min(gp.y, (giStorey.x + st * giStorey.y + giStorey.z - giMin.y) / giSize.y);
      vec4 basis = vec4(0.886227, 1.023328 * n.y, 1.023328 * n.z, 1.023328 * n.x);
      vec3 E = vec3(giEval(texture(giR, gp), basis), giEval(texture(giG, gp), basis), giEval(texture(giB, gp), basis));
      // a white ceiling reads white: the oak floors' warm bounce (the only light reaching it)
      // tinted every bedroom ceiling tan
      if (n.y < -0.7) E = mix(E, vec3(dot(E, vec3(0.2126, 0.7152, 0.0722))), 0.6);
      #if defined( USE_ENVMAP ) && defined( STANDARD ) && defined( ENVMAP_TYPE_CUBE_UV )
        float sky = max(dot(iblIrradiance, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
        float occ = clamp(dot(E, vec3(0.2126, 0.7152, 0.0722)) / sky, 0.0, 1.0);
        iblIrradiance = mix(iblIrradiance, E, w);
        // reflections of the sky are dimmed indoors; a capture of the room itself (mirrors,
        // glossy furniture: GI_LOCAL_ENV) already holds the room's own light
        #ifndef GI_LOCAL_ENV
          radiance *= mix(1.0, occ, w);
        #endif
      #else
        irradiance += E * w;
      #endif
    }
  }
`;

// the volume's uniforms, shared by every patched material
export function createLightVolume() {
  const empty = () => {
    const t = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1);
    t.type = THREE.HalfFloatType;
    t.needsUpdate = true;
    return t;
  };
  return {
    uniforms: {
      giR: { value: empty() }, giG: { value: empty() }, giB: { value: empty() },
      giMask: { value: new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1) },
      giMin: { value: new THREE.Vector3() }, giSize: { value: new THREE.Vector3(1, 1, 1) }, giStorey: { value: new THREE.Vector3(0, 1e4, 1) }, giOn: { value: 0 }, giTop: { value: 0 },
    },
  };
}

// patch a material (any MeshStandard / MeshPhysical, keeping its own onBeforeCompile) to read
// the volume
export function useLightVolume(material, volume) {
  if (material.userData.gi) return;
  material.userData.gi = true;
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    prev?.call(material, shader, renderer);
    Object.assign(shader.uniforms, volume.uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n' + GI_PARS_VERTEX)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + GI_POS_VERTEX);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GI_PARS_FRAGMENT)
      .replace('#include <lights_fragment_maps>', '#include <lights_fragment_maps>\n' + GI_FRAGMENT);
  };
  material.customProgramCacheKey = () => prevKey() + '|gi';
  material.needsUpdate = true;
}

export function useLightVolumeOn(object, volume) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    // glass is left out: its reflection of the sky is what makes a window read as glass from
    // outside, and the volume dimmed it to nothing on the house footprint
    for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial && m.name !== 'glass_clear') useLightVolume(m, volume);
  });
}

// Bake: probes on a grid through the house (cell centres, `spacing` apart, at `levels` heights
// above the ground floor: three per storey, evenly spaced). Probes inside a wall or a piece of
// furniture take their neighbours' light.
// opts.lamps: positions of ceiling lights that are on; they light the probes (neutral white, about 4000 K)
export async function bakeLightVolume(renderer, scene, house, volume, { spacing = 1.0, levels = [0.35, 1.4, 2.5], size = 24, passes = 2, hide = [], onProgress, cached, lamps = [], lampPower = 2.2 } = {}) {
  const b = house.bounds;
  const nx = Math.max(2, Math.round((b.maxX - b.minX) / spacing));
  const nz = Math.max(2, Math.round((b.maxZ - b.minZ) / spacing));
  const ny = levels.length;
  const sx = (b.maxX - b.minX) / nx, sz = (b.maxZ - b.minZ) / nz;
  const N = nx * ny * nz;
  const pos = [];
  const valid = new Uint8Array(N);
  const inside = (c, x, y, z, m) => x > c.minX - m && x < c.maxX + m && z > c.minZ - m && z < c.maxZ + m && y > c.bottom - m && y < c.top + m;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p = new THREE.Vector3(b.minX + (i + 0.5) * sx, b.floor + levels[j], b.minZ + (k + 0.5) * sz);
    const idx = i + j * nx + k * nx * ny;
    pos[idx] = p;
    // only probes in a room (not in a wall, a wardrobe, or the patio the house wraps around)
    valid[idx] = !house.roomAt(p.x, p.z, p.y) || house.obstacles.some((c) => inside(c, p.x, p.y, p.z, 0.04)) ? 0 : 1;
  }
  // where the volume applies: inside the rooms (5 cm cells, so walls' outer faces stay outdoors),
  // storey s in channel s; a single storey fills all four
  const storeys = house.storeys ?? 1;
  const MW = Math.ceil((b.maxX - b.minX) / 0.05), MH = Math.ceil((b.maxZ - b.minZ) / 0.05);
  const mask = new Uint8Array(MW * MH * 4);
  for (let r = 0; r < MH; r++) for (let c = 0; c < MW; c++) {
    const x = b.minX + (c + 0.5) * 0.05, z = b.minZ + (r + 0.5) * 0.05;
    if (storeys === 1) { if (house.roomAt(x, z)) mask.fill(255, (r * MW + c) * 4, (r * MW + c) * 4 + 4); continue; }
    for (let st = 0; st < Math.min(storeys, 4); st++) if (house.roomAt(x, z, house.floorOf(st))) mask[(r * MW + c) * 4 + st] = 255;
  }
  const maskTex = new THREE.DataTexture(mask, MW, MH);
  maskTex.needsUpdate = true;
  volume.uniforms.giMask.value = maskTex;
  // texture z = level so the volume's y axis maps to the levels (min/size below)
  const yMin = b.floor + levels[0], yMax = b.floor + levels[ny - 1];
  const dy = ny > 1 ? (yMax - yMin) / (ny - 1) : 1;
  volume.uniforms.giMin.value.set(b.minX, yMin - dy / 2, b.minZ);
  volume.uniforms.giSize.value.set(b.maxX - b.minX, dy * ny, b.maxZ - b.minZ);
  volume.uniforms.giTop.value = b.ceiling + 0.01;
  volume.uniforms.giStorey.value.set(b.floor, house.floorOf ? house.floorOf(1) - house.floorOf(0) : 1e4, levels[0] + dy);

  if (cached?.length === N * 12) {
    upload(volume, cached, nx, ny, nz);
    volume.uniforms.giOn.value = 1;
    return { probes: N, seconds: 0, coeffs: cached, cached: true };
  }
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
  const cube = new THREE.CubeCamera(0.03, 300, rt);
  const table = texelTable(size);
  const buffer = new Uint16Array(size * size * 4);
  scene.add(cube);
  // the sun's shadow map once, not again for each of the six faces of every probe
  const autoShadow = renderer.shadowMap.autoUpdate;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const hidden = hide.map((o) => [o, o.visible]);
  // the lamps exist only while baking: their light reaches the rooms through the volume
  const bulbs = lamps.map((p) => {
    const l = new THREE.PointLight(0xfff0de, lampPower, 0, 2);
    l.position.copy(p).y -= 0.08;
    scene.add(l);
    return l;
  });
  for (const [o] of hidden) o.visible = false;
  // pass 0 starts from an empty volume: inside the house, no sky light except through openings
  let coeffs = new Float32Array(N * 12);
  upload(volume, coeffs, nx, ny, nz);
  volume.uniforms.giOn.value = 1;
  const t0 = performance.now();
  for (let pass = 0; pass < passes; pass++) {
    const next = new Float32Array(N * 12);
    for (let idx = 0; idx < N; idx++) {
      if (!valid[idx]) continue;
      cube.position.copy(pos[idx]);
      cube.update(renderer, scene);
      projectL1(renderer, rt, table, buffer, next, idx * 12);
      if (idx % 40 === 0) { onProgress?.((pass + idx / N) / passes); await yieldToPage(); }
    }
    fillInvalid(next, valid, nx, ny, nz);
    coeffs = next;
    upload(volume, coeffs, nx, ny, nz);
  }
  for (const [o, v] of hidden) o.visible = v;
  for (const l of bulbs) { scene.remove(l); l.dispose(); }
  renderer.shadowMap.autoUpdate = autoShadow;
  scene.remove(cube);
  rt.dispose();
  return { probes: N, seconds: (performance.now() - t0) / 1000, coeffs };
}

// probes in walls: average of valid neighbours, repeated until every probe has a value
function fillInvalid(c, valid, nx, ny, nz) {
  const ok = valid.slice();
  for (let iter = 0; iter < 6; iter++) {
    let changed = false;
    const add = [];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const idx = i + j * nx + k * nx * ny;
      if (ok[idx]) continue;
      const sum = new Float32Array(12);
      let n = 0;
      for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const a = i + di, bj = j + dj, ck = k + dk;
        if (a < 0 || a >= nx || bj < 0 || bj >= ny || ck < 0 || ck >= nz) continue;
        const o = a + bj * nx + ck * nx * ny;
        if (!ok[o]) continue;
        for (let q = 0; q < 12; q++) sum[q] += c[o * 12 + q];
        n++;
      }
      if (n) { for (let q = 0; q < 12; q++) c[idx * 12 + q] = sum[q] / n; add.push(idx); changed = true; }
    }
    for (const idx of add) ok[idx] = 1;
    if (!changed) break;
  }
}

function upload(volume, c, nx, ny, nz) {
  // texture layout: width x, height y (levels), depth z
  for (const [ch, name] of [[0, 'giR'], [1, 'giG'], [2, 'giB']]) {
    const data = new Uint16Array(nx * ny * nz * 4);
    for (let idx = 0; idx < nx * ny * nz; idx++) {
      for (let q = 0; q < 4; q++) data[idx * 4 + q] = THREE.DataUtils.toHalfFloat(c[idx * 12 + q * 3 + ch]);
    }
    const t = new THREE.Data3DTexture(data, nx, ny, nz);
    t.type = THREE.HalfFloatType;
    t.format = THREE.RGBAFormat;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    volume.uniforms[name].value.dispose();
    volume.uniforms[name].value = t;
  }
}

// let the page paint the progress; a message port is not throttled in background tabs the way
// timers are
const channel = new MessageChannel();
const yieldToPage = () => new Promise((r) => { channel.port1.onmessage = r; channel.port2.postMessage(0); });

// per cube face texel: its direction's first-order SH basis times its solid angle weight
// (same conventions as three's LightProbeGenerator, WebGL coordinate system)
function texelTable(size) {
  const t = new Float32Array(6 * size * size * 4);
  const px = 2 / size;
  let total = 0;
  for (let f = 0; f < 6; f++) {
    for (let p = 0; p < size * size; p++) {
      const col = -(1 - ((p % size) + 0.5) * px);
      const row = 1 - (Math.floor(p / size) + 0.5) * px;
      let x, y, z;
      switch (f) {
        case 0: x = 1; y = row; z = -col; break;
        case 1: x = -1; y = row; z = col; break;
        case 2: x = col; y = 1; z = -row; break;
        case 3: x = col; y = -1; z = row; break;
        case 4: x = col; y = row; z = 1; break;
        default: x = -col; y = row; z = -1;
      }
      const l2 = x * x + y * y + z * z, l = Math.sqrt(l2);
      const w = 4 / (l * l2);
      total += w;
      const o = (f * size * size + p) * 4;
      t[o] = 0.282095 * w; t[o + 1] = 0.488603 * (y / l) * w; t[o + 2] = 0.488603 * (z / l) * w; t[o + 3] = 0.488603 * (x / l) * w;
    }
  }
  const norm = (4 * Math.PI) / total;
  for (let i = 0; i < t.length; i++) t[i] *= norm;
  return t;
}

// project the six faces of the cube target onto first-order SH (4 coefficients x RGB) into out
function projectL1(renderer, rt, table, buf, out, o) {
  const size = rt.width, n = size * size;
  out.fill(0, o, o + 12);
  const h = THREE.DataUtils.fromHalfFloat;
  for (let f = 0; f < 6; f++) {
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf, f);
    for (let p = 0; p < n; p++) {
      const r = h(buf[p * 4]), g = h(buf[p * 4 + 1]), b = h(buf[p * 4 + 2]);
      const ti = (f * n + p) * 4;
      for (let q = 0; q < 4; q++) {
        const w = table[ti + q];
        out[o + q * 3] += w * r; out[o + q * 3 + 1] += w * g; out[o + q * 3 + 2] += w * b;
      }
    }
  }
}
