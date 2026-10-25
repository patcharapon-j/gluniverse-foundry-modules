/**
 * Spellglass — the look tables.
 *
 * Every area resolves along three independent axes, and each axis owns one
 * visual channel so two areas that differ in meaning can never look alike:
 *
 *   function  → the PATTERN laid over the floor, the RIM style, the ALERT
 *               rhythm and the ACCENT hue of the brackets, echo and marks.
 *               Twelve functions, twelve patterns, twelve rims-and-alerts.
 *   material  → the COLOUR PAIR: `body` floods the fill and the glow, `hot`
 *               draws the rim and the pattern. Twenty-six materials, twenty-six
 *               pairs, held apart in OKLab by the check tool.
 *   behaviour → the MOTION: how the pattern drifts or turns, and how fast
 *               the alert beats.
 *
 * Pure and dependency-free: the check tool and the preview page import it
 * directly, and `presentation.mjs` resolves a Region against it.
 */

/** Material → [body, hot]. Order is irrelevant; ids are schema MATERIALS. */
export const MATERIAL_COLORS = Object.freeze({
  fire:        ["#ff4a12", "#ffd04d"],
  cold:        ["#38c8ff", "#eafcff"],
  electricity: ["#3150ff", "#fff25a"],
  acid:        ["#b8ff00", "#f8ffa6"],
  poison:      ["#159c55", "#d88cff"],
  sonic:       ["#ff2fa8", "#ffd6f0"],
  force:       ["#93a9ff", "#ffffff"],
  kinetic:     ["#c9723e", "#ffe1c4"],
  vitality:    ["#63ff9e", "#f4fff8"],
  void:        ["#4a1a92", "#b47dff"],
  spirit:      ["#5af7e4", "#f0fffd"],
  holy:        ["#ffb01a", "#fff4cc"],
  unholy:      ["#b3103c", "#ff8f8f"],
  light:       ["#fff3a8", "#ffffff"],
  shadow:      ["#38355a", "#a39dd0"],
  mental:      ["#e05cff", "#ffe2ff"],
  illusion:    ["#b28aff", "#ffc4f0"],
  air:         ["#c6e6f2", "#ffffff"],
  earth:       ["#8a5a2b", "#ebbb7c"],
  water:       ["#1d6ee6", "#90e4ff"],
  wood:        ["#9a842c", "#f0d890"],
  metal:       ["#8796a8", "#f2f6fb"],
  plant:       ["#3fae2a", "#c9f08a"],
  fungal:      ["#a0648e", "#c8ff9c"],
  arcane:      ["#7458ff", "#e2dbff"],
  neutral:     ["#5f86d8", "#d6e2ff"],
});

/**
 * Pattern recipes live in `patterns.mjs`; this is only which one, at what
 * size (`span`: grid squares per tile repeat) and how strongly.
 *
 * Rims: solid · double · dashed · dotted · chain · tape.
 * Alerts: heartbeat · breathe · throb · strobe · none.
 */
export const FUNCTION_LOOK = Object.freeze({
  harm:    { accent: "#ff3b30", pattern: "shards",  span: 1,   patternAlpha: 0.62, fill: 0.24, rim: "solid",  rimPx: 2.8, glow: 1.25, alert: "heartbeat", period: 1.35, echo: true,  brackets: true },
  restore: { accent: "#3dff8f", pattern: "cross",   span: 1,   patternAlpha: 0.58, fill: 0.20, rim: "double", rimPx: 2.2, glow: 1.05, alert: "breathe",   period: 3.0,  echo: false, brackets: true },
  support: { accent: "#39d0ff", pattern: "chevron", span: 1,   patternAlpha: 0.56, fill: 0.18, rim: "solid",  rimPx: 2.2, glow: 1.0,  alert: "breathe",   period: 2.4,  echo: false, brackets: true },
  protect: { accent: "#f0f4ff", pattern: "scales",  span: 1,   patternAlpha: 0.58, fill: 0.22, rim: "double", rimPx: 3.0, glow: 1.15, alert: "none",      period: 0,    echo: false, brackets: true },
  hinder:  { accent: "#ff9f1c", pattern: "zigzag",  span: 1,   patternAlpha: 0.62, fill: 0.20, rim: "dashed", rimPx: 2.6, glow: 1.05, alert: "throb",     period: 2.2,  echo: false, brackets: true },
  control: { accent: "#c77dff", pattern: "net",     span: 1,   patternAlpha: 0.60, fill: 0.20, rim: "chain",  rimPx: 2.4, glow: 1.05, alert: "breathe",   period: 2.8,  echo: false, brackets: true },
  conceal: { accent: "#6f6a96", pattern: "fog",     span: 2,   patternAlpha: 0.70, fill: 0.36, rim: "dotted", rimPx: 2.4, glow: 0.80, alert: "none",      period: 0,    echo: false, brackets: false },
  terrain: { accent: "#c9a46a", pattern: "cobble",  span: 1,   patternAlpha: 0.60, fill: 0.20, rim: "solid",  rimPx: 2.2, glow: 0.80, alert: "none",      period: 0,    echo: false, brackets: true },
  detect:  { accent: "#fff4a0", pattern: "scan",    span: 1,   patternAlpha: 0.55, fill: 0.14, rim: "dashed", rimPx: 2.0, glow: 1.0,  alert: "none",      period: 0,    echo: false, brackets: true, sweep: true },
  summon:  { accent: "#2ff2d0", pattern: "sigil",   span: 1,   patternAlpha: 0.62, fill: 0.20, rim: "double", rimPx: 2.4, glow: 1.15, alert: "breathe",   period: 2.0,  echo: true,  brackets: true },
  hazard:  { accent: "#ffd400", pattern: "tape",    span: 1,   patternAlpha: 0.50, fill: 0.24, rim: "tape",   rimPx: 4.0, glow: 1.30, alert: "strobe",    period: 0.9,  echo: true,  brackets: true },
  neutral: { accent: "#8593a8", pattern: "dots",    span: 1,   patternAlpha: 0.50, fill: 0.16, rim: "solid",  rimPx: 2.0, glow: 0.85, alert: "none",      period: 0,    echo: false, brackets: true },
});

/** The texture laid over squares that are inside the area but out of line of effect. */
export const BLOCKED_PATTERN = "hatch";

/**
 * Behaviour → motion. `drift` is grid squares per second along the area's
 * direction (cones and lines) or the diagonal; `spin` is radians per second
 * of the pattern about the area's origin; `pace` scales the alert period
 * (higher is faster). Static is the only behaviour that never wants a frame.
 */
export const BEHAVIOR_MOTION = Object.freeze({
  impact:  { drift: 0.10, spin: 0,     pace: 1.35, enter: "flash" },
  pulse:   { drift: 0,    spin: 0,     pace: 1.15, enter: "flash" },
  flow:    { drift: 0.45, spin: 0,     pace: 1.0,  enter: "draw" },
  grow:    { drift: 0.12, spin: 0,     pace: 0.8,  enter: "draw" },
  contain: { drift: 0,    spin: 0.10,  pace: 0.75, enter: "draw" },
  sweep:   { drift: 0,    spin: 0.55,  pace: 1.25, enter: "draw" },
  linger:  { drift: 0.08, spin: 0,     pace: 0.7,  enter: "draw" },
  sustain: { drift: 0,    spin: 0.04,  pace: 0.8,  enter: "draw" },
  trigger: { drift: 0,    spin: 0,     pace: 1.5,  enter: "flash" },
  static:  { drift: 0,    spin: 0,     pace: 0,    enter: "draw" },
});

/** Treatment → channel multipliers. Grounded is the reference look. */
export const TREATMENT_LOOK = Object.freeze({
  grounded:   { fill: 1.0,  pattern: 1.0,  glow: 1.0,  rim: 1.0 },
  volumetric: { fill: 0.75, pattern: 1.15, glow: 1.45, rim: 0.9 },
  airborne:   { fill: 0.55, pattern: 1.25, glow: 1.2,  rim: 0.75 },
});

/** Functions whose areas default to a non-grounded treatment. */
export const DEFAULT_TREATMENT = Object.freeze({
  conceal: "airborne", summon: "volumetric", harm: "volumetric",
});

/** World intensity → a single gain on every alpha and glow width. */
export const INTENSITY_GAIN = Object.freeze({ subtle: 0.72, balanced: 1, cinematic: 1.3 });

/**
 * Screen-pixel sizes. Anything that must read as a line is in CSS pixels and
 * divided by the stage zoom at draw time, so a rim is the same weight at every
 * zoom; anything that is a reach across the floor is in grid squares.
 */
export const SIZES = Object.freeze({
  keylinePx: 2.6,        // dark line under the rim, so it survives a bright map
  glowPx: [26, 14, 7],   // the glow stack, widest first
  glowAlpha: [0.10, 0.17, 0.30],
  seamPx: 1,             // between two covered squares
  bracketPx: 2.4,
  bracketArm: 0.26,      // grid squares
  dashPx: 14,            // one dash + gap period is 2 × this
  dotGapPx: 9,
  echoPx: 3,
  echoReach: 0.55,       // grid squares the echo travels past the edge
  markPx: 2,             // token brackets
  chevronPx: 3,
  shadowOffset: 0.025,   // grid squares the pattern's ink shadow sits down-right
});

const hexInt = (hex) => Number.parseInt(String(hex).slice(1, 7), 16);

/**
 * One area's resolved look, from its semantic ids. Everything the renderer
 * reads comes out of here, so a look is a function of meaning alone — two
 * Regions with the same semantics are drawn identically on every client.
 *
 * `palette` is the GM's optional { body, hot, accent } override (#rrggbb).
 */
export function composeLook({
  fn = "neutral", secondary = null, material = "neutral", accentMaterial = null,
  behavior = "static", treatment = null, intensity = "balanced", palette = null, hotFrom = null,
} = {}) {
  const f = FUNCTION_LOOK[fn] ?? FUNCTION_LOOK.neutral;
  const [baseBody, baseHot] = MATERIAL_COLORS[material] ?? MATERIAL_COLORS.neutral;
  const body = palette?.body ?? baseBody;
  const hot = palette?.hot ?? (palette?.body && hotFrom ? hotFrom(palette.body) : baseHot);
  const accent = palette?.accent ?? f.accent;
  const motion = BEHAVIOR_MOTION[behavior] ?? BEHAVIOR_MOTION.static;
  const treatmentId = TREATMENT_LOOK[treatment] ? treatment : (DEFAULT_TREATMENT[fn] ?? "grounded");
  const t = TREATMENT_LOOK[treatmentId];
  const gain = INTENSITY_GAIN[intensity] ?? 1;
  const second = secondary && secondary !== fn ? FUNCTION_LOOK[secondary] : null;
  const secondColor = accentMaterial ? (MATERIAL_COLORS[accentMaterial]?.[1] ?? hot) : (second?.accent ?? hot);
  const alert = motion.pace > 0 ? f.alert : "none";
  return Object.freeze({
    fn, material, behavior, treatment: treatmentId,
    body, hot, accent,
    bodyInt: hexInt(body), hotInt: hexInt(hot), accentInt: hexInt(accent),
    pattern: f.pattern, span: f.span,
    fill: Math.min(0.6, f.fill * t.fill * gain),
    patternAlpha: Math.min(0.95, f.patternAlpha * t.pattern * gain),
    glow: f.glow * t.glow * gain,
    rim: f.rim, rimPx: f.rimPx, rimAlpha: Math.min(1, t.rim * Math.max(1, gain)),
    alert, period: f.period > 0 && motion.pace > 0 ? f.period / motion.pace : 0,
    echo: f.echo && alert !== "none",
    brackets: f.brackets,
    sweep: Boolean(f.sweep) && motion.pace > 0,
    drift: motion.drift, spin: motion.spin, pace: motion.pace, enter: motion.enter,
    secondary: second ? Object.freeze({ pattern: second.pattern, span: second.span, color: secondColor, colorInt: hexInt(secondColor) }) : null,
    gain,
  });
}

