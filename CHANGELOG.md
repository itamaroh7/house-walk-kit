# Changelog

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
