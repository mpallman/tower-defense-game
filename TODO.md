# TODO

## How to run

ES modules can't be loaded over `file://`, so opening `index.html` by
double-clicking it will not work. Serve the folder instead:

    python3 -m http.server 8000     # then open http://localhost:8000

On the phone: same network, `http://<pc-ip>:8000`. Still zero build, zero
dependencies, zero downloaded assets.

## Tests

    node test/run.mjs

Boots the page headlessly, asserts zero console errors, fast-forwards six game
hours, checks save/reload/migration/offline, and writes screenshots at 390×844
into `test/screenshots/` (gitignored).

## Next up

- Tower targeting options (first / strongest / closest) per tower.
- Per-tower upgrade levels, on top of the global ones.
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

## Balance notes (for me to fill in after playing)

Everything tunable is in `balance.js`. Nothing is tuned yet — the numbers are
first-guess placeholders, not playtested.

- Waves 1–5:
- Waves 8–12 (the usual wall):
- First prestige at wave:
- Does tap damage matter?
- Is the 8h offline cap reached before the daily play session?
