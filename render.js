// render.js — everything on the play field is drawn here, from code.
//
// The art itself lives in sprites.js; this file is the scene: background,
// path, towers, enemies, projectiles, effects and the drag preview.

import { BALANCE } from './balance.js';
import { LEVEL } from './game.js';
import {
  PALETTE, TOWER_R, BUILDING_R, blit, polygonPath, rgba, shade,
  bakeHull, bakeRing, bakeTowerBase, bakeTowerHead, bakeBuilding, bakeOreNode,
} from './sprites.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const WORLD = BALANCE.world;

  const hulls = {};
  const rings = {};
  for (const [key, def] of Object.entries(BALANCE.enemies)) {
    hulls[key] = bakeHull(key, def);
    rings[key] = bakeRing(key, def);
  }
  const towerBases = {};
  const towerHeads = {};
  for (const [key, def] of Object.entries(BALANCE.towers)) {
    towerBases[key] = bakeTowerBase(def);
    towerHeads[key] = bakeTowerHead(key, def);
  }
  const buildingArt = {};
  for (const [key, def] of Object.entries(BALANCE.buildings)) {
    buildingArt[key] = bakeBuilding(key, def);
  }
  const oreArt = bakeOreNode();

  // ------------------------------------------------------------- camera ---
  // The arena is bigger than the screen, so the view is a window onto it:
  // `camera` is the world point at the centre of the canvas, and `zoom` is a
  // multiplier on the scale that fits one viewWidth x viewHeight screenful.
  // Zoom 1 therefore frames the game exactly as the fixed view used to.
  const camera = { x: LEVEL.center.x, y: LEVEL.center.y, zoom: 1 };
  let baseScale = 1, scale = 1, dpr = 1, cssW = 1, cssH = 1;

  const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

  // Half the visible world, in world units.
  function halfView() {
    return { w: cssW / scale / 2, h: cssH / scale / 2 };
  }

  // Never let the player push the arena off the screen. When the arena is
  // narrower than the view it simply centres instead.
  function clampCamera() {
    const half = halfView();
    camera.x = clamp(camera.x, WORLD.x + half.w, WORLD.x + WORLD.width - half.w);
    camera.y = clamp(camera.y, WORLD.y + half.h, WORLD.y + WORLD.height - half.h);
  }

  function applyZoom(next) {
    camera.zoom = clamp(next, BALANCE.camera.minZoom, BALANCE.camera.maxZoom);
    scale = baseScale * camera.zoom;
    clampCamera();
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    cssW = Math.max(1, rect.width);
    cssH = Math.max(1, rect.height);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    baseScale = Math.min(cssW / WORLD.viewWidth, cssH / WORLD.viewHeight);
    applyZoom(camera.zoom);
  }

  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: camera.x + (clientX - rect.left - cssW / 2) / scale,
      y: camera.y + (clientY - rect.top - cssH / 2) / scale,
    };
  }

  // The inverse, so callers (and tests) can aim at a world point on screen.
  function toClient(worldX, worldY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + cssW / 2 + (worldX - camera.x) * scale,
      y: rect.top + cssH / 2 + (worldY - camera.y) * scale,
    };
  }

  function panBy(dxClient, dyClient) {
    camera.x -= dxClient / scale;
    camera.y -= dyClient / scale;
    clampCamera();
  }

  // Zoom about a fixed screen point, so the world under the fingers stays put.
  function zoomAt(factor, clientX, clientY) {
    const before = toLogical(clientX, clientY);
    applyZoom(camera.zoom * factor);
    const after = toLogical(clientX, clientY);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    clampCamera();
  }

  function recentre() {
    camera.x = LEVEL.center.x;
    camera.y = LEVEL.center.y;
    applyZoom(1);
  }

  // Drawn across the whole visible area so letterboxing never shows as bars.
  function drawBackground(view) {
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    const grid = (spacing, color) => {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (let x = Math.ceil(view.x0 / spacing) * spacing; x <= view.x1; x += spacing) {
        ctx.moveTo(x, view.y0); ctx.lineTo(x, view.y1);
      }
      for (let y = Math.ceil(view.y0 / spacing) * spacing; y <= view.y1; y += spacing) {
        ctx.moveTo(view.x0, y); ctx.lineTo(view.x1, y);
      }
      ctx.stroke();
    };
    ctx.lineWidth = 0.5;
    grid(20, PALETTE.grid);
    grid(100, PALETTE.gridBright);
  }

  function tracePath() {
    ctx.beginPath();
    ctx.moveTo(LEVEL.path[0][0], LEVEL.path[0][1]);
    for (let i = 1; i < LEVEL.path.length; i++) ctx.lineTo(LEVEL.path[i][0], LEVEL.path[i][1]);
  }

  function drawPath(time) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    tracePath();
    ctx.strokeStyle = PALETTE.pathEdge;
    ctx.lineWidth = BALANCE.world.pathWidth + 4;
    ctx.stroke();
    tracePath();
    ctx.strokeStyle = PALETTE.path;
    ctx.lineWidth = BALANCE.world.pathWidth;
    ctx.stroke();

    ctx.save();
    tracePath();
    ctx.setLineDash([8, 14]);
    ctx.lineDashOffset = -(time * 26) % 22;
    ctx.strokeStyle = PALETTE.pathDash;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // junction nodes: reads as circuitry and marks every corner
    ctx.fillStyle = PALETTE.node;
    for (let i = 1; i < LEVEL.path.length - 1; i++) {
      ctx.beginPath();
      ctx.arc(LEVEL.path[i][0], LEVEL.path[i][1], 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawOre(game) {
    for (const [x, y] of LEVEL.oreNodes) {
      const mined = game.state.buildings.some(
        (b) => b.type === 'miner' && Math.hypot(b.x - x, b.y - y) <= BALANCE.economy.oreSnap);
      ctx.save();
      ctx.translate(x, y);
      // A worked node stays visible but recedes, so the map still reads as
      // "this is where the ore is" once the miners are on top of them.
      ctx.globalAlpha = mined ? 0.28 : 1;
      blit(ctx, oreArt);
      ctx.restore();
    }
  }

  function drawBuildings(game) {
    const state = game.state;
    for (const building of state.buildings) {
      const def = BALANCE.buildings[building.type];
      if (state.selectedBuilding === building.id) {
        ctx.beginPath();
        ctx.arc(building.x, building.y, def.radius, 0, Math.PI * 2);
        ctx.fillStyle = rgba(def.color, 0.06);
        ctx.fill();
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = rgba(def.color, 0.55);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.save();
      ctx.translate(building.x, building.y);
      blit(ctx, buildingArt[building.type]);
      // A converter with no input gets a dimmed, blinking mark rather than
      // looking identical to one that is running.
      if (def.produces && building.rate < 0.999) {
        const pulse = 0.45 + Math.sin(state.time * 5) * 0.3;
        ctx.globalAlpha = building.rate <= 0 ? pulse : 0.5;
        ctx.beginPath();
        ctx.arc(0, -BUILDING_R - 5, 2.8, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.danger;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
  }

  function drawTowers(game) {
    const state = game.state;
    for (const tower of state.towers) {
      const def = BALANCE.towers[tower.type];
      const selected = state.selected === tower.id;

      if (selected) {
        const stats = game.towerStats(tower);
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, stats.range, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56,189,248,0.07)';
        ctx.fill();
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = 'rgba(56,189,248,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.save();
      ctx.translate(tower.x, tower.y);
      if (tower.starved) ctx.globalAlpha = 0.55;
      blit(ctx, towerBases[tower.type]);
      ctx.rotate(tower.angle);
      const kick = (tower.recoil || 0) * 2.4;
      ctx.translate(-kick, 0);
      blit(ctx, towerHeads[tower.type]);
      if (tower.recoil > 0.55 && !def.beam) {
        const flash = (tower.recoil - 0.55) / 0.45;
        ctx.globalAlpha = flash;
        ctx.fillStyle = shade(def.color, 140);
        ctx.beginPath();
        ctx.moveTo(TOWER_R + 3, 0);
        ctx.lineTo(TOWER_R - 2, -3.2 * flash);
        ctx.lineTo(TOWER_R - 2, 3.2 * flash);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      if (tower.starved) {
        const pulse = 0.5 + Math.sin(state.time * 5) * 0.3;
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = PALETTE.danger;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, TOWER_R + 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = PALETTE.danger;
        ctx.font = '800 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText('!', tower.x, tower.y - TOWER_R - 5);
        ctx.restore();
      }
    }
  }

  function drawVault(game) {
    const [x, y] = LEVEL.vault;
    const hpRatio = Math.max(0, game.state.vaultHp / BALANCE.vault.maxHp);
    const healthy = hpRatio > 0.35;
    const tint = healthy ? PALETTE.vault : PALETTE.danger;
    const t = game.state.time;
    const pulse = 1 + Math.sin(t * 2.2) * 0.03;
    const r = 21 * pulse;

    ctx.save();
    ctx.translate(x, y);

    ctx.shadowColor = tint;
    ctx.shadowBlur = 16;
    polygonPath(ctx, 0, 0, r, 6, Math.PI / 6);
    const grad = ctx.createLinearGradient(0, -r, 0, r);
    grad.addColorStop(0, '#123449');
    grad.addColorStop(1, '#08121c');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.lineWidth = 2;
    ctx.strokeStyle = tint;
    polygonPath(ctx, 0, 0, r, 6, Math.PI / 6);
    ctx.stroke();

    // notched outer collar, slowly turning
    ctx.save();
    ctx.rotate(t * 0.25);
    ctx.strokeStyle = rgba(healthy ? '#38bdf8' : '#f43f5e', 0.55);
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(0, 0, r + 9, a, a + 0.5);
      ctx.stroke();
    }
    ctx.restore();

    // core, turning the other way
    ctx.save();
    ctx.rotate(-t * 0.6);
    polygonPath(ctx, 0, 0, r * 0.45, 3, 0);
    ctx.fillStyle = rgba(healthy ? '#22d3ee' : '#f43f5e', 0.5);
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(0, 0, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
    ctx.lineWidth = 3;
    ctx.strokeStyle = healthy ? '#22d3ee' : PALETTE.danger;
    ctx.stroke();

    ctx.fillStyle = PALETTE.text;
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(0, Math.ceil(game.state.vaultHp))), 0, 0.5);
    ctx.restore();
  }

  function drawEnemies(game) {
    const t = game.state.time;
    for (const e of game.state.enemies) {
      const def = BALANCE.enemies[e.type];
      ctx.save();
      ctx.translate(e.x, e.y);

      // ring first, spinning against the hull
      ctx.save();
      ctx.rotate(-e.spin * 0.8);
      ctx.globalAlpha = e.type === 'boss' ? 0.9 : 0.7;
      blit(ctx, rings[e.type]);
      ctx.restore();

      ctx.rotate(e.angle);
      if (e.flash > 0) {
        ctx.shadowColor = '#ffffff';
        ctx.shadowBlur = 10;
      }
      blit(ctx, hulls[e.type]);
      ctx.shadowBlur = 0;

      if (e.type === 'boss') {
        ctx.globalAlpha = 0.35 + Math.sin(t * 6) * 0.2;
        ctx.beginPath();
        ctx.arc(0, 0, def.radius * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = '#fff1f2';
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      const ratio = Math.max(0, e.hp / e.maxHp);
      if (ratio < 1) {
        const w = e.radius * 2.2;
        const top = e.y - e.radius - 8;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(e.x - w / 2 - 0.5, top - 0.5, w + 1, 4);
        ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.2 ? '#facc15' : '#f87171';
        ctx.fillRect(e.x - w / 2, top, w * ratio, 3);
      }
    }
  }

  function drawProjectiles(game) {
    for (const p of game.state.projectiles) {
      const dx = p.tx - p.x, dy = p.ty - p.y;
      const d = Math.hypot(dx, dy) || 1;
      const back = p.splashRadius ? 7 : 11;
      const tailX = p.x - (dx / d) * back;
      const tailY = p.y - (dy / d) * back;

      const trail = ctx.createLinearGradient(tailX, tailY, p.x, p.y);
      trail.addColorStop(0, rgba(p.color, 0));
      trail.addColorStop(1, rgba(p.color, 0.75));
      ctx.strokeStyle = trail;
      ctx.lineWidth = p.splashRadius ? 3 : 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(tailX, tailY);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.splashRadius ? 3.6 : 2.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  }

  function drawFx(game) {
    for (const f of game.state.fx) {
      const t = Math.max(0, f.life / f.max);
      if (f.kind === 'beam') {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.globalAlpha = t;
        ctx.strokeStyle = rgba(f.color, 0.35);
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        ctx.lineTo(f.x2, f.y2);
        ctx.stroke();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'ring') {
        ctx.save();
        ctx.globalAlpha = t * 0.9;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 1.6 * t + 0.4;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.size * (1.25 - t * 0.85), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (f.kind === 'spark') {
        ctx.globalAlpha = t;
        ctx.fillStyle = f.color;
        ctx.fillRect(f.x - 1.2, f.y - 1.2, 2.4, 2.4);
        ctx.globalAlpha = 1;
      } else if (f.kind === 'text') {
        ctx.globalAlpha = Math.min(1, t * 1.6);
        ctx.fillStyle = f.color;
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(f.text, f.x, f.y);
        ctx.globalAlpha = 1;
      }
    }
  }

  // While dragging, show where a tower may not go and what it would cover.
  function drawDrag(game) {
    const drag = game.state.drag;
    if (!drag || !Number.isFinite(drag.x)) return;
    const b = BALANCE.build;

    ctx.save();
    tracePath();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(244,63,94,0.10)';
    ctx.lineWidth = BALANCE.world.pathWidth + (b.towerRadius + b.pathClearance) * 2;
    ctx.stroke();
    ctx.restore();

    const building = drag.kind === 'building';
    const def = building ? BALANCE.buildings[drag.type] : BALANCE.towers[drag.type];
    const reach = building ? def.radius : game.towerStats({ type: drag.type }).range;
    const gx = building && Number.isFinite(drag.snapX) ? drag.snapX : drag.x;
    const gy = building && Number.isFinite(drag.snapY) ? drag.snapY : drag.y;
    const tint = drag.ok ? 'rgba(74,222,128,' : 'rgba(244,63,94,';

    ctx.beginPath();
    ctx.arc(gx, gy, reach, 0, Math.PI * 2);
    ctx.fillStyle = tint + '0.08)';
    ctx.fill();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = tint + '0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.translate(gx, gy);
    if (building) {
      blit(ctx, buildingArt[drag.type]);
    } else {
      blit(ctx, towerBases[drag.type]);
      ctx.rotate(-Math.PI / 2);
      blit(ctx, towerHeads[drag.type]);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(gx, gy, (building ? BUILDING_R : b.towerRadius) + 3, 0, Math.PI * 2);
    ctx.strokeStyle = tint + '0.95)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // While placing a miner, show which nodes are still free.
    if (building && def.needsOre) {
      for (const [nx, ny] of LEVEL.oreNodes) {
        const taken = game.state.buildings.some(
          (bl) => bl.type === 'miner' && Math.hypot(bl.x - nx, bl.y - ny) <= BALANCE.economy.oreSnap);
        ctx.beginPath();
        ctx.arc(nx, ny, BALANCE.economy.oreSnap, 0, Math.PI * 2);
        ctx.strokeStyle = taken ? 'rgba(244,63,94,0.45)' : 'rgba(74,222,128,0.7)';
        ctx.lineWidth = 1.2;
        ctx.setLineDash([3, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    const label = drag.ok ? def.name : drag.reason;
    if (label) {
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const w = ctx.measureText(label).width + 10;
      const ly = gy - b.towerRadius - 6;
      ctx.fillStyle = 'rgba(7,11,18,0.85)';
      ctx.fillRect(gx - w / 2, ly - 14, w, 15);
      ctx.fillStyle = drag.ok ? '#4ade80' : '#fca5a5';
      ctx.fillText(label, gx, ly);
    }
  }

  // Wave, count and enemy hp live in the DOM header now; the canvas only shows
  // what belongs on the field itself.
  // Screen furniture: drawn in css pixels, so it never zooms or slides with
  // the world underneath it.
  function drawOverlay(game) {
    const state = game.state;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (state.paused) {
      ctx.fillStyle = 'rgba(7,11,18,0.55)';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillStyle = PALETTE.text;
      ctx.fillText('PAUSED', cssW / 2, cssH / 2 - 8);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = PALETTE.dim;
      ctx.fillText('you can still build and sell', cssW / 2, cssH / 2 + 14);
    }

    if (state.banner) {
      const t = state.banner.life / state.banner.max;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 24px system-ui, sans-serif';
      ctx.fillStyle = state.banner.text === 'VAULT BREACHED' ? PALETTE.danger : PALETTE.text;
      ctx.fillText(state.banner.text, cssW / 2, cssH * 0.22);
      ctx.globalAlpha = 1;
    }

    // Zoom readout, only while it is not 1 — otherwise it is just noise.
    if (Math.abs(camera.zoom - 1) > 0.02) {
      ctx.font = '700 10px system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'top';
      ctx.fillStyle = PALETTE.dim;
      ctx.fillText(`${camera.zoom.toFixed(2)}x`, cssW - 8, 8);
    }
    ctx.restore();
  }

  // The edge of buildable land, and the gate the enemies come out of. Both
  // exist because the arena is now bigger than the screen: without them you
  // cannot tell where the world stops or where the wave enters.
  function drawArena(view) {
    ctx.save();
    ctx.fillStyle = 'rgba(3,6,12,0.55)';
    // four bands covering everything outside the arena
    const x0 = WORLD.x, y0 = WORLD.y, x1 = WORLD.x + WORLD.width, y1 = WORLD.y + WORLD.height;
    if (view.y0 < y0) ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, y0 - view.y0);
    if (view.y1 > y1) ctx.fillRect(view.x0, y1, view.x1 - view.x0, view.y1 - y1);
    if (view.x0 < x0) ctx.fillRect(view.x0, Math.max(view.y0, y0), x0 - view.x0, Math.min(view.y1, y1) - Math.max(view.y0, y0));
    if (view.x1 > x1) ctx.fillRect(x1, Math.max(view.y0, y0), view.x1 - x1, Math.min(view.y1, y1) - Math.max(view.y0, y0));
    ctx.strokeStyle = rgba('#22314c', 0.9);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 8]);
    ctx.strokeRect(x0, y0, WORLD.width, WORLD.height);
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawSpawnGate(time) {
    const [x, y] = LEVEL.path[0];
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = rgba('#ff7a59', 0.5);
    ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const r = 10 + i * 5;
      const phase = (time * 0.6 + i * 0.33) % 1;
      ctx.globalAlpha = 0.5 * (1 - phase);
      ctx.beginPath();
      ctx.arc(0, 0, r + phase * 6, -Math.PI / 2, Math.PI / 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = rgba('#ff7a59', 0.7);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -BALANCE.world.pathWidth / 2 - 3);
    ctx.lineTo(0, BALANCE.world.pathWidth / 2 + 3);
    ctx.stroke();
    ctx.restore();
  }

  function draw(game) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const k = scale * dpr;
    ctx.setTransform(k, 0, 0, k, (cssW / 2 - camera.x * scale) * dpr, (cssH / 2 - camera.y * scale) * dpr);

    const half = halfView();
    const view = {
      x0: camera.x - half.w, y0: camera.y - half.h,
      x1: camera.x + half.w, y1: camera.y + half.h,
    };
    drawBackground(view);
    drawArena(view);
    drawPath(game.state.time);
    drawSpawnGate(game.state.time);
    drawOre(game);
    drawVault(game);
    drawBuildings(game);
    drawTowers(game);
    drawEnemies(game);
    drawProjectiles(game);
    drawFx(game);
    drawDrag(game);
    drawOverlay(game);
  }

  resize();
  return {
    draw,
    resize,
    toLogical,
    toClient,
    panBy,
    zoomAt,
    recentre,
    camera,
    get scale() { return scale; },
    spriteCount: () => Object.keys(hulls).length + Object.keys(rings).length
      + Object.keys(towerBases).length + Object.keys(towerHeads).length,
  };
}
