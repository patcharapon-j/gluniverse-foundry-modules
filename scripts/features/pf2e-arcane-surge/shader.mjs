/**
 * GLUniverse Suite — Arcane Surge GLSL.
 *
 * Three programs, three budgets:
 *
 *   CRACK runs for HOURS, but only inside the stability chip — a strip a couple
 *   of dozen pixels tall in the time-tracker HUD. It is a fraying WEAVE, and
 *   deliberately not the suite's glass fracture: instability is the world
 *   coming apart, not one more thing being broken, and the two must not share
 *   a look. What rises with the stability level is how far the weave REACHES
 *   and how badly it has come apart — not how fine the threads are, because at
 *   this size finer is mush.
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

// Ridged: the fold at 0.5 turns smooth blobs into thin bright FILAMENTS. This
// one line is most of the difference between "arcane" and "haze", and it costs
// an abs and a subtract.
float glasRidge(vec2 p) {
  return 1.0 - abs(glasNoise(p) * 2.0 - 1.0);
}

float glasRidge2(vec2 p) {
  return 0.65 * glasRidge(p) + 0.35 * glasRidge(p * 2.11);
}
`;

/* There was a `glasSwirl(p, amount)` here that rotated a point by an angle
   growing toward the centre. It is gone, and not because the idea was wrong —
   it is exactly right, and the burst now does it inline as `shear`. It is gone
   because the burst was the only caller, it assigned the result to a local it
   then never sampled, and a helper whose one call site discards its return
   value is a helper that has quietly stopped existing. Doing it inline puts the
   shear next to the angles it shears. */

/* ══════════════════════════════════════════════════════════════════════
   Crack — the standing state, around the label that names it
   ══════════════════════════════════════════════════════════════════════
   This used to be a full-screen veil hugging the edges of the viewport. It is
   not any more, and the reason is worth keeping: a session-long layer over the
   board competes with the map for exactly the space the play happens in, and
   the only way to make it read as a threat was to make it loud enough to be in
   the way. The state belongs where the state is NAMED — a few pixels of weave
   fraying around the word "Unraveling" says the same thing, costs a
   thousandth of the fill rate, and never once sits between a GM and a token.

   It is deliberately NOT the suite's glass fracture (`core/fx-glsl.mjs`). It
   ran that field once, and a world coming apart then read as one more thing
   being broken: a broken creature's token, its initiative card and its health
   bar all carry that crack. Instability is its own picture — threads running
   through the label that loosen at Fraying, part at Unbound and snap into
   splayed fibres at Unraveling, which is the ladder's own vocabulary drawn. */

/**
 * One field unit, in CSS pixels. The weave's lane spacing, wobble and reach
 * are tuned in these units, and pinning the unit here keeps that look whatever
 * size the chip is laid out at. The host derives `uTexel` from it; nothing may
 * derive it from the canvas's own height again.
 */
export const CRACK_FIELD_PX = 42;

export const CRACK_FRAG = `
precision mediump float;
varying vec2 vUv;

uniform float uTime;
uniform vec2  uRes;
uniform float uChaos;   // 0 at Stable, 1 at Unraveling
uniform float uDrift;   // 1 = animating, 0 = shed (frozen in place)
uniform float uFade;    // level cross-fade envelope, 0..1
uniform float uSeed;    // per-world phase, so no two worlds fray identically
uniform float uTexel;   // one device pixel in field units — the hairline width
uniform vec3  uDeep;
uniform vec3  uMid;     // the LEVEL's own hue, matching the chip's marker
uniform vec3  uHot;

${NOISE}

void main() {
  /* Field space: isotropic, and at a FIXED scale — uTexel is one device pixel in
     field units, pinned by the host to CRACK_FIELD_PX rather than to the strip's
     own height. A non-uniform mapping bends every wave out of true; and a unit
     tied to the strip's height shrinks the weave with the chip, so the same
     pattern reads as crushed flat in a shorter slot. A smaller chip shows less
     of the weave, never a smaller one.

     CENTRED ON THE LABEL. Anchored at one end, the pattern's falloff leaves a
     splat over one end of the word and a dark tail at the other. */
  vec2 centre = 0.5 * uRes * uTexel;
  vec2 p = vUv * uRes * uTexel - centre;

  // When drift is shed the clock stops rather than the weave vanishing: what
  // degrades under load is the motion, never the state.
  float t = uTime * uDrift;

  // Bounded: glasHash multiplies its input by ~300, and a mediump context is
  // entitled to lose that in the fraction.
  float seed = fract(uSeed * 0.137) * 10.0;

  /* Chaos is spent on SPREAD and LOOSENESS, not on finer threads. The strip is
     a couple of dozen pixels tall: finer buys mush, while how far the weave
     reaches and how badly it has come apart are legible across the table.

     Reach is measured against HALF THE STRIP's long axis, so the ladder means
     the same thing on a chip that says "Fraying" and one that says
     "Unraveling" — which are visibly different widths. Both ends feather out:
     the canvas edge is four straight lines, and a thread cut by one reads as a
     clipped texture rather than something coming loose. */
  float span = centre.x;
  float reach = mix(0.50, 1.05, uChaos) * span;
  float spread = smoothstep(reach, reach * 0.55, abs(p.x));
  float feather = smoothstep(centre.y, centre.y - 0.12, abs(p.y));

  float strand = 0.0;
  float halo = 0.0;
  float flow = 0.0;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float lane = (fi - 1.5) * 0.085;

    /* LOOSENESS grows with chaos and toward the ends, so the weave stays
       tightest over the word and frays outward from it. */
    float amp = (0.012 + 0.09 * uChaos) * (0.35 + abs(p.x) / max(span, 0.001));
    float freq = 5.0 + fi * 1.9;
    float phase = p.x * freq + t * (0.5 + 0.2 * fi) + fi * 2.3 + seed;
    float y = lane + amp * sin(phase)
      + (glasNoise(vec2(p.x * 3.0 + t * 0.25, fi * 7.1 + seed)) * 2.0 - 1.0) * amp * 0.7;

    // Distance to the curve, not to its height: without the slope term a thread
    // thins to nothing on every steep stretch of its own wave.
    float slope = amp * freq * cos(phase);
    float norm = inversesqrt(1.0 + slope * slope);
    float off = abs(p.y - y);
    float d = off * norm;

    /* PARTING. Stretches of each thread go missing, more of them the worse the
       level; the gaps crawl slowly so the weave is visibly still giving way.
       Below zero at Stable-adjacent chaos, so Fraying barely parts at all. */
    float parted = mix(-0.05, 0.42, uChaos);
    float gap = smoothstep(parted + 0.05, parted - 0.05, glasNoise(vec2(p.x * 2.4 + t * 0.04, fi * 13.7 + seed)));
    float line = (1.0 - smoothstep(0.5 * uTexel, 1.5 * uTexel, d)) * (1.0 - gap);

    /* FIBRES. Where a thread parts it splits in two and the halves pull apart:
       |off - splay| is a pair of hairlines either side of the thread's path.
       gap * (1 - gap) peaks at the edges of each gap, so the fibres live at the
       torn ends and are gone by the middle of the hole. */
    float splay = gap * (0.03 + 0.05 * uChaos);
    float fibre = (1.0 - smoothstep(0.35 * uTexel, 1.1 * uTexel, abs(off - splay) * norm)) * gap * (1.0 - gap) * 4.0;

    // Over-under: a woven thread dips behind its neighbours at a regular beat.
    float weave = 0.7 + 0.3 * step(0.0, sin(p.x * 16.0 + fi * 3.14159));
    float thread = max(line * weave, fibre);

    strand = max(strand, thread);
    halo = max(halo, (1.0 - smoothstep(0.0, 0.045, d)) * (1.0 - gap) * 0.35);
    flow = max(flow, thread * pow(0.5 + 0.5 * sin(p.x * 8.0 - t * (1.8 + 0.35 * fi) + fi * 2.7), 8.0));
  }

  vec3 col = mix(uDeep, uMid, clamp(strand * 1.20 + halo * 0.75, 0.0, 1.0));
  col = mix(col, uHot, clamp(flow * 1.40, 0.0, 1.0));
  col = mix(col, vec3(1.0), clamp(flow * flow * 0.65, 0.0, 1.0));

  float body = clamp(strand * 1.30 + halo + flow * 0.65, 0.0, 1.0) * spread * feather;

  /* Multiplied by chaos, not offset by it, so Stable is exactly inert. The host
     also stops drawing there, but an invariant that only holds because the code
     avoids the case is not an invariant — and every level change cross-fades
     straight through chaos 0.

     The coefficient is deliberately above 1 at the top of the ladder: the first
     rung has to be VISIBLE on a bright HUD, and a scale that reaches Unraveling
     at a comfortable opacity leaves Fraying as a rumour. Clamped after, because
     the output is premultiplied and an alpha over 1 is not a colour. */
  float alpha = uChaos * (1.10 + 0.25 * uChaos) * uFade * body;
  alpha = min(alpha, 1.0);
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

export const CRACK_UNIFORMS = Object.freeze([
  "uTime", "uRes", "uChaos", "uDrift", "uFade", "uSeed", "uTexel", "uDeep", "uMid", "uHot",
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

  /* The beat: a hard snap in — full height inside the first 5% — then a long
     decay with a second flare partway down it. The re-flare is there because a
     single envelope means the whole back half of the beat is one picture
     dimming, and a picture dimming is what "static" actually looks like however
     much detail is in it. Two events read as something happening. */
  float punch = smoothstep(0.0, 0.05, t);
  float decay = pow(1.0 - t, 1.55);
  float reflare = exp(-pow((t - 0.34) * 6.0, 2.0)) * 0.45;
  float env = punch * decay * (1.0 + reflare);

  /* DIFFERENTIAL ROTATION, which is the whole of why this turns now.

     A vortex is not a picture on a turntable. Its inner radii come round far
     faster than its outer ones, and that SHEAR is the thing the eye reads as
     rotation — a field rotating rigidly at one rate is nearly indistinguishable
     from a still one, because there is no relative motion anywhere in it to
     see. This shader used to have neither: its one swirl was computed into a
     local and then never sampled, so the only motion in the whole pass was the
     arm phase drifting at about a radian a second.

     The falloff is Rankine-ish — near solid-body inside the eye, ~1/r² outside
     it — and the +0.14 is what keeps the centre finite rather than infinite. */
  float spin = uTime * (2.4 + 1.6 * uChaos);
  float shear = spin / (r * r + 0.14);
  float aIn = a + shear * 0.26;
  /* And the outer sheet turns the OTHER way, slowly. Two bodies moving against
     each other is what stops the far field reading as one flat spiral pinned to
     the screen, out where the shear above has almost nothing left to give. */
  float aOut = a - spin * 0.22;

  /* Spiral arms, two octaves. The angle carries log(r) so they curve instead of
     radiating — that curve is what separates a whirlpool from a starburst — and
     the second octave winds the opposite way and at its own rate, so the
     pattern shears against itself rather than repeating. */
  float arm1 = sin(aIn * 5.0 + log(r + 0.09) * 6.5 + uSeed * 6.28);
  float arm2 = sin(aIn * 8.0 - log(r + 0.05) * 9.5 - spin * 0.40 + uSeed * 2.4);
  float spiral = pow(max(arm1, 0.0), 2.4) * 0.62 + pow(max(arm2, 0.0), 3.6) * 0.38;

  // Filaments, advected outward AND carried round, so material visibly travels
  // rather than flickering in place.
  float fil = glasRidge2(vec2(aIn * 2.4 + uSeed * 9.0, r * 5.5 - uTime * 2.6));
  fil = pow(fil, 3.0);

  /* Debris riding the counter-turning sheet: fine, hard-edged and quick. It is
     the only term here that reads as a THING being carried rather than as a
     field evolving, which is what sells the rotation at the outer radii, where
     the shear above has almost nothing left to give.

     Cut with a smoothstep on the ridge CREST rather than raised to a power. A
     ridged field is already a fold, so pow() keeps a broad plateau either side
     of the crest and the result is fat cells — foam, not debris. The narrow
     smoothstep takes the crest alone, which is what makes these shards. The
     frequencies are high for the same reason: this is the finest thing in the
     pass and the supersampler above exists to carry exactly this. */
  float grit = glasRidge2(vec2(aOut * 13.0, r * 19.0 - uTime * 1.6));
  grit = smoothstep(0.80, 0.99, grit) * smoothstep(0.10, 0.45, r) * (1.0 - smoothstep(0.95, 1.5, r));

  /* The shock ring — a front that races outward then thins, and the thing that
     reads as the moment of the surge. Lobed, and the lobes turn: a perfect
     circle is rotation-invariant, so it can spin at any speed and look
     identical, which quietly exempted the single largest shape on screen from
     everything above. */
  float lobe = 0.030 * sin(a * 3.0 - spin * 0.70 + uSeed * 6.28)
             + 0.014 * sin(a * 7.0 + spin * 1.10);
  float ringR = 0.10 + 1.35 * pow(t, 0.55) + lobe * (1.0 - t);
  float ring = smoothstep(0.13, 0.0, abs(r - ringR)) * (1.0 - smoothstep(0.55, 1.0, t));

  // The eye: a hot core that flares and shrinks, with a knot orbiting inside it
  // — an off-centre bright that the core alone, being radially symmetric, could
  // never provide.
  float core = smoothstep(0.30 * (1.0 + 2.2 * t), 0.0, r);
  float knot = smoothstep(0.085, 0.0, length(p - 0.11 * vec2(cos(spin * 1.1), sin(spin * 1.1))));

  // Torn darkness just inside the ring, so the bright parts have a void behind
  // them rather than sitting on the map.
  float tear = smoothstep(0.0, 0.35, ringR - r) * (1.0 - smoothstep(0.7, 1.0, t));

  float energy = clamp(spiral * 0.55 + fil * 0.46 + grit * 0.50, 0.0, 1.0);
  energy *= smoothstep(1.5, 0.15, r);

  vec3 col = mix(uDeep, uMid, clamp(energy * 1.3 + ring * 0.8, 0.0, 1.0));
  col = mix(col, uHot, clamp(ring * 1.1 + core * 1.4 + knot * 1.0 + energy * energy * 0.7, 0.0, 1.0));
  /* The brightest parts blow toward white so the burst reads on any backdrop —
     but only just. Pushed harder, the core and the knot merge into one white
     disc that swallows the arms turning inside it, and the effect gets brighter
     and less legible at the same time. The white is a highlight on the vortex,
     not the vortex. */
  col = mix(col, vec3(1.0), clamp(core * 0.95 + knot * 0.6 + ring * ring * 0.9, 0.0, 1.0));

  float alpha = clamp(energy * 0.72 + ring * 0.95 + core * 0.9 + knot * 0.55 + tear * 0.42, 0.0, 1.0);
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
