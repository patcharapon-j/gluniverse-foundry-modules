/**
 * Stage light — from a reading of the room to the numbers the shader takes.
 *
 * Pure. Two inputs and one output:
 *
 *   probe   what the backdrop says (probe.mjs), or a preset's stand-in for it
 *   light   what the GM said — the scene flag `stage.light`, a handful of dials
 *   → rig   a flat, lerp-able record of every shader parameter
 *
 * The GM never edits a rig. They pick a mood (Auto reads the backdrop; the rest
 * describe a room in numbers, through the same path) and back it off or push it
 * with a handful of dials. Everything else follows from the picture, which is the point:
 * a GM should change the backdrop and have the cast change with it.
 *
 * The rig is a compositor's light, in three parts:
 *
 *   room   the ambient — level, colour, the ceiling above and the floor below,
 *          and the backdrop around each pixel (sampled live in the shader)
 *   key    a soft front light from the brighter side of the room
 *   rims   up to two lights IN the backdrop, which therefore sit behind the
 *          cast and reach it only as light on the edges facing them
 *
 * plus the black point and white balance of the picture, so the cast's darkest
 * paint and brightest highlight agree with the backdrop's.
 */

import { chroma, hueTrust, lum, neutralProbe, normalizeProbe } from "./probe.mjs";
import { num, oneOf, str } from "../model.mjs";
import { NEUTRAL_PICTURE, normalizePicture } from "./picture.mjs";

export const LIGHT_FLAG = "stage.light";

export const MOODS = Object.freeze(["auto", "day", "golden", "dusk", "night", "fire", "neon", "storm", "off"]);

export const DEFAULT_LIGHT = Object.freeze({
  mood: "auto",
  strength: 1,
  match: 0.8,
  key: 0.5,
  angle: null,
  rim: 1,
  glow: 0.5,
  blur: 0.55,
  grain: 0.3,
  darkness: true,
  flicker: true,
  src: null,
  picture: NEUTRAL_PICTURE,
});

/** The dials, in the order the Director app lists them, with their ranges. */
export const LIGHT_DIALS = Object.freeze({
  strength: [0, 1],
  match: [0, 1],
  key: [0, 1],
  rim: [0, 2],
  glow: [0, 1],
  blur: [0, 1],
  grain: [0, 1],
});

/**
 * The scene's light setting. Total.
 *
 *   mood      a preset room, or "auto" (read the backdrop), or "off" (unlit art)
 *   strength  master: 0 is the art as painted, on the sharp backdrop
 *   match     how far the cast is pulled into the room: its colour, its level,
 *             its saturation and its black point
 *   key       how strongly the front light models the figure
 *   angle     where the front light comes from, degrees (0 = above, 90 = right),
 *             or null to take it from the brighter side of the room
 *   rim       the edge light: the bright line round the silhouette, and the
 *             backdrop's own lamps catching the edges that face them, 0..2
 *   glow      the room's bloom, the halo round the cast, the light wrapping
 *             round their edges and their own highlights' diffusion
 *   blur      the backdrop's depth of field
 *   grain     film grain over the whole frame
 *   darkness  follow Foundry's scene darkness
 *   flicker   let a firelit room's light breathe
 *   src       read this picture instead of the scene's background (Theatre's shot)
 *   picture   how that picture is framed and graded (Theatre's focus and
 *             treatment, picture.mjs): the picture's own, not the light's
 */
export function normalizeLight(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const angle = r.angle === null || r.angle === undefined || r.angle === "" ? null : num(r.angle, -180, 180, null);
  const out = { mood: oneOf(r.mood, MOODS, "auto") };
  for (const [k, [lo, hi]] of Object.entries(LIGHT_DIALS)) out[k] = num(r[k], lo, hi, DEFAULT_LIGHT[k]);
  out.angle = angle;
  out.darkness = typeof r.darkness === "boolean" ? r.darkness : DEFAULT_LIGHT.darkness;
  out.flicker = typeof r.flicker === "boolean" ? r.flicker : DEFAULT_LIGHT.flicker;
  out.src = str(r.src, "", 1024) || null;
  out.picture = normalizePicture(r.picture);
  return out;
}

/* ── moods: a room described in numbers ─────────────────────────────── */

const srgb = (hex) => {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
};
const room = (spec) => {
  const p = neutralProbe(srgb(spec.mean));
  p.ok = true;
  p.sky = srgb(spec.sky ?? spec.mean);
  p.ground = srgb(spec.ground ?? spec.mean);
  p.haze = srgb(spec.haze ?? spec.mean);
  p.shadow = srgb(spec.shadow ?? "#050608");
  p.white = srgb(spec.white ?? "#ffffff");
  p.left = srgb(spec.left ?? spec.mean);
  p.right = srgb(spec.right ?? spec.mean);
  p.meanLum = lum(p.mean);
  p.side = spec.side ?? 0;
  p.warmth = spec.warmth ?? 0;
  p.lights = (spec.lights ?? []).map((l) => ({ x: l.x, y: l.y, color: chroma(srgb(l.color), 0.9), power: l.power, size: 0.05 }));
  p.contrast = 40;
  p.hue = chroma(p.mean);
  return p;
};

/** Hand-tuned rooms. Colours are what the room LOOKS like (sRGB hex). */
export const MOOD_ROOMS = Object.freeze({
  day: room({ mean: "#8a96a3", sky: "#b9d2ee", ground: "#7d7262", shadow: "#20242c", white: "#fff9ee", side: -0.35,
    lights: [{ x: 0.15, y: 0.1, color: "#fff4e0", power: 0.55 }] }),
  golden: room({ mean: "#8c6a4c", sky: "#e2a873", ground: "#4a3a30", shadow: "#1e1418", white: "#ffe2b8", side: 0.7, warmth: 0.6,
    lights: [{ x: 0.92, y: 0.45, color: "#ffb062", power: 0.9 }, { x: 0.1, y: 0.2, color: "#9aa8d8", power: 0.25 }] }),
  dusk: room({ mean: "#4d4560", sky: "#8a6f9e", ground: "#2a2433", shadow: "#0e0b16", white: "#ffd2c0", side: -0.4,
    lights: [{ x: 0.05, y: 0.5, color: "#ff8a6a", power: 0.65 }, { x: 0.9, y: 0.15, color: "#7f88d8", power: 0.4 }] }),
  night: room({ mean: "#1b2333", sky: "#2c3d5e", ground: "#10141c", shadow: "#03050a", white: "#cfe0ff", side: 0.3, warmth: -0.5,
    lights: [{ x: 0.8, y: 0.08, color: "#a9c4ff", power: 0.6 }] }),
  fire: room({ mean: "#3a2418", sky: "#2a1a14", ground: "#6e3a1c", shadow: "#0c0605", white: "#ffcf8a", side: -0.6, warmth: 0.9,
    lights: [{ x: 0.12, y: 0.75, color: "#ff8c2e", power: 0.95 }] }),
  neon: room({ mean: "#2a1f3a", sky: "#3b2456", ground: "#14101e", shadow: "#06040c", white: "#f0d8ff", side: 0,
    lights: [{ x: 0.02, y: 0.4, color: "#ff3fb4", power: 0.9 }, { x: 0.98, y: 0.4, color: "#2fd8ff", power: 0.9 }] }),
  storm: room({ mean: "#3c4550", sky: "#56616e", ground: "#262b31", shadow: "#0a0d10", white: "#dfe9f2", side: 0.2, warmth: -0.3,
    lights: [{ x: 0.6, y: 0.02, color: "#d6e4ff", power: 0.45 }] }),
});

/** The room a light setting stands in: the backdrop's probe, a mood's, or neutral. */
export function roomFor(light, backdropProbe) {
  const l = normalizeLight(light);
  if (l.mood === "auto") return backdropProbe?.ok ? normalizeProbe(backdropProbe) : neutralProbe();
  if (l.mood === "off") return neutralProbe();
  return MOOD_ROOMS[l.mood] ?? neutralProbe();
}

/* ── the rig ────────────────────────────────────────────────────────── */

const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const WHITE = [1, 1, 1];
/** Moonlight: what darkness turns the room toward. */
const MOON = chroma([0.55, 0.68, 1], 0.6);

/**
 * A colour's hue as a multiplier at unit luminance, taken to the power `k` in
 * ratio space: k = 0 is white, 1 is the colour's full hue. Working in ratios
 * rather than mixing toward white is what lets a deep blue room turn a face
 * clearly blue without the red channel collapsing to zero and the skin going
 * black: every channel moves by the same proportion of the way.
 */
export function tintOf(c, k) {
  const l = lum(c);
  k *= hueTrust(l);
  if (l <= 1e-6 || k <= 0) return [1, 1, 1];
  const t = [c[0] / l, c[1] / l, c[2] / l].map((v) => clamp(Math.max(v, 0.02) ** k, 0.25, 3));
  const l2 = lum(t);
  return t.map((v) => v / l2);
}

/** Two directional rims, always, so the rig has a fixed shape and tweens cleanly. */
export const RIM_SLOTS = 2;

/** The identity rig: the art exactly as painted, on the sharp backdrop. Every lerp has this to fall back on. */
export function identityRig() {
  return {
    strength: 0,
    level: 1, shoulder: 1, contrast: 0, saturation: 1,
    tintShadow: [1, 1, 1], tint: [1, 1, 1], tintHigh: [1, 1, 1], lift: [0, 0, 0],
    sky: [1, 1, 1], ground: [1, 1, 1], env: 0,
    keyDir: [0, 0.5, 0.86], keyColor: [1, 1, 1], key: 0,
    rimPos: [[0.5, -0.2], [0.5, -0.2]], rimColor: [[1, 1, 1], [1, 1, 1]], rimPower: [0, 0],
    stroke: 0, strokeColor: [1, 1, 1], strokeFloor: 0, rimGlow: 0,
    halo: 0, haloColor: [1, 1, 1],
    diffusion: 0, wrap: 0,
    ao: 0,
    haze: [0.18, 0.18, 0.18],
    shadowColor: [0, 0, 0], shadow: 0,
    silhouette: [0.006, 0.006, 0.006],
    flicker: 0,
    blur: 0, bloom: 0, bgLevel: 1, bgTint: [1, 1, 1], bgHaze: 0,
    glow: 0,
    grain: 0,
  };
}

/**
 * Resolve the rig.
 *
 * @param {object} light            the scene's light setting (normalized here)
 * @param {object} probe            the backdrop's probe (ignored unless mood is auto)
 * @param {{darkness?: number}} [env]  Foundry scene darkness, 0..1
 */
export function resolveRig(light, probe, { darkness = 0 } = {}) {
  const l = normalizeLight(light);
  if (l.mood === "off" || l.strength <= 0) return identityRig();
  const p = roomFor(l, probe);
  const m = l.match;
  const d = l.darkness ? clamp(Number(darkness) || 0, 0, 1) : 0;
  const auto = l.mood === "auto";
  const bright = smooth(0.04, 0.35, p.meanLum);

  // The level a compositor sets a character at: below the painting's own
  // whites, following the room's brightness only loosely — the subject stays
  // the brightest thing that is not a light, in a dark room and a bright one.
  const roomLevel = clamp(0.74 * (Math.max(p.meanLum, 1e-4) / 0.14) ** 0.2, 0.6, 0.92);
  const level = mix(1, roomLevel, m) * mix(1, 0.55, d);

  // Pulling the cast into the room is lighting it with the room's colour: the
  // three tints — the room's shadows on the cast's darks, its hue on the mids,
  // its brightest paint on the highlights — carry the room's hue at full weight.
  // Saturation follows the room's own: a vivid room keeps the cast vivid, a
  // grey, foggy one greys it a little. The room's colour reaches the cast
  // through the tints below (coloured light), not by draining its paint.
  // Darkness alone desaturates further: the eye loses colour first at night.
  const roomSat = clamp(0.6 + ((p.saturation ?? 0.35) - 0.3) * 1.3, 0.6, 1);
  const saturation = clamp(mix(1, roomSat, m) - 0.25 * d, 0.1, 1);
  const moon = (c) => mix3(c, MOON, d * 0.7);
  // Every band takes the room's HUE (its coloured paint, not its mean); the
  // darks lean on the room's own shadow colour and the highlights on its
  // whites, so a white shirt under a sodium lamp goes amber and black hair in
  // a moonlit wood goes blue-black.
  const hue = p.hue ?? chroma(p.mean);
  const both = (a, b) => { const c = [a[0] * b[0], a[1] * b[1], a[2] * b[2]]; const k = lum(c); return c.map((v) => v / k); };
  const tintShadow = moon(both(tintOf(p.shadow, 0.4 * m), tintOf(hue, 0.45 * m)));
  const tint = moon(tintOf(hue, 0.72 * m));
  const tintHigh = moon(both(tintOf(p.white, 0.3 * m), tintOf(hue, 0.5 * m)));

  // The black point lifts to the room's shadow colour, barely: a breath of
  // the room in the darkest ink, never a milky black. The cast keeps the
  // painting's own contrast; `contrast` restores what the room light flattens.
  const lift = scale3(tintOf(p.shadow, 0.7), 0.006 * m * (1 - d * 0.5));
  const contrast = 0.16 * m;

  // Where highlights start to roll off, relative to the level.
  const shoulder = mix(1, 0.86, m);

  // Ceiling and floor, relative to the room (so they shape, not re-expose).
  const rel = (c, k) => {
    const r = clamp((lum(c) / Math.max(p.meanLum, 1e-4)) ** 0.3, 0.75, 1.3);
    return scale3(mix3(WHITE, chroma(c, 0.5), m * k), r);
  };
  const sky = mix3(WHITE, rel(p.sky, 0.6), m);
  const ground = mix3(WHITE, rel(p.ground, 0.6), m);

  // Front key, from the brighter side of the room, or where the GM put it.
  const side = clamp(p.side, -1, 1);
  const angle = l.angle !== null ? (l.angle * Math.PI) / 180 : side * 0.95 + (side === 0 ? -0.35 : 0);
  const elev = 0.55;
  const keyDir = [Math.sin(angle) * Math.cos(elev), Math.cos(angle) * Math.cos(elev) * 0.6 + 0.35, Math.sin(elev)];
  const kl = Math.hypot(...keyDir);
  const brighterSide = side >= 0 ? p.right : p.left;
  const keyColor = mix3(WHITE, chroma(brighterSide, 0.45), m);
  const contrastK = smooth(2, 30, p.contrast);
  const key = l.key * 0.6 * mix(0.55, 1, contrastK) * (1 - d * 0.5);

  // Rims: the backdrop's lights, which stand behind the cast.
  const rimPos = [];
  const rimColor = [];
  const rimPower = [];
  for (let i = 0; i < RIM_SLOTS; i++) {
    const src = p.lights[i];
    if (src) {
      rimPos.push([src.x, src.y]);
      rimColor.push(src.color);
      rimPower.push(src.power * l.rim * 0.5 * (1 - d * 0.35));
    } else {
      rimPos.push([0.5, -0.4]);
      rimColor.push(i === 0 ? chroma(p.sky, 0.6) : [1, 1, 1]);
      rimPower.push(i === 0 ? 0.15 * l.rim : 0);
    }
  }

  // The edge light every composited character carries: a hairline of near
  // white just outside the outline, tinted by the room's brightest light, and
  // a soft halo of the room's own colour beyond it. A dark room keeps the line
  // (it is what separates a dark coat from a dark wall) and dims the halo.
  const lead = p.lights[0]?.color ?? chroma(p.white, 0.6);
  const strokeColor = moon(mix3(WHITE, lead, 0.3 * m));
  const stroke = clamp(l.rim * (1 - d * 0.3), 0, 2);
  // The line is the rim lights catching the edge, so it follows them: full
  // on the side facing a lamp, a faint trace round the far side (still enough
  // to part a dark coat from a dark wall), and it glows.
  const strokeFloor = 0.14;
  const rimGlow = clamp(l.rim, 0, 2) * mix(0.45, 0.95, l.glow) * (1 - d * 0.3);
  const haloColor = scale3(moon(mix3(lead, tintOf(p.mean, 0.8), 0.5)), mix(0.45, 0.95, bright));
  const halo = l.glow * 0.6 * (1 - d * 0.4);

  // Glow. The picture blooms; the bloom wraps round the cast's edges and, in a
  // bright room, veils them; and the cast's own highlights diffuse.
  const diffusion = l.glow * mix(0.12, 0.4, bright);
  const wrap = l.glow * 0.9;
  const glow = l.glow * mix(0.2, 0.5, bright);
  const bloom = l.glow * 0.9;

  const flicker = l.flicker && p.warmth > 0.35 ? smooth(0.35, 0.8, p.warmth) : 0;

  // Strength is the whole look: the figure pass mixes by it, and everything
  // drawn outside the figures (the room's blur, bloom, dimming, the shadows,
  // the grain) is scaled by it here, so 0.01 is a breath of the look, not all
  // of the room's treatment with none of the cast's.
  const k = clamp(l.strength, 0, 1);

  return {
    strength: l.strength,
    level,
    shoulder,
    contrast,
    saturation,
    tintShadow,
    tint,
    tintHigh,
    lift,
    sky,
    ground,
    // Local backdrop colour around each pixel: only an auto room has a picture.
    env: auto && probe?.ok ? 0.55 * m : 0,
    keyDir: keyDir.map((v) => v / kl),
    keyColor,
    key,
    rimPos,
    rimColor,
    rimPower,
    stroke,
    strokeColor,
    strokeFloor,
    rimGlow,
    halo,
    haloColor,
    diffusion,
    wrap,
    ao: 0.35,
    haze: p.haze,
    shadowColor: scale3(chroma(p.shadow, 0.6), 0.02),
    shadow: 0.55 * (1 - d * 0.4) * k,
    // An unrevealed character: the room's deepest shade, never paper black.
    silhouette: scale3(mix3(WHITE, tintOf(p.shadow, 0.6), k), 0.006),
    flicker: flicker * k,
    blur: l.blur * k,
    bloom: bloom * k,
    bgLevel: mix(1, mix(1, 0.5, d), k),
    bgTint: mix3(WHITE, MOON, d * 0.5 * k),
    bgHaze: 0.05 * l.glow * k,
    glow: glow * k,
    grain: l.grain * k,
  };
}

/** Linear interpolation of two rigs — a relight tween. Same shape in, same shape out. */
export function lerpRig(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const out = {};
  for (const k of Object.keys(b)) {
    const x = a[k];
    const y = b[k];
    if (typeof y === "number") out[k] = mix(x ?? y, y, t);
    else if (Array.isArray(y) && Array.isArray(y[0])) out[k] = y.map((row, i) => row.map((v, j) => mix(x?.[i]?.[j] ?? v, v, t)));
    else if (Array.isArray(y)) out[k] = y.map((v, i) => mix(x?.[i] ?? v, v, t));
    else out[k] = y;
  }
  return out;
}
