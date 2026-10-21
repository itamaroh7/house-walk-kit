---
name: check
description: Check a house-walk plan - the plan kit's checks plus the in-browser full test (reachability from the gate, walking in, furniture and open-door overlaps, tight rooms) - and fix what fails.
---

# Check a house plan and fix it

Reply in the user's language. Read the project's `CLAUDE.md` (plan format, coordinates).

## 1. Kit checks (Node, fast)

```bash
npm run check                      # every plan
node tools/check-plans.mjs src/plans/<id>.js
```

It lists, per plan: openings not on a wall or past its end, openings in the party wall, rooms
without daylight, overlapping rooms, rooms no door leads to, rooms too small, a house outside its
plot. Fix the plan file and run it again until it says `checks: OK`.

## 2. Full test (browser)

Make sure the dev server runs (`npm run dev`, port 5180) and open
`http://127.0.0.1:5180/?plan=<id>`. Wait until `window.__house?.tick` exists (the light bake may
take minutes the first time). Then run in the page:

```js
await import('/src/dev/fulltest.js'); await __fullTest()
```

It returns `{ ok, unreachable, tight, overlaps, walk, rooms }`:
- `unreachable`: rooms the walker cannot reach from the street gate (a missing door, furniture
  blocking a doorway, a door too narrow - the walker is 0.5 m wide).
- `walk`: `OK ...` or `STUCK at (x, z)`: the walk from the gate in through the front door.
- `overlaps`: furniture inside other furniture or an open door leaf, with positions and sizes.
- `tight`: rooms with under 12% of the floor reachable (too much furniture).
- `rooms`: the reachable share of every room.

Fix the causes in the plan (move or resize furniture with `scale`, move a door, widen a path),
then reload and run it again. Keep going until `ok: true`. Also check the console for errors.

## 3. Report

Tell the user what was wrong and what you changed, in plain words, with a screenshot of anything
visual. Do not commit unless the user asks.

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their bakes: make all fixes, then
  reload once.
- A hidden browser pane runs slowly; the full test drives frames itself (`__house.tick`), so it
  works there, but don't trust its timings.
- The bake key is the plan without outdoor items: moving furniture rebakes, moving trees does not.
- After adding models, run `npm run compress`. Indoor AO above ~3 smears walls; dynamic
  resolution must keep SMAA on.
