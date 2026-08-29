# TODO

## How to play

Once GitHub Pages is on, the phone needs nothing else:

    https://mpallman.github.io/tower-defense-game/

Open it once, then Share/menu -> "Add to Home Screen". After that it runs
offline, full screen, with no server and no computer involved.

## How to run it locally

ES modules can't be loaded over `file://`, so double-clicking `index.html`
will not work. Serve the folder instead:

    python3 -m http.server 8000     # then open http://localhost:8000

From the phone on the same network: `http://<pc-ip>:8000`. Note the service
worker stays off there — it needs a secure origin, so offline play only works
from the https Pages URL.

Saves are per-origin. `localhost:8000`, `192.168.x.x:8000` and the Pages URL
each keep a separate save.

## Shipping a change

Bump `CACHE` in `sw.js` (`vault-defense-v1` -> `-v2` ...) whenever any file
changes. Without that bump, installed phones keep serving the old build from
cache forever.

## Tests

    node test/run.mjs

Boots the page headlessly, asserts zero console errors, fast-forwards six game
hours, checks save/reload/migration/offline, and writes screenshots at 390×844
into `test/screenshots/` (gitignored).

## Next up

- Real sound design and procedural music (WebAudio only, no files).
- More detailed procedural sprites.
- Tower targeting options (first / strongest / closest) per tower.
- Per-tower upgrade levels, on top of the global ones.
- Drag an existing tower to move it, for a fraction of its cost.
- Boss modifiers (shielded, splitting, speeds up when damaged).
- A second enemy path or a branch, once the core loop is fun.
- Wave preview: show what's coming next during the prep phase.
- Damage numbers off by default on low-end phones (fx budget).

## Known issues

- Loading a save always restarts at the top of the saved wave; mid-wave state
  is not persisted. Cheap for the player, simple for the code.
- Offline income uses the recent-earnings EMA, so a save made right after a
  prestige pays out almost nothing. Consider seeding the rate from the
  previous run.
- The panel rebuilds its DOM every ~20 frames, which resets scroll position if
  the panel is ever taller than the screen.
- No pause. The game runs while a menu tab is open.
- Free placement may collapse into "stack everything on the longest straight".
  Minimum spacing is the only thing pushing back on that so far.
- Saved towers are restored at their exact coordinates without re-checking the
  placement rules, so tightening those rules will not delete anyone's towers.
- The service worker is cache-first, so a deploy only reaches an installed
  phone after the `CACHE` bump above, and then on the second load.
- The app icon is an SVG. Chrome accepts SVG manifest icons; if some launcher
  refuses it, the app still installs, just with a generated fallback icon.

## Balance notes (for me to fill in after playing)

Everything tunable is in `balance.js`. Nothing is tuned yet — the numbers are
first-guess placeholders, not playtested.

- Waves 1–5:
- Waves 8–12 (the usual wall):
- First prestige at wave:
- Does tap damage matter?
- Is the 8h offline cap reached before the daily play session?
