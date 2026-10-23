---
name: from-plan
description: Design a house-walk plan file - from a floor-plan image or PDF, from a description, or invented from scratch - then check it and show the walkable 3D house.
---

# A house: from a drawing, a description or nothing

Reply in the user's language. Work in a house-walk project (it has `src/house/kit.js`); if there
is none, follow the `new` skill first. Read the project's `CLAUDE.md` (plan format, coordinates,
checks) and copy the structure of `src/plans/example.js`.

Three starting points - pick the one that fits and don't ask more than you need:

## A. From a drawing (photo, scan, PDF)

Read it like an architect, not by eye: every number comes from the drawing, every edge is
checked before anything is built (`docs/reading-a-drawing.md` has the method in full). A PDF:
render the page to an image first. Working files go in `drawing-work/` (git-ignored; never put a
user's drawing or its crops anywhere else).

1. **Scale from the drawing's own dimension strings.** Find 3-5 dimension chains (thin lines with
   ticks and numbers, usually along the outside). For each segment: tick-to-tick pixels / its
   number = pixels per cm. Do x and y separately; they must agree. Ask the user for a measurement
   only if the drawing has no dimensions at all.
2. **Read with a pixel grid.** `npm run drawing:grid -- <image> <x0> <y0> <x1> <y1> --zoom 3` for
   each area: read wall faces, door openings (a gap with an arc; the hinge is the arc's centre),
   windows (marks in the wall, labels like `120 / 100 / UK=110` = width / height / sill) and
   fixtures as pixel coordinates. A dimension line (thin, ticked, a number on it) is not a wall face.
3. **Check every room against the area written in it** (and its own dimension strings). A
   mismatch means a misread wall: find it before building. If the drawing contradicts itself (a
   label vs. what is drawn), build what is drawn and tell the user.
4. **Overlay before building.** Write the plan, then
   `npm run drawing:overlay -- <image> <plan-id> --scale <px per metre> --origin <px,py>` (origin:
   the drawing's pixel of the plan's (0, 0)) and look at it: every room edge on a wall, doors
   green, sliders and gaps orange, windows magenta in their openings. Fix until it all sits.
5. Ask, in one short message, only what the drawing does not say: which side faces the **street**
   (draw it at the bottom, south, +z), where **north** is (`site.north`), a **shared wall**
   (`site.party: 'east'|'west'`). Find the front door in the drawing (arrow, arc to the outside).
6. **More than one floor** (usually one drawing each): one set of coordinates for all - line the
   drawings up on the stairs and an outer wall. Upper rooms, openings and furniture get
   `storey: 1` (2...); add `stairs: [{ from, box, up }]` (a U-shaped stair becomes the straight
   flight that fits its well). `src/plans/example-two-storey.js` is a whole two-storey house.
7. Things the library lacks at the drawn size (a 1.2 m counter, a stub wall, a niche): a
   `details.panels` box of exactly that size.
8. **After building:** take a top view (key T or M) and put it beside the drawing:
   `npm run drawing:overlay -- <image> --compare <screenshot.png>`; send that image to the user,
   run the full test, and list what is still unclear (a symbol you could not identify) instead of
   filling it with a guess.

## B. From a description ("3 bedrooms, open kitchen, a big garden")

Design it yourself. Ask at most one question, and only if something essential is missing;
otherwise assume, build, and list the assumptions in two or three lines (size, street side,
style). They will ask for changes after they have walked through it. Take the plan file's
structure from `example.js`, but lay the rooms out for this request (where the garden and the
terrace go, how the day space meets them) instead of stretching the example's layout.

## C. From nothing ("make me a nice house")

Invent a pleasant single-storey family house of 120-160 m2 with 3 bedrooms, two bathrooms, an
open living-kitchen-dining space opening onto a terrace, on a plot of about 500-650 m2. Say in
one line what you chose, build it, and offer changes.

## Design rules (B, C, and anything a drawing leaves open)

- A rectangle or an L is easiest; keep walls on a grid of 5 cm, rooms on wall centre lines.
- Sizes on centre lines: bedroom 3.2-4.2 m a side (main bedroom 12-16 m2), bathroom 2 x 2.5 m+,
  WC 1.2 x 1.6 m+, corridor 1.2 m wide, living 20 m2+, kitchen-dining 20-30 m2.
- Every bedroom, living room, kitchen and office needs a window or slider in an outside wall.
  Bathrooms get a `high` window if they are on an outside wall.
- Doors: 0.9 m (0.8 for bathrooms, 0.7 for a WC), at least 0.15 m from a wall corner. The front
  door (`front`) faces the street side or a path from it.
- Two storeys: a straight stair of about 1.0 x 4.6 m (18 risers for 3.3 m) in a hall at least
  2.3 m wide, with the walkway beside it on both floors and the upstairs doors reachable from
  that walkway or from the top of the flight.
- One open space = rooms with the same `zone`; a corridor open to an entry: `open: ['entry']`.
- Outside: a terrace (surface + pergola) at the living room's slider, a path of `stones` from the
  gate to the front door, a few trees and a hedge (`hedge`, keep it 0.6 m inside the plot wall).

## Placing furniture

Sizes are in `public/library/catalog.json` (`size: [x, y, z]`, metres, the model's front is its
+Z). A model is centred on (x, z). Yaw: 0 faces south (+z), 90 east, 180 north, -90 west; at
90 / -90 its x and z sizes swap.

Against a wall: the wall face is the centre line +- 0.06 (inside walls) or +- 0.125 (outside
walls). Centre = face + depth/2 into the room, facing away from the wall. Example: a wardrobe
(depth 0.64) on the north wall of a room whose north wall is at z = 0: z = 0.125 + 0.32 = 0.445,
yaw 0.

- Beds: headboard against a wall, not under a low window; leave 0.6 m beside and 0.8 m in front.
- Keep 0.8 m paths from every door into the room, and the door's swing (a 0.9 m quarter circle
  on the room side) free.
- Wall-mounted pieces (WC, basin, wall units, pictures): `{ mount: true }` at the wall face;
  pendants: `{ ceiling: true }`; things on tables: `{ y: 0.75 }` (dining) or `0.39` (coffee table).
- Use the models the room needs (bedroom: bed, nightstand, wardrobe; living: sofa, armchairs,
  rug, lamp; kitchen: base runs, wall units, tall units, a table and chairs; bathroom: shower or
  bathtub, WC, vanity). `src/plans/example.js` shows each.

## Check, look, report

1. `npm run check` - it checks the structure (walls, openings, daylight, reachability, plot) and
   the layout (furniture in walls, in other furniture or in door openings, and a walk on a 10 cm
   grid from the street gate into every room). Fix everything it lists; repeat until
   `all plans pass`.
2. Finish all edits, then open `http://127.0.0.1:5180/?plan=<id>` (start `npm run dev` in the
   background if it is not running). The first visit computes the indoor light (1-5 minutes,
   progress bar); the dev server saves it in `public/gi/` - delete older `public/gi/<id>_*.bin`.
3. With a browser tool: run `await import('/src/dev/fulltest.js'); await __fullTest()` in the
   page, fix what fails, and look at a top view (key T, or M for dimensions) next to the drawing.
   Take two or three pictures (see the `tour` skill) and send them.
4. Tell the user the address, how to walk (W A S D + mouse, click first; E doors; T from above;
   M dimensions), and what you assumed. Ask what to change.

Expect about 10-15 minutes to the first house (measured with a clean agent); each later change
takes minutes.

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their bakes: finish edits before baking.
- A hidden browser pane runs slowly and its timings are unreliable (use `__house.tick`).
- The bake key is the plan without outdoor items (trees, bushes, bins, lamps, edging, recolours,
  wall pictures): those don't rebake; walls, rooms, openings and furniture do.
- After adding models, run `npm run compress`.
- Indoor AO above ~3 smears walls; dynamic resolution must keep SMAA on.
- The user's plans stay on their computer: never upload them anywhere.
