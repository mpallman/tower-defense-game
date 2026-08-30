// sprites.js — the procedural art library. No image files, ever.
//
// Everything the game draws is baked once into an offscreen canvas here and
// then blitted, both onto the play field (render.js) and into the DOM panels
// (icons.js). Keeping one copy means a tower card in the build panel is the
// same art as the tower standing on the map, not a lookalike drawn twice.
//
// This file draws the things that fight — enemies and towers. The things that
// supply them live in structures.js, which shares every helper here.
//
// Anything that moves independently (a hull, a spinning ring, a turret head)
// is baked as its own layer so it can be rotated separately at draw time —
// that is where the sense of detail comes from, not from more pixels.
//
// Every surface here is lit by paint.js: one light for the whole game, warm
// on the lit face and cool in shadow, grain on everything, and one emissive
// focal point per subject. Three rules that stop a shape looking auto-drawn:
//
//   * Nothing is perfectly symmetric. Each subject carries one detail that
//     exists on one side only, so the eye finds a front and a top.
//   * Detail is not spread evenly. One bright feature, and everything else
//     subordinate to it — even detail everywhere reads as noise at 8px.
//   * The subject's colour lives in its lights and edges, not in its fill.
//     A hull flooded with a saturated accent reads as a UI chip on the map.

import { BALANCE } from './balance.js';
import {
  material, rim, contact, grain, scuff, emissive, shapePath,
  blend, alpha as fade, tint, seedOf,
} from './paint.js';

export const SPRITE_SCALE = 3;
export const TOWER_R = BALANCE.build.towerRadius;
export const BUILDING_R = BALANCE.economy.buildingRadius;
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
};

export function makeCanvas(w, h) {
  return (typeof OffscreenCanvas !== 'undefined')
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

export function polygonPath(ctx, cx, cy, radius, sides, rotation) {
  shapePath(ctx, cx, cy, radius, sides, rotation);
}

export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amount));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function rgba(hex, alpha) {
  return fade(hex, alpha);
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

// Fill a shape, light it, texture it and edge it in one move. `pathFn` must
// leave a closed path on the context; it is called twice, because a path is
// consumed by the fill. Shared with structures.js.
export function surface(ctx, pathFn, r, opts = {}) {
  const {
    fill, edge, seed = 1, specks = 70, wear = 0, edgeWidth = 0.9, edgeStrength = 1,
  } = opts;
  pathFn();
  ctx.fillStyle = fill;
  ctx.fill();

  ctx.save();
  pathFn();
  ctx.clip();
  grain(ctx, r, seed, { count: specks });
  if (wear) scuff(ctx, r, seed ^ 0x9e37, { count: wear });
  ctx.restore();

  if (edge) {
    // A dark keyline under the rim. The floor has texture on it now, and
    // without this the shadow side of a hull dissolves straight into it.
    pathFn();
    ctx.strokeStyle = 'rgba(3,6,12,0.7)';
    ctx.lineWidth = edgeWidth + 1;
    ctx.stroke();
    pathFn();
    ctx.strokeStyle = rim(ctx, r, edge, edgeStrength);
    ctx.lineWidth = edgeWidth;
    ctx.stroke();
  }
}

// ------------------------------------------------------------- enemy art ---
// Every enemy is a hull that faces the way it walks plus a ring that spins.
// Distinct silhouettes matter more than surface detail at 8 logical pixels —
// so each hull is asymmetric along the walking axis and carries exactly one
// lit element, its eye.

export function bakeHull(key, def) {
  return bake(def.radius, (ctx, r) => {
    const seed = seedOf('hull:' + key);
    // The body is the enemy's hue drained most of the way to metal. Its colour
    // comes back in the rim, the eye and the vents.
    const body = blend(def.color, '#39404f', 0.5);
    const hot = def.color;
    const fill = material(ctx, r, body, { key: 0.5, shadow: 0.62 });

    if (key === 'swift') {
      // a dart: sharp nose, one canard longer than the other, engine at the tail
      const hull = () => {
        ctx.beginPath();
        ctx.moveTo(r * 1.05, 0);
        ctx.lineTo(r * 0.1, -r * 0.46);
        ctx.lineTo(-r * 0.34, -r * 0.86);      // the long fin, port side only
        ctx.lineTo(-r * 0.66, -r * 0.24);
        ctx.lineTo(-r * 0.52, 0);
        ctx.lineTo(-r * 0.66, r * 0.22);
        ctx.lineTo(-r * 0.3, r * 0.58);
        ctx.lineTo(r * 0.12, r * 0.4);
        ctx.closePath();
      };
      surface(ctx, hull, r, { fill, edge: hot, seed, specks: 44, edgeWidth: 0.7 });

      ctx.save();
      hull();
      ctx.clip();
      ctx.fillStyle = 'rgba(5,8,15,0.55)';    // a spine shadow down one side
      ctx.beginPath();
      ctx.moveTo(r * 1.05, 0);
      ctx.lineTo(-r * 0.5, r * 0.5);
      ctx.lineTo(-r * 0.5, -r * 0.02);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      emissive(ctx, -r * 0.5, 0, r * 0.16, hot, { bloom: 1.9 });
      ctx.fillStyle = fade('#ffffff', 0.75);   // the nose sensor
      ctx.beginPath();
      ctx.arc(r * 0.58, -r * 0.06, r * 0.1, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (key === 'hulk') {
      // heavy: a slab of frontal armour bolted on off-centre, scarred
      const hull = () => shapePath(ctx, 0, 0, r, 8, Math.PI / 8, { jitter: 0.07, seed });
      surface(ctx, hull, r, { fill, edge: hot, seed, specks: 110, wear: 4, edgeWidth: 1.1 });

      ctx.save();
      hull();
      ctx.clip();
      // the brow plate, riding higher on the port side
      ctx.beginPath();
      ctx.moveTo(r * 0.2, -r * 1.05);
      ctx.lineTo(r * 1.05, -r * 0.34);
      ctx.lineTo(r * 1.05, r * 0.5);
      ctx.lineTo(r * 0.28, r * 0.86);
      ctx.closePath();
      ctx.fillStyle = material(ctx, r, blend(def.color, '#39404f', 0.34), { key: 0.58, shadow: 0.46 });
      ctx.fill();
      ctx.strokeStyle = fade('#04070d', 0.55);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      grain(ctx, r, seed ^ 0x51, { count: 40 });
      // two bolts, clustered, not a ring of them
      ctx.fillStyle = 'rgba(255,246,228,0.4)';
      for (const [bx, by] of [[0.52, -0.5], [0.66, -0.2]]) {
        ctx.beginPath();
        ctx.arc(bx * r, by * r, 0.85, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // the viewing slit, sunk into the plate
      ctx.beginPath();
      ctx.ellipse(r * 0.34, r * 0.04, r * 0.34, r * 0.15, -0.12, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(3,6,11,0.9)';
      ctx.fill();
      emissive(ctx, r * 0.42, r * 0.03, r * 0.1, hot, { bloom: 1.9 });
      return;
    }

    if (key === 'boss') {
      // a fortress: blocky crown, one cannon nub, and an eye you cannot miss
      const hull = () => shapePath(ctx, 0, 0, r, 9, 0.16, { jitter: 0.13, seed });
      surface(ctx, hull, r, {
        fill: material(ctx, r, blend(def.color, '#39404f', 0.46), { key: 0.5, shadow: 0.6 }),
        edge: hot, seed, specks: 150, wear: 5, edgeWidth: 1.3,
      });

      ctx.save();
      hull();
      ctx.clip();
      // an inner shell, rotated off the outer one so the two never line up
      shapePath(ctx, -r * 0.05, -r * 0.04, r * 0.74, 6, 0.5, { jitter: 0.1, seed: seed ^ 7 });
      ctx.fillStyle = 'rgba(6,10,18,0.62)';
      ctx.fill();
      ctx.strokeStyle = fade(hot, 0.45);
      ctx.lineWidth = 0.9;
      ctx.stroke();
      grain(ctx, r, seed ^ 0x2b, { count: 60 });
      ctx.restore();

      // the barrel: one, on the walking axis, sitting low
      ctx.save();
      ctx.rotate(0.1);
      ctx.fillStyle = material(ctx, r * 0.5, '#6c7da2', { key: 0.55, shadow: 0.58 });
      ctx.beginPath();
      ctx.roundRect
        ? ctx.roundRect(r * 0.5, -r * 0.17, r * 0.62, r * 0.34, 1.5)
        : ctx.rect(r * 0.5, -r * 0.17, r * 0.62, r * 0.34);
      ctx.fill();
      ctx.strokeStyle = rim(ctx, r * 0.5, hot, 0.8);
      ctx.lineWidth = 0.7;
      ctx.stroke();
      ctx.restore();

      emissive(ctx, -r * 0.05, -r * 0.04, r * 0.2, '#fff1f2', { bloom: 1.8 });
      return;
    }

    // grunt: a plated hex, front-heavy, with a stub aerial on one shoulder
    const hull = () => shapePath(ctx, 0, 0, r, 6, 0.08, { jitter: 0.09, seed });
    surface(ctx, hull, r, { fill, edge: hot, seed, specks: 70, wear: 2, edgeWidth: 1 });

    ctx.save();
    hull();
    ctx.clip();
    // two panel seams on the lit side only, at different weights
    ctx.strokeStyle = 'rgba(4,7,13,0.5)';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(-r * 0.9, -r * 0.34);
    ctx.lineTo(r * 0.5, -r * 0.52);
    ctx.stroke();
    ctx.lineWidth = 0.45;
    ctx.beginPath();
    ctx.moveTo(-r * 0.6, r * 0.46);
    ctx.lineTo(r * 0.35, r * 0.6);
    ctx.stroke();
    // a lit vent, off the centre line
    ctx.fillStyle = fade(hot, 0.5);
    ctx.fillRect(-r * 0.55, -r * 0.18, r * 0.3, r * 0.1);
    ctx.restore();

    ctx.strokeStyle = tint(def.color, 'key', 0.35, 0.75);   // the aerial
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(-r * 0.1, -r * 0.72);
    ctx.lineTo(-r * 0.34, -r * 1.12);
    ctx.stroke();

    // the eye: sunk in a dark housing, forward of centre
    ctx.beginPath();
    ctx.arc(r * 0.42, r * 0.02, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(3,6,11,0.85)';
    ctx.fill();
    emissive(ctx, r * 0.42, r * 0.02, r * 0.11, hot, { bloom: 1.9 });
  });
}

// The counter-rotating ring. Segment lengths are uneven and seeded: a ring of
// four identical arcs is the single most machine-drawn thing on the field.
export function bakeRing(key, def) {
  const outer = def.radius * (key === 'boss' ? 1.5 : 1.3);
  return bake(outer, (ctx, r) => {
    const random = (() => { let s = seedOf('ring:' + key); return () => (s = Math.imul(s ^ (s >>> 15), 1 | s), ((s ^ (s >>> 14)) >>> 0) / 4294967296); })();
    const segments = key === 'boss' ? 5 : key === 'swift' ? 3 : 4;
    ctx.lineCap = 'butt';
    let a = 0;
    for (let i = 0; i < segments; i++) {
      const span = ((Math.PI * 2) / segments) * (0.28 + random() * 0.42);
      const radius = r * (0.78 + random() * 0.1);
      ctx.strokeStyle = rim(ctx, r, def.color, key === 'boss' ? 0.95 : 0.7);
      ctx.lineWidth = (key === 'boss' ? 1.7 : 1.1) + random() * 0.9;
      ctx.beginPath();
      ctx.arc(0, 0, radius, a, a + span);
      ctx.stroke();
      a += (Math.PI * 2) / segments;
    }
    // one spar, on one side, tying the ring back to the hull
    ctx.strokeStyle = fade(def.color, 0.3);
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(-r * 0.3, -r * 0.5);
    ctx.lineTo(-r * 0.62, -r * 0.6);
    ctx.stroke();
  });
}

// ------------------------------------------------------------- tower art ---
// Each tower type gets its own footprint, not one shared octagon with a
// different gun on it. Silhouette is what you read at a glance on a phone;
// two towers that differ only in their head are two of the same tower.
export function bakeTowerBase(key, def) {
  return bake(TOWER_R, (ctx, r) => {
    const seed = seedOf('base:' + key);
    contact(ctx, r, { spread: 1.25, opacity: 0.5 });
    // Painted in the tower's hue, but heavily knocked back toward steel: the
    // base has to say which tower this is from across the room without
    // competing with the head, which is the part that moves and aims.
    const pad = material(ctx, r, blend(def.color, '#3a4761', 0.85), { key: 0.5, shadow: 0.58 });

    if (key === 'laser') {
      // a five-sided pad with heat fins down one flank
      const plate = () => shapePath(ctx, 0, 0, r * 0.98, 5, -Math.PI / 2 + 0.35, { jitter: 0.05, seed });
      surface(ctx, plate, r, { fill: pad, edge: def.color, seed, specks: 60, edgeWidth: 1.2, edgeStrength: 0.45 });
      ctx.strokeStyle = fade(def.color, 0.32);
      ctx.lineWidth = 1.1;
      for (let i = 0; i < 3; i++) {          // fins, one side
        ctx.beginPath();
        ctx.moveTo(-r * 0.72 + i * r * 0.2, r * 0.32);
        ctx.lineTo(-r * 0.56 + i * r * 0.2, r * 0.72);
        ctx.stroke();
      }
    } else if (key === 'mortar') {
      // a sunken pit inside a blast collar, thicker where the light lands
      const collar = () => shapePath(ctx, 0, 0, r, 14, 0, { jitter: 0.05, seed });
      surface(ctx, collar, r, { fill: pad, edge: def.color, seed, specks: 90, wear: 3, edgeWidth: 1.2, edgeStrength: 0.75 });
      ctx.beginPath();
      ctx.arc(r * 0.05, r * 0.05, r * 0.66, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(4,8,14,0.72)';
      ctx.fill();
      ctx.strokeStyle = fade('#000000', 0.5);
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,244,226,0.22)';   // the lit lip of the pit
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(r * 0.05, r * 0.05, r * 0.66, Math.PI * 0.95, Math.PI * 1.85);
      ctx.stroke();
    } else {
      // a bolted square plate with the corners cut off
      const plate = () => shapePath(ctx, 0, 0, r, 8, Math.PI / 8, { jitter: 0.03, seed, squash: 0.97 });
      surface(ctx, plate, r, { fill: pad, edge: def.color, seed, specks: 80, wear: 2, edgeWidth: 1.2, edgeStrength: 0.75 });
      ctx.fillStyle = 'rgba(255,246,228,0.3)';
      for (const [bx, by] of [[-0.7, -0.62], [0.72, -0.6], [-0.72, 0.66]]) {
        ctx.beginPath();
        ctx.arc(bx * r, by * r, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // The tower's colour, painted on: a marking reads as a machine that was
    // labelled, where a pad flooded with the hue reads as a UI chip. This and
    // the head's lights are the only places the hue appears.
    ctx.strokeStyle = fade(def.color, 0.55);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, -2.5, -1.4);
    ctx.stroke();
    ctx.fillStyle = fade(def.color, 0.32);
    ctx.beginPath();
    ctx.moveTo(-r * 0.86, r * 0.1);
    ctx.lineTo(-r * 0.52, r * 0.1);
    ctx.lineTo(-r * 0.62, r * 0.36);
    ctx.lineTo(-r * 0.92, r * 0.36);
    ctx.closePath();
    ctx.fill();

    // Every base runs a cable off toward the depot side, so a tower looks
    // plugged into something rather than dropped on the floor.
    ctx.strokeStyle = 'rgba(4,8,14,0.6)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(r * 0.3, r * 0.55);
    ctx.quadraticCurveTo(r * 0.8, r * 0.8, r * 1.02, r * 0.62);
    ctx.stroke();
    ctx.strokeStyle = fade(def.color, 0.3);
    ctx.lineWidth = 0.6;
    ctx.stroke();

    // the turntable the head sits on
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = material(ctx, r * 0.4, '#0d1420', { key: 0.3, shadow: 0.5 });
    ctx.fill();
    ctx.strokeStyle = rim(ctx, r * 0.4, def.color, 0.7);
    ctx.lineWidth = 0.8;
    ctx.stroke();
  });
}

// Heads point along +x and are rotated toward the target at draw time.
export function bakeTowerHead(key, def) {
  return bake(TOWER_R + 5, (ctx, r) => {
    const seed = seedOf('head:' + key);
    // Steel, not the tower's colour: a head in the same hue as its base makes
    // the whole tower read as one lump at phone size.
    const metal = material(ctx, r * 0.55, '#6c7da2', { key: 0.5, shadow: 0.58 });

    if (key === 'laser') {
      // an emitter block, a heat sink on top, and prongs around the lens
      const body = () => {
        ctx.beginPath();
        ctx.moveTo(-r * 0.38, -r * 0.3);
        ctx.lineTo(r * 0.44, -r * 0.19);
        ctx.lineTo(r * 0.46, r * 0.17);
        ctx.lineTo(-r * 0.34, r * 0.32);
        ctx.closePath();
      };
      surface(ctx, body, r * 0.5, { fill: metal, edge: def.color, seed, specks: 40, edgeWidth: 0.7 });

      ctx.fillStyle = 'rgba(4,8,14,0.55)';       // heat sink fins, top face only
      for (let i = 0; i < 4; i++) ctx.fillRect(-r * 0.28 + i * r * 0.16, -r * 0.28, r * 0.05, r * 0.2);

      ctx.strokeStyle = rim(ctx, r * 0.4, def.color, 0.9);
      ctx.lineWidth = 1.5;
      for (const sign of [-1, 1]) {              // prongs, the lower one shorter
        ctx.beginPath();
        ctx.moveTo(r * 0.4, sign * r * 0.24);
        ctx.lineTo(r * (sign < 0 ? 0.98 : 0.82), sign * r * 0.09);
        ctx.stroke();
      }
      emissive(ctx, r * 0.62, 0, r * 0.1, def.color, { bloom: 2 });
      return;
    }

    if (key === 'mortar') {
      // a drum magazine offset to one side, and a long tube over it
      ctx.beginPath();
      ctx.arc(-r * 0.3, r * 0.06, r * 0.34, 0, Math.PI * 2);
      ctx.fillStyle = metal;
      ctx.fill();
      ctx.strokeStyle = rim(ctx, r * 0.4, def.color, 0.85);
      ctx.lineWidth = 0.9;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(-r * 0.3, r * 0.06, r * 0.34, 0, Math.PI * 2);
      ctx.clip();
      grain(ctx, r * 0.5, seed, { count: 30 });
      ctx.restore();

      const tube = () => {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(-r * 0.3, -r * 0.19, r * 1.1, r * 0.38, 1.5);
        else ctx.rect(-r * 0.3, -r * 0.19, r * 1.1, r * 0.38);
      };
      surface(ctx, tube, r * 0.4, { fill: metal, edge: def.color, seed: seed ^ 3, specks: 26, edgeWidth: 0.8 });

      ctx.fillStyle = material(ctx, r * 0.3, '#3a4560', { key: 0.6, shadow: 0.6 });
      ctx.fillRect(r * 0.66, -r * 0.3, r * 0.17, r * 0.6);   // muzzle brake
      ctx.strokeStyle = rim(ctx, r * 0.3, def.color, 0.8);
      ctx.lineWidth = 0.7;
      ctx.strokeRect(r * 0.66, -r * 0.3, r * 0.17, r * 0.6);
      ctx.beginPath();
      ctx.arc(r * 0.75, 0, r * 0.11, 0, Math.PI * 2);
      ctx.fillStyle = '#0d0704';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,246,228,0.16)';   // a lit rib along the top
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.moveTo(-r * 0.24, -r * 0.13);
      ctx.lineTo(r * 0.6, -r * 0.13);
      ctx.stroke();
      return;
    }

    // turret: a breech block with twin barrels and a sight on one side
    const breech = () => {
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-r * 0.42, -r * 0.33, r * 0.72, r * 0.66, 2);
      else ctx.rect(-r * 0.42, -r * 0.33, r * 0.72, r * 0.66);
    };
    surface(ctx, breech, r * 0.5, { fill: metal, edge: def.color, seed, specks: 40, edgeWidth: 0.9 });

    for (const [sign, len] of [[-1, 0.78], [1, 0.66]]) {   // barrels of unequal reach
      const y = sign * r * 0.11 - r * 0.09;
      ctx.fillStyle = material(ctx, r * 0.2, '#4c5a78', { key: 0.55, shadow: 0.6, spread: 2 });
      ctx.fillRect(r * 0.2, y, r * len, r * 0.18);
      ctx.strokeStyle = rim(ctx, r * 0.2, def.color, 0.7);
      ctx.lineWidth = 0.6;
      ctx.strokeRect(r * 0.2, y, r * len, r * 0.18);
      ctx.fillStyle = '#070b12';
      ctx.fillRect(r * (0.2 + len) - 1, y + 0.4, 1.2, r * 0.18 - 0.8);
    }

    ctx.fillStyle = 'rgba(4,7,13,0.5)';        // cooling vents, one side only
    for (let i = 0; i < 3; i++) ctx.fillRect(-r * 0.3 + i * r * 0.14, -r * 0.3, r * 0.05, r * 0.22);
    ctx.fillStyle = material(ctx, r * 0.2, '#5b6a8c', { key: 0.6, shadow: 0.5 });
    ctx.fillRect(-r * 0.18, -r * 0.46, r * 0.26, r * 0.15);   // the sight, off centre
    emissive(ctx, -r * 0.05, -r * 0.39, r * 0.06, def.color, { bloom: 2.2 });
  });
}
