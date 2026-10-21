---
name: perf
description: Measure and improve a house-walk house's speed and memory - GPU memory breakdown, frame time, and the known fixes (KTX2, texture caps, AO, shadow map, quality menu).
---

# Speed and memory

Reply in the user's language. Budget: 60 fps (16 ms a frame) on an Intel Iris Xe laptop at 1080p
on the balanced quality; a phone at 30 fps.

## Measure

1. Open `http://127.0.0.1:5180/?plan=<id>&gpumem` **in a visible browser window** (a hidden pane
   throttles the page: its frame and GPU times mean nothing). The top-left shows fps, GPU ms and
   the render scale when dynamic resolution has dropped it.
2. GPU memory by kind: `__gpuMemory()` in the page (textures by size and format, render targets,
   shadow map, geometry). `await import('/src/dev/fulltest.js'); (await __fullTest()).imageMB`
   gives the texture total too.
3. Frame time per view: stand in the heaviest places (`__house.view(...)`: the street, the living
   room, the garden), fix the scale with `?scale=1` to compare like with like, read the GPU ms.
4. Draw calls and triangles: `__house.renderer.info.render` after a frame.

## Known fixes, cheapest first

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
- **Far furniture** is hidden from more than 14 m outside (`house.interior` in `main.js`).

Report before/after numbers for each change you keep, and undo changes that don't help.

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their bakes.
- A hidden browser pane runs slowly and its timings are unreliable.
- The bake key is the plan without outdoor items. After adding models, run `npm run compress`.
- Indoor AO above ~3 smears walls; dynamic resolution must keep SMAA on.
