# Instructions for AI agents

You were given this repository's address (https://github.com/itamaroh7/house-walk-kit) and asked to
build someone a 3D house they can walk through: from a floor-plan photo, scan or PDF, from a
description ("3 bedrooms, open kitchen, a garden"), or from nothing at all ("make me a nice
house"). This page is the whole procedure. Follow it from the top; don't stop after setting up.

The person may not be technical. Reply in their language, in plain words, and tell them briefly
what you are doing at each step (installing, downloading, designing, checking).

## 1. Make sure the tools are there

Check: `node --version` (needs 18.17 or newer; 20 or 22 LTS is best) and `git --version`.

If one is missing or too old, **install it yourself** (tell the person in one line first; the
installer may ask them to approve it or for an administrator password):

| System | Node.js | Git |
|---|---|---|
| Windows | `winget install -e --id OpenJS.NodeJS.LTS` | `winget install -e --id Git.Git` |
| macOS | `brew install node` (or the installer from https://nodejs.org) | `brew install git` or `xcode-select --install` |
| Linux | `sudo apt install -y nodejs npm` (check the version; if older than 18 use https://github.com/nvm-sh/nvm: `nvm install --lts`) | `sudo apt install -y git` |

After installing on Windows the current terminal does not see the new programs: open a new
shell, or call them by full path (`"C:\Program Files\nodejs\node.exe"`,
`"C:\Program Files\nodejs\npm.cmd"`, `"C:\Program Files\Git\cmd\git.exe"`), or reload PATH
(PowerShell: `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`).
If winget or brew is missing too, send the person to https://nodejs.org (the LTS button) and
continue when they say it is installed. Git is optional: without it, download
https://github.com/itamaroh7/house-walk-kit/archive/refs/heads/main.zip and unzip it instead.

## 2. Get the project

Work in the person's current folder.
- Empty folder: `git clone --depth 1 https://github.com/itamaroh7/house-walk-kit .`
- Folder with their files (the floor plan): `git clone --depth 1 https://github.com/itamaroh7/house-walk-kit house-walk`
  and work inside `house-walk/` (leave their files where they are).

Then, inside the project:

```bash
npm install
npm run assets
```

`npm run assets` downloads the 3D models, materials, sky and walking person (about 130 MB, once)
and checks their SHA-256. It takes a minute or a few, depending on the connection.

## 3. Design the house

Read `CLAUDE.md` (the plan format, coordinates and units) and `skills/from-plan/SKILL.md` (how
to read a drawing, what to ask, how to design from a description or from nothing, how to place
furniture). Then write `src/plans/<id>.js` with `makePlan({...})`, using `src/plans/example.js`
as the model to copy.

- **With a drawing**: read it like an architect - the scale from its own dimension strings,
  walls and openings from gridded crops (`npm run drawing:grid`), every room against its written
  area, and the plan laid over the drawing (`npm run drawing:overlay`) before building
  (`docs/reading-a-drawing.md`). Ask only what it cannot tell you (which side faces the street,
  where north is, a shared wall).
- **Several storeys**: one drawing per floor is normal. Put every floor in the same coordinates
  (line them up on the stairs and an outer wall), give upper rooms, openings and furniture
  `storey: 1` (2, ...), and add the `stairs`. Up to four storeys.
- **With a description, or nothing**: don't interrogate the person. Design a sensible house
  that fits what they said, state your assumptions in two or three lines, and build it; they
  can ask for changes afterwards.

## 4. Check it

```bash
npm run check
```

It checks the walls, openings, daylight, that every room can be reached, that furniture does
not stand in walls, in other furniture or in doorways, and that one can walk from the street
gate into every room. Fix the plan until it says `all plans pass`.

## 5. Show it

Start the dev server in the background: `npm run dev` (it prints the address, normally
http://127.0.0.1:5180/; add `?plan=<id>`). Only one server: if one is already running for this
folder, use it.

- **If you have a browser tool** (a built-in browser pane, a browser extension): open the
  address, wait for it to load (the first visit of a new plan computes its indoor light: 1-5
  minutes, with a progress bar), run `await import('/src/dev/fulltest.js'); await __fullTest()`
  in the page, fix what fails, and take a picture or two.
- **If you have no browser tool, stop at `npm run check`** - it already checks what the browser
  test checks. Do not install, launch or script a browser of your own (headless Chrome/Edge,
  Playwright, Puppeteer...): it costs half an hour and adds nothing. Give the person the address
  and tell them the first load computes the light for 1-5 minutes.

**Speed**: once the house has loaded (its light is baked), run `npm run bench -- --plan <id>` once. It uses the
Chrome or Edge already installed (nothing to install, about a minute) and prints the frame rate
inside the house and from the street. Below 60 fps, follow "Slow on someone else's computer" in
`skills/perf/SKILL.md` (hardware acceleration off and laptops on battery are the usual causes)
and tell the person what to change.

The whole job should take about 10-15 minutes; tell the person when the house is ready rather
than polishing it further on your own.

Tell them how to walk around: W A S D and the mouse (click the picture first), Shift to run,
E opens doors, T shows the house from above, M shows the dimensions; on a phone, the two
joysticks. Ask what they would like to change.

## Rules

- Never publish, upload or deploy anything without the person's explicit yes to that step.
- Their plans and photos stay on their computer.
- Keep one browser tab of the app open while editing plans: each edit reloads it and restarts
  the light computation.

More: `skills/check`, `skills/variants` (several alternatives), `skills/tour` (pictures),
`skills/perf` (speed: `npm run bench`, and updating an older project), `skills/share` (publishing,
only on request). How the house stays fast: `docs/performance.md`.
