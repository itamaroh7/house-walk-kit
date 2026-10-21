# house-walk-kit: guide for agents

A walkable 3D house in the browser (three.js + Vite) built from a plan file. The plan is a small
JavaScript module; the plan kit turns rooms and openings into walls, the builder turns the plan
into a scene, and a light bake gives the rooms their indoor light.

Reply to the user in the language they write in. Code, comments, commit messages: English.

**Asked to build someone a house from this repository? Follow [AGENTS.md](AGENTS.md)** (tools,
setup, design, checks, showing it). This file is the reference it points to.

## Run it

```bash
npm install
npm run assets        # 3D assets into public/ (once; --from <zip> for a local pack)
npm run dev           # http://127.0.0.1:5180/  (?plan=<id>, ?lang=he)
npm run check         # plan kit checks for every plan, in Node
npm run build         # static site in dist/
```

## Coordinates and units

- Metres. **x runs west to east, z runs north to south** (z grows toward the street). y is up.
- The street is always on the south (+z). If the real street side is another compass direction,
  draw the plan with the street at the bottom anyway and set `site.north` (degrees, clockwise
  from the plan's up to true north): the sun turns, the house does not.
- Walls are centre lines. Rooms are outlines on those centre lines, so neighbouring rooms share
  coordinates. Exterior walls are 0.25 m thick, interior 0.12 m (`EXT`, `INT` in kit.js): a room
  drawn 3.4 m wide between centre lines is 3.4 - 0.125 - 0.06 = 3.215 m wide inside.
- Heights: floor level 0.15 m above the ground, ceiling 3.0 m above the floor (world y 3.15),
  roof slab 0.3, parapet 0.45 (`LEVEL` in kit.js, overridable with `level`). Panels and some
  details take **world** heights (floor at y 0.15); furniture `y` options are above the floor.
- Furniture yaw: 0 faces south (+z), 90 east, 180 north, -90 west. A model's front is its +Z.
  Models are centred on (x, z) by their bounding box and stand on the floor.

## The plan format

One file per house in `src/plans/<id>.js`; every file there appears in the picker. Annotated:

```js
import { makePlan, GREY, stones, hedge, lavender } from '../house/kit.js';

export default makePlan({
  id: 'my-house',                                   // ?plan=my-house; part of the bake key
  name: { en: 'My house', he: 'הבית שלי' },          // a string or one per language
  site: {
    plot: [-4, -6, 20, 20],      // plot wall centre lines [x0, z0, x1, z1]; the street runs along z1
    gate: [5.5, 7.1],            // pedestrian gate in the front wall (drawn open)
    carGate: [14.5, 19.5],       // optional: car gate + parking pad + a parked car
    party: 'east',               // optional: semi-detached, the east (or west) outer wall is shared
    north: 0,                    // degrees clockwise from plan-up to true north
    neighbours: true,            // false: an empty field instead of the made-up neighbourhood
  },
  rooms: [
    // rect [x0, z0, x1, z1] or poly [[x, z], ...] (orthogonal, on wall centre lines)
    { id: 'living', name: { en: 'Living room', he: 'סלון' }, rect: [0, 7, 5.4, 11], use: 'living', zone: 'day' },
    { id: 'kitchen', name: 'Kitchen', poly: [[5.4, 7], [9, 7], [9, 11], [5.4, 11]], use: 'kitchen', zone: 'day' },
    { id: 'hall', name: 'Corridor', rect: [0, 5.8, 9, 7], use: 'hall', open: ['living'] },
    { id: 'bed1', name: 'Bedroom', rect: [0, 2, 3.5, 5.8], use: 'bedroom', floor: 'floor_oak', facade: GREY },
    // use: bedroom | living | kitchen | dining | office | bath | shower | wc | laundry | hall |
    //      entry | store | room. Wet uses get tiles; hall-like uses decide which way doors open.
    // zone: rooms with the same zone are one open space (no wall between them).
    // open: ids of rooms this one is open to (no wall), e.g. a corridor open to the entry.
    // floor / walls: library material ids; facade: the outside finish of its exterior walls.
    // safe: true -> steel door and a blast shutter (a reinforced safe room).
  ],
  openings: [
    // on a wall line at its centre (x, z). Kinds and defaults (w, h, sill):
    // door 0.9x2.1 · front 0.9x2.2 · window 1.4x1.3 sill 0.9 · high 0.6x0.5 sill 1.7 ·
    // slider 2.4x2.4 · gap 1.2x2.3 (an opening without a door). shutter: 0..1 roller shutter.
    { kind: 'front', x: 6.3, z: 11 }, { kind: 'window', x: 0, z: 9, w: 1.8 },
    { kind: 'door', x: 1.8, z: 5.8 },
  ],
  outdoor: {
    surfaces: [{ box: [x0, z0, x1, z1], top: 0.13, material: 'floor_porcelain_outdoor' }, ...stones(6.3, 13, 6.3, 19.6, 7)],
    pergolas: [{ box: [x0, z0, x1, z1], height: 3.05, side: 'south', material: 'wood_walnut' }],   // side = open side
    canopies: [{ box: [...], height: 2.75, side: 'south', material: 'cladding_anthracite' }],      // solid roof
  },
  details: {   // all optional
    solarHeaters: [[x, z, yaw]], acUnits: [[x, 3.45, z, yaw]], downpipes: [[x, z]], wallLights: [[x, y, z]],
    splitACs: [[x, y, zFace, 'z-']], sockets: [[x, y, zFace, 'z+']], groundACs: [[xFace, z, 'x+']],
    edging: [[x0, z0, x1, z1, top]], panels: [[material, x0, x1, z0, z1, y0, y1]],   // world heights
  },
  garden: { trees: [['Oak Small', x, z, seed, height]], bushes: [...hedge(...)], beds: [{ kind: 'lavender', clumps: lavender([x0, z0, x1, z1]) }] },
  furniture: [['interior/sofa_modern', x, z, yaw, { scale, mount, ceiling, y, recolor, mirror }]],
});
```

Furniture options: `mount` keeps a wall-mounted model's own height (WC, basin, wall units, art);
`ceiling` hangs it from the ceiling (pendants); `y` raises it (things on a table: 0.39 coffee
table, 0.75 dining table); `scale`; `recolor: { materialName: [r, g, b] }`; `mirror`.
Library models are listed in `public/library/catalog.json` (id, size [x, y, z] in metres);
materials in `public/library/materials/index.json`. Tree presets: `TREE_PRESETS` in
`src/engine/lib/trees.js`.

## The checks

`makePlan` never throws; it lists problems in `plan.problems`, shown on screen in red and by
`npm run check` (exit code 1):
- an opening not on a wall, running past its wall, or of an unknown kind
- an opening in the party wall
- a bedroom, living room, kitchen, dining room or office without daylight (a window, slider or
  gap in an outside wall that is not the party wall; rooms in one open space share light)
- rooms that overlap; rooms no door, gap or open space leads to from outside
- rooms smaller than sensible for their use; a house that does not fit inside its plot

Once the assets are in `public/`, `npm run check` also runs the layout check
(`src/house/layout-check.js`, no browser needed): furniture standing in a wall, in other
furniture, or narrowing a door, slider or gap below 0.6 m, and a walk on a 10 cm grid from the
street gate into every room (unreachable rooms, rooms with under 12% of their floor reachable).
It uses the model sizes in `public/library/catalog.json` and agrees closely with the browser test
below, which stays the final word (it sees the real models and door leaves).

In the browser, `await import('/src/dev/fulltest.js'); await __fullTest()` walks the plan with
the walker's real collision: every room reachable from the street gate, the walk in through the
front door, tight rooms (<12% of the floor reachable, wet rooms excepted), furniture overlapping
furniture or an open door leaf. `ok: true` when all pass. Fix furniture positions from its
messages (coordinates are given).

## Test hooks (browser console or javascript tool)

- `__house.view(x, z, lookX, lookZ, pitch = 0.05, first = true)`: stand the walker and settle.
- `__house.look(px, py, pz, lx, ly, lz)`: free camera (top-down: `look(cx, 30, cz + 0.01, cx, 0, cz)`).
- `__house.tick(dt)`: run one frame by hand (a hidden page gets no animation frames).
- `__house.house.roomAt(x, z)`, `.doors`, `.obstacles`; `__house.plan`; `__house.bake`.
- `__fullTest()` (above); `__gpuMemory()` with `?gpumem` (GPU allocations by kind).
- URL: `?plan=<id>`, `?lang=en|he`, `?scale=0.8` (fixed render scale), `?gpumem`, `?rebake`,
  `?fp` (start in first person), `?touch` (phone controls on a desktop), `?ao=`, `?ev=`, `?lamps=`.
- Keys: T top view, M dimensions, V first/third person, E door, H help.

## Light bake

The indoor light is an irradiance volume baked in the browser on first load (1-5 minutes; a
progress bar shows it). The key is a hash of the plan **without** outdoor dressing (trees,
bushes, bins, street lights, edging, ground ACs, recolours, wall pictures) and without names, so
changing those does not rebake. In dev the bake is saved to `public/gi/<key>.bin` and shipped
with the build; the browser also caches it in IndexedDB. Delete stale `public/gi/*.bin` files of
a plan after it changes (only the newest key is used).

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their bakes: finish the edits,
  then bake once. Keep one tab of the app open.
- A hidden browser pane runs slowly (throttled timers, no animation frames) and its frame and GPU
  timings are not reliable: use `__house.tick`, and measure performance with the page visible.
- After adding or replacing library models, run `npm run compress` (KTX2 textures), or they load
  as large uncompressed images.
- Indoor ambient occlusion above ~3 (`?ao=`) smears dark patches on the walls.
- Dynamic resolution must keep SMAA on: at 70-80% without it the picture looks pixelated.
- Exposure eases in over ~2 s after a jump between outside and inside: tick ~90 frames before
  judging brightness in a screenshot.

## Already solved (don't redo, don't undo)

Most of this kit's realism and speed came from fixing problems one by one. Keep these:
- **Memory**: textures are KTX2 (Basis) and stay compressed on the GPU; equal textures inside
  different models and LOD levels are shared by name (`load-model.js`); decoded images are let
  go after upload (`texture-memory.js`); small models and detail maps are capped at 512 px. A
  house takes ~0.5 GB of GPU memory, not 2-4 GB.
- **Speed**: one mesh per material for the house; trees and bushes merged; the sun's shadow map
  (2048) is drawn once and again only when a door moves; indoor furniture casts no sun shadow and
  is hidden from far outside; grass is hidden indoors; furniture switches to lighter levels early;
  dynamic resolution (never below 70-80%, SMAA always on); a quality menu; phones get pixel ratio
  1 and a lighter picture.
- **Loading**: the light bake ships as a file (`public/gi`), so visitors don't wait; a progress
  bar with MB and time left (`public/load-size.json`); `loading.js` is its own small script.
- **Light and look**: sun from the south-south-east of true north at 43 degrees; indoor exposure
  adapts when you step in; window glass with Fresnel reflection that lets the sun in; mirrors and
  glossy furniture reflect their own room; contact shadows under furniture; ACES with fine grain.
- **Deploying**: `npm run build` trims `dist/` to the models the plans use and their current
  bakes; `public/_headers` lets browsers cache the 3D files; the `share` skill has the hosting
  lessons (bandwidth, Netlify credits, passwords).
- **Assets**: `compress-textures` sizes textures to multiples of 4 (other sizes fail to upload
  and draw black).

## Performance budget

Target: 60 fps (16 ms a frame) on an Intel Iris Xe laptop at 1080p with the balanced quality.
The quality menu (fast / balanced / high) sets the pixel ratio, AO and how far dynamic resolution
may drop (70% / 80% / never). Known costs: textures (KTX2 keeps them ~4x smaller), the sun's
shadow map (2048), AO, plants (alpha-tested leaves), grass (hidden indoors), interior furniture
(hidden from far outside).

## Files

- `src/main.js` app; `src/i18n.js` every UI string (en, he); `src/loading.js` progress bar
- `src/house/kit.js` plan kit + checks; `site.js` plot/street/neighbourhood; `build.js` the scene;
  `gi.js` light bake; `bake-key.js` its file name; `layout-check.js` the browser-free layout check;
  `dimensions.js` the M overlay; `walker-shadow.js`
- `src/engine/**` sky, grass, post-processing, character, player, loaders
- `tools/` assets (fetch, pack, compress), `check-plans.mjs`, `prune-dist.mjs`, `new-project.mjs`, `set-owner.mjs`
- `skills/` the Claude Code plugin's skills; `.claude-plugin/` its manifests
