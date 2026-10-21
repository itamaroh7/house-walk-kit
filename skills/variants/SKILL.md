---
name: variants
description: Design several alternative house-walk plans under stated constraints (plot, party wall, room list, no skylights...), check each one and compare their areas in a table.
---

# Plan variants

Reply in the user's language. Read the project's `CLAUDE.md` first.

## 1. Pin down the constraints

Collect, from the user's message and the current plan: how many variants (default 3), the plot
(size, street side, north), a party wall (semi-detached: no openings in it), the room list
(bedrooms, bathrooms, office, safe room, laundry...), sizes that must hold, the style, and what is
not allowed (no skylights, no windowless bedrooms, no rooms reached only through another room...).
Ask once, in one message, only for what is missing and matters.

## 2. Design each variant as its own plan file

- `src/plans/<base>-a.js`, `-b.js`, `-c.js`... each with its own `id` and a name that says the
  idea in a few words ("A - patio to the west", "B - L around the garden").
- Make the variants really different (layout idea, where the day space and the garden meet, the
  entrance), not small shifts.
- Write all files first, then run `npm run check` until every variant passes. Only then open them
  in the browser one at a time and run `__fullTest()` for each (see the `check` skill); fix
  until `ok: true`.

## 3. Compare

Give a table, one row per variant:

| Variant | Idea | Rooms | Net area (m²) | Gross (m²) | Yard (m²) | Under pergola (m²) | Notes |

Net and gross areas: `__house.dims.totals` in the page (`gross`, `netTotal`, `width`, `depth`;
the same numbers as the M legend), plot from `__house.plan.site.plot`, yard = plot - gross.
`npm run check` prints each plan's rooms and plot without a browser. Add a top view per variant (see `tour`) and
say which one you would pick and why, in two sentences.

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their bakes: write all variants,
  then bake them one at a time (one tab).
- A hidden browser pane runs slowly; timings there are unreliable.
- The bake key is the plan without outdoor items; each variant bakes once (1-5 min).
- After adding models, run `npm run compress`. Indoor AO above ~3 smears walls; dynamic
  resolution must keep SMAA on.
