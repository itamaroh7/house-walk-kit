---
name: tour
description: Take pictures of a house-walk house - a top view with the roof cut away, eye-level shots of each room, the dimensions legend - and send them to the user as images.
---

# A picture tour of the house

Reply in the user's language. The dev server must run (`npm run dev`) and the house must be
loaded in a browser tool (`http://127.0.0.1:5180/?plan=<id>`); wait for `window.__house?.tick`.

## Shots

Use the page's test hooks (see `CLAUDE.md`), then take a screenshot after each:

A key press from a script: `dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM' }))`
(then tick: `for (let i = 0; i < 30; i++) __house.tick(1/30)`).

1. **Top view with dimensions**: key `M` turns on the cut-away top view, straight down, north
   up, with room sizes, outside chains and the legend (gross / net area, plot, yard).
2. **Top view, oblique**: key `M` again hides the dimensions, `T` leaves the top view; `T` once
   more for the cut-away view and `__house.top` to aim it, or a free camera
   `__house.look(cx + 12, 22, cz + 16, cx, 0, cz)` (cx, cz = the middle of
   `__house.house.bounds`; the free camera shows the roof - use it for outside views).
3. **From the street**: `await __house.view(gateX, plotFront + 1.5, gateX, plotFront - 6, 0.05, false)`
   (third person, the walker at the gate).
4. **Each main room at eye level**: `await __house.view(x, z, lookX, lookZ)` from a doorway or a
   corner toward the room's middle or its window. Living room, kitchen, main bedroom at least.
5. **The garden / terrace** from outside, looking back at the house.

Before each screenshot let the exposure settle (`view` and `look` already tick frames; after
other moves run `for (let i = 0; i < 90; i++) __house.tick(1/30)`). If the screenshot looks
stale, take it again.

## Send

Send the images to the user (a file-sending tool if you have one; otherwise save them in the
project, e.g. `screens/`, and give the paths), each with one line saying what it shows. Mention
anything that looks wrong and offer to fix it.

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their bakes: don't edit during a tour.
- A hidden browser pane runs slowly and may return stale frames; its timings are unreliable.
- The bake key is the plan without outdoor items. After adding models, run `npm run compress`.
- Indoor AO above ~3 smears walls; dynamic resolution must keep SMAA on.
