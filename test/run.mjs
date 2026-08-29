// test/run.mjs — Playwright checks. Run with: node test/run.mjs
//
// Uses the globally installed playwright and a throwaway static server, so the
// repo itself keeps zero dependencies.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch (err) { /* fall through */ }
  const root = execSync('npm root -g').toString().trim();
  return require(path.join(root, 'playwright'));
}
const { chromium } = loadPlaywright();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'test', 'screenshots');
const PHONE = { width: 390, height: 844 };

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const file = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

// ---------------------------------------------------------------- harness --
const results = [];
let failures = 0;

function check(name, condition, detail = '') {
  const ok = !!condition;
  if (!ok) failures += 1;
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? '  — ' + detail : ''}`);
  return ok;
}

function section(name) { console.log('\n' + name); }

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { server, port } = await serve();
  const base = `http://127.0.0.1:${port}/`;
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: PHONE,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });

  const errors = [];
  context.on('page', (page) => {
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push('console: ' + msg.text()); });
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    page.on('requestfailed', (req) => errors.push('requestfailed: ' + req.url() + ' ' + req.failure()?.errorText));
  });

  const page = await context.newPage();
  await page.addInitScript(() => {
    globalThis.__TD_MANUAL_CLOCK = true;
    globalThis.addEventListener('unhandledrejection', (ev) => {
      console.error('unhandledrejection: ' + (ev.reason && ev.reason.message ? ev.reason.message : ev.reason));
    });
  });

  // --- boot --------------------------------------------------------------
  section('boot');
  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  await page.waitForTimeout(400);
  check('page booted with the test surface exposed', await page.evaluate(() => !!globalThis.__td.game));
  check('canvas has a backing store', await page.evaluate(() => {
    const c = document.getElementById('game');
    return c.width > 0 && c.height > 0;
  }));
  check('boot produced no console errors', errors.length === 0, errors.join(' | '));

  // --- simulation --------------------------------------------------------
  section('simulation');
  const sim = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.state.credits = 5_000;
    const spots = [[30, 120], [150, 120], [240, 120], [150, 222]];
    const built = spots.map(([x, y], i) => game.buildTower(x, y, i === 3 ? 'laser' : 'turret'));
    const before = game.state.wave;
    game.fastForward(600); // ten minutes of game time
    return {
      built: built.every((b) => b.ok),
      before,
      after: game.state.wave,
      kills: game.state.kills,
      credits: game.state.credits,
      enemies: game.state.enemies.length,
      fx: game.state.fx.length,
      finite: Number.isFinite(game.state.credits) && Number.isFinite(game.state.vaultHp),
    };
  });
  check('towers can be built', sim.built);
  check('waves advance while fast-forwarding', sim.after > sim.before, `wave ${sim.before} -> ${sim.after}`);
  check('enemies die and pay out', sim.kills > 0 && sim.credits > 0, `${sim.kills} kills`);
  check('state stays finite', sim.finite);
  check('fast-forward leaves no cosmetic entities', sim.fx === 0);

  // --- deep fast-forward -------------------------------------------------
  section('deep fast-forward');
  const deep = await page.evaluate(() => {
    const { game } = globalThis.__td;
    const t0 = performance.now();
    game.state.credits = 1e12;
    for (const key of ['damage', 'rate', 'range']) for (let i = 0; i < 60; i++) game.buyUpgrade(key);
    let placed = 0;
    for (let x = 20; x <= 340 && placed < 14; x += 28) {
      for (let y = 20; y <= 460 && placed < 14; y += 28) {
        if (game.canPlaceAt(x, y).ok && game.buildTower(x, y, placed % 3 === 0 ? 'mortar' : 'turret').ok) placed += 1;
      }
    }
    game.fastForward(60 * 60 * 6); // six hours of game time
    return {
      ms: performance.now() - t0,
      wave: game.state.wave,
      best: game.state.bestWave,
      credits: game.state.credits,
      finite: Number.isFinite(game.state.credits) && !Number.isNaN(game.state.vaultHp),
      enemies: game.state.enemies.length,
      projectiles: game.state.projectiles.length,
    };
  });
  check('six game-hours simulate quickly', deep.ms < 20_000, `${Math.round(deep.ms)} ms`);
  check('numbers survive a long run', deep.finite, `credits ${deep.credits}`);
  check('entity lists stay bounded', deep.enemies < 200 && deep.projectiles < 500,
    `${deep.enemies} enemies / ${deep.projectiles} projectiles`);
  check('deep run produced no console errors', errors.length === 0, errors.join(' | '));
  console.log(`       reached wave ${deep.wave} (best ${deep.best}) in ${Math.round(deep.ms)} ms`);

  // --- placement rules ---------------------------------------------------
  section('placement');
  const place = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.hardReset();
    game.state.credits = 100_000;
    const onPath = game.canPlaceAt(150, 70);
    const offMap = game.canPlaceAt(2, 2);
    const nearVault = game.canPlaceAt(180, 428);
    const first = game.buildTower(150, 120, 'turret');
    const stacked = game.buildTower(152, 124, 'turret');
    const apart = game.buildTower(200, 120, 'turret');
    const poor = (() => {
      game.state.credits = 0;
      return game.buildTower(30, 120, 'turret');
    })();
    return {
      onPath: onPath.reason, offMap: offMap.reason, nearVault: nearVault.reason,
      first: first.ok, stacked: stacked.reason, apart: apart.ok, poor: poor.reason,
      towers: game.state.towers.length,
    };
  });
  check('towers cannot be built on the path', place.onPath === 'too close to the path');
  check('towers cannot be built off the map', place.offMap === 'off the map');
  check('towers cannot smother the vault', !!place.nearVault, place.nearVault);
  check('a legal spot builds', place.first && place.apart && place.towers === 2);
  check('towers cannot be stacked', place.stacked === 'too close to another tower');
  check('an unaffordable tower is refused', place.poor === 'not enough credits');

  // --- drag to place -----------------------------------------------------
  section('drag to place');
  await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.hardReset();
    game.state.credits = 2_000;
    globalThis.__td.setTab('build');
  });
  await page.waitForTimeout(120);

  const towerRow = page.locator('#panel .row', { hasText: 'Turret' }).first();
  const rowBox = await towerRow.boundingBox();
  const canvasBox = await page.locator('#game').boundingBox();

  // drop it on the path first: must be refused
  const onPathPoint = await page.evaluate(() => {
    const { renderer } = globalThis.__td;
    const rect = document.getElementById('game').getBoundingClientRect();
    const s = renderer.scale;
    const offX = (rect.width - 360 * s) / 2;
    const offY = (rect.height - 480 * s) / 2;
    // aim low so the ghost, which floats above the finger, lands on the path
    const grab = globalThis.__td.BALANCE.build.dragGrabOffset;
    return { x: rect.left + offX + 150 * s, y: rect.top + offY + (70 - grab) * s };
  });
  await page.mouse.move(rowBox.x + rowBox.width / 2, rowBox.y + rowBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(onPathPoint.x, onPathPoint.y, { steps: 12 });
  const dragging = await page.evaluate(() => {
    const d = globalThis.__td.game.state.drag;
    return d ? { ok: d.ok, reason: d.reason } : null;
  });
  await page.mouse.up();
  const afterBadDrop = await page.evaluate(() => globalThis.__td.game.state.towers.length);
  check('the drag preview reports an illegal spot', dragging && !dragging.ok, dragging && dragging.reason);
  check('dropping on the path builds nothing', afterBadDrop === 0);

  // now a legal spot. The panel changed after the last drop, so re-find the row.
  await page.evaluate(() => { globalThis.__td.game.state.selected = null; globalThis.__td.renderPanel(); });
  await page.waitForTimeout(80);
  const rowBox2 = await page.locator('#panel .row', { hasText: 'Turret' }).first().boundingBox();
  const goodPoint = await page.evaluate(() => {
    const { renderer } = globalThis.__td;
    const rect = document.getElementById('game').getBoundingClientRect();
    const s = renderer.scale;
    const offX = (rect.width - 360 * s) / 2;
    const offY = (rect.height - 480 * s) / 2;
    // aim below the target so the grab offset lands the tower at (150, 120)
    const grab = globalThis.__td.BALANCE.build.dragGrabOffset;
    return { x: rect.left + offX + 150 * s, y: rect.top + offY + (120 - grab) * s };
  });
  await page.mouse.move(rowBox2.x + rowBox2.width / 2, rowBox2.y + rowBox2.height / 2);
  await page.mouse.down();
  await page.mouse.move(goodPoint.x, goodPoint.y, { steps: 12 });
  await page.screenshot({ path: path.join(SHOTS, 'phone-dragging.png') });
  const preview = await page.evaluate(() => {
    const d = globalThis.__td.game.state.drag;
    return d ? { ok: d.ok, x: Math.round(d.x), y: Math.round(d.y) } : null;
  });
  await page.mouse.up();
  const dropped = await page.evaluate(() => {
    const t = globalThis.__td.game.state.towers;
    return t.length ? { count: t.length, x: Math.round(t[0].x), y: Math.round(t[0].y) } : { count: 0 };
  });
  check('the drag preview reports a legal spot', preview && preview.ok, JSON.stringify(preview));
  check('the ghost sits above the finger', preview && Math.abs(preview.y - 120) <= 2, `y ${preview && preview.y}`);
  check('dropping on a legal spot builds the tower', dropped.count === 1 && Math.abs(dropped.y - 120) <= 2,
    JSON.stringify(dropped));

  // --- save / reload -----------------------------------------------------  // --- save / reload -----------------------------------------------------
  section('save and reload');
  const saved = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.state.credits = 10_000;
    game.buildTower(30, 120, 'turret');
    game.buildTower(240, 222, 'laser');
    game.state.enemies.length = 0;
    game.save();
    game.save = () => true; // stop the page from overwriting the save on unload
    return game.snapshot();
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  const reloaded = await page.evaluate(() => globalThis.__td.game.snapshot());
  const fields = ['wave', 'credits', 'cores', 'lifetimeEarned', 'bestWave', 'kills', 'prestiges'];
  const mismatched = fields.filter((f) => Math.abs(reloaded[f] - saved[f]) > 1e-6);
  check('state survives a reload', mismatched.length === 0,
    mismatched.map((f) => `${f}: ${saved[f]} -> ${reloaded[f]}`).join(', '));
  check('towers survive a reload', reloaded.towers.length === saved.towers.length,
    `${saved.towers.length} -> ${reloaded.towers.length}`);
  check('upgrades survive a reload',
    JSON.stringify(reloaded.upgrades) === JSON.stringify(saved.upgrades));

  // --- offline income ----------------------------------------------------
  section('offline income');
  const offline = await page.evaluate(async () => {
    const { game } = globalThis.__td;
    const snap = game.snapshot();
    snap.credits = 100;
    snap.incomeRate = 10;
    const hoursAgo = 3;
    localStorage.setItem('towerdefense.save', JSON.stringify({
      schemaVersion: 1,
      savedAt: Date.now() - hoursAgo * 3600 * 1000,
      data: snap,
    }));
    game.save = () => true;
    return { expected: 10 * hoursAgo * 3600 * 0.5 };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  const afterOffline = await page.evaluate(() => ({
    credits: globalThis.__td.game.state.credits,
    report: globalThis.__td.game.state.offlineReport,
  }));
  check('offline income is paid out', afterOffline.credits > 100 + offline.expected * 0.9,
    `credits ${Math.round(afterOffline.credits)}, expected ~${Math.round(100 + offline.expected)}`);

  const capped = await page.evaluate(() => {
    const { game, BALANCE } = globalThis.__td;
    const snap = game.snapshot();
    snap.credits = 0;
    snap.incomeRate = 10;
    localStorage.setItem('towerdefense.save', JSON.stringify({
      schemaVersion: 1,
      savedAt: Date.now() - 48 * 3600 * 1000,
      data: snap,
    }));
    game.save = () => true;
    return { cap: BALANCE.offline.capHours * 3600 * 10 * BALANCE.offline.efficiency };
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  const afterCap = await page.evaluate(() => globalThis.__td.game.state.credits);
  check('offline income is capped at 8 hours', Math.abs(afterCap - capped.cap) < capped.cap * 0.02,
    `${Math.round(afterCap)} vs cap ${Math.round(capped.cap)}`);

  // --- migration ---------------------------------------------------------
  section('save migration');
  await page.evaluate(() => {
    const { game } = globalThis.__td;
    // A pre-versioning save: no schemaVersion, no upgrades block.
    localStorage.setItem('towerdefense.save', JSON.stringify({
      data: { wave: 12, credits: 777, lifetimeEarned: 4321, towers: [{ slot: 0, type: 'turret', spent: 30 }] },
    }));
    game.save = () => true;
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  const migrated = await page.evaluate(() => globalThis.__td.game.snapshot());
  check('a legacy save migrates instead of resetting',
    migrated.wave === 12 && migrated.credits === 777 && migrated.towers.length === 1,
    `wave ${migrated.wave}, credits ${migrated.credits}, towers ${migrated.towers.length}`);
  check('migration fills in missing fields', migrated.upgrades.damage === 0 && migrated.cores === 0);
  check('slot-based towers become free-placed coordinates',
    migrated.towers[0].x === 30 && migrated.towers[0].y === 120 && migrated.towers[0].slot === undefined,
    JSON.stringify(migrated.towers[0]));

  const corrupt = await page.evaluate(async () => {
    localStorage.setItem('towerdefense.save', '{not json');
    globalThis.__td.game.save = () => true;
    return true;
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  check('a corrupt save does not crash the boot', corrupt && await page.evaluate(() => {
    const raw = localStorage.getItem('towerdefense.save');
    return globalThis.__td.game.state.wave === 1 && raw === '{not json';
  }), 'unreadable save is kept, not wiped');

  // --- prestige ----------------------------------------------------------
  section('prestige');
  const prestige = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.state.runEarned = 1_000_000;
    game.state.credits = 5000;
    game.buildTower(30, 120, 'turret');
    const pending = game.pendingCores();
    const res = game.prestige();
    return {
      pending, ok: res.ok, cores: game.state.cores,
      mult: game.prestigeMult(),
      wave: game.state.wave,
      towers: game.state.towers.length,
      credits: game.state.credits,
      upgrades: game.state.upgrades.damage,
    };
  });
  check('prestige grants cores', prestige.ok && prestige.cores === prestige.pending && prestige.cores > 0,
    `${prestige.cores} cores, ×${prestige.mult.toFixed(2)}`);
  check('prestige wipes the run', prestige.wave === 1 && prestige.towers === 0 && prestige.upgrades === 0);

  // --- layout ------------------------------------------------------------
  section('layout');
  await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.hardReset();
    game.state.credits = 900;
    const spots = [[30, 120], [150, 120], [240, 120], [150, 222], [110, 332]];
    const ids = spots.map(([x, y], i) => game.buildTower(x, y, i === 4 ? 'laser' : 'turret').id);
    game.state.selected = ids[1];
    game.advanceBy(24);
    globalThis.__td.renderPanel();
  });
  await page.waitForTimeout(300);
  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll('#tabs button, #controls button, #panel .row')]
      .filter((el) => el.offsetParent !== null && el.getBoundingClientRect().height < 44)
      .map((el) => el.textContent.trim().slice(0, 24));
    return {
      overflowX: doc.scrollWidth > doc.clientWidth,
      small,
      stage: document.getElementById('stage').getBoundingClientRect().height,
    };
  });
  check('no horizontal overflow at 390x844', !layout.overflowX);
  check('every tap target is at least 44px tall', layout.small.length === 0, layout.small.join(', '));
  check('the play area gets most of the screen', layout.stage > 340, `${Math.round(layout.stage)}px`);

  await page.screenshot({ path: path.join(SHOTS, 'phone-build.png') });

  // Portrait is the design, but a phone turned sideways must not break.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  const landscape = await page.evaluate(() => {
    const doc = document.documentElement;
    return {
      overflowX: doc.scrollWidth > doc.clientWidth,
      overflowY: doc.scrollHeight > doc.clientHeight,
      stage: Math.round(document.getElementById('stage').getBoundingClientRect().height),
      panel: Math.round(document.getElementById('panel').getBoundingClientRect().height),
    };
  });
  await page.screenshot({ path: path.join(SHOTS, 'phone-landscape.png') });
  check('landscape still fits on screen', !landscape.overflowX && !landscape.overflowY,
    JSON.stringify(landscape));
  check('landscape keeps a play field and a usable panel',
    landscape.stage > 100 && landscape.panel > 80, JSON.stringify(landscape));
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(200);

  // --- panel ---------------------------------------------------------------
  section('panel');
  const cards = await page.evaluate(() => {
    const out = [];
    for (const card of document.querySelectorAll('#panel .card.tower')) {
      out.push({
        name: card.querySelector('.name').textContent,
        art: getComputedStyle(card.querySelector('.tile')).backgroundImage.slice(0, 22),
        chips: card.querySelectorAll('.chip').length,
        cost: card.querySelector('.cost b').textContent,
      });
    }
    return out;
  });
  check('every tower has a card with its own sprite', cards.length === 3
    && cards.every((c) => c.art.startsWith('url("data:image/png')),
    cards.map((c) => `${c.name} ${c.art}`).join(' | '));
  check('tower cards show stats and a price', cards.every((c) => c.chips === 3 && c.cost.length > 0),
    cards.map((c) => `${c.name} ${c.cost}`).join(' | '));

  const roster = await page.evaluate(() => {
    const { game, ui } = globalThis.__td;
    game.state.wave = 10;            // a boss wave, with every enemy unlocked
    ui.sync();
    return [...document.querySelectorAll('#roster .foe')].map((foe) => ({
      art: getComputedStyle(foe.querySelector('.foe-art')).backgroundImage.slice(0, 22),
      hp: foe.querySelector('.foe-hp').textContent,
      boss: foe.classList.contains('is-boss'),
      title: foe.title,
    }));
  });
  check('the wave bar shows a sprite for every enemy in the wave',
    roster.length === 4 && roster.every((f) => f.art.startsWith('url("data:image/png')),
    roster.map((f) => f.title).join(' | '));
  check('a boss wave flags the boss in the roster', roster.some((f) => f.boss),
    roster.map((f) => `${f.title}${f.boss ? ' (boss)' : ''}`).join(' | '));
  await page.screenshot({ path: path.join(SHOTS, 'phone-boss-roster.png') });

  // The panel is synced in place, not rebuilt: scroll position and the nodes
  // themselves must survive a frame.
  const kept = await page.evaluate(() => {
    const { game, ui } = globalThis.__td;
    const panel = document.getElementById('panel');
    panel.scrollTop = 24;
    const card = document.querySelector('#panel .card.tower');
    card.dataset.mark = 'before';
    const costBefore = card.querySelector('.cost b').textContent;
    const affordBefore = card.querySelector('.cost').classList.contains('no');
    game.state.credits = 0;
    for (let i = 0; i < 5; i++) ui.sync();
    const after = document.querySelector('#panel .card.tower');
    return {
      sameNode: after.dataset.mark === 'before',
      scroll: panel.scrollTop,
      costBefore,
      affordBefore,
      affordAfter: after.querySelector('.cost').classList.contains('no'),
    };
  });
  check('syncing keeps the panel nodes and the scroll position',
    kept.sameNode && kept.scroll === 24, `scroll ${kept.scroll}, same node ${kept.sameNode}`);
  check('a price turns unaffordable when the credits run out',
    !kept.affordBefore && kept.affordAfter);

  const hud = await page.evaluate(() => {
    const { game, ui } = globalThis.__td;
    game.state.credits = 12_345;
    game.state.vaultHp = 5;
    game.state.cores = 3;
    ui.sync();
    return {
      credits: document.getElementById('stats').querySelector('.tone-gold .v').textContent,
      vault: document.querySelector('.tone-good .v').textContent,
      hurt: document.querySelector('.tone-good').classList.contains('is-hurt'),
      cores: document.querySelector('.tone-core .v').textContent,
      mult: document.querySelector('.tone-core .suffix').textContent,
      bossStar: getComputedStyle(document.querySelector('.tone-accent .boss-star')).display,
    };
  });
  check('the hud formats the run', hud.credits === '12.3K' && hud.vault === '5' && hud.cores === '3',
    `${hud.credits} / ${hud.vault} / ${hud.cores}`);
  check('a damaged vault reads as damaged', hud.hurt);
  check('the cores tile carries the prestige multiplier', hud.mult === '×1.18', hud.mult);
  check('a boss wave is marked in the hud', hud.bossStar !== 'none', hud.bossStar);

  // The sync pass runs on every animation frame, so it has to stay cheap.
  const syncCost = await page.evaluate(() => {
    const { ui } = globalThis.__td;
    ui.sync();
    const t0 = performance.now();
    for (let i = 0; i < 120; i++) ui.sync();
    return (performance.now() - t0) / 120;
  });
  check('a ui sync is cheap enough to run every frame', syncCost < 1.5, `${syncCost.toFixed(3)} ms`);

  // put the run back the way the layout section left it
  await page.evaluate(() => {
    const { game, ui } = globalThis.__td;
    game.state.wave = 3;
    game.state.cores = 0;
    game.state.credits = 900;
    game.state.vaultHp = globalThis.__td.BALANCE.vault.maxHp;
    ui.sync();
  });

  // mid-combat, with enemies and projectiles on screen
  const combat = await page.evaluate(() => {
    const { game } = globalThis.__td;
    for (let i = 0; i < 400 && game.state.enemies.length < 4; i++) game.advanceBy(0.5);
    game.advanceBy(0.2);
    return { enemies: game.state.enemies.length, wave: game.state.wave };
  });
  check('enemies are on the field mid-wave', combat.enemies > 0, `${combat.enemies} enemies, wave ${combat.wave}`);
  await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(SHOTS, 'phone-combat.png') });
  await page.evaluate(() => globalThis.__td.setTab('upgrade'));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, 'phone-upgrade.png') });
  await page.evaluate(() => globalThis.__td.setTab('prestige'));
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, 'phone-prestige.png') });
  await page.evaluate(() => {
    const panel = document.getElementById('panel');
    panel.scrollTop = panel.scrollHeight;
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SHOTS, 'phone-settings.png') });

  // --- sprites -----------------------------------------------------------
  section('sprites');
  const art = await page.evaluate(() => {
    const { game, renderer } = globalThis.__td;
    game.hardReset();
    game.state.credits = 100_000;
    game.state.wave = 15;
    const spots = [[30, 120], [240, 120], [150, 222], [245, 330], [95, 440], [30, 330]];
    spots.forEach(([x, y], i) => game.buildTower(x, y, ['turret', 'laser', 'mortar'][i % 3]));

    // fill the field: a spread of every enemy type plus a boss
    game.state.phase = 'wave';
    game.state.queue = [];
    game.state.enemies.length = 0;
    const types = ['grunt', 'swift', 'hulk', 'grunt', 'swift'];
    types.forEach((type, i) => {
      game.state.queue.push(type);
    });
    for (let i = 0; i < 60 && game.state.enemies.length < 5; i++) game.advanceBy(0.5);
    game.advanceBy(1.5);

    const boss = {
      id: 990001, type: 'boss', hp: 6_000, maxHp: 10_000, speed: 12, bounty: 100,
      radius: 16, dist: 520, x: 0, y: 0, flash: 0, angle: 0, spin: 0.7,
    };
    game.state.enemies.push(boss);
    game.advanceBy(0.6);

    return {
      sprites: renderer.spriteCount(),
      enemies: game.state.enemies.length,
      projectiles: game.state.projectiles.length,
      types: [...new Set(game.state.enemies.map((e) => e.type))].sort(),
    };
  });
  check('every enemy and tower has baked sprite layers', art.sprites === 14, `${art.sprites} layers`);
  check('the scene has a mix of enemies', art.enemies >= 3 && art.types.includes('boss'), art.types.join(', '));

  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'phone-sprites.png') });

  // detail must not cost the frame rate
  const perf = await page.evaluate(() => {
    const { game, renderer } = globalThis.__td;
    renderer.draw(game);                      // warm up
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) renderer.draw(game);
    return (performance.now() - t0) / 60;
  });
  // Headless has no real rasteriser, so this measures the draw calls we issue,
  // not GPU time. It still catches per-frame work that should be baked once.
  check('a busy frame issues its draw calls cheaply', perf < 4, `${perf.toFixed(2)} ms per frame`);

  // --- pause and speed ---------------------------------------------------
  section('pace');
  const pace = await page.evaluate(async () => {
    const { game, clock } = globalThis.__td;
    game.hardReset();
    game.setSpeed(1);
    game.tickRealtime();

    clock.advance(1000); game.tickRealtime();
    const oneX = game.state.time;

    game.setSpeed(4);
    clock.advance(1000); game.tickRealtime();
    const fourX = game.state.time - oneX;

    game.setPaused(true);
    clock.advance(10_000); game.tickRealtime();
    const whilePaused = game.state.time - oneX - fourX;

    game.setPaused(false);
    clock.advance(1000); game.tickRealtime();
    const afterResume = game.state.time - oneX - fourX - whilePaused;

    return { oneX, fourX, whilePaused, afterResume, cycle: [game.setSpeed(1), game.cycleSpeed(), game.cycleSpeed(), game.cycleSpeed()] };
  });
  check('one real second advances one game second at 1x', Math.abs(pace.oneX - 1) < 0.02, `${pace.oneX.toFixed(3)}s`);
  check('4x advances four game seconds', Math.abs(pace.fourX - 4) < 0.05, `${pace.fourX.toFixed(3)}s`);
  check('pausing stops the simulation', pace.whilePaused === 0, `${pace.whilePaused}s while paused`);
  check('no time is banked up while paused', pace.afterResume < 4.1, `${pace.afterResume.toFixed(3)}s after resume`);
  check('the speed button cycles', JSON.stringify(pace.cycle) === '[1,2,4,1]', pace.cycle.join(' -> '));

  // the buttons, not just the api
  await page.evaluate(() => { globalThis.__td.game.setPaused(false); globalThis.__td.game.setSpeed(1); });
  await page.locator('#btn-pause').click();
  const visibleIcons = (selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)]
    .filter((node) => node.getBoundingClientRect().height > 0).length, selector);
  const pausedByButton = await page.evaluate(() => ({
    paused: globalThis.__td.game.state.paused,
    label: document.getElementById('btn-pause').querySelector('.label').textContent,
  }));
  check('the pause button pauses and relabels', pausedByButton.paused && pausedByButton.label === 'Resume',
    pausedByButton.label);
  const playIconShown = await visibleIcons('#btn-pause .ico svg');
  check('a paused button shows one icon, not both', playIconShown === 1, `${playIconShown} icons`);
  await page.screenshot({ path: path.join(SHOTS, 'phone-paused.png') });
  await page.locator('#btn-pause').click();
  await page.locator('#btn-speed').click();
  const speedByButton = await page.evaluate(() => ({
    speed: globalThis.__td.game.state.speed,
    label: document.getElementById('btn-speed').querySelector('.label').textContent,
    paused: globalThis.__td.game.state.paused,
  }));
  check('the speed button steps to 2x', speedByButton.speed === 2 && speedByButton.label === '2×', speedByButton.label);
  check('resume clears the pause', !speedByButton.paused);
  const pauseIconShown = await visibleIcons('#btn-pause .ico svg');
  check('a running button shows one icon, not both', pauseIconShown === 1, `${pauseIconShown} icons`);

  // The same swap drives the sound toggle, which is an SVG too.
  await page.evaluate(() => globalThis.__td.setTab('prestige'));
  const soundIcons = await visibleIcons('#panel .toggle:first-child .ico svg');
  await page.evaluate(() => {
    const { game, ui } = globalThis.__td;
    game.state.muted = true;
    ui.sync();
  });
  const mutedIcons = await visibleIcons('#panel .toggle:first-child .ico svg');
  const mutedLabel = await page.evaluate(() =>
    document.querySelector('#panel .toggle:first-child .label').textContent);
  check('the sound toggle swaps its icon instead of stacking them',
    soundIcons === 1 && mutedIcons === 1 && mutedLabel === 'Muted',
    `${soundIcons} -> ${mutedIcons}, ${mutedLabel}`);
  await page.evaluate(() => {
    const { game, ui } = globalThis.__td;
    game.state.muted = false;
    ui.setTab('build');
  });

  // speed is a preference and is saved; pause is not
  await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.setSpeed(4);
    game.setPaused(true);
    game.save();
    game.save = () => true;
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  const afterReload = await page.evaluate(() => ({
    speed: globalThis.__td.game.state.speed,
    paused: globalThis.__td.game.state.paused,
  }));
  check('the speed setting survives a reload', afterReload.speed === 4, `${afterReload.speed}x`);
  check('a paused game never reopens paused', afterReload.paused === false);

  // --- audio -------------------------------------------------------------
  section('audio');
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  await page.waitForTimeout(300);
  check('no audio context exists before a gesture',
    await page.evaluate(() => !globalThis.__td.audio.isActive()));

  await page.locator('#tabs button[data-tab="build"]').click();
  await page.waitForTimeout(300);
  const unlocked = await page.evaluate(() => ({
    active: globalThis.__td.audio.isActive(),
    state: globalThis.__td.audio.contextState(),
  }));
  check('a gesture starts the audio context', unlocked.active, `context ${unlocked.state}`);

  const sound = await page.evaluate(async () => {
    const { game, audio } = globalThis.__td;
    game.state.muted = false;
    game.state.musicOff = false;
    game.state.credits = 5_000;
    game.buildTower(150, 120, 'turret');
    game.buildTower(30, 120, 'laser');
    game.buildTower(240, 120, 'mortar');
    game.advanceBy(30);                       // fires shots, kills, wave events
    ['kill', 'leak', 'waveClear', 'breach', 'prestige', 'build', 'sell', 'deny'].forEach((n) => audio.play(n));
    audio.play('waveStart', true);
    await new Promise((r) => setTimeout(r, 400));
    return audio.debug();
  });
  check('the music scheduler is running', sound.step > 0, `${sound.step} steps scheduled`);
  check('music gain fades in', sound.music > 0, `gain ${sound.music.toFixed(3)}`);
  check('the sfx voice cap is respected', sound.voices <= 16, `${sound.voices} voices`);

  const muted = await page.evaluate(async () => {
    globalThis.__td.game.state.muted = true;
    await new Promise((r) => setTimeout(r, 500));
    globalThis.__td.game.advanceBy(10);
    return globalThis.__td.audio.debug();
  });
  check('muting silences the music bus', muted.music < 0.01, `gain ${muted.music.toFixed(4)}`);

  const inKey = await page.evaluate(async () => {
    const { game, audio } = globalThis.__td;
    game.state.muted = false;
    game.state.musicOff = false;
    game.state.wave = 20;              // deep enough for the arpeggio to play
    await new Promise((r) => setTimeout(r, 2500));
    return audio.debug().notes;
  });
  // A natural minor: A B C D E F G
  const A_MINOR = new Set([9, 11, 0, 2, 4, 5, 7]);
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const outOfKey = inKey.filter((n) => !A_MINOR.has(((n % 12) + 12) % 12));
  check('the music scheduled notes', inKey.length > 8, `${inKey.length} notes`);
  check('every scheduled note is in A minor', outOfKey.length === 0,
    [...new Set(outOfKey.map((n) => NAMES[((n % 12) + 12) % 12]))].join(', '));
  await page.evaluate(() => { globalThis.__td.game.state.muted = false; });

  // --- offline install ---------------------------------------------------
  section('offline');
  const manifest = await page.evaluate(async () => {
    const res = await fetch('./manifest.webmanifest');
    return { ok: res.ok, json: await res.json() };
  });
  check('the manifest is served and parses', manifest.ok && manifest.json.name === 'Vault Defense');
  check('the manifest ships an icon and a start url',
    manifest.json.icons.length > 0 && manifest.json.start_url === './' && manifest.json.display === 'standalone');

  const swReady = await page.evaluate(() => navigator.serviceWorker.ready.then((reg) => !!reg.active));
  check('the service worker activates', swReady);

  // Kill the network entirely and reload: the game must still boot.
  await context.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td, null, { timeout: 15_000 });
  const offlineBoot = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.advanceBy(5);
    const c = document.getElementById('game');
    return { wave: game.state.wave, canvas: c.width > 0 && c.height > 0 };
  });
  check('the game boots and runs with the network switched off',
    offlineBoot.canvas && offlineBoot.wave >= 1, `wave ${offlineBoot.wave}`);
  await context.setOffline(false);

  // --- final error sweep -------------------------------------------------
  section('errors');
  check('no console errors or unhandled rejections in the whole run',
    errors.length === 0, errors.join(' | '));

  await browser.close();
  server.close();

  console.log('\n' + results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
