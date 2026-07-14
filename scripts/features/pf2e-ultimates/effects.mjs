/**
 * Charged-effect styles for PF2e Ultimates.
 *
 * Every effect is a GLSL snippet that defines
 *   vec3 glultEffect(vec2 uv, float r, float a)
 * returning (energy, heat, fill):
 *   energy — added light/alpha contribution,
 *   heat   — pushes the color toward white-hot,
 *   fill   — pushes the color from deep toward bright.
 *
 * Snippets are compiled twice with different geometry macros:
 *   token overlay ring — full complexity,
 *   gel icon           — `GLULT_SIMPLE` defined; helpers drop noise octaves
 *                        and snippets skip garnish layers, keeping the same
 *                        vibe at a fraction of the cost (the icon is small).
 * Macros available to snippets:
 *   GLULT_EDGE — inner radius where the effect starts,
 *   GLULT_BASE — center of the main energy band,
 *   GLULT_OUT  — typical outer reach,
 *   GLULT_SIMPLE — defined only for the gel-icon variant.
 *
 * Seam rule: anything angular must be seam-free across the ±PI atan
 * boundary — integer harmonics of `a`, comet terms `sin(a - t)`, cell
 * indices wrapped with mod(cell, count), or noise sampled in a rotated
 * Cartesian frame. Never sample noise on raw `a`.
 */

export const DEFAULT_EFFECT = "surge";

/** Shared helper library injected between the macros and each effect body. */
export const EFFECT_PRELUDE = `
float glultHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + vec2(34.345 + uSeed));
  return fract(p.x * p.y);
}

float glultNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(glultHash(i), glultHash(i + vec2(1.0, 0.0)), f.x),
    mix(glultHash(i + vec2(0.0, 1.0)), glultHash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

mat2 glultRotate(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

/* Piecewise-LINEAR value noise: hard kinks at integer stations, so bolts
   read as angular zigzags instead of smooth wobbles. */
float glultZig(float x, float t) {
  float i = floor(x);
  float f = fract(x);
  float a = glultHash(vec2(i, t)) - 0.5;
  float b = glultHash(vec2(i + 1.0, t)) - 0.5;
  return mix(a, b, f);
}

float glultBreathe(float speed) {
  return 0.92 + 0.08 * sin(uTime * speed + uSeed);
}

float glultPulse(float speed, float sharp) {
  return pow(0.5 + 0.5 * sin(uTime * speed + uSeed), sharp);
}

/* Mask that ramps the effect in just past the sphere/token edge. */
float glultIn(float r) {
  return smoothstep(GLULT_EDGE, GLULT_EDGE + 0.034, r);
}

float glultFade(float r) {
  return 1.0 - smoothstep(GLULT_OUT - 0.04, GLULT_OUT + 0.03, r);
}

float glultBandN(float r) {
  return clamp((r - GLULT_EDGE) / (GLULT_OUT - GLULT_EDGE), 0.0, 1.0);
}

/* Spiraling flame tongues: noise sampled in a rotated Cartesian frame
   (rotation grows with radius -> spiral), seamless across the ±PI boundary. */
float glultTongues(vec2 uv, float r, float spin, float drift, float scale) {
  vec2 sp = glultRotate(r * spin - uTime * drift) * uv;
  vec2 outward = (sp / max(r, 0.05)) * uTime * 0.22;
  float n = glultNoise(sp * scale - outward + vec2(uSeed, 0.0));
#ifndef GLULT_SIMPLE
  n = n * 0.7 + glultNoise(sp * scale * 2.05 - outward * 1.6 + vec2(0.0, uSeed)) * 0.3;
#endif
  return pow(1.0 - abs(2.0 * n - 1.0), 2.4);
}

/* Full flame band (body + hot core + glow), returned as (energy, heat, fill). */
vec3 glultFlame(vec2 uv, float r, float spin, float drift, float scale, float lift, float reach) {
  float licks = glultTongues(uv, r, spin, drift, scale);
  float len = GLULT_BASE + lift + licks * reach;
  float flicker = 0.82 + 0.18 * (0.6 * sin(uTime * 5.3 + uSeed) + 0.4 * sin(uTime * 8.7 + uSeed * 2.0));
  float pulse = glultBreathe(2.25) * flicker;
  float body = glultIn(r) * (1.0 - smoothstep(len - 0.06, len, r)) * (0.30 + licks * 1.25) * pulse;
  float core = glultIn(r) * (1.0 - smoothstep(GLULT_BASE + 0.028, GLULT_BASE + 0.062, r))
    * (0.5 + licks * 0.8) * pulse;
  float glow = exp(-abs(r - GLULT_BASE) * 15.0) * 0.32 * pulse;
  return vec3(body * 1.1 + core * 0.9 + glow, core * 0.9 + body * 0.18, body * 0.6 + core);
}

/* Broken rotating ring segments. frequency must be an integer (seam rule). */
float glultArc(float r, float a, float radius, float phase, float frequency) {
  float ring = exp(-abs(r - radius) * 145.0);
  float broken = smoothstep(-0.35, 0.42, sin(a * frequency + phase));
  return ring * broken;
}

/* Angular lightning bolt radiating outward at the given angle. */
float glultBolt(vec2 p, float angle, float seed) {
  p = glultRotate(angle) * p;
  float cycle = uTime * 1.35 + seed * 17.0 + uSeed;
  float tick = floor(cycle);
  float age = fract(cycle);

  float jag = glultZig(p.x * 13.0 + seed * 7.0, tick) * 0.115
    * smoothstep(GLULT_EDGE - 0.09, GLULT_EDGE + 0.11, p.x);
  jag += glultZig(p.x * 31.0 + seed * 3.0, tick + 7.0) * 0.042;

  float core = exp(-abs(p.y - jag) * 250.0);
  float halo = exp(-abs(p.y - jag) * 46.0) * 0.45;
  float reach = smoothstep(GLULT_EDGE - 0.04, GLULT_EDGE + 0.01, p.x)
    * (1.0 - smoothstep(GLULT_OUT - 0.06, GLULT_OUT + 0.04, p.x));

  float event = step(0.6, glultHash(vec2(tick, seed * 31.7)));
  float strike = 1.0 - smoothstep(0.0, 0.19, age);
  float strobe = mix(0.55, 1.0, step(0.4, glultHash(vec2(tick + floor(age * 26.0), seed * 5.1))));
  float aftershock = exp(-pow((age - 0.30) * 26.0, 2.0)) * 0.5;
  float flash = event * (strike * strobe + aftershock);

  float forkBase = GLULT_BASE + glultHash(vec2(tick, seed + 2.0)) * 0.09;
  float forkY = jag + (p.x - forkBase) * (0.55 + seed * 0.35)
    + glultZig(p.x * 27.0 + seed, tick + 3.0) * 0.03;
  float fork = exp(-abs(p.y - forkY) * 270.0);
  fork *= smoothstep(forkBase, forkBase + 0.035, p.x)
    * (1.0 - smoothstep(GLULT_OUT - 0.11, GLULT_OUT - 0.01, p.x));

  return ((core + halo) * reach + fork) * flash;
}

/* Concentric rings sweeping outward (negative speed sweeps inward). */
float glultRipples(float r, float speed, float spacing, float sharp) {
  float band = glultBandN(r);
  float phase = fract(band * spacing - uTime * speed);
  float ring = exp(-pow((phase - 0.5) * sharp, 2.0));
  return ring * glultIn(r) * glultFade(r) * (1.0 - band * 0.6);
}

/* Soft radial rays; count must be an integer (seam rule). */
float glultRays(float a, float r, float count, float speed, float sharp, float reach) {
  float wave = pow(abs(sin(a * count * 0.5 + uTime * speed + uSeed)), sharp);
  float len = GLULT_BASE + 0.01 + wave * reach;
  return glultIn(r) * (1.0 - smoothstep(len - 0.05, len, r)) * (0.12 + wave * 1.05);
}

/* Faceted shard ring: hard triangular spikes of hashed lengths.
   count must be an integer (seam rule); tick reshuffles the lengths. */
float glultCrystals(float a, float r, float count, float spin, float reach, float tick) {
  float x = (a + spin) * count * 0.15915494;
  float cell = mod(floor(x), count);
  float f = fract(x);
  float h = glultHash(vec2(cell, tick));
  float tip = 1.0 - abs(2.0 * f - 1.0);
  float spike = pow(tip, 2.6);
  float len = GLULT_BASE + 0.015 + (0.35 + 0.65 * h) * reach * (0.12 + 0.88 * spike);
  float body = glultIn(r) * (1.0 - smoothstep(len - 0.012, len, r))
    * (0.30 + h * 0.45) * (0.35 + 0.65 * spike);
  float edge = exp(-abs(r - len) * 150.0) * (0.3 + spike * 0.7) * glultIn(r);
  return body + edge;
}

/* Up to five orbiting motes. */
float glultMotes(vec2 uv, float count, float radius, float speed, float tight) {
  float total = 0.0;
  for (int i = 0; i < 5; i++) {
    if (float(i) >= count) break;
    float fi = float(i);
    float ang = uTime * speed * (0.8 + 0.1 * fi) + fi * 6.2832 / count + uSeed;
    float rad = radius + 0.028 * sin(uTime * 1.7 + fi * 2.4 + uSeed);
    vec2 d = uv - vec2(cos(ang), sin(ang)) * rad;
    total += exp(-dot(d, d) * tight);
  }
  return total;
}

/* Twinkling star glints at hashed positions; each fades in/out per slot. */
float glultGlints(vec2 uv, float count, float speed) {
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    if (float(i) >= count) break;
    float fi = float(i);
    float cycle = uTime * speed * 0.25 + fi * 0.37 + uSeed;
    float slot = floor(cycle);
    float ph = fract(cycle);
    float h1 = glultHash(vec2(fi * 3.1 + 1.0, slot));
    float h2 = glultHash(vec2(fi * 5.7 + 9.0, slot));
    float ang = h1 * 6.2832;
    float rad = GLULT_BASE + 0.015 + h2 * (GLULT_OUT - GLULT_BASE - 0.09);
    vec2 d = uv - vec2(cos(ang), sin(ang)) * rad;
    float tw = pow(sin(3.14159 * ph), 6.0);
    float star = exp(-dot(d, d) * 5200.0) * 1.2
      + exp(-abs(d.x) * 320.0 - abs(d.y) * 46.0) * 0.5
      + exp(-abs(d.y) * 320.0 - abs(d.x) * 46.0) * 0.5;
    total += star * tw;
  }
  return total;
}

/* Drifting cloud band hugging the energy ring. */
float glultHaze(vec2 uv, float r, float scale, float drift) {
  vec2 sp = glultRotate(-uTime * drift) * uv;
  float n = glultNoise(sp * scale + vec2(uSeed, uTime * 0.35));
#ifndef GLULT_SIMPLE
  n = n * 0.65 + glultNoise(sp * scale * 2.3 + vec2(uTime * 0.5, uSeed)) * 0.35;
#endif
  float band = exp(-pow((r - GLULT_BASE - 0.05) * 11.0, 2.0));
  return band * n * glultIn(r);
}

/* Tangential streaks: comet heads circling at hashed radii and speeds. */
float glultGusts(vec2 uv, float r, float a, float speed, float width) {
  float total = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float h = glultHash(vec2(fi * 2.3 + 4.0, 9.1));
    float rad = GLULT_BASE + 0.015 + h * (GLULT_OUT - GLULT_BASE - 0.1);
    float head = pow(0.5 + 0.5 * sin(a - uTime * speed * (0.7 + h * 0.6) - fi * 1.9 - uSeed), 20.0 - fi * 3.0);
    total += head * exp(-abs(r - rad) * width);
  }
  return total * glultIn(r);
}

/* Ring whose radius undulates with integer angular harmonics (seam rule). */
float glultWaveRing(float a, float r, float k1, float k2, float amp, float width) {
  float offset = sin(a * k1 + uTime * 1.7 + uSeed) * amp + sin(a * k2 - uTime * 2.4) * amp * 0.6;
  return exp(-abs(r - (GLULT_BASE + 0.045) - offset) * width) * glultIn(r);
}

/* Rotating spiral arms; k must be an integer (seam rule). */
float glultSpiral(float a, float r, float k, float twist, float speed) {
  float arm = pow(0.5 + 0.5 * sin(a * k + r * twist - uTime * speed + uSeed), 5.0);
  return arm * glultIn(r) * glultFade(r);
}

/* Single comet head circling the band. Negative speed reverses direction. */
float glultComet(float a, float r, float radius, float speed, float phase0, float sharp) {
  return pow(0.5 + 0.5 * sin(a - uTime * speed + phase0 + uSeed), sharp)
    * exp(-abs(r - radius) * 65.0);
}

/* One expanding shockwave ring per cycle. */
float glultShock(float r, float speed, float shift, float strength) {
  float phase = fract(uTime * speed + shift + fract(uSeed * 0.17));
  float radius = GLULT_BASE + phase * (GLULT_OUT - GLULT_BASE);
  return exp(-abs(r - radius) * 85.0) * (1.0 - phase) * strength;
}

/* Droplets falling below the band (texture +y is down). */
float glultDrips(vec2 uv, float cols, float speed) {
  float cw = 1.0 / cols;
  float col = floor(uv.x / cw + 0.5);
  float cx = col * cw;
  float h = glultHash(vec2(col, 3.7));
  float cycle = uTime * speed * (0.5 + h) + h * 9.0;
  float fall = fract(cycle);
  float gate = step(0.45, glultHash(vec2(col, floor(cycle))));
  float yPos = GLULT_BASE * 0.85 + fall * (GLULT_OUT - GLULT_BASE * 0.85 + 0.03);
  vec2 d = vec2((uv.x - cx) * 2.4, uv.y - yPos);
  float drop = exp(-dot(d, d) * 2400.0) * 1.4;
  float trail = exp(-pow((uv.x - cx) * 70.0, 2.0))
    * smoothstep(yPos - 0.10, yPos + 0.02, uv.y) * step(uv.y, yPos)
    * smoothstep(GLULT_BASE * 0.8 - 0.02, GLULT_BASE * 0.8 + 0.02, uv.y) * 0.35;
  return (drop + trail) * (1.0 - fall * 0.55) * gate * (1.0 - smoothstep(0.42, 0.47, abs(uv.x)));
}
`;

/**
 * Registry of charged-effect styles. Order within each group is the order
 * shown in the config dialog. `color`/`icon` are suggestions applied when the
 * GM picks the effect; both stay independently editable.
 */
export const EFFECTS = Object.freeze({
  /* ----------------------------- Mystic ------------------------------ */

  // The classic combined look (flame + lightning + arcs) — the default, and
  // a verbatim port of the pre-effect-system shaders.
  surge: {
    group: "mystic",
    color: "#5eeaff",
    icon: "fa-solid fa-star",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
#ifdef GLULT_SIMPLE
  vec3 fx = glultFlame(uv, r, 9.0, 0.3, 14.0, 0.08, 0.125);
  float arcs = glultArc(r, a, GLULT_BASE + 0.035, uTime * 0.72 + uSeed, 5.0);
  arcs += glultArc(r, a, GLULT_BASE + 0.082, -uTime * 0.47 + uSeed * 0.4, 7.0) * 0.72;
  float sparks = exp(-abs(r - (GLULT_BASE + 0.115)) * 180.0) * pow(max(0.0, sin(a * 3.0 - uTime * 1.15)), 30.0);
  sparks += exp(-abs(r - (GLULT_BASE + 0.066)) * 190.0) * pow(max(0.0, sin(a * 2.0 + uTime * 0.83 + 1.7)), 34.0) * 0.75;
  float wavePhase = fract(uTime * 0.34 + fract(uSeed * 0.17));
  float wave = exp(-abs(r - (GLULT_BASE + 0.005 + wavePhase * 0.22)) * 125.0) * (1.0 - wavePhase) * 0.42;
  float bolts = glultBolt(uv, 0.12, 0.17) + glultBolt(uv, 2.24, 0.53) + glultBolt(uv, 4.37, 0.89);
  fx += vec3(arcs * 0.95 + sparks * 1.7 + wave + bolts * 3.0,
    arcs * 0.45 + sparks + bolts * 1.8, wave);
  return fx;
#else
  vec3 fx = glultFlame(uv, r, 7.0, 0.25, 13.0, 0.02, 0.075);
  float wavePhase = fract(uTime * 0.2 + fract(uSeed * 0.13));
  float wave = exp(-abs(r - (GLULT_EDGE + wavePhase * 0.16)) * 90.0) * (1.0 - wavePhase) * 0.5;
  return fx + vec3(wave, 0.0, wave);
#endif
}`,
  },

  arcane: {
    group: "mystic",
    color: "#c07dff",
    icon: "fa-solid fa-wand-sparkles",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float runes = glultArc(r, a, GLULT_BASE + 0.03, uTime * 0.6 + uSeed, 6.0)
    + glultArc(r, a, GLULT_BASE + 0.08, -uTime * 0.42 + uSeed * 0.4, 9.0) * 0.7;
#ifndef GLULT_SIMPLE
  runes += glultArc(r, a, GLULT_BASE + 0.125, uTime * 0.3 + 1.3, 12.0) * 0.5;
  float motes = glultMotes(uv, 4.0, GLULT_BASE + 0.1, 0.85, 2200.0);
#else
  float motes = glultMotes(uv, 2.0, GLULT_BASE + 0.09, 0.85, 2200.0);
#endif
  float sparkle = glultGlints(uv, 3.0, 2.7);
  float base = exp(-abs(r - GLULT_BASE) * 18.0) * 0.32 * glultBreathe(2.0);
  return vec3(base + runes * 1.2 + motes * 1.2 + sparkle * 1.3,
    sparkle + motes * 0.6, base + runes * 0.6);
}`,
  },

  /* ---------------------------- Physical ----------------------------- */

  bludgeoning: {
    group: "physical",
    color: "#d9b380",
    icon: "fa-solid fa-hammer",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float thump = glultPulse(2.4, 6.0);
  float shock = glultShock(r, 0.55, 0.0, 1.15);
#ifndef GLULT_SIMPLE
  shock += glultShock(r, 0.55, 0.5, 0.8);
  float cracks = glultCrystals(a, r, 7.0, 0.3, 0.17, 5.0);
#else
  float cracks = glultCrystals(a, r, 6.0, 0.3, 0.14, 5.0);
#endif
  float base = exp(-abs(r - GLULT_BASE) * 16.0) * (0.28 + thump * 0.38);
  return vec3(base + shock * 1.2 + cracks * (0.35 + thump * 0.75),
    shock * 0.7 + cracks * thump * 0.6, base + shock * 0.8);
}`,
  },

  piercing: {
    group: "physical",
    color: "#cdd8e6",
    icon: "fa-solid fa-crosshairs",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float tick = floor(uTime * 1.15 + uSeed);
  float jab = fract(uTime * 1.15 + uSeed);
  float thrust = 1.0 - smoothstep(0.0, 0.3, jab) * 0.55;
#ifdef GLULT_SIMPLE
  float needles = glultCrystals(a, r, 8.0, tick * 0.7, 0.19, tick);
#else
  float needles = glultCrystals(a, r, 11.0, tick * 0.7, 0.20, tick)
    + glultCrystals(a, r, 7.0, -tick * 0.5 + 0.3, 0.13, tick + 4.0) * 0.6;
#endif
  float base = exp(-abs(r - GLULT_BASE) * 21.0) * 0.3;
  return vec3(base + needles * (0.75 + thrust * 0.85),
    needles * thrust * 0.7, base + needles * 0.4);
}`,
  },

  slashing: {
    group: "physical",
    color: "#e8e4d8",
    icon: "fa-solid fa-sword",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float s1 = glultComet(a, r, GLULT_BASE + 0.03, 3.4, 0.0, 24.0);
  float s2 = glultComet(a, r, GLULT_BASE + 0.085, -2.6, 2.1, 28.0);
#ifndef GLULT_SIMPLE
  float s3 = glultComet(a, r, GLULT_BASE + 0.055, 4.3, 4.2, 34.0);
#else
  float s3 = 0.0;
#endif
  float slashes = s1 + s2 * 0.85 + s3 * 0.9;
  float base = exp(-abs(r - GLULT_BASE) * 20.0) * 0.3;
  return vec3(base + slashes * 2.1, slashes * 1.1, base + slashes * 0.5);
}`,
  },

  bleed: {
    group: "physical",
    color: "#d21f3c",
    icon: "fa-solid fa-droplet",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float beat = pow(0.5 + 0.5 * sin(uTime * 3.3 + uSeed), 8.0)
    + pow(0.5 + 0.5 * sin(uTime * 3.3 + uSeed - 1.1), 14.0) * 0.6;
  float base = exp(-abs(r - GLULT_BASE) * 16.0) * (0.32 + beat * 0.42);
#ifdef GLULT_SIMPLE
  float drips = glultDrips(uv, 7.0, 0.45);
#else
  float drips = glultDrips(uv, 10.0, 0.5);
  base += glultHaze(uv, r, 7.0, 0.04) * 0.4;
#endif
  return vec3(base + drips * 1.6, beat * 0.35 + drips * 0.45, base * 0.9 + drips * 0.9);
}`,
  },

  /* ----------------------------- Energy ------------------------------ */

  fire: {
    group: "energy",
    color: "#ff6b2e",
    icon: "fa-solid fa-fire-flame-curved",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  vec3 fx = glultFlame(uv, r, 8.0, 0.42, 13.0, 0.07, 0.16);
#ifndef GLULT_SIMPLE
  float embers = glultGlints(uv, 4.0, 3.2);
  fx += vec3(embers * 1.2 + glultShock(r, 0.3, 0.0, 0.35), embers * 0.9, 0.0);
#endif
  return fx;
}`,
  },

  cold: {
    group: "energy",
    color: "#9fdcff",
    icon: "fa-solid fa-snowflake",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
#ifdef GLULT_SIMPLE
  float shards = glultCrystals(a, r, 10.0, uTime * 0.14, 0.15, 3.0);
#else
  float shards = glultCrystals(a, r, 15.0, uTime * 0.11, 0.16, 3.0)
    + glultCrystals(a, r, 9.0, -uTime * 0.07 + 0.4, 0.10, 6.0) * 0.6;
#endif
  float sheen = exp(-abs(r - GLULT_BASE) * 17.0) * (0.3 + 0.08 * sin(uTime * 1.3 + uSeed));
  vec3 fx = vec3(shards * 1.15 + sheen, shards * 0.35, shards * 0.7 + sheen * 0.8);
#ifndef GLULT_SIMPLE
  float mist = glultHaze(uv, r, 8.0, 0.05) * 0.5;
  float sparkle = glultGlints(uv, 4.0, 2.4);
  fx += vec3(mist + sparkle * 1.5, sparkle, mist * 0.7);
#else
  float sparkle = glultGlints(uv, 2.0, 2.4);
  fx += vec3(sparkle * 1.4, sparkle, 0.0);
#endif
  return fx;
}`,
  },

  electricity: {
    group: "energy",
    color: "#ffe45e",
    icon: "fa-solid fa-bolt",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float bolts = glultBolt(uv, 0.12, 0.17) + glultBolt(uv, 2.24, 0.53) + glultBolt(uv, 4.37, 0.89);
#ifndef GLULT_SIMPLE
  bolts += glultBolt(uv, 1.31, 0.29) + glultBolt(uv, 3.45, 0.71);
#endif
  float arcs = glultArc(r, a, GLULT_BASE + 0.035, uTime * 0.72 + uSeed, 5.0)
    + glultArc(r, a, GLULT_BASE + 0.082, -uTime * 0.47 + uSeed * 0.4, 7.0) * 0.72;
  float strobe = 0.75 + 0.25 * step(0.55, glultHash(vec2(floor(uTime * 13.0), 3.0)));
  float base = exp(-abs(r - GLULT_BASE) * 19.0) * 0.34 * strobe;
  return vec3(bolts * 3.0 + arcs * 0.95 + base, bolts * 1.8 + arcs * 0.45, arcs * 0.4 + base);
}`,
  },

  acid: {
    group: "energy",
    color: "#a4e727",
    icon: "fa-solid fa-flask",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float base = exp(-abs(r - GLULT_BASE) * 15.0) * (0.34 + 0.06 * sin(uTime * 1.9 + uSeed));
  float bubbles = glultGlints(uv, 4.0, 2.8);
  float drips = glultDrips(uv, 8.0, 0.4);
  vec3 fx = vec3(base + bubbles * 1.25 + drips * 1.5,
    bubbles * 0.7 + drips * 0.4, base + drips * 0.8);
#ifndef GLULT_SIMPLE
  float fumes = glultHaze(uv, r, 9.0, 0.1) * 0.6;
  fx += vec3(fumes, 0.0, fumes * 0.8);
#endif
  return fx;
}`,
  },

  sonic: {
    group: "energy",
    color: "#b9a7ff",
    icon: "fa-solid fa-wave-square",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
#ifdef GLULT_SIMPLE
  float rings = glultRipples(r, 1.4, 3.0, 8.0);
  float form = glultWaveRing(a, r, 8.0, 13.0, 0.011, 95.0);
#else
  float rings = glultRipples(r, 1.4, 4.0, 9.0);
  float form = glultWaveRing(a, r, 8.0, 13.0, 0.013, 95.0)
    + glultWaveRing(a, r, 5.0, 17.0, 0.008, 120.0) * 0.6;
#endif
  float pump = 0.7 + 0.3 * pow(abs(sin(uTime * 3.1 + uSeed)), 3.0);
  float base = exp(-abs(r - GLULT_BASE) * 22.0) * 0.3;
  return vec3((rings * 1.15 + form * 1.25 + base) * pump,
    form * 0.55 * pump, rings * 0.85 + base);
}`,
  },

  force: {
    group: "energy",
    color: "#8fb0ff",
    icon: "fa-solid fa-atom",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float rot = uTime * 0.55 + uSeed;
  float facet = pow(abs(sin((a + rot) * 3.0)), 0.55);
  float frame = exp(-abs(r - (GLULT_BASE + 0.018 + facet * 0.026)) * 95.0);
  float pulse = 0.78 + 0.22 * sin(uTime * 2.1 + uSeed);
  float base = exp(-abs(r - GLULT_BASE) * 20.0) * 0.32;
  vec3 fx = vec3((frame * 1.5 + base) * pulse, frame * 0.5, base + frame * 0.6);
#ifndef GLULT_SIMPLE
  float facet2 = pow(abs(sin((a - rot * 0.7) * 2.0)), 0.5);
  float frame2 = exp(-abs(r - (GLULT_BASE + 0.075 + facet2 * 0.022)) * 85.0) * 0.7;
  fx += vec3(frame2 * pulse + glultShock(r, 0.4, 0.0, 0.4), frame2 * 0.3, frame2 * 0.4);
#endif
  return fx;
}`,
  },

  /* -------------------------- Essence & Mind ------------------------- */

  vitality: {
    group: "essence",
    color: "#ffe9a0",
    icon: "fa-solid fa-heart",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float rays = glultRays(a, r, 12.0, 0.4, 3.2, 0.16) * 0.85;
  float glow = exp(-abs(r - GLULT_BASE) * 13.0) * 0.42 * glultBreathe(1.8);
#ifdef GLULT_SIMPLE
  float motes = glultMotes(uv, 3.0, GLULT_BASE + 0.07, 0.7, 2000.0);
#else
  float motes = glultMotes(uv, 5.0, GLULT_BASE + 0.07, 0.7, 2000.0);
  rays += glultRays(a, r, 8.0, -0.28, 4.0, 0.11) * 0.5;
#endif
  return vec3(glow + rays + motes * 1.25, motes * 0.85 + rays * 0.3, glow + rays * 0.55);
}`,
  },

  void: {
    group: "essence",
    color: "#8a5cff",
    icon: "fa-solid fa-skull",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  vec3 tendrils = glultFlame(uv, r, -6.0, 0.14, 11.0, 0.05, 0.15) * 0.85;
  float collapse = glultRipples(r, -0.8, 2.0, 10.0) * 0.9;
#ifndef GLULT_SIMPLE
  collapse += glultRipples(r, -0.55, 3.0, 12.0) * 0.5;
  tendrils *= 0.85 + glultPulse(1.1, 10.0) * 0.5;
#endif
  return tendrils + vec3(collapse, 0.0, collapse * 0.6);
}`,
  },

  spirit: {
    group: "essence",
    color: "#b8ecff",
    icon: "fa-solid fa-ghost",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float wisps = glultGusts(uv, r, a, 0.9, 55.0);
  float glow = exp(-abs(r - GLULT_BASE) * 13.0) * 0.38 * glultBreathe(1.6);
  vec3 fx = vec3(glow + wisps * 1.3, wisps * 0.5, glow * 0.9 + wisps * 0.5);
#ifndef GLULT_SIMPLE
  float motes = glultMotes(uv, 3.0, GLULT_BASE + 0.085, -0.45, 2600.0);
  float veil = glultHaze(uv, r, 6.0, 0.08) * 0.45;
  fx += vec3(motes + veil, motes * 0.7, veil * 0.7);
#endif
  return fx;
}`,
  },

  mental: {
    group: "essence",
    color: "#f07ad4",
    icon: "fa-solid fa-brain",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float arms = glultSpiral(a, r, 2.0, 34.0, 2.4);
#ifndef GLULT_SIMPLE
  arms += glultSpiral(a, r, 3.0, -26.0, 1.8) * 0.65;
#endif
  float waves = glultRipples(r, 0.9, 2.0, 9.0) * 0.7;
  float base = exp(-abs(r - GLULT_BASE) * 18.0) * (0.3 + 0.1 * sin(uTime * 2.7 + uSeed));
  return vec3(base + arms * 1.35 + waves, arms * 0.6, base + arms * 0.7 + waves * 0.6);
}`,
  },

  poison: {
    group: "essence",
    color: "#6fdd57",
    icon: "fa-solid fa-skull-crossbones",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float throb = 0.75 + 0.25 * sin(uTime * 1.5 + uSeed);
  float base = exp(-abs(r - GLULT_BASE) * 14.0) * 0.34 * throb;
  float bubbles = glultGlints(uv, 3.0, 2.0) * 0.9;
#ifdef GLULT_SIMPLE
  float miasma = glultHaze(uv, r, 7.0, 0.09) * 0.55;
  float drips = 0.0;
#else
  float miasma = glultHaze(uv, r, 7.0, 0.09) * 0.75;
  float drips = glultDrips(uv, 7.0, 0.32);
#endif
  return vec3(base + miasma + bubbles * 1.1 + drips * 1.3,
    bubbles * 0.6 + drips * 0.35, base + miasma * 0.9 + drips * 0.7);
}`,
  },

  holy: {
    group: "essence",
    color: "#ffd76a",
    icon: "fa-solid fa-sun",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float rays = glultRays(a, r, 10.0, 0.22, 5.0, 0.2);
  float halo = exp(-abs(r - GLULT_BASE - 0.05) * 60.0) * (0.7 + 0.15 * sin(uTime * 1.4 + uSeed));
  float glow = exp(-abs(r - GLULT_BASE) * 14.0) * 0.4;
  vec3 fx = vec3(glow + rays * 1.1 + halo, halo * 0.55 + rays * 0.35, glow + rays * 0.6 + halo * 0.5);
#ifndef GLULT_SIMPLE
  float rays2 = glultRays(a, r, 16.0, -0.15, 5.0, 0.12) * 0.55;
  float sparkle = glultGlints(uv, 4.0, 2.1);
  fx += vec3(rays2 + sparkle * 1.4, sparkle, rays2 * 0.5);
#endif
  return fx;
}`,
  },

  unholy: {
    group: "essence",
    color: "#a12ce0",
    icon: "fa-solid fa-book-skull",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  vec3 fx = glultFlame(uv, r, -7.0, 0.2, 15.0, 0.04, 0.17) * vec3(0.95, 0.6, 0.95);
  float collapse = glultRipples(r, -0.6, 2.0, 11.0) * 0.6;
  fx += vec3(collapse, 0.0, collapse * 0.7);
#ifndef GLULT_SIMPLE
  float embers = glultGlints(uv, 3.0, 1.7);
  fx += vec3(embers * 1.1, embers * 0.8, 0.0);
#endif
  return fx;
}`,
  },

  /* ---------------------------- Elemental ---------------------------- */

  air: {
    group: "elemental",
    color: "#ccf2f4",
    icon: "fa-solid fa-wind",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float gusts = glultGusts(uv, r, a, 2.6, 85.0);
  float swirl = glultWaveRing(a, r, 4.0, 9.0, 0.014, 80.0) * 0.8;
  float base = exp(-abs(r - GLULT_BASE) * 21.0) * 0.26;
  vec3 fx = vec3(base + gusts * 1.7 + swirl, gusts * 0.7, base + swirl * 0.6);
#ifndef GLULT_SIMPLE
  fx.x += glultShock(r, 0.7, 0.3, 0.3);
#endif
  return fx;
}`,
  },

  earth: {
    group: "elemental",
    color: "#cd9254",
    icon: "fa-solid fa-mountain",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float tremor = glultPulse(1.9, 7.0);
#ifdef GLULT_SIMPLE
  float rocks = glultCrystals(a, r, 7.0, uTime * 0.09, 0.13, 2.0);
#else
  float rocks = glultCrystals(a, r, 9.0, uTime * 0.09, 0.15, 2.0)
    + glultCrystals(a, r, 6.0, -uTime * 0.05 + 0.5, 0.10, 8.0) * 0.6;
#endif
  float base = exp(-abs(r - GLULT_BASE) * 16.0) * (0.3 + tremor * 0.25);
  vec3 fx = vec3(base + rocks * 1.1, rocks * tremor * 0.5, base + rocks * 0.6);
#ifndef GLULT_SIMPLE
  float dust = glultHaze(uv, r, 6.0, 0.06) * 0.5;
  fx += vec3(dust + glultShock(r, 0.35, 0.0, 0.45) * tremor, 0.0, dust * 0.6);
#endif
  return fx;
}`,
  },

  water: {
    group: "elemental",
    color: "#59b6f0",
    icon: "fa-solid fa-water",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float waves = glultWaveRing(a, r, 3.0, 7.0, 0.02, 60.0);
#ifndef GLULT_SIMPLE
  waves += glultWaveRing(a, r, 5.0, 11.0, 0.012, 90.0) * 0.6;
  float drops = glultDrips(uv, 8.0, 0.36) * 0.9;
#else
  float drops = 0.0;
#endif
  float rings = glultRipples(r, 0.7, 2.0, 8.0) * 0.7;
  float flow = glultGusts(uv, r, a, 1.1, 50.0) * 0.8;
  float base = exp(-abs(r - GLULT_BASE) * 15.0) * 0.36 * glultBreathe(1.7);
  return vec3(base + waves * 1.3 + rings + flow + drops * 1.2,
    flow * 0.4 + waves * 0.35, base + waves * 0.8 + rings * 0.6);
}`,
  },

  metal: {
    group: "elemental",
    color: "#d9dee8",
    icon: "fa-solid fa-shield-halved",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
#ifdef GLULT_SIMPLE
  float blades = glultCrystals(a, r, 9.0, uTime * 0.5, 0.16, 4.0);
#else
  float blades = glultCrystals(a, r, 12.0, uTime * 0.5, 0.17, 4.0)
    + glultCrystals(a, r, 12.0, -uTime * 0.34 + 0.26, 0.11, 9.0) * 0.65;
#endif
  float glint = glultComet(a, r, GLULT_BASE + 0.045, 5.2, 0.0, 40.0) * 1.3;
  float sheen = exp(-abs(r - GLULT_BASE) * 19.0) * 0.32;
  vec3 fx = vec3(sheen + blades * 1.15 + glint * 1.6,
    glint * 1.2 + blades * 0.3, sheen + blades * 0.55);
#ifndef GLULT_SIMPLE
  float sparks = glultGlints(uv, 3.0, 3.5);
  fx += vec3(sparks * 1.3, sparks, 0.0);
#endif
  return fx;
}`,
  },

  wood: {
    group: "elemental",
    color: "#78c46a",
    icon: "fa-solid fa-leaf",
    glsl: `
vec3 glultEffect(vec2 uv, float r, float a) {
  float vines = glultSpiral(a, r, 3.0, 42.0, 0.8);
#ifndef GLULT_SIMPLE
  vines += glultSpiral(a, r, 2.0, -36.0, 0.6) * 0.7;
  float leaves = glultMotes(uv, 4.0, GLULT_BASE + 0.08, 0.5, 2400.0);
#else
  float leaves = glultMotes(uv, 2.0, GLULT_BASE + 0.08, 0.5, 2400.0);
#endif
  float base = exp(-abs(r - GLULT_BASE) * 15.0) * 0.34 * glultBreathe(1.5);
  return vec3(base + vines * 1.3 + leaves, leaves * 0.7 + vines * 0.3, base + vines * 0.75);
}`,
  },
});

export const EFFECT_IDS = new Set(Object.keys(EFFECTS));

/** Config-dialog optgroup order. */
export const EFFECT_GROUPS = ["mystic", "physical", "energy", "essence", "elemental"];

export function sanitizeEffect(value) {
  return EFFECT_IDS.has(value) ? value : DEFAULT_EFFECT;
}

/** GLSL body (helpers + glultEffect) for one effect. */
export function effectChunk(effectId) {
  return EFFECT_PRELUDE + (EFFECTS[sanitizeEffect(effectId)] ?? EFFECTS[DEFAULT_EFFECT]).glsl;
}
