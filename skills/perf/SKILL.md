---
name: perf
description: Measure and improve a house-walk house's speed and memory - frame rate on this computer (npm run bench), CPU vs GPU diagnosis, GPU memory, and the known fixes (batching, frozen matrices, KTX2, texture caps, AO, shadow map, quality menu). Use when the house is slow, stutters or uses a lot of memory, on any computer, or to update a project made with an older version of the kit.
---

# Speed and memory

Reply in the user's language. Budget: 60 fps (16 ms a frame) on an Intel Iris Xe laptop at 1080p
on the balanced quality; a phone at 30 fps. The method and the reasons behind every fix are in
`docs/performance.md`: read it before changing the engine.

## Measure

1. **Frame rate on this computer**: with `npm run dev` running, `npm run bench` (add
   `-- --plan <id> --quality fast|balanced|high`). It opens Chrome or Edge in the background with
   the real GPU and no 60 fps cap and prints fps, the 90th-percentile frame and the GPU ms inside
   the house and from the street. Below 60 fps it says where.
2. **CPU or GPU?** Compare the GPU ms with the frame time (`median`). GPU ms close to the frame
   time: the GPU is the limit (resolution, AO, plants, shadows: the quality menu helps). GPU ms far
   below it: the CPU is the limit (draw calls, matrices, shader changes: the quality menu does
   **not** help). `npm run bench -- --profile` lists the functions that take the CPU time.
3. **Did the engine's speed-ups apply?** `npm run bench -- --compare` runs with them off
   (`?fast=0`) and on, alternately. On is usually 1.3-2x faster. `__house.batch` (models, batches,
   skipped) and `__house.frozen` in the page show what was batched and frozen; `?batch=0` and
   `?freeze=0` turn one off.
4. **Draw calls and triangles**: `__house.renderer.info.render` after a frame (a house of 150
   models should be ~200-300 calls, not 700+).
5. **GPU memory by kind**: `?gpumem` and `__gpuMemory()` in the page (textures by size and format,
   render targets, shadow map, geometry). `await import('/src/dev/fulltest.js'); (await __fullTest()).imageMB`
   gives the texture total too.

Never trust timings from a hidden browser pane or a background tab (throttled: the same frame
reads 20-40 ms). Compare like with like and alternate runs; a warm or busy laptop drifts 10-20%.

## Known fixes, cheapest first

CPU side (the quality menu can't fix these):
- **Batching** (`src/engine/lib/batch-static.js`): every still model is drawn through a
  `BatchedMesh` per material. A model that is skipped (`__house.batch.skipped`) has a mesh that
  can't join: a multi-material mesh, geometry groups, morph targets, its own `onBeforeRender`, or
  `frustumCulled = false`. Fix the model, or skip only what really moves.
- **Frozen matrices** (`freeze-static.js`): the house's matrices are computed once. Anything
  that moves after loading is passed in `moving` and updated with `updateMatrixWorld(true)` when
  it moves (door leaves do this). `scene.matrixAutoUpdate` must stay false.
- **No per-frame material changes**: `needsUpdate`, `transparent`, `side`, `alphaTest` changed
  every frame rebuild shader parameters (`getParameters`/`getProgramCacheKey` high in
  `--profile`). Change uniforms instead. Transparent double-sided materials get
  `forceSinglePass = true` (`singlePassTransparency`).
- **Clipping planes** only while the top view is on (`renderer.localClippingEnabled`).

GPU side:
- **Textures as KTX2**: run `npm run compress` after adding or changing models (uncompressed
  images take ~4x the GPU memory). Check that `public/library/**` has no new WebP/JPEG-only models.
- **Texture caps**: `loadLibraryModel(..., { maxTexture, maxSmallTexture, maxDetailTexture })`
  in `src/engine/lib/load-model.js` / `build.js` (512 for small models and detail maps).
- **Ambient occlusion**: indoor strength `?ao=` (default 2.5; above ~3 it smears dark patches on
  walls); the fast quality turns AO off.
- **Shadow map**: `sun.shadow.mapSize` in `src/main.js` (2048; 4096 costs ~130 MB and time).
- **Quality menu** (bottom-left): fast = pixel ratio 1, no AO, may drop to 70%; balanced = up to
  1.5x, drops to 80%; high = never drops. Phones use pixel ratio 1 automatically.
- **Dynamic resolution** (`adaptResolution` in `main.js`): must keep SMAA on - without it the
  picture looks pixelated at 70-80%.
- **Plants**: fewer or smaller trees and bushes, `leaves`/`detail` options in `build.js`
  (alpha-tested leaves are expensive); grass is already hidden indoors.
- **Far furniture** is left out from more than 14 m outside (`interiorRange` in `main.js`).

Report before/after numbers for each change you keep (`npm run bench -- --compare` or two
`npm run bench` runs), and undo changes that don't help.

## Slow on someone else's computer

Ask them to run `npm run bench` and send the output. Then:
- A red box "drawing without the graphics card", or a GPU name with SwiftShader, llvmpipe or
  Basic Render: hardware acceleration is off (Chrome: Settings, System, "Use graphics
  acceleration when available"; restart the browser). `chrome://gpu` should say "Hardware
  accelerated" for WebGL.
- A laptop on battery or hot slows its graphics chip: plug in. A laptop with two graphics chips:
  Windows Settings, Display, Graphics, give the browser the high-performance one.
- An old copy of the project (no `src/engine/lib/batch-static.js`): projects made before 0.4.0
  lack the CPU-side speed-ups and run at about half the speed. Update it (below).
- A 4K or high-DPI screen: suggest the *fast* quality.

## Update an older project

The user's own work is `src/plans/` (their plans), `public/gi/` (their baked light) and anything
they asked you to change. Keep it; never delete or overwrite it without asking.
- A git clone of the kit (`git remote -v` shows house-walk-kit): `git status` first; commit or
  set aside the user's changes with their OK, then `git pull`. Resolve conflicts in their favour
  for plans, in the kit's favour for engine files they did not change.
- A copy made by `/house-walk:new` (no git): update the plugin
  (`claude plugin update house-walk@house-walk-kit`), then compare and copy the engine from
  `${CLAUDE_PLUGIN_ROOT}`: `src/main.js`, `src/i18n.js`, `src/loading.js`, `src/touch.js`,
  `src/engine/`, `src/house/`, `src/dev/`, `tools/`, `index.html`, `vite.config.js`, `CLAUDE.md`,
  and the `scripts` of `package.json`. Diff each against the project first: where the project
  changed a file on purpose, merge instead of overwriting, and tell the user.
- Then `npm install`, `npm run check`, open the house, and `npm run bench -- --compare` to show
  the gain.

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their bakes.
- A hidden browser pane runs slowly and its timings are unreliable: use `npm run bench`.
- The bake key is the plan without outdoor items. After adding models, run `npm run compress`.
- Indoor AO above ~3 smears walls; dynamic resolution must keep SMAA on.
- three.js r170: a `BatchedMesh` needs `colorTexture = null` or it recomputes its shader
  parameters on every draw (`batch-static.js` does it; keep it after a three.js upgrade until
  the renderer reads `_colorsTexture`).
- A material shared between a batch and a plain mesh switches shaders on every draw: batches use
  their own material copies.
