// render.js — every pixel is drawn here, from code. No image files, ever.
//
// Sprites are generated once into offscreen canvases at init and then blitted,
// which keeps per-frame work down on a phone.

import { BALANCE } from './balance.js';
import { LEVEL } from './game.js';
import { formatNumber } from './format.js';

const SPRITE_SCALE = 3; // sprites are baked at 3x and drawn down for crispness
const TOWER_R = BALANCE.build.towerRadius;

const PALETTE = {
  bg: '#070b12',
  grid: '#0f1725',
  gridBright: '#16233a',
  path: '#141d2e',
  pathEdge: '#243349',
  pathDash: '#2c3d59',
  slot: '#1d2942',
  slotEdge: '#33456a',
  text: '#dbe6f6',
  dim: '#7d8ba5',
  vault: '#38bdf8',
  danger: '#f43f5e',
};

function makeCanvas(w, h) {
  const c = (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
  return c;
}

function polygonPath(ctx, cx, cy, radius, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `rgb(${r},${g},${b})`;
}

// A spinning polygon with a bright rim and a darker core.
function bakeEnemySprite(def) {
  const r = def.radius;
  const pad = 4;
  const size = Math.ceil((r + pad) * 2 * SPRITE_SCALE);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
  const cx = r + pad, cy = r + pad;

  const grad = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
  grad.addColorStop(0, shade(def.color, 60));
  grad.addColorStop(0.6, def.color);
  grad.addColorStop(1, shade(def.color, -70));

  ctx.shadowColor = def.color;
  ctx.shadowBlur = r * 0.9;
  polygonPath(ctx, cx, cy, r, def.sides, -Math.PI / 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.lineWidth = 1.2;
  ctx.strokeStyle = shade(def.color, 90);
  ctx.stroke();

  polygonPath(ctx, cx, cy, r * 0.45, def.sides, Math.PI / 2);
  ctx.fillStyle = 'rgba(4,8,14,0.75)';
  ctx.fill();
  ctx.strokeStyle = shade(def.color, 30);
  ctx.lineWidth = 0.8;
  ctx.stroke();

  return { canvas: c, size, radius: r + pad };
}

function bakeTowerBase(def) {
  const r = BALANCE.build.towerRadius;
  const pad = 3;
  const size = Math.ceil((r + pad) * 2 * SPRITE_SCALE);
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
  const cx = r + pad, cy = r + pad;

  const grad = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
  grad.addColorStop(0, shade(def.color, -20));
  grad.addColorStop(1, shade(def.color, -110));
  polygonPath(ctx, cx, cy, r, 6, Math.PI / 6);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = shade(def.color, 40);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(6,10,18,0.8)';
  ctx.fill();
  return { canvas: c, size, radius: r + pad };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const W = BALANCE.world.width;
  const H = BALANCE.world.height;

  const enemySprites = {};
  for (const [key, def] of Object.entries(BALANCE.enemies)) enemySprites[key] = bakeEnemySprite(def);
  const towerSprites = {};
  for (const [key, def] of Object.entries(BALANCE.towers)) towerSprites[key] = bakeTowerBase(def);

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

  // Screen (client) coordinates -> logical world coordinates.
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

    // flowing dashes give the path a direction without any assets
    ctx.save();
    tracePath();
    ctx.setLineDash([8, 14]);
    ctx.lineDashOffset = -(time * 26) % 22;
    ctx.strokeStyle = PALETTE.pathDash;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function drawTowers(game) {
    const state = game.state;
    for (const tower of state.towers) {
      const def = BALANCE.towers[tower.type];
      const sprite = towerSprites[tower.type];
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

      ctx.drawImage(sprite.canvas, tower.x - sprite.radius, tower.y - sprite.radius,
        sprite.radius * 2, sprite.radius * 2);

      // barrel, drawn rotated toward the current target
      ctx.save();
      ctx.translate(tower.x, tower.y);
      ctx.rotate(tower.angle);
      ctx.fillStyle = shade(def.color, 40);
      if (def.beam) {
        ctx.fillRect(0, -1.5, TOWER_R + 3, 3);
        ctx.fillRect(TOWER_R, -3, 3, 6);
      } else if (def.splashRadius) {
        ctx.fillRect(0, -3.5, TOWER_R - 1, 7);
      } else {
        ctx.fillRect(0, -2, TOWER_R + 2, 4);
      }
      ctx.restore();
    }
  }

  function drawVault(game) {
    const [x, y] = LEVEL.vault;
    const hpRatio = Math.max(0, game.state.vaultHp / BALANCE.vault.maxHp);
    const pulse = 1 + Math.sin(game.state.time * 2.2) * 0.03;
    const r = 21 * pulse;

    ctx.save();
    ctx.shadowColor = hpRatio > 0.35 ? PALETTE.vault : PALETTE.danger;
    ctx.shadowBlur = 16;
    polygonPath(ctx, x, y, r, 6, Math.PI / 6);
    const grad = ctx.createLinearGradient(x, y - r, x, y + r);
    grad.addColorStop(0, '#123449');
    grad.addColorStop(1, '#08121c');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();

    ctx.lineWidth = 2;
    ctx.strokeStyle = hpRatio > 0.35 ? PALETTE.vault : PALETTE.danger;
    polygonPath(ctx, x, y, r, 6, Math.PI / 6);
    ctx.stroke();

    // hp arc
    ctx.beginPath();
    ctx.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * hpRatio);
    ctx.lineWidth = 3;
    ctx.strokeStyle = hpRatio > 0.35 ? '#22d3ee' : PALETTE.danger;
    ctx.stroke();

    ctx.fillStyle = PALETTE.text;
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(Math.max(0, Math.ceil(game.state.vaultHp))), x, y + 0.5);
  }

  function drawEnemies(game) {
    for (const e of game.state.enemies) {
      const sprite = enemySprites[e.type];
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.rotate(e.spin);
      if (e.flash > 0) ctx.globalAlpha = 0.65;
      ctx.drawImage(sprite.canvas, -sprite.radius, -sprite.radius, sprite.radius * 2, sprite.radius * 2);
      ctx.restore();

      const ratio = Math.max(0, e.hp / e.maxHp);
      if (ratio < 1) {
        const w = e.radius * 2.2;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 7, w, 3);
        ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.2 ? '#facc15' : '#f87171';
        ctx.fillRect(e.x - w / 2, e.y - e.radius - 7, w * ratio, 3);
      }
    }
  }

  function drawProjectiles(game) {
    for (const p of game.state.projectiles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.splashRadius ? 4 : 2.6, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
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
        ctx.globalAlpha = t;
        ctx.strokeStyle = f.color;
        ctx.lineWidth = 2;
        ctx.shadowColor = f.color;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.moveTo(f.x1, f.y1);
        ctx.lineTo(f.x2, f.y2);
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

    // the strip along the path that towers may not enter
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
    ctx.globalAlpha = 0.75;
    const sprite = towerSprites[drag.type];
    ctx.drawImage(sprite.canvas, drag.x - sprite.radius, drag.y - sprite.radius,
      sprite.radius * 2, sprite.radius * 2);
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

  function drawOverlay(game) {
    const state = game.state;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = PALETTE.dim;
    const label = state.phase === 'prep'
      ? `next wave in ${state.phaseTimer.toFixed(1)}s`
      : `wave ${state.wave} · ${state.enemies.length + state.queue.length} left`;
    ctx.fillText(label, 8, 8);

    ctx.textAlign = 'right';
    ctx.fillText(`enemy hp ${formatNumber(game.waveHp(state.wave))}`, W - 8, 8);

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
  return { draw, resize, toLogical, get scale() { return scale; } };
}
