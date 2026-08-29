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
    const built = [0, 1, 2, 4].map((slot, i) => game.buildTower(slot, i === 3 ? 'laser' : 'turret'));
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
    for (let s = 0; s < 11; s++) if (game.slotIsFree(s)) game.buildTower(s, s % 3 === 0 ? 'mortar' : 'turret');
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

  // --- tapping -----------------------------------------------------------
  section('tap damage');
  const tap = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.state.enemies.length = 0;
    game.state.phase = 'wave';
    game.state.queue = [];
    game.advanceBy(0.1);
    game.state.enemies.push({
      id: 999999, type: 'grunt', hp: 1e9, maxHp: 1e9, speed: 0, bounty: 1,
      radius: 8, dist: 10, x: 100, y: 70, flash: 0, spin: 0,
    });
    const e = game.state.enemies[game.state.enemies.length - 1];
    const before = e.hp;
    const res = game.tapAt(100, 70);
    return { kind: res.kind, dealt: before - e.hp, damage: res.damage };
  });
  check('tapping an enemy deals damage', tap.kind === 'enemy' && tap.dealt > 0,
    `dealt ${Math.round(tap.dealt)}`);

  // --- save / reload -----------------------------------------------------
  section('save and reload');
  const saved = await page.evaluate(() => {
    const { game } = globalThis.__td;
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
    game.buildTower(3, 'turret');
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
    [0, 1, 2, 4, 7].forEach((s, i) => game.buildTower(s, i === 4 ? 'laser' : 'turret'));
    game.state.selectedSlot = 1;
    game.advanceBy(24);
    globalThis.__td.renderPanel();
  });
  await page.waitForTimeout(300);
  const layout = await page.evaluate(() => {
    const doc = document.documentElement;
    const small = [...document.querySelectorAll('#tabs button, #panel .row')]
      .filter((el) => el.getBoundingClientRect().height < 44)
      .map((el) => el.textContent.trim().slice(0, 24));
    return {
      overflowX: doc.scrollWidth > doc.clientWidth,
      small,
      stage: document.getElementById('stage').getBoundingClientRect().height,
    };
  });
  check('no horizontal overflow at 390x844', !layout.overflowX);
  check('every tap target is at least 44px tall', layout.small.length === 0, layout.small.join(', '));
  check('the play area gets most of the screen', layout.stage > 380, `${Math.round(layout.stage)}px`);

  await page.screenshot({ path: path.join(SHOTS, 'phone-build.png') });

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
