/**
 * GLUniverse Suite — Arcane Surge GLSL.
 *
 * Three programs, three budgets:
 *
 *   AMBIENT runs for HOURS. It hugs the edges of the screen and leaves the
 *   middle of the board alone. It is the mood of an unstable region — arcane
 *   instability, not weather — so it is built from a whirlpool warp and RIDGED
 *   noise, which produces thin bright filaments instead of the soft cloud a
 *   plain fbm gives you. Two noise octaves, one warp; the ridge is free.
 *
 *   BURST fires on a surge, live and full-screen. It is deliberately nothing
 *   like the suite's golden glass fracture: no Voronoi, no crack lines. This is
 *   a vortex tearing open — spiral arms, a collapsing ring, radial filaments
 *   whipping outward — in teal and blue. The word itself is DOM, not GLSL,
 *   because text in a fragment shader is a bitmap font problem nobody needs.
 *
 *   SEVERITY fires when the card resolves, and is different again: a verdict
 *   rather than an event. Concentric shock rings collapsing INWARD onto the
 *   centre, with the tier driving how many arrive and how hard they land.
 *
 * Colour never appears here as a literal. The ramp arrives as uniforms, derived
 * by `palette.mjs` from `theme.mjs`'s palette mirror, because WebGL cannot read
 * a CSS custom property.
 *
 * The uniform tables are the contract `tools/arcane-surge-check.mjs` enforces:
 * every name must be declared in the GLSL AND written from the host. A uniform
 * declared and never written holds its initial value for the life of the
 * context, so the effect renders, just wrong, and nothing reports it.
 */

/** Shared by every program: a full-screen triangle, no index buffer. */
export const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/* ══════════════════════════════════════════════════════════════════════
   Shared field helpers
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
// for detail nobody reads through a low-alpha veil.
float glasFbm2(vec2 p) {
  return 0.62 * glasNoise(p) + 0.31 * glasNoise(p * 2.07);
}

// Ridged: the fold at 0.5 turns smooth blobs into thin bright FILAMENTS. This
// one line is most of the difference between "arcane" and "haze", and it costs
// an abs and a subtract.
float glasRidge(vec2 p) {
  return 1.0 - abs(glasNoise(p) * 2.0 - 1.0);
}

float glasRidge2(vec2 p) {
  return 0.65 * glasRidge(p) + 0.35 * glasRidge(p * 2.11);
}

// Rotate by an angle that grows toward the centre: a whirlpool, not a spin.
vec2 glasSwirl(vec2 p, float amount) {
  float r = length(p);
  float a = amount / (r + 0.28);
  float s = sin(a);
  float c = cos(a);
  return vec2(p.x * c - p.y * s, p.x * s + p.y * c);
}
`;

/* ══════════════════════════════════════════════════════════════════════
   Ambient — the standing cost, and the edges of the world
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
  vec2 centred = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);

  // When drift is shed the clock stops rather than the field vanishing: what
  // degrades under load is the motion, never the state.
  float t = uTime * uDrift;

  /* THE EDGE MASK.
     Distance to the nearest screen edge, not radial distance — a radial
     falloff leaves the corners heavy and the middle of the long edges thin,
     which reads as a vignette rather than as something coming in from outside.
     This hugs all four edges evenly.

     The band has to stay NARROW. Widened past about a quarter of the short axis
     the four edges meet in the middle and the whole thing becomes a full-screen
     tint — which is a wash, not an encroachment, and it fights the map for the
     centre of the board where the play actually is. */
  vec2 fromEdge = min(vUv, 1.0 - vUv);
  float edge = min(fromEdge.x, fromEdge.y);
  float band = 1.0 - smoothstep(0.0, mix(0.11, 0.20, uChaos), edge);
  // Squared falloff: dense right at the frame, gone well before the centre.
  band = pow(band, 2.1);

  // Whirlpool: the field spirals around the screen's centre, so the filaments
  // at the edges are visibly being dragged around something.
  vec2 p = glasSwirl(centred, (0.35 + 0.95 * uChaos) * (0.6 + 0.4 * sin(t * 0.11)));
  p *= 1.5 + 1.3 * uChaos;
  p += (0.14 + 0.40 * uChaos) * vec2(
    glasFbm2(p + vec2(t * 0.09, -t * 0.06)),
    glasFbm2(p * 1.13 - vec2(t * 0.07, t * 0.10))
  );

  // Filaments rather than cloud. Chaos sharpens them as well as raising them.
  float fil = glasRidge2(p + vec2(0.0, t * 0.06));
  fil = pow(clamp(fil, 0.0, 1.0), mix(3.4, 1.5, uChaos));

  // A slower, softer bed underneath so the filaments have something to sit in.
  float bed = glasFbm2(p * 0.55 - vec2(t * 0.03, 0.0));

  float field = clamp(fil * 1.15 + bed * 0.35, 0.0, 1.0);

  vec3 col = mix(uDeep, uMid, smoothstep(0.10, 0.62, field));
  col = mix(col, uHot, smoothstep(0.55, 0.95, field) * (0.35 + 0.65 * uChaos));

  /* A slow breath so the edges never sit perfectly still — the world is not
     stable, and something that holds a fixed shape reads as decoration. */
  float breath = 0.88 + 0.12 * sin(t * 0.55);

  /* Multiplied by chaos, not offset by it, so Stable is exactly inert — the host
     also tears the overlay down there, but an invariant that only holds because
     of the code avoiding it is not an invariant, and a cross-fade passes through
     chaos 0. The ceiling is deliberately high enough to read as a threat
     through a bright map, and concentrated into a narrow band so it can be. */
  float alpha = uChaos * (0.16 + 0.30 * uChaos) * band * breath * uFade;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export const AMBIENT_UNIFORMS = Object.freeze([
  "uTime", "uRes", "uChaos", "uDrift", "uFade", "uDeep", "uMid", "uHot",
]);

/* ══════════════════════════════════════════════════════════════════════
   Burst — the surge itself, live
   ══════════════════════════════════════════════════════════════════════ */

export const BURST_FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;     // seconds since the burst began
uniform float uProgress; // 0..1 across the whole beat
uniform vec2  uRes;
uniform float uSeed;
uniform float uChaos;    // stability level, NOT severity
uniform vec3  uDeep;
uniform vec3  uMid;
uniform vec3  uHot;

${NOISE}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float t = uProgress;

  /* The beat: a hard snap in, then a long decay. The punch term is what makes
     it feel struck rather than faded up — it is at full height within the first
     6% of the duration. */
  float punch = smoothstep(0.0, 0.06, t);
  float decay = pow(1.0 - t, 1.7);
  float env = punch * decay;

  // Everything is dragged around the centre, harder early on.
  vec2 sp = glasSwirl(p, (2.6 + 1.4 * uChaos) * mix(1.0, 0.25, t));

  /* Spiral arms. The angle is offset by log(r) so the arms curve instead of
     radiating — that curve is what separates a whirlpool from a starburst. */
  float spiral = sin(a * 5.0 + log(r + 0.09) * 6.5 - uTime * 5.0 + uSeed * 6.28);
  spiral = pow(max(spiral, 0.0), 2.6);

  // Radial filaments whipping outward, thin and bright.
  float fil = glasRidge2(vec2(a * 2.4 + uSeed * 9.0, r * 5.5 - uTime * 2.2));
  fil = pow(fil, 3.2);

  /* The collapsing ring — a shock that races outward then thins. It reads as
     the moment of the surge, so it leads the whole effect. */
  float ringR = 0.10 + 1.35 * pow(t, 0.55);
  float ring = smoothstep(0.13, 0.0, abs(r - ringR)) * (1.0 - smoothstep(0.55, 1.0, t));

  // The eye of it: a hot core that flares and shrinks.
  float core = smoothstep(0.30 * (1.0 + 2.2 * t), 0.0, r);

  // Torn darkness just inside the ring, so the bright parts have a void behind
  // them rather than sitting on the map.
  float tear = smoothstep(0.0, 0.35, ringR - r) * (1.0 - smoothstep(0.7, 1.0, t));

  float energy = clamp(spiral * 0.55 + fil * 0.5, 0.0, 1.0);
  energy *= smoothstep(1.5, 0.15, r);

  vec3 col = mix(uDeep, uMid, clamp(energy * 1.3 + ring * 0.8, 0.0, 1.0));
  col = mix(col, uHot, clamp(ring * 1.1 + core * 1.4 + energy * energy * 0.7, 0.0, 1.0));
  // The brightest parts blow toward white so the burst reads on any backdrop.
  col = mix(col, vec3(1.0), clamp(core * 1.2 + ring * ring * 0.9, 0.0, 1.0));

  float alpha = clamp(energy * 0.72 + ring * 0.95 + core * 0.9 + tear * 0.42, 0.0, 1.0);
  alpha *= env * (0.72 + 0.28 * uChaos);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export const BURST_UNIFORMS = Object.freeze([
  "uTime", "uProgress", "uRes", "uSeed", "uChaos", "uDeep", "uMid", "uHot",
]);

/* ══════════════════════════════════════════════════════════════════════
   Severity — the verdict
   ══════════════════════════════════════════════════════════════════════
   Deliberately the opposite motion to the burst. The burst throws energy
   OUTWARD from a vortex; this collapses INWARD onto the centre in rings, so
   the two never read as the same effect played twice. */

export const SEVERITY_FRAG = `
precision highp float;
varying vec2 vUv;

uniform float uTime;
uniform float uProgress;
uniform vec2  uRes;
uniform float uTier;     // 0 minor … 3 breach
uniform vec3  uDeep;
uniform vec3  uMid;
uniform vec3  uHot;
uniform vec3  uVerdict;  // the tier's own hue, from the CSS tier tokens

${NOISE}

void main() {
  vec2 p = (vUv - 0.5) * vec2(uRes.x / max(uRes.y, 1.0), 1.0);
  float r = length(p);
  float a = atan(p.y, p.x);
  float t = uProgress;

  float punch = smoothstep(0.0, 0.05, t);
  float decay = pow(1.0 - t, 1.5);
  float env = punch * decay;

  // One ring per tier step, arriving in sequence and collapsing inward.
  float rings = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    if (fi > uTier) break;
    float delay = fi * 0.11;
    float rt = clamp((t - delay) / max(0.55 - fi * 0.06, 0.12), 0.0, 1.0);
    // Starts wide, closes on the centre.
    float rad = mix(1.5, 0.0, pow(rt, 0.75));
    rings += smoothstep(0.075, 0.0, abs(r - rad)) * (1.0 - rt);
  }

  // A rough edge on the rings so they read as force, not as UI.
  float grain = glasRidge2(vec2(a * 3.0, r * 6.0 - uTime * 1.4));
  rings *= 0.65 + 0.55 * grain;

  // The impact at the centre once the rings have arrived.
  float land = smoothstep(0.42, 0.0, r) * smoothstep(0.3, 0.62, t) * (1.0 - smoothstep(0.62, 1.0, t));

  // Higher tiers crack the whole frame with radial spikes.
  float spikes = pow(max(sin(a * (6.0 + uTier * 5.0)), 0.0), 9.0)
               * smoothstep(0.1, 1.1, r) * (uTier / 3.0);

  float energy = clamp(rings * 1.1 + land * 1.2 + spikes * 0.75, 0.0, 1.0);

  /* The bed is the arcane teal, not the tier's colour: the verdict is still the
     Sea doing this, and a ring made purely of the tier hue reads as a UI state
     rather than as the same magic that tore the screen a moment ago. The tier
     asserts itself in the body of the rings and at the impact. */
  vec3 col = mix(uDeep, uMid, clamp(energy * 0.9, 0.0, 1.0));
  col = mix(col, uVerdict, clamp(energy * 1.25 - 0.08, 0.0, 1.0));
  col = mix(col, uHot, clamp(land * 0.5, 0.0, 1.0));
  col = mix(col, vec3(1.0), clamp(land * land * 1.1 + rings * rings * 0.55, 0.0, 1.0));

  float alpha = clamp(energy, 0.0, 1.0) * env * mix(0.55, 1.0, uTier / 3.0);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export const SEVERITY_UNIFORMS = Object.freeze([
  "uTime", "uProgress", "uRes", "uTier", "uDeep", "uMid", "uHot", "uVerdict",
]);

/* ══════════════════════════════════════════════════════════════════════
   Timing
   ══════════════════════════════════════════════════════════════════════ */

/**
 * Downsample blit.
 *
 * Sampling a supersampled texture at final resolution with LINEAR filtering
 * lands exactly between four texels, which is a true box average. That is what
 * keeps the ring edges and the filaments from crawling — these fields are full
 * of thin high-contrast detail, which is the worst case for aliasing and the
 * reason both live passes render supersampled rather than direct.
 */
export const BLIT_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uFrame;
uniform float uOpacity;

void main() {
  // Stored premultiplied, so opacity scales the whole texel.
  gl_FragColor = texture2D(uFrame, vUv) * uOpacity;
}
`;

export const BLIT_UNIFORMS = Object.freeze(["uFrame", "uOpacity"]);

/** The burst is snappy on purpose: struck, held, gone. */
export const BURST_SECONDS = 1.8;
/** The verdict is shorter still — the GM is about to speak over it. */
export const SEVERITY_SECONDS = 1.2;
