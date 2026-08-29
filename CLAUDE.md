# CLAUDE.md — tower defense game

An idle tower-defense game that runs in a phone browser. Second game project;
the first is RHEA_game (Godot) and is entirely unrelated — do not import
patterns or assumptions from it.

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
4. Tapping an enemy deals a small amount of direct damage — the "clicker" part,
   optional but rewarding during boss waves.
5. Every N waves a boss appears; failure resets to wave 1 keeping upgrades.
6. Prestige converts lifetime earnings into a permanent multiplier and wipes
   the run.
7. Closing the game accrues offline income, capped at 8 hours.

## Tech stack

| Component | Choice |
|---|---|
| Platform | Web, phone-first portrait layout. No native app, no APK. |
| Language | Vanilla JavaScript (ES2022). No framework, no TypeScript. |
| Rendering | Single `<canvas>`, 2D context, fixed logical resolution, scaled to fit |
| Build | None. Static files, opened directly or served with any static host. |
| Dependencies | Zero. No npm packages at runtime. |
| Saves | JSON in `localStorage`, single slot, versioned schema |
| Assets | Generated in code — shapes, gradients, procedural sprites. No image, font, or audio files are ever downloaded or committed. |
| Audio | WebAudio synthesis only, and only after the first user gesture |

Start as one `index.html` plus one `game.js`. Once `game.js` passes ~1500 lines,
split it into ES modules loaded with `<script type="module">` — still no build
step.

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

    index.html      entry point, canvas + minimal DOM chrome
    game.js         game loop, state, systems
    balance.js      the BALANCE object — every tunable number
    render.js       all canvas drawing, procedural sprite generation
    save.js         serialise / deserialise / migrate
    test/           Playwright scripts
    TODO.md         next up, known issues, balance
