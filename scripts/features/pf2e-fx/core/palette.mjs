/**
 * Spellsprite — the master palette.
 *
 * One hand-tuned 7-step ramp per material, dark to light. Every ramp is
 * hue-shifted: shadows lean cool, highlights lean warm, which is what makes a
 * three-colour flame read as fire instead of as an orange gradient. Pure white
 * is not in any ramp; it is reserved for hero frames (`WHITE`).
 *
 * These are effect colours, not suite UI colours, so they live here rather than
 * in core/theme.mjs (the weather looks do the same in their own `fx/looks.mjs`).
 */

const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

const RAW = {
  fire: ["#1d0b1f", "#4b1430", "#8c1f2a", "#d23c1e", "#f57a1f", "#ffbf3c", "#fff1a1"],
  cold: ["#120f2e", "#1f2a66", "#2a55a8", "#2f8fd6", "#5fd0f0", "#b6f4ff", "#f0fffd"],
  electricity: ["#170c33", "#352092", "#5a44e6", "#6f8dff", "#8fd7ff", "#d6f6ff", "#fbfffe"],
  acid: ["#0f1a14", "#1b3a1e", "#2f6a1f", "#5ca21b", "#9fd72a", "#dff26b", "#fbffd0"],
  poison: ["#140b1c", "#2e1435", "#4a2a4e", "#3f6a2a", "#6fa32a", "#b4d83c", "#eefaa0"],
  sonic: ["#0c1626", "#163a4a", "#1f6b6e", "#3aa39a", "#72d6c2", "#c2f5e6", "#f6fffb"],
  force: ["#0b1030", "#1b2a72", "#2f50c4", "#4f86f0", "#86c0ff", "#c8ecff", "#f4fdff"],
  kinetic: ["#16141c", "#2e2a33", "#4f4850", "#7a7069", "#a89a88", "#d4c8b4", "#f6efe2"],
  vitality: ["#2a1408", "#6a3412", "#b0661a", "#e3a32a", "#ffd85a", "#fff3a8", "#fffff0"],
  void: ["#07030c", "#1a0a2a", "#3a1155", "#6a1c86", "#a03ab8", "#d97be0", "#ffd6f4"],
  spirit: ["#0e1024", "#1e2a52", "#2f4f86", "#4f86b8", "#86c2de", "#c8ecf2", "#f6fffe"],
  holy: ["#2a1a0a", "#6a4214", "#b8801c", "#eabb3a", "#ffe27a", "#fff6c8", "#fffff4"],
  unholy: ["#0c0408", "#2a0814", "#5a0e22", "#8f1a2c", "#c8343a", "#f0746a", "#ffc4b0"],
  light: ["#2a2010", "#6a5420", "#b89a3a", "#ead26a", "#fff09e", "#fffbd8", "#fffff8"],
  shadow: ["#030308", "#0c0c1c", "#1c1a36", "#2e2a52", "#4a4478", "#7a72a8", "#b8b0dc"],
  mental: ["#1a0a22", "#3e1250", "#6e1e7e", "#a8349e", "#e060b4", "#ffa8d8", "#ffe6f4"],
  illusion: ["#120c2a", "#2a1e5e", "#4a3aa0", "#6a6ad8", "#8ab4f0", "#c8ecf8", "#fbfaff"],
  air: ["#141a24", "#2a3646", "#46586c", "#6f8698", "#a2b8c4", "#d4e2e6", "#f8fcfc"],
  earth: ["#1a120c", "#3a2616", "#5e3e20", "#86602e", "#b08a4a", "#d6b67e", "#f2e2c0"],
  water: ["#08142a", "#0e2a52", "#16508a", "#2a80bc", "#5ab2dc", "#a6e0f0", "#effcff"],
  wood: ["#140e08", "#2e2012", "#4e361a", "#6e5226", "#8e7a3a", "#b4a65e", "#e0d89c"],
  metal: ["#121418", "#2a2e36", "#464c58", "#6c7480", "#9aa2ac", "#cdd3d8", "#f6f8fa"],
  plant: ["#0a160c", "#143014", "#1e5220", "#2e7a26", "#5aa636", "#a2d65a", "#e6f6a8"],
  fungal: ["#140c16", "#2e1a2e", "#4e2e40", "#6e4a4a", "#9a7a52", "#cab46e", "#f2eac0"],
  arcane: ["#0e0a2a", "#221a66", "#3a2ea8", "#5a52e0", "#8a8cff", "#c4cbff", "#f4f6ff"],
  neutral: ["#101218", "#262a36", "#3e4456", "#5e687e", "#8a96aa", "#c0cad6", "#f2f6fa"],
  // not materials: shared ramps
  smoke: ["#0e0c12", "#1d1822", "#2c2533", "#3e3546", "#544a5b", "#6e6374", "#8a7f8e"],
  bleed: ["#1a0610", "#4a0c1c", "#8c1426", "#c8243a", "#f05a5a", "#ffa8a0", "#ffe4dc"],
  // a bandage: undyed cloth, warm and matte, with no hot end (medicine is not light)
  linen: ["#1c1714", "#3b322b", "#66594c", "#968671", "#c4b59c", "#e3d8c2", "#f4ede0"],
  // the healing cross: a flat apothecary green, never vitality's gold
  salve: ["#0c1a10", "#173a20", "#1f6030", "#2e8a44", "#4fb862", "#8fdc94", "#d6f6d2"],
};

/** Ramps as [r, g, b] triples. */
export const RAMP = Object.freeze(Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, Object.freeze(v.map(hex))])));
export const RAMP_HEX = Object.freeze(RAW);
export const WHITE = Object.freeze([255, 255, 255]);
export const INK = Object.freeze(hex("#1b1424"));

/** Step t ∈ [0, 1] of a ramp, snapped to its nearest entry: pixel art has no in-betweens. */
export const S = (R, t) => R[Math.max(0, Math.min(R.length - 1, Math.round(t * (R.length - 1))))];

export function rgb2hsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  return [(mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60, s, l];
}

export function hsl2rgb(h, s, l) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => Math.round((l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))) * 255));
}

/**
 * A custom look's hue: rotate the WHOLE ramp so its own step-to-step hue shift
 * survives, and lift washed-out mid tones so a grey material can still take a
 * colour.
 */
export function rotateRamp(R, hue) {
  const base = rgb2hsl(R[4])[0];
  return Object.freeze(R.map((c) => {
    const [h, s, l] = rgb2hsl(c);
    return hsl2rgb((h + hue - base + 720) % 360, l > 0.1 && l < 0.92 ? Math.max(s, 0.55) : s, l);
  }));
}

/** The hue (0–359) a ramp reads as; what the look editor starts its slider at. */
export const hueOf = (R) => Math.round(rgb2hsl(R[4])[0]);

export const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
export const hexOf = (c) => `#${c.map((v) => (v | 0).toString(16).padStart(2, "0")).join("")}`;
