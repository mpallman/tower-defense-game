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
    game.state.credits = 50_000;
    // Towers now need a supply line, so this builds a working base: depots to
    // reach the perimeter, a miner on a node, and a factory turning that ore
    // into rounds. Without the economy behind them the towers never fire.
    const support = [
      game.buildBuilding(110, 120, 'depot'),
      game.buildBuilding(240, 222, 'depot'),
      game.buildBuilding(250, -105, 'miner'),
      game.buildBuilding(-60, 250, 'plant'),      // the factory needs power too
      game.buildBuilding(200, 120, 'ammofab'),
    ];
    const spots = [[30, 120], [150, 120], [240, 120], [150, 222]];
    const built = spots.map(([x, y], i) => game.buildTower(x, y, i === 3 ? 'laser' : 'turret'));
    const before = game.state.wave;
    game.fastForward(600); // ten minutes of game time
    return {
      built: built.every((b) => b.ok),
      support: support.every((b) => b.ok),
      supportWhy: support.map((b) => b.reason || 'ok').join(', '),
      ammoLeft: game.state.resources.ammo,
      before,
      after: game.state.wave,
      kills: game.state.kills,
      credits: game.state.credits,
      enemies: game.state.enemies.length,
      fx: game.state.fx.length,
      finite: Number.isFinite(game.state.credits) && Number.isFinite(game.state.vaultHp),
    };
  });
  check('a support base can be built', sim.support, sim.supportWhy);
  check('towers can be built', sim.built);
  check('waves advance while fast-forwarding', sim.after > sim.before, `wave ${sim.before} -> ${sim.after}`);
  check('enemies die and pay out', sim.kills > 0 && sim.credits > 0, `${sim.kills} kills`);
  check('the factory kept the turrets fed through ten minutes', sim.ammoLeft > 0,
    `${sim.ammoLeft.toFixed(1)} ammo left`);
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
    // just outside the arena's own corner, wherever the arena happens to be
    const w = globalThis.__td.BALANCE.world;
    const offMap = game.canPlaceAt(w.x - 5, w.y - 5);
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
  // Aim the ghost, not the finger: the finger sits `dragGrabOffset` screen px
  // below wherever the tower should land.
  const aimAt = (wx, wy) => page.evaluate(([x, y]) => {
    const { renderer, BALANCE } = globalThis.__td;
    const p = renderer.toClient(x, y);
    return { x: p.x, y: p.y - BALANCE.build.dragGrabOffset };
  }, [wx, wy]);

  const onPathPoint = await aimAt(150, 70);
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
  const goodPoint = await aimAt(150, 120);
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

  // --- touch gestures ------------------------------------------------------
  // A finger on a card is ambiguous — scroll, or pick the tower up? Synthetic
  // DOM events cannot answer that, because the browser's own scrolling is what
  // competes with us. These drive real touch input through the debug protocol.
  section('touch');
  const cdp = await context.newCDPSession(page);
  const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, radiusX: 12, radiusY: 12, force: 1, id: 1 }],
  });
  const panelState = () => page.evaluate(() => {
    const panel = document.getElementById('panel');
    return { scroll: Math.round(panel.scrollTop), max: Math.round(panel.scrollHeight - panel.clientHeight) };
  });
  async function armPanel() {
    await page.evaluate(() => {
      const { game, ui } = globalThis.__td;
      game.hardReset();
      game.state.credits = 5_000;
      game.buildTower(30, 120, 'turret');
      game.state.selected = game.state.towers[0].id;   // the selection card makes it overflow
      ui.rebuild();
      ui.sync();
      document.getElementById('panel').scrollTop = 0;
    });
    await page.waitForTimeout(150);
    return (await page.locator('#panel .card.tower').first().boundingBox());
  }

  let card = await armPanel();
  const overflow = await panelState();
  check('the build panel actually overflows, so scrolling means something',
    overflow.max > 40, `${overflow.max}px of scroll`);

  // a flick across a card must scroll, not grab
  let fx = card.x + card.width / 2;
  let fy = card.y + card.height / 2;
  await touch('touchStart', fx, fy);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', fx, fy - i * 8); await page.waitForTimeout(16); }
  await touch('touchEnd', fx, fy - 80);
  await page.waitForTimeout(200);
  const flicked = await panelState();
  const flickedTowers = await page.evaluate(() => ({
    towers: globalThis.__td.game.state.towers.length,
    dragging: !!globalThis.__td.game.state.drag,
  }));
  check('a flick over a tower card scrolls the panel', flicked.scroll > 20, `${flicked.scroll}px`);
  check('scrolling never picks a tower up', !flickedTowers.dragging && flickedTowers.towers === 1,
    JSON.stringify(flickedTowers));

  // holding still picks it up, and the panel must not scroll away underneath
  card = await armPanel();
  fx = card.x + card.width / 2;
  fy = card.y + card.height / 2;
  const dropPoint = await aimAt(150, 120);
  await touch('touchStart', fx, fy);
  await page.waitForTimeout(320);
  const heldDrag = await page.evaluate(() => !!globalThis.__td.game.state.drag);
  check('holding a card picks the tower up', heldDrag);
  for (let i = 1; i <= 12; i++) {
    await touch('touchMove', fx + (dropPoint.x - fx) * i / 12, fy + (dropPoint.y - fy) * i / 12);
    await page.waitForTimeout(16);
  }
  await touch('touchEnd', dropPoint.x, dropPoint.y);
  await page.waitForTimeout(200);
  const afterTouchDrop = await panelState();
  const touchBuilt = await page.evaluate(() => {
    const towers = globalThis.__td.game.state.towers;
    const last = towers[towers.length - 1];
    return { count: towers.length, x: Math.round(last.x), y: Math.round(last.y) };
  });
  check('a held drag places the tower by touch',
    touchBuilt.count === 2 && Math.abs(touchBuilt.y - 120) <= 2, JSON.stringify(touchBuilt));
  check('the panel does not scroll out from under a drag', afterTouchDrop.scroll === 0,
    `${afterTouchDrop.scroll}px`);

  // picking up and putting back down is a cancel, not a failed placement
  card = await armPanel();
  await touch('touchStart', card.x + card.width / 2, card.y + card.height / 2);
  await page.waitForTimeout(320);
  await touch('touchEnd', card.x + card.width / 2, card.y + card.height / 2);
  await page.waitForTimeout(200);
  const putBack = await page.evaluate(() => ({
    towers: globalThis.__td.game.state.towers.length,
    dragging: !!globalThis.__td.game.state.drag,
    complaining: document.getElementById('toast').classList.contains('show'),
  }));
  check('releasing back on the panel cancels quietly',
    putBack.towers === 1 && !putBack.dragging && !putBack.complaining, JSON.stringify(putBack));

  await page.evaluate(() => { globalThis.__td.game.hardReset(); globalThis.__td.renderPanel(); });

  // --- camera --------------------------------------------------------------
  section('camera');
  await page.evaluate(() => {
    const { game, renderer, ui } = globalThis.__td;
    game.hardReset();
    game.state.credits = 5_000;
    game.buildTower(150, 120, 'turret');
    renderer.recentre();
    ui.sync();
  });
  await page.waitForTimeout(120);

  const opening = await page.evaluate(() => {
    const { renderer, LEVEL } = globalThis.__td;
    return {
      zoom: renderer.camera.zoom,
      x: Math.round(renderer.camera.x),
      y: Math.round(renderer.camera.y),
      centre: { x: Math.round(LEVEL.center.x), y: Math.round(LEVEL.center.y) },
    };
  });
  check('the view opens at zoom 1, framed on the path',
    opening.zoom === 1 && opening.x === opening.centre.x && opening.y === opening.centre.y,
    JSON.stringify(opening));

  const roundTrip = await page.evaluate(() => {
    const { renderer } = globalThis.__td;
    const worst = [[0, 0], [150, 120], [-160, -190], [500, 650]].map(([x, y]) => {
      const c = renderer.toClient(x, y);
      const back = renderer.toLogical(c.x, c.y);
      return Math.hypot(back.x - x, back.y - y);
    });
    return Math.max(...worst);
  });
  check('screen and world coordinates round-trip', roundTrip < 0.01, `${roundTrip.toFixed(4)} px off`);

  // a tap that goes nowhere still selects the tower under it
  let towerAt = await page.evaluate(() => globalThis.__td.renderer.toClient(150, 120));
  await touch('touchStart', towerAt.x, towerAt.y);
  await touch('touchEnd', towerAt.x, towerAt.y);
  await page.waitForTimeout(120);
  check('a still tap on the field still selects a tower',
    await page.evaluate(() => globalThis.__td.game.state.selected !== null));

  // one finger drags the world
  const panned = await (async () => {
    const before = await page.evaluate(() => ({ ...globalThis.__td.renderer.camera }));
    const from = await page.evaluate(() => globalThis.__td.renderer.toClient(150, 260));
    await touch('touchStart', from.x, from.y);
    for (let i = 1; i <= 8; i++) { await touch('touchMove', from.x - i * 9, from.y - i * 6); await page.waitForTimeout(16); }
    await touch('touchEnd', from.x - 72, from.y - 48);
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => ({ ...globalThis.__td.renderer.camera }));
    return { before, after };
  })();
  check('one finger pans the world',
    panned.after.x > panned.before.x + 20 && panned.after.y > panned.before.y + 10,
    `${Math.round(panned.before.x)},${Math.round(panned.before.y)} -> ${Math.round(panned.after.x)},${Math.round(panned.after.y)}`);
  check('panning is not a tap, so it changes no selection',
    await page.evaluate(() => globalThis.__td.game.state.selected !== null));

  // the arena cannot be pushed off the screen
  const clamped = await (async () => {
    for (let pass = 0; pass < 6; pass++) {
      const start = { x: 200, y: 300 };
      await touch('touchStart', start.x, start.y);
      for (let i = 1; i <= 8; i++) { await touch('touchMove', start.x + i * 30, start.y + i * 30); await page.waitForTimeout(8); }
      await touch('touchEnd', start.x + 240, start.y + 240);
    }
    await page.waitForTimeout(120);
    return page.evaluate(() => {
      const { renderer, BALANCE } = globalThis.__td;
      const w = BALANCE.world;
      const rect = document.getElementById('game').getBoundingClientRect();
      const halfW = rect.width / renderer.scale / 2;
      const halfH = rect.height / renderer.scale / 2;
      return {
        left: renderer.camera.x - halfW - w.x,
        top: renderer.camera.y - halfH - w.y,
      };
    });
  })();
  check('the arena cannot be dragged off the screen',
    clamped.left >= -0.5 && clamped.top >= -0.5, JSON.stringify(clamped));

  // pinch
  await page.evaluate(() => globalThis.__td.renderer.recentre());
  const pinch = async (spread) => {
    const cx = 195, cy = 300;
    const pts = (gap) => [
      { x: cx - gap, y: cy, radiusX: 12, radiusY: 12, force: 1, id: 1 },
      { x: cx + gap, y: cy, radiusX: 12, radiusY: 12, force: 1, id: 2 },
    ];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(40) });
    for (let i = 1; i <= 8; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(40 + spread * i) });
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(100);
    return page.evaluate(() => globalThis.__td.renderer.camera.zoom);
  };
  const zoomedIn = await pinch(8);
  check('spreading two fingers zooms in', zoomedIn > 1.2, `${zoomedIn.toFixed(2)}x`);
  await page.evaluate(() => globalThis.__td.renderer.recentre());
  const zoomedOut = await pinch(-4);
  check('pinching two fingers zooms out', zoomedOut < 0.85, `${zoomedOut.toFixed(2)}x`);
  await page.screenshot({ path: path.join(SHOTS, 'phone-zoomed-out.png') });

  const limits = await page.evaluate(async () => {
    const { renderer, BALANCE } = globalThis.__td;
    const rect = document.getElementById('game').getBoundingClientRect();
    for (let i = 0; i < 40; i++) renderer.zoomAt(0.8, rect.left + rect.width / 2, rect.top + rect.height / 2);
    const min = renderer.camera.zoom;
    for (let i = 0; i < 60; i++) renderer.zoomAt(1.25, rect.left + rect.width / 2, rect.top + rect.height / 2);
    const max = renderer.camera.zoom;
    return { min, max, floor: BALANCE.camera.minZoom, ceil: BALANCE.camera.maxZoom };
  });
  check('zoom stops at both limits', limits.min === limits.floor && limits.max === limits.ceil,
    JSON.stringify(limits));

  // the recentre button puts it back
  await page.locator('#btn-centre').click();
  await page.waitForTimeout(120);
  const recentred = await page.evaluate(() => {
    const { renderer, LEVEL } = globalThis.__td;
    return renderer.camera.zoom === 1
      && Math.abs(renderer.camera.x - LEVEL.center.x) < 0.01
      && Math.abs(renderer.camera.y - LEVEL.center.y) < 0.01;
  });
  check('the recentre button restores the opening view', recentred);

  await page.evaluate(() => { globalThis.__td.game.hardReset(); globalThis.__td.renderPanel(); });

  // --- the opening -----------------------------------------------------
  // Nothing is placed for the player. A run holds one free depot and one free
  // turret, and the player decides where both go. The rule these checks guard
  // is that a brand new run can always arm itself, anywhere, without spending
  // a credit — the old opening could not, and a turret bought out of reach of
  // the one pre-placed depot killed the run outright.
  section('the opening');
  const firstRun = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.hardReset();
    const opening = {
      buildings: game.state.buildings.length,
      towers: game.state.towers.length,
      credits: game.state.credits,
      depotCost: game.buildingCost('depot'),
      turretCost: game.towerCost('turret'),
    };

    // Place both, far from where the old seeded depot used to sit, and spend
    // nothing doing it.
    const depot = game.buildBuilding(20, 130, 'depot');
    const turret = game.buildTower(120, 112, 'turret');
    const placed = {
      depotFree: depot.ok && depot.cost === 0 && depot.free === true,
      turretFree: turret.ok && turret.cost === 0 && turret.free === true,
      creditsUnspent: game.state.credits,
      nextDepot: game.buildingCost('depot'),
      nextTurret: game.towerCost('turret'),
    };

    // And it works: the turret is supplied and kills things.
    game.state.phase = 'wave';
    for (let i = 0; i < 60 && !game.state.enemies.length; i++) game.advanceBy(0.5);
    game.advanceBy(30);
    const fought = { kills: game.state.kills, starved: !!game.towerById(turret.id).starved };

    // Selling a free build hands the grant back, so a run can never strand
    // itself by selling the only thing feeding its guns.
    game.hardReset();
    const d = game.buildBuilding(20, 130, 'depot');
    game.sellBuilding(d.id);
    const resold = { cost: game.buildingCost('depot'), left: game.freeLeft('depot') };
    return { opening, placed, fought, resold };
  });
  check('a run opens with an empty map', firstRun.opening.buildings === 0 && firstRun.opening.towers === 0,
    JSON.stringify(firstRun.opening));
  check('the first depot and the first turret cost nothing',
    firstRun.opening.depotCost === 0 && firstRun.opening.turretCost === 0,
    JSON.stringify(firstRun.opening));
  check('placing both spends no credits',
    firstRun.placed.depotFree && firstRun.placed.turretFree
      && firstRun.placed.creditsUnspent === firstRun.opening.credits,
    JSON.stringify(firstRun.placed));
  check('a free build does not push the next one up the cost curve',
    firstRun.placed.nextDepot === 45 && firstRun.placed.nextTurret === 30,
    `depot ${firstRun.placed.nextDepot}, turret ${firstRun.placed.nextTurret}`);
  check('the opening the player laid out actually fights',
    firstRun.fought.kills > 0 && !firstRun.fought.starved, JSON.stringify(firstRun.fought));
  check('selling a free build gives the grant back',
    firstRun.resold.left === 1 && firstRun.resold.cost === 0, JSON.stringify(firstRun.resold));

  // --- the bootstrap ---------------------------------------------------
  // Nothing in the ammo chain pays out until all three of miner, plant and
  // factory are standing — ore alone is useless, power alone is useless. So
  // the opening reserve has to outlast the whole bootstrap. It did not: the
  // chain cost roughly eight minutes of income while the reserve ran out at
  // five, the turret went quiet, and with it the income that was paying for
  // the chain. This plays the intended opening and checks the reserve gets
  // you there, so a later cost change cannot quietly re-open that gap.
  section('the bootstrap');
  const bootstrap = await page.evaluate(() => {
    const { game, LEVEL } = globalThis.__td;
    const spot = (kind, type, near) => {
      for (let r = 0; r <= 240; r += 8) {
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
          const x = near[0] + Math.cos(a) * r, y = near[1] + Math.sin(a) * r;
          const ok = kind === 'tower'
            ? game.canPlaceAt(x, y).ok : game.canPlaceBuildingAt(x, y, type).ok;
          if (ok) return [x, y];
        }
      }
      return null;
    };
    game.hardReset();
    const ore = LEVEL.oreNodes
      .map((n) => [n, Math.min(...LEVEL.path.map((p) => Math.hypot(p[0] - n[0], p[1] - n[1])))])
      .sort((a, b) => a[1] - b[1])[0][0];
    const places = {
      depot: spot('building', 'depot', [40, 130]),
      turret: spot('tower', 'turret', [80, 112]),
      miner: spot('building', 'miner', ore),
      plant: spot('building', 'plant', [40, 210]),
      ammofab: spot('building', 'ammofab', [40, 300]),
    };
    game.buildBuilding(places.depot[0], places.depot[1], 'depot');
    game.buildTower(places.turret[0], places.turret[1], 'turret');

    const plan = ['miner', 'plant', 'ammofab'];
    let next = 0, dry = null, chainDone = null, low = Infinity, stuck = null;
    for (let s = 0; s < 400; s += 1) {
      game.advanceBy(1);
      if (next < plan.length && game.state.credits >= game.buildingCost(plan[next])) {
        const p = places[plan[next]];
        const res = p ? game.buildBuilding(p[0], p[1], plan[next]) : { ok: false, reason: 'no spot' };
        if (res.ok) {
          next += 1;
          if (next === plan.length) chainDone = s;
        } else stuck = `${plan[next]}: ${res.reason}`;
      }
      low = Math.min(low, game.state.resources.ammo);
      if (dry === null && game.state.resources.ammo <= 0.01) dry = s;
    }
    return {
      dry, chainDone, low: Math.round(low),
      making: game.state.resources.ammo > 0 && game.flowRates().ammo > 0,
      bestWave: game.state.bestWave,
      stuck, built: next,
    };
  });
  check('the opening reserve outlasts the ammo chain',
    bootstrap.dry === null, bootstrap.dry === null ? `low water ${bootstrap.low}` : `dry at ${bootstrap.dry}s`);
  check('the chain gets built, and then makes ammo',
    bootstrap.chainDone !== null && bootstrap.making,
    bootstrap.chainDone !== null
      ? `chain done at ${bootstrap.chainDone}s`
      : `only ${bootstrap.built}/3 built — stuck on ${bootstrap.stuck}`);
  check('and the run is still going when it does',
    bootstrap.bestWave >= 6, `reached wave ${bootstrap.bestWave}`);

  // --- the ground layer ------------------------------------------------
  // The floor is baked at a quantised resolution but must be *drawn* at the
  // exact one, or it scales in steps while the towers on it scale smoothly and
  // the whole background appears to slide as you zoom. The invariant: tile
  // seams always land on world multiples of the tile size, at every zoom.
  section('ground');
  const groundLock = await page.evaluate(async () => {
    const { renderer } = globalThis.__td;
    const { tileLayout } = await import('./ground.js');
    const worst = [];
    for (const zoom of [0.42, 0.63, 0.87, 1, 1.19, 1.66, 2.4]) {
      renderer.zoomAt(zoom / renderer.camera.zoom, 100, 100);
      const frame = renderer.frame();
      const { step, ox } = tileLayout(frame);
      // The world coordinate the first tile seam sits on.
      const world = frame.camera.x + (ox / frame.dpr - frame.cssW / 2) / frame.scale;
      const offBy = Math.abs(world / 100 - Math.round(world / 100)) * 100;
      worst.push({ zoom: +renderer.camera.zoom.toFixed(2), offBy: +offBy.toFixed(4), step: +step.toFixed(3) });
    }
    renderer.recentre();
    return worst;
  });
  check('the floor stays locked to the world at every zoom',
    groundLock.every((r) => r.offBy < 0.01),
    groundLock.map((r) => `${r.zoom}x off by ${r.offBy}`).join(', '));

  // --- economy -------------------------------------------------------------
  section('economy');
  const supply = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.hardReset();
    game.state.credits = 50_000;

    // Far from the opening depot, so nothing can reach it.
    const lonely = game.buildTower(-100, 300, 'turret');
    game.state.phase = 'wave';
    game.state.queue = ['grunt'];
    for (let i = 0; i < 40 && !game.state.enemies.length; i++) game.advanceBy(0.5);
    game.advanceBy(4);
    const tower = game.towerById(lonely.id);
    const before = { starved: !!tower.starved, problem: game.towerProblem(tower) };

    // A depot in reach turns it back on.
    const relay = game.buildBuilding(-60, 250, 'depot');
    game.advanceBy(2);
    const after = { starved: !!tower.starved, problem: game.towerProblem(tower) };

    // Drain the pool and it stops again, for a different reason.
    game.state.resources.ammo = 0;
    game.advanceBy(2);
    const dry = { starved: !!tower.starved, problem: game.towerProblem(tower) };
    return { relay: relay.ok, before, after, dry };
  });
  check('a tower out of reach of any supply does not fire',
    supply.before.starved && supply.before.problem === 'no supply line', JSON.stringify(supply.before));
  check('a depot in range brings it back',
    supply.relay && !supply.after.starved && supply.after.problem === null, JSON.stringify(supply.after));
  check('an empty pool stops it for a different reason',
    supply.dry.starved && supply.dry.problem === 'out of ammo', JSON.stringify(supply.dry));

  const mining = await page.evaluate(() => {
    const { game, LEVEL } = globalThis.__td;
    game.hardReset();
    game.state.credits = 50_000;
    const [nx, ny] = LEVEL.oreNodes[0];
    return {
      offNode: game.buildBuilding(nx + 90, ny, 'miner').reason,
      onNode: game.buildBuilding(nx + 8, ny - 6, 'miner'),
      snapped: game.state.buildings.filter((b) => b.type === 'miner').map((b) => [b.x, b.y]),
      twice: game.buildBuilding(nx, ny, 'miner').reason,
      node: [nx, ny],
    };
  });
  check('a miner must stand on an ore node', mining.offNode === 'must sit on an ore node', mining.offNode);
  check('a miner snaps onto the node it was dropped near',
    mining.onNode.ok && mining.snapped.length === 1
    && mining.snapped[0][0] === mining.node[0] && mining.snapped[0][1] === mining.node[1],
    JSON.stringify(mining.snapped));
  check('one node takes one miner', mining.twice === 'that node is already mined', mining.twice);

  const chain = await page.evaluate(() => {
    const { game, LEVEL } = globalThis.__td;
    game.hardReset();
    game.state.credits = 50_000;
    game.state.resources.ore = 0;

    // A factory with nothing to convert stalls rather than making ore appear.
    const ammoBefore = game.state.resources.ammo;
    const fab = game.buildBuilding(-100, 300, 'ammofab');
    game.advanceBy(3);
    const starved = { rate: game.buildingById(fab.id).rate, made: game.state.resources.ammo - ammoBefore };

    // Ore alone is not enough now: the whole chain has to be there.
    const [nx, ny] = LEVEL.oreNodes[0];
    game.buildBuilding(nx, ny, 'miner');
    game.advanceBy(20);
    const oreOnly = { rate: game.buildingById(fab.id).rate, short: game.buildingById(fab.id).short };

    game.buildBuilding(-100, 380, 'plant');
    game.advanceBy(30);
    const running = {
      rate: game.buildingById(fab.id).rate,
      ore: game.state.resources.ore,
      ammo: game.state.resources.ammo,
    };
    // A power plant needs no input at all.
    game.buildBuilding(-100, 380, 'plant');
    game.advanceBy(10);
    return { starved, oreOnly, running, power: game.state.resources.power, flows: game.flowRates() };
  });
  check('a factory with no ore stalls instead of inventing it',
    chain.starved.rate === 0 && chain.starved.made === 0, JSON.stringify(chain.starved));
  check('ore without power is not enough for a factory',
    chain.oreOnly.rate === 0 && chain.oreOnly.short === 'power', JSON.stringify(chain.oreOnly));
  check('ore and power together produce ammo',
    chain.running.rate > 0.99 && chain.running.ammo > 10, JSON.stringify(chain.running));
  check('a power plant needs no input', chain.power > 10, `${chain.power.toFixed(1)} power`);
  check('the panel reports net flow, production minus consumption',
    Math.abs(chain.flows.ore - 0.2) < 0.001 && Math.abs(chain.flows.ammo - 1.7) < 0.001,
    JSON.stringify(chain.flows));

  // Lasers and factories share the power pool, so overbuilding lasers is what
  // browns the ammo line out. That competition is the point of the change.
  const brownout = await page.evaluate(() => {
    const { game, LEVEL } = globalThis.__td;
    game.hardReset();
    game.state.credits = 500_000;
    game.buildBuilding(LEVEL.oreNodes[0][0], LEVEL.oreNodes[0][1], 'miner');
    // The plant sits in the top corridor, where lasers around it can both draw
    // from it and reach the path. The factory is far away on purpose: stock is
    // global, so only the lasers need to be near the plant.
    game.buildBuilding(110, 120, 'plant');
    const fab = game.buildBuilding(-100, 300, 'ammofab');
    game.advanceBy(60);
    const healthy = { rate: game.buildingById(fab.id).rate, power: game.state.resources.power };

    const spots = [[30, 120], [70, 120], [150, 120], [190, 120], [230, 120]];
    const built = spots.map(([x, y]) => game.buildTower(x, y, 'laser'));
    // Late-wave enemies, so the lasers keep firing instead of one-shotting a
    // wave-1 grunt and going quiet again.
    game.state.wave = 30;
    game.state.phase = 'wave';
    game.state.queue = Array(12).fill('grunt');
    game.state.resources.power = 0;
    for (let i = 0; i < 60 && !game.state.enemies.length; i++) game.advanceBy(0.5);
    game.advanceBy(20);
    const firing = game.state.towers.filter((t) => t.type === 'laser' && !t.starved).length;
    const contended = { rate: game.buildingById(fab.id).rate, short: game.buildingById(fab.id).short };
    return { lasers: built.filter((b) => b.ok).length, firing, healthy, contended };
  });
  check('a lone factory with its own plant runs at full rate',
    brownout.healthy.rate > 0.99, JSON.stringify(brownout.healthy));
  // Buildings draw before towers fire, so the factory keeps its share and the
  // guns are what go quiet. That is the intended way round: a visible, local
  // failure instead of the ammo line collapsing and taking the turrets with it.
  check('too many lasers on one plant starve the lasers, not the factory',
    brownout.lasers === 5 && brownout.firing === 0 && brownout.contended.rate > 0.99,
    JSON.stringify(brownout));

  // Factories competing with each other is the other half: demand from the
  // buildings alone can outrun a single plant.
  const overbuilt = await page.evaluate(() => {
    const { game, LEVEL } = globalThis.__td;
    game.hardReset();
    game.state.credits = 500_000;
    for (const [x, y] of LEVEL.oreNodes) game.buildBuilding(x, y, 'miner');
    game.buildBuilding(110, 120, 'plant');
    const fabs = [250, 300, 350, 400, 450, 500, 550, 600]
      .map((y) => game.buildBuilding(-30, y, 'ammofab'));
    game.state.resources.power = 0;
    game.advanceBy(60);
    const built = fabs.filter((f) => f.ok);
    return {
      fabs: built.length,
      rates: built.map((f) => +game.buildingById(f.id).rate.toFixed(2)),
      short: built.map((f) => game.buildingById(f.id).short),
      flows: game.flowRates(),
    };
  });
  check('more factories than one plant can feed run short of power',
    overbuilt.fabs >= 7 && overbuilt.rates.every((r) => r < 0.99)
    && overbuilt.short.every((k) => k === 'power'),
    JSON.stringify({ fabs: overbuilt.fabs, rates: overbuilt.rates }));

  const stockCap = await page.evaluate(() => {
    const { game, BALANCE } = globalThis.__td;
    game.hardReset();
    game.state.credits = 50_000;
    game.buildBuilding(-100, 380, 'plant');
    game.advanceBy(4000);
    return { power: game.state.resources.power, cap: BALANCE.resources.power.cap };
  });
  check('stock stops at its cap', stockCap.power === stockCap.cap,
    `${stockCap.power} vs ${stockCap.cap}`);

  const firstRunBase = await page.evaluate(() => {
    const { game, BALANCE } = globalThis.__td;
    game.hardReset();
    // The free depot arrives stocked, so the first turret dropped in its reach
    // fires immediately rather than waiting on a factory that does not exist.
    const depot = game.buildBuilding(252, 470, 'depot');
    const near = game.buildTower(210, 430, 'turret');
    game.state.phase = 'wave';
    game.state.queue = ['grunt'];
    for (let i = 0; i < 40 && !game.state.enemies.length; i++) game.advanceBy(0.5);
    game.advanceBy(6);
    return {
      free: depot.ok && depot.cost === 0,
      ammo: BALANCE.economy.startingStock.ammo,
      firing: near.ok && !game.towerById(near.id).starved,
    };
  });
  check('the free depot arrives with stock already in it',
    firstRunBase.free && firstRunBase.ammo > 0, JSON.stringify(firstRunBase));
  check('a turret in its reach fires straight away', firstRunBase.firing);

  const afterPrestige = await page.evaluate(() => {
    const { game } = globalThis.__td;
    game.hardReset();
    game.state.credits = 50_000;
    game.buildBuilding(-100, 380, 'plant');
    game.buildBuilding(20, 130, 'depot');       // spends the free grant
    game.state.runEarned = 10_000_000;
    const res = game.prestige();
    return {
      ok: res.ok,
      buildings: game.state.buildings.map((b) => b.type),
      ammo: game.state.resources.ammo,
      freeDepot: game.freeLeft('depot'),
      freeTurret: game.freeLeft('turret'),
    };
  });
  check('prestige wipes the base back to an empty map',
    afterPrestige.ok && afterPrestige.buildings.length === 0, JSON.stringify(afterPrestige));
  check('prestige hands the free depot and turret back',
    afterPrestige.freeDepot === 1 && afterPrestige.freeTurret === 1, JSON.stringify(afterPrestige));
  check('prestige leaves the opening stock alone', afterPrestige.ammo > 0, `${afterPrestige.ammo} ammo`);

  // The ore nodes are finite, so production has to scale with investment or the
  // economy is flat while the waves grow exponentially.
  const scaling = await page.evaluate(() => {
    const { game, LEVEL, BALANCE } = globalThis.__td;
    game.hardReset();
    game.state.credits = 10_000_000;
    for (const [x, y] of LEVEL.oreNodes) game.buildBuilding(x, y, 'miner');
    const base = game.flowRates().ore;

    for (let i = 0; i < 10; i++) game.buyUpgrade('output');
    const upgraded = game.flowRates().ore;

    game.state.cores = 50;                        // as a long-run prestige would
    const prestiged = game.flowRates().ore;

    return {
      miners: game.state.buildings.filter((b) => b.type === 'miner').length,
      nodes: LEVEL.oreNodes.length,
      base,
      upgraded,
      prestiged,
      level: game.state.upgrades.output,
      expect: 1 + 10 * BALANCE.upgrades.output.effect,
    };
  });
  check('every ore node can take a miner',
    scaling.miners === scaling.nodes, `${scaling.miners}/${scaling.nodes}`);
  check('the throughput upgrade lifts production',
    Math.abs(scaling.upgraded / scaling.base - scaling.expect) < 0.001,
    `${scaling.base.toFixed(1)} -> ${scaling.upgraded.toFixed(1)} ore/s at level ${scaling.level}`);
  check('prestige lifts production too', scaling.prestiged > scaling.upgraded * 3,
    `${scaling.upgraded.toFixed(1)} -> ${scaling.prestiged.toFixed(1)} ore/s`);
  check('the ore nodes are no longer a hard ceiling', scaling.prestiged > scaling.base * 10,
    `${scaling.base.toFixed(1)} -> ${scaling.prestiged.toFixed(1)} ore/s`);

  // Every derived number must survive a state built from BALANCE alone. A
  // missing upgrade key once made all of them NaN, silently.
  const finite = await page.evaluate(() => {
    const { game, BALANCE } = globalThis.__td;
    game.hardReset();
    const keys = Object.keys(BALANCE.upgrades);
    const numbers = {
      ...game.flowRates(),
      mult: game.prestigeMult(),
      stats: game.towerStats({ type: 'turret' }).damage,
      ...Object.fromEntries(keys.map((k) => [`mult:${k}`, game.upgradeMult(k)])),
      ...Object.fromEntries(keys.map((k) => [`cost:${k}`, game.upgradeCost(k)])),
    };
    return {
      missing: keys.filter((k) => game.state.upgrades[k] === undefined),
      bad: Object.entries(numbers).filter(([, v]) => !Number.isFinite(v)).map(([k]) => k),
    };
  });
  check('a fresh run has a level for every upgrade in BALANCE',
    finite.missing.length === 0, finite.missing.join(', '));
  check('no derived number comes back NaN', finite.bad.length === 0, finite.bad.join(', '));

  // Bigger buildings need bigger gaps, measured edge to edge.
  const footprints = await page.evaluate(() => {
    const { game, BALANCE } = globalThis.__td;
    game.hardReset();
    game.state.credits = 50_000;
    const b = BALANCE.build;
    const br = BALANCE.economy.buildingRadius;
    game.buildBuilding(-100, 300, 'depot');
    return {
      towerTower: b.towerRadius * 2 + b.spacingGap,
      buildingBuilding: br * 2 + b.spacingGap,
      tooClose: game.canPlaceBuildingAt(-100 + br * 2, 300, 'depot').reason,
      farEnough: game.canPlaceBuildingAt(-100 + br * 2 + b.spacingGap + 1, 300, 'depot').ok,
      towerTooClose: game.canPlaceAt(-100 + br + b.towerRadius - 1, 300).reason,
    };
  });
  check('tower spacing is unchanged at 26', footprints.towerTower === 26, `${footprints.towerTower}`);
  check('two buildings need room for both footprints',
    footprints.buildingBuilding === 42 && footprints.tooClose === 'too close to a building'
    && footprints.farEnough, JSON.stringify(footprints));
  check('a tower keeps clear of a building too',
    footprints.towerTooClose === 'too close to a building', footprints.towerTooClose);

  // --- save / reload -----------------------------------------------------  // --- save / reload -----------------------------------------------------
  section('save and reload');
  const saved = await page.evaluate(() => {
    const { game, LEVEL } = globalThis.__td;
    game.state.credits = 10_000;
    game.buildTower(30, 120, 'turret');
    game.buildTower(240, 222, 'laser');
    game.buildBuilding(110, 120, 'depot');
    game.buildBuilding(LEVEL.oreNodes[1][0], LEVEL.oreNodes[1][1], 'miner');
    game.state.resources.ore = 42;
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
  check('buildings survive a reload',
    reloaded.buildings.length === saved.buildings.length
    && reloaded.buildings.every((b, i) => b.type === saved.buildings[i].type
      && Math.abs(b.x - saved.buildings[i].x) < 1e-6),
    `${saved.buildings.length} -> ${reloaded.buildings.length}`);
  check('resource stock survives a reload',
    Math.abs(reloaded.resources.ore - saved.resources.ore) < 1e-6,
    `${saved.resources.ore} -> ${reloaded.resources.ore}`);
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
  // Nothing is placed for a migrated save either. It arrives with stock and a
  // free depot in hand, which is the same answer for a save that never had
  // buildings and one that spent everything and got stuck without one.
  check('a save from before supply lines arrives with stock and a free depot to place',
    migrated.buildings.length === 0 && migrated.resources.ammo > 0
    && migrated.freeBuilds.depot === 1,
    JSON.stringify({ buildings: migrated.buildings, ammo: migrated.resources.ammo, free: migrated.freeBuilds }));

  // A v2 save — towers placed freely, but no buildings and no stock.
  await page.evaluate(() => {
    localStorage.setItem('towerdefense.save', JSON.stringify({
      schemaVersion: 2,
      savedAt: Date.now(),
      data: {
        wave: 9, credits: 500, vaultHp: 20, cores: 3, lifetimeEarned: 9999,
        upgrades: { damage: 2, rate: 1, range: 0 },
        towers: [{ x: 210, y: 430, type: 'turret', spent: 30, kills: 12 }],
      },
    }));
    globalThis.__td.game.save = () => true;
  });
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!globalThis.__td);
  const fromV2 = await page.evaluate(() => {
    const { game } = globalThis.__td;
    const snap = game.snapshot();
    return {
      wave: snap.wave, cores: snap.cores, upgrades: snap.upgrades,
      towers: snap.towers.length, kills: snap.towers[0].kills,
      buildings: snap.buildings.map((b) => b.type),
      ammo: snap.resources.ammo,
      free: snap.freeBuilds,
      // The migrated turret was bought, so no turret grant — but the run has
      // no depot, so it gets one to place, and its tower is silent until the
      // player puts that depot somewhere.
      supplied: game.towerProblem(game.state.towers[0]) === null,
      suppliedOnceDepotPlaced: (() => {
        const d = game.buildBuilding(252, 470, 'depot');
        return d.ok && d.cost === 0 && game.towerProblem(game.state.towers[0]) === null;
      })(),
    };
  });
  check('a v2 save keeps its run intact',
    fromV2.wave === 9 && fromV2.cores === 3 && fromV2.upgrades.damage === 2
    && fromV2.towers === 1 && fromV2.kills === 12, JSON.stringify(fromV2));
  check('a v2 save gains stock and a free depot, and keeps its own towers',
    fromV2.buildings.length === 0 && fromV2.ammo > 0
    && fromV2.free.depot === 1 && fromV2.free.turret === 0, JSON.stringify(fromV2));
  check('placing that free depot brings the migrated tower back to life',
    fromV2.supplied === false && fromV2.suppliedOnceDepotPlaced === true, JSON.stringify(fromV2));

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
  check('tower cards show stats and a price', cards.every((c) => c.chips === 4 && c.cost.length > 0),
    cards.map((c) => `${c.name} ${c.cost}`).join(' | '));

  const buildingCards = await page.evaluate(() => {
    globalThis.__td.setTab('base');
    const out = [];
    for (const card of document.querySelectorAll('#panel .card.building')) {
      out.push({
        name: card.querySelector('.name').textContent,
        chips: [...card.querySelectorAll('.chip')].map((c) => c.title),
        art: getComputedStyle(card.querySelector('.tile')).backgroundImage.slice(0, 22),
      });
    }
    globalThis.__td.setTab('build');
    return out;
  });
  const fabCard = buildingCards.find((c) => c.name === 'Ammo factory');
  check('every building has a card with its own sprite',
    buildingCards.length === 5 && buildingCards.every((c) => c.art.startsWith('url("data:image/png')),
    buildingCards.map((c) => c.name).join(', '));
  check('a factory card lists both of its inputs',
    !!fabCard && fabCard.chips.some((t) => t.includes('Ore')) && fabCard.chips.some((t) => t.includes('Power')),
    fabCard && fabCard.chips.join(' | '));

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
  await page.evaluate(() => {
    const { game, ui, LEVEL } = globalThis.__td;
    game.state.credits = 4_000;
    game.buildBuilding(110, 120, 'depot');
    game.buildBuilding(LEVEL.oreNodes[2][0], LEVEL.oreNodes[2][1], 'miner');
    game.buildBuilding(210, 120, 'ammofab');
    game.buildBuilding(-60, 250, 'plant');
    game.buildBuilding(-60, 350, 'shellfab');
    game.state.selectedBuilding = game.state.buildings[1].id;
    game.advanceBy(20);
    ui.setTab('base');
  });
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(SHOTS, 'phone-base.png') });
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
