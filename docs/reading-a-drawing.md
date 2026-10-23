# Reading a floor-plan drawing

[עברית](reading-a-drawing.he.md)

How to turn an architect's drawing (a photo, scan or PDF of a floor plan) into a plan file that
matches it, wall for wall. Read by eye, a drawing gives a house that is roughly right and wrong
in every detail: a scale taken from one misread number, partitions guessed, a dimension line
taken for a wall. Every step below replaces a guess with a measurement.

The two tools write into `drawing-work/` in the project, which git ignores: a drawing and its
crops stay on your computer.

## 1. The scale comes from the drawing's own dimension strings

Architectural drawings carry chains of dimensions: thin lines with ticks (or small slashes) at
the wall faces and a number for each segment, in centimetres. Use them, not a size someone
remembers.

- Find 3-5 chains, ideally long ones along the outside of the plan, in both directions.
- For each segment: its length in pixels, tick to tick, divided by its number. A chain of
  `150 / 210 / 95 / 340` cm that measures 69 / 97 / 44 / 157 px gives about 0.46 px per cm.
- Work out x (horizontal chains) and y (vertical chains) separately. They should agree within a
  few percent; if they don't, the photo is skewed or a number was misread - find out which.
- Only when a drawing has no dimensions at all, ask for one known measurement.

## 2. Read with a pixel grid

```bash
npm run drawing:grid -- plan.jpg 150 120 520 420 --zoom 3
```

This writes an enlarged crop of that rectangle (in the drawing's pixels) with a grid every 10 px,
bold and numbered every 50 px, in the drawing's own coordinates. Go over the plan area by area and
write down coordinates instead of estimating:

- **Walls**: both faces of each wall (thick lines or hatched bands). Rooms in the plan file sit on
  wall centre lines.
- **Doors**: a gap in the wall with an arc; the arc's centre is the hinge, its radius the leaf.
- **Windows**: marks in the wall, often with a label such as `120 / 100 / UK=110` - width,
  height, sill height (cm).
- **Fixtures**: kitchen runs, WC, shower, bath, beds - where the drawing shows them.

**A dimension line is not a wall.** It is thin, has ticks at both ends and a number on it. Taking
one for a wall face moves a whole row of rooms by its offset.

## 3. Check every room against its written area

Most drawings write each room's area (and often its width and depth) inside it. Compute the area
from your reading: a 1.89 x 2.04 m room is 3.86 m2; an L-shaped room is its rectangle plus its
nook. If your number disagrees with the drawing's, you misread a wall - find it before building.
If the drawing disagrees with itself (the label says one thing, the walls show another), build
what is drawn and tell the person.

## 4. Overlay the reading on the drawing before building

Write the plan file (rooms on wall centre lines, openings at their centres), then:

```bash
npm run drawing:overlay -- plan.jpg my-house --scale 46 --origin 172,153
```

`--scale` is pixels per metre, `--origin` the drawing's pixel at the plan's (0, 0). The tool draws
every room outline in blue, doors in green, sliders and gaps in orange, windows in magenta, over
the drawing. Look at it: every edge should sit on a wall's centre, every opening in its gap. Fix
the plan and run it again until it does. (`--storey 1` for an upper floor.)

## 5. After building: the top view beside the drawing

Open the house, press M (top view with dimensions), take a screenshot, and:

```bash
npm run drawing:overlay -- plan.jpg --compare top-view.png
```

The drawing and the house side by side in one image: send it to the person together with the
link. Then run the full test (`__fullTest()` in the page, or `npm run check`).

## 6. Say what is unclear

A symbol you can't identify, a room whose use isn't written, a dimension that contradicts the
others: list it in your report instead of filling it with a guess. Pieces the model library
doesn't have at the drawn size - a 1.2 m counter, a short stub wall, a niche - can be
`details.panels` boxes of exactly that size.
