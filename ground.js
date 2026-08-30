// ground.js — the floor of the arena.
//
// The background used to be a flat fill plus two grids drawn line by line
// every frame. Cheap, but it read as graph paper: nothing to look at, and no
// sense that the towers were standing *on* anything.
//
// So the floor is baked into a single seamlessly tiling square and stamped
// with one unscaled fillRect. That is both faster than the old per-line loop
// and buys as much detail as we care to draw, since the cost is paid once per
// zoom level: plating, seams, cable runs, wear. On top of the tile go two
// things that must not tile, because they are lighting rather than surface —
// a warm pool around the vault and a slow sweep across the whole field.
//
// Everything is still generated in code. Nothing is downloaded.

import { makeCanvas, PALETTE } from './sprites.js';
import { rng, seedOf, grain } from './paint.js';

// One tile is one major grid square, so the coarse grid and the plating stay
// locked together no matter where the camera is.
const TILE = 100;

// Run `fn` nine times, once per neighbouring tile, so anything crossing an
// edge reappears on the opposite side and the tile joins invisibly.
function wrapped(ctx, fn) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      ctx.save();
      ctx.translate(ox * TILE, oy * TILE);
      fn();
      ctx.restore();
    }
  }
}

// Baked at `pxPerUnit` device pixels per world unit, so the tile can be
// stamped 1:1 into the frame with no scaling anywhere. That is the whole
// reason this is fast: a pattern fill under a scaled transform makes the
// rasteriser resample every pixel of the floor, every frame, and on a phone
// that alone doubled the frame time.
function bakeTile(pxPerUnit) {
  const px = Math.max(8, Math.round(TILE * pxPerUnit));
  const canvas = makeCanvas(px, px);
  const ctx = canvas.getContext('2d');
  ctx.scale(px / TILE, px / TILE);
  const random = rng(seedOf('ground'));

  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, TILE, TILE);

  // --- deck plating: big slabs with a seam between them ------------------
  // Uneven sizes on purpose. A floor of equal squares is just the grid again.
  const plates = [
    [2, 3, 44, 38], [50, 2, 48, 26], [4, 45, 30, 52], [38, 44, 60, 30],
    [36, 78, 26, 20], [66, 76, 32, 22],
  ];
  wrapped(ctx, () => {
    for (const [x, y, w, h] of plates) {
      const lift = 0.012 + random() * 0.03;
      ctx.fillStyle = `rgba(150,180,225,${lift})`;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = 'rgba(2,4,9,0.55)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(x, y, w, h);
      // a lit top edge, so each slab has a thickness
      ctx.strokeStyle = 'rgba(190,215,255,0.05)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      ctx.moveTo(x, y + 0.4);
      ctx.lineTo(x + w, y + 0.4);
      ctx.stroke();
    }
  });

  // --- the grid, now a surface marking rather than the whole background --
  wrapped(ctx, () => {
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 0.4;
    ctx.beginPath();
    for (let v = 20; v < TILE; v += 20) {
      ctx.moveTo(v, 0); ctx.lineTo(v, TILE);
      ctx.moveTo(0, v); ctx.lineTo(TILE, v);
    }
    ctx.stroke();

    ctx.strokeStyle = PALETTE.gridBright;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(TILE, 0);
    ctx.moveTo(0, 0); ctx.lineTo(0, TILE);
    ctx.stroke();

    // a survey tick at the major intersection, the kind of mark a plan has
    ctx.strokeStyle = 'rgba(90,125,180,0.3)';
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-3, 0); ctx.lineTo(3, 0);
    ctx.moveTo(0, -3); ctx.lineTo(0, 3);
    ctx.stroke();
  });

  // --- cable runs: right-angled traces with vias where they terminate ----
  // This is what makes the floor read as the inside of a machine instead of
  // as a plain. Faint enough that an enemy never disappears into it.
  const traces = [
    [[-6, 18], [26, 18], [26, 62], [58, 62]],
    [[70, -4], [70, 34], [104, 34]],
    [[12, 106], [12, 74], [44, 74], [44, 92]],
    [[86, 96], [86, 58], [62, 58], [62, 12]],
  ];
  wrapped(ctx, () => {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const trace of traces) {
      ctx.beginPath();
      ctx.moveTo(trace[0][0], trace[0][1]);
      for (let i = 1; i < trace.length; i++) ctx.lineTo(trace[i][0], trace[i][1]);
      ctx.strokeStyle = 'rgba(3,6,12,0.6)';    // the channel it sits in
      ctx.lineWidth = 2.2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(72,120,180,0.14)';
      ctx.lineWidth = 0.9;
      ctx.stroke();
      for (const [vx, vy] of [trace[0], trace[trace.length - 1]]) {
        ctx.beginPath();
        ctx.arc(vx, vy, 1.5, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(6,11,20,0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(86,140,205,0.28)';
        ctx.lineWidth = 0.6;
        ctx.stroke();
      }
    }
  });

  // --- wear: bolts, stencilled dashes, and grain over the lot ------------
  wrapped(ctx, () => {
    ctx.fillStyle = 'rgba(160,190,235,0.09)';
    for (let i = 0; i < 14; i++) {
      ctx.beginPath();
      ctx.arc(random() * TILE, random() * TILE, 0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(120,160,215,0.07)';
    for (let i = 0; i < 5; i++) {
      const x = random() * TILE, y = random() * TILE;
      const vertical = random() < 0.5;
      for (let j = 0; j < 3; j++) {
        if (vertical) ctx.fillRect(x, y + j * 2.4, 0.7, 1.5);
        else ctx.fillRect(x + j * 2.4, y, 1.5, 0.7);
      }
    }
  });

  ctx.save();
  ctx.translate(TILE / 2, TILE / 2);
  grain(ctx, TILE * 0.75, seedOf('ground-grain'), { count: 520, size: 0.5, strength: 0.42 });
  ctx.restore();

  return canvas;
}

export function createGround(ctx) {
  let tile = null, bakedAt = 0;

  // Zoom is continuous, so the resolution is quantised: a pinch re-bakes a few
  // times rather than on every frame, and a tile bake is a fraction of a
  // millisecond anyway.
  function ensureTile(pxPerUnit) {
    const q = Math.max(0.5, Math.round(pxPerUnit * 4) / 4);
    if (q === bakedAt && tile) return;
    bakedAt = q;
    tile = bakeTile(q);
  }

  // The floor. Drawn in device pixels with the tile at its baked size, so no
  // pixel of it is ever resampled. `frame` carries what that needs from the
  // camera.
  function paint(frame) {
    const { camera, scale, dpr, cssW, cssH, canvasW, canvasH } = frame;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, canvasW, canvasH);
    ensureTile(scale * dpr);
    if (tile) {
      const px = tile.width;
      // Where world (0,0) lands on the canvas, wrapped into one tile, so the
      // floor stays pinned to the world while the camera moves over it.
      const ox = (((cssW / 2 - camera.x * scale) * dpr) % px + px) % px - px;
      const oy = (((cssH / 2 - camera.y * scale) * dpr) % px + px) % px - px;
      // Stamped tile by tile rather than filled with a CanvasPattern: a 1:1
      // drawImage is the rasteriser's fast path, and twenty of them beat one
      // pattern fill over the same pixels by a wide margin.
      for (let y = oy; y < canvasH; y += px) {
        for (let x = ox; x < canvasW; x += px) ctx.drawImage(tile, x, y);
      }
    }
    ctx.restore();
  }

  // Lighting: a warm pool where the vault stands so the eye has somewhere to
  // land, a slow diagonal sweep so a static floor feels powered, and a
  // vignette to close the corners in.
  //
  // All three are drawn into one buffer an eighth the size of the canvas and
  // blitted up. They are smooth gradients, so nothing is lost by it, and it
  // turns three full-resolution alpha passes — the most expensive thing in the
  // frame by a distance — into one. Fill rate, not maths, is the cost here.
  let buffer = null, bufferCtx = null;

  function light(frame, time, focus) {
    const { camera, scale, dpr, cssW, cssH, canvasW, canvasH } = frame;
    const w = Math.max(32, Math.round(canvasW / 8));
    const h = Math.max(32, Math.round(canvasH / 8));
    if (!buffer || buffer.width !== w || buffer.height !== h) {
      buffer = makeCanvas(w, h);
      bufferCtx = buffer.getContext('2d');
    }
    const b = bufferCtx;
    b.setTransform(1, 0, 0, 1, 0, 0);
    b.clearRect(0, 0, w, h);

    // The vault, in buffer pixels.
    const fx = (cssW / 2 + (focus.x - camera.x) * scale) * dpr * (w / canvasW);
    const fy = (cssH / 2 + (focus.y - camera.y) * scale) * dpr * (h / canvasH);
    const reach = Math.max(w, h) * 0.8;
    const pool = b.createRadialGradient(fx, fy, 0, fx, fy, reach);
    pool.addColorStop(0, 'rgba(56,189,248,0.1)');
    pool.addColorStop(0.35, 'rgba(40,120,190,0.045)');
    pool.addColorStop(1, 'rgba(56,189,248,0)');
    b.fillStyle = pool;
    b.fillRect(0, 0, w, h);

    // A long cycle, so it reads as the light in the room changing rather than
    // as an effect asking to be looked at.
    const period = 26;
    const phase = ((time % period) / period) * 2.4 - 0.7;
    const span = w + h;
    const cx = span * phase * 0.7, cy = span * phase * 0.5;
    const sweep = b.createLinearGradient(
      cx - span * 0.22, cy - span * 0.22, cx + span * 0.22, cy + span * 0.22);
    sweep.addColorStop(0, 'rgba(120,170,230,0)');
    sweep.addColorStop(0.5, 'rgba(125,175,235,0.045)');
    sweep.addColorStop(1, 'rgba(120,170,230,0)');
    b.fillStyle = sweep;
    b.fillRect(0, 0, w, h);

    const vig = b.createRadialGradient(
      w / 2, h * 0.45, Math.min(w, h) * 0.3,
      w / 2, h * 0.45, Math.max(w, h) * 0.72);
    vig.addColorStop(0, 'rgba(2,4,9,0)');
    vig.addColorStop(1, 'rgba(2,4,9,0.6)');
    b.fillStyle = vig;
    b.fillRect(0, 0, w, h);

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(buffer, 0, 0, canvasW, canvasH);
    ctx.restore();
  }

  return { paint, light };
}
