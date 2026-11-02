/**
 * Weather FX — GLSL. Pure strings: no DOM, no WebGL, importable under Node.
 *
 * Every look is its own program, assembled by `fragmentShader(look)` from the
 * shared chunks below, so a host only pays for the weather it draws. Each one
 * is procedural: a particle is a hashed cell of a scrolling grid, a veil is
 * periodic noise, so there is no particle state on the CPU and nothing to
 * upload per frame beyond a dozen uniforms.
 *
 * Three rules hold for every program, and the check tool pins them:
 *
 *  • TIME IS A PHASE. `uPhase` runs 0→1 over the loop (looks.mjs
 *    LOOP_SECONDS) and every term that moves is `floor()`-ed to a whole number
 *    of turns of something periodic — a grid that repeats every PERIOD rows,
 *    noise whose lattice repeats on its period, a sine. So the frame at phase 1
 *    is the frame at phase 0 and nothing steps when the clock wraps.
 *  • HAIRLINES ARE DEVICE PIXELS. Anything meant to read as a line (rain, wind,
 *    the bolt's core) is sized against `uPx` and antialiased over one device
 *    pixel; a CSS-px width is a smear on a HiDPI screen and gone on a 1× one.
 *  • OUTPUT IS PREMULTIPLIED. The canvas is composited over the HUD's own dark
 *    glass with normal blending; colour is never written without its alpha.
 */

export const VERT = /* glsl */ `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Every uniform any program may declare. The host writes all of them on every
 *  draw; one a program does not read is optimised out and its location is null. */
export const UNIFORMS = Object.freeze([
  "uHost", "uSpan0", "uPx", "uPhase", "uI", "uTint", "uGlow", "uDir", "uSeed",
  "uShed", "uP", "uFlash", "uBolt", "uBoltA"
]);

const HEAD = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uHost;      // host size, CSS px
uniform float uSpan0;    // left edge of the drawn span, CSS px
uniform float uPx;       // device px per CSS px
uniform float uPhase;    // 0..1 through the idle loop
uniform float uI;        // intensity 0..1
uniform vec3 uTint;      // particle colour
uniform vec3 uGlow;      // glow / accent colour
uniform vec2 uDir;       // unit motion direction (y down); (0,0) = still
uniform float uSeed;     // per-host decorrelation
uniform vec4 uShed;      // x: depth layer on, y: haze on, z: motion on
uniform vec4 uP;         // look variant flags (looks.mjs)
out vec4 outColor;

#define TAU 6.28318530718
#define PERIOD 16.0

float hash1(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030) + uSeed * 0.0137);
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
vec2 hash2(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973) + uSeed * 0.0137);
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}

/* Value noise whose lattice repeats every 'per' cells. */
float vnoise(vec2 p, vec2 per) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash1(mod(i, per));
  float b = hash1(mod(i + vec2(1.0, 0.0), per));
  float c = hash1(mod(i + vec2(0.0, 1.0), per));
  float d = hash1(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
/* Periodic fbm, normalised to 0..1. */
float fbm(vec2 p, vec2 per, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int k = 0; k < 4; k++) {
    if (k >= oct) break;
    s += a * vnoise(p, per); n += a;
    p *= 2.0; per *= 2.0; a *= 0.5;
  }
  return s / n;
}

/* The fragment in host CSS px, y down. */
vec2 hostPx() {
  return vec2(uSpan0 + gl_FragCoord.x / uPx, uHost.y - gl_FragCoord.y / uPx);
}
/* One device pixel, in CSS px. */
float dpx() { return 1.0 / uPx; }

/* A whole number of turns of the loop. */
float turns(float k) { return floor(max(k, 0.0) + 0.5); }
/* sin() of a whole number of turns through the loop, offset by h. */
float wave(float k, float h) { return sin(TAU * (turns(k) * uPhase + h)); }

/* Premultiplied 'over': src on top of dst. */
vec4 over(vec4 src, vec4 dst) { return src + dst * (1.0 - src.a); }

/* The air the weather happens in: a vertical grade from 'top' to 'bot', alpha
   aTop → aBot, breathing through periodic noise that drifts with the wind on
   whole turns. Without it a field of particles reads as stars on glass. */
vec4 atmos(vec2 p, vec3 top, vec3 bot, float aTop, float aBot, float drift) {
  float H = max(uHost.y, 1.0);
  float y = clamp(p.y / H, 0.0, 1.0);
  float sx = uDir.x < 0.0 ? -1.0 : 1.0;
  vec2 s = vec2(p.x / (H * 2.4) - uPhase * turns(drift) * 8.0 * sx, y * 1.2 + 0.37);
  float n = uShed.y > 0.5 ? fbm(s, vec2(8.0, 64.0), 2) : 0.5;
  float a = mix(aTop, aBot, y) * (0.55 + 0.9 * n);
  return vec4(mix(top, bot, y) * a, a);
}
`;

/* A grid of particles scrolling along 'd'. Returns (alpha, tail 0..1, rnd, along)
   for the one particle whose cell holds the fragment. x' runs across the motion,
   y' along it; the grid repeats every PERIOD rows, and the scroll is a whole
   number of PERIODs per loop, so it is seamless.

   cell   — cell size (across, along), CSS px
   len    — streak length behind the head, CSS px (0 = a dot)
   rad    — half width / radius, CSS px; floored to half a device pixel
   speed  — whole turns of the PERIOD per loop
   dens   — fraction of cells holding a particle
   sway   — (amplitude in cells, whole turns per loop) of side-to-side drift
   soft   — 0 = a crisp antialiased edge, 1 = a soft glow falloff */
const FIELD = /* glsl */ `
vec2 fOff;     // the last field() particle: fragment offset from its head (across, along), CSS px
float fDist;   // and its distance to the particle's shape, CSS px
vec4 field(vec2 p, vec2 d, vec2 cell, float len, float rad, float speed, float dens, vec2 sway, float soft, float seed) {
  vec2 q = vec2(dot(p, vec2(-d.y, d.x)), dot(p, d)) / cell;
  q.y -= uPhase * turns(speed) * PERIOD;
  q.x += seed * 7.31;
  vec2 id = floor(q);
  vec2 f = fract(q);
  id.y = mod(id.y, PERIOD);
  vec2 h = hash2(id + seed * 13.7);
  fOff = vec2(1e5); fDist = 1e5;
  if (h.x > dens) return vec4(0.0);
  float h3 = hash1(id + 3.17 + seed);
  float r = max(rad, 0.5 * dpx());
  // keep the whole particle (its glow too) inside its own cell, or the cell
  // boundary clips it into a square
  float reach = r * (1.0 + 1.6 * soft) + dpx();
  vec2 m = min(vec2(reach) / cell + vec2(abs(sway.x), 0.0), vec2(0.45));
  float lenC = len / cell.y;
  float hx = mix(m.x, 1.0 - m.x, h.y) + sway.x * wave(sway.y, h3);
  float hy = mix(min(lenC + m.y, 0.95), max(1.0 - m.y, min(lenC + m.y, 0.95)), fract(h3 * 7.13));
  float dx = (f.x - hx) * cell.x;            // across, CSS px
  float s = (hy - f.y) * cell.y;             // behind the head, CSS px
  float dist, tail;
  if (s < 0.0) { dist = length(vec2(dx, s)); tail = 0.0; }
  else if (s > len) { dist = length(vec2(dx, s - len)); tail = 1.0; }
  else { dist = abs(dx); tail = len > 0.0 ? s / len : 0.0; }
  fOff = vec2(dx, -s); fDist = dist;
  float hard = clamp((r - dist) * uPx + 0.5, 0.0, 1.0);
  float glow = exp(-dist * dist / (r * r * 1.6));
  float a = mix(hard, glow, soft);
  if (len > 0.0) a *= pow(1.0 - tail, 1.4);
  return vec4(a, tail, h.x / max(dens, 1e-3), f.y);
}
`;

/* Distance (CSS px) from p to the forked bolt's segments; (-1,-1) breaks a run. */
const BOLT = /* glsl */ `
uniform vec2 uBolt[16];
uniform float uBoltA;
float boltDist(vec2 p) {
  float best = 1e5;
  for (int i = 0; i < 15; i++) {
    vec2 a = uBolt[i], b = uBolt[i + 1];
    if (a.x < 0.0 || b.x < 0.0) continue;
    vec2 pa = p - a, ba = b - a;
    float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
    best = min(best, length(pa - ba * t));
  }
  return best;
}
`;

/* Rain: three parallax sheets of device-pixel streaks, a sheet veil that rolls
   through heavy rain, and splashes ticking along the bottom edge. */
const RAIN = /* glsl */ `
vec4 rain(vec2 p, float heavy) {
  float I = uI;
  float drip = uP.x;
  // a low, wet sky: the glow colour above, the rain's own colour pooling below
  vec4 acc = atmos(p, uGlow * 0.8, mix(uGlow, uTint, 0.6), 0.18 + 0.16 * I, 0.10 + 0.14 * I, 1.0);
  if (uShed.y > 0.5) {
    // sheets: wide bands of denser rain rolling through with the wind
    vec2 s = vec2(p.x / 46.0 - uPhase * turns(3.0 + 3.0 * I) * 4.0 * sign(uDir.x + 1e-4), p.y / 120.0);
    float sheet = fbm(s, vec2(4.0, 64.0), 2);
    float v = smoothstep(0.42, 0.85, sheet) * (0.06 + 0.16 * I + 0.10 * heavy);
    acc = over(vec4(mix(uGlow, uTint, 0.55) * v, v), acc);
  }
  for (int L = 0; L < 3; L++) {
    if (L == 0 && uShed.x < 0.5) continue;
    float z = float(L) * 0.5;
    vec2 cell = vec2(mix(4.0, 10.0, z), mix(22.0, 46.0, z));
    float len = cell.y * mix(0.5, 0.72, z) * (0.6 + 0.5 * I) * (1.0 - 0.8 * drip);
    float rad = mix(0.3, 0.6, z) * (1.0 + 1.1 * drip);
    float speed = mix(7.0, 17.0, z) * (0.7 + 0.8 * I + 0.35 * heavy) * (1.0 - 0.7 * drip);
    float dens = mix(0.55, 0.72, z) * (0.5 + 0.7 * I);
    vec4 f = field(p, uDir, cell, len, rad, speed, dens, vec2(0.0), drip * 0.4, float(L) + 1.0);
    float a = f.x * mix(0.38, 0.92, z);
    // the head catches the light; drips carry a bead
    vec3 c = mix(uTint, vec3(1.0), (0.22 + 0.35 * drip) * (1.0 - f.y) * (0.4 + z));
    acc = over(vec4(c * a, a), acc);
  }
  if (uShed.y > 0.5) {
    // splashes: tiny crowns flaring on the bottom edge
    float yb = uHost.y - p.y;
    if (yb < 6.0) {
      float col = floor(p.x / 9.0);
      float h = hash1(vec2(col, 91.0));
      float t = fract(turns(28.0 + 20.0 * I) * uPhase + h);
      float cx = (col + 0.2 + 0.6 * hash1(vec2(col, 7.0))) * 9.0;
      float r = t * (2.5 + 2.5 * I);
      float ring = abs(length(vec2((p.x - cx) * 0.55, yb * 1.4)) - r);
      float sp = clamp(1.0 - ring * uPx, 0.0, 1.0) * (1.0 - t) * step(hash1(vec2(col, 3.0)), 0.35 + 0.5 * I);
      sp *= 0.55;
      acc = over(vec4(uTint * sp, sp), acc);
    }
  }
  return acc;
}
`;

/* Snow: soft flakes on three depths, swaying on whole turns; near flakes carry a
   bright core. Blizzard adds rushing whiteout bands; dust drops the core. */
const SNOW = /* glsl */ `
vec4 snow(vec2 p) {
  float I = uI;
  float dust = uP.y, white = uP.z;
  float rush = abs(uDir.x);
  // cold, still air: a pale haze settling toward the ground
  vec4 acc = atmos(p, uGlow * 0.7, mix(uGlow, uTint, 0.5), 0.06 + 0.10 * I, 0.14 + 0.16 * I, 1.0);
  if (uShed.y > 0.5 && white > 0.5) {
    // whiteout: bands of driven snow rushing through on whole turns
    vec2 s = vec2(p.x / 38.0 - uPhase * turns(10.0) * 4.0 * sign(uDir.x + 1e-4), p.y / 22.0);
    float w = fbm(s, vec2(4.0, 64.0), 3);
    float v = smoothstep(0.3, 0.85, w) * (0.16 + 0.30 * I);
    acc = over(vec4(mix(uGlow, uTint, 0.6) * v, v), acc);
  }
  for (int L = 0; L < 3; L++) {
    if (L == 0 && uShed.x < 0.5) continue;
    float z = float(L) * 0.5;
    vec2 cell = vec2(mix(8.0, 16.0, z));
    float rad = mix(0.6, 1.8, z) * (1.0 - 0.5 * dust);
    float speed = mix(1.0, 3.0, z) * (0.7 + 0.8 * I) * (1.0 + 2.5 * rush);
    float len = rad * 4.0 * rush * (0.4 + I);
    float dens = mix(0.6, 0.5, z) * (0.5 + 0.7 * I);
    vec4 f = field(p, uDir, cell, len, rad, speed, dens, vec2(0.16 * (1.0 - rush), 1.0 + float(L)), mix(0.75, 0.45, z), float(L) + 11.0);
    float a = f.x * mix(0.45, 1.0, z);
    // a near flake has a bright heart; dust and ash do not
    float core = (1.0 - dust) * z * exp(-fDist * fDist / max(rad * rad * 0.25, 1e-3));
    vec3 c = mix(uTint, vec3(1.0), 0.25 * z * (1.0 - dust) + 0.5 * core);
    acc = over(vec4(c * a, a), acc);
  }
  return acc;
}
`;

/* Hail: small, hard, fast pellets with a short smear; a meteor shower is the
   same field sparse and long, with a hot head and a glowing tail. */
const HAIL = /* glsl */ `
vec4 hail(vec2 p) {
  float I = uI, meteor = uP.x;
  // hail falls out of a hard, cold sky; meteors cross a deep night one
  vec4 acc = meteor > 0.5
    ? atmos(p, uGlow * 0.25, uGlow * 0.12, 0.10 + 0.10 * I, 0.02, 1.0)
    : atmos(p, uGlow * 0.7, mix(uGlow, uTint, 0.5), 0.14 + 0.12 * I, 0.08 + 0.10 * I, 2.0);
  for (int L = 0; L < 3; L++) {
    if (L == 0 && uShed.x < 0.5) continue;
    float z = float(L) * 0.5;
    vec2 cell = meteor > 0.5 ? vec2(mix(26.0, 46.0, z), mix(70.0, 120.0, z)) : vec2(mix(8.0, 14.0, z), mix(20.0, 34.0, z));
    float rad = meteor > 0.5 ? mix(0.5, 1.0, z) : mix(0.7, 1.45, z);
    float len = meteor > 0.5 ? cell.y * 0.7 : rad * mix(3.0, 6.0, z);
    float speed = meteor > 0.5 ? mix(3.0, 6.0, z) : mix(8.0, 16.0, z) * (0.7 + 0.6 * I);
    float dens = meteor > 0.5 ? mix(0.10, 0.16, z) * (0.6 + 0.6 * I) : mix(0.4, 0.55, z) * (0.5 + 0.7 * I);
    vec4 f = field(p, meteor > 0.5 ? normalize(uDir + vec2(0.9, 0.0)) : uDir, cell, len, rad, speed, dens, vec2(0.0), 0.0, float(L) + 21.0);
    float head = 1.0 - smoothstep(0.0, 0.18, f.y);
    float a = f.x * mix(0.45, 1.0, z);
    vec3 c = meteor > 0.5 ? mix(uGlow, mix(uTint, vec3(1.0), 0.6), head) : mix(uTint, vec3(1.0), 0.55 * head);
    acc = over(vec4(c * a, a), acc);
    if (meteor > 0.5) {
      // the head burns: a soft bloom around it in the glow colour
      float b = exp(-fDist * fDist / 9.0) * (1.0 - smoothstep(0.0, 0.08, f.y)) * 0.6 * step(0.0, f.x - 1e-4);
      acc = over(vec4(uGlow * b, b), acc);
    }
  }
  return acc;
}
`;

/* Fog: two layers of domain-warped periodic noise drifting on whole turns.
   Shadow creeps in from the edges, miasma hugs the floor and rises in wisps,
   clouds sharpen into a lit deck, arcane mist glints. */
const FOG = /* glsl */ `
vec4 fog(vec2 p) {
  float I = uI;
  float edge = uP.x, low = uP.y, cloud = uP.z, arcane = uP.w;
  float sx = uDir.x < 0.0 ? -1.0 : 1.0;
  float H = max(uHost.y, 1.0);
  vec2 s = vec2(p.x, p.y) / H * vec2(1.3, 1.3);
  // the veil the banks drift through; shadow is darkness, not haze
  vec4 acc = edge > 0.5 ? vec4(0.0) : atmos(p, mix(uGlow, uTint, 0.4), uTint, 0.10 + 0.12 * I, 0.14 + 0.16 * I, 1.0);
  for (int L = 0; L < 2; L++) {
    if (L == 0 && uShed.x < 0.5) continue;
    float z = float(L);
    vec2 per = vec2(8.0, 8.0);
    vec2 q = s * (1.0 + 0.6 * z) + vec2(z * 3.7, z * 1.9);
    q.x -= uPhase * turns(1.0 + z) * per.x * sx;
    q.y += low * uPhase * turns(1.0) * per.y;
    int oct = uShed.y > 0.5 ? 4 : 2;
    vec2 w = vec2(fbm(q + vec2(0.0, 4.1), per, 2), fbm(q + vec2(5.2, 1.3), per, 2));
    float n = fbm(q + (w - 0.5) * 0.85, per, oct);
    float lo = mix(0.32, 0.18, I) + 0.16 * cloud;
    float hi = lo + mix(0.62, 0.34, cloud);
    float dens = smoothstep(lo, hi, n);
    float yN = p.y / H;
    dens *= mix(1.0, smoothstep(-0.1, 0.85, yN), low);
    float ex = min(p.x / max(uHost.x, 1.0), 1.0 - p.x / max(uHost.x, 1.0));
    dens *= mix(1.0, 1.0 - smoothstep(0.0, 0.45, min(ex, min(yN, 1.0 - yN) * 0.6)), edge);
    float a = dens * mix(0.36, 0.6, z) * (0.5 + 0.6 * I) * (edge > 0.5 ? 2.2 : 1.0);
    // clouds are lit from above: lighter where the density is climbing
    float lit = cloud * smoothstep(0.0, 1.0, (fbm(q + vec2(0.0, -0.08), per, 2) - n) * 6.0 + 0.5);
    vec3 c = mix(uGlow, uTint, 0.45 + 0.4 * z + 0.3 * lit);
    if (edge > 0.5) c = uTint * 0.6;
    acc = over(vec4(c * a, a), acc);
  }
  if (arcane > 0.5) {
    vec2 cell = vec2(14.0);
    vec4 f = field(p, vec2(0.0, -1.0), cell, 0.0, 0.7, 1.0, 0.18, vec2(0.2, 2.0), 1.0, 41.0);
    float tw = 0.5 + 0.5 * wave(9.0, f.z);
    float a = f.x * tw * 0.8;
    acc = over(vec4(mix(uTint, vec3(1.0), 0.5) * a, a), acc);
  }
  return acc;
}
`;

/* Wind: long device-pixel streamlines along the wind, tapering at both ends.
   A sandstorm adds driven grit and an ochre haze; ripples are water lines. */
const WIND = /* glsl */ `
vec4 wind(vec2 p) {
  float I = uI, sand = uP.x, ripple = uP.y;
  vec4 acc = ripple > 0.5
    ? atmos(p, uGlow * 0.5, mix(uGlow, uTint, 0.5), 0.04, 0.16 + 0.16 * I, 1.0)
    : atmos(p, uGlow * 0.6, uGlow * 0.6, 0.06 + 0.08 * I, 0.06 + 0.08 * I, 4.0);
  if (uShed.y > 0.5 && ripple < 0.5) {
    // air in motion: long stretched bands racing with the wind; a sandstorm's
    // are thick with grit and carry its colour
    float sx = uDir.x < 0.0 ? -1.0 : 1.0;
    vec2 s = vec2(p.x / 70.0 - uPhase * turns(6.0 + 6.0 * I) * 4.0 * sx, p.y / (sand > 0.5 ? 20.0 : 7.0));
    float n = fbm(s, vec2(4.0, 64.0), 3);
    float v = mix(0.05 + 0.10 * I, 0.18 + 0.36 * I, sand) * smoothstep(0.3, 0.85, n);
    acc = over(vec4(mix(uGlow, uTint, 0.6 + 0.2 * sand) * v, v), acc);
  }
  for (int L = 0; L < 3; L++) {
    if (L == 0 && uShed.x < 0.5) continue;
    float z = float(L) * 0.5;
    if (ripple > 0.5) {
      // short horizontal lines rising, each a gentle crest
      vec2 cell = vec2(mix(22.0, 34.0, z), mix(12.0, 18.0, z));
      float half_ = cell.x * 0.32;
      vec4 f = field(p, vec2(0.0, -1.0), cell, 0.0, half_, mix(1.0, 2.0, z) * (0.6 + 0.8 * I), 0.5 * (0.5 + 0.7 * I), vec2(0.0), 0.0, float(L) + 51.0);
      // field() placed a disc; redraw it as a crest: a device-pixel arc across
      // the motion, bowed upward, tapering at both ends
      float on = fDist < 1e4 ? 1.0 : 0.0;
      float u = fOff.x / half_;
      float crest = abs(fOff.y + 2.2 * u * u);
      float a = on * clamp(1.0 - crest * uPx, 0.0, 1.0) * (1.0 - smoothstep(0.55, 1.0, abs(u))) * mix(0.3, 0.7, z);
      acc = over(vec4(mix(uTint, vec3(1.0), 0.2 * z) * a, a), acc);
      continue;
    }
    vec2 cell = vec2(mix(4.0, 7.0, z), mix(70.0, 140.0, z));
    float len = cell.y * mix(0.5, 0.72, z) * (0.6 + 0.5 * I);
    float speed = mix(4.0, 9.0, z) * (0.7 + 0.8 * I);
    vec4 f = field(p, uDir, cell, len, mix(0.3, 0.55, z), speed, mix(0.26, 0.4, z) * (0.6 + 0.6 * I), vec2(0.12, 2.0), 0.0, float(L) + 31.0);
    // taper the tail end as well, so a gust is a stroke, not a comet
    float a = f.x * smoothstep(0.0, 0.12, 1.0 - f.y) * mix(0.32, 0.85, z) * (1.0 - 0.45 * sand);
    vec3 c = mix(uTint, vec3(1.0), 0.2 * z);
    acc = over(vec4(c * a, a), acc);
  }
  if (sand > 0.5) {
    // grit: two depths of grains on cells of different, unrelated sizes, so no
    // lattice shows through at any density
    for (int L = 0; L < 2; L++) {
      float z = float(L);
      vec2 cell = mix(vec2(4.3, 11.7), vec2(7.9, 17.3), z);
      vec4 f = field(p, normalize(uDir + vec2(0.0, 0.14)), cell, mix(2.0, 5.0, z), mix(0.45, 0.8, z), mix(10.0, 18.0, z) * (0.7 + 0.6 * I), mix(0.22, 0.3, z) * (0.6 + 0.6 * I), vec2(0.0), 0.0, float(L) + 61.0);
      float a = f.x * mix(0.5, 0.9, z);
      acc = over(vec4(mix(uTint, vec3(1.0), 0.15 * z) * a, a), acc);
    }
  }
  return acc;
}
`;

/* Embers: glowing points rising on the heat, flickering on whole turns, with a
   breathing heat haze along the floor. Bubbles are rings; creep is slow rot. */
const EMBERS = /* glsl */ `
vec4 embers(vec2 p) {
  float I = uI, ring = uP.x, creep = uP.y;
  float H = max(uHost.y, 1.0);
  vec4 acc = ring > 0.5
    ? atmos(p, uGlow * 0.5, mix(uGlow, uTint, 0.4), 0.10 + 0.08 * I, 0.20 + 0.16 * I, 1.0)
    : vec4(0.0);
  if (uShed.y > 0.5 && ring < 0.5) {
    // the heat below: flame-licked glow climbing from the floor, breathing
    float breathe = 0.8 + 0.2 * wave(4.0, 0.0);
    vec2 s = vec2(p.x / 34.0, p.y / 22.0 + uPhase * turns(3.0) * 8.0);
    float n = fbm(s, vec2(16.0, 8.0), 3);
    float rise = smoothstep(0.05, 1.1, p.y / H + (n - 0.5) * 0.7);
    float floorGlow = rise * (0.16 + 0.30 * I) * breathe;
    vec3 c = creep > 0.5 ? mix(uGlow, uTint, 0.5) : mix(uGlow, uTint, rise * 0.6);
    acc = over(vec4(c * floorGlow, floorGlow), acc);
  }
  for (int L = 0; L < 3; L++) {
    if (L == 0 && uShed.x < 0.5) continue;
    float z = float(L) * 0.5;
    vec2 cell = vec2(mix(9.0, 16.0, z)) * (1.0 + 0.4 * creep);
    float rad = mix(0.7, 1.7, z) * (1.0 + 1.3 * ring + 0.7 * creep);
    float speed = mix(1.0, 3.0, z) * (0.6 + 0.9 * I) * (1.0 - 0.5 * creep);
    float dens = mix(0.5, 0.42, z) * (0.5 + 0.7 * I);
    vec4 f = field(p, uDir, cell, rad * 1.5 * (1.0 - ring), rad, speed, dens, vec2(0.18, 2.0 + float(L)), ring > 0.5 ? 0.0 : 0.8, float(L) + 71.0);
    float fl = 0.55 + 0.45 * wave(5.0 + 4.0 * float(L), f.z);
    float a;
    vec3 c;
    if (ring > 0.5) {
      // a bubble: a device-pixel ring with a glint at its upper left
      float t = max(0.5 * dpx(), rad * 0.16);
      float on = fDist < 1e4 ? 1.0 : 0.0;
      a = on * clamp((t - abs(fDist - rad * 0.8)) * uPx + 0.5, 0.0, 1.0) * mix(0.4, 0.85, z);
      float glint = on * exp(-dot(fOff + rad * 0.4, fOff + rad * 0.4) / (rad * rad * 0.08)) * 0.8;
      a = clamp(a + glint, 0.0, 1.0);
      c = mix(uTint, vec3(1.0), 0.3 + 0.5 * glint);
    } else {
      a = f.x * fl * mix(0.5, 1.0, z);
      c = mix(uTint, uGlow, step(0.66, f.z));
      c = mix(c, vec3(1.0), 0.35 * (1.0 - f.y) * z * (1.0 - creep));
    }
    acc = over(vec4(c * a, a), acc);
  }
  return acc;
}
`;

/* Motes: points hanging in the air, orbiting their cell on whole turns and
   twinkling. Modes (uP.x): 0 motes, 1 static, 2 swarm, 3 runes, 4 void, 5 spores. */
const MOTES = /* glsl */ `
float glyph(vec2 d, float r) {
  // a small diamond outline with a cross bar: reads as a rune at 6 px
  float dia = abs(abs(d.x) + abs(d.y) - r);
  float bar = max(abs(d.y) - r * 0.08, abs(d.x) - r * 0.55);
  return min(dia, max(bar, 0.0));
}
vec4 motes(vec2 p) {
  float I = uI, mode = uP.x;
  // a faint pool of the glow colour the motes hang in (swarms and static have none)
  bool pool = mode < 0.5 || mode > 4.5 || (mode > 2.5 && mode < 3.5);
  vec4 acc = pool ? atmos(p, uGlow * 0.6, uGlow, 0.05 + 0.06 * I, 0.10 + 0.12 * I, 1.0) : vec4(0.0);
  if (mode > 3.5 && mode < 4.5 && uShed.y > 0.5) {
    // void: a slow nebula behind the stars
    vec2 s = p / max(uHost.y, 1.0) * 1.4;
    s.x -= uPhase * turns(1.0) * 8.0;
    float n = fbm(s, vec2(8.0), 3);
    float v = smoothstep(0.45, 0.95, n) * (0.10 + 0.18 * I);
    acc = over(vec4(uGlow * v, v), acc);
  }
  if (mode > 0.5 && mode < 1.5) {
    // static: torn scan bands and a fizz of square speckle
    float band = step(0.82, hash1(vec2(floor(p.y / 3.0), floor(uPhase * turns(240.0)))));
    vec2 c = floor(p * uPx / 2.0);
    float sp = step(0.86 - 0.12 * I, hash1(c + floor(uPhase * turns(480.0)) * 17.0));
    float a = (sp * 0.55 + band * 0.18) * (0.4 + 0.6 * I);
    acc = over(vec4(mix(uTint, uGlow, band) * a, a), acc);
    return acc;
  }
  bool still = dot(uDir, uDir) < 0.01;
  vec2 d = still ? vec2(0.0, -1.0) : uDir;
  for (int L = 0; L < 3; L++) {
    if (L == 0 && uShed.x < 0.5) continue;
    float z = float(L) * 0.5;
    float scale = mode > 1.5 && mode < 2.5 ? 0.6 : (mode > 3.5 && mode < 4.5 ? 0.8 : 1.0);
    vec2 cell = vec2(mix(12.0, 20.0, z)) * scale;
    float rad = mode > 3.5 && mode < 4.5 ? mix(0.4, 0.8, z) : (mode > 4.5 ? mix(1.2, 2.4, z) : mix(0.8, 1.8, z));
    float speed = still ? 0.0 : mix(0.0, 1.0, z) + (mode > 1.5 && mode < 2.5 ? 2.0 : 0.0);
    float dens = (mode > 3.5 && mode < 4.5 ? 0.6 : mix(0.42, 0.34, z)) * (0.5 + 0.7 * I);
    vec2 sway = mode > 1.5 && mode < 2.5 ? vec2(0.2, 9.0 + 4.0 * float(L)) : vec2(0.14, 1.0 + float(L));
    vec4 f = field(p, d, cell, 0.0, rad * (mode > 2.5 && mode < 3.5 ? 3.2 : 1.0), speed, dens, sway, mode > 2.5 && mode < 3.5 ? 0.0 : 0.85, float(L) + 81.0);
    float tw = 0.5 + 0.5 * wave(mode > 3.5 && mode < 4.5 ? 5.0 + float(L) * 3.0 : 2.0 + float(L), f.z);
    float a;
    if (mode > 2.5 && mode < 3.5) {
      // runes: re-measure against the glyph instead of the disc
      float r = rad * 3.2;
      a = fDist < 1e4 ? clamp(1.0 - glyph(fOff, r) * uPx, 0.0, 1.0) : 0.0;
      a *= tw * mix(0.4, 0.9, z);
    } else {
      a = f.x * tw * mix(0.45, 1.0, z);
    }
    vec3 c = mode > 1.5 && mode < 2.5 ? uTint * 0.55 : mix(uTint, uGlow, step(0.66, f.z));
    if (mode > 3.5 && mode < 4.5) c = mix(c, vec3(1.0), 0.5 * z);
    acc = over(vec4(c * a, a), acc);
  }
  return acc;
}
`;

/* Aurora: curtains hanging from the top, rippling along the sky on whole turns,
   striated finely and graded from the tint at the hem to the glow above. */
const AURORA = /* glsl */ `
vec4 aurora(vec2 p) {
  float I = uI;
  float H = max(uHost.y, 1.0);
  vec2 s = vec2(p.x / (H * 1.3), 0.0);
  s.x -= uPhase * turns(2.0) * 8.0 * (uDir.x < 0.0 ? -1.0 : 1.0);
  float hem = 0.55 + 0.3 * fbm(vec2(s.x, 0.5), vec2(8.0, 4.0), 3);
  float y = p.y / H;
  // the curtain: brightest at its hem, fading up into the sky in long rays
  float body = smoothstep(hem + 0.04, hem - 0.85, y) * smoothstep(hem + 0.06, hem - 0.02, y);
  float edge = exp(-pow((y - hem) * 10.0, 2.0));
  float sx = uDir.x < 0.0 ? -1.0 : 1.0;
  float rays = vnoise(vec2(p.x / 3.0 - uPhase * turns(12.0) * 8.0 * sx, 0.5), vec2(8.0, 4.0));
  rays = 0.35 + 0.65 * smoothstep(0.2, 0.9, rays);
  float fold = 0.7 + 0.3 * vnoise(vec2(p.x / 22.0 + uPhase * turns(3.0) * 8.0 * sx, 1.5), vec2(8.0, 4.0));
  float a = (body * 0.8 * rays + edge * 0.6) * fold * (0.55 + 0.6 * I);
  vec3 c = mix(uTint, uGlow, smoothstep(hem - 0.1, hem - 1.2, y));
  vec4 acc = vec4(c * a, a);
  // a few stars behind
  vec4 f = field(p, vec2(0.0, -1.0), vec2(16.0), 0.0, 0.45, 0.0, 0.3, vec2(0.0), 0.6, 91.0);
  float st = f.x * (0.5 + 0.5 * wave(6.0, f.z)) * 0.7 * (1.0 - body);
  acc = over(acc, vec4(vec3(1.0) * st, st));
  return acc;
}
`;

/* Clear: slow shafts of light leaning in from the top corner, and a little dust
   turning in them. Quiet by design: clear is the weather that says nothing. */
const CLEAR = /* glsl */ `
vec4 clearSky(vec2 p) {
  float I = uI;
  float H = max(uHost.y, 1.0);
  vec2 n = normalize(vec2(1.0, 0.42));
  float v = dot(p, n) / (H * 0.9);
  float shafts = vnoise(vec2(v - uPhase * turns(2.0) * 8.0, 0.5), vec2(8.0, 4.0));
  shafts = smoothstep(0.45, 1.0, shafts);
  float fall = smoothstep(1.2, 0.0, p.y / H) * smoothstep(0.0, 0.25, p.y / H + 0.2);
  // the sun sits off the top-left corner: a warm bloom it spills from
  float sun = exp(-length((p - vec2(-H * 0.3, -H * 0.6)) / vec2(H * 5.5, H * 1.9)) * 1.7);
  float sa = sun * (0.34 + 0.36 * I) * (0.92 + 0.08 * wave(2.0, 0.0));
  vec4 acc = vec4(mix(uGlow, uTint, 0.5) * sa, sa);
  float a = shafts * fall * (0.16 + 0.26 * I) * (0.5 + 0.5 * sun);
  acc = over(vec4(mix(uTint, vec3(1.0), 0.35) * a, a), acc);
  vec4 f = field(p, vec2(0.0, -1.0), vec2(18.0), 0.0, 0.55, 1.0, 0.22, vec2(0.18, 1.0), 0.9, 101.0);
  float m = f.x * (0.4 + 0.6 * shafts) * (0.25 + 0.35 * I) * (0.5 + 0.5 * wave(3.0, f.z));
  acc = over(vec4(uTint * m, m), acc);
  return acc;
}
`;

/* Storm: rain under a cloud deck that only shows when lightning lights it from
   inside, and the forked bolt itself — a device-pixel core in a glow. */
const STORM = /* glsl */ `
uniform float uFlash;
vec4 storm(vec2 p) {
  vec4 acc = rain(p, 1.0);
  float H = max(uHost.y, 1.0);
  vec2 s = p / H * vec2(1.4, 1.8);
  s.x -= uPhase * turns(2.0) * 8.0 * (uDir.x < 0.0 ? -1.0 : 1.0);
  float n = fbm(s, vec2(8.0), uShed.y > 0.5 ? 4 : 2);
  float deck = smoothstep(0.35, 0.8, n) * smoothstep(0.85, 0.05, p.y / H);
  float lit = deck * (0.22 + 0.85 * uFlash) * (0.5 + 0.5 * uI);
  vec3 dc = mix(uTint * 0.45, uGlow, clamp(uFlash * 1.2, 0.0, 1.0));
  acc = over(acc, vec4(dc * lit, lit));
  float wash = uFlash * 0.08;
  acc = over(vec4(uGlow * wash, wash), acc);
  if (uBoltA > 0.0) {
    float dist = boltDist(p) * uPx;                 // device px
    float core = clamp(1.4 - dist, 0.0, 1.0);
    float halo = exp(-dist * dist / (36.0 * uPx * uPx)) * 0.55;
    float a = clamp(core + halo, 0.0, 1.0) * uBoltA;
    vec3 c = mix(uGlow, vec3(1.0), core);
    acc = over(vec4(c * a, a), acc);
  }
  return acc;
}
`;

const MAIN = {
  clear: "clearSky(p)",
  rain: "rain(p, 0.0)",
  storm: "storm(p)",
  snow: "snow(p)",
  hail: "hail(p)",
  fog: "fog(p)",
  wind: "wind(p)",
  embers: "embers(p)",
  motes: "motes(p)",
  aurora: "aurora(p)"
};

const CHUNKS = {
  clear: [FIELD, CLEAR],
  rain: [FIELD, RAIN],
  storm: [FIELD, RAIN, BOLT, STORM],
  snow: [FIELD, SNOW],
  hail: [FIELD, HAIL],
  fog: [FIELD, FOG],
  wind: [FIELD, WIND],
  embers: [FIELD, EMBERS],
  motes: [FIELD, MOTES],
  aurora: [FIELD, AURORA]
};

/** The full fragment source for one look. */
export function fragmentShader(look) {
  const body = CHUNKS[look] ?? CHUNKS.clear;
  const call = MAIN[look] ?? MAIN.clear;
  return `${HEAD}${body.join("\n")}
void main() {
  vec2 p = hostPx();
  vec4 c = ${call};
  outColor = clamp(c, 0.0, 1.0);
}
`;
}
