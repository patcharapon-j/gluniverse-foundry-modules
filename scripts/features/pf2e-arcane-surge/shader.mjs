/**
 * GLUniverse Suite — Arcane Surge GLSL.
 *
 * Two very different budgets share this file, and the difference is the whole
 * design:
 *
 *   AMBIENT runs for HOURS. It is deliberately cheap — two octaves of value
 *   noise and one domain warp, no Voronoi, no five-octave fbm. It is the mood of
 *   an unstable region, not an event, and it must cost almost nothing to be one.
 *
 *   BURST runs for 2.4 seconds and is expensive: a fracture field with a
 *   travelling shatter front. It is never run live. `burst.mjs` bakes it to a
 *   frame set once and blits the frames back, because `initiative`'s break
 *   splash already paid to learn that a full-screen procedural fracture per
 *   frame produces a visible hiccup — at exactly the moment you least want one.
 *
 * The uniform tables below are the contract `tools/arcane-surge-check.mjs`
 * enforces: every name must be declared in the GLSL AND written from the host.
 * A uniform that is declared and never written holds its initial value for the
 * life of the context, so the effect renders, just frozen, and nothing reports
 * it.
 *
 * Colour never appears here as a literal. The three ramp colours arrive as
 * uniforms from `theme.mjs`'s palette mirror, because WebGL cannot read a CSS
 * custom property and a hardcoded hue here would silently diverge from the
 * design system the rest of the feature follows.
 */

/** Shared by both programs: a full-screen triangle, no index buffer. */
export const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/* ══════════════════════════════════════════════════════════════════════
   Shared noise — two octaves, and that is the point
   ══════════════════════════════════════════════════════════════════════ */

const NOISE = `
float glasHash(vec2 p) {
  p = fract(p * vec2(127.31, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float glasNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = glasHash(i);
  float b = glasHash(i + vec2(1.0, 0.0));
  float c = glasHash(i + vec2(0.0, 1.0));
  float d = glasHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Two octaves. A third costs another full noise evaluation per pixel per frame
// for detail nobody reads through a 6% alpha veil.
float glasFbm2(vec2 p) {
  return 0.62 * glasNoise(p) + 0.31 * glasNoise(p * 2.07);
}
`;

/* ══════════════════════════════════════════════════════════════════════
   Ambient — the standing cost
   ══════════════════════════════════════════════════════════════════════ */

export const AMBIENT_FRAG = `
precision mediump float;
varying vec2 vUv;

uniform float uTime;
uniform vec2  uRes;
uniform float uChaos;   // 0 at Stable, 1 at Unraveling
uniform float uDrift;   // 1 = animating, 0 = shed (frozen at the settled frame)
uniform float uFade;    // mount/unmount envelope, 0..1
uniform vec3  uDeep;
uniform vec3  uMid;
uniform vec3  uHot;

${NOISE}

void main() {
  // Aspect-corrected so the field does not stretch on ultrawide displays.
  vec2 p = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);

  // When drift is shed the clock stops rather than the field vanishing: what
  // degrades under load is the motion, never the state.
  float t = uTime * uDrift;

  // One domain warp. The warp is what makes a cheap field read as "wrong"
  // rather than as "cloudy" — instability, not weather.
  vec2 q = p * (1.6 + 1.4 * uChaos);
  q += (0.18 + 0.42 * uChaos) * vec2(
    glasFbm2(q + vec2(t * 0.07, -t * 0.05)),
    glasFbm2(q * 1.13 - vec2(t * 0.06, t * 0.08))
  );

  float field = glasFbm2(q + vec2(0.0, t * 0.04));

  // Chaos sharpens the field's contrast as well as raising it: Fraying is a
  // haze, Unraveling has structure moving inside it.
  field = pow(clamp(field, 0.0, 1.0), mix(1.5, 0.75, uChaos));

  vec3 col = mix(uDeep, uMid, smoothstep(0.25, 0.72, field));
  col = mix(col, uHot, smoothstep(0.70, 0.98, field) * (0.25 + 0.75 * uChaos));

  // Pull the veil to the edges of the screen. The centre is where the play is;
  // a wash over the middle of the board fights the map for attention.
  float edge = length((vUv - 0.5) * vec2(1.15, 1.0));
  float vignette = smoothstep(0.28, 0.78, edge);

  // Scaled BY uChaos, not merely offset by it: at Stable the shader must be
  // exactly inert, not faintly on. The host does tear the overlay down at
  // Stable, but an invariant that only holds because of the code that avoids
  // calling it is not an invariant — and a cross-fade passes through chaos 0.
  float alpha = uChaos * (0.10 + 0.10 * uChaos) * vignette * uFade;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export const AMBIENT_UNIFORMS = Object.freeze([
  "uTime", "uRes", "uChaos", "uDrift", "uFade", "uDeep", "uMid", "uHot",
]);

/* ══════════════════════════════════════════════════════════════════════
   Burst — baked, never live
   ══════════════════════════════════════════════════════════════════════ */

export const BURST_FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;     // 0..1 across the baked frame set
uniform vec2  uRes;
uniform float uSeed;
uniform float uChaos;    // stability level, NOT severity — severity is rolled later
uniform vec3  uDeep;
uniform vec3  uMid;
uniform vec3  uHot;

${NOISE}

// F2 - F1 cellular edge. This is the expensive term and the reason the whole
// effect is baked rather than run live.
float glasVoroEdge(vec2 p) {
  vec2 n = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = vec2(glasHash(n + g), glasHash(n + g + 41.7));
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  }
  return f2 - f1;
}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
  float dist = length(p);
  float t = clamp(uTime, 0.0, 1.0);

  // The shatter front sweeps outward and the whole thing decays behind it.
  float front = clamp(t * 1.7, 0.0, 1.0);
  float decay = smoothstep(1.0, 0.45, t);

  // Warp the radial coordinate before cracking it, so the fracture wanders
  // instead of radiating like a starburst.
  vec2 w = p * 3.2;
  w += 0.35 * vec2(glasFbm2(w + uSeed), glasFbm2(w * 1.21 - uSeed));

  // Finer cells near the impact, coarser toward the edge.
  float cells = mix(17.0, 6.5, smoothstep(0.0, 1.0, dist));
  float edge = glasVoroEdge(w * cells * (0.6 + 0.4 * uChaos));

  // The crack line itself: a thin bright seam where two cells meet.
  float crack = 1.0 - smoothstep(0.0, 0.055 + 0.03 * (1.0 - uChaos), edge);
  // Only cracks the front has reached exist yet.
  crack *= smoothstep(front + 0.06, front - 0.20, dist);

  // A halo bleeding out of the seams, and a hot core at the impact.
  float halo = smoothstep(0.30, 0.0, edge) * 0.30;
  float core = smoothstep(0.42, 0.0, dist) * (0.35 + 0.45 * uChaos);

  vec3 col = mix(uDeep, uMid, halo * 2.2);
  col = mix(col, uHot, clamp(crack * 1.25 + core, 0.0, 1.0));
  // The brightest seams blow toward white so the fracture reads on any backdrop.
  col = mix(col, vec3(1.0), clamp(crack * crack * 0.85, 0.0, 1.0));

  float alpha = clamp(crack * 0.95 + halo * 0.55 + core * 0.5, 0.0, 1.0) * decay;
  alpha *= 0.55 + 0.45 * uChaos;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export const BURST_UNIFORMS = Object.freeze([
  "uTime", "uRes", "uSeed", "uChaos", "uDeep", "uMid", "uHot",
]);

/* ══════════════════════════════════════════════════════════════════════
   Blit — what actually runs during the burst
   ══════════════════════════════════════════════════════════════════════
   Playback is one textured triangle per frame. That is the entire per-frame
   cost of the burst, which is the point of baking it. */

export const BLIT_FRAG = `
precision mediump float;
varying vec2 vUv;

uniform sampler2D uFrame;
uniform float uOpacity;

void main() {
  vec4 texel = texture2D(uFrame, vUv);
  // The frames are stored premultiplied, so opacity scales the whole texel.
  gl_FragColor = texel * uOpacity;
}
`;

export const BLIT_UNIFORMS = Object.freeze(["uFrame", "uOpacity"]);

/** How many frames the burst bakes. 24 over 2.4s is a 10fps fracture, which
 *  reads as deliberate stop-motion rather than as a dropped frame rate. */
export const BURST_FRAMES = 24;

/** Baked frames are square and modest — they are stretched over the viewport,
 *  and a fracture is forgiving of that in a way a photograph would not be. */
export const BURST_FRAME_SIZE = 512;
