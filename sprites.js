// sprites.js — the procedural art library. No image files, ever.
//
// Everything the game draws is baked once into an offscreen canvas here and
// then blitted, both onto the play field (render.js) and into the DOM panels
// (icons.js). Keeping one copy means a tower card in the build panel is the
// same art as the tower standing on the map, not a lookalike drawn twice.
//
// Anything that moves independently (a hull, a spinning ring, a turret head)
// is baked as its own layer so it can be rotated separately at draw time —
// that is where the sense of detail comes from, not from more pixels.

import { BALANCE } from './balance.js';

export const SPRITE_SCALE = 3;
export const TOWER_R = BALANCE.build.towerRadius;
export const PALETTE = {
  bg: '#070b12',
  grid: '#0f1725',
  gridBright: '#16233a',
  path: '#141d2e',
  pathEdge: '#243349',
  pathDash: '#2c3d59',
  node: '#33456a',
  text: '#dbe6f6',
  dim: '#7d8ba5',
  vault: '#38bdf8',
  danger: '#f43f5e',
  steel: '#5b6c88',
  steelDark: '#26324a',
};

export function makeCanvas(w, h) {
  return (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

export function polygonPath(ctx, cx, cy, radius, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const x = cx + Math.cos(a) * radius;
    const y = cy + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amount));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function rgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Bake one layer. drawFn gets a context whose origin is the sprite centre and
// whose units are logical pixels.
export function bake(radius, drawFn) {
  const pad = 4;
  const r = radius + pad;
  const size = Math.ceil(r * 2 * SPRITE_SCALE);
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d');
  ctx.scale(SPRITE_SCALE, SPRITE_SCALE);
  ctx.translate(r, r);
  ctx.lineJoin = 'round';
  drawFn(ctx, radius);
  return { canvas, radius: r };
}

export function blit(ctx, sprite) {
  ctx.drawImage(sprite.canvas, -sprite.radius, -sprite.radius, sprite.radius * 2, sprite.radius * 2);
}

// ------------------------------------------------------------- enemy art ---
// Every enemy is a hull that faces the way it walks plus a ring that spins.
// Distinct silhouettes matter more than surface detail at 8 logical pixels.

export function bakeHull(key, def) {
  return bake(def.radius, (ctx, r) => {
    const body = ctx.createLinearGradient(-r, -r, r, r);
    body.addColorStop(0, shade(def.color, 55));
    body.addColorStop(0.55, def.color);
    body.addColorStop(1, shade(def.color, -80));

    if (key === 'swift') {
      // a dart: sharp nose, swept fins, engine glow at the tail
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.2, -r * 0.72);
      ctx.lineTo(-r * 0.75, -r * 0.3);
      ctx.lineTo(-r * 0.55, 0);
      ctx.lineTo(-r * 0.75, r * 0.3);
      ctx.lineTo(-r * 0.2, r * 0.72);
      ctx.closePath();
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = shade(def.color, 95);
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r * 0.35, 0);
      ctx.lineTo(-r * 0.3, -r * 0.18);
      ctx.lineTo(-r * 0.3, r * 0.18);
      ctx.closePath();
      ctx.fillStyle = 'rgba(6,10,18,0.7)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(-r * 0.62, 0, r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = shade(def.color, 120);
      ctx.fill();
      return;
    }

    if (key === 'hulk') {
      // heavy: thick frontal armour, rivets, narrow slit of a core
      polygonPath(ctx, 0, 0, r, 8, Math.PI / 8);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = shade(def.color, 70);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(0, 0, r * 0.92, -0.85, 0.85);
      ctx.lineWidth = r * 0.3;
      ctx.strokeStyle = shade(def.color, -40);
      ctx.stroke();

      ctx.fillStyle = rgba('#ffffff', 0.35);
      for (const a of [-0.6, 0, 0.6]) {
        ctx.beginPath();
        ctx.arc(Math.cos(a) * r * 0.78, Math.sin(a) * r * 0.78, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.42, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(4,8,14,0.85)';
      ctx.fill();
      ctx.strokeStyle = shade(def.color, 110);
      ctx.lineWidth = 0.8;
      ctx.stroke();
      return;
    }

    if (key === 'boss') {
      // layered core: a heavy shell with a cannon nub and a bright eye
      polygonPath(ctx, 0, 0, r, 12, 0);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = shade(def.color, 90);
      ctx.lineWidth = 1.4;
      ctx.stroke();

      polygonPath(ctx, 0, 0, r * 0.72, 6, Math.PI / 6);
      ctx.fillStyle = 'rgba(6,10,18,0.6)';
      ctx.fill();
      ctx.strokeStyle = shade(def.color, 40);
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = shade(def.color, -30);
      ctx.fillRect(r * 0.55, -r * 0.16, r * 0.5, r * 0.32);
      ctx.strokeStyle = shade(def.color, 80);
      ctx.lineWidth = 0.7;
      ctx.strokeRect(r * 0.55, -r * 0.16, r * 0.5, r * 0.32);

      ctx.beginPath();
      ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe4e6';
      ctx.fill();
      return;
    }

    // grunt: plated hexagon with a sensor eye toward the front
    polygonPath(ctx, 0, 0, r, 6, 0);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.strokeStyle = shade(def.color, 90);
    ctx.lineWidth = 1.1;
    ctx.stroke();

    ctx.strokeStyle = rgba('#000000', 0.35);
    ctx.lineWidth = 0.7;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35);
      ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
      ctx.stroke();
    }

    polygonPath(ctx, 0, 0, r * 0.42, 6, Math.PI / 6);
    ctx.fillStyle = 'rgba(4,8,14,0.8)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(r * 0.5, 0, r * 0.18, 0, Math.PI * 2);
    ctx.fillStyle = shade(def.color, 130);
    ctx.fill();
  });
}

// The counter-rotating ring: notches for most, a broken halo for the boss.
export function bakeRing(key, def) {
  const outer = def.radius * (key === 'boss' ? 1.5 : 1.3);
  return bake(outer, (ctx, r) => {
    const segments = key === 'boss' ? 6 : key === 'swift' ? 3 : 4;
    ctx.strokeStyle = rgba(def.color, key === 'boss' ? 0.85 : 0.6);
    ctx.lineWidth = key === 'boss' ? 2.2 : 1.4;
    ctx.lineCap = 'butt';
    const arc = (Math.PI * 2) / segments;
    for (let i = 0; i < segments; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.82, i * arc, i * arc + arc * 0.5);
      ctx.stroke();
    }
    if (key === 'boss') {
      ctx.strokeStyle = rgba(def.color, 0.35);
      ctx.lineWidth = 1;
      for (let i = 0; i < segments; i++) {
        const a = i * arc + arc * 0.25;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
        ctx.lineTo(Math.cos(a) * r * 0.95, Math.sin(a) * r * 0.95);
        ctx.stroke();
      }
    }
  });
}

// ------------------------------------------------------------- tower art ---
export function bakeTowerBase(def) {
  return bake(TOWER_R, (ctx, r) => {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.35, r * 0.95, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    const plate = ctx.createLinearGradient(0, -r, 0, r);
    plate.addColorStop(0, shade(def.color, -55));
    plate.addColorStop(0.5, shade(def.color, -95));
    plate.addColorStop(1, shade(def.color, -130));
    polygonPath(ctx, 0, 0, r, 8, Math.PI / 8);
    ctx.fillStyle = plate;
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = shade(def.color, 45);
    ctx.stroke();

    polygonPath(ctx, 0, 0, r * 0.72, 8, Math.PI / 8);
    ctx.strokeStyle = rgba('#000000', 0.4);
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = rgba('#ffffff', 0.25);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8, 0.9, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = '#0b1220';
    ctx.fill();
    ctx.strokeStyle = shade(def.color, 10);
    ctx.lineWidth = 0.9;
    ctx.stroke();
  });
}

// Heads point along +x and are rotated toward the target at draw time.
export function bakeTowerHead(key, def) {
  return bake(TOWER_R + 5, (ctx, r) => {
    // Steel, not the tower's colour: a head in the same hue as its base makes
    // the whole tower read as one lump at phone size.
    const metal = ctx.createLinearGradient(0, -r * 0.5, 0, r * 0.5);
    metal.addColorStop(0, '#93a4c2');
    metal.addColorStop(0.45, PALETTE.steel);
    metal.addColorStop(1, PALETTE.steelDark);
    const rim = shade(def.color, 60);

    if (key === 'laser') {
      ctx.fillStyle = metal;
      ctx.beginPath();
      ctx.moveTo(-r * 0.35, -r * 0.3);
      ctx.lineTo(r * 0.45, -r * 0.16);
      ctx.lineTo(r * 0.45, r * 0.16);
      ctx.lineTo(-r * 0.35, r * 0.3);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = 0.8;
      ctx.stroke();
      // emitter prongs and a lens
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.6;
      for (const sign of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(r * 0.4, sign * r * 0.22);
        ctx.lineTo(r * 0.78, sign * r * 0.12);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(r * 0.42, 0, r * 0.16, 0, Math.PI * 2);
      ctx.fillStyle = shade(def.color, 110);
      ctx.fill();
      return;
    }

    if (key === 'mortar') {
      // drum magazine plus a short fat tube with a muzzle brake
      ctx.beginPath();
      ctx.arc(-r * 0.2, 0, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = metal;
      ctx.fill();
      ctx.strokeStyle = rim;
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.fillStyle = PALETTE.steelDark;
      ctx.fillRect(-r * 0.1, -r * 0.26, r * 0.75, r * 0.52);
      ctx.strokeRect(-r * 0.1, -r * 0.26, r * 0.75, r * 0.52);
      ctx.fillStyle = shade(def.color, -10);
      ctx.fillRect(r * 0.5, -r * 0.34, r * 0.2, r * 0.68);
      ctx.strokeRect(r * 0.5, -r * 0.34, r * 0.2, r * 0.68);
      ctx.beginPath();
      ctx.arc(r * 0.6, 0, r * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = '#120a05';
      ctx.fill();
      return;
    }

    // turret: breech block and twin barrels with vents
    ctx.fillStyle = metal;
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(-r * 0.4, -r * 0.34, r * 0.7, r * 0.68, 2)
      : ctx.rect(-r * 0.4, -r * 0.34, r * 0.7, r * 0.68);
    ctx.fill();
    ctx.strokeStyle = rim;
    ctx.lineWidth = 0.9;
    ctx.stroke();

    for (const sign of [-1, 1]) {
      ctx.fillStyle = PALETTE.steel;
      ctx.fillRect(r * 0.2, sign * r * 0.1 - r * 0.09, r * 0.62, r * 0.18);
      ctx.strokeRect(r * 0.2, sign * r * 0.1 - r * 0.09, r * 0.62, r * 0.18);
    }
    ctx.strokeStyle = rgba('#000000', 0.45);
    ctx.lineWidth = 0.6;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.28 + i * 3, -r * 0.3);
      ctx.lineTo(-r * 0.28 + i * 3, r * 0.3);
      ctx.stroke();
    }
  });
}

// ---------------------------------------------------------- building art ---
// Buildings must not be mistaken for towers at a glance, so they are squares
// with a roof, where every tower is an octagon with a barrel. Silhouette does
// the work; the icon inside says which kind it is.
export const BUILDING_R = BALANCE.economy.buildingRadius;

function roofIcon(ctx, key, r, tint) {
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (key === 'miner') {                       // a pick over a heap
    ctx.beginPath();
    ctx.moveTo(-r * 0.4, r * 0.35);
    ctx.lineTo(r * 0.4, -r * 0.4);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(r * 0.1, -r * 0.55);
    ctx.quadraticCurveTo(r * 0.55, -r * 0.3, r * 0.55, r * 0.05);
    ctx.stroke();
    return;
  }
  if (key === 'plant') {                       // a bolt
    ctx.beginPath();
    ctx.moveTo(r * 0.22, -r * 0.6);
    ctx.lineTo(-r * 0.3, r * 0.05);
    ctx.lineTo(r * 0.05, r * 0.05);
    ctx.lineTo(-r * 0.16, r * 0.62);
    ctx.lineTo(r * 0.36, -r * 0.05);
    ctx.lineTo(r * 0.02, -r * 0.05);
    ctx.closePath();
    ctx.fillStyle = tint;
    ctx.fill();
    return;
  }
  if (key === 'ammofab' || key === 'shellfab') {   // a round, pointed or fat
    const w = key === 'shellfab' ? r * 0.34 : r * 0.22;
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.62);
    ctx.lineTo(w, -r * 0.2);
    ctx.lineTo(w, r * 0.5);
    ctx.lineTo(-w, r * 0.5);
    ctx.lineTo(-w, -r * 0.2);
    ctx.closePath();
    ctx.fillStyle = tint;
    ctx.fill();
    if (key === 'shellfab') {
      ctx.strokeStyle = 'rgba(6,10,18,0.65)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-w, r * 0.16);
      ctx.lineTo(w, r * 0.16);
      ctx.stroke();
    }
    return;
  }
  // depot: crates
  ctx.fillStyle = tint;
  for (const [cx, cy, cs] of [[-r * 0.3, r * 0.1, r * 0.3], [r * 0.28, r * 0.16, r * 0.24], [-r * 0.02, -r * 0.34, r * 0.26]]) {
    ctx.fillRect(cx - cs, cy - cs, cs * 2, cs * 2);
  }
}

export function bakeBuilding(key, def) {
  return bake(BUILDING_R + 2, (ctx, r) => {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.42, r * 0.95, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();

    const side = r * 0.82;
    const body = ctx.createLinearGradient(0, -side, 0, side);
    body.addColorStop(0, shade(def.color, -35));
    body.addColorStop(0.55, shade(def.color, -85));
    body.addColorStop(1, shade(def.color, -125));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-side, -side, side * 2, side * 2, 3);
    else ctx.rect(-side, -side, side * 2, side * 2);
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 1.3;
    ctx.strokeStyle = shade(def.color, 50);
    ctx.stroke();

    // corner bolts, so it reads as built rather than drawn
    ctx.fillStyle = rgba('#ffffff', 0.22);
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * side * 0.74, sy * side * 0.74, 0.9, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    roofIcon(ctx, key, r, shade(def.color, 90));
  });
}

// An ore node: a scatter of crystals in the ground, drawn once.
export function bakeOreNode() {
  return bake(14, (ctx, r) => {
    ctx.beginPath();
    ctx.ellipse(0, r * 0.3, r * 0.92, r * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fill();
    const shards = [[0, -0.25, 0.5], [-0.5, 0.12, 0.34], [0.48, 0.08, 0.38]];
    for (const [dx, dy, size] of shards) {
      const x = dx * r, y = dy * r, h = size * r;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h * 0.62, y + h * 0.32);
      ctx.lineTo(x, y + h * 0.62);
      ctx.lineTo(x - h * 0.62, y + h * 0.32);
      ctx.closePath();
      const grad = ctx.createLinearGradient(x, y - h, x, y + h);
      grad.addColorStop(0, '#d6d3d1');
      grad.addColorStop(1, '#57534e');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(231,229,228,0.7)';
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
  });
}
