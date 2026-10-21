// House Walk: a house assembled from a plan out of the model library, lit by a real sky, to walk
// around and through as the library's animated character (third person) or with your own eyes
// (first person, V). Doors open and close with E.
// ?gpumem: count the GPU allocations (window.__gpuMemory()); loaded before the renderer
import './engine/lib/gpu-memory.js';
import * as THREE from 'three';
import { createWorld } from './engine/world.js';
import { createPost } from './engine/post.js';
import { createGrass } from './engine/grass.js';
import { loadAvatar, loadClips, applyHiResMaterials, genderOf, PLAYER_AVATAR, HERO_CLIP_FILES } from './engine/character.js';
import { Player } from './engine/player.js';
import { createGpuTimer } from './engine/lib/gpu-timer.js';
import { releaseTextureMemory } from './engine/lib/texture-memory.js';
import { useKTX2 } from './engine/lib/load-model.js';
import { buildHouse } from './house/build.js';
import { createWalkerShadow } from './house/walker-shadow.js';
import { createLightVolume, useLightVolumeOn, bakeLightVolume } from './house/gi.js';
import { createTouchControls, isTouchDevice } from './touch.js';
import { createDimensions } from './house/dimensions.js';
import { bakeKey, bakeFile } from './house/bake-key.js';
import { t, local } from './i18n.js';

// every plan file in src/plans (each exports makePlan(...)), offered in the picker in the corner
// and chosen with ?plan=<id>; each keeps its own light bake
const PLANS = Object.fromEntries(Object.values(import.meta.glob('./plans/*.js', { eager: true }))
  .map((m) => m.default).filter((p) => p?.rooms).map((p) => [p.id, p]));
const params = new URLSearchParams(location.search);
const planId = PLANS[params.get('plan')] ? params.get('plan') : PLANS.example ? 'example' : Object.keys(PLANS)[0];
const planPick = document.getElementById('plan-pick');
if (planPick) {
  for (const [id, p] of Object.entries(PLANS)) planPick.add(new Option(local(p.name), id));
  planPick.value = planId;
  planPick.hidden = Object.keys(PLANS).length < 2;
  planPick.addEventListener('change', () => {
    params.set('plan', planPick.value);
    location.search = params.toString();
  });
}
const drawn = PLANS[planId];
// the plan with its names in the page's language (names may be given per language)
const plan = { ...drawn, name: local(drawn.name), rooms: drawn.rooms.map((r) => ({ ...r, name: local(r.name) })) };
// a plan the kit found problems in still loads, with the list on screen
if (drawn.problems?.length) {
  const box = document.getElementById('problems');
  box.innerHTML = `<b>${t('problems')}</b><ul>${drawn.problems.map((p) => `<li dir="auto">${p.replace(/</g, '&lt;')}</li>`).join('')}</ul>`;
  box.hidden = false;
  console.warn(`plan ${drawn.id}:\n${drawn.problems.join('\n')}`);
}
// without the asset pack (public/library, public/models) there is nothing to build with
if (!(await fetch('/library/materials/index.json').then((r) => r.ok && r.headers.get('content-type')?.includes('json')).catch(() => false))) {
  document.getElementById('load-box').innerHTML = `<p>${t('noAssets')}</p>`;
  throw new Error('asset pack missing: run npm run assets');
}

// phones and tablets: on-screen joysticks, and a lighter picture (a phone's 3x screen at full
// resolution would be several times the pixels of a laptop)
const touchMode = isTouchDevice();
// picture quality, chosen in the corner menu and remembered in this browser: fast renders at the
// screen's own pixel size without ambient occlusion and may drop to 70%; balanced keeps up to
// 1.5 pixels a point and drops to 80% when the GPU is busy; quality never drops (slower frames)
const QUALITY = {
  fast: { label: t('qualityFast'), ratio: 1, floor: 0.7, ao: false },
  balanced: { label: t('qualityBalanced'), ratio: 1.5, floor: 0.8, ao: true },
  quality: { label: t('qualityHigh'), ratio: 1.5, floor: 1, ao: true },
};
let quality = (() => { try { return localStorage.getItem('house-walk-quality'); } catch { return null; } })();
if (!QUALITY[quality]) quality = 'balanced';
const pixelRatio = () => Math.min(window.devicePixelRatio, touchMode ? 1 : QUALITY[quality].ratio);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(pixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
// the library copy's textures are KTX2 (tools/compress-textures.mjs), transcoded by public/basis
useKTX2(renderer, '/basis/');
// ACES plus a fine film grain: real photos always carry some noise. The
// grain hash avoids sin(): the classic fract(sin(dot)) hash lines up into diagonal and vertical
// streaks on GPUs, which read as brush marks on the smooth white walls. The hash is "Hash
// without Sine" (MIT; its notice is in public/THIRD-PARTY-NOTICES.txt)
// ACES; ?tone=agx to compare (AgX read flatter and more washed out here, inside and out)
const toneCurve = params.get('tone') === 'agx' ? 'AgXToneMapping' : 'ACESFilmicToneMapping';
THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
  'vec3 CustomToneMapping( vec3 color ) { return color; }',
  `#define TONE_CURVE ${toneCurve}
  vec3 CustomToneMapping( vec3 color ) {
    vec3 c = TONE_CURVE( color );
    vec3 p3 = fract( vec3( gl_FragCoord.xyx ) * 0.1031 );
    p3 += dot( p3, p3.yzx + 33.33 );
    float n = fract( ( p3.x + p3.y ) * p3.z ) - 0.5;
    return max( c + n * 0.011 * ( 0.25 + c ), 0.0 );
  }`,
);
renderer.toneMapping = THREE.CustomToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.05, 800);

// ---------- input ----------
const keys = new Set();
let jumpQueued = false;
const cam = { yaw: 0, pitch: 0.15, dist: 3.2, first: params.has('fp') };
// the top view (T): an orbiting camera over the house with its roof and ceilings cut away; the
// walker waits where it stood
const top = { on: false, target: new THREE.Vector3(), yaw: 0, pitch: 0.95, dist: 24 };
const clampPitch = (v) => (top.on ? THREE.MathUtils.clamp(v, 0.3, 1.52) : THREE.MathUtils.clamp(v, -1.2, 1.3));
// the mouse and the touch controls turn whichever camera is in use
const view = {
  get yaw() { return top.on ? top.yaw : cam.yaw; },
  set yaw(v) { if (top.on) top.yaw = v; else cam.yaw = v; },
  get pitch() { return top.on ? top.pitch : cam.pitch; },
  set pitch(v) { if (top.on) top.pitch = v; else cam.pitch = v; },
};
const touch = touchMode ? createTouchControls({
  cam: view, clampPitch,
  onDoor: () => toggleNearestDoor(),
  onJump: () => { if (!top.on) jumpQueued = true; },
  onView: () => { cam.first = !cam.first; },
  onTop: () => toggleTop(),
  onDims: () => toggleDims(),
  onStorey: () => changeStorey(1, true),
  onPinch: (f) => {
    if (top.on) top.dist = THREE.MathUtils.clamp(top.dist * f, 6, 60);
    else cam.dist = THREE.MathUtils.clamp(cam.dist * f, 1.0, 30);
  },
}) : null;
const walking = (...codes) => !top.on && codes.some((c) => keys.has(c));
const input = {
  get forward() { return walking('KeyW', 'ArrowUp'); },
  get back() { return walking('KeyS', 'ArrowDown'); },
  get left() { return walking('KeyA', 'ArrowLeft'); },
  get right() { return walking('KeyD', 'ArrowRight'); },
  get run() { return walking('ShiftLeft', 'ShiftRight') || (!top.on && !!touch?.run); },
  get stick() { return top.on ? null : touch?.stick; },
  consumeJump() { const j = jumpQueued; jumpQueued = false; return j; },
};
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'Space') { if (!top.on) jumpQueued = true; e.preventDefault(); }
  if (e.code === 'KeyV') cam.first = !cam.first;
  if (e.code === 'KeyE') toggleNearestDoor();
  if (e.code === 'KeyT') toggleTop();
  if (e.code === 'KeyM') toggleDims();
  // the storey seen from above (a house with more than one)
  if (e.code === 'PageUp') { changeStorey(1); e.preventDefault(); }
  if (e.code === 'PageDown') { changeStorey(-1); e.preventDefault(); }
  if (e.code === 'KeyH') document.getElementById('help').hidden ^= 1;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
let dragging = false;
renderer.domElement.addEventListener('click', () => { if (!touchMode && !top.on) renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); });
renderer.domElement.addEventListener('mousedown', () => { dragging = true; });
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement && !dragging) return;
  view.yaw -= e.movementX * (top.on ? 0.004 : 0.0025);
  view.pitch = clampPitch(view.pitch + e.movementY * (top.on ? 0.003 : 0.0022));
});
addEventListener('wheel', (e) => {
  if (top.on) top.dist = THREE.MathUtils.clamp(top.dist * (1 + Math.sign(e.deltaY) * 0.1), 6, 60);
  else cam.dist = THREE.MathUtils.clamp(cam.dist * (1 + Math.sign(e.deltaY) * 0.1), 1.0, 30);
});
let post;
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  post?.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
});

// ---------- load ----------
const t0 = performance.now();
const heroReady = Promise.all([loadAvatar(PLAYER_AVATAR), loadClips(genderOf(PLAYER_AVATAR), undefined, undefined, 0, HERO_CLIP_FILES)]);
// a fair-weather day, sun at about 43 degrees from the south-south-east of true north: the south
// facades in sun, the west ones in shade (a sun from the south-west lit two facades alike and
// they looked flat). A cloudy photo reads far more like a real afternoon than a clear sky's
// empty gradient.
// sky photos (Poly Haven, public/models/env) and the turn that brings each one's sun to the
// south-south-east; another sky goes in here and is chosen with ?sky=
const SKIES = { kloofendal_48d_partly_cloudy: 0 };
const sky = SKIES[params.get('sky')] != null ? params.get('sky') : 'kloofendal_48d_partly_cloudy';   // fair-weather clouds
// where true north is (site.north: degrees clockwise from the plan's up): the sky turns with it,
// so the sun comes from the same compass direction whichever way the plan is drawn
const north = plan.site?.north ?? 0;
// the lawns a little cooler and darker than the library's field green, which read as a saturated
// yellow-green carpet next to the white walls (?lawnTint=r,g,b to compare)
const lawnTint = (params.get('lawnTint') ?? '0.6,0.74,0.5').split(',').map(Number);
const world = await createWorld(renderer, scene, { hdri: sky, rotate: +(params.get('rotate') ?? SKIES[sky] - THREE.MathUtils.degToRad(north)), lawn: plan.lawn ?? plan.garden?.wall?.rect, lawnTint });
const house = await buildHouse(plan);
scene.add(house.group);
// the sun's shadow covers the whole house and garden (a low sun throws long shadows)
const { sun } = world;
const b = house.bounds;
const centre = new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2);
// 2048 over the 42 m square: 2 cm a texel, enough for window bars and pergola slats with the
// soft filter; 4096 took 134 MB and more of the frame for little that shows
sun.shadow.mapSize.setScalar(2048);
Object.assign(sun.shadow.camera, { left: -21, right: 21, top: 21, bottom: -21, near: 1, far: 120 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.normalBias = 0.03;
// direct sun several times the sky light, as outdoors: shade then reads as shade (with the
// library's 2.5 the shaded patio was nearly as bright as the sunlit lawn); exposure compensates
sun.intensity = 5.5;
// a clear day over a few hundred metres of suburb: the library's fog (made for a field of
// people) closed in at 230 m and washed the street out
scene.fog.far = 450;
world.follow(centre, 50);
post = createPost(renderer, scene, camera);
post.quality.ao = QUALITY[quality].ao;
// 3D grass blades on the lawn, none through the floors, deck, paths and driveway
const grass = createGrass(world.groundMaterial, {
  exclude: [[b.minX, b.minZ, b.maxX, b.maxZ], ...(plan.outdoor?.surfaces ?? []).map((s) => s.box)],
});
scene.add(grass.mesh);
// the house and garden stand still: the sun's shadow map is drawn once and again only when a
// door moves (the walker has its own projected shadow)
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;

const [hero, heroAnim] = await heroReady;
// 30,000 hair strands (8,000 on phones): the camera stays a few metres from the walker
await applyHiResMaterials(hero, renderer, { hairStrands: touchMode ? 8000 : 30000 });
// the library's avatar is 1.86 m tall; an ordinary adult makes the house read at its true size
const HEIGHT_M = 1.78;
hero.root.scale.multiplyScalar(HEIGHT_M / hero.height);
hero.height = HEIGHT_M;
const player = new Player(hero, heroAnim, input);
scene.add(hero.root);
hero.root.traverse((o) => {
  if (!o.isMesh) return;
  o.castShadow = false;
  // the walker casts no sun shadow (it has its own projected one), so the skin's red sun wrap can
  // test the shadow map: under the roof it no longer glows
  for (const m of [].concat(o.material)) { m.defines = { ...m.defines, SKIN_WRAP_SHADOW: '' }; m.needsUpdate = true; }
});
const walkerShadow = createWalkerShadow(hero.mesh, world.sunDir);

// indoor light: bake the irradiance volume, then the house, its furniture and the walker use it
const volume = createLightVolume();
useLightVolumeOn(house.group, volume);
useLightVolumeOn(hero.root, volume);
const loadingEl = document.getElementById('loading');
const giSpacing = +(params.get('gi') ?? 0.6);   // finer grid: light falls off from the windows into the corners
// the bake is kept in the browser (IndexedDB) per plan, so it runs once; ?rebake forces it
// baked ceiling lamps: bright enough for a lit house, weak enough that the windows still show
// where the daylight comes from (?lamps= to compare)
const lampPower = +(params.get('lamps') ?? 0.9);
// the bake's name: the plan without its outdoor dressing, names and problem list (bake-key.js)
const giKey = bakeKey(drawn, { spacing: giSpacing, sky, lampPower });
// a bake saved with the project (public/gi) first, then this browser's own cache
const giFile = `/gi/${bakeFile(drawn, { spacing: giSpacing, sky, lampPower })}`;
const shipped = params.has('rebake') ? null : await fetch(giFile).then((r) => (r.ok && r.headers.get('content-type')?.includes('octet') ? r.arrayBuffer() : null)).catch(() => null);
const cached = shipped ? new Float32Array(shipped) : params.has('rebake') ? null : await idb('get', giKey);
// three probe levels per storey, evenly spaced from floor to floor (a single storey keeps the
// levels its bakes were made with)
const storeyH = house.floorOf(1) - house.floorOf(0);
const giLevels = house.storeys > 1 ? Array.from({ length: 3 * house.storeys }, (_, k) => 0.35 + (k * storeyH) / 3) : undefined;
const bake = await bakeLightVolume(renderer, scene, house, volume, {
  hide: [hero.root], spacing: giSpacing, cached, lamps: house.lights, lampPower, levels: giLevels,
  onProgress: (f) => {
    if (window.__loading) window.__loading.stage(t('baking'), f);
    else loadingEl.textContent = `${t('baking')} ${Math.round(f * 100)}%`;
  },
});
if (!bake.cached) {
  await idb('put', giKey, bake.coeffs);
  // while developing, keep the bake with the project for every browser
  if (import.meta.env.DEV) fetch(`/__bake/${encodeURIComponent(giKey)}`, { method: 'POST', body: bake.coeffs.buffer }).catch(() => {});
}
console.log(`light volume: ${bake.probes} probes, ${bake.cached ? 'from the cache' : `baked in ${bake.seconds.toFixed(1)} s`}`);
// The cube captures below are turned into reflection maps once, here, and the raw captures
// (with their depth buffers) freed; left to three.js, both would stay on the GPU
const capturePMREM = new THREE.PMREMGenerator(renderer);
const reflectionOf = (target) => {
  const env = capturePMREM.fromCubemap(target.texture).texture;
  target.dispose();
  return env;
};
// mirrors reflect the room they hang in, not the sky photo: one small cube capture per mirror,
// taken once from a little in front of it (all meshes of one model share the capture)
{
  const mirrors = new Map();
  house.group.traverse((o) => {
    if (!o.isMesh || [].concat(o.material).every((m) => m.name !== 'mirror')) return;
    let model = o;
    while (model.parent && model.parent !== house.group) model = model.parent;
    if (!mirrors.has(model)) mirrors.set(model, []);
    mirrors.get(model).push(o);
  });
  const box = new THREE.Box3(), at = new THREE.Vector3();
  hero.root.visible = false;
  for (const [model, meshes] of mirrors) {
    box.makeEmpty();
    for (const m of meshes) box.expandByObject(m);
    box.getCenter(at);
    const room = house.roomAt(at.x, at.z, at.y);
    if (!room) continue;
    const xs = room.poly.map((q) => q[0]), zs = room.poly.map((q) => q[1]);
    const mid = new THREE.Vector3((Math.min(...xs) + Math.max(...xs)) / 2, at.y, (Math.min(...zs) + Math.max(...zs)) / 2);
    const eye = at.clone().add(mid.sub(at).setY(0).normalize().multiplyScalar(0.4));
    const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
    const cube = new THREE.CubeCamera(0.05, 30, target);
    cube.position.copy(eye);
    for (const m of meshes) m.visible = false;
    cube.update(renderer, scene);
    const env = reflectionOf(target);
    for (const m of meshes) {
      m.visible = true;
      m.material = [].concat(m.material).map((mt) => {
        if (mt.name !== 'mirror') return mt;
        const c = mt.clone();
        c.onBeforeCompile = mt.onBeforeCompile;
        c.customProgramCacheKey = mt.customProgramCacheKey;
        c.envMap = env;
        c.envMapIntensity = 1;
        // a capture of this room: the light volume must not dim it as if it were the sky
        c.defines = { ...c.defines, GI_LOCAL_ENV: '' };
        return c;
      });
      if (m.material.length === 1) m.material = m.material[0];
    }
  }
  hero.root.visible = true;
}
// glossy furniture (black glass hob, steel, lacquer, marble) reflects its own room too: a small
// cube capture per room at eye height; with the sky photo a black hob read as blue
{
  const probes = new Map();
  hero.root.visible = false;
  for (const room of plan.rooms) {
    const xs = room.poly.map((q) => q[0]), zs = room.poly.map((q) => q[1]);
    let x = (Math.min(...xs) + Math.max(...xs)) / 2, z = (Math.min(...zs) + Math.max(...zs)) / 2;
    const ry = house.floorOf(room.storey ?? 0) + 1.4;
    if (house.roomAt(x, z, ry) !== room) [x, z] = room.poly[0].map((v, i) => v + (i ? 0.8 : 0.8));
    const target = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
    const cube = new THREE.CubeCamera(0.05, 40, target);
    cube.position.set(x, ry, z);
    cube.update(renderer, scene);
    probes.set(room, reflectionOf(target));
  }
  hero.root.visible = true;
  const clones = new Map();
  for (const obj of house.interior) {
    const env = probes.get(house.roomAt(obj.position.x, obj.position.z, obj.position.y + 0.5));
    if (!env) continue;
    obj.traverse((m) => {
      if (!m.isMesh) return;
      m.material = [].concat(m.material).map((mt) => {
        if (mt.envMap || mt.transparent || (mt.roughness > 0.45 && mt.metalness < 0.5) || mt.name === 'mirror' || mt.name === 'glass_clear') return mt;
        const key = `${mt.uuid}|${env.uuid}`;
        if (!clones.has(key)) {
          const c = mt.clone();
          // clone() leaves out the light-volume shader patch
          c.onBeforeCompile = mt.onBeforeCompile;
          c.customProgramCacheKey = mt.customProgramCacheKey;
          c.envMap = env;
          c.defines = { ...c.defines, GI_LOCAL_ENV: '' };
          clones.set(key, c);
        }
        return clones.get(key);
      });
      if (m.material.length === 1) m.material = m.material[0];
    });
  }
}
capturePMREM.dispose();
// start on the sidewalk in front of the plot's pedestrian gate, facing the house
const gate = plan.site?.gate ?? [centre.x - 0.5, centre.x + 0.5];
const front = plan.site?.plot?.[3] ?? b.maxZ + 6;
player.position.set((gate[0] + gate[1]) / 2, 0.05, front + 1.5);
player.yaw = Math.PI;
cam.yaw = 0;

// ---------- walking in the house: floors, walls, doors ----------
const RADIUS = 0.25, STEP = 0.36, HEIGHT = 1.75;
player.groundAt = (x, z, y) => {
  let top = 0;
  for (const s of house.walkable) {
    if (x < s.minX || x > s.maxX || z < s.minZ || z > s.maxZ) continue;
    const h = house.surfaceAt(s, x, z);
    if (h <= y + STEP) top = Math.max(top, h);
  }
  return top;
};
const blockers = () => house.obstacles.concat(house.doors.filter((d) => d.open < 0.3).map((d) => d.collider));
player.collide = (p, vel) => {
  for (const c of blockers()) {
    if (c.bottom > p.y + HEIGHT || c.top <= p.y + STEP) continue;
    const nx = THREE.MathUtils.clamp(p.x, c.minX, c.maxX), nz = THREE.MathUtils.clamp(p.z, c.minZ, c.maxZ);
    const dx = p.x - nx, dz = p.z - nz, d2 = dx * dx + dz * dz;
    if (d2 >= RADIUS * RADIUS) continue;
    if (d2 > 1e-10) {
      const d = Math.sqrt(d2), ux = dx / d, uz = dz / d;
      p.x = nx + ux * RADIUS; p.z = nz + uz * RADIUS;
      const vn = vel.x * ux + vel.z * uz;
      if (vn < 0) { vel.x -= vn * ux; vel.z -= vn * uz; }
    } else {
      const ex = [c.minX - p.x, c.maxX - p.x, c.minZ - p.z, c.maxZ - p.z];
      const i = ex.map(Math.abs).indexOf(Math.min(...ex.map(Math.abs)));
      if (i < 2) p.x += ex[i] + Math.sign(ex[i]) * RADIUS; else p.z += ex[i] + Math.sign(ex[i]) * RADIUS;
    }
  }
};
function toggleNearestDoor() {
  let best = null;
  for (const d of house.doors) {
    if (Math.abs(d.y - player.position.y) > 1.2) continue;
    const dist = Math.hypot(d.x - player.position.x, d.z - player.position.z);
    if (dist < 1.8 && (!best || dist < best.dist)) best = { d, dist };
  }
  if (best) best.d.target = best.d.target > 0.5 ? 0 : 1;
}
for (const d of house.doors) d.open = d.target;

// third-person camera: never inside a wall or above the ceiling of the room it is in
const ray = new THREE.Vector3();
function cameraBlock(from, dir, max) {
  let best = max;
  for (const c of house.obstacles) {
    let t0 = 0, t1 = best;
    for (const [o, d, lo, hi] of [[from.x, dir.x, c.minX - 0.12, c.maxX + 0.12], [from.y, dir.y, c.bottom - 0.12, c.top + 0.12], [from.z, dir.z, c.minZ - 0.12, c.maxZ + 0.12]]) {
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { t0 = Infinity; break; } continue; }
      let a = (lo - o) / d, bb = (hi - o) / d;
      if (a > bb) [a, bb] = [bb, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, bb);
      if (t0 > t1) break;
    }
    if (t0 <= t1 && t0 < best) best = t0;
  }
  return best;
}

// the bytes this load took: public/load-size.json holds them for the next visitors' progress bar
window.__loadBytes = window.__loading?.done();
document.getElementById('loading').remove();
document.getElementById('house').textContent = plan.name;
const freed = releaseTextureMemory(renderer, scene);
console.log(`textures: ${freed.textures}, ${freed.released} images let go after upload (${(freed.bytes / 1e6).toFixed(0)} MB)`);
window.__house = { THREE, scene, camera, renderer, player, cam, house, plan, keys, post, sun, volume, bake };

// a tiny key-value store on IndexedDB; any failure just means no cache
function idb(op, key, value) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open('house-walk', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('bakes');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const tx = open.result.transaction('bakes', op === 'get' ? 'readonly' : 'readwrite');
        const req = op === 'get' ? tx.objectStore('bakes').get(key) : tx.objectStore('bakes').put(value, key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      };
    } catch { resolve(null); }
  });
}

// eyes adapt: indoors is far darker than the sunlit garden, so the exposure rises inside
// (the windows then look bright, as they do to someone standing in the room)
const glass = new Set();
house.group.traverse((o) => { for (const m of [].concat(o.material ?? [])) if (m.userData?.clear) glass.add(m); });
const EXPOSURE = { outside: 0.6, inside: +(params.get('ev') ?? 2.8) };

// dynamic resolution: when the GPU needs more than ~14.5 ms, the 3D scene renders a little
// smaller (down to 80%) and the final pass scales it up with light sharpening; the canvas,
// grain and HUD stay at screen resolution. ?scale= fixes it. SMAA stays on throughout: at 70%
// without it every edge showed its steps and the sharpening ringed them, which read as a
// pixelated picture; a slower frame on a busy GPU is the lesser evil.
const fixedScale = params.has('scale') ? +params.get('scale') : null;
let renderScale = fixedScale ?? 1;
post.setScale(renderScale);
function adaptResolution(gpuMs) {
  if (fixedScale != null || gpuMs == null) return;
  let r = renderScale;
  const floor = QUALITY[quality].floor;
  if (gpuMs > 14.5 && r > floor) r = Math.max(floor, r - 0.05);
  else if (gpuMs < 10.5 && r < 1) r = Math.min(1, r + 0.05);
  if (r !== renderScale) { renderScale = r; post.setScale(r); }
}
const qualityPick = document.getElementById('quality-pick');
if (qualityPick) {
  for (const [id, q] of Object.entries(QUALITY)) qualityPick.add(new Option(q.label, id));
  qualityPick.value = quality;
  qualityPick.addEventListener('change', () => {
    quality = qualityPick.value;
    try { localStorage.setItem('house-walk-quality', quality); } catch { /* private window: this visit only */ }
    renderer.setPixelRatio(pixelRatio());
    renderer.setSize(innerWidth, innerHeight);
    post.setSize(innerWidth, innerHeight, renderer.getPixelRatio());
    post.quality.ao = QUALITY[quality].ao;
    if (fixedScale == null && renderScale < QUALITY[quality].floor) { renderScale = QUALITY[quality].floor; post.setScale(renderScale); }
    qualityPick.blur();
  });
}

// ---------- loop ----------
const clock = new THREE.Clock();
// the cut-away: every house material is clipped above CUT, but only inside the box of the house
// and its pergolas (five planes whose intersection is that box's top), so the trees, the street
// and the neighbours stay whole. Off, the top plane sits far above everything. The sun's shadows
// are clipped the same way, so from above the rooms get the daylight
renderer.localClippingEnabled = true;
const cutBox = [[b.minX, b.minZ, b.maxX, b.maxZ], ...[...(plan.outdoor?.pergolas ?? []), ...(plan.outdoor?.canopies ?? [])].map((p) => p.box)]
  .reduce((a, [x0, z0, x1, z1]) => [Math.min(a[0], x0), Math.min(a[1], z0), Math.max(a[2], x1), Math.max(a[3], z1)], [Infinity, Infinity, -Infinity, -Infinity]);
// 2.45 m above the floor of the storey being looked at (PageUp / PageDown): the storeys above it
// are cut away whole
const CUT = (st) => house.floorOf(st) + 2.45;
const cutTop = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e5);
const cutPlanes = [
  cutTop,
  new THREE.Plane(new THREE.Vector3(-1, 0, 0), cutBox[0] - 0.02), new THREE.Plane(new THREE.Vector3(1, 0, 0), -(cutBox[2] + 0.02)),
  new THREE.Plane(new THREE.Vector3(0, 0, -1), cutBox[1] - 0.02), new THREE.Plane(new THREE.Vector3(0, 0, 1), -(cutBox[3] + 0.02)),
];
house.group.traverse((o) => {
  for (const m of o.isMesh ? [].concat(o.material) : []) { m.clippingPlanes = cutPlanes; m.clipIntersection = true; m.clipShadows = true; }
});
const topBtn = document.getElementById('top-btn');
if (topBtn) {
  topBtn.hidden = touchMode;
  topBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleTop(); topBtn.blur(); });
}
// the architectural dimensions over the top view (M), one set per storey, drawn just above its cut
const storeyName = (st) => (house.storeys > 1 ? (st ? t('storeyN', { n: st }) : t('storeyGround')) : '');
const storeyPlan = (st) => ({ ...plan, rooms: plan.rooms.filter((r) => (r.storey ?? 0) === st), walls: plan.walls.filter((w) => (w.storey ?? 0) === st) });
const allDims = Array.from({ length: house.storeys }, (_, st) => createDimensions(storeyPlan(st), {
  y: CUT(st) + 0.03, container: document.getElementById('dims'), storey: storeyName(st), plot: st === 0,
}));
if (house.storeys > 1) {
  const gross = allDims.reduce((a, d) => a + d.totals.gross, 0), net = allDims.reduce((a, d) => a + d.totals.netTotal, 0);
  for (const d of allDims) d.legend.insertAdjacentHTML('beforeend', `<br>${t('dimsAll', { g: gross.toFixed(1), n: net.toFixed(1) })}`);
}
for (const d of allDims) scene.add(d.group);
if (touch?.storeyButton) touch.storeyButton.hidden = house.storeys < 2;
top.storey = 0;
let dims = allDims[0];
// for tests and skills: the top view's camera and the dimension totals (of the storey shown)
Object.assign(window.__house, { top, allDims });
Object.defineProperty(window.__house, 'dims', { get: () => dims });
const dimsBtn = document.getElementById('dims-btn');
if (dimsBtn) {
  dimsBtn.hidden = touchMode;
  dimsBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleDims(); dimsBtn.blur(); });
}
function toggleDims() {
  // the dimensions belong to the view from above: asking for them goes there
  if (!top.on) toggleTop();
  dims.setVisible(!dims.visible);
  // read like a drawing: straight down, north up, the whole house in view
  if (dims.visible) {
    top.target.set(centre.x, house.floorOf(top.storey), centre.z);
    top.yaw = 0;
    top.pitch = 1.52;
    top.dist = Math.max(top.dist, 29);
  }
  // the hints and the key help would sit on the dimension lines
  hintEl.hidden = dims.visible;
  if (!touchMode) document.getElementById('help').hidden = dims.visible;
  if (dimsBtn) dimsBtn.textContent = dims.visible ? t('dimsOff') : t('dimsOn');
}
function toggleTop() {
  top.on = !top.on;
  if (!top.on && dims.visible) {
    dims.setVisible(false);
    if (dimsBtn) dimsBtn.textContent = t('dimsOn');
    hintEl.hidden = false;
    if (!touchMode) document.getElementById('help').hidden = false;
  }
  if (top.on) {
    // from above, the storey the walker is on
    showStorey(house.storeyAt(player.position.y));
    top.target.set(centre.x, house.floorOf(top.storey), centre.z);
    top.yaw = cam.yaw;
    document.exitPointerLock?.();
  }
  cutTop.constant = top.on ? CUT(top.storey) : 1e5;
  // the hint moves up out of the way of the house seen from above
  hintEl.style.top = top.on ? 'calc(70px + env(safe-area-inset-top))' : '';
  renderer.shadowMap.needsUpdate = true;
  if (topBtn) topBtn.textContent = top.on ? t('topOff') : t('topOn');
}
// the storey seen from above: the cut, the camera's height and the dimensions follow it
function showStorey(st) {
  const shown = dims.visible;
  if (shown) dims.setVisible(false);
  top.storey = st;
  dims = allDims[st];
  if (shown) dims.setVisible(true);
  if (top.on) {
    cutTop.constant = CUT(st);
    top.target.y = house.floorOf(st);
    renderer.shadowMap.needsUpdate = true;
  }
}
// PageUp / PageDown (or the touch button, which goes round) in the view from above
function changeStorey(step, wrap = false) {
  if (house.storeys < 2) return;
  if (!top.on) toggleTop();
  const next = top.storey + step;
  showStorey(wrap ? (next + house.storeys) % house.storeys : THREE.MathUtils.clamp(next, 0, house.storeys - 1));
}
const gpuTimer = createGpuTimer(renderer.getContext());
const perfEl = document.getElementById('perf'), roomEl = document.getElementById('room'), hintEl = document.getElementById('hint');
const head = new THREE.Vector3();
let frames = 0, acc = 0;
console.log(`house-walk loaded in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
// one frame; the test hook __house.tick(dt) runs it by hand (a hidden page gets no frames)
let frameNo = 0;
function tick(dt) {
  touch?.update(dt);
  player.update(dt, cam.yaw);
  frameNo++;
  if (frameNo === 1 || house.doors.some((d) => Math.abs(d.target - d.open) > 1e-3)) renderer.shadowMap.needsUpdate = true;
  for (const d of house.doors) {
    d.open += THREE.MathUtils.clamp(d.target - d.open, -dt * 2.2, dt * 2.2);
    for (const leaf of d.leaves) leaf.rotation.y = d.open * 1.5;
  }
  const p = player.position;
  const inside = !!house.roomAt(p.x, p.z, p.y);
  hero.root.visible = !cam.first || top.on;
  walkerShadow.update(player.groundAt(p.x, p.z, p.y + 0.05), !house.roomAt(p.x, p.z, p.y));
  // tests can place the camera themselves (__house.freeCam)
  if (window.__house.freeCam) { /* camera left where the test put it */ } else if (top.on) {
    // pan with WASD / the arrows / the left stick, at a pace that suits the height
    const kx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + (touch?.stick.x ?? 0);
    const kz = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + (touch?.stick.y ?? 0);
    if (kx || kz) {
      const s = Math.sin(top.yaw), c = Math.cos(top.yaw), step = top.dist * 0.6 * dt;
      top.target.x = THREE.MathUtils.clamp(top.target.x + (-s * kz + c * kx) * step, cutBox[0] - 8, cutBox[2] + 8);
      top.target.z = THREE.MathUtils.clamp(top.target.z + (-c * kz - s * kx) * step, cutBox[1] - 8, cutBox[3] + 8);
    }
    const cp = Math.cos(top.pitch);
    camera.position.set(top.target.x + Math.sin(top.yaw) * cp * top.dist, top.target.y + Math.sin(top.pitch) * top.dist, top.target.z + Math.cos(top.yaw) * cp * top.dist);
    camera.lookAt(top.target);
  } else if (cam.first) {
    head.set(p.x, p.y + 1.62, p.z);
    camera.position.copy(head);
    const cp = Math.cos(cam.pitch);
    camera.lookAt(head.x - Math.sin(cam.yaw) * cp, head.y - Math.sin(cam.pitch), head.z - Math.cos(cam.yaw) * cp);
  } else {
    head.set(p.x, p.y + 1.5, p.z);
    const cp = Math.cos(cam.pitch);
    ray.set(Math.sin(cam.yaw) * cp, Math.sin(cam.pitch), Math.cos(cam.yaw) * cp);
    const dist = Math.min(cam.dist, Math.max(0.35, cameraBlock(head, ray, cam.dist) - 0.15));
    camera.position.copy(head).addScaledVector(ray, dist);
    if (inside) camera.position.y = Math.min(camera.position.y, house.topOf(house.storeyAt(p.y)) - 0.12);
    camera.position.y = Math.max(camera.position.y, p.y + 0.3);
    camera.lookAt(head);
  }
  const camIn = !!house.roomAt(camera.position.x, camera.position.z, camera.position.y) && camera.position.y < house.topOf(house.storeyAt(camera.position.y));
  const ev = camIn ? EXPOSURE.inside : EXPOSURE.outside;
  renderer.toneMappingExposure *= Math.pow(ev / renderer.toneMappingExposure, Math.min(1, dt * 1.6));
  // from inside, the garden should read a stop or two brighter than the room (holding back 62%
  // made it barely brighter than the walls); from outside the rooms are many times darker than
  // the daylight, so the pane mostly shows the reflection. From inside its faint reflection is
  // of the room, not the bright sky
  for (const g of glass) { g.opacity = camIn ? 0.3 : 0.55; g.envMapIntensity = camIn ? 0.4 : 2.0; }
  // from outside, furniture deep in the house can only be glimpsed through the windows up close:
  // past ~14 m it is skipped (hundreds of draw calls seen from the street)
  for (const o of house.interior) o.visible = top.on || camIn || o.position.distanceToSquared(camera.position) < 196;
  // room corners and furniture feet need wider ambient occlusion than open ground (?ao=); not
  // darker: the baked light already darkens the corners, and at 6 the occlusion laid dark smears
  // on the walls beside furniture and greyed whole rooms
  post.quality.aoRadius = camIn ? 1.0 : +(params.get('aoR') ?? 0.55);
  post.quality.aoStrength = camIn ? +(params.get('ao') ?? 2.5) : +(params.get('aoS') ?? 2.8);
  // from inside, the lawn is only seen through windows, where the blades hardly show: skipped
  // (~1 ms on Iris Xe: their alpha-tested leaves defeat early depth rejection behind the walls)
  grass.mesh.visible = !camIn;
  grass.update(camera, performance.now() / 1000);
  // door and window widths only when close enough to read them
  dims.update(camera, { detail: !top.on || top.dist < 26 });
  gpuTimer.begin();
  post.render(dt);
  gpuTimer.end();

  frames++; acc += dt;
  if (acc > 0.5) {
    const room = house.roomAt(p.x, p.z, p.y);
    roomEl.textContent = room ? room.name : t('outside');
    const gpu = gpuTimer.ms;
    perfEl.textContent = `${Math.round(frames / acc)} fps${gpu ? ` · gpu ${gpu.toFixed(1)} ms` : ''}${renderScale < 1 ? ` · ${Math.round(renderScale * 100)}%` : ''}`;
    // phones mostly have no GPU timer: the frame time stands in for it (a frame that takes
    // longer than ~33 ms is GPU-bound there far more often than not)
    adaptResolution(gpu ?? (touchMode ? (acc / frames) * 1000 * 0.45 : null));
    frames = 0; acc = 0;
    const near = house.doors.some((d) => Math.abs(d.y - p.y) < 1.2 && Math.hypot(d.x - p.x, d.z - p.z) < 1.8);
    hintEl.textContent = top.on
      ? (touchMode ? t('hintTopTouch') : t('hintTop')) + (house.storeys > 1 ? ` · ${storeyName(top.storey)}${touchMode ? '' : ` (${t('hintStoreys')})`}` : '')
      : near ? (touchMode ? t('hintDoorTouch') : t('hintDoor')) : '';
  }
}
window.__house.tick = tick;
// test hook: a free camera at (px, py, pz) looking at (lx, ly, lz), HUD hints hidden
window.__house.look = async (px, py, pz, lx, ly, lz) => {
  document.getElementById('help').hidden = true;
  hintEl.style.visibility = 'hidden';
  window.__house.freeCam = true;
  camera.up.set(0, 1, 0);
  camera.position.set(px, py, pz);
  camera.lookAt(lx, ly, lz);
  for (let k = 0; k < 8; k++) { tick(1 / 30); await new Promise((res) => setTimeout(res, 250)); }
  return house.roomAt(px, pz, py)?.name ?? 'outside';
};
// test hook: stand the player at (x, z) on a storey looking toward (lookX, lookZ) and settle a few frames
window.__house.view = async (x, z, lookX, lookZ, pitch = 0.05, first = true, storey = 0) => {
  document.getElementById('help').hidden = true;
  hintEl.style.visibility = 'hidden';
  window.__house.freeCam = false;
  cam.first = first;
  player.position.set(x, house.floorOf(storey) + 0.01, z);
  player.velocity.set(0, 0, 0);
  cam.yaw = Math.atan2(-(lookX - x), -(lookZ - z));
  cam.pitch = pitch;
  for (let i = 0; i < 90; i++) tick(1 / 30);
  for (let k = 0; k < 5; k++) { await new Promise((res) => setTimeout(res, 300)); tick(1 / 30); }
  return house.roomAt(x, z, player.position.y)?.name ?? 'outside';
};
renderer.setAnimationLoop(() => tick(Math.min(clock.getDelta(), 0.1)));
