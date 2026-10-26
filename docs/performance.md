[עברית](performance.he.md)

# Fast and beautiful: how a house stays smooth on an ordinary laptop

The kit aims at 60 frames a second on an Intel Iris Xe laptop with the *balanced* quality, while
looking like a photograph. Most of the look is paid for once, before the first frame (the light
bake, compressed textures); most of the speed comes from making each frame cheap for **both** the
graphics chip and the processor. This page is the method, the numbers, and the rules for keeping
it that way when you add things.

## Two budgets, not one

A frame costs time twice:

- **GPU**: drawing the pixels. Resolution, ambient occlusion, shadows, transparent leaves and
  texture memory decide it. The quality menu (fast / balanced / high) and dynamic resolution
  work here.
- **CPU**: preparing the frame in JavaScript and the browser before the GPU draws anything:
  walking the scene, updating matrices, one call per mesh per frame, shader bookkeeping. **No
  quality setting touches this.**

On a laptop the CPU side was the limit: a 170 m² house of 150 furniture models made ~750 draw
calls and spent 20-25 ms of CPU a frame while its GPU work took 9-11 ms. That is why a visitor
could see 40 fps even on the *fast* quality. The fixes below cut the CPU side in half.

## Measure first, in a real browser

- `npm run bench` (with `npm run dev` running): opens Chrome or Edge in the background with the
  real GPU and no 60 fps cap, lets the page's own loop run, and prints frames per second, the
  90th-percentile frame and the GPU time, inside the house and from the street.
- `npm run bench -- --compare`: the engine's speed-ups on and off (`?fast=0`), measured
  alternately so a busy or warm computer does not decide the result.
- `npm run bench -- --profile`: where the CPU time of a frame goes, function by function.
- In the page: `?gpumem` and `__gpuMemory()` (GPU memory by kind), `__house.renderer.info.render`
  (calls and triangles of the last pass), the top-left HUD (fps, GPU ms, render scale).

Do not trust timings from a hidden browser pane or a background tab: the browser throttles them
and the same frame measures anywhere from 20 to 40 ms. Compare like with like (same view, same
quality, alternating runs) and keep a change only if the numbers say so.

## What the engine does

Paid once, before the first frame:

- **Light bake** instead of live lights: the light of the sky, the sun and every ceiling lamp is
  baked into a grid of probes through the house (`src/house/gi.js`) and shipped with the plan
  (`public/gi`). Rooms get soft, bounced light at the cost of one texture lookup.
- **Compressed textures**: KTX2 / Basis (`npm run compress`) stay compressed on the GPU, about a
  quarter of the memory; equal textures in different models and LOD levels are shared, and the
  decoded copies are released after upload (`load-model.js`, `texture-memory.js`).
- **Reflections captured once**: mirrors and glossy furniture reflect their own room from a
  small cube capture taken at load.

Every frame, GPU side:

- **The sun's shadow map is drawn once** (2048) and again only when a door moves; indoor furniture
  casts no sun shadow.
- **Ambient occlusion** at strength 2.5 indoors (above ~3 it smears walls), off on *fast*.
- **Dynamic resolution** drops to 80% (70% on *fast*) when the GPU is busy, **with SMAA always on**
  (without it the picture looked pixelated); light sharpening only.
- **Levels of detail**: every model has three; furniture switches early; furniture deep in the
  house is skipped from more than 14 m outside; grass is hidden indoors; trees and bushes are
  merged into a few meshes.

Every frame, CPU side (`src/engine/lib/batch-static.js`, `freeze-static.js`, `src/main.js`):

- **Batching by material**: after the house is built, every mesh of every still model goes into a
  `THREE.BatchedMesh` per material. Materials that draw the same (steel, oak, a fabric arriving
  separately in each model file) are made one first, so a batch gathers that surface from every
  model. Each copy still picks its level of detail by distance. ~750 draw calls became ~230.
- **Frozen matrices**: the renderer recomputes every object's matrix every frame. The house never
  moves, so its matrices are computed once and the renderer no longer walks it; the scene's own
  matrix is frozen too (otherwise it flags every object as changed each frame). Only door leaves
  update, when they move.
- **One pass for glass and sheer curtains**: three.js draws a transparent double-sided material
  twice and flags it as changed before each pass, so its shader was worked out again for every
  pane twice a frame. `forceSinglePass` looks the same for thin glass and cloth.
- **Clipping only in the top view**: the cut-away planes were evaluated for every draw of the
  walk; now they are on only while the view from above is.
- **A three.js r170 bug worked around**: the renderer asks a batch for `colorTexture`, which
  `BatchedMesh` stores as `_colorsTexture`; `undefined !== null` made every batch recompute its
  shader parameters on every draw. Each batch sets `colorTexture = null`.

## Numbers (Intel Iris Xe, 1264 x 625, Chrome)

| House | Quality | View | Before | After |
|---|---|---|---|---|
| 170 m², 150 models | fast | inside / street | 41-45 / 39-43 fps | 80-97 / 80-94 fps |
| 170 m², 150 models | balanced | inside / street | 42-48 / 41 fps | 84-95 / 73-83 fps |
| `example` | balanced | inside / street | 86 / 62 fps | 116 / 79 fps |
| `example-two-storey` | fast | inside / street | 92 / 67 fps | 143 / 99 fps |

The picture is unchanged: a pixel comparison of the same view before and after differs only by
the film grain.

## Rules when you add things

- Furniture and fittings that stand still are batched automatically. Anything that **moves or
  changes per copy** after loading (a door leaf, a lamp that switches, a recoloured copy changed
  at run time) must be skipped by `batchStatic`'s `skip` and, if it moves, updated with
  `object.updateMatrixWorld(true)` when it changes (the frozen house does not do it for you).
- Never set `material.needsUpdate` or change `transparent`, `side` or `alphaTest` every frame:
  each change rebuilds the shader's parameters. Change uniforms (colour, opacity, intensity).
- Give transparent double-sided materials `forceSinglePass = true`.
- Prefer one material per surface: equal materials in different models are merged into one batch,
  slightly different ones (a different colour or texture) are separate draws.
- No per-object `onBeforeRender` on static meshes; it keeps them out of the batches.
- Run `npm run bench -- --compare` before and after a change that could cost speed.

## Still slow on someone's computer?

- A red box saying the browser draws **without the graphics card** (SwiftShader, llvmpipe, Basic
  Render): turn on hardware acceleration (Chrome: Settings, System, "Use graphics acceleration when
  available") and restart the browser.
- `chrome://gpu` should say "Hardware accelerated" for WebGL. On a laptop with two graphics chips,
  Windows Settings, Display, Graphics can give the browser the stronger one.
- Laptops slow the graphics chip on battery and when hot: plug in.
- A 4K or high-DPI screen has many more pixels: the *fast* quality draws at the screen's own
  pixel size.
- `npm run bench` on that computer tells which side is the limit: if the GPU time (HUD) is far
  below the frame time, it is the CPU (close heavy tabs and extensions); if they are close, it is
  the GPU (lower the quality).
