---
name: new
description: Build someone a walkable 3D house - from a floor plan, a description or nothing - starting from an empty folder - installs what is missing, sets up the project, then designs and shows the house.
---

# From an empty folder to a walkable house

Reply in the user's language (the language of their messages). Keep explanations short and
concrete; the user may not be a developer. Tell them in one line what each step is doing.

This skill does the whole job: if the user's request already holds a floor plan, a description
or just "build me a house", carry straight on to step 6 after the setup - don't stop to ask
"what next?".

## 1. Check the folder

The project goes in the current working folder. It should be empty, or hold only the user's own
files (a floor plan image or PDF). If it already has a `package.json` and `src/plans/`, it is an
existing project: skip to step 4.

## 2. Make sure Node.js and Git are there

Run `node --version` and `git --version`. Node.js 18.17 or newer is required (20 or 22 LTS is
best); Git is optional.

If one is missing or too old, **install it yourself**, after telling the user in one line (the
installer may ask them to approve or for an administrator password):
- Windows: `winget install -e --id OpenJS.NodeJS.LTS`, `winget install -e --id Git.Git`
- macOS: `brew install node git` (no Homebrew: the installer from https://nodejs.org, and
  `xcode-select --install` for Git)
- Linux: `sudo apt install -y nodejs npm git` (if Node is older than 18, `nvm install --lts`
  from https://github.com/nvm-sh/nvm)

On Windows the running shell does not see newly installed programs: reload PATH (PowerShell:
`$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`)
or call `"C:\Program Files\nodejs\npm.cmd"` by full path. If nothing can install it (no
winget/brew, no rights), send the user to https://nodejs.org (LTS) and continue when they say
it is done.

## 3. Copy the template

```bash
node "${CLAUDE_PLUGIN_ROOT}/tools/new-project.mjs" .
```

This copies the app, tools, `AGENTS.md`, `CLAUDE.md` and the example plan from the installed
plugin (no download) and refuses to overwrite files. If it fails, clone instead:
`git clone --depth 1 https://github.com/itamaroh7/house-walk-kit .` (empty folder) or into a
subfolder `house-walk` when the user's files are there.

## 4. Install and fetch the assets

```bash
npm install
npm run assets
```

`npm run assets` downloads the asset pack (about 130 MB: furniture, materials, sky, the walking
person) from the project's GitHub release, checks its SHA-256 and unpacks it into `public/`. If
the user already has the pack zip: `npm run assets -- --from <path-to-zip>`.

## 5. Start the app

Start `npm run dev` in the background (a long-running server) and wait for its `Local:` line
(normally http://127.0.0.1:5180/). If the request was only "set it up", open the example house
(in a browser tool if you have one, otherwise give the link) and stop here.

## 6. Build their house

Follow the `from-plan` skill (`${CLAUDE_PLUGIN_ROOT}/skills/from-plan/SKILL.md`): it covers a
drawing, a description and "no idea - surprise me". Then `npm run check` until it passes, show
the house, and tell them how to walk: W A S D and the mouse (click the picture first), Shift
runs, E opens doors, T from above, M dimensions; on a phone, the joysticks.

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their light bakes: finish edits,
  then let one tab bake.
- A hidden browser pane runs slowly and its timings are unreliable; check speed with the page in view.
- The light bake key is the plan without outdoor items: changing furniture or walls rebakes
  (1-5 min), moving trees or bins does not.
- After adding models, run `npm run compress` (KTX2 textures).
- Indoor AO above ~3 smears walls; dynamic resolution must keep SMAA on.
- See `CLAUDE.md` in the project for the plan format and test hooks.
