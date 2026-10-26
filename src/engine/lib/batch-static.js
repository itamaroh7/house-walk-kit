// Draws all the still library models of a scene in a few dozen calls. A house holds a hundred or
// more models (windows, ceiling lights, furniture, cars along the street), each a THREE.LOD of
// about ten meshes: drawn one by one they made 500-800 draw calls a frame, and the browser spent
// 10-20 ms of CPU on those calls alone, so the frame rate followed the CPU whatever the quality
// setting (which only lightens the GPU).
//
// Here every mesh of every level goes into a THREE.BatchedMesh per material (one multi-draw call
// each, with its own culling of every copy against the view). The models were loaded file by
// file, so the same surface (steel, oak, a fabric) arrives as a separate material in each:
// materials that draw the same are made one first, so a batch gathers that surface from every
// model. Per copy the level is still chosen by distance, as THREE.LOD does, and furniture deep in
// the house can be left out from far outside. The original LOD objects stay in the scene, hidden,
// for tests and bounding boxes.
//
//   const batch = batchStatic(house.group, { skip: (lod) => isDoor(lod), interior: new Set(list) });
//   // each frame:
//   batch.update(camera, { interiorRange: inside ? Infinity : 14 });
//
// The models must stand still (doors that open are skipped) and their materials must not change
// per copy afterwards (one material draws its batch).
import * as THREE from 'three';

const _cam = new THREE.Vector3();
const FLIP = new THREE.Matrix4().makeScale(-1, 1, 1);
const FLIP_INV = FLIP.clone().invert();
const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap', 'alphaMap', 'envMap', 'lightMap', 'bumpMap', 'clearcoatMap', 'clearcoatNormalMap', 'transmissionMap', 'sheenColorMap', 'thicknessMap'];
const NUMS = ['roughness', 'metalness', 'opacity', 'alphaTest', 'side', 'emissiveIntensity', 'envMapIntensity', 'aoMapIntensity', 'clearcoat', 'clearcoatRoughness', 'transmission', 'ior', 'thickness', 'sheen', 'sheenRoughness', 'reflectivity', 'specularIntensity', 'polygonOffsetFactor', 'polygonOffsetUnits', 'bumpScale', 'lightMapIntensity'];
const FLAGS = ['transparent', 'depthWrite', 'depthTest', 'vertexColors', 'flatShading', 'polygonOffset', 'toneMapped', 'fog', 'wireframe', 'premultipliedAlpha'];

// what a material draws, as a string: two materials with the same signature draw the same
function signature(m) {
  const parts = [m.type, m.customProgramCacheKey?.() ?? '', JSON.stringify(m.defines ?? {}), JSON.stringify(m.userData ?? {})];
  for (const k of ['color', 'emissive', 'sheenColor', 'specularColor']) if (m[k]?.isColor) parts.push(m[k].getHexString());
  for (const k of MAPS) parts.push(m[k]?.uuid ?? '');
  for (const k of NUMS) if (k in m) parts.push(m[k]);
  for (const k of FLAGS) if (k in m) parts.push(m[k] ? 1 : 0);
  if (m.normalScale) parts.push(m.normalScale.x, m.normalScale.y);
  return parts.join('|');
}

// the vertex layout a batch needs all its geometries to share
function layout(g) {
  return Object.entries(g.attributes).map(([k, a]) => `${k}:${a.itemSize}:${a.normalized ? 1 : 0}`).sort().join(',') + (g.index ? '|i' : '|n');
}

// a mesh can join a batch when nothing about it is drawn per object
function batchable(n) {
  return n.isMesh && !n.isInstancedMesh && !n.isSkinnedMesh && !n.isBatchedMesh && !n.morphTargetInfluences
    && !Array.isArray(n.material) && !n.geometry.groups.length && !n.geometry.morphAttributes?.position
    && n.onBeforeRender === THREE.Object3D.prototype.onBeforeRender && n.frustumCulled !== false;
}

export function batchStatic(root, { skip = () => false, interior = new Set() } = {}) {
  root.updateMatrixWorld(true);
  // the batches live under root: copies are placed in root's own frame
  const toRoot = root.matrixWorld.clone().invert();
  const lods = [];
  root.traverse((o) => { if (o.isLOD && o.visible && !skip(o)) lods.push(o); });

  const canonical = new Map();   // signature -> the one material that draws it
  const sameAs = (m) => {
    const s = signature(m);
    if (!canonical.has(s)) canonical.set(s, m);
    return canonical.get(s);
  };
  const groups = new Map();
  const instances = [];
  for (const lod of lods) {
    // every visible mesh of every level, or the whole model stays as it is
    let ok = true;
    const levels = lod.levels.map((level) => {
      const meshes = [];
      level.object.traverse((n) => {
        if (!n.isMesh) return;
        for (let a = n; a && a !== level.object; a = a.parent) if (!a.visible) return;
        if (!batchable(n)) { ok = false; return; }
        meshes.push(n);
      });
      return meshes;
    });
    if (!ok) continue;
    const inst = {
      pos: new THREE.Vector3().setFromMatrixPosition(lod.matrixWorld),
      distances: lod.levels.map((l) => l.distance), interior: interior.has(lod), level: -2, lod,
    };
    inst.parts = levels.map((meshes) => meshes.map((n) => {
      const rel = toRoot.clone().multiply(n.matrixWorld);
      const flipped = rel.determinant() < 0;
      const material = sameAs(n.material);
      const key = [material.uuid, layout(n.geometry), n.castShadow, n.receiveShadow, n.renderOrder, flipped].join('|');
      let g = groups.get(key);
      if (!g) {
        // each batch draws with its own copy of the material: a material shared with a plain mesh
        // (a door's frame) switched between its batched and plain shader on every draw, and three.js
        // recomputed the shader's parameters each time (a fifth of the frame's CPU)
        const own = Object.assign(material.clone(), { onBeforeCompile: material.onBeforeCompile, customProgramCacheKey: material.customProgramCacheKey });
        g = { material: own, cast: n.castShadow, receive: n.receiveShadow, order: n.renderOrder, flipped, geometries: new Map(), parts: [] };
        groups.set(key, g);
      }
      if (!g.geometries.has(n.geometry)) g.geometries.set(n.geometry, -1);
      // a mirrored copy is drawn through a mirror matrix so its faces keep their winding
      const part = { g, geometry: n.geometry, matrix: flipped ? FLIP_INV.clone().multiply(rel) : rel, id: -1 };
      g.parts.push(part);
      return part;
    }));
    instances.push(inst);
  }

  const holder = new THREE.Group();
  holder.name = 'batched-models';
  for (const g of groups.values()) {
    let vertices = 0, indices = 0;
    for (const geo of g.geometries.keys()) {
      vertices += geo.attributes.position.count;
      indices += geo.index ? geo.index.count : 0;
    }
    const mesh = new THREE.BatchedMesh(g.parts.length, vertices, Math.max(indices, 1), g.material);
    for (const geo of g.geometries.keys()) g.geometries.set(geo, mesh.addGeometry(geo));
    for (const part of g.parts) {
      part.id = mesh.addInstance(g.geometries.get(part.geometry));
      mesh.setMatrixAt(part.id, part.matrix);
      mesh.setVisibleAt(part.id, false);
    }
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.renderOrder = g.order;
    // the draw lists are rebuilt only when a copy changes level: culling every copy against the
    // view and sorting them rebuilt and re-uploaded every batch's list each frame, which cost
    // more CPU than the calls it saved. Glass alone is sorted, back to front.
    mesh.perObjectFrustumCulled = false;
    mesh.sortObjects = !!g.material.transparent;
    // three.js r170 asks a batch for `colorTexture`, which BatchedMesh keeps as `_colorsTexture`:
    // undefined !== null, so every batch looked changed and its shader parameters were worked out
    // again on every draw. No per-copy colours here: null says so.
    mesh.colorTexture = null;
    mesh.name = `batch:${g.material.name}`;
    if (g.flipped) { mesh.matrix.copy(FLIP); mesh.matrixAutoUpdate = false; }
    g.mesh = mesh;
    holder.add(mesh);
  }
  root.add(holder);
  for (const inst of instances) inst.lod.visible = false;

  let lastRange = null;
  // chooses each copy's level (THREE.LOD's rule: the last level whose distance the camera is
  // beyond; furniture inside the house is left out past interiorRange) and shows that level's
  // meshes; returns whether anything changed
  function update(camera, { interiorRange = Infinity } = {}) {
    camera.getWorldPosition(_cam);
    const zoom = camera.zoom || 1;
    const rangeChanged = interiorRange !== lastRange;
    lastRange = interiorRange;
    let changed = false;
    for (const inst of instances) {
      const d = _cam.distanceTo(inst.pos) / zoom;
      let level = -1;
      if (!(inst.interior && d > interiorRange)) {
        level = 0;
        for (let i = 1; i < inst.distances.length; i++) if (d >= inst.distances[i]) level = i;
      }
      if (level === inst.level && !rangeChanged) continue;
      inst.parts.forEach((parts, i) => { for (const p of parts) p.g.mesh.setVisibleAt(p.id, i === level); });
      inst.level = level;
      changed = true;
    }
    return changed;
  }

  // off: the original models draw themselves again (to compare); on: the batches
  function setEnabled(on) {
    holder.visible = on;
    for (const inst of instances) inst.lod.visible = !on;
  }

  return {
    update, setEnabled, holder, models: instances.length, batches: groups.size, skipped: lods.length - instances.length,
    materials: canonical.size,
  };
}
