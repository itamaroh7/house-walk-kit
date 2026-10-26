# Changelog

## 0.4.0 (2026-10-26)

- About twice the frame rate on ordinary laptops (Intel Iris Xe: 40-45 to 80-95 fps in a house of
  150 models; the examples 86 to 116 and 92 to 143 fps), with the same picture. The limit was the
  processor, which no quality setting touches:
  - every still model is drawn through a `BatchedMesh` per material, equal materials merged
    first (~750 draw calls became ~230; `src/engine/lib/batch-static.js`);
  - the house's matrices are computed once instead of every frame (`freeze-static.js`);
  - transparent double-sided glass and curtains draw in one pass;
  - clipping planes only while the top view is on;
  - a three.js r170 bug that made every batch recompute its shader parameters is worked around.
  `?fast=0` turns them off to compare (`?batch=0`, `?freeze=0` one each).
- `npm run bench`: the frame rate on this computer, inside the house and from the street, with the
  real GPU and no 60 fps cap; `--compare` (speed-ups off and on), `--profile` (where the CPU time
  goes).
- A warning on screen when the browser draws without the graphics card (hardware acceleration
  off), with how to turn it on.
- `docs/performance.md` (English and Hebrew): the whole fast-and-beautiful method, the numbers,
  the rules for keeping it fast and what to check on a slow computer. The `perf` skill measures
  with `npm run bench` and can update a project made with an older version; `new` and
  `AGENTS.md` measure the speed once after the first house.

## 0.3.0 (2026-10-23)

- Reading drawings: scale from dimension strings, gridded crops, area checks, overlay before
  building, side-by-side comparison. The method is section A of the from-plan skill and
  `docs/reading-a-drawing.md` (English and Hebrew).
- `npm run drawing:grid`: an enlarged crop of a drawing with a labelled pixel grid.
- `npm run drawing:overlay`: a plan's rooms, doors, sliders and windows drawn over the drawing;
  `--compare` puts a top view of the built house beside it. Both write to `drawing-work/`
  (git-ignored), so drawings stay on the user's computer.

## 0.2.0 (2026-10-21)

- Houses of up to four storeys: rooms, openings and furniture take a `storey`; straight `stairs`
  between storeys, with the well cut out of the floor above, balustrades, and the walker climbing
  them. Outside walls stop at the next floor where an upper storey stands on them and keep their
  parapet over lower roofs.
- Top view (T) per storey: PageUp / PageDown (a "Floor" button on phones) cuts the house at the
  floor looked at; dimensions (M) per storey with the total of all floors in the legend.
- The light bake covers every storey (three probe levels each) and knows which rooms are on
  which storey, so lower roofs stay outdoors.
- Kit checks for upper rooms standing on nothing, stairs too steep or leading nowhere, doors onto
  thin air; the layout check and the browser full test walk up the stairs and climb every flight.
- A second example: a two-storey house.

## 0.1.0 (2026-10-21)

First public version.

- Template project: a walkable three.js + Vite house built from a plan file, with real sky light,
  baked indoor light (shipped for the example, cached per browser for new plans), first and third
  person, doors that open, top view with the roof cut away (T), architectural dimensions (M),
  touch joysticks on phones, a quality menu, dynamic resolution, KTX2 textures.
- Plan kit (`src/house/kit.js`): rooms and openings in, walls out; checks for openings off a wall,
  openings in a party wall, rooms without daylight, overlapping rooms, rooms no door leads to and
  rooms too small for their use. Semi-detached houses with `site.party`.
- Site generator (`src/house/site.js`): plot wall, gates, parking, street and a made-up
  neighbourhood around any plot; `site.north` turns the sun.
- One example house on a generic plot, with its light bake.
- English and Hebrew (right to left) interface; `?lang=`.
- Browser full test (`__fullTest()`): reachability from the gate, the walk in, furniture and
  open-door overlaps, tight rooms.
- Asset pack (models, materials, sky, character) as a release download with a SHA-256 check
  (`npm run assets`).
- Claude Code plugin `house-walk` with the skills new, from-plan, check, variants, tour, perf and
  share, in the marketplace `house-walk-kit`.
- `AGENTS.md`: any AI coding agent given only this repository's address can install what is
  missing (Node.js, Git), set up, design a house from a drawing, a description or nothing, check
  it and show it.
- Browser-free layout check in `npm run check`: furniture in walls, in each other or in
  doorways, and a walk from the street gate into every room.
- Lean builds: `npm run build` keeps only the models and light bakes the plans use;
  `public/_headers` lets browsers cache the 3D files.
- `public/THIRD-PARTY-NOTICES.txt`: the MIT notices of Microsoft Rocketbox, three.js, ez-tree and
  the Hash without Sine noise hash, shipped with every built site and with the asset release.
