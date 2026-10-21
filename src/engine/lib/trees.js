// Trees and bushes for the library's scenes, grown procedurally with EZ-Tree (MIT,
// @dgreenheck/ez-tree, textures included): real branching, bark and leaf cards at a fraction of
// the triangles of scanned trees, which are millions of triangles each.
//
//   const oak = createTree('Oak Medium', 7);   // presets: Oak / Ash / Aspen / Pine Small|Medium|Large, Bush 1|2|3
//   oak.position.set(x, 0, z); scene.add(oak);
//
// Needs `npm i @dgreenheck/ez-tree` in the project that uses it.
import * as THREE from 'three';
import { Tree } from '@dgreenheck/ez-tree';

export const TREE_PRESETS = ['Oak Small', 'Oak Medium', 'Oak Large', 'Ash Small', 'Ash Medium', 'Ash Large', 'Aspen Small', 'Aspen Medium', 'Aspen Large', 'Pine Small', 'Pine Medium', 'Pine Large', 'Bush 1', 'Bush 2', 'Bush 3'];

// opts.height: scale the tree to this height in metres (presets come in their own units)
// opts.tint: leaf colour multiplier (hex), e.g. grey-green or lavender for Mediterranean beds
// opts.leafType: 'oak', 'ash', 'aspen' or 'pine' leaf texture (Bush 1 and 2 come with autumn
// ash and aspen leaves, which read as dry in a summer garden)
// opts.leaves: share of the preset's leaf cards to keep; opts.detail: share of the branches'
// lengthwise sections and round segments (a garden of forty bushes at full detail is about
// 370k triangles, mostly bark nobody sees)
export function createTree(preset, seed = 1, { height, shadows = true, leaves = 1, detail = 1, tint, leafType } = {}) {
  const tree = new Tree();
  tree.loadPreset(preset);
  tree.options.seed = seed;
  tree.options.leaves.count = Math.max(1, Math.round(tree.options.leaves.count * leaves));
  if (tint !== undefined) tree.options.leaves.tint = tint;
  if (leafType) tree.options.leaves.type = leafType;
  const b = tree.options.branch;
  for (const k of Object.keys(b.sections)) b.sections[k] = Math.max(1, Math.round(b.sections[k] * detail));
  for (const k of Object.keys(b.segments)) b.segments[k] = Math.max(3, Math.round(b.segments[k] * detail));
  tree.generate();
  if (height) {
    const box = new THREE.Box3().setFromObject(tree);
    tree.scale.setScalar(height / Math.max(1e-3, box.max.y - box.min.y));
  }
  tree.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = shadows;
    o.receiveShadow = true;
    // leaves let light through: without it a bush in shade is a black silhouette
    const m = o.material;
    if (m.alphaTest > 0 && m.map && m.emissive) {
      m.emissiveMap = m.map;
      m.emissive.copy(m.color).multiplyScalar(0.3);
    }
  });
  return tree;
}
