// Runtime loader for the library's surface materials (public/library/materials/<id>/).
// Copy this file with the material folders into a project; it needs three.js only.
//
//   const floor = await loadLibraryMaterial('/library', 'floor_oak');
//   mesh.material = floor;    // the geometry's UVs must be in metres (u along, v up/across)
//
// Each material repeats once per meta.size metres. Tiled materials (meta.grout) get their joints
// drawn in the shader, and every tile shows a different part of the texture with a slightly
// different shade, the way real slabs differ from one another.
import * as THREE from 'three';
import { ktx2Loader } from './load-model.js';

const loader = new THREE.TextureLoader();
const cache = new Map();
let indexPromise = null;

// a .ktx2 image (a project's re-encoded copy, see useKTX2 in load-model.js) arrives compressed;
// it was flipped when encoded, as the GPU cannot flip a compressed image on upload
async function texture(url, colorSpace, size, aniso) {
  const t = url.endsWith('.ktx2') ? await ktx2Loader().loadAsync(url) : loader.load(url);
  t.colorSpace = colorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / size[0], 1 / size[1]);
  t.anisotropy = aniso;
  return t;
}

const SURFACE = /* glsl */`
  uniform vec2 tileSize;
  uniform vec2 grout;
  uniform vec3 groutColor;
  uniform float tileVariation, grime;
  float gHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float gNoise2(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
  }
`;
// Tiles: each one shows its own window into the texture with its own shade, and the joints
// are drawn (grout: tile width and height in metres). Weathering (grime): outside walls darken
// toward the ground where splashes and dust collect, in large soft blotches.
const SURFACE_MAP = /* glsl */`
  vec2 metres = vMapUv * tileSize;
  #ifdef TILED
    vec2 cell = floor(metres / grout);
    vec2 jitter = vec2(gHash(cell), gHash(cell + 17.3));
    vec4 sampledDiffuseColor = texture2D(map, vMapUv + jitter);
    diffuseColor *= sampledDiffuseColor;
    diffuseColor.rgb *= 1.0 - tileVariation * 0.5 + tileVariation * gHash(cell + 3.1);
    vec2 f = abs(fract(metres / grout + 0.5) - 0.5) * grout;   // distance to the nearest joint, m
    float w = 0.0015 + fwidth(metres.x) * 0.5;
    float joint = 1.0 - smoothstep(w, w + max(fwidth(metres.x), 1e-4), min(f.x, f.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, groutColor * 0.5, joint);
  #else
    #include <map_fragment>
  #endif
  #ifdef WEATHERED
    // vertical faces carry height in v (metreUVs); on floors and roofs this stays faint
    float blotch = gNoise2(metres * vec2(0.6, 1.4)) * 0.6 + gNoise2(metres * 2.3 + 5.1) * 0.4;
    float base = 1.0 - smoothstep(0.0, 0.9, metres.y);
    diffuseColor.rgb *= 1.0 - grime * (0.55 * base + 0.18 * blotch * (0.4 + 0.6 * base));
  #endif
`;

// opts.anisotropy: texture filtering (default 8)
export async function loadLibraryMaterial(base, id, { anisotropy = 8 } = {}) {
  const key = `${base}|${id}`;
  if (cache.has(key)) return cache.get(key);
  const promise = (async () => {
    indexPromise ??= fetch(`${base}/materials/index.json`).then((r) => r.json());
    const entry = (await indexPromise).materials.find((m) => m.id === id);
    if (!entry) throw new Error(`no library material ${id}`);
    if (!entry.maps) {
      const params = { color: new THREE.Color().setRGB(...entry.color, THREE.LinearSRGBColorSpace), roughness: entry.roughness, metalness: entry.metalness };
      if (entry.transmission) {
        return new THREE.MeshPhysicalMaterial({ ...params, transparent: true, opacity: entry.opacity ?? 0.2, depthWrite: false, side: THREE.DoubleSide, envMapIntensity: 1.5 });
      }
      return new THREE.MeshStandardMaterial(params);
    }
    const dir = `${base}/materials/${id}`;
    const meta = await fetch(`${dir}/meta.json`).then((r) => r.json());
    const [orm, map, normalMap] = await Promise.all([
      texture(`${dir}/${meta.maps.orm}`, THREE.NoColorSpace, meta.size, anisotropy),
      texture(`${dir}/${meta.maps.color}`, THREE.SRGBColorSpace, meta.size, anisotropy),
      texture(`${dir}/${meta.maps.normal}`, THREE.NoColorSpace, meta.size, anisotropy),
    ]);
    const mat = new THREE.MeshStandardMaterial({ map, normalMap, roughnessMap: orm, aoMap: orm, roughness: meta.roughness, metalness: 1 });
    // metalness comes from the ORM blue channel; sets without a metal map have it black
    mat.metalnessMap = orm;
    mat.color.setRGB(...meta.tint, THREE.LinearSRGBColorSpace);
    mat.normalScale.setScalar(meta.normalScale ?? 1);
    mat.name = id;
    mat.userData.meta = meta;
    if (meta.grout || meta.grime) {
      const grout = [].concat(meta.grout ?? 1);
      mat.defines = { ...(meta.grout ? { TILED: '' } : {}), ...(meta.grime ? { WEATHERED: '' } : {}) };
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.tileSize = { value: new THREE.Vector2(...meta.size) };
        shader.uniforms.grout = { value: new THREE.Vector2(grout[0], grout[1] ?? grout[0]) };
        shader.uniforms.groutColor = { value: new THREE.Color().setRGB(...(meta.groutColor ?? [0.5, 0.5, 0.5]), THREE.LinearSRGBColorSpace) };
        shader.uniforms.tileVariation = { value: meta.tileVariation ?? 0.12 };
        shader.uniforms.grime = { value: meta.grime ?? 0 };
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\n' + SURFACE)
          .replace('#include <map_fragment>', SURFACE_MAP);
      };
      mat.customProgramCacheKey = () => `surface-${id}`;
    }
    return mat;
  })();
  cache.set(key, promise);
  return promise;
}

// Box-projected UVs in metres for a world-placed geometry: each face takes the two axes it is
// most perpendicular to, so a tiled material keeps its real size on walls, floors and ceilings.
export function metreUVs(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.attributes.position, n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (ay >= ax && ay >= az) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
    else if (ax >= az) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
    else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
