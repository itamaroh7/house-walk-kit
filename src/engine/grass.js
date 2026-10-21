import * as THREE from 'three';
import { GROUND_SIZE, GROUND_MAP_FRAGMENT, GROUND_NOISE, LAWN, LAWN_TINT } from './world.js';

// Real 3D lawn blades around the camera, so feet sink into the grass instead of standing on
// a flat carpet. Cheap by construction:
//  - one instanced draw of small patches (120 single-triangle blades each), no alpha testing
//  - the patch grid wraps around the camera in the vertex shader: no CPU work per frame
//  - blades take their colour from the ground texture at their own world position and are
//    lit with the ground's (upward) normal, so they blend into the ground seamlessly
//  - blades shrink to nothing toward RADIUS, so there is no visible edge
const PATCH = 0.5;     // metres per patch side
const GRID = 30;       // patches per side (15 m x 15 m)
const RADIUS = 7;      // blades fade out by this distance from the camera
const BLADES = 120;

// opts.exclude: rectangles [x0, z0, x1, z1] where no blades grow (buildings, decks, paths); any
// number, the MAX_EXCLUDE nearest the camera are used each frame (blades only grow near it)
const MAX_EXCLUDE = 8;
export function createGrass(groundMaterial, { exclude = [] } = {}) {
  const patch = bladePatch();
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = patch.index;
  for (const k of ['position', 'normal', 'blade']) geo.setAttribute(k, patch.attributes[k]);
  const offsets = new Float32Array(GRID * GRID * 2);
  for (let i = 0; i < GRID * GRID; i++) {
    offsets[i * 2] = ((i % GRID) - GRID / 2) * PATCH;
    offsets[i * 2 + 1] = (Math.floor(i / GRID) - GRID / 2) * PATCH;
  }
  geo.setAttribute('patchOffset', new THREE.InstancedBufferAttribute(offsets, 2));
  geo.instanceCount = GRID * GRID;

  const g = groundMaterial;
  // the ground gets extra sunlight for its (implied) blades in world.js; these real blades
  // catch it themselves, so they take a lighter tint instead to match the ground around them
  const mat = new THREE.MeshStandardMaterial({ map: g.map, roughness: 0.95, metalness: 0, color: g.color.clone().multiply(new THREE.Color(1.35, 1.2, 1.35)), side: THREE.DoubleSide });
  const rects = Array.from({ length: MAX_EXCLUDE }, (_, i) => new THREE.Vector4(...(exclude[i] ?? [0, 0, 0, 0])));
  // distance from a point to a rectangle (0 inside)
  const gap = ([x0, z0, x1, z1], x, z) => Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
  let lastX = Infinity, lastZ = Infinity;
  const uniforms = { camXZ: { value: new THREE.Vector2() }, time: { value: 0 }, exclude: { value: rects }, lawnRect: LAWN, lawnTint: LAWN_TINT };
  const repeat = g.map.repeat.x / GROUND_SIZE; // texture repeats per metre on the ground plane
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`#include <common>
        attribute vec2 patchOffset;
        attribute vec4 blade;     // height factor 0 (root) .. 1 (tip), random, unused, unused
        uniform vec2 camXZ;
        uniform float time;
        uniform vec4 exclude[${MAX_EXCLUDE}];
        varying float vBlade;`)
      .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vec3(0.0, 1.0, 0.0);')
      .replace('#include <begin_vertex>', /* glsl */`
        // wrap the patch grid around the camera, snapped to whole patches
        vec2 base = floor(camXZ / ${PATCH.toFixed(2)}) * ${PATCH.toFixed(2)} + patchOffset;
        vec3 transformed = position;
        transformed.xz += base;
        float d = length(transformed.xz - camXZ);
        float grow = smoothstep(${RADIUS.toFixed(1)}, ${(RADIUS * 0.55).toFixed(2)}, d);
        float wind = sin(time * 1.6 + transformed.x * 0.7 + transformed.z * 0.4) * 0.008 + sin(time * 3.1 + transformed.z * 2.3) * 0.003;
        for (int i = 0; i < ${MAX_EXCLUDE}; i++) {
          vec4 r = exclude[i];
          if (transformed.x > r.x && transformed.x < r.z && transformed.z > r.y && transformed.z < r.w) grow = 0.0;
        }
        transformed.y *= grow;
        transformed.xz += wind * blade.x * blade.x * vec2(1.0, 0.6);
        vBlade = blade.x;`)
      .replace('#include <uv_vertex>', /* glsl */`#include <uv_vertex>
        vMapUv = vec2(0.0);`)
      .replace('#include <worldpos_vertex>', /* glsl */`#include <worldpos_vertex>
        // same texture coordinates as the ground at this spot (plane UVs are world xz / size)
        vMapUv = vec2(transformed.x * ${repeat.toFixed(4)} + ${(g.map.repeat.x * 0.5).toFixed(1)}, -transformed.z * ${repeat.toFixed(4)} + ${(g.map.repeat.y * 0.5).toFixed(1)});`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBlade;\n' + GROUND_NOISE)
      // both faces of a blade use the ground's upward normal (no dark flipped back faces)
      .replace('#include <normal_fragment_begin>', 'vec3 normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);\nvec3 nonPerturbedNormal = normal;')
      .replace('#include <map_fragment>', GROUND_MAP_FRAGMENT + /* glsl */`
        // blades: greener toward the tip, darker at the root (occlusion inside the lawn)
        diffuseColor.rgb *= mix(0.8, 1.15, vBlade);
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.85, 1.12, 0.7), vBlade * 0.6);`);
  };
  mat.customProgramCacheKey = () => 'grass';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return {
    mesh,
    update(camera, time) {
      const { x, z } = camera.position;
      uniforms.camXZ.value.set(x, z);
      if (exclude.length > MAX_EXCLUDE && Math.hypot(x - lastX, z - lastZ) > 0.5) {
        lastX = x; lastZ = z;
        const near = exclude.map((r) => [gap(r, x, z), r]).sort((a, b) => a[0] - b[0]);
        for (let i = 0; i < MAX_EXCLUDE; i++) rects[i].set(...near[i][1]);
      }
      uniforms.time.value = time;
    },
  };
}

// BLADES tapered single-triangle blades scattered over one PATCH x PATCH square
function bladePatch() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pos = [], nor = [], bl = [];
  for (let b = 0; b < BLADES; b++) {
    const x = rnd() * PATCH, z = rnd() * PATCH, a = rnd() * Math.PI;
    const w = 0.0025 + rnd() * 0.003, h = 0.025 + rnd() * 0.04;
    const lean = 0.008 + rnd() * 0.02, la = rnd() * Math.PI * 2;
    const cx = Math.cos(a) * w, cz = Math.sin(a) * w;
    pos.push(x - cx, 0, z - cz, x + cx, 0, z + cz, x + Math.cos(la) * lean, h, z + Math.sin(la) * lean);
    for (let k = 0; k < 3; k++) nor.push(0, 1, 0);
    const r = rnd();
    bl.push(0, r, 0, 0, 0, r, 0, 0, 1, r, 0, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('blade', new THREE.Float32BufferAttribute(bl, 4));
  g.setIndex([...Array(BLADES * 3).keys()]);
  return g;
}
