// render.js — everything on the play field is drawn here, from code.
//
// The art itself lives in sprites.js; this file is the scene: background,
// path, towers, enemies, projectiles, effects and the drag preview.

import { BALANCE } from './balance.js';
import { LEVEL } from './game.js';
import {
  PALETTE, TOWER_R, blit, polygonPath, rgba, shade,
  bakeHull, bakeRing, bakeTowerBase, bakeTowerHead,
} from './sprites.js';

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const W = BALANCE.world.width;
  const H = BALANCE.world.height;

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

  let scale = 1, dpr = 1;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    scale = Math.min(cssW / W, cssH / H);
  }

  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const offX = (rect.width - W * scale) / 2;
    const offY = (rect.height - H * scale) / 2;
    return { x: (clientX - rect.left - offX) / scale, y: (clientY - rect.top - offY) / scale };
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

    const def = BALANCE.towers[drag.type];
    const stats = game.towerStats({ type: drag.type });
    const tint = drag.ok ? 'rgba(74,222,128,' : 'rgba(244,63,94,';

    ctx.beginPath();
    ctx.arc(drag.x, drag.y, stats.range, 0, Math.PI * 2);
    ctx.fillStyle = tint + '0.08)';
    ctx.fill();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = tint + '0.6)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.translate(drag.x, drag.y);
    blit(ctx, towerBases[drag.type]);
    ctx.rotate(-Math.PI / 2);
    blit(ctx, towerHeads[drag.type]);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(drag.x, drag.y, b.towerRadius + 3, 0, Math.PI * 2);
    ctx.strokeStyle = tint + '0.95)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const label = drag.ok ? def.name : drag.reason;
    if (label) {
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const w = ctx.measureText(label).width + 10;
      const ly = drag.y - b.towerRadius - 6;
      ctx.fillStyle = 'rgba(7,11,18,0.85)';
      ctx.fillRect(drag.x - w / 2, ly - 14, w, 15);
      ctx.fillStyle = drag.ok ? '#4ade80' : '#fca5a5';
      ctx.fillText(label, drag.x, ly);
    }
  }

  // Wave, count and enemy hp live in the DOM header now; the canvas only shows
  // what belongs on the field itself.
  function drawOverlay(game) {
    const state = game.state;

    if (state.paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(7,11,18,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 22px system-ui, sans-serif';
      ctx.fillStyle = PALETTE.text;
      ctx.fillText('PAUSED', W / 2, H / 2 - 8);
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.fillStyle = PALETTE.dim;
      ctx.fillText('you can still build and sell', W / 2, H / 2 + 14);
      ctx.restore();
    }

    if (state.banner) {
      const t = state.banner.life / state.banner.max;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '800 24px system-ui, sans-serif';
      ctx.fillStyle = state.banner.text === 'VAULT BREACHED' ? PALETTE.danger : PALETTE.text;
      ctx.fillText(state.banner.text, W / 2, H * 0.28);
      ctx.restore();
    }
  }

  function draw(game) {
    const rect = { w: canvas.width, h: canvas.height };
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, rect.w, rect.h);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, rect.w, rect.h);

    const offX = (rect.w / dpr - W * scale) / 2;
    const offY = (rect.h / dpr - H * scale) / 2;
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, offX * dpr, offY * dpr);

    const view = {
      x0: -offX / scale, y0: -offY / scale,
      x1: W + offX / scale, y1: H + offY / scale,
    };
    drawBackground(view);
    drawPath(game.state.time);
    drawVault(game);
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
    get scale() { return scale; },
    spriteCount: () => Object.keys(hulls).length + Object.keys(rings).length
      + Object.keys(towerBases).length + Object.keys(towerHeads).length,
  };
}
