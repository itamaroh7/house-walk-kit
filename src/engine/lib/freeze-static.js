// Stops three.js from recomputing, every frame, the matrices of things that never move. The
// renderer calls scene.updateMatrixWorld() before each frame, which recomposes every object's
// matrix from its position, rotation and scale and multiplies it by its parent's: for a house of
// ~6000 objects (a hundred models of ten meshes and three levels each, the street and its
// neighbours) that was 10-13 ms of CPU a frame on a laptop, before a single triangle was drawn,
// and no quality setting could lighten it.
//
//   freezeStatic(house.group, { moving: doorLeaves });
//   // whenever a moving object changes: leaf.updateMatrixWorld(true)
//
// Everything under root gets its matrices computed once and is then left alone: root answers the
// renderer's per-frame update without walking its tree (three.js would otherwise still visit
// every object to reach the children, a few ms on its own). The objects in `moving` (and what
// hangs under them) keep updating their own matrices, but the renderer no longer reaches them
// through the frozen tree, so the caller updates them when they move. A forced update
// (updateMatrixWorld(true)) still goes all the way down.
export function freezeStatic(root, { moving = [] } = {}) {
  root.updateMatrixWorld(true);
  const keep = new Set();
  for (const m of moving) m.traverse((o) => keep.add(o));
  let frozen = 0;
  root.traverse((o) => {
    if (keep.has(o)) return;
    o.matrixAutoUpdate = false;
    o.matrixWorldAutoUpdate = false;
    frozen++;
  });
  const update = root.updateMatrixWorld.bind(root);
  root.updateMatrixWorld = (force) => { if (force) update(true); };
  return { frozen, unfreeze() { root.updateMatrixWorld = update; } };
}

// Transparent double-sided surfaces (window glass, sheer curtains) are drawn in one pass. three.js
// draws such a material twice, back faces then front faces, and flags it as changed before each
// pass, so the shader's parameters were worked out again for every pane and curtain twice a frame
// (a sixth of the frame's CPU in a house). For thin glass and cloth one pass looks the same.
export function singlePassTransparency(root) {
  let n = 0;
  root.traverse((o) => {
    for (const m of o.material ? [].concat(o.material) : []) {
      if (m.transparent && m.side === 2 && !m.forceSinglePass) { m.forceSinglePass = true; n++; }
    }
  });
  return n;
}
