// Runtime loader for models in the library (public/library/<category>/<id>/).
// Copy this file together with the model folders into a game; it needs three.js only.
//
//   const lod = await loadLibraryModel('/library/interior/sofa_modern');
//   scene.add(lod);              // a THREE.LOD: full detail near, simplified levels farther away
//
// The files are meshopt-compressed glTF, three levels of detail each (meta.json lists them).
// A project may re-encode them as KTX2 (Basis Universal), which stays compressed on the GPU; it
// then calls useKTX2(renderer) once before loading anything.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const metaCache = new Map();
let ktx2 = null;

// KTX2 textures need the renderer to choose the GPU format to transcode to, and the Basis
// transcoder (three/examples/jsm/libs/basis) served at transcoderPath
export function useKTX2(renderer, transcoderPath = '/basis/') {
  ktx2 ??= new KTX2Loader().setTranscoderPath(transcoderPath).detectSupport(renderer);
  loader.setKTX2Loader(ktx2);
  return ktx2;
}
export const ktx2Loader = () => ktx2;

// The models embed the library's shared surfaces (steel, oak, the fabrics...), so the same image
// arrives inside many files, and every LOD level carries its own smaller copy. Each material is
// pointed at one shared texture instead: the farther levels use the near level's, and a texture
// made from a library file (named by its path) uses the first one loaded from that file at that
// size and with the same sampling. Each image is then decoded and uploaded once. (Whole textures
// are shared, not just their images: a compressed texture keeps its data on the texture.)
const SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap'];
const sharedTextures = new Map();
const sampling = (t) => [t.wrapS, t.wrapT, t.flipY, t.colorSpace, t.channel, t.repeat.x, t.repeat.y, t.offset.x, t.offset.y, t.rotation].join();

function shareTextures(levels) {
  const near = new Map(), replaced = new Map();
  levels.forEach((gltf, i) => gltf.scene.traverse((o) => {
    for (const m of o.isMesh ? [].concat(o.material) : []) {
      for (const slot of SLOTS) {
        const t = m[slot];
        if (!t?.isTexture) continue;
        const key = `${m.name}|${slot}`;
        let use = replaced.get(t);
        if (!use && i > 0 && near.has(key) && sampling(near.get(key)) === sampling(t)) use = near.get(key);
        if (!use && /[\\/].+\.\w+$/.test(t.name) && t.image?.width) {
          const file = `${t.name}|${t.image.width}x${t.image.height}|${sampling(t)}`;
          if (sharedTextures.has(file)) use = sharedTextures.get(file);
          else sharedTextures.set(file, t);
        }
        if (use && use !== t) { replaced.set(t, use); m[slot] = use; }
        if (i === 0 && !near.has(key)) near.set(key, m[slot]);
      }
    }
  }));
}

export async function loadLibraryMeta(dir) {
  if (!metaCache.has(dir)) metaCache.set(dir, fetch(`${dir}/meta.json`).then((r) => r.json()));
  return metaCache.get(dir);
}

// Switch distances grow with the model's size: a level changes when the model covers about
// the same share of the screen, whatever it is (a pistol switches at a few metres, a building
// at a few hundred).
export function lodDistances(meta) {
  const size = Math.max(...meta.size, 0.05);
  return [0, size * 8, size * 25];
}

// Images can be scaled down as they load, before anything is shared or uploaded (a quarter of the
// memory for each halving): a small model (a chair, a lamp, a vase) rarely fills enough of the
// screen to show more than 512 texels across, and bump, roughness and occlusion maps do not show
// their detail the way the colour does. (WebP images only: KTX2 ones are sized when encoded.)
const COLOUR = new Set(['map', 'emissiveMap', 'alphaMap']);

async function capTextures(gltf, colourCap, detailCap) {
  const done = new Set();
  const jobs = [];
  gltf.scene.traverse((o) => {
    for (const m of o.isMesh ? [].concat(o.material) : []) {
      for (const slot of SLOTS) {
        const source = m[slot]?.source, img = source?.data;
        const cap = COLOUR.has(slot) ? colourCap : detailCap;
        if (!cap || !(img instanceof ImageBitmap) || done.has(source) || Math.max(img.width, img.height) <= cap) continue;
        done.add(source);
        const s = cap / Math.max(img.width, img.height);
        jobs.push(createImageBitmap(img, {
          resizeWidth: Math.round(img.width * s), resizeHeight: Math.round(img.height * s), resizeQuality: 'high',
          premultiplyAlpha: 'none', colorSpaceConversion: 'none',
        }).then((small) => { source.data = small; img.close(); }));
      }
    }
  });
  await Promise.all(jobs);
}

// opts.maxTexture: the largest colour image side for the near level (0 = as shipped);
// opts.maxSmallTexture: the same for models under 1.5 m; opts.maxDetailTexture: the same for the
// bump, roughness and occlusion maps
export async function loadLibraryModel(dir, { shadows = true, maxTexture = 0, maxSmallTexture = 0, maxDetailTexture = 0 } = {}) {
  const meta = await loadLibraryMeta(dir);
  const levels = await Promise.all(meta.lods.map((l) => loader.loadAsync(`${dir}/${l.file}`)));
  const cap = (Math.max(...meta.size) < 1.5 && maxSmallTexture) || maxTexture;
  if (cap || maxDetailTexture) await capTextures(levels[0], cap, maxDetailTexture);
  shareTextures(levels);
  const lod = new THREE.LOD();
  const dist = lodDistances(meta);
  levels.forEach((gltf, i) => {
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = shadows;
      o.receiveShadow = shadows;
    });
    lod.addLevel(gltf.scene, dist[i] ?? dist[dist.length - 1] * 2);
  });
  lod.name = meta.id;
  lod.userData.meta = meta;
  return lod;
}
