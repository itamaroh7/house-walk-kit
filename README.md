# House Walk Kit

[עברית](README.he.md)

Turn a floor plan - or just an idea of a house - into a house you can walk through in your
browser, with [Claude Code](https://claude.com/claude-code) (or another AI coding agent) doing
the work. Give it a photo or PDF of a floor plan, a description, or nothing at all; about 15
minutes later you walk in through the front door, open doors, look out of the windows and see every
room from above with its dimensions.

![The example house: terrace and front door](docs/terrace.jpg)
![From the street, in third person](docs/street.jpg)
![The example house from above, with dimensions](docs/top.jpg)
![Living room](docs/living.jpg)

It is two things in one repository:

- **A template project** (three.js + Vite): houses of one to four storeys with straight, L or U stairs and double-height rooms, real sky light, baked indoor light, furniture from a
  library of free models, a street and a neighbourhood, first and third person, a top view with
  the roof cut away, architectural dimensions, phone joysticks, English and Hebrew.
- **A Claude Code plugin** (`house-walk`) with skills that set the project up, read your plan,
  check it, design variants, take pictures, tune speed and (only when you say so) publish it.

Your plans stay on your computer. Nothing is uploaded unless you ask for it.

## The quickest way: one message

No installing anything first. Open an **empty folder** in Claude Code (the desktop app's Code
tab, the terminal or VS Code), attach a floor plan if you have one, and send:

```text
Build me a walkable 3D model of my house with https://github.com/itamaroh7/house-walk-kit
```

or, without a drawing:

```text
Build me a walkable 3D house with https://github.com/itamaroh7/house-walk-kit - 3 bedrooms,
an open kitchen and a garden with a pergola.
```

The agent reads [AGENTS.md](AGENTS.md), installs what is missing (Node.js, Git), downloads the
project and the 3D models, designs the house, checks it and opens it in your browser. It asks
only what a drawing can't tell (one measurement, which side faces the street).

**To send to friends** (copy and paste):

```text
Want to walk through your house in 3D? Open an empty folder in Claude Code (claude.com/claude-code),
attach a photo of the floor plan (or just describe the house), and write:
"Build me a walkable 3D model of my house with https://github.com/itamaroh7/house-walk-kit"
```

## What you need

- **Claude Code** (desktop app, terminal or VS Code) with a **Claude Pro, Max, Team or
  Enterprise** plan - or another AI coding agent that can run commands on your computer (it
  follows [AGENTS.md](AGENTS.md)). A plain chat window (claude.ai, ChatGPT) can't: the house
  runs as a small local web server.
- **Node.js 18.17 or newer** and **Git**: the agent checks them and installs what is missing
  (you may be asked to approve the installer). By hand: Windows `winget install OpenJS.NodeJS.LTS`
  and `winget install Git.Git`; macOS `brew install node git`; Linux your package manager or
  [nvm](https://github.com/nvm-sh/nvm).
- A computer with a reasonable graphics chip (an ordinary Intel Iris Xe laptop runs it at 80-95
  fps; `npm run bench` measures yours) and about 500 MB free.

## Install the plugin (optional, for regular use)

The plugin adds ready-made skills (`/house-walk:new`, `/house-walk:check`, `/house-walk:variants`...)
so Claude Code knows the procedure without reading the repository first.

**Terminal (CLI):**

```bash
claude plugin marketplace add itamaroh7/house-walk-kit
```

```bash
claude plugin install house-walk@house-walk-kit
```

(or inside a session: `/plugin marketplace add itamaroh7/house-walk-kit`, then
`/plugin install house-walk@house-walk-kit`)

**Desktop app:** add the marketplace once from a terminal (the first command above, or
`/plugin marketplace add itamaroh7/house-walk-kit` in any Claude Code session), then in the Code tab
click **+** next to the prompt box, **Add plugins**, choose **house-walk** and install it.

**VS Code:** type `/plugins` in the Claude Code prompt box; on the **Marketplaces** tab add
`itamaroh7/house-walk-kit`, then on the **Plugins** tab find **house-walk** and click **Install**.

## Five-minute start (with the plugin)

1. Make an empty folder and open it in Claude Code.
2. Say: **"build me a walkable 3D house from this floor plan"** and attach the plan (photo, scan
   or PDF), ideally with one measurement you know ("the living room is 5.4 m wide") - or
   describe the house, or just say "surprise me".
3. Answer its few questions, if any (which side faces the street, where north is).

Claude installs what is missing, sets up the project, downloads the 3D assets (about 130 MB,
once), then designs, checks and shows your house.

With a drawing, it reads it the way an architect would: the scale from the drawing's own
dimension strings, every wall and door from a pixel grid, each room checked against the area
written in it, and the reading laid over the drawing before anything is built. The method and
its two tools: [docs/reading-a-drawing.md](docs/reading-a-drawing.md).

**What to expect:** about 10-15 minutes to your first house (measured: setting up, designing and
checking), then 1-5 minutes while the first visit works out the indoor light. After that, each change takes minutes: "move the
kitchen door 50 cm east", "make the children's room bigger", "show me three versions with the
garden to the west".

### Try this (copy and paste)

```text
Build me a walkable 3D house from the attached floor plan. The living room is 5.4 m wide.
The street is at the bottom of the drawing and north is up. Answer me in English.
```

## The skills

| Skill | What it does |
|---|---|
| `/house-walk:new` | Sets up a project in an empty folder (template, npm install, assets, dev server, example house) |
| `/house-walk:from-plan` | Floor plan image/PDF + one dimension -> a plan file, checked, baked and shown |
| `/house-walk:check` | The plan kit's checks and the in-browser full test, and fixes what fails |
| `/house-walk:variants` | Several alternative designs under your constraints, with an area table |
| `/house-walk:tour` | Top view, eye-level pictures and the dimensions legend, sent as images |
| `/house-walk:perf` | Frame rate on this computer (`npm run bench`), what limits it, GPU memory, and the fixes |
| `/house-walk:share` | Builds a static website; deploys only after you say yes (optional password) |

You rarely need to type them: Claude picks the right one from what you ask. The exception is
`share`, which only runs when you type it.

## In the house

| Key | |
|---|---|
| W A S D / arrows | walk (Shift: run, Space: jump) |
| mouse | look around (click the picture to lock the mouse) |
| E | open or close the nearest door |
| V | first / third person |
| T | top view with the roof cut away (drag to turn, wheel to zoom, WASD to move) |
| PageUp / PageDown | in the top view: the floor above / below (houses with several storeys) |
| M | dimensions: room sizes, outside dimensions, areas |
| H | hide the help |

On a phone or tablet: the left joystick walks (push to the rim to run), the right one or a drag
turns, and buttons open doors and switch views.

**Quality menu** (bottom left): *fast* (more frames, no ambient occlusion, may drop to 70%
resolution), *balanced* (the default) or *high* (sharpest, never lowers the resolution). The
choice is remembered in the browser.

Add `?lang=he` or `?lang=en` to the address to switch language; Hebrew is chosen automatically
when the browser prefers it.

## Fast and beautiful on an ordinary laptop

The house looks close to a photograph and still runs at 80-95 frames a second on an ordinary
Intel Iris Xe laptop. The look is paid for once, before the first frame: the light of the sky,
the sun and every lamp is baked into the house, and textures stay compressed on the graphics chip.
Each frame is then cheap for both the graphics chip **and** the processor: the ~150 furniture
models are drawn in a few dozen calls instead of ~750, nothing that stands still is recomputed,
and the shadows are drawn only when a door moves. Version 0.4.0 added the processor side and
doubled the frame rate (from 40-45 fps).

How it works, the numbers and the rules for keeping it fast:
[docs/performance.md](docs/performance.md). To measure your own computer, with `npm run dev`
running:

```bash
npm run bench
```

## By hand (no agent)

```bash
git clone https://github.com/itamaroh7/house-walk-kit my-house
cd my-house
npm install
npm run assets
npm run dev
```

Then open <http://127.0.0.1:5180/>. Plans live in `src/plans/` (see `src/plans/example.js` and
[CLAUDE.md](CLAUDE.md) for the format); `npm run check` checks them. To read a drawing:
`npm run drawing:grid` and `npm run drawing:overlay` ([how](docs/reading-a-drawing.md)).

## Updating

```bash
claude plugin update house-walk@house-walk-kit
```

Plugins from community marketplaces do not update by themselves. A project you already made keeps
working as it is; new versions of the template are in [CHANGELOG.md](CHANGELOG.md). To bring an
existing project up to date (for example the 0.4.0 speed-ups), ask Claude to "update this house
project to the latest house-walk-kit": it pulls or copies the new engine and keeps your plans.

## Troubleshooting

- **"The 3D models are not here yet"**: run `npm run assets` in the project folder. Behind a
  proxy or offline, download the pack zip from the Releases page and run
  `npm run assets -- --from <zip>`.
- **"SHA-256 ... expects ..."**: the download was damaged or is of another version; run it again.
- **Stuck on "Working out the light in the house"**: the first visit of a changed plan bakes its
  light (1-5 minutes; slower on weak graphics). Keep the tab visible - background tabs are slowed
  down by the browser.
- **The page is slow or pixelated**: first update an older project (`git pull`; projects made
  before 0.4.0 run at about half the speed), then run `npm run bench` and ask Claude to read it
  (`/house-walk:perf`). Usual causes: hardware acceleration is off in the browser (a red box
  says so; Chrome: Settings, System, "Use graphics acceleration when available"), a laptop on
  battery (plug in), other heavy tabs, a 4K screen (choose *fast* in the quality menu).
  [More](docs/performance.md#still-slow-on-someones-computer).
- **A red box with "This plan has problems"**: the plan kit found something wrong (a window not
  on a wall, a bedroom without daylight...). Ask Claude to fix it, or run `npm run check`.
- **`npm install` fails on `sharp`**: it is only needed for adding new models; update Node.js to
  an LTS version and try again.
- **Port 5180 is busy**: Vite picks the next free port; use the address it prints.

## Privacy

Everything runs on your computer. Your floor plans, plan files and screenshots are not sent
anywhere by this kit (Claude itself sees what you share in the conversation, as usual). The only
download is the asset pack from this repository's Releases. Publishing a site happens only when
you ask for it and confirm it.

## Credits and licenses

Code: MIT ([LICENSE](LICENSE)). 3D assets: Poly Haven and ambientCG (CC0), Microsoft Rocketbox
(MIT), ez-tree (MIT), three.js (MIT) - every asset is listed in [LICENSES.md](LICENSES.md); the
MIT notices are in [public/THIRD-PARTY-NOTICES.txt](public/THIRD-PARTY-NOTICES.txt), which every
built site ships too.
