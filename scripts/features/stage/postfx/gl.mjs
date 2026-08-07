/**
 * Stage post-processing — the shading pass.
 *
 * One WebGL context for the whole feature, deliberately *not* Foundry's. A
 * cosmetic overlay has no business being able to corrupt renderer state the
 * scene draw depends on, and the isolation costs one context rather than one
 * per slot (browsers cap out around sixteen).
 *
 * Characters are rendered into this single shared canvas one at a time and the
 * result is copied into each slot's own 2D canvas. Rendering is event-driven —
 * it happens when the grade, the art, or the slot state actually changes, never
 * on a per-frame ticker.
 *
 * Raw WebGL rather than PIXI: this file then depends on nothing but the browser,
 * so it is immune to PIXI API churn across Foundry releases. `CampfireWebGL.js`
 * in stream-pacer sets the same precedent.
 */

import { loadPixelImage, markTainted } from "./asset.mjs";

const VERT = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

const FRAG = `
// highp where it exists. The shading ramp here is very smooth and very wide,
// which is exactly the case mediump's ~10-bit mantissa bands on.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform sampler2D u_art;      // the character art
uniform sampler2D u_nrm;      // rg = normal xy, b = thickness, a = alpha
uniform vec2      u_nrmSize;  // normal-map dimensions, for the smooth fetch

uniform vec3  u_ambient;      // scene ambient colour
uniform vec3  u_bounce;       // colour of light bounced back from the far side
uniform vec3  u_key;          // key light colour
uniform vec3  u_shadowColor;  // colour a dimmed character recedes toward
uniform float u_intensity;    // master strength, 0..1
uniform float u_rim;          // rim strength
uniform float u_rimEdge;      // absolute strength of the tight core (not scaled
                              // by u_rim — it is added past the dial's crossfade)
uniform float u_glow;         // light spilling past the outline, 0..1-ish
uniform float u_contour;      // interior contour highlight strength
uniform float u_spec;         // tight specular strength
uniform float u_sheen;        // broad specular lobe
uniform float u_exposure;     // darkness-derived exposure, already linear
uniform float u_night;        // scotopic desaturation, 0..1
uniform float u_shadow;       // dim amount, 0..1
uniform float u_lift;         // highlight boost, 0..1

// ── Light placement ──
// The key light is a point in the art's own space rather than one direction
// shared by the whole figure. On a full-body pose the head and the shins are a
// long way apart, and a lamp in the room does not shine on both from the same
// angle — the head should catch a rim the legs do not. Feeding a position makes
// that fall out per fragment instead of being faked.
uniform vec2  u_lightP;       // light position, aspect-corrected art space
uniform float u_lightZ;       // how far in front of the art plane it sits
uniform float u_refDist;      // light-to-figure-centre distance, for falloff
uniform vec2  u_uvScale;      // (artAspect, 1.0) — makes art space isotropic

// ── Framing ──
// Where the silhouette starts and ends vertically, and how much of a whole body
// that represents. A knee-up crop has no floor in frame, so it must not get a
// grounding shadow smeared across its bottom edge.
uniform float u_figTop;
uniform float u_figBottom;
uniform float u_ground;       // grounding shadow strength, 0..1

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Where the highlight roll-off starts. Below this the tone curve is the exact
// identity, so midtones keep whatever exposure the lighting model computed.
const float KNEE = 0.72;

// Colour vision falls away in the dark and what is left drifts blue (the
// Purkinje shift). Weighted against LUMA these sum to 1.0, so the tint recolours
// without also dimming — darkness already has u_exposure for that.
const vec3 NIGHT = vec3(0.88, 1.00, 1.32);

// ── sRGB ⇄ linear ──
// Every value sampled out of an image or a CSS colour is gamma-encoded, and the
// operations that matter here behave differently on encoded numbers: adding two
// lights saturates early, mixing two colours passes through a muddy midpoint,
// and clamping a highlight shifts its hue instead of rolling it off. So the pass
// works in linear light and encodes once, at the end.
//
// The one deliberate exception is the diffuse *multiplier* below. A multiplier
// is a ratio, and a ratio means the same thing in either space provided it is
// raised to the same power the values were — so it is converted rather than
// re-derived, which is what keeps the shading contrast exactly as it was tuned
// while everything genuinely additive moves to linear.
vec3 toLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
vec3 toSRGB(vec3 c) { return pow(max(c, 0.0), vec3(1.0 / 2.2)); }

// The normal field is prepassed small and stretched across a render several
// times its size. Plain bilinear is only C0, so on a shading ramp this smooth
// the texel lattice shows up as faint diamond creases. Smoothstepping the
// interpolant makes the reconstruction look C1 for four extra instructions.
// How far apart the contour taps sit, in uv. Expressed as a fraction of the
// frame rather than in texels so it means the same thing at any art resolution —
// and, more importantly, so it always straddles a drawn line rather than landing
// inside one. See the contour term in main().
const float CONTOUR_STEP = 0.004;

// Radius of the tight silhouette probe, in uv — see nearAlpha().
const float EDGE_RING = 0.004;

/**
 * How much of a small ring around this point is inside the figure.
 *
 * The prepass field cannot answer this. It is blurred deliberately wide, because
 * the job it was built for is inventing a *surface* — a rounded one, whose
 * shading ramp runs several percent of the frame. A rim core taken from it is a
 * soft band no matter how hard the exponent is raised, and a soft band is an
 * airbrushed edge, not a lit one.
 *
 * So the core gets its own measurement, from the art's own alpha at full render
 * resolution: eight taps on a ring, which is just a very small blur. Deep inside
 * it reads 1, on the outline it reads about a half, and a ring-radius out it
 * reads 0 — a distance field tight enough that what comes out of it is a line.
 */
float nearAlpha(vec2 uv, vec2 r) {
  vec2 d = r * 0.70710678;
  return 0.125 * (
      texture2D(u_art, uv + vec2( r.x, 0.0)).a
    + texture2D(u_art, uv + vec2(-r.x, 0.0)).a
    + texture2D(u_art, uv + vec2(0.0,  r.y)).a
    + texture2D(u_art, uv + vec2(0.0, -r.y)).a
    + texture2D(u_art, uv + vec2( d.x,  d.y)).a
    + texture2D(u_art, uv + vec2(-d.x,  d.y)).a
    + texture2D(u_art, uv + vec2( d.x, -d.y)).a
    + texture2D(u_art, uv + vec2(-d.x, -d.y)).a);
}

vec4 sampleField(vec2 uv) {
  vec2 p = uv * u_nrmSize - 0.5;
  vec2 i = floor(p);
  vec2 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return texture2D(u_nrm, (i + f + 0.5) / u_nrmSize);
}

void main() {
  vec4 art = texture2D(u_art, v_uv);
  vec4 nm = sampleField(v_uv);
  vec2 n2 = nm.rg * 2.0 - 1.0;
  float thick = nm.b;

  // Vector to the light from *this* point on the figure.
  vec3 toLight = vec3(u_lightP - v_uv * u_uvScale, u_lightZ);
  float dist = max(length(toLight), 0.0001);
  vec3 L = toLight / dist;

  // ── The rim's own light ──
  // A rim light is a light *behind* the subject. The key cannot be: it has to
  // sit in front or nothing would be diffusely lit at all. So the rim borrows
  // the key's bearing across the frame and throws its depth away.
  //
  // This is not a detail. With the full 3D key, u_lightZ dominates the dot
  // product — the light is roughly half a body-height in front of the art plane,
  // so almost every outward-facing normal scores the same — and the rim comes
  // out even the whole way round the outline. That reads as a sticker cut from
  // white paper, not as a backlight.
  vec2 lBearing = length(L.xy) > 1e-4 ? normalize(L.xy) : vec2(0.0, -1.0);

  // Wrapped rather than clipped at 90°: a rim that stops dead at the tangent
  // looks severed. This keeps a trace most of the way round and concentrates the
  // heat on the lamp's side.
  float facing = pow(max(dot(normalize(n2 + vec2(1e-6)), lBearing) * 0.5 + 0.5, 0.0), 2.2);

  // Isotropic in pixels: uv.x spans the width and uv.y the height, so a step in
  // x has to be divided by the aspect to cover the same distance.
  vec2 ring = vec2(EDGE_RING / max(u_uvScale.x, 0.0001), EDGE_RING);
  float tight = nearAlpha(v_uv, ring);

  // ── Outside the silhouette: the spill ──
  // What separates an edge that is *outlined* from one that is *lit* is that a
  // lit edge does not stop at the outline — light spills past it and blooms into
  // the air. That normally means an extra blur pass and a second render target.
  // It doesn't here: the normal-map prepass blurs the alpha channel, so the
  // field it hands over already extends a blur-radius beyond the silhouette,
  // already shaped like a falloff. This branch is that falloff, drawn.
  if (art.a <= 0.003) {
    // Two scales, which is what bloom is: a hot band hugging the outline, and a
    // wide soft halo behind it. The tight probe supplies the first, the prepass
    // field the second. Using only the wide one — the obvious thing, since it is
    // already there — spreads the spill into a fog bank with no edge in it.
    float hot = smoothstep(0.0, 0.5, tight);
    float wide = pow(smoothstep(0.0, 0.5, thick), 3.5);
    float reach = clamp(hot * 0.85 + wide * 0.4, 0.0, 1.0);
    float a = reach * facing * u_glow * u_intensity
            * mix(1.0, 0.22, u_shadow)     // a dimmed character does not glow
            * mix(0.4, 1.0, u_exposure)    // nor does one in a dark room, much
            * (1.0 + u_lift * 0.6);        // a spotlit one glows harder
    a = clamp(a, 0.0, 1.0);
    // Hot toward the outline, the lamp's colour further out — a blown highlight
    // loses its hue before it loses its brightness.
    gl_FragColor = vec4(mix(u_key, vec3(1.0), 0.6 * reach) * a, a);
    return;
  }

  // Invented surface: faces the viewer deep inside the silhouette, rolls away
  // toward the edges. Thin regions get a shallower Z so they catch more rim.
  vec3 N = normalize(vec3(n2, mix(0.35, 1.0, thick)));

  vec3 base = toLinear(art.rgb);
  vec3 keyL = toLinear(u_key);

  // Falloff normalised at the figure's centre, so overall exposure is unchanged
  // and only the gradient across the body is added. A distant light flattens to
  // 1.0 everywhere by itself — no special case needed.
  // Bounded: a light placed almost on top of the figure would otherwise blow
  // the near end out and crush the far one.
  float atten = clamp(u_refDist / dist, 0.65, 1.45);

  // Half-Lambert wrap blended with true Lambert: pure Lambert crushes the
  // unlit side to black, which looks wrong on stylised art.
  float ndl = dot(N, L);
  float lambert = max(ndl, 0.0);
  float wrapped = ndl * 0.5 + 0.5;
  float diffuse = mix(wrapped, lambert, 0.5) * atten;

  // Cheap occlusion — the silhouette edge sits slightly in its own shadow.
  float ao = mix(0.78, 1.0, thick);

  // Ambient is not one flat wash. Light that misses the key side arrives having
  // bounced off the room, and it arrives from the *other* side, carrying the
  // room's colour rather than the lamp's. That split is most of what separates a
  // figure that reads as lit from one that reads as tinted — and because the two
  // colours are luminance-matched it costs no exposure to add.
  float bounce = dot(N, normalize(vec3(-L.x, -L.y, 0.6))) * 0.5 + 0.5;
  vec3 amb = mix(u_ambient, u_bounce, bounce * 0.7) * ao;

  // ── Rim, in two lobes ──
  // Neither lobe alone is the effect. A wide falloff on its own is a soft wash
  // with no edge in it; a tight one on its own is a drawn outline with no light
  // in it. Together they are a hot core sitting inside a halo, which is what a
  // backlit edge actually looks like — and what every one of the reference
  // stills has in common.
  //
  // Both ride the same wrapped bearing as the spill, so the rim sweeps the parts
  // of the outline actually turned toward the lamp — the lit shoulder and jaw
  // under a high lamp, not the whole perimeter.
  // Both are normalised against the half of their ramp that is inside the figure.
  // A blurred step edge reads 0.5 *at* the outline and climbs to 1.0 going in, so
  // a bare 1.0 - thick tops out at 0.5 on the outermost real pixel — and any
  // exponent sharp enough to make a line out of it annihilates the term instead
  // (0.5 to the 11th is 0.0005). Rescaling so the outline reads 1.0 is what lets
  // a core exist at all.
  float edge = clamp((1.0 - thick) * 2.0, 0.0, 1.0);
  float edgeTight = clamp((1.0 - tight) * 2.0, 0.0, 1.0);
  float rimHalo = pow(edge, 3.5) * facing * atten;
  float rimCore = pow(edgeTight, 2.0) * facing * atten;

  // ── Interior contours ──
  // The alpha silhouette knows about exactly one edge: the outside one. Every
  // fold the art draws *inside* its own outline — a lapel over a shirt, a collar,
  // an arm crossing hair — is invisible to it, and gets no light off it at all.
  // The art's own luminance does know where those are, and which side of one
  // faces the lamp is just the sign of its gradient against L.
  //
  // The taps straddle a drawn line rather than landing inside it, which is what
  // makes this pick out form edges and not lineart: across a thin dark line both
  // neighbours sit on the light side and the difference cancels, while across a
  // garment edge it survives. Dotting with L unnormalised is deliberate too — it
  // fades the whole term out as the lamp swings head-on, where there is no side
  // for a contour to catch.
  vec2 tx = vec2(CONTOUR_STEP / max(u_uvScale.x, 0.0001), CONTOUR_STEP);
  vec2 grad = vec2(
    dot(texture2D(u_art, v_uv + vec2(tx.x, 0.0)).rgb, LUMA)
      - dot(texture2D(u_art, v_uv - vec2(tx.x, 0.0)).rgb, LUMA),
    dot(texture2D(u_art, v_uv + vec2(0.0, tx.y)).rgb, LUMA)
      - dot(texture2D(u_art, v_uv - vec2(0.0, tx.y)).rgb, LUMA)
  );
  float gradLen = max(length(grad), 1e-5);
  float contour = smoothstep(0.05, 0.4, gradLen) * max(dot(grad / gradLen, L.xy), 0.0)
                * thick * atten * u_contour;

  // ── Specular, two lobes as well ──
  // Both gated on thickness (never on the antialiased fringe) and on how bright
  // the art already is there: a highlight belongs on a pauldron or a cheekbone,
  // never on black cloth that would have swallowed it.
  vec3 H = normalize(L + vec3(0.0, 0.0, 1.0));
  float ndh = max(dot(N, H), 0.0);
  float gate = thick * atten * smoothstep(0.18, 0.7, dot(base, LUMA));
  float spec = pow(ndh, 28.0) * u_spec * gate;
  // The tight lobe alone puts a dot on a pauldron and nothing anywhere else. The
  // broad one is sheen — what separates satin from wool, and what gives hair its
  // band rather than a speck.
  float sheen = pow(ndh, 5.0) * u_sheen * gate;

  // The diffuse shading is a multiplier and is converted, not re-derived — see
  // the note on toLinear. Everything else here is light *arriving*, so it adds in
  // linear, where two highlights overlapping no longer pin at white.
  //
  // The core is not in here — see the note where it is added, below the dial.
  vec3 lit = base * toLinear(amb + u_key * diffuse)
           + keyL * (rimHalo * u_rim + spec + sheen + contour);

  // Grounding: light reaching the floor is blocked by the figure itself, so the
  // lowest part of a full body sits darker. Confined to the bottom of the
  // silhouette by the cube, and scaled to nothing when the feet are out of frame.
  float fy = clamp((v_uv.y - u_figTop) / max(u_figBottom - u_figTop, 0.0001), 0.0, 1.0);
  lit *= 1.0 - fy * fy * fy * u_ground;

  // Highlighted characters step forward into the light.
  lit *= (1.0 + u_lift * 0.9);

  // Scene darkness pulls exposure down for everyone, and deep darkness takes the
  // colour with it.
  lit *= u_exposure;
  lit = mix(lit, vec3(dot(lit, LUMA)) * NIGHT, u_night);

  // Dimmed characters recede into the room's shadow rather than fading out.
  float lum = dot(lit, LUMA);
  vec3 receded = mix(vec3(lum), toLinear(u_shadowColor), 0.55) * 0.45;
  lit = mix(lit, receded, u_shadow);

  // Shoulder, not a clip. Clamping each channel independently is what turns a
  // warm-lit face magenta at the highlight: red pins at 1.0 while green and blue
  // keep climbing. Rolling luminance and rescaling keeps the hue, and the last
  // step lets only the very top desaturate, the way film and sensors do.
  float l = max(dot(lit, LUMA), 0.0001);
  float over = max(l - KNEE, 0.0);
  float mapped = min(l, KNEE) + (1.0 - KNEE) * over / (over + (1.0 - KNEE));
  lit *= mapped / l;
  lit = mix(lit, vec3(mapped), smoothstep(KNEE, 1.0, mapped) * 0.45);

  // Encode first, then blend. u_intensity is a strength dial a GM drags, not a
  // light quantity: blending in linear makes the same slider position deliver
  // visibly less effect in a dark room than a bright one, because a linear
  // crossfade between a bright and a dark value re-encodes brighter than a
  // perceptual one. Blending after the encode also makes strength 0 exactly the
  // original pixels and strength 1 exactly the model, with nothing in between
  // that the dial does not account for.
  vec3 outc = mix(art.rgb, toSRGB(lit), u_intensity);

  // ── The edge core, added after the dial rather than inside it ──
  // Every other term crossfades with u_intensity, which is the right answer for
  // anything that *modifies* pixels: the dial mixes the original art back in.
  // It is the wrong answer for the rim, and the arithmetic is unforgiving —
  // mixing 40% of the flat art back over a lit edge caps the core at 0.72 over
  // dark art at the default strength, however hard it is driven. A rim that
  // cannot reach white is not a rim; it is a lighter edge.
  //
  // So the core scales with the dial instead of crossfading with it, exactly as
  // the outward spill already does. Zero is still exactly the original pixels,
  // which is the property that actually mattered.
  outc += mix(u_key, vec3(1.0), 0.72)
        * min(rimCore * u_rimEdge, 1.3)
        * u_intensity
        * mix(1.0, 0.25, u_shadow)
        * (1.0 + u_lift * 0.5);

  // The output is 8-bit and most of this image is a very slow ramp, which is the
  // one thing 8 bits cannot hold — the banding would be the most obvious artefact
  // in the whole effect. A sub-LSB dither costs three instructions and removes it
  // completely. (Interleaved gradient noise: no texture, no visible pattern.)
  // Scaled by intensity, because the ramp it is breaking up is: at strength zero
  // this pass must hand back the original pixels untouched, noise included.
  float d = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  outc = clamp(outc + (d - 0.5) * u_intensity / 255.0, 0.0, 1.0);

  // Premultiplied — the context is created with premultipliedAlpha.
  gl_FragColor = vec4(outc * art.a, art.a);
}
`;

/** Longest edge of the render target, before display scaling. Stage art shows at
 *  roughly 40vh, so this only has to beat the tallest viewport that will ever
 *  display it — but on a HiDPI panel that is twice the CSS height, and rendering
 *  below the display size is the one softness the effect cannot hide. */
const BASE_RENDER_DIM = 1280;

/** Hard ceiling. Nothing is gained past this and the upload cost is quadratic. */
const MAX_RENDER_DIM = 2048;

/** Art textures are GPU memory; bound the same way normal maps are. */
const TEXTURE_LIMIT = 24;

function renderDim() {
  const dpr = Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1));
  return Math.min(MAX_RENDER_DIM, Math.round(BASE_RENDER_DIM * dpr));
}

/**
 * Downscale oversized art *before* upload rather than letting the GPU do it at
 * sample time.
 *
 * WebGL1 can't mipmap a non-power-of-two texture, so minifying a 4000px portrait
 * into a 1280px render is a single bilinear tap — it samples 4 of every 9 source
 * pixels and drops the rest. On hair, lace and fine outlines that reads as
 * crawling aliasing. The browser's own resampler is a proper filter, and doing
 * it once at decode also cuts the texture to a fraction of the VRAM.
 */
async function fitForUpload(img, maxDim) {
  const nw = img.naturalWidth || 0;
  const nh = img.naturalHeight || 0;
  const scale = Math.min(1, maxDim / Math.max(nw, nh, 1));
  if (scale >= 1 || typeof createImageBitmap !== "function") {
    return { source: img, width: nw, height: nh, close: false };
  }
  const width = Math.max(1, Math.round(nw * scale));
  const height = Math.max(1, Math.round(nh * scale));
  try {
    const bitmap = await createImageBitmap(img, {
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: "high",
    });
    return { source: bitmap, width, height, close: true };
  } catch (_e) {
    // Older engines reject the resize options — upload the element as-is.
    return { source: img, width: nw, height: nh, close: false };
  }
}

export class StageGL {
  constructor() {
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = null;
    this._renderDim = BASE_RENDER_DIM;
    this._artTextures = new Map(); // src → { tex, width, height }
    this._nrmTextures = new Map(); // src → tex
    this._supported = null;
    this._lost = false;
    this._onLost = (event) => {
      event.preventDefault();
      this._lost = true;
      this._dropTextures();
    };
  }

  isSupported() {
    if (this._supported !== null) return this._supported;
    try {
      const probe = document.createElement("canvas");
      this._supported = !!(probe.getContext("webgl") || probe.getContext("experimental-webgl"));
    } catch (_e) {
      this._supported = false;
    }
    return this._supported;
  }

  /** Create the context on first real use — never at import or onReady, so a
   *  disabled or unopened stage costs nothing. */
  _ensureContext() {
    if (this.gl && !this._lost) return true;
    if (this._lost) this.destroy();
    if (!this.isSupported()) return false;

    const canvas = document.createElement("canvas");
    canvas.width = 2;
    canvas.height = 2;

    const opts = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: true, // we copy out with drawImage after each draw
    };
    const gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    if (!gl) return false;

    const program = this._buildProgram(gl, VERT, FRAG);
    if (!program) return false;

    canvas.addEventListener("webglcontextlost", this._onLost);

    gl.useProgram(program);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    // Single oversized triangle — no index buffer, no second vertex.
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, "a_pos");
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);

    this.canvas = canvas;
    this.gl = gl;
    this.program = program;
    this._lost = false;
    this._buffer = buffer;
    // Resolved once per context rather than per render, so the art textures and
    // the viewport can never be sized against different values.
    this._renderDim = renderDim();

    this.uniforms = {
      art: gl.getUniformLocation(program, "u_art"),
      nrm: gl.getUniformLocation(program, "u_nrm"),
      nrmSize: gl.getUniformLocation(program, "u_nrmSize"),
      ambient: gl.getUniformLocation(program, "u_ambient"),
      bounce: gl.getUniformLocation(program, "u_bounce"),
      key: gl.getUniformLocation(program, "u_key"),
      lightP: gl.getUniformLocation(program, "u_lightP"),
      lightZ: gl.getUniformLocation(program, "u_lightZ"),
      refDist: gl.getUniformLocation(program, "u_refDist"),
      uvScale: gl.getUniformLocation(program, "u_uvScale"),
      figTop: gl.getUniformLocation(program, "u_figTop"),
      figBottom: gl.getUniformLocation(program, "u_figBottom"),
      ground: gl.getUniformLocation(program, "u_ground"),
      shadowColor: gl.getUniformLocation(program, "u_shadowColor"),
      intensity: gl.getUniformLocation(program, "u_intensity"),
      rim: gl.getUniformLocation(program, "u_rim"),
      rimEdge: gl.getUniformLocation(program, "u_rimEdge"),
      glow: gl.getUniformLocation(program, "u_glow"),
      contour: gl.getUniformLocation(program, "u_contour"),
      spec: gl.getUniformLocation(program, "u_spec"),
      sheen: gl.getUniformLocation(program, "u_sheen"),
      exposure: gl.getUniformLocation(program, "u_exposure"),
      night: gl.getUniformLocation(program, "u_night"),
      shadow: gl.getUniformLocation(program, "u_shadow"),
      lift: gl.getUniformLocation(program, "u_lift"),
    };

    gl.uniform1i(this.uniforms.art, 0);
    gl.uniform1i(this.uniforms.nrm, 1);
    return true;
  }

  _buildProgram(gl, vsrc, fsrc) {
    const compile = (type, src) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        console.error("gluniverse | stage postfx shader compile failed:", gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
      }
      return shader;
    };

    const vs = compile(gl.VERTEX_SHADER, vsrc);
    if (!vs) return null;
    const fs = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!fs) {
      gl.deleteShader(vs);
      return null;
    }

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error("gluniverse | stage postfx program link failed:", gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }
    return program;
  }

  _touch(map, key) {
    const value = map.get(key);
    if (value === undefined) return undefined;
    map.delete(key);
    map.set(key, value);
    return value;
  }

  _evict(map, deleteTex) {
    while (map.size > TEXTURE_LIMIT) {
      const oldest = map.keys().next().value;
      const value = map.get(oldest);
      map.delete(oldest);
      deleteTex(value);
    }
  }

  /** Upload the character art. Uses the shared loader, so it reaches exactly the
   *  same verdict as the normal-map prepass — the two must never disagree about
   *  whether an asset is readable. */
  async _artTexture(src) {
    const cached = this._touch(this._artTextures, src);
    if (cached) return cached;

    const gl = this.gl;
    const img = await loadPixelImage(src);
    const fitted = await fitForUpload(img, this._renderDim);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fitted.source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (fitted.close) fitted.source.close();

    const entry = { tex, width: fitted.width, height: fitted.height };
    this._artTextures.set(src, entry);
    this._evict(this._artTextures, (v) => gl.deleteTexture(v.tex));
    return entry;
  }

  /** Upload a prepassed normal map. */
  _normalTexture(src, normal) {
    const cached = this._touch(this._nrmTextures, src);
    if (cached) return cached;

    const gl = this.gl;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      normal.width,
      normal.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(normal.data.buffer, normal.data.byteOffset, normal.data.length)
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this._nrmTextures.set(src, tex);
    this._evict(this._nrmTextures, (v) => gl.deleteTexture(v));
    return tex;
  }

  /**
   * Get everything one character needs onto the GPU.
   *
   * Split from {@link draw} deliberately. Uploading art is asynchronous — it may
   * still have to be fetched and decoded — and the draw target is shared by
   * every slot, so the two must not be one call: an `await` between a draw and
   * the copy-out is enough to hand one character's pixels to another. Everything
   * that can suspend lives here; everything that touches the shared canvas lives
   * in `draw`.
   *
   * @returns {Promise<object|null>} A handle for `draw`, or null when shading
   *                                 isn't possible.
   */
  async prepare(src, normal) {
    if (!normal || !src) return null;
    if (!this._ensureContext()) return null;

    let art;
    try {
      art = await this._artTexture(src);
    } catch (err) {
      // `texImage2D` rejects a tainted image the same way `getImageData` does.
      // Record it so the next render goes straight to the fallback.
      if (err?.name === "SecurityError") markTainted(src);
      return null;
    }
    // The context can be lost while the art texture is in flight.
    if (!this.gl || this._lost) return null;

    return {
      src,
      art,
      nrmTex: this._normalTexture(src, normal),
      nrmWidth: normal.width,
      nrmHeight: normal.height,
    };
  }

  /**
   * Shade one prepared character and return the shared canvas holding the
   * result. The caller must copy it out *before returning to the event loop* —
   * not merely before the next `draw`.
   *
   * Synchronous on purpose, and it has to stay that way. One canvas serves every
   * slot, so the only thing keeping one character's pixels out of another's slot
   * is that nothing else gets a turn between this draw and that copy. When this
   * work sat behind an `await`, adding a second actor to the stage repainted the
   * first one with the new actor's art: both slots drew into the shared canvas
   * before either copied out, and the last draw won twice.
   *
   * @returns {HTMLCanvasElement|null} null when shading isn't possible.
   */
  draw(prepared, params) {
    if (!prepared || !this.gl || this._lost) return null;

    const gl = this.gl;
    const { art, nrmTex } = prepared;

    const scale = Math.min(1, this._renderDim / Math.max(art.width, art.height, 1));
    const width = Math.max(1, Math.round(art.width * scale));
    const height = Math.max(1, Math.round(art.height * scale));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, art.tex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, nrmTex);

    const u = this.uniforms;
    gl.uniform2f(u.nrmSize, prepared.nrmWidth, prepared.nrmHeight);
    gl.uniform3fv(u.ambient, params.ambient);
    gl.uniform3fv(u.bounce, params.bounce);
    gl.uniform3fv(u.key, params.key);
    gl.uniform2fv(u.lightP, params.lightP);
    gl.uniform1f(u.lightZ, params.lightZ);
    gl.uniform1f(u.refDist, params.refDist);
    gl.uniform2fv(u.uvScale, params.uvScale);
    gl.uniform1f(u.figTop, params.figTop);
    gl.uniform1f(u.figBottom, params.figBottom);
    gl.uniform1f(u.ground, params.ground);
    gl.uniform3fv(u.shadowColor, params.shadowColor);
    gl.uniform1f(u.intensity, params.intensity);
    gl.uniform1f(u.rim, params.rim);
    gl.uniform1f(u.rimEdge, params.rimEdge);
    gl.uniform1f(u.glow, params.glow);
    gl.uniform1f(u.contour, params.contour);
    gl.uniform1f(u.spec, params.spec);
    gl.uniform1f(u.sheen, params.sheen);
    gl.uniform1f(u.exposure, params.exposure);
    gl.uniform1f(u.night, params.night);
    gl.uniform1f(u.shadow, params.shadow);
    gl.uniform1f(u.lift, params.lift);

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return this.canvas;
  }

  _dropTextures() {
    const gl = this.gl;
    if (gl) {
      for (const entry of this._artTextures.values()) gl.deleteTexture(entry.tex);
      for (const tex of this._nrmTextures.values()) gl.deleteTexture(tex);
    }
    this._artTextures.clear();
    this._nrmTextures.clear();
  }

  /** Drop one asset's GPU copies — used when an actor's image changes. */
  invalidate(src) {
    const gl = this.gl;
    const art = this._artTextures.get(src);
    if (art) {
      gl?.deleteTexture(art.tex);
      this._artTextures.delete(src);
    }
    const nrm = this._nrmTextures.get(src);
    if (nrm) {
      gl?.deleteTexture(nrm);
      this._nrmTextures.delete(src);
    }
  }

  /** Release the context. Without this a module reload leaks one per cycle. */
  destroy() {
    const gl = this.gl;
    this._dropTextures();
    if (gl) {
      if (this._buffer) gl.deleteBuffer(this._buffer);
      if (this.program) gl.deleteProgram(this.program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
    this.canvas?.removeEventListener("webglcontextlost", this._onLost);
    this.canvas = null;
    this.gl = null;
    this.program = null;
    this.uniforms = null;
    this._buffer = null;
    this._lost = false;
  }
}
