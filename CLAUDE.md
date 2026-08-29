# CLAUDE.md — tower defense game

A tower-defense game that runs in a phone browser. Second game project; the
first is RHEA_game (Godot) and is entirely unrelated — do not import patterns
or assumptions from it.

**It is not an idle/incremental game.** It runs on its own without constant
input — you are not clicking a cookie — but it is meant to be played actively,
in sessions, with your attention on it. Do not reach for idle-genre reflexes:
systems may fail hard, a run can be lost, and "but what if they close the app
for eight hours" is not an argument that outranks moment-to-moment play.
Offline income exists so a session can be picked back up, not as the point.

## Concept

You defend a data vault from endless waves of corrupted processes. Towers are
programs you install on the perimeter. The game plays itself; the player's job
is deciding what to buy, when to prestige, and when to intervene manually.

Theme is a placeholder chosen because geometric procedural art fits it. Swap it
freely — the mechanics don't depend on it.

Tone: cold, clean, readable at a glance on a small screen.

## Core loop

1. Waves spawn automatically and walk a fixed path.
2. Towers fire automatically. Kills drop currency.
3. Player spends currency on new towers and on upgrades (damage, range, rate).
4. Towers are placed freely anywhere off the path, by dragging them out of the
   build panel. No fixed slots. The arena is larger than the screen: one finger
   pans, two pinch to zoom, and a touch that goes nowhere is a tap.
5. Every N waves a boss appears; failure resets to wave 1 keeping upgrades.
6. Prestige converts lifetime earnings into a permanent multiplier and wipes
   the run.
7. Closing the game accrues offline income, capped at 8 hours. This is a
   convenience for picking a session back up, not the core of the game.

## Tech stack

| Component | Choice |
|---|---|
| Platform | Web, phone-first portrait layout. No native app, no APK. |
| Language | Vanilla JavaScript (ES2022). No framework, no TypeScript. |
| Rendering | Single `<canvas>`, 2D context, fixed logical resolution, scaled to fit |
| Build | None. Static files served by any static host. ES modules need http, so `file://` does not work — see TODO.md. |
| Dependencies | Zero. No npm packages at runtime. |
| Saves | JSON in `localStorage`, single slot, versioned schema |
| Assets | Generated in code — shapes, gradients, procedural sprites. No image, font, or audio files are ever downloaded or committed. The one committed `icon.svg` is hand-written vector markup for the install icon, which a manifest cannot get from a canvas. |
| Audio | WebAudio synthesis only, and only after the first user gesture |
| Delivery | Installable web app: service worker plus manifest, playable offline from the home screen |

Already split into ES modules loaded with `<script type="module">`, no build
step. Keep any single module under ~800 lines; split by responsibility rather
than growing one file.

The world is a fixed arena, larger than the viewport, with the enemy path
sitting inside it. The arena grew *around* the path rather than the path being
moved, so coordinates from older saves still mean what they meant. `render.js`
owns the camera; everything else works in world coordinates and never needs to
know where the view is pointing.

The panel is built once per tab and then synced in place: every changing value
registers an updater closure at build time, and one cheap pass per frame writes
only what differs. Do not go back to rebuilding the panel on a timer — that
throws away scroll position, drag listeners and pressed state.

## Hard constraints

1. **No external assets, ever.** If something needs art, it gets drawn with
   canvas calls. This keeps the game one copy-paste away from running anywhere.
2. **No dependencies.** A library is only worth discussing if it removes more
   than 200 lines of hand-written code, and even then, ask first.
3. **All tunable numbers live in one `BALANCE` object** at the top of its own
   file. Damage, costs, cost growth curves, wave scaling, drop rates, offline
   cap. Never hardcode a balance number anywhere else.
4. **Touch first, mouse second.** Minimum tap target 44 CSS pixels. No hover
   states carrying meaning. No right-click, no keyboard requirement.
5. **The save schema is versioned.** Every save carries `schemaVersion`. Loading
   an older version runs a migration function, never a silent reset. I will be
   playing on my phone with real progress; wiping it is the worst outcome.
6. **Numbers get large.** Use a formatting helper (1.2K / 3.4M / 5.6B / aa, ab…)
   from day one, and keep values in plain JS numbers until they actually
   overflow — don't preemptively build a BigNum layer.

## Verification

Chromium and Playwright are available in the container. Before reporting any
change as working:

- Boot the page headlessly, let it run, and assert the browser console produced
  zero errors and zero unhandled rejections.
- Drive the game clock with an injectable time source, not `Date.now()` called
  directly, so tests can fast-forward 10,000 waves in a second. This is a
  design requirement, not a testing detail.
- Take a screenshot at phone dimensions (390×844) and actually look at it before
  claiming the layout is fine.
- Test the save path explicitly: save, reload, assert state matches.

Run everything with `node test/run.mjs`. It starts its own static server, uses
the globally installed Playwright rather than a repo dependency, and writes
screenshots to `test/screenshots/`. Look at them.

"It looks correct to me" is not verification. Neither is "the file parses."

## What I decide, not you

Balance and feel. Whether waves 8–12 are a wall, whether prestige comes too
late, whether the tap damage matters. Ship the mechanics; I'll play it and come
back with numbers. Don't tune the curve speculatively between my reports, and
don't gate work on a playtest — build the next thing and batch the tuning.

## Non-goals

- Multiplayer, accounts, servers, analytics, ads, monetisation
- Native Android build, Play Store, APK signing
- Procedural or branching level layouts — one path, fixed, until the core loop
  is fun
- Art polish beyond legible geometry

## Working with me

This is my second game project and I'm still learning both game dev and working
with LLMs. Explain a concept the first time it appears. Challenge my design
calls when best practice differs — say so instead of complying quietly.

Plain, direct English. Short sentences. Lead with the point, then the reasoning.
No hedging, no filler, no restating my question, and no summarising what you
just did unless I ask.

## Repo layout

    index.html            entry point, DOM chrome, stylesheet, input wiring
    game.js               simulation, state, systems, level geometry
    balance.js            the BALANCE object — every tunable number
    sprites.js            procedural sprite baking, shared by canvas and DOM
    render.js             the play field: background, path, entities, effects
    icons.js              DOM-facing art: sprite tiles and inline SVG glyphs
    ui.js                 HUD, wave bar, and the three tab panels
    audio.js              synthesised sound effects and procedural music
    save.js               serialise / deserialise / migrate
    format.js             number and duration formatting
    sw.js                 service worker — offline play, versioned cache
    manifest.webmanifest  install metadata
    icon.svg              app icon, hand-written vector
    test/run.mjs          the whole Playwright suite
    TODO.md               state of play, next up, known issues, balance

## Where it runs

Public repo, GitHub Pages deploys from the default branch, which is the
working branch. https://mpallman.github.io/tower-defense-game/ — installed to
the phone home screen and playable offline.

There is no staging branch and no merge step: a push is a deploy. Bump `CACHE`
in `sw.js` on every change or installed phones keep serving the old build.
