# TODO

## Resuming in a new session

Everything needed to continue is in this repo. Read this file and CLAUDE.md
first; nothing important lives only in a chat log.

**Branch and deploy.** Work on `claude/create-claude-md-p5kzrk`. It is the
repo's default branch and GitHub Pages deploys straight from it, so a push is a
deploy — there is no PR, no merge, no staging. Bump `CACHE` in `sw.js` on every
change (`vault-defense-v6` → `-v7`), or phones with the game installed keep
serving the old build from cache. After a deploy the phone needs two reloads:
the first fetches, the second swaps the new cache in.

**Tests.** `node test/run.mjs`. 77 checks, all passing as of the UI pass.
It boots the real page in headless Chromium, so it catches things unit tests
would not. It needs no install: Playwright is installed globally in the dev
container and the script resolves it via `npm root -g`, which keeps the repo at
zero dependencies. Run it before every push.

**State of play.** The game is feature-complete for a first pass: waves,
three tower types, free placement by drag, global upgrades, bosses, prestige,
offline income, save migration, sound, procedural music, pause and speed. The
UI is card-based: every buyable thing shows the sprite it will put on the map,
and the header shows the wave's enemies with their hp for this wave.

**Nothing is balanced.** Every number in `balance.js` is a first guess. The
owner plays and reports; do not tune the curve speculatively between reports.

**The open design question**, raised from real play: waves are dead time when
you have no money to spend. The 2×/4× speed button is a workaround, not a fix.
The real options are faster early income, something to do during a wave, or
both. Do not pick one without the owner.

**Working style that has held up so far.** Explain a concept the first time it
appears. Challenge a design call when best practice differs, then do what the
owner decides. When feedback contradicts CLAUDE.md, update CLAUDE.md in the
same commit — a spec that lies is worse than no spec. Deliver in batches small
enough to play.

## How to play

    https://mpallman.github.io/tower-defense-game/

Open it once on the phone, then Share/menu → "Add to Home Screen". After that
it runs offline, full screen, with no server involved.

## How to run it locally

ES modules can't be loaded over `file://`, so double-clicking `index.html`
will not work. Serve the folder instead:

    python3 -m http.server 8000     # then open http://localhost:8000

From the phone on the same network: `http://<pc-ip>:8000`. The service worker
stays off there — it needs a secure origin — so offline play only works from
the https Pages URL.

Saves are per-origin. `localhost:8000`, `192.168.x.x:8000` and the Pages URL
each keep a separate save.

## Architecture notes

- The simulation never reads the wall clock. `createGame({ clock })` takes an
  injectable clock; `fastForward(seconds)` runs fixed 1/30s steps with cosmetic
  entities switched off. That is what lets the tests simulate six game-hours in
  about two seconds.
- `game.js` owns the level geometry (path, distances) because it is geometry,
  not balance. Balance numbers never appear outside `balance.js`.
- Saves carry `schemaVersion` (currently 2) and migrate in a chain: 0 → 1 → 2.
  Migrations must describe the *old* data — the 1 → 2 migration keeps its own
  frozen copy of the deleted slot table rather than importing the live level.
- Restored towers are not re-validated against the placement rules. Tightening
  those rules must never delete someone's towers.
- Sprites are baked once into offscreen canvases at boot and blitted. Layers
  that move independently (hull vs ring, base vs head) are baked separately.
- `sprites.js` owns that baking so both the canvas (`render.js`) and the DOM
  (`icons.js`) draw from one source. A tower card shows the same art as the
  tower it builds, because it *is* the same art, composited into a data URL and
  handed to CSS as a background image.
- Abstract UI marks (credit chip, bolt, crosshair) are inline SVG built in
  `icons.js`, not sprites and not files. They inherit `currentColor`.
- `ui.js` builds each tab once and then syncs it: values register updater
  closures, and one pass per frame (~0.1 ms) writes only what changed. Nothing
  in the panel is destroyed while you are touching it.
- Wave, count, roster and enemy hp live in the DOM header. The canvas draws the
  field only — no HUD text, so nothing is stated twice.
- Cosmetic events (`shot`, `kill`, `leak`) are only emitted when
  `api.cosmetics` is true, so a fast-forward doesn't generate millions of them.

## Next up

- Tower targeting options (first / strongest / closest) per tower.
- Per-tower upgrade levels, on top of the global ones.
- Drag an existing tower to move it, for a fraction of its cost.
- Boss modifiers: shielded, splitting, speeds up when damaged.
- Auto-pause when a boss wave starts, as an option.
- A run summary on breach: what killed you, what your towers contributed.
- `game.js` has crossed the ~800-line guideline. The read-only derived helpers
  (wave curve, roster, costs, multipliers) are the natural thing to lift out
  next; nothing else in there wants to move.

## Known issues

- Loading a save always restarts at the top of the saved wave; mid-wave state
  is not persisted. Cheap for the player, simple for the code.
- Offline income uses the recent-earnings EMA, so a save made right after a
  prestige pays out almost nothing.
- Landscape works but the play field becomes a short letterboxed strip: the
  world has a fixed 360x480 aspect. Portrait is the design.
- Prestige and wipe still use the browser's `confirm()`. It works in an
  installed PWA but looks nothing like the rest of the game.
- Free placement may collapse into "stack everything on the longest straight".
  Minimum spacing is the only thing pushing back on that so far.
- Firing sounds are rate limited to 12/second in total, so a wall of turrets
  sounds like a burst rather than a swarm.
- The music is one four-bar loop in A minor. A test asserts every scheduled
  note stays in key, so a future melody change cannot silently go sour.
- Pause is deliberately not saved. Speed is.
- The render performance check runs headless, where there is no real
  rasteriser. It measures the draw calls issued, not GPU time. It says nothing
  about how the game actually performs on a phone.

## Balance notes (for me to fill in after playing)

Everything tunable is in `balance.js`. Nothing is tuned yet.

- Waves 1–5:
- Waves 8–12 (the usual wall):
- First prestige at wave:
- Is the dead time while waiting for money still bad at 4x?
- Is the 8h offline cap reached before the daily play session?
