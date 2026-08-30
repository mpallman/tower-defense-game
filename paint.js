// paint.js — the material system every piece of art in the game is built on.
//
// The single biggest reason generated shapes look generated is that each one
// is lit on its own terms: a gradient here runs top-to-bottom, one there runs
// corner-to-corner, and nothing agrees on where the light is. Real art picks a
// light and commits. So this file owns exactly three decisions, and every
// sprite obeys them:
//
//   1. One light direction, LIGHT, for the whole game.
//   2. Warm key, cool shadow. A surface turning away from the light does not
//      just get darker, it gets bluer — that colour *shift* is what reads as
//      shaded rather than as a faded fill.
//   3. Everything carries grain. A perfectly clean fill is the other big tell;
//      a few hundred baked specks cost nothing and make a shape look made.
//
// Nothing here draws a subject. sprites.js and ground.js do that.

// Upper-left, and slightly more from the side than from above so verticals
// catch a highlight. Kept as a unit vector so it can scale to any radius.
export const LIGHT = { x: -0.52, y: -0.85 };

// The three colours every material is mixed against.
const KEY = [255, 240, 214];   // direct light: warm
const AMB = [58, 82, 124];     // the bounce a shadowed face still receives: cool
const VOID = [6, 10, 17];      // what deep shadow falls toward, not pure black

// --------------------------------------------------------------- colour ---
export function rgbOf(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function mix(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

export function hexOf(rgb) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

export function css(rgb, alpha = 1) {
  const r = Math.round(rgb[0]), g = Math.round(rgb[1]), b = Math.round(rgb[2]);
  return alpha >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
}

// Pull a colour toward its own brightness. Body panels get desaturated and the
// hue is spent on lights and edges instead — a hull filled with a full
// saturation accent reads as a UI chip, not as a machine.
export function desat(hex, amount, toward = 0) {
  const c = rgbOf(hex);
  const luma = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  const grey = [luma, luma, luma];
  return hexOf(mix(mix(c, grey, amount), VOID, toward));
}

// Blend two hex colours and get a hex back, so results can be fed straight
// back into material().
export function blend(a, b, t) {
  return hexOf(mix(rgbOf(a), rgbOf(b), t));
}

export function tint(hex, target, t, alpha = 1) {
  return css(mix(rgbOf(hex), target === 'key' ? KEY : target === 'amb' ? AMB : VOID, t), alpha);
}

export function alpha(hex, a) {
  return css(rgbOf(hex), a);
}

// ------------------------------------------------------------ materials ---
// A lit surface: warm where it faces the light, cool as it turns away, deep
// but never black at the far edge.
export function material(ctx, r, hex, opts = {}) {
  const { key = 0.4, shadow = 0.6, spread = 1, base: baseHex = hex } = opts;
  const base = rgbOf(baseHex);
  const g = ctx.createLinearGradient(
    LIGHT.x * r * spread, LIGHT.y * r * spread,
    -LIGHT.x * r * spread, -LIGHT.y * r * spread);
  g.addColorStop(0, css(mix(base, KEY, key)));
  g.addColorStop(0.34, css(base));
  g.addColorStop(0.7, css(mix(base, AMB, 0.3 * shadow)));
  g.addColorStop(1, css(mix(base, VOID, shadow)));
  return g;
}

// Painted steel: the same model, but starting from neutral so the subject's
// own colour is free to appear only in its lights.
export function steel(ctx, r, opts = {}) {
  return material(ctx, r, '#3c4a63', { key: 0.5, shadow: 0.72, ...opts });
}

// An edge stroke that is bright where the light hits and all but gone on the
// far side. A single flat outline is what makes vector art look like a decal.
export function rim(ctx, r, hex, strength = 1) {
  const base = rgbOf(hex);
  const g = ctx.createLinearGradient(LIGHT.x * r, LIGHT.y * r, -LIGHT.x * r, -LIGHT.y * r);
  g.addColorStop(0, css(mix(base, KEY, 0.5), 0.8 * strength));
  g.addColorStop(0.45, css(base, 0.4 * strength));
  g.addColorStop(1, css(mix(base, VOID, 0.55), 0.22 * strength));
  return g;
}

// The shadow a thing casts on the ground it sits on: offset away from the
// light, softened, never a hard ellipse.
export function contact(ctx, r, opts = {}) {
  const { spread = 1, opacity = 0.5, squash = 0.42 } = opts;
  const cx = -LIGHT.x * r * 0.28, cy = -LIGHT.y * r * 0.2 + r * squash * 0.5;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, squash);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * spread);
  g.addColorStop(0, `rgba(0,0,0,${opacity})`);
  g.addColorStop(0.6, `rgba(0,0,0,${opacity * 0.45})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r * spread, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ------------------------------------------------------------- surfaces ---
// Deterministic noise. Baked once per sprite, so it never shimmers and costs
// nothing at draw time — but it has to be seeded, or every reload reshuffles
// the speckle and the art is subtly different each session.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Speckle inside whatever path is currently clipped. Light specks on the lit
// side, dark ones on the shadow side, so the grain reinforces the light rather
// than flattening it.
export function grain(ctx, r, seed, opts = {}) {
  const { count = 90, size = 0.55, strength = 0.5 } = opts;
  const random = rng(seed);
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const d = Math.sqrt(random()) * r;
    const x = Math.cos(a) * d, y = Math.sin(a) * d;
    // How much this speck faces the light, -1 .. 1.
    const facing = (x * LIGHT.x + y * LIGHT.y) / (r || 1);
    const bright = random() < 0.5 + facing * 0.55;
    ctx.fillStyle = bright
      ? `rgba(255,246,228,${(0.05 + random() * 0.1) * strength})`
      : `rgba(4,7,13,${(0.08 + random() * 0.16) * strength})`;
    const s = size * (0.6 + random() * 0.9);
    ctx.fillRect(x, y, s, s);
  }
}

// Scratches and wear along one edge. Used sparingly: two or three marks read
// as damage, a dozen read as a pattern.
export function scuff(ctx, r, seed, opts = {}) {
  const { count = 3, strength = 0.3 } = opts;
  const random = rng(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < count; i++) {
    const a = random() * Math.PI * 2;
    const d = (0.35 + random() * 0.5) * r;
    const len = (0.15 + random() * 0.3) * r;
    const dir = a + (random() - 0.5) * 1.4;
    ctx.strokeStyle = `rgba(255,244,226,${strength * (0.4 + random() * 0.6)})`;
    ctx.lineWidth = 0.35 + random() * 0.35;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * d, Math.sin(a) * d);
    ctx.lineTo(Math.cos(a) * d + Math.cos(dir) * len, Math.sin(a) * d + Math.sin(dir) * len);
    ctx.stroke();
  }
}

// An emissive dot: the lens, the window, the eye. One of these per sprite is
// the focal point, and it is the only place a fully saturated colour belongs.
export function emissive(ctx, x, y, r, hex, opts = {}) {
  const { core = 0.35, bloom = 2.1 } = opts;
  const c = rgbOf(hex);
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * bloom);
  g.addColorStop(0, css(mix(c, [255, 255, 255], 0.75)));
  g.addColorStop(core, css(c, 0.95));
  g.addColorStop(0.62, css(c, 0.3));
  g.addColorStop(1, css(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r * bloom, 0, Math.PI * 2);
  ctx.fill();
}

// A polygon whose corners are nudged off the perfect ring. `jitter` of 0 is a
// regular polygon; a little is the difference between a shape somebody drew
// and one a for-loop produced.
export function shapePath(ctx, cx, cy, radius, sides, rotation, opts = {}) {
  const { jitter = 0, seed = 1, squash = 1 } = opts;
  const random = rng(seed);
  ctx.beginPath();
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * Math.PI * 2;
    const rr = radius * (1 - jitter * random());
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr * squash;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
}
