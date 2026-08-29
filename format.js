// format.js — number and time formatting shared by the canvas and the DOM.

const SHORT = ['', 'K', 'M', 'B', 'T'];

// aa, ab, ac ... az, ba ... zz  (tier 5 = 10^15 = 'aa')
function letterSuffix(index) {
  const first = Math.floor(index / 26);
  const second = index % 26;
  if (first > 25) return 'e' + (index + 5) * 3; // absurd territory; stay readable
  return String.fromCharCode(97 + first) + String.fromCharCode(97 + second);
}

export function formatNumber(value) {
  if (!isFinite(value)) return '∞';
  const neg = value < 0;
  let n = Math.abs(value);
  if (n < 1000) {
    const s = n < 10 && n % 1 !== 0 ? n.toFixed(1) : String(Math.floor(n));
    return neg ? '-' + s : s;
  }
  let tier = Math.floor(Math.log10(n) / 3);
  let scaled = n / Math.pow(1000, tier);
  // Guard both log10 rounding and values that round up into the next tier
  // (999999.9 must read 1.00M, not 1000K).
  if (scaled >= 999.5) { tier += 1; scaled /= 1000; }
  const suffix = tier < SHORT.length ? SHORT[tier] : letterSuffix(tier - SHORT.length);
  const digits = scaled < 10 ? 2 : scaled < 100 ? 1 : 0;
  const s = scaled.toFixed(digits) + suffix;
  return neg ? '-' + s : s;
}

// Short duration: 45s, 12m, 3h 20m
export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? h + 'h ' + rem + 'm' : h + 'h';
}
