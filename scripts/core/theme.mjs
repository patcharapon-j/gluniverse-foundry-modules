/**
 * GLUniverse Suite — the JS side of the Etched Glass design system.
 *
 * styles/gl-tokens.css is the source of truth for anything the browser paints.
 * This module exists for the things CSS custom properties cannot reach:
 *
 *   • PIXI / WebGL / <canvas>, which need 0xRRGGBB ints and vec3 floats.
 *   • JS that must pick a colour before an element exists (defaults, presets).
 *   • The motion-tier plumbing shared by several features.
 *
 * Rules
 *   1. A feature must NOT hardcode a suite colour in JS. Import it from here.
 *   2. PALETTE mirrors gl-tokens.css by hand — CSS variables are not readable
 *      until a stylesheet has loaded and an element is in the document. When a
 *      hue changes in gl-tokens.css it MUST change here too.
 *   3. For anything that IS in the document, prefer `cssVar()` so the live
 *      (possibly rethemed) value wins over the mirror.
 */

import { SUITE_ID } from "./const.mjs";

/* ══════════════════════════════════════════════════════════════════════
   PALETTE — the JS mirror of the L0 primitives in styles/gl-tokens.css
   ══════════════════════════════════════════════════════════════════════ */
export const PALETTE = Object.freeze({
  /* Ink ramp */
  ink0: "#02070b",
  ink1: "#080b11",
  ink2: "#0b0f17",
  ink3: "#161d2c",

  /* Text */
  text: "#eef1f7",
  textBright: "#f3fbff",
  textDim: "#98a2b6",

  /* Accent (the dynamic channel's default) */
  accent: "#6b86d6",

  /* Fixed semantic hues — these carry meaning and never follow the accent. */
  signal: "#ffd24a",
  signalHot: "#ffe070",
  signalPale: "#ffe9b8",
  cyan: "#5eeaff",
  cyanHot: "#b6f7ff",
  hazard: "#ff4a52",
  hazardHot: "#ffc0c6",
  peril: "#d6184a",
  good: "#5fdb92",
  goodHot: "#b6ffd0",
  info: "#4aa3ff",
  infoHot: "#9ad8ff",
  warn: "#ffb12d",
  warnHot: "#ffe070",
  warnDeep: "#ff6f1a",
  violet: "#b497ff",
  violetHot: "#e0d4ff",
  orchid: "#cf85e0",
  orchidHot: "#f6d9fb",
  jade: "#54d6a6",
  jadeHot: "#c2ffe8",
  teal: "#4ad9c0",
  tealHot: "#b6fff2",
  mission: "#37d99a",
  holoC: "#ff66b3",

  /* Apex — solo-boss eclipse violet */
  apex: "#b14bff",
  apexDeep: "#3c0a6b",
  apexHot: "#ff7bd6",
  apexInk: "#140422",
});

/* ══════════════════════════════════════════════════════════════════════
   Colour helpers
   ══════════════════════════════════════════════════════════════════════ */

/** "#rrggbb" → 0xRRGGBB int (for PIXI tints). */
export function hexToInt(hex) {
  return parseInt(String(hex).replace(/^#/, ""), 16) | 0;
}

/** "#rrggbb" → { r, g, b } 0..255. */
export function hexToRgb(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex ?? "").trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/** "#rrggbb" → [r, g, b] 0..1 (for GLSL uniforms). */
export function hexToRgbFloat(hex) {
  const { r, g, b } = hexToRgb(hex);
  return [r / 255, g / 255, b / 255];
}

/** { r, g, b } 0..255 → "#rrggbb". */
export function rgbToHex({ r, g, b }) {
  const c = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Mix two "#rrggbb" colours; t=0 → a, t=1 → b. */
export function mix(a, b, t) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return rgbToHex({ r: x.r + (y.r - x.r) * t, g: x.g + (y.g - x.g) * t, b: x.b + (y.b - x.b) * t });
}

/** Lighten / darken a "#rrggbb" colour by `t` (0..1). */
export const lighten = (hex, t) => mix(hex, "#ffffff", t);
export const darken = (hex, t) => mix(hex, "#000000", t);

/** "#rrggbb" + alpha → "rgba(...)". */
export function withAlpha(hex, alpha) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Read a live CSS custom property, so JS sees the value a retheme actually
 * produced rather than the PALETTE mirror.
 * @param {string} name  Property name, with or without the leading `--`.
 * @param {string} [fallback]  Returned when the property is unset/unreadable.
 * @param {Element} [el]  Element to resolve against (default <html>).
 */
export function cssVar(name, fallback = "", el = null) {
  try {
    const target = el ?? document.documentElement;
    const prop = name.startsWith("--") ? name : `--${name}`;
    const v = getComputedStyle(target).getPropertyValue(prop).trim();
    return v || fallback;
  } catch {
    return fallback;
  }
}

/* ══════════════════════════════════════════════════════════════════════
   Motion tiers
   One implementation for every feature's "animation intensity" setting.
   A tier resolves to a single multiplier written as `--gl-motion-scale`;
   every duration token in gl-tokens.css is derived through it, so one number
   retimes the feature (or the whole suite).
   ══════════════════════════════════════════════════════════════════════ */

/** Tier name → `--gl-motion-scale` multiplier. */
export const MOTION_SCALE = Object.freeze({
  none: 0,
  off: 0,
  reduced: 0.6,
  default: 1,
  full: 1,
  cinematic: 1.4,
});

export const MOTION_TIER_DEFAULT = "default";

/**
 * Apply a motion tier by writing `--gl-motion-scale`.
 *
 * Features keep their own per-feature setting (that user-facing choice is
 * unchanged); they just stop shipping their own duration tables. Pass a `root`
 * to scope the tier to one feature's element, or omit it to retime the suite.
 *
 * @param {string} tier  A key of MOTION_SCALE.
 * @param {HTMLElement} [root]  Defaults to <body>.
 */
export function applyMotionTier(tier, root = null) {
  const scale = MOTION_SCALE[tier] ?? MOTION_SCALE[MOTION_TIER_DEFAULT];
  const el = root ?? document.body;
  el?.style.setProperty("--gl-motion-scale", String(scale));
  return scale;
}

/* ══════════════════════════════════════════════════════════════════════
   Retheme notification
   Canvas-based features (PIXI filters, WebGL shaders) cannot observe a CSS
   custom-property change, so they register a repaint hook here. Anything that
   rewrites the token layer should call refreshTheme() afterwards.
   ══════════════════════════════════════════════════════════════════════ */

/** @type {Set<() => void>} */
const repaintHooks = new Set();

/**
 * Register a callback invoked whenever the theme changes.
 * @param {() => void} fn
 * @returns {() => void} unsubscribe
 */
export function onThemeChange(fn) {
  if (typeof fn !== "function") return () => {};
  repaintHooks.add(fn);
  return () => repaintHooks.delete(fn);
}

/** Run every registered repaint hook, isolating failures. */
export function refreshTheme() {
  for (const fn of repaintHooks) {
    try {
      fn();
    } catch (e) {
      console.error(`${SUITE_ID} | theme repaint hook failed`, e);
    }
  }
}
