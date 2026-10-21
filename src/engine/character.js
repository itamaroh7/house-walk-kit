import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { buildStrandHair } from './hair.js';
import { ktx2Loader } from './lib/load-model.js';

// Microsoft Rocketbox avatars (MIT). All share the 3ds Max Biped rig, so the
// Rocketbox animation files drive every avatar directly, without retargeting.
export const PLAYER_AVATAR = 'Male_Adult_01';
const CM = 0.01; // Rocketbox units are centimetres

// part of a Rocketbox material, i.e. its atlas quadrant: 0 body, 1 head, 2 opacity (hair, lashes)
function partOf(material) {
  const n = material.name.toLowerCase();
  return n.includes('opacity') ? 2 : n.includes('head') ? 1 : 0;
}

const fbx = new FBXLoader();
const tex = new THREE.TextureLoader();
const clipCache = new Map();
const fetchFbx = (path) => fbx.loadAsync('/models/rb/' + path);

export const genderOf = (name) => (name.includes('Female') ? 'f' : 'm');

// `load` maps a path under public/models/rb/ to a parsed FBX object (browser: fetch; bake tool: disk)
export async function loadAvatar(name, load = fetchFbx) {
  const root = await load(`${name}/${name}.fbx`);
  root.scale.setScalar(CM);
  let mesh = null;
  root.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
    // the FBX loader adds lights/cameras from the source scene; drop them
    if (o.isLight || o.isCamera) o.visible = false;
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root, true);
  return { name, root, mesh, gender: genderOf(name), height: box.max.y - box.min.y };
}

// Full-resolution, per-part PBR materials for the player character.
// opts.hairStrands: strand count for the grown hair (the hair module's default when unset)
export async function applyHiResMaterials(avatar, renderer, { hairStrands } = {}) {
  const dir = `/models/rb/${avatar.name}/`;
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  // a project that re-encoded these as KTX2 next to them (and called useKTX2 in
  // lib/load-model.js) gets those, which stay compressed on the GPU
  const load = async (file, srgb) => {
    const t = await (ktx2Loader() ? ktx2Loader().loadAsync(dir + file.replace(/\.\w+$/, '.ktx2')) : tex.loadAsync(dir + file));
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = aniso;
    return t;
  };
  const [bc, bn, br, hc, hn, hr, op] = await Promise.all([
    load('hi_body_color.jpg', true), load('hi_body_normal.jpg'), load('hi_body_rough.jpg'),
    load('hi_head_color.jpg', true), load('hi_head_normal.jpg'), load('hi_head_rough.jpg'),
    load('hi_opacity.webp', true),
  ]);
  const body = new THREE.MeshStandardMaterial({ map: bc, normalMap: bn, roughnessMap: br, roughness: 1, metalness: 0 });
  const head = new THREE.MeshStandardMaterial({ map: hc, normalMap: hn, roughnessMap: hr, roughness: 1, metalness: 0 });
  head.color.setRGB(0.93, 0.9, 0.9); // the scan's albedo reads slightly orange and hot in daylight
  // hair cards are flat quads: PBR Fresnel turns them into sky mirrors at grazing angles,
  // so hair gets diffuse shading plus its own strand highlight; their back faces (lit with
  // flipped normals) showed as pale streaks, so they are culled
  // plain alpha test: the frame has no MSAA (FXAA in post.js), and alpha-to-coverage without
  // MSAA turns into a checkerboard dither
  const hair = new THREE.MeshLambertMaterial({ map: op, alphaTest: 0.35 });
  avatar.hairCenter = addHairHighlight(hair);
  addSkinShading(head, true);
  addSkinShading(body); // no gloss curve: it made cotton and khaki look plasticky
  // ambient occlusion baked offline for this mesh's vertex order (shipped in the asset pack)
  const ao = new Uint8Array(await (await fetch('/models/crowd/player_ao.bin')).arrayBuffer());
  if (ao.length === avatar.mesh.geometry.attributes.position.count) {
    avatar.mesh.geometry.setAttribute('ao', new THREE.BufferAttribute(ao, 1, true));
    // weaker on the head: the collar's occlusion drew a dark band around the neck
    withVertexAO(head, 0.5);
    withVertexAO(body, 0.85);
  }
  const mats = [body, head, hair];
  const src = [].concat(avatar.mesh.material);
  // strands grown over the photographed hair on the head and over the fringe cards; both stay
  // underneath as the base layer. Growing them takes about a second, so the game does not wait:
  // they appear on the head shortly after the start.
  buildStrandHair(avatar, avatar.root.getObjectByName('Bip01_Head'), src,
    { 1: dir + 'hi_head_color.jpg', 2: dir + 'hi_opacity.webp' }, partOf, hairStrands).then((s) => { avatar.strands = s; });
  avatar.mesh.material = src.map((m) => mats[partOf(m)]);
  avatar.mesh.castShadow = true;
  avatar.mesh.receiveShadow = true;
  avatar.mesh.frustumCulled = false;
}

// Cheap skin: wrap lighting with a warm tint where light fades out, which is the visual
// signature of subsurface scattering (light bleeding red into the shadow terminator).
// Define SKIN_WRAP_SHADOW on a material whose body casts no sun shadow (so the map holds only
// other occluders) to fade the wrap where the sun is blocked: indoors it otherwise glowed red.
export const SKIN_FRAGMENT = /* glsl */`#include <lights_fragment_end>
  {
    float skinMask = smoothstep(0.05, 0.25, diffuseColor.r - diffuseColor.b) * smoothstep(0.15, 0.35, diffuseColor.r);
    #if NUM_DIR_LIGHTS > 0
      vec3 L = directionalLights[0].direction;
      float ndl = dot(normal, L);
      float wrap = max(0.0, (ndl + 0.45) / 1.45) - max(0.0, ndl);
      #if defined( SKIN_WRAP_SHADOW ) && defined( USE_SHADOWMAP ) && NUM_DIR_LIGHT_SHADOWS > 0
        DirectionalLightShadow skinShadow = directionalLightShadows[0];
        wrap *= getShadow(directionalShadowMap[0], skinShadow.shadowMapSize, skinShadow.shadowIntensity, skinShadow.shadowBias, skinShadow.shadowRadius, vDirectionalShadowCoord[0]);
      #endif
      reflectedLight.directDiffuse += skinMask * wrap * directionalLights[0].color * diffuseColor.rgb * vec3(0.55, 0.18, 0.1);
    #endif
  }`;

// glossCurve: square the scanned roughness (from the specular maps) so the bright-spec areas
// get glossier: skin ~0.65 -> ~0.5 (a soft sheen), eyes ~0.32 -> ~0.13 (a sky reflection,
// the glint that makes eyes look alive), cloth stays matte.
export function addSkinShading(material, glossCurve = false) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', SKIN_FRAGMENT);
    if (glossCurve) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', /* glsl */`#include <common>
          float poreHash(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }`)
        .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = roughness;
        #ifdef USE_ROUGHNESSMAP
          float texRough = texture2D(roughnessMap, vRoughnessMapUv).g;
          roughnessFactor *= min(1.0, texRough * texRough * 1.25);
          // pores: fine noise in roughness breaks the skin's sheen into tiny points, like real
          // skin; it fades out where it would alias (when a texel is smaller than a pixel)
          vec2 pp = vRoughnessMapUv * 1400.0;
          float fade = 1.0 - smoothstep(0.6, 1.6, length(fwidth(pp)));
          roughnessFactor = clamp(roughnessFactor * (1.0 + (poreHash(floor(pp)) - 0.5) * 0.35 * fade), 0.05, 1.0);
        #endif`)
        // the scanned skin reads a little too saturated next to the photo
        .replace('#include <map_fragment>', /* glsl */`#include <map_fragment>
          diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), diffuseColor.rgb, 0.9);
          // the whites of the eyes (and teeth) are painted nearly paper white; real sclera is
          // greyer and slightly shadowed by the lids
          {
            float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            float sat = max(diffuseColor.r, max(diffuseColor.g, diffuseColor.b)) - min(diffuseColor.r, min(diffuseColor.g, diffuseColor.b));
            diffuseColor.rgb *= 1.0 - 0.22 * smoothstep(0.45, 0.65, lum) * (1.0 - smoothstep(0.06, 0.16, sat));
          }`);
    }
  };
  material.userData.shading = glossCurve ? 'skin-gloss' : 'skin';
}

// multiplies the albedo by a per-vertex 'ao' attribute, on top of a material's own onBeforeCompile
function withVertexAO(material, strength) {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    prev?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ao;\nvarying float vAO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = ao;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAO;')
      .replace('#include <map_fragment>', `#include <map_fragment>\ndiffuseColor.rgb *= mix(1.0, vAO, ${strength.toFixed(2)});`);
  };
  // head and body compile different shaders (gloss curve, AO strength): each needs its own key,
  // or three.js reuses whichever program it built first for both
  const key = `player-ao-${material.userData.shading ?? ''}-${strength}`;
  material.customProgramCacheKey = () => key;
}

// Kajiya-Kay strand highlight for hair cards. The strand direction is the card's texture
// v-axis, recovered per pixel from screen-space derivatives (no tangent attribute needed).
// Two lobes like real hair: a white one shifted toward the tip and a dimmer tinted one
// shifted toward the root.
//
// Hair cards are separate flat strips, each facing its own way, so per-card normals shade them
// like overlapping plates. The normal is mostly replaced by the direction from the centre of
// the head (updated by the player every frame), which shades the hair as one soft volume.
// Returns that centre uniform.
function addHairHighlight(material) {
  const headCenter = { value: new THREE.Vector3() };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.headCenter = headCenter;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairWorld;')
      .replace('#include <skinning_vertex>', '#include <skinning_vertex>\nvHairWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairWorld;\nuniform vec3 headCenter;')
      .replace('#include <normal_fragment_begin>', /* glsl */`#include <normal_fragment_begin>
        normal = normalize(mix(normal, normalize((viewMatrix * vec4(vHairWorld - headCenter, 0.0)).xyz), 0.75));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', /* glsl */`#include <lights_fragment_end>
      #if NUM_DIR_LIGHTS > 0
      {
        vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
        vec2 st0 = dFdx(vMapUv), st1 = dFdy(vMapUv);
        vec3 q1perp = cross(q1, normal), q0perp = cross(normal, q0);
        vec3 strand = q1perp * st0.y + q0perp * st1.y;
        float sl = length(strand);
        if (sl > 1e-8) {
          strand /= sl;
          vec3 L = directionalLights[0].direction;
          vec3 V = normalize(vViewPosition);
          vec3 H = normalize(L + V);
          vec3 t1 = normalize(strand + normal * 0.12), t2 = normalize(strand - normal * 0.1);
          float d1 = dot(t1, H), d2 = dot(t2, H);
          float s1 = pow(max(0.0, sqrt(max(0.0, 1.0 - d1 * d1))), 280.0);
          float s2 = pow(max(0.0, sqrt(max(0.0, 1.0 - d2 * d2))), 60.0);
          // flat cards are perpendicular to H over large areas; keep the band where the card
          // actually faces the light and the eye, as on a real head of hair
          float facing = smoothstep(-0.1, 0.3, dot(normal, L)) * smoothstep(0.2, 0.7, dot(normal, H));
          vec3 spec = (s1 * 0.035 + s2 * 0.035 * diffuseColor.rgb * 3.0) * facing;
          reflectedLight.directDiffuse += spec * directionalLights[0].color;
        }
      }
      #endif`);
  };
  return headCenter;
}

// idle, walk, run and conversation clips for one gender; root motion is measured (stride-matched speed) then removed.
// A list means variants: entry k % length for avatar k. An entry is either one file for both
// genders or { m, f }; 'file@s' starts the clip s seconds in. The walker here uses
// HERO_CLIP_FILES (idle_neutral_01, walk_neutral_01, run_neutral_01: the files in the asset pack).
export const CLIP_FILES = {
  idle: [{ m: 'idle_neutral_08@21', f: 'idle_neutral_06@4' }, { m: 'idle_waiting_01@10', f: 'idle_waiting_01@15' }],
  idle2: [{ m: 'idle_neutral_05@24', f: 'idle_neutral_07@1' }, { m: 'idle_neutral_07@7', f: 'idle_neutral_09' }],
  idle3: [{ m: 'idle_neutral_08@2', f: 'idle_waiting_01@24' }, { m: 'idle_neutral_08@32', f: 'idle_neutral_06@21' }],
  walk: ['walk_neutral_01', 'walk_neutral_02'], run: 'run_neutral_01',
  talk: [{ m: 'gestic_talk_neutral_03@31', f: 'gestic_talk_neutral_03@15' }, { m: 'gestic_talk_relaxed_01@17', f: 'gestic_talk_neutral_01@5' }],
  listen: [{ m: 'gestic_listen_neutral_03@4', f: 'gestic_listen_relaxed_01@13' }, { m: 'gestic_listen_neutral_03@22', f: 'gestic_listen_relaxed_01@1' }],
  // aim and die start from a calm idle; a set's pose layer turns them into the real poses
  aim: 'idle_neutral_01', die: 'idle_neutral_01',
};
// the player stands still in a calm idle that loops over its full length
export const HERO_CLIP_FILES = { ...CLIP_FILES, idle: 'idle_neutral_01' };

export async function loadClips(gender, names = ['idle', 'walk', 'run'], load = fetchFbx, variant = 0, files = CLIP_FILES) {
  const key = gender + names.join() + variant + (files === CLIP_FILES ? '' : 'hero');
  if (clipCache.has(key)) return clipCache.get(key);
  const p = (async () => {
    const entries = await Promise.all(names.map(async (k) => {
      const f = [].concat(files[k]);
      const entry = f[variant % f.length];
      const [file, start] = (typeof entry === 'string' ? entry : entry[gender]).split('@');
      let clip = (await load(`anims/${gender}_${file}.fbx`)).animations[0];
      if (start) clip = THREE.AnimationUtils.subclip(clip, k, Math.round(+start * 30), Math.round(clip.duration * 30), 30);
      return [k, cleanClip(clip, k)];
    }));
    const clips = Object.fromEntries(entries.map(([k, v]) => [k, v.clip]));
    const gait = {
      walk: { speed: entries.find((e) => e[0] === 'walk')[1].speed, duration: clips.walk.duration },
      run: { speed: entries.find((e) => e[0] === 'run')[1].speed, duration: clips.run.duration },
    };
    return { clips, gait };
  })();
  clipCache.set(key, p);
  return p;
}

function cleanClip(clip, name) {
  const tracks = [];
  let speed = 0;
  for (const t of clip.tracks) {
    const [node, prop] = splitTrack(t.name);
    if (node.includes('Footsteps') || prop === 'scale') continue;
    if (prop === 'position' && node !== 'Bip01') continue; // bone lengths differ per avatar
    if (prop === 'position') {
      const v = t.values, n = v.length / 3;
      const dx = v[(n - 1) * 3] - v[0], dz = v[(n - 1) * 3 + 2] - v[2];
      const dur = t.times[n - 1] - t.times[0];
      speed = (Math.hypot(dx, dz) / Math.max(dur, 1e-3)) * CM;
      // remove the straight-line travel, keep the natural side-to-side and bounce
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < n; i++) {
        const f = (t.times[i] - t.times[0]) / Math.max(dur, 1e-3);
        v[i * 3] -= x0 + dx * f;
        v[i * 3 + 2] -= z0 + dz * f;
      }
    }
    tracks.push(t);
  }
  return { clip: new THREE.AnimationClip(name, clip.duration, tracks), speed };
}

function splitTrack(name) {
  const i = name.lastIndexOf('.');
  return [name.slice(0, i), name.slice(i + 1)];
}

// Phase (0..1) where the left foot is lowest, used to keep walk and run in step when blending.
export function leftFootPhase(avatar, clip) {
  const mixer = new THREE.AnimationMixer(avatar.root);
  const action = mixer.clipAction(clip).play();
  const toe = avatar.root.getObjectByName('Bip01_L_Toe0');
  const p = new THREE.Vector3();
  let best = 0, lowest = Infinity;
  for (let i = 0; i < 60; i++) {
    mixer.setTime((i / 60) * clip.duration);
    avatar.root.updateMatrixWorld(true);
    toe.getWorldPosition(p);
    if (p.y < lowest) { lowest = p.y; best = i / 60; }
  }
  action.stop();
  mixer.uncacheRoot(avatar.root);
  return best;
}
