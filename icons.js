// icons.js — the art the DOM shows: game sprites baked into tiles, plus a
// small set of vector glyphs.
//
// Two kinds of picture, on purpose:
//
//   sprite tiles  — the actual baked tower and enemy layers from sprites.js,
//                   composited and handed to CSS as a data URL. A card in the
//                   build panel therefore shows the same object that will be
//                   standing on the map, not an approximation of it.
//   glyphs        — abstract UI marks (a credit chip, a bolt for fire rate)
//                   that have no counterpart on the field. Drawn as inline SVG
//                   so they inherit `currentColor` and stay sharp at any size.
//
// Nothing here downloads anything: both kinds are generated at runtime.

import { BALANCE } from './balance.js';
import { bakeHull, bakeRing, bakeTowerBase, bakeTowerHead, blit } from './sprites.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// A tile is rendered once per (subject, size) and kept as a data URL, so a
// panel rebuild is a string assignment rather than a redraw.
const tileCache = new Map();
const towerLayers = new Map();
const enemyLayers = new Map();

function pixelRatio() {
  return Math.min(globalThis.devicePixelRatio || 1, 3);
}

// Draw into a square tile whose logical extent is `radius` in every direction.
function paintTile(px, radius, drawFn) {
  const dpr = pixelRatio();
  const size = Math.max(1, Math.round(px * dpr));
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const scale = size / (radius * 2);
  ctx.translate(size / 2, size / 2);
  ctx.scale(scale, scale);
  ctx.lineJoin = 'round';
  drawFn(ctx);
  return canvas.toDataURL();
}

function towerParts(key) {
  if (!towerLayers.has(key)) {
    const def = BALANCE.towers[key];
    towerLayers.set(key, { base: bakeTowerBase(def), head: bakeTowerHead(key, def) });
  }
  return towerLayers.get(key);
}

function enemyParts(key) {
  if (!enemyLayers.has(key)) {
    const def = BALANCE.enemies[key];
    enemyLayers.set(key, { hull: bakeHull(key, def), ring: bakeRing(key, def) });
  }
  return enemyLayers.get(key);
}

// A tower, barrel up, the way it looks the moment you drop it.
export function towerSpriteUrl(key, px = 44) {
  const id = `tower:${key}:${px}`;
  if (!tileCache.has(id)) {
    const parts = towerParts(key);
    const radius = Math.max(parts.base.radius, parts.head.radius) + 1;
    tileCache.set(id, paintTile(px, radius, (ctx) => {
      blit(ctx, parts.base);
      ctx.rotate(-Math.PI / 2);
      blit(ctx, parts.head);
    }));
  }
  return tileCache.get(id);
}

// An enemy, walking to the right, ring and hull as they appear on the field.
export function enemySpriteUrl(key, px = 26) {
  const id = `enemy:${key}:${px}`;
  if (!tileCache.has(id)) {
    const parts = enemyParts(key);
    const radius = Math.max(parts.hull.radius, parts.ring.radius) + 1;
    tileCache.set(id, paintTile(px, radius, (ctx) => {
      ctx.globalAlpha = 0.75;
      blit(ctx, parts.ring);
      ctx.globalAlpha = 1;
      blit(ctx, parts.hull);
    }));
  }
  return tileCache.get(id);
}

// The vault itself, for the prestige panel. Drawn here rather than baked,
// because nothing else needs it as a layer.
export function vaultSpriteUrl(px = 44) {
  const id = `vault:${px}`;
  if (!tileCache.has(id)) {
    tileCache.set(id, paintTile(px, 26, (ctx) => {
      const hex = (r) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 6 + (i / 6) * Math.PI * 2;
          const x = Math.cos(a) * r, y = Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };
      const grad = ctx.createLinearGradient(0, -21, 0, 21);
      grad.addColorStop(0, '#123449');
      grad.addColorStop(1, '#08121c');
      hex(21);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#38bdf8';
      ctx.stroke();
      ctx.strokeStyle = 'rgba(56,189,248,0.55)';
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(0, 0, 24, a, a + 0.5);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, -9);
      ctx.lineTo(8, 5);
      ctx.lineTo(-8, 5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(34,211,238,0.5)';
      ctx.fill();
    }));
  }
  return tileCache.get(id);
}

// ------------------------------------------------------------------ glyphs --
// 24x24 box, stroked in currentColor. `fill` marks the paths that are solid.
const GLYPHS = {
  credits: { d: ['M12 2.6 20 7.3v9.4L12 21.4 4 16.7V7.3z', 'M9 9.5h6', 'M9 12.5h6', 'M9 15.5h3.5'] },
  wave:    { d: ['M3 12h3.5', 'M9 6.5 14.5 12 9 17.5', 'M15.5 6.5 21 12l-5.5 5.5'] },
  vault:   { d: ['M12 2.8 19.2 6v6.2c0 4.3-3 7.9-7.2 9.2-4.2-1.3-7.2-4.9-7.2-9.2V6z', 'M12 9.5v5'] },
  core:    { d: ['M12 2.6 19.8 7v10L12 21.4 4.2 17V7z', 'M12 8.2 15.6 15H8.4z'] },
  damage:  { d: ['M12 3.5v3.2', 'M12 17.3v3.2', 'M3.5 12h3.2', 'M17.3 12h3.2', 'M12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2z'] },
  rate:    { d: ['M13.4 2.8 5.6 13.2h5l-1 8 7.8-10.4h-5z'] },
  range:   { d: ['M12 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z', 'M7.6 7.6a6.2 6.2 0 0 0 0 8.8', 'M16.4 7.6a6.2 6.2 0 0 1 0 8.8', 'M4.6 4.6a10.4 10.4 0 0 0 0 14.8', 'M19.4 4.6a10.4 10.4 0 0 1 0 14.8'] },
  kills:   { d: ['M12 2.6 19.8 7v10L12 21.4 4.2 17V7z', 'M9.2 9.2l5.6 5.6', 'M14.8 9.2l-5.6 5.6'] },
  sell:    { d: ['M12 4v9.5', 'M8.4 10.2 12 13.8l3.6-3.6', 'M4.8 16v3.2h14.4V16'] },
  pause:   { d: ['M9.2 5.5v13', 'M14.8 5.5v13'] },
  play:    { d: ['M7.5 4.8 19 12 7.5 19.2z'], fill: true },
  speed:   { d: ['M3.8 5.5 11 12l-7.2 6.5z', 'M12.8 5.5 20 12l-7.2 6.5z'], fill: true },
  sound:   { d: ['M4.5 9.5h3.2L12 5.8v12.4l-4.3-3.7H4.5z', 'M15.4 9.4a3.6 3.6 0 0 1 0 5.2', 'M17.8 7a7 7 0 0 1 0 10'] },
  mute:    { d: ['M4.5 9.5h3.2L12 5.8v12.4l-4.3-3.7H4.5z', 'M16 10l4 4', 'M20 10l-4 4'] },
  music:   { d: ['M9.4 17.5V5.6l8.4-1.8v11.7', 'M6.6 20.2a2.8 2.2 0 1 0 2.8-2.2 2.8 2.2 0 0 0-2.8 2.2z', 'M15 18.3a2.8 2.2 0 1 0 2.8-2.2 2.8 2.2 0 0 0-2.8 2.2z'] },
  trash:   { d: ['M4.8 6.6h14.4', 'M9.4 6.6V4.4h5.2v2.2', 'M6.6 6.6l1 13h8.8l1-13', 'M10.2 10v6', 'M13.8 10v6'] },
  star:    { d: ['M12 3.4l2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.8l6-.8z'], fill: true },
  build:   { d: ['M12 3.4 20 8v8l-8 4.6L4 16V8z', 'M12 9v6', 'M9 12h6'] },
  upgrade: { d: ['M12 20V6.4', 'M6.4 12 12 6.4l5.6 5.6', 'M6.4 3.8h11.2'] },
  clock:   { d: ['M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8z', 'M12 7.4V12l3.2 2'] },
  drag:    { d: ['M12 3.6v16.8', 'M8.6 6.8 12 3.6l3.4 3.2', 'M8.6 17.2 12 20.4l3.4-3.2', 'M6.6 12h10.8'] },
};

// Returns an <svg> element. Size and colour come from CSS.
export function glyph(name, className = 'glyph') {
  const spec = GLYPHS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className);
  if (!spec) return svg;
  for (const d of spec.d) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', spec.fill ? 'currentColor' : 'none');
    if (!spec.fill) {
      path.setAttribute('stroke', 'currentColor');
      path.setAttribute('stroke-width', '1.7');
      path.setAttribute('stroke-linecap', 'round');
      path.setAttribute('stroke-linejoin', 'round');
    }
    svg.appendChild(path);
  }
  return svg;
}

export function hasGlyph(name) {
  return Object.hasOwn(GLYPHS, name);
}
