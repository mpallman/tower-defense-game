// structures.js — the art for everything you build that is not a gun, plus the
// ore nodes they stand on.
//
// Split out of sprites.js when that file reached the size limit CLAUDE.md
// sets. The line is drawn by subject: sprites.js owns the things that fight
// (enemies and towers), this file owns the things that supply them. Both are
// baked the same way and share the same material system, so nothing about how
// the art is made differs — only what it depicts.

import { bake, surface, BUILDING_R } from './sprites.js';
import { material, rim, contact, emissive, alpha as fade, seedOf } from './paint.js';

// Buildings are industrial blocks: a footprint slab, a structure on top, and
// the one feature that says what it does — a headframe, a chimney, a cooling
// stack. They must never be mistaken for a tower at a glance, so nothing here
// is an octagon and nothing has a barrel.
// Buildings are built out of near-neutral dark steel, exactly like the tower
// bases, and carry their colour only in edges and lit windows. A slab filled
// with the tint reads as a UI chip dropped on the map, not as a structure —
// and it drowns out the towers and the wave, which are what you watch.

// Structures are edged in steel, not in their own colour. A rounded slab with
// a saturated border around it reads as an app icon; the hue belongs in the
// windows, the lamps and the stack tops, which is where a real building shows
// what it is doing.
const EDGE = '#4a5b78';

// The concrete pad every building sits on.
function slab(ctx, r, def, seed) {
  contact(ctx, r, { spread: 1.3, opacity: 0.55 });
  const s = r * 0.9;
  const pad = () => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(-s, -s, s * 2, s * 2, 3);
    else ctx.rect(-s, -s, s * 2, s * 2);
  };
  surface(ctx, pad, r, {
    fill: material(ctx, r, '#16202f', { key: 0.32, shadow: 0.55 }),
    edge: EDGE, seed, specks: 130, wear: 3, edgeWidth: 1.1, edgeStrength: 0.7,
  });

  // A painted hazard corner: one corner, not four. Asymmetry is the whole
  // point — a pad with matching corners looks stamped out.
  ctx.save();
  pad();
  ctx.clip();
  ctx.strokeStyle = fade(def.color, 0.35);
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-s + i * 2.6, s);
    ctx.lineTo(-s, s - i * 2.6);
    ctx.stroke();
  }
  ctx.restore();

  ctx.fillStyle = 'rgba(255,246,228,0.2)';
  for (const [sx, sy] of [[-0.82, -0.82], [0.82, -0.82]]) {
    ctx.beginPath();
    ctx.arc(sx * s, sy * s, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

// A boxy structure, used as the body of most buildings.
function block(ctx, x, y, w, h, def, seed) {
  const path = () => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - w, y - h, w * 2, h * 2, 1.5);
    else ctx.rect(x - w, y - h, w * 2, h * 2);
  };
  surface(ctx, path, Math.max(w, h), {
    fill: material(ctx, Math.max(w, h), '#26314a', { key: 0.42, shadow: 0.7, spread: 1.4 }),
    edge: EDGE, seed, specks: 45, edgeWidth: 0.8, edgeStrength: 0.7,
  });
}

function windows(ctx, x, y, w, h, cols, rows, hex) {
  const cw = (w * 2) / (cols * 2 - 1);
  const ch = (h * 2) / (rows * 2 - 1);
  const random = (() => { let s = seedOf('win'); return () => (s = Math.imul(s ^ (s >>> 15), 1 | s), ((s ^ (s >>> 14)) >>> 0) / 4294967296); })();
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      // Not every window is lit, and the lit ones are not equally lit. A grid
      // of identical rectangles is the giveaway.
      const on = random() > 0.28;
      ctx.fillStyle = on ? fade(hex, 0.5 + random() * 0.45) : 'rgba(6,10,18,0.75)';
      ctx.fillRect(x - w + i * cw * 2, y - h + j * ch * 2, cw, ch);
    }
  }
}

export function bakeBuilding(key, def) {
  return bake(BUILDING_R + 3, (ctx, r) => {
    const seed = seedOf('bld:' + key);
    slab(ctx, r, def, seed);
    const glow = def.color;

    if (key === 'miner') {
      // a headframe over a shaft, with a spoil heap beside it
      ctx.fillStyle = 'rgba(4,7,13,0.8)';
      ctx.beginPath();
      ctx.ellipse(-r * 0.15, r * 0.25, r * 0.4, r * 0.22, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = material(ctx, r * 0.6, '#63748f', { key: 0.55, shadow: 0.55 });
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.beginPath();                       // the A-frame legs
      ctx.moveTo(-r * 0.5, r * 0.4);
      ctx.lineTo(-r * 0.12, -r * 0.62);
      ctx.lineTo(r * 0.22, r * 0.4);
      ctx.stroke();
      ctx.lineWidth = 1.1;
      ctx.beginPath();                       // two braces at different heights
      ctx.moveTo(-r * 0.36, -r * 0.05);
      ctx.lineTo(r * 0.06, -r * 0.05);
      ctx.moveTo(-r * 0.28, -r * 0.3);
      ctx.lineTo(-r * 0.02, -r * 0.3);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(4,7,13,0.7)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();                       // the winding rope
      ctx.moveTo(-r * 0.12, -r * 0.62);
      ctx.lineTo(r * 0.52, -r * 0.18);
      ctx.stroke();
      emissive(ctx, -r * 0.12, -r * 0.62, r * 0.15, glow, { bloom: 2.1 });

      const heap = () => {                   // spoil heap
        ctx.beginPath();
        ctx.moveTo(r * 0.22, r * 0.52);
        ctx.lineTo(r * 0.56, -r * 0.08);
        ctx.lineTo(r * 0.72, r * 0.16);
        ctx.lineTo(r * 0.88, r * 0.52);
        ctx.closePath();
      };
      surface(ctx, heap, r * 0.5, {
        fill: material(ctx, r * 0.5, '#2b3346', { key: 0.45, shadow: 0.6, spread: 1.6 }),
        edge: EDGE, seed: seed ^ 11, specks: 34, edgeWidth: 0.7, edgeStrength: 0.6,
      });
      return;
    }

    if (key === 'plant') {
      // two cooling stacks of unequal height, and a turbine hall
      block(ctx, 0, r * 0.34, r * 0.78, r * 0.3, def, seed);
      for (const [sx, tall] of [[-1, 0.72], [1, 0.58]]) {
        const top = -r * tall;
        const stack = () => {
          ctx.beginPath();
          ctx.moveTo(sx * r * 0.44 - r * 0.2, -r * 0.05);
          ctx.lineTo(sx * r * 0.44 - r * 0.13, top);
          ctx.lineTo(sx * r * 0.44 + r * 0.13, top);
          ctx.lineTo(sx * r * 0.44 + r * 0.2, -r * 0.05);
          ctx.closePath();
        };
        surface(ctx, stack, r * 0.5, {
          fill: material(ctx, r * 0.7, '#232d43', { key: 0.5, shadow: 0.72, spread: 1.5 }),
          edge: EDGE, seed: seed ^ (sx + 5), specks: 26, edgeWidth: 0.8, edgeStrength: 0.7,
        });
        ctx.fillStyle = fade(glow, 0.7);
        ctx.fillRect(sx * r * 0.44 - r * 0.13, top, r * 0.26, r * 0.07);
      }
      windows(ctx, 0, r * 0.34, r * 0.6, r * 0.16, 4, 2, glow);
      return;
    }

    if (key === 'ammofab' || key === 'shellfab') {
      // a hall with a sawtooth roof and a chimney; the fab is taller and
      // gets a second stack, so the two read apart at a glance
      const heavy = key === 'shellfab';
      block(ctx, 0, r * 0.3, r * 0.82, r * 0.36, def, seed);
      windows(ctx, 0, r * 0.34, r * 0.62, r * 0.18, heavy ? 3 : 4, 2, glow);

      const roof = () => {                    // sawtooth roof
        ctx.beginPath();
        ctx.moveTo(-r * 0.82, -r * 0.06);
        for (let i = 0; i < 3; i++) {
          const x0 = -r * 0.82 + (i * r * 1.64) / 3;
          ctx.lineTo(x0 + r * 0.2, -r * 0.44);
          ctx.lineTo(x0 + (r * 1.64) / 3, -r * 0.06);
        }
        ctx.closePath();
      };
      surface(ctx, roof, r * 0.6, {
        fill: material(ctx, r * 0.5, '#141d2c', { key: 0.4, shadow: 0.6, spread: 1.6 }),
        edge: EDGE, seed: seed ^ 17, specks: 30, edgeWidth: 0.8, edgeStrength: 0.65,
      });
      // glazing on the lit face of each tooth: what a sawtooth roof is for
      ctx.strokeStyle = fade(glow, 0.28);
      ctx.lineWidth = 0.9;
      for (let i = 0; i < 3; i++) {
        const x0 = -r * 0.82 + (i * r * 1.64) / 3;
        ctx.beginPath();
        ctx.moveTo(x0, -r * 0.06);
        ctx.lineTo(x0 + r * 0.2, -r * 0.44);
        ctx.stroke();
      }

      const stacks = heavy ? [[-0.5, 0.52], [0.5, 0.42]] : [[0.55, 0.5]];
      for (const [sx, tall] of stacks) {
        ctx.fillStyle = material(ctx, r * 0.4, '#222c40', { key: 0.5, shadow: 0.7, spread: 1.4 });
        ctx.fillRect(sx * r - r * 0.1, -r * (0.36 + tall), r * 0.2, r * tall);
        ctx.strokeStyle = rim(ctx, r * 0.3, EDGE, 0.7);
        ctx.lineWidth = 0.7;
        ctx.strokeRect(sx * r - r * 0.1, -r * (0.36 + tall), r * 0.2, r * tall);
        ctx.fillStyle = fade(glow, 0.8);
        ctx.fillRect(sx * r - r * 0.1, -r * (0.36 + tall), r * 0.2, r * 0.07);
      }
      return;
    }

    // depot: a shed with a roller door and stacked crates on the apron
    block(ctx, -r * 0.18, r * 0.18, r * 0.62, r * 0.48, def, seed);
    const roof = () => {                      // pitched roof
      ctx.beginPath();
      ctx.moveTo(-r * 0.86, -r * 0.3);
      ctx.lineTo(-r * 0.18, -r * 0.72);
      ctx.lineTo(r * 0.5, -r * 0.3);
      ctx.closePath();
    };
    surface(ctx, roof, r * 0.6, {
      fill: material(ctx, r * 0.6, '#1a2334', { key: 0.48, shadow: 0.66, spread: 1.5 }),
      edge: EDGE, seed: seed ^ 23, specks: 34, edgeWidth: 0.9, edgeStrength: 0.7,
    });

    ctx.fillStyle = 'rgba(5,9,16,0.8)';       // roller door
    ctx.fillRect(-r * 0.44, -r * 0.06, r * 0.5, r * 0.6);
    ctx.strokeStyle = fade(glow, 0.45);
    ctx.lineWidth = 0.7;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(-r * 0.44, -r * 0.06 + i * r * 0.15);
      ctx.lineTo(r * 0.06, -r * 0.06 + i * r * 0.15);
      ctx.stroke();
    }
    emissive(ctx, -r * 0.5, -r * 0.12, r * 0.07, glow, { bloom: 2.4 });  // door lamp

    for (const [cx, cy, cs] of [[0.6, 0.42, 0.2], [0.58, 0.02, 0.17], [0.24, 0.54, 0.15]]) {
      const crate = () => {
        ctx.beginPath();
        ctx.rect(cx * r - cs * r, cy * r - cs * r, cs * r * 2, cs * r * 2);
      };
      surface(ctx, crate, cs * r, {
        fill: material(ctx, cs * r, '#2a3448', { key: 0.5, shadow: 0.6, spread: 1.3 }),
        edge: EDGE, seed: seed ^ Math.round(cx * 100), specks: 10, edgeWidth: 0.6, edgeStrength: 0.6,
      });
    }
  });
}

// An ore node: a seam of crystals broken out of the ground.
export function bakeOreNode() {
  return bake(20, (ctx, r) => {
    const seed = seedOf('ore');
    ctx.beginPath();
    ctx.ellipse(0, r * 0.22, r * 0.94, r * 0.5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fill();
    const pit = () => {
      ctx.beginPath();
      ctx.ellipse(0, r * 0.2, r * 0.86, r * 0.44, 0.08, 0, Math.PI * 2);
    };
    surface(ctx, pit, r, {
      fill: material(ctx, r, '#2a2622', { key: 0.3, shadow: 0.5, spread: 1.2 }),
      edge: '#5d5449', seed, specks: 90, edgeWidth: 0.8, edgeStrength: 0.7,
    });

    // Sizes deliberately uneven, and the tallest shard is off centre — a fan
    // of equal spikes around a middle one is the tell.
    const shards = [[-0.12, -0.34, 0.56], [-0.56, 0.08, 0.3], [0.46, -0.04, 0.42], [0.2, 0.3, 0.2], [-0.26, 0.34, 0.17]];
    for (const [dx, dy, size] of shards) {
      const x = dx * r, y = dy * r, h = size * r;
      const lean = dx * 0.25;
      const shard = () => {
        ctx.beginPath();
        ctx.moveTo(x + lean * h, y - h);
        ctx.lineTo(x + h * 0.5, y + h * 0.3);
        ctx.lineTo(x, y + h * 0.62);
        ctx.lineTo(x - h * 0.62, y + h * 0.26);
        ctx.closePath();
      };
      shard();
      ctx.fillStyle = material(ctx, h, '#8d8781', { key: 0.7, shadow: 0.72, spread: 1.1 });
      ctx.fill();
      // the lit facet, split off the shadowed one down the crystal's spine
      ctx.beginPath();
      ctx.moveTo(x + lean * h, y - h);
      ctx.lineTo(x - h * 0.62, y + h * 0.26);
      ctx.lineTo(x, y + h * 0.62);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255,248,232,0.2)';
      ctx.fill();
      shard();
      ctx.strokeStyle = rim(ctx, h, '#cfc9c1', 0.9);
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
    // one glint, on the biggest shard only
    emissive(ctx, -r * 0.12 + 0.6, -r * 0.6, r * 0.06, '#fdf6e6', { bloom: 2.4 });
  });
}
