/**
 * Stage — GLSL.
 *
 * Pure strings. Six programs share one unit quad, drawn in this order:
 *
 *   backdrop  the room: the scene's picture with its depth of field and bloom,
 *             pushed in by the close-up
 *   screen    the floor shade under the cast (and, last, vignette + letterbox)
 *   shadow    a character's shadow on the floor, thrown toward the camera
 *   figure    a character, composited into the room: pulled into its colour,
 *             level and black point, rimmed by its lights, outlined in light,
 *             wrapped in its bloom, its own highlights diffused
 *   veil      over everything, screen-blended: the room's bloom veiling the cast
 *   grain     film grain, as a 2× modulate so it darkens as well as lightens
 *
 * The look is a compositor's ("satsuei"), not a renderer's: the picture is a
 * painting, the cast is cel art in front of it, and every effect here is one a
 * compositor would lay on by hand to make the two one image.
 *
 * Space: CSS pixels, origin top-left, y down, for every position uniform. The
 * vertex shaders take a rect and the camera and do the rest. Shading space is
 * x right, y UP, z toward the camera.
 *
 * Every uniform a program declares is listed in UNIFORMS, and the renderer
 * writes each of them every draw; `tools/stage-check.mjs` holds the three in
 * agreement, because a uniform declared and never written silently keeps
 * whatever the driver started it at.
 */

const HEADER = `#version 300 es
precision highp float;
`;

/** Camera: screen = (p - focus) * zoom + view centre. */
const CAMERA = `
uniform vec2 uView;      // viewport, css px
uniform vec3 uCamera;    // focus.x, focus.y, zoom
vec2 toScreen(vec2 p) { return (p - uCamera.xy) * uCamera.z + uView * 0.5; }
vec4 toClip(vec2 s) { vec2 c = s / uView * 2.0 - 1.0; return vec4(c.x, -c.y, 0.0, 1.0); }
`;

const COLOR = `
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 toLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
vec3 toSRGB(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
`;

/* ── figure ─────────────────────────────────────────────────────────── */

export const FIGURE_VS = HEADER + CAMERA + `
in vec2 aPos;
uniform vec4 uRect;      // padded quad: x, y (top-left), w, h — world px
uniform vec4 uMotion;    // dx, dy (px), rotation (rad), breath (scaleY - 1)
uniform float uFlipX;    // +1 or -1: mirror about the quad's centre
out vec2 vUV;            // 0..1 over the padded quad, y down, ALREADY mirrored
out vec2 vScreen;        // css px
void main() {
  vUV = vec2(uFlipX < 0.0 ? 1.0 - aPos.x : aPos.x, aPos.y);
  // Pivot at the feet: breath and rotation hinge where the figure stands.
  vec2 pivot = vec2(uRect.x + uRect.z * 0.5, uRect.y + uRect.w);
  vec2 local = uRect.xy + aPos * uRect.zw - pivot;
  local.y *= 1.0 + uMotion.w;
  float c = cos(uMotion.z), s = sin(uMotion.z);
  local = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 world = pivot + local + uMotion.xy;
  vScreen = toScreen(world);
  gl_Position = toClip(vScreen);
}`;



export const FIGURE_FS = HEADER + COLOR + `
in vec2 vUV;
in vec2 vScreen;
out vec4 outColor;

uniform sampler2D uArt;
uniform sampler2D uShape;   // r edge blur (edges continued), g body blur, b soft blur, a alpha
uniform sampler2D uEnv;     // the backdrop, very soft
uniform sampler2D uGlow;    // the backdrop's bloom, linear light encoded as sRGB
uniform sampler2D uEnvB;    // the room being left, while the backdrop cross-fades
uniform sampler2D uGlowB;
uniform vec2 uPad;          // padding as uv fraction of the quad, each side
uniform vec2 uShapeTexel;   // 1 / shape size
uniform float uFlipX;
uniform vec2 uView;
uniform vec4 uEnvMap;       // screen px → picture uv: scale.xy, offset.xy
uniform vec4 uEnvMapB;      // the same for the room being left
uniform float uEnvMix;      // how much of the room being left still lights the cast (0 = none)
uniform float uBaseLod;     // the art texture's mip for its size on screen
uniform float uLod;         // extra blur: the focus pull and depth
uniform float uDiffLod;     // the mip the diffusion reads
uniform vec2 uArtPx;        // the (unpadded) art's size on screen, css px
uniform float uStrokePx;    // the outline's width, css px

// figure state
uniform float uAlpha;
uniform float uDim;         // 0 lit, 1 out of focus
uniform float uDepth;       // 0 front, 1 upstage
uniform float uLit;         // 1 when this one is in focus (speaking)

// the rig
uniform float uStrength;
uniform float uLevel;
uniform float uShoulder;
uniform float uContrast;   // log-contrast about mid grey (0 = none)
uniform float uSaturation;
uniform vec3 uTintShadow;
uniform vec3 uTint;
uniform vec3 uTintHigh;
uniform vec3 uLift;
uniform vec3 uSky;
uniform vec3 uGround;
uniform float uEnvAmt;
uniform float uRoomLum;
uniform vec3 uKeyDir;
uniform vec3 uKeyColor;
uniform float uKey;
uniform vec2 uRimPos[2];    // in picture uv
uniform vec3 uRimColor[2];
uniform float uRimPower[2];
uniform float uStroke;
uniform vec3 uStrokeColor;
uniform float uStrokeFloor; // how much of the outline survives on the side facing away from every light
uniform float uRimGlow;     // the rim light's bloom outside the edge and its spill onto it
uniform float uHalo;
uniform vec3 uHaloColor;
uniform float uDiffusion;
uniform float uWrap;
uniform float uAO;
uniform vec3 uHaze;
uniform float uFlicker;     // 1 + live flicker offset
uniform float uMask;        // 1 a silhouette, 0 revealed; between, the dark lifting off
uniform vec3 uSilhouette;   // the silhouette's colour (linear): the room's deepest shade
uniform float uDebug;       // 0 off · 1 normals · 2 rim · 3 occlusion · 4 light · 5 outline

const vec2 TAPS[12] = vec2[12](
  vec2(1.0, 0.0), vec2(0.866, 0.5), vec2(0.5, 0.866), vec2(0.0, 1.0), vec2(-0.5, 0.866), vec2(-0.866, 0.5),
  vec2(-1.0, 0.0), vec2(-0.866, -0.5), vec2(-0.5, -0.866), vec2(0.0, -1.0), vec2(0.5, -0.866), vec2(0.866, -0.5));

float alphaAt(vec2 uv) {
  if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 0.0;
  return textureLod(uArt, uv, uBaseLod).a;
}

vec3 screenOver(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - clamp(b, 0.0, 1.0)); }

// Value noise for the reveal's ragged front.
float maskHash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
float maskNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 s = f * f * (3.0 - 2.0 * f);
  return mix(mix(maskHash(i), maskHash(i + vec2(1.0, 0.0)), s.x), mix(maskHash(i + vec2(0.0, 1.0)), maskHash(i + 1.0), s.x), s.y);
}
// Three octaves, stretched to fill 0..1.
float maskFbm(vec2 p) {
  float n = maskNoise(p) * 0.55 + maskNoise(p * 2.03 + 17.1) * 0.3 + maskNoise(p * 4.07 + 41.3) * 0.15;
  return clamp((n - 0.22) / 0.56, 0.0, 1.0);
}

// Highlights past the shoulder roll off instead of clipping.
vec3 rolloff(vec3 c, float s) {
  vec3 over = max(c - s, 0.0);
  float room = max(1.0 - s, 1e-3);
  return min(c, s) + room * (1.0 - exp(-over / room));
}

void main() {
  vec2 artUV = (vUV - uPad) / (1.0 - 2.0 * uPad);
  bool inside = all(greaterThanEqual(artUV, vec2(0.0))) && all(lessThanEqual(artUV, vec2(1.0)));
  vec4 art = inside ? textureLod(uArt, artUV, uBaseLod + uLod) : vec4(0.0);

  // Screen-space gradient of the blurred silhouette. A step of one shape texel
  // to the screen's right is a step of -1 texel in a mirrored quad.
  vec2 dx = vec2(uShapeTexel.x * uFlipX, 0.0);
  vec2 dy = vec2(0.0, uShapeTexel.y);
  vec4 s0 = texture(uShape, vUV);
  vec4 sR = texture(uShape, vUV + dx), sL = texture(uShape, vUV - dx);
  vec4 sU = texture(uShape, vUV - dy), sD = texture(uShape, vUV + dy);
  vec2 gEdge = vec2(sR.r - sL.r, sU.r - sD.r);
  vec2 gBody = vec2(sR.g - sL.g, sU.g - sD.g);
  // Outward normal (alpha rises inward, so the normal is down the slope).
  vec2 nxy = -(gEdge * 5.5 + gBody * 9.0);
  float nl = length(nxy);
  if (nl > 0.94) nxy *= 0.94 / nl;
  vec3 n = vec3(nxy, sqrt(max(0.0, 1.0 - dot(nxy, nxy))));
  vec2 dir2 = length(nxy) > 1e-4 ? normalize(nxy) : vec2(0.0);

  vec2 picUV = vScreen * uEnvMap.xy + uEnvMap.zw;
  vec2 picUVB = vScreen * uEnvMapB.xy + uEnvMapB.zw;
  vec3 roomGlow = toLinear(texture(uGlow, picUV).rgb);
  if (uEnvMix > 0.0) roomGlow = mix(roomGlow, toLinear(texture(uGlowB, picUVB).rgb), uEnvMix);
  float dimK = uDim * (1.0 - uLit);

  // ── the room's light on the cast ──
  vec3 env = toLinear(texture(uEnv, picUV + vec2(n.x, -n.y) * 0.16).rgb);
  if (uEnvMix > 0.0) env = mix(env, toLinear(texture(uEnvB, picUVB + vec2(n.x, -n.y) * 0.16).rgb), uEnvMix);
  float el = max(luma(env), 1e-4);
  vec3 envChroma = mix(vec3(1.0), env / el, 0.5);
  float envRel = clamp(pow(el / max(uRoomLum, 1e-4), 0.3), 0.6, 1.5);
  vec3 envLight = mix(vec3(1.0), envChroma * envRel, uEnvAmt);
  vec3 ambient = mix(uGround, uSky, n.y * 0.5 + 0.5) * envLight;

  // Front key: soft wrap, centred on 1 so it models without re-exposing.
  float wrapK = clamp((dot(n, uKeyDir) + 0.45) / 1.45, 0.0, 1.0);
  vec3 key = mix(vec3(1.0), (0.5 + 0.95 * wrapK) * uKeyColor * uFlicker, uKey);
  float ao = mix(1.0, smoothstep(0.2, 0.9, s0.g), uAO);

  // ── the grade: the cast's own colour out, the room's in ──
  vec3 albedo = toLinear(art.rgb);
  vec3 base = mix(vec3(luma(albedo)), albedo, uSaturation);
  // Three-way, weighted by the PAINTED value: a white shirt takes the room's
  // highlights and black hair its shadows.
  float yp = luma(art.rgb);
  float ws = (1.0 - yp) * (1.0 - yp);
  float wh = yp * yp;
  float wm = max(0.0, 1.0 - ws - wh);
  vec3 grade = uTintShadow * ws + uTint * wm + uTintHigh * wh;
  vec3 light = grade * ambient * key * ao * uLevel;
  vec3 lit = base * light;

  // ── rims: the backdrop's lights, behind the cast ──
  // The silhouette minus itself shifted toward each light, off the full-res
  // alpha: crisp, and only on the edges that face the lamp.
  // The shift is in screen pixels, like the outline, so a rim is the same
  // hairline on a full-length figure and on a face filling the screen.
  vec2 rimStep = vec2(uStrokePx * 1.4) / max(uArtPx, vec2(1.0));
  vec3 rim = vec3(0.0);
  // How much rim light reaches this stretch of edge, and its colour: each
  // light counts where the edge's outward normal turns toward it, falling off
  // with distance. Everything edge-lit below (the outline, its bloom, the
  // spill onto the cast) follows this, so the line is bright on the side of
  // the lamp and fades away round the far side.
  float facing = 0.0;
  float incoming = 0.0;
  vec3 facingCol = vec3(0.0);
  for (int i = 0; i < 2; i++) {
    vec2 lp = (uRimPos[i] - uEnvMap.zw) / uEnvMap.xy;
    vec2 to = lp - vScreen;
    float dist = length(to) / max(uView.y, 1.0);
    vec2 toDir = normalize(vec2(to.x, -to.y) + 1e-5);
    vec2 step1 = vec2(toDir.x * uFlipX, -toDir.y) * rimStep;
    float near = inside ? textureLod(uArt, artUV + step1, uBaseLod + 0.5).a : 0.0;
    float line = art.a * (1.0 - near);
    float p = uRimPower[i] / (1.0 + dist * dist * 1.6) * uFlicker;
    rim += uRimColor[i] * p * min(1.0, line);
    float f = p * smoothstep(0.0, 0.9, dot(dir2, toDir));
    incoming += p;
    facing += f;
    facingCol += uRimColor[i] * f;
  }
  vec3 rimHue = facing > 1e-4 ? facingCol / facing : uStrokeColor;
  // The share of the light reaching this edge that it faces, so the falloff
  // round the form keeps its contrast however strong the lamps are; a weak
  // room (little incoming light) lights its edges less overall.
  float dirK = incoming > 1e-4 ? (facing / incoming) * clamp(incoming * 3.0, 0.0, 1.0) : 0.0;
  lit += rim;
  // The rim light spills onto the cast's own edge on the lit side: a soft
  // band inside the silhouette, the light wrapping round the form.
  float cutIn = 1.0 - smoothstep(0.62, 0.86, s0.r);
  float spill = art.a * (1.0 - smoothstep(0.45, 0.97, s0.g)) * cutIn * dirK;
  lit = screenOver(lit, rimHue * spill * uRimGlow * 0.4 * uFlicker);

  // ── glow: the cast's own highlights diffuse; the room's bloom wraps its edges ──
  vec3 soft = toLinear(textureLod(uArt, clamp(artUV, 0.0, 1.0), uDiffLod).rgb);
  soft = mix(vec3(luma(soft)), soft, uSaturation) * grade * uLevel;
  lit = screenOver(lit, max(soft - 0.35, 0.0) * 1.4 * uDiffusion);
  // The wrap zone is measured in screen pixels (an erosion of the alpha), not
  // off the blurred shape: on the shape a thin strand of hair is "edge" across
  // its whole width, and fills with the lamp behind it.
  vec2 wr = vec2(uStrokePx * 3.0) / max(uArtPx, vec2(1.0));
  float ero = 1.0;
  for (int i = 0; i < 12; i += 2) ero = min(ero, alphaAt(artUV + TAPS[i] * wr));
  float rimZone = art.a * (1.0 - ero);
  lit = screenOver(lit, roomGlow * uWrap * (0.03 + 0.9 * rimZone));

  // ── the picture: contrast, highlight shoulder, then the matte black ──
  // Log-contrast about mid grey at the cast's level, on luminance only (the
  // hue is the grade's): the room's soft light flattens the painting, this
  // gives its darks their weight back. Skipped at 0: pow(x, 0) is not 1 on
  // every GPU.
  if (uContrast > 0.0) {
    float lc = max(luma(lit), 1e-5);
    lit *= pow(lc / (0.18 * uLevel), uContrast);
  }
  lit = rolloff(lit, uShoulder);
  lit = uLift + lit * (1.0 - uLift);

  // ── depth and focus ──
  lit = mix(lit, uHaze, uDepth * 0.3);
  lit = mix(lit, vec3(luma(lit)), dimK * 0.35) * (1.0 - dimK * 0.42);
  lit *= 1.0 + uLit * 0.06;

  vec3 outLin = mix(albedo, lit, uStrength);

  // ── the silhouette ──
  // A character not yet revealed is a shape against the room: its deepest
  // shade, with only the rim light on it (the outline and halo stay). The
  // reveal lifts the dark off like smoke: from the feet first, in soft
  // drifting patches, never a line. Skipped at 0, so a revealed character is
  // exactly the lit one.
  if (uMask > 0.0) {
    float r = 1.0 - uMask;
    vec2 auv = clamp(artUV, 0.0, 1.0);
    // When each pixel clears (0 first, 1 last): half height, half a drifting field.
    float n = clamp(0.5 * (1.0 - auv.y) + 0.5 * maskFbm(auv * vec2(3.0, 2.2) + vec2(0.0, -r * 0.9)), 0.0, 1.0);
    const float SOFT = 0.16;
    float shown = smoothstep(n - SOFT, n + SOFT, mix(-SOFT, 1.0 + SOFT, r));
    vec3 shade = uSilhouette + (rim * 0.9 + rimHue * spill * uRimGlow * 0.35) * uStrength;
    outLin = mix(shade, outLin, shown);
  }
  float a = art.a * uAlpha;

  // ── the outline of light, and its halo ──
  // A ring just outside the alpha edge: the silhouette dilated by the stroke
  // width, minus itself. Where the art is cut by its own frame the body goes on
  // out of the picture (the shape's edge field was continued there), and no
  // outline or halo is drawn along the cut.
  vec2 r = vec2(uStrokePx) / max(uArtPx, vec2(1.0));
  r.x *= uFlipX;
  float dil = 0.0;
  for (int i = 0; i < 12; i++) dil = max(dil, alphaAt(artUV + TAPS[i] * r));
  for (int i = 0; i < 12; i += 2) dil = max(dil, alphaAt(artUV + TAPS[i] * r * 0.5));
  float cut = 1.0 - smoothstep(0.62, 0.86, s0.r);
  float edgeA = clamp((dil - art.a) * 1.8, 0.0, 1.0) * cut;
  float present = uStrength * uAlpha * (1.0 - dimK * 0.55) * (1.0 - uDepth * 0.35);
  float lightK = mix(uStrokeFloor, 1.0, dirK);
  float strokeA = edgeA * clamp(uStroke, 0.0, 1.0) * present * lightK;
  // Hot at the lamp's side (near white, a touch of its colour), cooling to the
  // lamp's own colour where the line thins out.
  vec3 strokeLin = mix(rimHue * 0.75, uStrokeColor, dirK) * mix(0.82, 1.0, clamp(uStroke - 1.0, 0.0, 1.0));
  // The line's bloom: light, so it glows past the outline on the lit side.
  float bloomField = smoothstep(0.0, 0.85, s0.r) * 0.7 + pow(s0.b, 1.4) * 0.5;
  float rimBloomA = bloomField * (1.0 - art.a) * cut * dirK * uRimGlow * present;
  vec3 rimBloom = toSRGB(rimHue * 0.55) * rimBloomA;
  // The halo is the room's light round the figure; it leans toward the lamps
  // like the line does, keeping a third of itself on the far side.
  float haloA = pow(s0.b, 1.6) * (1.0 - art.a) * cut * uHalo * present * mix(0.35, 1.0, dirK);
  // The halo is the room's own light round the figure: the colour of the
  // backdrop right there, a little brighter than it, leaning on the rig's.
  vec3 envHere = toLinear(texture(uEnv, picUV).rgb);
  if (uEnvMix > 0.0) envHere = mix(envHere, toLinear(texture(uEnvB, picUVB).rgb), uEnvMix);
  float eh = luma(envHere);
  vec3 haloLin = mix(envHere / max(eh, 1e-4) * clamp(eh * 2.6 + 0.03, 0.05, 0.6), uHaloColor, 0.3);
  vec3 haloSRGB = toSRGB(haloLin) * haloA * 0.6;

  if (uDebug > 0.5) {
    vec3 dbg = uDebug < 1.5 ? n * 0.5 + 0.5 : uDebug < 2.5 ? rim : uDebug < 3.5 ? vec3(ao) : uDebug < 4.5 ? light * 0.6 : vec3(edgeA * lightK, haloA, rimBloomA);
    float da = max(art.a, uDebug > 4.5 ? max(max(edgeA, haloA), rimBloomA) : 0.0);
    outColor = vec4(dbg * da, da);
    return;
  }
  vec3 col = toSRGB(outLin) * a;
  // The outline is light too: it brightens what is behind it (half its
  // coverage is alpha, the rest is added), so it never reads as a painted line.
  col += toSRGB(strokeLin) * strokeA * (1.0 - a);
  float alpha = a + strokeA * 0.5 * (1.0 - a);
  // The halo and the rim's bloom are light, not paint: added, no alpha.
  col += (haloSRGB + rimBloom) * (1.0 - a);
  outColor = vec4(col, alpha);
}`;

/* ── shadow ─────────────────────────────────────────────────────────── */

export const SHADOW_VS = HEADER + CAMERA + `
in vec2 aPos;
uniform vec4 uFoot;     // feet: x centre, y (floor), figure width, figure height — world px
uniform vec2 uThrow;    // shadow length (fraction of height), lean (x shift per unit length)
out vec2 vQ;            // x: -1..1 across the figure, y: 0 at the feet .. 1 at the far end
void main() {
  vQ = vec2(aPos.x * 2.0 - 1.0, aPos.y);
  float len = uFoot.w * uThrow.x;
  vec2 world = vec2(uFoot.x + vQ.x * uFoot.z * 0.75 + vQ.y * len * uThrow.y, uFoot.y + vQ.y * len - len * 0.08);
  gl_Position = toClip(toScreen(world));
}`;

export const SHADOW_FS = HEADER + `
in vec2 vQ;
out vec4 outColor;
uniform sampler2D uShape;
uniform vec2 uPad;
uniform float uFlipX;
uniform vec2 uFootUV;   // the art's feet: x centre, y bottom (art uv)
uniform vec3 uShadowColor;
uniform float uShadow;  // opacity
uniform float uAlpha;
void main() {
  // The far end of the shadow is the top of the figure, foreshortened.
  float t = clamp(vQ.y, 0.0, 1.0);
  vec2 art = vec2(uFootUV.x + vQ.x * 0.75 * 0.5, uFootUV.y - t * uFootUV.y);
  if (uFlipX < 0.0) art.x = 1.0 - art.x;
  vec2 uv = uPad + art * (1.0 - 2.0 * uPad);
  float occ = texture(uShape, uv).b;
  // A contact pool right at the feet, which the projection alone never darkens.
  float pool = exp(-pow(vQ.x / 0.55, 2.0) - pow(max(vQ.y + 0.02, 0.0) / 0.08, 2.0));
  float a = (occ * (1.0 - t * 0.85) * 0.75 + pool * 0.6) * uShadow * uAlpha;
  outColor = vec4(uShadowColor * a, a);
}`;

/* ── backdrop ───────────────────────────────────────────────────────── */

export const QUAD_VS = HEADER + `
in vec2 aPos;
out vec2 vUV;
void main() { vUV = aPos; gl_Position = vec4(aPos.x * 2.0 - 1.0, 1.0 - aPos.y * 2.0, 0.0, 1.0); }`;

export const BACKDROP_FS = HEADER + COLOR + `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uSharp;   // the picture, mipmapped
uniform sampler2D uMid;     // shallow depth of field
uniform sampler2D uSoft;    // deep depth of field
uniform sampler2D uGlow;    // bloom, linear light encoded as sRGB
uniform vec4 uBgMap;        // screen uv → picture uv: scale.xy, offset.xy (cover fit + push)
uniform vec4 uPicGrade;     // the picture's own grade on the SHARP level: gain, saturation, tint amount, -
uniform vec3 uPicTint;      // tint / luma(tint); the other levels arrive graded (assets.mjs)
uniform float uAmount;      // presence (premultiplied alpha)
uniform float uBlur;        // 0 sharp .. 1 the deepest
uniform float uBloom;
uniform float uLevel;
uniform vec3 uTint;
uniform float uHaze;
uniform vec3 uHazeColor;
void main() {
  vec2 uv = vUV * uBgMap.xy + uBgMap.zw;
  // Theatre's treatment, in its order and on encoded values (light/picture.mjs).
  vec3 e = texture(uSharp, uv).rgb;
  if (uPicGrade.x != 1.0) e *= uPicGrade.x;
  if (uPicGrade.y != 1.0) { float l = luma(e); e = max(vec3(l) + (e - vec3(l)) * uPicGrade.y, 0.0); }
  if (uPicGrade.z > 0.0) e = mix(e, uPicTint * luma(e), uPicGrade.z);
  vec3 s = toLinear(clamp(e, 0.0, 1.0));
  vec3 m = toLinear(texture(uMid, uv).rgb);
  vec3 f = toLinear(texture(uSoft, uv).rgb);
  vec3 c = uBlur < 0.35 ? mix(s, m, uBlur / 0.35) : mix(m, f, (uBlur - 0.35) / 0.65);
  vec3 g = toLinear(texture(uGlow, uv).rgb);
  c *= uTint * uLevel;
  c = mix(c, uHazeColor, uHaze);
  c = 1.0 - (1.0 - c) * (1.0 - clamp(g * uBloom, 0.0, 1.0));
  outColor = vec4(toSRGB(c) * uAmount, uAmount);
}`;

/* ── veil: the room's bloom over the cast (screen blend) ────────────── */

export const VEIL_FS = HEADER + COLOR + `
in vec2 vUV;
out vec4 outColor;
uniform sampler2D uGlow;
uniform vec4 uBgMap;
uniform float uGlowAmt;
void main() {
  vec2 uv = vUV * uBgMap.xy + uBgMap.zw;
  vec3 c = toLinear(texture(uGlow, uv).rgb) * uGlowAmt;
  outColor = vec4(clamp(c, 0.0, 1.0), 0.0);
}`;

/* ── grain (2× modulate) ────────────────────────────────────────────── */

export const GRAIN_FS = HEADER + `
in vec2 vUV;
out vec4 outColor;
uniform float uGrain;
uniform float uTime;        // ms
uniform float uGrainPx;     // device px per grain cell (one css px)
float hash(vec2 p) {
  p = fract(p * vec2(443.897, 441.423));
  p += dot(p, p.yx + 19.19);
  return fract((p.x + p.y) * p.x);
}
void main() {
  vec2 cell = floor(gl_FragCoord.xy / max(uGrainPx, 1.0));
  // A new grain 24 times a second, like film.
  float seed = floor(uTime / 41.6667);
  vec2 o = vec2(mod(seed * 17.0, 251.0), mod(seed * 59.0, 241.0));
  float n = hash(cell + o) + hash(cell * 1.37 + o.yx) - 1.0;
  outColor = vec4(vec3(0.5 + n * uGrain * 0.045), 0.5);
}`;

/* ── screen: floor shade, vignette, letterbox ───────────────────────── */

export const SCREEN_FS = HEADER + `
in vec2 vUV;
out vec4 outColor;
uniform vec2 uView;
uniform float uFloor;       // floor shade strength
uniform vec3 uFloorColor;
uniform float uFloorTop;    // where the shade fades out, screen uv from the top
uniform float uVignette;
uniform float uBars;        // letterbox height, fraction of the viewport height each
void main() {
  float f = smoothstep(uFloorTop, 1.0, vUV.y);
  float a = f * f * uFloor;
  vec2 c = (vUV - 0.5) * vec2(uView.x / uView.y, 1.0);
  float v = smoothstep(0.45, 1.15, length(c)) * uVignette;
  a = a + v * (1.0 - a);
  vec3 col = uFloorColor * (f * uFloor) / max(a, 1e-4);
  float bar = step(vUV.y, uBars) + step(1.0 - uBars, vUV.y);
  if (bar > 0.0) { outColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  outColor = vec4(col * a, a);
}`;

/**
 * Every uniform each program declares. The renderer writes all of them on every
 * draw; the check tool reads this list against the sources and against the
 * renderer.
 */
export const UNIFORMS = Object.freeze({
  figure: [
    "uView", "uCamera", "uRect", "uMotion", "uFlipX",
    "uArt", "uShape", "uEnv", "uGlow", "uEnvB", "uGlowB", "uPad", "uShapeTexel", "uEnvMap", "uEnvMapB", "uEnvMix",
    "uBaseLod", "uLod", "uDiffLod", "uArtPx", "uStrokePx",
    "uAlpha", "uDim", "uDepth", "uLit",
    "uStrength", "uLevel", "uShoulder", "uContrast", "uSaturation", "uTintShadow", "uTint", "uTintHigh", "uLift",
    "uSky", "uGround", "uEnvAmt", "uRoomLum", "uKeyDir", "uKeyColor", "uKey",
    "uRimPos", "uRimColor", "uRimPower",
    "uStroke", "uStrokeColor", "uStrokeFloor", "uRimGlow", "uHalo", "uHaloColor", "uDiffusion", "uWrap",
    "uAO", "uHaze", "uFlicker", "uMask", "uSilhouette", "uDebug",
  ],
  shadow: ["uView", "uCamera", "uFoot", "uThrow", "uShape", "uPad", "uFlipX", "uFootUV", "uShadowColor", "uShadow", "uAlpha"],
  backdrop: ["uSharp", "uMid", "uSoft", "uGlow", "uBgMap", "uPicGrade", "uPicTint", "uAmount", "uBlur", "uBloom", "uLevel", "uTint", "uHaze", "uHazeColor"],
  veil: ["uGlow", "uBgMap", "uGlowAmt"],
  grain: ["uGrain", "uTime", "uGrainPx"],
  screen: ["uView", "uFloor", "uFloorColor", "uFloorTop", "uVignette", "uBars"],
});

export const PROGRAMS = Object.freeze({
  backdrop: { vs: QUAD_VS, fs: BACKDROP_FS },
  screen: { vs: QUAD_VS, fs: SCREEN_FS },
  shadow: { vs: SHADOW_VS, fs: SHADOW_FS },
  figure: { vs: FIGURE_VS, fs: FIGURE_FS },
  veil: { vs: QUAD_VS, fs: VEIL_FS },
  grain: { vs: QUAD_VS, fs: GRAIN_FS },
});
