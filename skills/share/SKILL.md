---
name: share
description: Build a house-walk house as a lean static website and, only after the user explicitly says yes, deploy it (Cloudflare Pages, Netlify or GitHub Pages; optional password).
disable-model-invocation: true
---

# Share the house as a website

Reply in the user's language. **Never deploy, upload or publish anything without the user's
explicit yes to that specific deploy.** Building and testing locally is fine; every upload is
theirs to approve (their accounts, their credits, their privacy). Never create accounts or type
passwords for them.

## 1. Prepare

1. **Only the plans to publish** in `src/plans/` (every file there goes on the site; move the
   others out of the folder for the build).
2. **Every plan's light bake shipped**: open each plan once in the dev server
   (`npm run dev`, `?plan=<id>`) until the light is done, so `public/gi/` holds its current
   bake. Without it every visitor's browser computes it (1-5 minutes) on the first visit.
3. `npm run build`. It builds into `dist/` and trims it (tools/prune-dist.mjs): only the models the
   plans use (the example: about 86 MB instead of 163 MB) and only the current bakes. It warns
   about a plan without a bake: fix that before going on.
4. Test the build: `npm run preview` and open `http://127.0.0.1:5181/` in a visible window; the
   house must open without "Working out the light", and the console must be clean.
5. Progress bar: after a full load in the preview, read `window.__loadBytes` in the page, write
   `{ "bytes": <that> }` to `public/load-size.json`, and build again (about 80 MB for the example).

`public/THIRD-PARTY-NOTICES.txt` (copied into dist/) carries the MIT notices the site must
ship (Rocketbox, three.js, ez-tree): don't remove it. `public/_headers` (copied into dist/) tells Netlify and Cloudflare Pages to let browsers cache
the 3D files for a week and the hashed files for a year: returning visitors download almost
nothing, which saves bandwidth (and Netlify credits).

## 2. Choose a host (ask the user; recommend by their needs)

Each first visit downloads about 80 MB, so bandwidth matters more than anything else.

- **Cloudflare Pages** - the best fit for sharing widely: the free plan has no bandwidth limit
  for static files (limits as of 2026: 20,000 files and 25 MiB per file per site; the largest
  file here is about 8 MB). Deploy: `npx wrangler pages deploy dist --project-name <name>`
  (wrangler asks the user to sign in in their browser).
- **Netlify** - easy (drag the `dist` folder onto app.netlify.com/drop, or
  `npx netlify-cli deploy --dir dist`, then `--prod`). The free plan is credit-based: in
  practice each production deploy cost about 15 of its 300 monthly credits, and bandwidth costs
  credits too (about 80 MB per new visitor). Batch changes into one deploy; never deploy just to
  test (use `npm run preview`). New sites may start behind "Team protection" (only the team's
  signed-in members can open them): making the site public is the user's choice in Site
  configuration -> Access control.
- **GitHub Pages** - free for public repositories (1 GB per site, about 100 GB a month of
  traffic), no password and no `_headers` support; the plans in the repository are public.

Check the host's current limits and prices with the user if they matter; they change.

## 3. Optional password

A small function on the host that asks for HTTP Basic auth, with the password in an environment
variable **the user sets in the host's dashboard** - never in a file, the repository or the chat.
- Netlify: `netlify/edge-functions/auth.js` + in `netlify.toml`
  `[[edge_functions]] path = "/*" function = "auth"`; deploy with `netlify deploy --build --prod`
  (without `--build` the edge function is not bundled). Don't run `netlify env:list` - it prints
  the values; check that the variable exists with `netlify env:get` only if the user agrees.
- Cloudflare Pages: `functions/_middleware.js`, the variable under Settings -> Variables and
  Secrets; or Cloudflare Access (free for small teams) for e-mail sign-in instead of a password.
Use HTTPS only, compare in constant time, add a delay after a wrong try, and set a session
cookie so the 3D files don't ask again. Tell the user plainly that this keeps casual visitors out
but is not bank-grade security, and that deploys made before the password (their permalinks)
stay reachable until deleted or protected.

## 4. Deploy - only after an explicit yes

Say exactly what will be uploaded (folder, size, host, site name, public or password) and wait
for "yes". Then deploy, open the live URL in a visible window, check it loads and the house
opens without a light computation. Give the user the link and how to update it later (build,
deploy again - again only on their yes; on Netlify, batch changes to save credits).

## Gotchas

- Editing any plan file hot-reloads every open tab and restarts their bakes: bake before building.
- A hidden browser pane runs slowly; judge the live site's speed in a visible window.
- The bake key is the plan without outdoor items; a plan changed after its bake would rebake in
  every visitor's browser - ship the current bake (the build warns).
- After adding models, run `npm run compress` before building.
- Indoor AO above ~3 smears walls; dynamic resolution must keep SMAA on.
- Phones: the site works with touch joysticks and a lighter picture, but ~80 MB is a lot on
  mobile data; say so when sharing the link.
