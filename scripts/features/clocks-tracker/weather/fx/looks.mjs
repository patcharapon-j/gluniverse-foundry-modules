/**
 * Weather FX — the pure model. An effect spec (`{ archetype, kind, intensity,
 * tintParticle, tintGlow, drift }`, the shape a weather hex and a delving stage
 * both carry) resolves here to a LOOK (which shader program draws it) and the
 * numbers that program reads. Nothing here touches the DOM, WebGL or the world:
 * the check tool and the preview page import it under plain Node / a bare page.
 *
 * Archetypes stay the stored vocabulary (they are world data). A library kind
 * whose archetype is still its own may ask for a richer look than its archetype
 * (aurora draws curtains, a sandstorm drives grit, a meteor shower streaks) —
 * but only while the GM has not re-pointed that hex at a different archetype,
 * so a retargeted hex always draws what its archetype says.
 */

/** Every look, each its own program. */
export const LOOKS = Object.freeze(["clear", "rain", "storm", "snow", "hail", "fog", "wind", "embers", "motes", "aurora"]);

/** Archetype → look, and the variant flags that look reads from `uP`. */
export const ARCHETYPE_LOOK = Object.freeze({
  clear:   { look: "clear" },
  streaks: { look: "rain" },
  drips:   { look: "rain",   p: [1, 0, 0, 0] },          // slow, beaded drips
  flashes: { look: "storm" },
  flakes:  { look: "snow" },
  dust:    { look: "snow",   p: [0, 1, 0, 0] },          // fine grains, no crystal core
  shards:  { look: "hail" },
  volume:  { look: "fog" },
  shadow:  { look: "fog",    p: [1, 0, 0, 0] },          // dark masses creeping in from the edges
  miasma:  { look: "fog",    p: [0, 1, 0, 0] },          // heavy, low, rising wisps
  gusts:   { look: "wind" },
  ripples: { look: "wind",   p: [0, 1, 0, 0] },          // rising water lines
  embers:  { look: "embers" },
  creep:   { look: "embers", p: [0, 1, 0, 0] },          // slow rot rising from below
  bubbles: { look: "embers", p: [1, 0, 0, 0] },          // rising rings
  motes:   { look: "motes" },
  spores:  { look: "motes" },
  static:  { look: "motes",  p: [1, 0, 0, 0] },          // signal loss
  swarm:   { look: "motes",  p: [2, 0, 0, 0] },          // erratic, dark
  runes:   { look: "motes",  p: [3, 0, 0, 0] },          // glyph motes
  void:    { look: "motes",  p: [4, 0, 0, 0] }           // far stars and a slow nebula
});

/** Library kinds that draw something richer than their archetype, keyed by kind. */
export const KIND_LOOK = Object.freeze({
  aurora:          { archetype: "motes",   look: "aurora" },
  sand:            { archetype: "gusts",   look: "wind",  p: [1, 0, 0, 0] },
  "meteor-shower": { archetype: "shards",  look: "hail",  p: [1, 0, 0, 0] },
  clouds:          { archetype: "volume",  look: "fog",   p: [0, 0, 1, 0] },
  "arcane-mist":   { archetype: "volume",  look: "fog",   p: [0, 0, 0, 1] },
  blizzard:        { archetype: "flakes",  look: "snow",  p: [0, 0, 1, 0] },
  "spore-bloom":   { archetype: "motes",   look: "motes", p: [5, 0, 0, 0] }
});

/** Seconds in the idle loop. Every idle term turns a whole number of times in
 *  it (the shaders `floor()` every rate), so nothing steps when the clock wraps. */
export const LOOP_SECONDS = 64;

/** Behaviours the shared frame budget may shed, cheapest to lose first. */
export const SHED_ORDER = Object.freeze(["fullRate", "depth", "haze", "resolution", "motion"]);

/** Frame rates: full, and once `fullRate` is shed. */
export const FPS = Object.freeze({ full: 60, shed: 30 });

/** Backing-store density cap, and the one used once `resolution` is shed. */
export const DPR = Object.freeze({ max: 2, shed: 1 });

/** Lightning timing, in seconds (the storm look's only transient). */
export const BOLT = Object.freeze({ flashDecay: 4.2, boltDecay: 9, minGap: 1.6, rate: 0.16, rateI: 0.55, points: 16 });

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));

/** "#rrggbb" → [r, g, b] in 0..1 (fallback when malformed). */
export function rgb(hex, fallback = [1, 1, 1]) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex ?? ""));
  if (!m) return [...fallback];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** The unit direction particles travel in, host px (y down). */
export function direction(look, drift, intensity) {
  const I = clamp01(intensity);
  const sx = drift === "left" ? -1 : drift === "right" ? 1 : 0;
  const norm = ([x, y]) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  switch (look) {
    case "rain": case "storm": return norm([sx * (0.16 + 0.22 * I), 1]);
    case "hail": return norm([sx * 0.12, 1]);
    case "snow": {
      if (drift === "rise") return norm([0.08, -1]);
      return norm([sx * (0.35 + 1.4 * I), 1]);
    }
    case "wind": {
      if (drift === "rise") return [0, -1];
      if (drift === "fall") return [0, 1];
      return [sx < 0 ? -1 : 1, 0];
    }
    case "embers": return norm([sx * 0.35, drift === "fall" ? 1 : -1]);
    case "fog": case "aurora": case "clear": return [sx < 0 ? -1 : 1, 0];
    case "motes": {
      if (drift === "still") return [0, 0];
      if (drift === "rise") return [0, -1];
      if (drift === "fall") return [0, 1];
      return [sx, 0];
    }
    default: return [0, 1];
  }
}

/**
 * Resolve an effect spec to what one draw needs. Pure; the same spec always
 * gives the same answer (the seed is the host's, not the spec's).
 * @returns {{ look: string, I: number, tint: number[], glow: number[], dir: number[], p: number[], still: boolean }}
 */
export function resolveLook(spec) {
  const s = spec ?? {};
  const arch = Object.hasOwn(ARCHETYPE_LOOK, s.archetype) ? s.archetype : "clear";
  const byKind = Object.hasOwn(KIND_LOOK, s.kind) && KIND_LOOK[s.kind].archetype === arch ? KIND_LOOK[s.kind] : null;
  const base = byKind ?? ARCHETYPE_LOOK[arch];
  const look = base.look;
  const I = clamp01(s.intensity ?? 0.5);
  return {
    look,
    I,
    tint: rgb(s.tintParticle, [0.81, 0.91, 1]),
    glow: rgb(s.tintGlow, [0.5, 0.7, 0.9]),
    dir: direction(look, s.drift, I),
    p: [...(base.p ?? [0, 0, 0, 0])],
    still: look === "motes" && s.drift === "still"
  };
}

/** True if a spec draws lightning (the only look with a JS-side transient). */
export const hasBolts = (look) => look === "storm";

/**
 * A fresh forked bolt in host CSS px: a main channel plus one or two branches,
 * flattened into `BOLT.points` vec2 slots; a segment whose start is the
 * sentinel (-1,-1) is skipped by the shader, so branches are separated by it.
 * `rand` is injected so the check tool can drive it deterministically.
 */
export function makeBolt(w, h, rand = Math.random) {
  const pts = [];
  const r = (a, b) => a + (b - a) * rand();
  const wide = w / h > 3;
  // The full bar shows its weather down its left third, so strikes land there;
  // a near-square chip centres them.
  let x = wide ? r(w * 0.06, w * 0.26) : r(w * 0.3, w * 0.7);
  const segs = 8;
  const jit = Math.min(w * 0.12, 9);
  const main = [];
  for (let i = 0; i <= segs; i++) {
    main.push([Math.max(2, Math.min(w - 2, x)), (h * 1.05 * i) / segs - h * 0.05]);
    x += r(-1, 1) * jit;
  }
  pts.push(...main);
  const branches = rand() < 0.6 ? 1 : 2;
  for (let b = 0; b < branches && pts.length < BOLT.points - 3; b++) {
    const from = main[1 + Math.floor(rand() * (segs - 3))];
    const dir = rand() < 0.5 ? -1 : 1;
    pts.push([-1, -1]);
    let bx = from[0], by = from[1];
    pts.push([bx, by]);
    const n = Math.min(3, BOLT.points - pts.length);
    for (let i = 0; i < n; i++) {
      bx += dir * r(3, 8);
      by += (h / segs) * r(0.6, 1.1);
      pts.push([bx, by]);
    }
  }
  while (pts.length < BOLT.points) pts.push([-1, -1]);
  return pts.slice(0, BOLT.points);
}
