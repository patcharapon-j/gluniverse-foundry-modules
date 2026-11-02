/**
 * Diorama — every GLSL source the renderer compiles. Pure strings.
 *
 * Written in three's GLSL1 dialect (texture2D / gl_FragColor / varying); three
 * rewrites it for WebGL2. The check tool parses each `uniform` declared here and
 * requires the matching material to carry it, because a uniform nobody writes
 * holds the driver's initial value and fails silently.
 *
 * Colour: every texture is uploaded without colour-space decoding and nothing
 * here encodes on output, so the whole pipeline works in the map art's own
 * (sRGB) values. That keeps the painted look: a lit map reads as the map.
 */

/* ---------------------------------------------------------------- common */

const NOISE = /* glsl */ `
float dioHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float dioNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = dioHash(i), b = dioHash(i + vec2(1.0, 0.0));
  float c = dioHash(i + vec2(0.0, 1.0)), d = dioHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float dioFbm(vec2 p) {
  return dioNoise(p) * 0.6 + dioNoise(p * 2.13 + 7.1) * 0.3 + dioNoise(p * 4.7 - 3.3) * 0.1;
}
/** Sunlight through moving water: thin bright lines where two drifts agree. */
float dioCaustic(vec2 p, float t) {
  float a = dioNoise(p + vec2(t * 0.35, -t * 0.21));
  float b = dioNoise(p * 1.7 - vec2(t * 0.27, t * 0.31) + 4.7);
  return pow(1.0 - abs(a - b), 7.0);
}
`;

/** The map art, placed over its px rect (here in cells). */
const MAP = /* glsl */ `
uniform sampler2D uMap;
uniform vec4 uMapRect;
uniform float uHasMap;
uniform vec3 uGroundColor;
vec3 mapAt(vec2 xz) {
  vec2 uv = (xz - uMapRect.xy) / uMapRect.zw;
  if (uHasMap < 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return uGroundColor;
  return texture2D(uMap, uv).rgb;
}
/**
 * The map softened to about two thirds of a cell, from its mip chain: the
 * colour of a place rather than of one texel. A fixed level in cells, so it
 * reads the same at every zoom.
 */
vec3 mapSoft(vec2 xz) {
  vec2 uv = (xz - uMapRect.xy) / uMapRect.zw;
  if (uHasMap < 0.5 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return uGroundColor;
  float pxPerCell = float(textureSize(uMap, 0).x) / max(uMapRect.z, 1e-3);
  return texture2DLodEXT(uMap, uv, max(log2(max(pxPerCell, 1.0)) - 0.6, 0.0)).rgb;
}
`;

/**
 * World-space light, vision, the key light's shadow and up to eight effect
 * lights. Every lit material includes this.
 */
const LIT = /* glsl */ `
uniform sampler2D uLightMap;
uniform sampler2D uVisionMap;
uniform float uUseVision;
uniform vec2 uWorldSize;
uniform float uAmbient;
uniform vec3 uKeyDir;
uniform sampler2D uShadowMap;
uniform mat4 uShadowMatrix;
uniform float uShadowMode;
uniform vec2 uShadowTexel;
uniform vec4 uEffPos[8];
uniform vec3 uEffCol[8];
uniform float uEffCount;
uniform float uAOOn;
uniform sampler2D uField;
uniform float uFieldOn;
uniform vec2 uHeightRange;

/*
 * The few Foundry lights nearest the camera's target (render/torches.mjs picks
 * and writes them): they do not add light (the light bake already holds every
 * light, occluded), they shape it. Each one's flicker scales the bake where it
 * is that light's, and its direction shades what faces it brighter and what
 * faces away darker, normalised so flat ground keeps the bake exactly.
 */
uniform vec4 uTorchPos[8];    // xyz the light (cells), w its dim radius (cells)
uniform vec4 uTorchCol[8];    // rgb its strength (the bake's tint, 0..1), a its flicker multiplier now
uniform vec2 uTorchInfo[8];   // x bright radius / dim radius, y presence 0..1 (fading in or out of the set)
uniform float uTorchCount;
uniform float uTorchDir;      // 0..1 how much a light's direction shades (torchShadows shed: 0)

/*
 * The fog of war's soft map (render/fog.mjs): the vision bake blurred to about
 * half a cell, r visible now, g ever seen. uFogStyle: x clouds on (fogStyle
 * "clouds" and a vision bake), y the clouds' own clock (seconds; it stops when
 * fogDrift is shed).
 */
uniform sampler2D uFogMap;
uniform vec2 uFogStyle;

/*
 * The environment (render/atmosphere.mjs writes all of these from the resolved
 * environment, environment.mjs). Neutral values reproduce the fixed light the
 * view had before it: the fill, key and bounce below at no overcast, no flash,
 * no fog, no clouds, dry, no snow.
 */
uniform vec3 uEnvFill;      // sky fill
uniform vec3 uEnvKey;       // the direct key (sun, or the moon at night)
uniform vec3 uEnvBounce;    // warm light thrown back up by the ground
uniform vec3 uEnvSky;       // the sky's own colour: haze, reflections
uniform float uEnvOvercast; // 0..1: softens the key, greys the fill
uniform float uEnvFlash;    // lightning, 0..1, brief
uniform vec4 uEnvFog;       // rgb fog colour (unlit), a density
uniform vec4 uEnvAtmo;      // x fog height (cells), y haze, z light shafts, w atmosphere on (fx)
uniform vec4 uEnvClouds;    // x cover, y speed (cells/s), zw wind direction (unit, on the map)
uniform vec3 uEnvFocus;     // the camera's target: haze grows with depth behind it
uniform vec4 uEnvSurface;   // x wetness, y snow cover, z mist over water
uniform vec4 uEnvFlow;      // xy river flow direction, z flow speed, w rain on water
uniform vec4 uEnvFx;        // x cliff relief (fx.detail), y full water (fx.water), z colour grade, w unused
uniform float uEnvTime;     // the shared animation clock (a copy of uTime)

bool dioInWorld(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0; }

/**
 * The terrain field (terrain-field.mjs): r occlusion, g signed distance to the
 * nearest cliff lip, b distance to the bank in water, a how near dry ground is
 * to the water (1 at the waterline). Neutral without one.
 */
vec4 fieldAt(vec2 xz) {
  vec2 uv = xz / uWorldSize;
  if (uFieldOn < 0.5 || !dioInWorld(uv)) return vec4(1.0, 1.0, 0.0, 0.0);
  return texture2D(uField, uv);
}

/**
 * Depth grading: low ground a little deeper and cooler, the heights a touch
 * warmer, so the levels of a tall board read apart at a glance.
 */
vec3 heightGrade(vec3 c, float y) {
  float span = max(uHeightRange.y - uHeightRange.x, 0.75);
  float hn = clamp((y - uHeightRange.x) / span, 0.0, 1.0);
  c *= mix(0.86, 1.03, hn);
  return mix(c * vec3(0.92, 0.97, 1.06), c, 0.35 + 0.65 * hn);
}

vec3 lightAt(vec2 xz) {
  vec2 uv = xz / uWorldSize;
  if (!dioInWorld(uv)) return vec3(0.0);
  return texture2D(uLightMap, uv).rgb;
}

/** 1 = visible now, 0.5 = explored, 0 = never seen. */
float visionAt(vec2 xz) {
  if (uUseVision < 0.5) return 1.0;
  vec2 uv = xz / uWorldSize;
  if (!dioInWorld(uv)) return 0.0;
  vec4 v = texture2D(uVisionMap, uv);
  if (v.r > 0.5) return 1.0;
  if (v.g > 0.5) return 0.5;
  return 0.0;
}

float shadowTap(vec3 p, vec2 o) {
  float d = texture2D(uShadowMap, p.xy + o * uShadowTexel).r;
  return p.z - 0.0018 <= d ? 1.0 : 0.0;
}

float shadowMapAt(vec3 wp, vec3 n) {
  if (uShadowMode < 0.5) return 1.0;
  vec4 lp = uShadowMatrix * vec4(wp + n * 0.03, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (!dioInWorld(p.xy) || p.z > 1.0) return 1.0;
  if (uShadowMode < 1.5) return shadowTap(p, vec2(0.0));
  // a golden-angle disc turned per pixel: a smooth penumbra, no grid steps
  float rot = dioHash(gl_FragCoord.xy) * 6.2831853;
  float s = 0.0;
  for (int i = 0; i < 12; i++) {
    float fi = float(i);
    float r = sqrt((fi + 0.5) / 12.0) * 2.4;
    float a = fi * 2.3999632 + rot;
    s += shadowTap(p, vec2(cos(a), sin(a)) * r);
  }
  return s / 12.0;
}

/**
 * Cloud shadows: big soft patches drifting with the wind, over everything the
 * sun lights (they ride the shadow term, so cards and water get them too).
 * One fbm at about a dozen cells a feature. 1 = open sky.
 */
float cloudAt(vec2 xz) {
  if (uEnvAtmo.w < 0.5 || uEnvClouds.x < 0.01) return 1.0;
  vec2 p = (xz - uEnvClouds.zw * (uEnvClouds.y * uEnvTime)) * 0.085;
  float n = dioFbm(p) * 0.8 + dioNoise(p * 3.3 + 1.7) * 0.2;
  float thr = 0.82 - uEnvClouds.x * 0.55;
  return 1.0 - 0.62 * smoothstep(thr - 0.07, thr + 0.09, n);
}

/** The key light's shadow at a point: the shadow map, under the clouds. */
float shadowAt(vec3 wp, vec3 n) {
  return shadowMapAt(wp, n) * cloudAt(wp.xz);
}

vec3 effectLight(vec3 wp, vec3 n) {
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uEffCount) break;
    vec3 d = uEffPos[i].xyz - wp;
    float r = max(uEffPos[i].w, 0.001);
    float att = clamp(1.0 - length(d) / r, 0.0, 1.0);
    float ndl = mix(1.0, max(dot(n, normalize(d + vec3(0.0, 0.0001, 0.0))), 0.0), 0.6);
    sum += uEffCol[i] * att * att * ndl;
  }
  return sum;
}

/*
 * The sun is a cool sky fill plus a warm direct key. Weighted so open flat ground
 * comes out at 1.0 (the map's own colours), ground in shadow at the fill alone
 * (about half, tinted cool), a face turned to the sun brighter than the floor and
 * a face turned away as dark as a shadow. The three colours follow the time of
 * day (environment.mjs); the old constant names stay as aliases.
 */
#define SKY_FILL uEnvFill
#define SUN_KEY uEnvKey
/** Warm light thrown back up by the sunlit ground: faces that look down or out. */
#define BOUNCE uEnvBounce
const vec3 DIO_LUMA = vec3(0.299, 0.587, 0.114);

/** The sun alone, for a surface with normal n and shadow term sh. */
vec3 sunlight(vec3 n, float sh) {
  float ndl = max(dot(n, uKeyDir), 0.0);
  float down = clamp(1.0 - n.y, 0.0, 1.0);
  // overcast: the key fades, the fill greys and lifts (a soft, shadowless day)
  vec3 fill = mix(SKY_FILL, vec3(dot(SKY_FILL, DIO_LUMA)) * 1.22, uEnvOvercast * 0.6);
  vec3 key = SUN_KEY * (1.0 - 0.72 * uEnvOvercast);
  vec3 c = uAmbient * (fill * (0.9 + 0.1 * n.y) + key * ndl * sh + BOUNCE * down * (1.0 - 0.6 * uEnvOvercast));
  // lightning: a cold flash from the whole sky, brightest on what faces up
  return c + uEnvFlash * vec3(0.72, 0.78, 0.95) * (0.55 + 0.45 * max(n.y, 0.0));
}

/** One tracked light's share of the bake at wp, by the bake's own falloff. */
float torchShare(int i, vec3 wp, out vec3 l) {
  vec3 d = uTorchPos[i].xyz - wp;
  float dist = length(d);
  l = d / max(dist, 1e-4);
  float x = dist / max(uTorchPos[i].w, 0.05);
  if (x >= 1.0) return 0.0;
  return (1.0 - smoothstep(uTorchInfo[i].x, 1.0, x)) * dot(uTorchCol[i].rgb, DIO_LUMA);
}

/*
 * The light bake at a surface with normal n, shaped by the tracked lights:
 * each light's flicker, and a wrapped facing term against flat ground's, so a
 * top keeps the bake exactly, a face turned to a torch takes up to 1.8× and a
 * face turned away down to 0.3×. Light the tracked ones do not explain (an
 * untracked light, a lit edge) passes through unchanged.
 */
vec3 torchLight(vec3 base, vec3 wp, vec3 n) {
  if (uTorchCount < 0.5) return base;
  float acc = 0.0, wsum = 0.0;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uTorchCount) break;
    vec3 l;
    float c = torchShare(i, wp, l);
    if (c <= 0.0) continue;
    float s = (0.42 + 0.58 * max(dot(n, l), 0.0)) / (0.42 + 0.58 * max(l.y, 0.0));
    s = mix(1.0, clamp(s, 0.3, 1.8), uTorchDir * uTorchInfo[i].y);
    acc += c * uTorchCol[i].a * s;
    wsum += c;
  }
  float rest = max(dot(base, DIO_LUMA) - wsum, 0.0);
  return base * ((acc + rest) / max(wsum + rest, 1e-4));
}

/** The strongest tracked light at wp: its light now (rgb, flicker in), its share (a); l toward it. */
vec4 torchKey(vec3 wp, out vec3 l) {
  vec4 best = vec4(0.0);
  l = vec3(0.0, 1.0, 0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uTorchCount) break;
    vec3 li;
    float c = torchShare(i, wp, li) * uTorchInfo[i].y;
    if (c > best.a) { best = vec4(uTorchCol[i].rgb * uTorchCol[i].a * c / max(dot(uTorchCol[i].rgb, DIO_LUMA), 1e-3), c); l = li; }
  }
  return best;
}

/** shade() with the shadow term already taken. */
vec3 shadeLit(vec3 albedo, vec3 wp, vec3 n, float ao, vec2 lightXZ, float sh) {
  vec3 lit = sunlight(n, sh) + torchLight(lightAt(lightXZ), wp, n) + effectLight(wp, n);
  lit *= mix(1.0, ao, uAOOn);
  return albedo * lit;
}

/** Albedo under the sun + the light bake + effect lights, with no weather on it (water). */
vec3 shadeBase(vec3 albedo, vec3 wp, vec3 n, float ao, vec2 lightXZ) {
  return shadeLit(albedo, wp, n, ao, lightXZ, shadowAt(wp, n));
}

const vec3 DIO_SNOW = vec3(0.93, 0.95, 0.98);

/**
 * Albedo under the sun + the light bake + effect lights, as the weather leaves
 * it: snow settles on what faces up (the paint's own light and dark kept
 * under it), rain darkens and richens every surface, and wet tops gather
 * puddles that catch the sky and the sun. A bank by the water is wet whatever
 * the weather, its edge lapping with the waves (full water only).
 */
vec3 shade(vec3 albedo, vec3 wp, vec3 n, float ao, vec2 lightXZ) {
  float wet = uEnvSurface.x;
  float up = clamp(n.y, 0.0, 1.0);
  if (uEnvFx.y > 0.5 && up > 0.6) {
    float near = fieldAt(wp.xz).a;
    float lap = 0.42 + 0.2 * sin(uEnvTime * 1.15 + dioNoise(wp.xz * 2.3) * 4.0);
    wet = max(wet, smoothstep(lap - 0.2, lap + 0.04, near) * 0.85);
  }
  if (wet > 0.001) {
    float por = 0.55 + 0.45 * dioNoise(wp.xz * 3.1 + wp.y);
    albedo *= mix(1.0, 0.66, wet * por);
    albedo = max(mix(vec3(dot(albedo, DIO_LUMA)), albedo, 1.0 + 0.18 * wet), 0.0);
  }
  float snow = uEnvSurface.y;
  float cover = 0.0;
  if (snow > 0.001) {
    float drift = dioFbm(wp.xz * 0.9 + 3.7) * 0.6 + dioNoise(wp.xz * 5.3) * 0.4;
    float t = 1.0 - snow;
    cover = smoothstep(t - 0.1, t + 0.12, drift * 0.75 + up * 0.35 - 0.05) * smoothstep(0.4, 0.8, up);
    cover = max(cover, smoothstep(0.85, 1.0, snow) * smoothstep(0.55, 0.85, up));
    float l = dot(albedo, DIO_LUMA);
    albedo = mix(albedo, DIO_SNOW * (0.8 + 0.32 * l), cover * 0.95);
    wet *= 1.0 - cover;
  }
  float sh = shadowAt(wp, n);
  vec3 lit = shadeLit(albedo, wp, n, ao, lightXZ, sh);
  if (wet > 0.001 && up > 0.6) {
    vec3 V = normalize(cameraPosition - wp);
    float puddle = smoothstep(0.55, 0.7, dioFbm(wp.xz * 0.55 + 11.0)) * smoothstep(0.35, 0.85, uEnvSurface.x);
    vec2 jit = vec2(dioNoise(wp.xz * 9.0), dioNoise(wp.xz * 9.0 + 5.0)) - 0.5;
    vec3 nn = normalize(n + vec3(jit.x, 0.0, jit.y) * 0.35 * (1.0 - puddle));
    float fres = pow(1.0 - max(dot(nn, V), 0.0), 4.0);
    float spec = pow(max(dot(nn, normalize(uKeyDir + V)), 0.0), mix(36.0, 200.0, puddle)) * sh;
    lit = mix(lit, uEnvSky * uAmbient * 0.9, (fres * 0.45 + 0.28) * puddle * wet);
    lit += SUN_KEY * spec * wet * (0.18 + 0.7 * puddle) * uAmbient * (1.0 - uEnvOvercast * 0.6);
  }
  return lit;
}

/** Soft shoulder, then the explored-not-visible look (desaturated, dim). */
vec3 finish(vec3 c, float vis) {
  vec3 over = max(c - 0.82, 0.0);
  c = min(c, 0.82) + 0.18 * (1.0 - exp(-over / 0.18));
  if (uEnvFx.z > 0.5) {
    // a light grade: a touch of saturation and contrast about mid-grey
    float lg = dot(c, DIO_LUMA);
    c = max(mix(vec3(lg), c, 1.07), 0.0);
    c = max((c - 0.45) * 1.04 + 0.45, 0.0);
  }
  // half a level of dither hides banding in the long dark gradients
  c += (dioHash(gl_FragCoord.xy + 17.0) - 0.5) / 255.0;
  if (vis < 0.75) {
    float l = dot(c, DIO_LUMA);
    c = mix(vec3(l), c, 0.22) * 0.5;
  }
  return c;
}

/**
 * The air between the camera and a lit surface (fx.atmosphere): fog pooling in
 * low ground and broken into slow wisps along the wind, shafts of a low sun
 * through it, and haze toward the sky's colour with depth behind the camera's
 * target. Lit like the sky it hangs under, so night fog is dark and a flash
 * lights it.
 */
vec3 dioAtmosphere(vec3 c, vec3 wp) {
  if (uEnvAtmo.w < 0.5) return c;
  float lum = uAmbient + uEnvFlash * 0.8;
  if (uEnvFog.a > 0.001) {
    float above = max(wp.y - uHeightRange.x, 0.0);
    float pool = exp(-above / max(uEnvAtmo.x, 0.05));
    vec2 drift = uEnvClouds.zw * (uEnvTime * (0.05 + 0.1 * uEnvClouds.y));
    float wisp = dioFbm(wp.xz * 0.3 - drift + vec2(wp.y * 0.5, 0.0));
    float f = clamp(uEnvFog.a * pool * (0.45 + 1.0 * wisp), 0.0, 0.86);
    vec3 fc = uEnvFog.rgb * lum;
    if (uEnvAtmo.z > 0.001) {
      vec2 sd = normalize(uKeyDir.xz + vec2(1e-4));
      vec2 across = vec2(-sd.y, sd.x);
      float s = dioNoise(vec2(dot(wp.xz, across) * 0.55, dot(wp.xz, sd) * 0.05 + uEnvTime * 0.015));
      fc += SUN_KEY * smoothstep(0.42, 0.85, s) * uEnvAtmo.z * 0.45 * uAmbient;
    }
    c = mix(c, fc, f);
  }
  if (uEnvAtmo.y > 0.001) {
    vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
    float depth = dot(wp - uEnvFocus, fwd);
    float haze = uEnvAtmo.y * (0.12 + 0.5 * smoothstep(-8.0, 22.0, depth));
    c = mix(c, uEnvSky * lum * 0.92, clamp(haze, 0.0, 0.55));
  }
  return c;
}

/** The fog of war's soft map at a point: x visible now, y ever seen (0 off the board). */
vec2 fogSoftAt(vec2 xz) {
  vec2 uv = xz / uWorldSize;
  if (!dioInWorld(uv)) return vec2(0.0);
  return texture2D(uFogMap, uv).rg;
}

/** Cells the fog drifts down the wind per tick of its clock (render/fog.mjs FOG_DRIFT_CELLS). */
const float FOG_DRIFT_CELLS = 3.0;

/*
 * The fog of war's density at height k in the bank (0 its floor, 1 its top),
 * 0..1: long soft streaks laid along the wind and curled a little, each sheet
 * drifting down the wind at its own pace, so the bank shears as it moves and
 * reads as depth rather than as one printed sheet. The drift is a straight
 * translation of non-repeating noise: it never loops, so it never snaps.
 */
float dioFogNoise(vec2 xz, float k) {
  vec2 wind = dot(uEnvClouds.zw, uEnvClouds.zw) > 1e-4 ? normalize(uEnvClouds.zw) : vec2(0.8, 0.6);
  vec2 q = vec2(dot(xz, wind), dot(xz, vec2(-wind.y, wind.x)));
  q.x -= uFogStyle.y * FOG_DRIFT_CELLS * (1.0 + 0.45 * k);
  vec2 p = q * vec2(0.2, 0.42) + vec2(k * 5.3, -k * 2.9);
  p += (vec2(dioNoise(p * 0.7 + 3.1), dioNoise(p * 0.7 - 1.7)) - 0.5) * 0.9;
  return dioFbm(p) * 0.75 + dioNoise(p * 2.6 + 1.3) * 0.25;
}

/*
 * Fog lit by the sky alone: a cool slate well below the lit board, so what the
 * party sees stands out of it. No sun on its top (a lit top is what makes a
 * bank read as a solid), a little more sky caught by the thin wisps above (k)
 * and the denser streaks (n), and a lightning flash through it. Never black: a
 * night fog is deep blue, not a hole.
 */
vec3 dioFogColor(float k, float n) {
  vec3 tint = mix(vec3(0.30, 0.35, 0.46), uEnvSky, 0.12);
  vec3 sky = mix(vec3(dot(uEnvFill, DIO_LUMA)), uEnvFill, 0.35);
  vec3 c = tint * sky * (0.36 + 1.1 * n * n + 0.9 * k) * uAmbient;
  c += uEnvFlash * vec3(0.3, 0.33, 0.4) * (0.4 + 0.6 * k);
  return max(c, vec3(0.028, 0.034, 0.055));
}

/*
 * The fog of war over a lit surface (fogStyle clouds; nothing for the GM or a
 * flat fog). Out of sight now, the ground is the map as remembered, dim and
 * grey under a faint low mist, faded in over the soft map rather than switched
 * at a line. Near what nobody has seen, shadow creeps in: a ragged falloff
 * across the soft map's blur that reaches the fog's own colour exactly where
 * the bank's opaque floor (FOG_FRAG) begins, so the two meet without a seam.
 */
vec3 dioFogOfWar(vec3 c, float vis, vec3 wp) {
  if (uUseVision < 0.5 || uFogStyle.x < 0.5) return c;
  float n = dioFogNoise(wp.xz, 0.0);
  vec2 s = fogSoftAt(wp.xz);
  float away = 1.0 - smoothstep(0.2, 0.8, s.x);
  vec3 memory = mix(vec3(dot(c, DIO_LUMA)), c, 0.25) * 0.5;
  memory = mix(memory, dioFogColor(0.0, n), 0.12 + 0.2 * smoothstep(0.3, 0.8, n));
  c = mix(c, memory, away);
  float unseen = 1.0 - s.y;
  float shadow = smoothstep(0.16 * n, 0.5, unseen);
  return mix(c, dioFogColor(0.0, n), shadow);
}

/**
 * The last step of every lit surface, with its world position: the
 * atmosphere (fog, haze) under the grade, then the fog of war. Surfaces call
 * this, never finish() directly, so the environment reaches all of them.
 * Under fog the remembered look is the fog's own (soft), not finish()'s step.
 */
vec3 dioFinish(vec3 c, float vis, vec3 wp) {
  bool fogged = uUseVision > 0.5 && uFogStyle.x > 0.5;
  return dioFogOfWar(finish(dioAtmosphere(c, wp), fogged ? 1.0 : vis), vis, wp);
}

/**
 * dioFinish for a figure: no fog of war. A standee is drawn only when Foundry
 * says this viewer sees it, and a figure at the edge of sight must still read.
 */
vec3 dioFinishFigure(vec3 c, vec3 wp) {
  return finish(dioAtmosphere(c, wp), 1.0);
}
`;

/** Noise, the map and the lit chunk: what a lit program outside this file includes. */
export const HEAD = NOISE + MAP + LIT;

/*
 * The ground's own surfaces (tops, cliff faces, water) under fog. Each of these
 * programs writes its depth itself, starting every fragment at its own depth
 * (dioGroundDepth). Ground nobody has seen is painted flat in the bank floor's
 * colour, unlit, so it tells nothing about what is there. Beyond the first
 * square or so past the edge of sight (the soft map's seen value under
 * FOG_SOLID) it is a BACKDROP at the far plane: it hides nothing, so an unseen
 * tower casts no silhouette over what the party can see and its shape cannot be
 * read off its outline, and it leaves no hole (where the camera looks under the
 * bank's rim it finds more fog, not the clear colour). Right at the edge it
 * keeps its depth, so the pillar beside the party still stands there as a dark
 * shape rather than as two lit faces with nothing on top. True when it wrote
 * the pixel. Only these programs include it: a program that assigns
 * gl_FragDepth anywhere must assign it on every path.
 */
const UNSEEN = /* glsl */ `
const float FOG_SOLID = 0.12;
/** The bank height whose colour unseen ground takes: the floor with its wisps over it, on average. */
const float FOG_PAINT = 0.3;
void dioGroundDepth() { gl_FragDepthEXT = gl_FragCoord.z; }
bool dioUnseenFog(float vis, vec2 xz) {
  if (vis > 0.0 || uUseVision < 0.5 || uFogStyle.x < 0.5) return false;
  gl_FragColor = vec4(dioFogColor(FOG_PAINT, dioFogNoise(xz, 0.0)), 1.0);
  if (fogSoftAt(xz).y < FOG_SOLID) gl_FragDepthEXT = 1.0;
  return true;
}
`;

/* ---------------------------------------------------------------- terrain */

export const TOP_VERT = /* glsl */ `
attribute float ao;
attribute vec3 tint;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAO;
varying vec3 vTint;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vAO = ao;
  vTint = tint;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TOP_FRAG = HEAD + UNSEEN + /* glsl */ `
uniform vec4 uGrid;   // rgb = line colour, a = strength (0 = grid off)
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAO;
varying vec3 vTint;

/*
 * The square grid on walkable tops. A hairline sized in DEVICE pixels (fwidth),
 * never in cells: a cell-sized width is a slab zoomed in and gone zoomed out.
 * Fades out where cells shrink to a few pixels, before the lines moire.
 */
float gridLine(vec2 xz) {
  vec2 fw = max(fwidth(xz), vec2(1e-5));
  vec2 d = abs(fract(xz + 0.5) - 0.5) / fw;
  float line = 1.0 - smoothstep(0.35, 1.25, min(d.x, d.y));
  float dense = max(fw.x, fw.y);
  return line * (1.0 - smoothstep(0.07, 0.2, dense));
}

/** terrain-field.mjs LIP_RANGE: the lip distance is stored over ±this. */
const float LIP_RANGE = 0.5;

void main() {
  dioGroundDepth();
  float vis = visionAt(vWorld.xz);
  if (dioUnseenFog(vis, vWorld.xz)) return;
  if (vis <= 0.0) discard;
  vec4 f = fieldAt(vWorld.xz);
  vec3 albedo = mapAt(vWorld.xz) * vTint;
  // the field's soft horizon occlusion, a little of the voxel corners kept
  float ao = f.r * mix(1.0, vAO, 0.3);
  vec3 c = shade(albedo, vWorld, normalize(vNormal), ao, vWorld.xz);
  // The cliff lip catches the light: a soft bevel a few hundredths of a cell
  // deep, and one hairline sized in DEVICE px from the field's own derivative.
  float lip = (f.g - 0.5) * 2.0 * LIP_RANGE;
  float fw = max(fwidth(lip), 1e-5);
  if (lip > -fw) {
    float bevel = 1.0 - smoothstep(0.0, 0.09, lip);
    float hair = smoothstep(-0.6 * fw, 0.1 * fw, lip) * (1.0 - smoothstep(1.0 * fw, 2.1 * fw, lip));
    c *= 1.0 + 0.11 * bevel;
    c += (c * 0.5 + vec3(0.07, 0.064, 0.054)) * hair * 0.7;
  }
  if (uGrid.a > 0.0) {
    // Ink at the lit surface's own brightness: a dark grid darkens, a light
    // one tints, and neither glows brighter than the ground it lies on.
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 ink = min(uGrid.rgb * (0.25 + lum), vec3(1.0));
    c = mix(c, ink, gridLine(vWorld.xz) * uGrid.a);
  }
  c = heightGrade(c, vWorld.y);
  gl_FragColor = vec4(dioFinish(c, vis, vWorld), 1.0);
}
`;

export const SIDE_VERT = /* glsl */ `
attribute vec2 lip;
attribute float depth;
attribute float drop;
attribute float along;
attribute float mat;
attribute float flag;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLip;
varying float vDepth;
varying float vDrop;
varying float vAlong;
varying float vMat;
varying float vFlag;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLip = lip; vDepth = depth; vDrop = drop; vAlong = along; vMat = mat; vFlag = flag;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SIDE_FRAG = HEAD + UNSEEN + /* glsl */ `
uniform float uSidePaint;
uniform float uTime;
uniform vec3 uPlinth;
uniform vec3 uTrim;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec2 vLip;
varying float vDepth;
varying float vDrop;
varying float vAlong;
varying float vMat;
varying float vFlag;

const vec3 EARTH = vec3(0.47, 0.34, 0.23);
const vec3 EARTH_DEEP = vec3(0.30, 0.21, 0.16);
const vec3 STONE = vec3(0.62, 0.60, 0.56);
const vec3 ICE = vec3(0.80, 0.91, 0.97);
const vec3 ICE_DEEP = vec3(0.38, 0.62, 0.80);
const vec3 WOOD = vec3(0.52, 0.36, 0.22);
const vec3 BRICK = vec3(0.62, 0.30, 0.22);
const vec3 MORTAR = vec3(0.74, 0.70, 0.64);

vec3 sideAlbedo(int m, vec3 lipC, float a, float d, float y) {
  if (m == 2) return lipC * (1.0 - 0.2 * smoothstep(0.0, 2.0, d));
  if (m == 1) {
    float rowH = 0.25;
    float row = floor(y / rowH);
    float bx = (a + mod(row, 2.0) * 0.27) / 0.55;
    vec2 f = vec2(fract(bx), fract(y / rowH));
    float mortar = max(1.0 - smoothstep(0.03, 0.06, f.x), 1.0 - smoothstep(0.05, 0.1, f.y));
    float rnd = dioHash(vec2(floor(bx), row));
    vec3 s = mix(lipC, STONE, 0.62) * (0.8 + 0.24 * rnd) * (0.94 + 0.12 * dioNoise(vec2(a, y) * 9.0));
    s *= 1.0 + 0.14 * smoothstep(0.7, 1.0, f.y);
    return mix(s, s * 0.42, mortar);
  }
  if (m == 3) {
    vec3 base = mix(ICE, lipC, 0.14);
    float streak = dioNoise(vec2(a * 9.0, y * 0.7));
    vec3 c = base * (0.86 + 0.22 * streak);
    c = mix(c, ICE_DEEP, smoothstep(0.0, 2.2, d) * 0.65);
    c += 0.22 * smoothstep(0.9, 1.0, fract(a * 2.7 + y * 0.35 + streak * 0.3));
    return c;
  }
  if (m == 4) {
    float row = floor(y / 0.16);
    float f = fract(y / 0.16);
    float joint = fract((a + dioHash(vec2(row, 3.0)) * 1.7) / 1.3);
    float seam = max(1.0 - smoothstep(0.04, 0.09, f), 1.0 - smoothstep(0.008, 0.02, joint));
    float grain = sin(a * 13.0 + dioNoise(vec2(a * 2.0, y * 24.0)) * 4.0 + row * 7.0) * 0.5 + 0.5;
    vec3 c = mix(WOOD, WOOD * 0.72, grain * 0.55) * (0.84 + 0.22 * dioHash(vec2(row, 9.0)));
    return mix(c, c * 0.4, seam);
  }
  if (m == 5) {
    float rowH = 0.11;
    float row = floor(y / rowH);
    float bx = (a + mod(row, 2.0) * 0.12) / 0.24;
    vec2 f = vec2(fract(bx), fract(y / rowH));
    float mortar = max(1.0 - smoothstep(0.05, 0.09, f.x), 1.0 - smoothstep(0.1, 0.18, f.y));
    vec3 b = mix(BRICK, lipC, 0.12) * (0.82 + 0.26 * dioHash(vec2(floor(bx), row)));
    return mix(b, MORTAR * mix(vec3(1.0), lipC, 0.2), mortar);
  }
  // earth: strata tinted from the lip, a grassy overhang, pebbles
  float wob = dioNoise(vec2(a * 1.3, y * 2.0)) * 0.7 + sin(a * 2.1) * 0.12;
  float s = y * 4.2 + wob;
  float band = mod(floor(s), 3.0);
  vec3 soil = mix(lipC, EARTH, 0.68);
  vec3 c = band < 0.5 ? soil : band < 1.5 ? mix(soil, EARTH_DEEP, 0.45) : soil * 0.86;
  c *= 0.9 + 0.16 * dioNoise(vec2(a, y) * 7.0);
  float peb = smoothstep(0.78, 0.86, dioNoise(vec2(a, y) * 11.0 + 3.0));
  c = mix(c, mix(STONE, lipC, 0.3), peb * 0.7);
  float lipEdge = 0.05 + 0.05 * dioNoise(vec2(a * 7.0, 1.0));
  c = mix(lipC * 1.08, c, smoothstep(lipEdge, lipEdge + 0.025, d));
  return c;
}

/** A material's own flat colour: what its pattern is measured against. */
vec3 sideBase(int m, vec3 lipC) {
  if (m == 2) return lipC;
  if (m == 1) return mix(lipC, STONE, 0.62) * 0.9;
  if (m == 3) return mix(ICE, lipC, 0.14);
  if (m == 4) return WOOD * 0.82;
  if (m == 5) return mix(BRICK, lipC, 0.12) * 0.95;
  return mix(lipC, EARTH, 0.68) * 0.92;
}

/*
 * A cliff face continues the paint of the top it hangs from. Its colour is the
 * map around the lip, softened to about a cell (mapSoft): the colour of the
 * place. One texel held fixed down the face drew every brushstroke of the
 * edge as a vertical streak. The material adds the relief, its pattern's
 * light and dark at RELIEF strength. uSidePaint is how much of the paint wins
 * over the material's own colour (1 = all paint).
 */
const float RELIEF = 0.42;
vec3 paintedSide(int m, vec3 lipC, float a, float d, float y) {
  // fx.detail low: no relief at all, the material's flat colour under the paint
  if (uEnvFx.x < 0.5) return mix(sideBase(m, lipC), lipC, uSidePaint);
  vec3 pat = sideAlbedo(m, lipC, a, d, y);
  float l = dot(pat, vec3(0.299, 0.587, 0.114));
  float l0 = max(dot(sideBase(m, lipC), vec3(0.299, 0.587, 0.114)), 0.04);
  float relief = clamp(l / l0, 0.35, 1.7);
  vec3 paint = lipC * mix(1.0, relief, RELIEF);
  return mix(pat, paint, uSidePaint);
}

/** Cells from the foot of a bank face to the waterline (terrain-mesh bed and surface). */
const float WATERLINE = 0.325;
const vec3 FALL_FOAM = vec3(0.90, 0.95, 0.98);

/*
 * A waterfall: the face a water top spills over (terrain-mesh flag +8). The
 * sheet takes the pool's own painted colour, a little lighter, runs down in
 * streaks at a fall's speed, curls white over the lip and churns white where
 * it lands (on the ground, or at the lower pool's waterline). Simple water:
 * the same sheet, still.
 */
vec3 fallSheet(vec3 lipC, float a, float d, float up, bool intoWater) {
  float full = uEnvFx.y;
  float t = uTime * full;
  vec3 wc = lipC * vec3(0.66, 0.82, 0.92) + vec3(0.06, 0.09, 0.11);
  float yy = d * 1.0 - t * 2.1;
  float s1 = dioNoise(vec2(a * 7.0, yy * 1.3));
  float s2 = dioNoise(vec2(a * 19.0 + 3.0, yy * 2.6));
  float streak = s1 * 0.6 + s2 * 0.4;
  vec3 c = wc * (0.78 + 0.4 * streak);
  c = mix(c, FALL_FOAM, smoothstep(0.62, 0.86, streak) * mix(0.25, 0.6, full));
  float curl = 1.0 - smoothstep(0.0, 0.1 + 0.04 * s1, d);
  float footLevel = intoWater ? WATERLINE : 0.0;
  float churn = 1.0 - smoothstep(0.0, 0.16 + 0.12 * dioNoise(vec2(a * 5.0, t * 1.4)), abs(up - footLevel));
  if (!intoWater) churn = 1.0 - smoothstep(0.0, 0.2 + 0.12 * dioNoise(vec2(a * 5.0, t * 1.4)), up);
  c = mix(c, FALL_FOAM, max(curl * 0.55, churn * 0.85));
  // below the lower pool's surface the sheet is seen through its water
  if (intoWater && up < WATERLINE) c = mix(c, wc * 0.55, 0.6);
  return c;
}

void main() {
  dioGroundDepth();
  float vis = visionAt(vLip);
  // Under cloud (fogStyle clouds), the board keeps its plinth where nobody has
  // seen: it is dark, unpainted and the same everywhere, so it tells nothing,
  // and the bank sits on it instead of floating over the room.
  bool plinthOnly = vis <= 0.0 && uFogStyle.x > 0.5 && mod(vFlag + 0.25, 2.0) < 1.0
    && vWorld.y < uHeightRange.x - 0.05;
  if (!plinthOnly && dioUnseenFog(vis, vLip)) return;
  if (vis <= 0.0 && !plinthOnly) discard;
  vec3 n = normalize(vNormal);
  if (plinthOnly) {
    float yb0 = uHeightRange.x - 0.05;
    float g0 = smoothstep(yb0 - 1.0, yb0, vWorld.y);
    vec3 pl = uPlinth * (0.6 + 0.5 * g0) * (0.8 + 0.35 * max(dot(n, uKeyDir), 0.0)) * uAmbient;
    gl_FragColor = vec4(dioFinishFigure(heightGrade(pl, vWorld.y), vWorld), 1.0);
    return;
  }
  // the paint just inside the lip, on the top the face hangs from, not the
  // ground beyond its edge
  vec3 lipSharp = mapAt(vLip - n.xz * 0.05);
  vec3 lipC = mix(mapSoft(vLip - n.xz * 0.3), lipSharp, 0.18);
  int m = int(vMat + 0.5);
  float flag = vFlag;
  bool fall = flag >= 7.5;
  if (fall) flag -= 8.0;
  bool wet = flag >= 3.5;
  if (wet) flag -= 4.0;
  bool pit = flag >= 1.5;
  if (pit) flag -= 2.0;
  bool cut = flag < 0.5;      // the board's own edge: the map border, or void
  // derivatives up front: fwidth inside a branch is undefined
  float fwD = max(fwidth(vDepth), 1e-5);
  float fwY = max(fwidth(vWorld.y), 1e-5);
  float up = vDrop - vDepth;  // cells above the foot

  vec3 c = paintedSide(m, lipC, vAlong, vDepth, vWorld.y);
  // the top's own paint hangs over the lip in a ragged band: turf on earth,
  // a cap course on stone, none on planks
  float band = (m == 0 ? 0.08 : m == 4 ? 0.0 : 0.032) * (0.5 + dioNoise(vec2(vAlong * 7.0, 3.1)));
  c = mix(lipSharp * 0.95, c, smoothstep(band, band + fwD * 1.5, vDepth));
  // runs of grime from the lip, deepening toward the foot
  float drip = dioNoise(vec2(vAlong * 5.0, vWorld.y * 0.7));
  c *= 1.0 - 0.1 * drip * smoothstep(0.1, 0.9, vDepth);
  c *= mix(1.0, 0.6, smoothstep(0.0, 3.6, vDepth));
  if (cut) c *= 0.84;
  if (pit) c = mix(c, vec3(0.015, 0.012, 0.02), smoothstep(0.05, 1.4, vDepth));
  // snow lies along the lip, where the top's own cover hangs over the edge
  if (uEnvSurface.y > 0.001 && !fall) {
    float capDepth = (0.03 + 0.07 * uEnvSurface.y) * (0.6 + 0.8 * dioNoise(vec2(vAlong * 6.0, 1.7)));
    c = mix(c, DIO_SNOW * 0.92, smoothstep(0.25, 0.7, uEnvSurface.y) * (1.0 - smoothstep(capDepth, capDepth + fwD * 1.5, vDepth)));
  }
  // the waterline laps: the wet band breathes with the waves (full water)
  float lapLine = WATERLINE + uEnvFx.y * 0.035 * sin(uTime * 1.15 + vAlong * 2.3);
  if (wet) {
    float damp = 1.0 - smoothstep(lapLine, lapLine + 0.16, up);
    float under = 1.0 - smoothstep(WATERLINE - 0.015, WATERLINE + 0.015, up);
    c = mix(c, c * vec3(0.64, 0.72, 0.76), damp);
    c = mix(c, c * vec3(0.52, 0.68, 0.74), under);
  }
  if (fall) c = fallSheet(lipC, vAlong, vDepth, up, wet);
  float ao = 1.0;
  if (flag > 0.5 && !fall) ao = mix(0.4, 1.0, smoothstep(0.0, 0.4, up));
  vec3 lit = fall ? shadeBase(c, vWorld, n, ao, vWorld.xz + n.xz * 0.12) : shade(c, vWorld, n, ao, vWorld.xz + n.xz * 0.12);
  if (fall) {
    // the sheet's own sheen: a glint running down it where it faces the light
    float g = dioNoise(vec2(vAlong * 11.0, vDepth * 3.0 - uTime * uEnvFx.y * 2.6));
    lit += SUN_KEY * smoothstep(0.7, 0.95, g) * 0.25 * uAmbient * (0.4 + 0.6 * max(dot(n, uKeyDir), 0.0));
  }
  if (wet && !fall) {
    // sun thrown off the water, moving on the bank just above the line
    float near = 1.0 - smoothstep(0.0, 0.24, abs(up - lapLine - 0.06));
    lit += dioCaustic(vec2(vAlong * 2.7, vWorld.y * 5.0), uTime) * near * 0.2 * uAmbient;
  }
  // the lip itself: one device-px line of light where the top turns down
  float hair = 1.0 - smoothstep(fwD * 0.8, fwD * 2.0, vDepth);
  lit += (lit * 0.4 + vec3(0.055, 0.05, 0.045)) * hair * 0.75;
  if (cut) {
    // below the lowest ground, the board's plinth: dark, one trim line on top
    float yb = uHeightRange.x - 0.05;
    if (vWorld.y < yb) {
      float g = smoothstep(yb - 1.0, yb, vWorld.y);
      lit = uPlinth * (0.6 + 0.5 * g) * (0.8 + 0.35 * max(dot(n, uKeyDir), 0.0)) * uAmbient;
    }
    float trim =1.0 - smoothstep(fwY * 0.5, fwY * 1.5, abs(vWorld.y - yb));
    lit = mix(lit, uTrim * (0.55 + 0.45 * uAmbient), trim * 0.85);
  }
  lit = heightGrade(lit, vWorld.y);
  // the plinth is the table's, not the map's: no cloud creeps onto it
  bool plinth = cut && vWorld.y < uHeightRange.x - 0.05 && uFogStyle.x > 0.5 && uUseVision > 0.5;
  gl_FragColor = vec4(plinth ? dioFinishFigure(lit, vWorld) : dioFinish(lit, vis, vWorld), 1.0);
}
`;

export const WATER_VERT = /* glsl */ `
attribute float shore;
varying vec3 vWorld;
varying float vShore;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vShore = shore;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/*
 * Water keeps the map's own painted colour (a teal garden pool stays teal, a
 * blue harbour blue) and adds what paint cannot do: it moves. The bank
 * distance from the terrain field sets depth, so shallows show the bed and
 * open water deepens; the surface normal comes from drifting noise, which
 * bends the bed, throws sun glints and a little sky, and foam laces the bank
 * with soft lines rolling in toward it.
 */
export const WATER_FRAG = HEAD + UNSEEN + /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vShore;
/** terrain-field.mjs SHORE_RANGE: the bank distance is stored over this. */
const float SHORE_RANGE = 1.5;
const vec3 FOAM = vec3(0.93, 0.97, 0.99);
const vec3 GLINT = vec3(1.0, 0.95, 0.84);

/** The small waves' height: three drifting octaves. */
float waveH(vec2 p, float t) {
  return dioNoise(p * 1.6 + vec2(t * 0.20, t * 0.12)) * 0.5
       + dioNoise(p * 3.4 - vec2(t * 0.16, -t * 0.25)) * 0.3
       + dioNoise(p * 7.3 + vec2(-t * 0.31, t * 0.27)) * 0.2;
}

/** Rain on the water: rings from a jittered grid of drops, two layers. */
float ripples(vec2 p, float t, float amount) {
  float h = 0.0;
  for (int k = 0; k < 2; k++) {
    float fk = float(k);
    vec2 q = p * (3.1 + fk * 1.9) + fk * 7.31;
    vec2 cell = floor(q);
    vec2 f = fract(q);
    float rnd = dioHash(cell + fk * 13.0);
    vec2 c = vec2(dioHash(cell + 3.1), dioHash(cell + 5.7)) * 0.6 + 0.2;
    float life = fract(t * (0.8 + rnd * 0.7) + rnd * 3.0);
    float d = length(f - c) - life * 0.42;
    h += exp(-d * d * 900.0) * (1.0 - life) * step(rnd, amount);
  }
  return h;
}

/*
 * Full water (fx.water): the bed seen through it, bent by the waves, caustics
 * in the shallows, a little sky at grazing angles and sun glints. Waves roll IN
 * toward the bank (the field's shore distance) and break into a foam line that
 * breathes with them; a river's whole surface slides with the flow, streaked
 * along it; rain rings it; mist drifts over it at dawn and in fog.
 * Simple water: the map's own colour, flat and tinted, a still foam line.
 */
void main() {
  dioGroundDepth();
  float vis = visionAt(vWorld.xz);
  if (dioUnseenFog(vis, vWorld.xz)) return;
  if (vis <= 0.0) discard;
  vec2 p = vWorld.xz;
  float t = uTime;
  float shore = fieldAt(p).b * SHORE_RANGE;          // cells to the bank
  // a field-less board falls back to the mesh's own bank flag
  if (uFieldOn < 0.5) shore = mix(1.0, 0.0, smoothstep(0.5, 1.0, vShore));
  float deep = smoothstep(0.04, 1.2, shore);
  vec3 up = vec3(0.0, 1.0, 0.0);
  if (uEnvFx.y < 0.5) {
    vec3 col = mapSoft(p) * mix(vec3(0.92, 0.99, 1.0), vec3(0.6, 0.76, 0.84), deep);
    vec3 lit = shadeBase(col, vWorld, up, 1.0, p);
    lit = mix(lit, uEnvSky * uAmbient, 0.1);
    float edge = 1.0 - smoothstep(0.02, 0.09, shore);
    lit = mix(lit, FOAM * uAmbient, edge * 0.55);
    lit = heightGrade(lit, vWorld.y);
    gl_FragColor = vec4(dioFinish(lit, vis, vWorld), mix(0.72, 0.9, deep) + edge * 0.08);
    return;
  }
  // a river: everything rides the flow
  vec2 fdir = uEnvFlow.xy;
  float fspeed = uEnvFlow.z;
  vec2 pf = p - fdir * (fspeed * 1.1 * t);
  float e = 0.035;
  float h0 = waveH(pf, t);
  vec2 g = vec2(waveH(pf + vec2(e, 0.0), t) - h0, waveH(pf + vec2(0.0, e), t) - h0) / e;
  vec3 n = normalize(vec3(-g.x * 0.1, 1.0, -g.y * 0.1));

  vec3 under = mapAt(p + n.xz * (0.06 + 0.1 * deep));
  vec3 body = mapSoft(p);
  vec3 col = under * mix(vec3(0.95, 1.0, 1.0), vec3(0.6, 0.76, 0.84), deep);
  col = mix(col, body * vec3(0.5, 0.7, 0.8), deep * 0.32);
  col += dioCaustic(pf * 2.3, t) * (1.0 - deep * 0.7) * 0.11 * (1.0 - uEnvOvercast * 0.7);

  vec3 lit = shadeBase(col, vWorld, up, 1.0, p);
  float sh = shadowAt(vWorld, up);
  vec3 V = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
  lit = mix(lit, uEnvSky * uAmbient, fres * 0.4);
  float spec = pow(max(dot(n, normalize(uKeyDir + V)), 0.0), 160.0) * sh;
  lit += GLINT * mix(vec3(1.0), SUN_KEY, 0.5) * spec * 1.1 * uAmbient * (1.0 - uEnvOvercast * 0.75);

  // waves rolling in: bands whose phase falls toward the bank, broken by noise
  float swell = sin(shore * 15.0 + t * 1.6) * 0.5 + 0.5;
  float roll = smoothstep(0.78, 1.0, swell);
  roll *= (1.0 - smoothstep(0.06, 0.6, shore)) * smoothstep(0.28, 0.7, dioNoise(p * 3.7 + vec2(t * 0.12, 0.0)));
  // the foam line at the edge, pushed up the bank as each wave arrives
  float reach = 0.06 + 0.05 * (sin(t * 1.6) * 0.5 + 0.5) + 0.06 * dioNoise(p * 6.0 + t * 0.3);
  float lace = 1.0 - smoothstep(0.015, reach, shore);
  float foam = max(lace, roll * 0.6);
  // a river streaks along its flow
  if (fspeed > 0.01) {
    vec2 across = vec2(-fdir.y, fdir.x);
    float st = dioNoise(vec2((dot(p, fdir) - fspeed * 1.6 * t) * 1.4, dot(p, across) * 7.5));
    foam = max(foam, smoothstep(0.66, 0.86, st) * 0.45 * fspeed);
  }
  // rain rings: the sky caught in each ring
  if (uEnvFlow.w > 0.001) {
    float r = ripples(p, t, uEnvFlow.w);
    lit = mix(lit, mix(uEnvSky, FOAM, 0.5) * uAmbient, clamp(r, 0.0, 1.0) * 0.55);
  }
  lit = mix(lit, FOAM * uAmbient, foam * 0.7);
  float alpha = mix(0.7, 0.9, deep) + foam * 0.1;
  // mist over the water, drifting with the wind
  if (uEnvAtmo.w > 0.5 && uEnvSurface.z > 0.001) {
    vec2 drift = uEnvClouds.zw * (t * 0.12);
    float m = smoothstep(0.42, 0.85, dioFbm(p * 0.45 - drift)) * uEnvSurface.z;
    lit = mix(lit, uEnvFog.rgb * uAmbient * 1.05, m * 0.6);
    alpha = min(1.0, alpha + m * 0.2);
  }
  lit = heightGrade(lit, vWorld.y);
  gl_FragColor = vec4(dioFinish(lit, vis, vWorld), alpha);
}
`;

/* ---------------------------------------------------------------- walls */

export const WALL_VERT = /* glsl */ `
attribute float along;
attribute float len;
attribute vec2 perp;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;
varying float vLen;
varying vec2 vPerp;
varying float vBaseY;
varying float vTopY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vAlong = along;
  vLen = len;
  vPerp = normalize(mat3(modelMatrix) * vec3(perp.x, 0.0, perp.y)).xz;
  vBaseY = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).y;
  vTopY = (modelMatrix * vec4(0.0, 1.0, 0.0, 1.0)).y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const WALL_FRAG = HEAD + /* glsl */ `
uniform float uWallMat;
uniform float uOpacity;
uniform vec3 uTint;
uniform float uTintAmt;
uniform float uLocked;
uniform vec3 uGlyph;
varying vec3 vWorld;
varying vec3 vNormal;
varying float vAlong;
varying float vLen;
varying vec2 vPerp;
varying float vBaseY;
varying float vTopY;

const vec3 STONE = vec3(0.64, 0.62, 0.58);
const vec3 TIMBER = vec3(0.36, 0.24, 0.15);
const vec3 CAP = vec3(0.86, 0.83, 0.76);
const vec3 PLASTER = vec3(0.88, 0.84, 0.76);
const vec3 LOG = vec3(0.50, 0.36, 0.23);
const vec3 HEDGE = vec3(0.24, 0.42, 0.20);
const vec3 ROCK = vec3(0.45, 0.41, 0.37);
const vec3 IRON = vec3(0.16, 0.16, 0.18);

float boxMask(vec2 p, vec2 c, vec2 h) { vec2 d = abs(p - c) - h; return 1.0 - step(0.0, max(d.x, d.y)); }

vec3 wallAlbedo(int m, float a, float yl, float h, bool cap, vec3 mapC) {
  float y = vWorld.y;
  if (m == 5) return cap ? mapC * 1.12 : mapC * (0.92 + 0.08 * smoothstep(0.0, 0.3, yl));
  if (m == 1) {
    if (cap) return TIMBER;
    vec3 c = PLASTER * (0.93 + 0.1 * dioFbm(vec2(a, y) * 3.0));
    if (yl < 0.12) c = TIMBER * 0.8;
    if (h - yl < 0.07) c = TIMBER;
    return c;
  }
  if (m == 2) {
    float f = fract(a / 0.17);
    float id = floor(a / 0.17);
    vec3 c = LOG * (0.8 + 0.3 * dioHash(vec2(id, 1.0)));
    if (cap) return mix(c * 1.3, c * 0.8, smoothstep(0.2, 0.5, abs(fract(length(vec2(f - 0.5, 0.0)) * 3.0) - 0.5)));
    c *= 0.62 + 0.5 * sin(f * 3.14159);
    c *= 0.88 + 0.2 * dioNoise(vec2(a * 20.0, y * 3.0));
    return c;
  }
  if (m == 3) {
    float leaf = dioFbm(vec2(a, y) * 9.0 + vNormal.xz * 3.0);
    vec3 c = mix(HEDGE * 0.55, HEDGE * 1.25, leaf);
    c = mix(c, HEDGE * 0.35, smoothstep(0.55, 0.3, dioNoise(vec2(a, y) * 22.0)) * 0.5);
    return cap ? c * 1.1 : c;
  }
  if (m == 4) {
    float r = dioFbm(vec2(a * 1.6, y * 2.2));
    vec3 c = mix(ROCK * 0.7, ROCK * 1.15, r) * mix(vec3(1.0), mapC, 0.25);
    c *= 0.85 + 0.25 * smoothstep(0.45, 0.7, dioNoise(vec2(a, y) * 6.0 + 2.0));
    return cap ? c * 1.15 : c;
  }
  if (m == 6) {
    float board = fract(a / 0.16);
    vec3 c = LOG * (0.82 + 0.25 * dioHash(vec2(floor(a / 0.16), 4.0)));
    c *= 0.9 + 0.12 * dioNoise(vec2(a * 30.0, y * 2.0));
    c = mix(c, c * 0.45, 1.0 - smoothstep(0.03, 0.08, board));
    float band = max(boxMask(vec2(a, yl), vec2(vLen * 0.5, h * 0.22), vec2(vLen, 0.035)),
                     boxMask(vec2(a, yl), vec2(vLen * 0.5, h * 0.78), vec2(vLen, 0.035)));
    c = mix(c, IRON, band);
    if (uLocked > 0.5) {
      vec2 g = vec2(a - vLen * 0.5, yl - h * 0.5) / max(0.12, min(vLen, h) * 0.22);
      float body = boxMask(g, vec2(0.0, -0.2), vec2(0.55, 0.42));
      float ring = smoothstep(0.12, 0.0, abs(length(g - vec2(0.0, 0.25)) - 0.36)) * step(0.15, g.y);
      c = mix(c, uGlyph, max(body, ring));
    }
    return cap ? c * 0.8 : c;
  }
  // stone: coursed blocks, timber posts, pale cap
  if (cap) return CAP;
  if (h - yl < 0.06) return CAP * 0.92;
  float post = min(fract(a / 1.5) * 1.5, vLen - a);
  if (post < 0.09 || a < 0.09) return TIMBER * (0.85 + 0.2 * dioNoise(vec2(a * 40.0, y * 3.0)));
  float rowH = 0.2;
  float row = floor(y / rowH);
  float bx = (a + mod(row, 2.0) * 0.2) / 0.4;
  vec2 f = vec2(fract(bx), fract(y / rowH));
  float mortar = max(1.0 - smoothstep(0.03, 0.07, f.x), 1.0 - smoothstep(0.05, 0.11, f.y));
  vec3 s = STONE * (0.8 + 0.25 * dioHash(vec2(floor(bx), row)));
  s *= 1.0 + 0.1 * smoothstep(0.7, 1.0, f.y);
  return mix(s, s * 0.5, mortar);
}

void main() {
  float vis = max(visionAt(vWorld.xz + vPerp * 0.16), visionAt(vWorld.xz - vPerp * 0.16));
  if (vis <= 0.0) discard;
  vec3 n = normalize(vNormal);
  bool cap = n.y > 0.5;
  float h = max(0.001, vTopY - vBaseY);
  float yl = vWorld.y - vBaseY;
  vec3 mapC = mapAt(vWorld.xz);
  vec3 c = wallAlbedo(int(uWallMat + 0.5), vAlong, yl, h, cap, mapC);
  c = mix(c, uTint, uTintAmt);
  float ao = mix(0.62, 1.0, smoothstep(0.0, 0.3, yl));
  vec2 lxz = cap ? vWorld.xz : vWorld.xz + n.xz * 0.14;
  vec3 lit = shade(c, vWorld, n, ao, lxz);
  if (cap) lit = max(lit, shade(c, vWorld, n, ao, vWorld.xz + vPerp * 0.14));
  gl_FragColor = vec4(dioFinish(lit, vis, vWorld), uOpacity);
}
`;

/* ---------------------------------------------------------------- standees */

/*
 * A card leans back about its feet to meet the camera, so its upper half would
 * physically push into a wall or pillar standing behind the token and be sliced
 * by it. And at a steep pitch the lean makes the card taller on screen than the
 * token really is, so its head is drawn over pixels that belong to a wall rising
 * behind the token: neither the leaned depth, nor the foot's depth, nor the
 * card's upright depth wins there.
 *
 * So the picture keeps the lean and the DEPTH is the token's own STAND PLANE:
 * the vertical plane through the foot, square to the camera's heading. Each
 * vertex is slid along its view ray onto that plane, nudged towards the camera.
 * Everything behind the token is behind the plane and everything in front is in
 * front of it, so a card is hidden only by what stands in front of its token,
 * and two cards sort by their tokens. The camera is orthographic, so the slide
 * is affine and exact per vertex. The shadow caster is a separate mesh and keeps
 * its real depth.
 *
 * The quad is grown by uMargin (a fraction of the card, per side) so the outline
 * drawn outside the art has somewhere to land; the renderer sizes the margin in
 * device pixels every frame, so it never eats into the art and never runs out.
 */
export const CARD_DEPTH_NUDGE = 0.25;
export const CARD_VERT = /* glsl */ `
uniform vec2 uMargin;
varying vec2 vUv;
varying vec3 vFoot;
void main() {
  vUv = uv * (1.0 + 2.0 * uMargin) - uMargin;
  vFoot = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 grown = vec3(position.x * (1.0 + 2.0 * uMargin.x), position.y * (1.0 + 2.0 * uMargin.y) - uMargin.y, position.z);
  vec4 world = modelMatrix * vec4(grown, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
  // The camera's forward axis in world space (orthographic: one for every pixel).
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 n = normalize(vec3(fwd.x, 0.0, fwd.z) + vec3(1e-4, 0.0, 0.0));
  float t = -dot(world.xyz - vFoot, n) / max(dot(fwd, n), 0.05);
  vec4 standView = viewMatrix * vec4(world.xyz + t * fwd, 1.0);
  standView.z += ${CARD_DEPTH_NUDGE.toFixed(2)};
  vec4 standClip = projectionMatrix * standView;
  gl_Position.z = standClip.z / standClip.w * gl_Position.w;
}
`;

/*
 * The figure and its outline. The card texture is the bare art; the outline is
 * the art's alpha dilated by uOutline.a DEVICE pixels (fwidth turns pixels into
 * texture units), so it is a crisp ~2 px line at every zoom and never a slab.
 * One program, three jobs, chosen by uMode so nothing compiles at runtime:
 *   0  the card: art, lit, inside its line (alpha to coverage on the edge)
 *   1  x-ray: drawn only where something hides the card (GreaterDepth), the
 *      line and a faint silhouette, so a figure behind a wall still reads
 *   2  glow: a soft halo outside the line (targeted)
 * The line is unlit: ink at rest, the state colour otherwise, at any darkness.
 */
export const CARD_FRAG = NOISE + MAP + LIT + /* glsl */ `
uniform sampler2D uCard;
uniform float uOpacity;
uniform float uGhost;
uniform float uLift;
uniform vec3 uFacing;
uniform vec4 uOutline;
uniform float uGlow;
uniform float uMode;
varying vec2 vUv;
varying vec3 vFoot;
float cardA(vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture2D(uCard, uv).a * inside.x * inside.y;
}
float dilate(vec2 uv, vec2 px, float r) {
  float d = 0.0;
  for (int i = 0; i < 12; i++) {
    float an = float(i) * 0.5235988;
    vec2 o = vec2(cos(an), sin(an)) * px;
    d = max(d, cardA(uv + o * r));
    d = max(d, cardA(uv + o * (r * 0.5)));
  }
  return d;
}
void main() {
  vec2 px = fwidth(vUv);
  float art = cardA(vUv);
  float line = max(dilate(vUv, px, uOutline.a), art);
  float artCov = smoothstep(0.3, 0.7, art);
  float lineCov = smoothstep(0.2, 0.6, line);
  if (uMode > 1.5) {
    float g = 0.0;
    for (int i = 0; i < 12; i++) {
      float an = float(i) * 0.5235988 + 0.2618;
      vec2 o = vec2(cos(an), sin(an)) * px;
      g += cardA(vUv + o * (uOutline.a + 2.5)) + cardA(vUv + o * (uOutline.a + 6.0));
    }
    float a = (g / 24.0) * (1.0 - lineCov) * uGlow;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uOutline.rgb, a);
    return;
  }
  if (uMode > 0.5) {
    float a = (max(lineCov - artCov, 0.0) * 0.85 + artCov * 0.12) * uOpacity;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uOutline.rgb, a);
    return;
  }
  if (lineCov < 0.01) discard;
  vec4 c = texture2D(uCard, clamp(vUv, 0.0, 1.0));
  // Sampled a little towards the sun, out of the card's own cast shadow.
  vec3 p = vFoot + vec3(0.0, 0.35, 0.0) + uKeyDir * 0.45;
  // Cards keep their art: lit as open ground in the sun, the cool fill in a shadow.
  vec3 sun = sunlight(vec3(0.0, 1.0, 0.0), shadowAt(p, vec3(0.0, 1.0, 0.0)));
  sun = mix(vec3(uAmbient), sun, 0.75);
  vec3 paint = c.rgb / max(c.a, 0.05);
  vec3 lit = paint * (sun + torchLight(lightAt(vFoot.xz), p, uFacing) + effectLight(p, uFacing));
  // Torch rim: the edge of the figure on the side of its strongest torch catches
  // a line of that light, about 2.5 device px (fwidth), brightest when the torch
  // stands behind the figure. A paper cut-out lit from the side reads as standing
  // in the room's light rather than pasted over it.
  vec3 tl;
  vec4 tk = torchKey(p, tl);
  if (tk.a > 0.002 && uTorchDir > 0.0) {
    vec3 right = vec3(uFacing.z, 0.0, -uFacing.x);
    float behind = max(-dot(tl, uFacing), 0.0);
    vec2 sd = vec2(dot(tl, right), 0.35 + 0.65 * max(tl.y, 0.0) * (0.5 + behind));
    float sl = length(sd);
    if (sl > 0.05) {
      float rim = artCov * (1.0 - smoothstep(0.15, 0.55, cardA(vUv + sd / sl * px * 2.5)));
      lit += (paint * 0.5 + 0.5) * tk.rgb * rim * (0.35 + 0.9 * behind) * 1.5 * uTorchDir;
    }
  }
  lit *= 1.0 + uLift;
  vec3 col = mix(uOutline.rgb, dioFinishFigure(lit, vFoot + vec3(0.0, 0.6, 0.0)), artCov);
  float a = lineCov;
  if (uGhost > 0.5) {
    float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 9.0));
    col = mix(col, col * 0.55 + vec3(0.2), hatch * 0.6);
    a *= uOpacity;
  }
  gl_FragColor = vec4(col, a);
}
`;

/** Flat-shaded solid colour under the shared light (standee bases). */
export const SOLID_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SOLID_FRAG = NOISE + MAP + LIT + /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 lit = shade(uColor, vWorld, n, 1.0, vWorld.xz);
  gl_FragColor = vec4(dioFinish(lit, 1.0, vWorld), uOpacity);
}
`;

/* ---------------------------------------------------------------- unlit */

/** Textured / tinted quad, no lighting (HUD plates, effects, dots). */
export const UNLIT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const UNLIT_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uUseTex;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 c = uUseTex > 0.5 ? texture2D(uTex, vUv) : vec4(1.0);
  c.rgb *= uColor;
  c.a *= uOpacity;
  if (c.a <= 0.003) discard;
  gl_FragColor = c;
}
`;

/** A procedural ring / disc on a unit quad (bases, turn rings, pings, shadows). */
export const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uInner;
uniform float uOuter;
uniform float uSoft;
uniform float uFill;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(uInner - uSoft, uInner, r) * (1.0 - smoothstep(uOuter, uOuter + uSoft, r));
  float disc = 1.0 - smoothstep(uOuter - uSoft, uOuter + uSoft, r);
  float a = mix(ring, disc * (1.0 - r * 0.7), uFill) * uOpacity;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/* ---------------------------------------------------------------- flight */

/** A flyer's glass stand: the column from the ground up to its base. */
export const GLASS_VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/*
 * Clear glass: almost nothing face-on, bright at the silhouette (fresnel), one
 * sharp highlight on the sun's side, and a hairline tick etched every cell of
 * height (one grid distance), counted up from the ground, so a glance gives the
 * altitude. Ticks are device pixels (fwidth), never cells.
 */
export const GLASS_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uGround;
uniform vec3 uKeyDir;
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec3 n = normalize(vNormal);
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(n, v)), 2.0);
  vec2 sun = normalize(uKeyDir.xz + vec2(1e-5));
  float streak = smoothstep(0.82, 0.97, dot(normalize(n.xz + vec2(1e-5)), sun));
  float h = vWorld.y - uGround;
  float fw = max(fwidth(h), 1e-5);
  float tick = (1.0 - smoothstep(0.5, 1.5, abs(fract(h + 0.5) - 0.5) / fw)) * step(0.5, h);
  vec3 glass = mix(vec3(0.86, 0.93, 1.0), uColor, 0.3);
  vec3 col = glass * (0.6 + 0.5 * fres) + vec3(0.9) * streak * 0.5 + vec3(1.0) * tick * 0.35;
  float a = 0.08 + 0.5 * fres + 0.45 * streak + 0.5 * tick;
  gl_FragColor = vec4(min(col, vec3(1.0)), clamp(a, 0.0, 1.0) * uOpacity);
}
`;

/*
 * The squares a flyer is over, on the ground under it: a soft inner glow from
 * the rim, a crisp outline, heavier corner brackets and, for a creature larger
 * than one square, faint lines between its squares. Every line is device
 * pixels (fwidth on the cell coordinate).
 */
export const FOOTPRINT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSize;
varying vec2 vUv;
void main() {
  vec2 p = vUv * uSize;
  vec2 fw = max(fwidth(p), vec2(1e-5));
  vec2 toEdge = min(p, vec2(uSize) - p);
  vec2 e = toEdge / fw;
  float edgePx = min(e.x, e.y);
  float outline = 1.0 - smoothstep(0.8, 1.9, edgePx);
  float corner = step(max(toEdge.x, toEdge.y), 0.24);
  float bracket = (1.0 - smoothstep(2.2, 3.4, edgePx)) * corner;
  vec2 d = abs(fract(p + 0.5) - 0.5) / fw;
  float inner = (1.0 - smoothstep(0.4, 1.3, min(d.x, d.y))) * step(1.5, uSize) * 0.3;
  float glow = exp(-min(toEdge.x, toEdge.y) * 7.0) * 0.32 + 0.07;
  float a = clamp(max(max(outline * 0.85, bracket), inner) + glow, 0.0, 1.0) * uOpacity;
  if (a <= 0.003) discard;
  vec3 col = mix(uColor, vec3(1.0), max(outline, bracket) * 0.3);
  gl_FragColor = vec4(col, a);
}
`;

/* ---------------------------------------------------------------- targeting */

/*
 * The target reticle, flat on the ground under a targeted token and turned to
 * the camera: a ring with four gaps at the camera's cardinals, a short tick into
 * each gap, and four arrowheads outside it on the diagonals, pointing in. The
 * arrows breathe by uBreathe device pixels (the renderer writes a whole-period
 * sine on the shared clock). Every line is device pixels; a thin ink under-stroke
 * keeps it readable on pale ground. The quad spans ±1 in vUv*2-1; the ring sits
 * at RET_R of that.
 */
export const RETICLE_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uBreathe;
varying vec2 vUv;
float tri(vec2 p, float s) {
  // an arrowhead pointing to -y, apex at the origin, s tall, s wide
  float k = max(abs(p.x) * 2.0 - (p.y), -p.y);
  return max(k, p.y - s);
}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float pxr = max(fwidth(r), 1e-5);
  const float R = 0.62;
  // ring, broken at the four cardinals
  float ang = atan(p.y, p.x);
  float toCard = abs(mod(ang + 0.7853982, 1.5707963) - 0.7853982);
  float gap = smoothstep(0.075, 0.105, toCard);
  float dRing = abs(r - R) / pxr;
  float ring = (1.0 - smoothstep(0.9, 1.9, dRing)) * gap;
  float under = (1.0 - smoothstep(2.2, 3.6, dRing)) * gap;
  // a short tick into each gap, pointing inward
  float tickLen = step(R - 0.11, r) * step(r, R + 0.012);
  float dTick = toCard * r / pxr;
  float tick = (1.0 - smoothstep(0.8, 1.8, dTick)) * tickLen;
  float tickUnder = (1.0 - smoothstep(2.0, 3.4, dTick)) * tickLen;
  // arrowheads on the diagonals, apex towards the centre
  vec2 q = abs(p);
  vec2 dir = vec2(0.7071068);
  float along = dot(q, dir);
  float across = q.x * dir.y - q.y * dir.x;
  float apex = R + 0.1 + uBreathe * pxr;
  vec2 lp = vec2(across, along - apex);
  float s = 0.15;
  float dTri = tri(lp, s) / pxr;
  float arrow = 1.0 - smoothstep(-0.5, 0.7, dTri);
  float arrowUnder = 1.0 - smoothstep(0.5, 2.2, dTri);
  float fill = (1.0 - smoothstep(R - 0.02, R, r)) * 0.1;
  float shape = max(max(ring, tick), arrow);
  float shadow = max(max(under, tickUnder), arrowUnder) * 0.55;
  vec3 ink = vec3(0.01, 0.03, 0.05);
  // fill, then the ink under-stroke over it, then the line over both
  float a = shadow + fill * (1.0 - shadow);
  vec3 col = (ink * shadow + uColor * fill * (1.0 - shadow)) / max(a, 1e-4);
  vec3 line = mix(uColor, vec3(1.0), 0.12);
  float a2 = shape + a * (1.0 - shape);
  col = (line * shape + col * a * (1.0 - shape)) / max(a2, 1e-4);
  if (a2 * uOpacity <= 0.003) discard;
  gl_FragColor = vec4(col, a2 * uOpacity);
}
`;

/*
 * A target line: a raised arc from the source's chest to the target's base,
 * drawn as a ribbon of constant DEVICE-pixel width. Each vertex carries its
 * point on the curve (position), the next point (aNext), which side of the line
 * it is (aSide, -1 / 1) and how far along (aAlong, 0..1). The vertex shader
 * offsets it across the curve's screen direction by uWidth px; uViewport is the
 * drawing buffer in device px. A bright core, a soft body, a glint that runs
 * from source to target once per TIMING.linkGlint (uPhase 0..1).
 */
export const LINK_VERT = /* glsl */ `
uniform vec2 uViewport;
uniform float uWidth;
attribute vec3 aNext;
attribute float aSide;
attribute float aAlong;
varying float vSide;
varying float vAlong;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(aNext, 1.0);
  vec2 sa = a.xy / a.w * uViewport, sb = b.xy / b.w * uViewport;
  vec2 d = sb - sa;
  float l = length(d);
  vec2 n = l > 1e-4 ? vec2(-d.y, d.x) / l : vec2(0.0, 1.0);
  vec2 off = n * aSide * uWidth / uViewport;
  gl_Position = vec4(a.xy + off * a.w, a.z, a.w);
  vSide = aSide;
  vAlong = aAlong;
}
`;

export const LINK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uPhase;
varying float vSide;
varying float vAlong;
void main() {
  float x = abs(vSide);
  float px = max(fwidth(vSide), 1e-5);
  float body = 1.0 - smoothstep(1.0 - px * 1.2, 1.0, x);
  float core = 1.0 - smoothstep(0.3, 0.3 + px * 1.5, x);
  float g = vAlong - uPhase;
  g -= floor(g + 0.5);
  float glint = exp(-g * g * 900.0);
  // fade in off the source's chest and settle onto the target's base
  float ends = smoothstep(0.0, 0.06, vAlong) * (0.55 + 0.45 * smoothstep(1.0, 0.92, vAlong));
  vec3 col = mix(uColor * 0.9, vec3(1.0), core * 0.7 + glint * 0.6);
  // an ink rim on the outer edge, so the line reads on pale ground too
  float rim = smoothstep(0.66, 0.86, x) * (1.0 - glint);
  col = mix(col, vec3(0.01, 0.03, 0.05), rim * 0.7);
  float a = (body * (0.72 + 0.28 * core) + glint * 0.3 * body) * ends * uOpacity;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(min(col, vec3(1.0)), min(a, 1.0));
}
`;

/** Per-vertex rgba (path ribbons, cell fills and outlines, rulers). */
export const RIBBON_VERT = /* glsl */ `
attribute vec4 rgba;
varying vec4 vColor;
void main() {
  vColor = rgba;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const RIBBON_FRAG = /* glsl */ `
uniform float uOpacity;
varying vec4 vColor;
void main() {
  gl_FragColor = vec4(vColor.rgb, vColor.a * uOpacity);
}
`;

/* ---------------------------------------------------------------- frame */

/** Full-screen backdrop behind the diorama. */
export const BACKDROP_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}
`;

export const BACKDROP_FRAG = NOISE + /* glsl */ `
uniform vec3 uTop;
uniform vec3 uBottom;
uniform vec3 uEnvBack;   // the hour's sky, faintly, over the room around the table (1 = none)
varying vec2 vUv;
void main() {
  vec3 c = mix(uBottom, uTop * uEnvBack, smoothstep(0.0, 1.0, vUv.y));
  float v = length(vUv - vec2(0.5, 0.55));
  c *= 1.0 - 0.35 * smoothstep(0.3, 0.85, v);
  // a dark, wide gradient bands in 8 bits: dither it by half a level
  c += (dioHash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
`;

/**
 * The board's shadow on the table it stands on: a soft rounded box under the
 * plinth, pushed away from the sun. It is what makes the diorama an object.
 */
export const TABLE_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vXZ = wp.xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const TABLE_FRAG = NOISE + /* glsl */ `
uniform vec4 uBounds;   // x0, z0, x1, z1 in cells
uniform vec3 uKeyDir;
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vXZ;
void main() {
  vec2 away = -normalize(uKeyDir.xz + vec2(1e-4));
  vec2 c = (uBounds.xy + uBounds.zw) * 0.5 + away * 0.9;
  vec2 halfSize = (uBounds.zw - uBounds.xy) * 0.5;
  vec2 q = abs(vXZ - c) - halfSize + 0.8;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.8;
  float a = (1.0 - smoothstep(-0.6, 3.4, d)) * uOpacity;
  a = max(a + (dioHash(gl_FragCoord.xy) - 0.5) / 255.0, 0.0);
  gl_FragColor = vec4(uColor, a);
}
`;

/** Depth-only pass for the key light's shadow map. */
export const DEPTH_VERT = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const DEPTH_FRAG = /* glsl */ `
void main() {
  gl_FragColor = vec4(1.0);
}
`;

/** Full-screen pass vertex: a 2-triangle quad in clip space. */
export const POST_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/**
 * One direction of the tilt-shift gaussian. The blur radius grows with the
 * distance from a horizontal focus band.
 */
export const BLUR_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform vec2 uDir;
uniform vec2 uFocus;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float off = abs(vUv.y - uFocus.x);
  float k = smoothstep(uFocus.y, uFocus.y + 0.32, off) * uStrength;
  if (k < 0.01) { gl_FragColor = texture2D(uTex, vUv); return; }
  vec4 sum = vec4(0.0);
  float wsum = 0.0;
  for (int i = -6; i <= 6; i++) {
    float x = float(i);
    float w = exp(-x * x / 18.0);
    sum += texture2D(uTex, vUv + uDir * uTexel * x * k * 1.25) * w;
    wsum += w;
  }
  gl_FragColor = sum / wsum;
}
`;

/* ---------------------------------------------------------------- weather */

/*
 * Weather particles: ONE instanced draw for whichever kind is falling. Every
 * instance carries only a random seed (aSeed); where it is, how it moves and
 * what it looks like are computed here from that seed and the shared clock, so
 * the CPU does nothing per particle per frame. Positions wrap inside a box
 * around the camera's target (uBoxMin/uBoxSize), which the layer sizes from the
 * zoom, so the density on screen is the same at every zoom; sizes scale with
 * the view (uPScale) for the same reason. What falls below the ground (the
 * height texture, one texel per sub-cell) or leaves the board is dropped.
 * uKind: 1 rain, 2 snow, 3 leaves, 4 petals, 5 embers, 6 ash, 7 sand, 8 fireflies.
 * Output is premultiplied: lit kinds cover, glowing kinds (vGlow) add.
 */
const GROUND_AT = /* glsl */ `
uniform sampler2D uHeightTex;
uniform vec3 uHeightInfo;   // sub-columns, sub-rows, sub-cells per cell
/** The top under a point (cells); far below for off the board or void. */
float groundAt(vec2 xz) {
  vec2 uv = xz * uHeightInfo.z / max(uHeightInfo.xy, vec2(1.0));
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -1000.0;
  return texture2D(uHeightTex, uv).r;
}
`;

export const PARTICLE_VERT = NOISE + GROUND_AT + /* glsl */ `
uniform float uKind;
uniform float uEnvTime;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec4 uPWind;        // xy wind direction (unit), z strength 0..1
uniform float uPScale;      // the view's size: visible height in cells / 12
uniform float uPPx;         // one device pixel, in cells: nothing draws thinner
uniform float uAmbient;
uniform vec3 uEnvFill;
uniform vec3 uEnvKey;
uniform float uEnvFlash;
uniform vec4 uPTint;        // rgb, a = how much of it
attribute vec4 aSeed;
varying vec2 vQ;
varying vec3 vCol;
varying float vAlpha;
varying float vGlow;

vec3 wrapBox(vec3 q) { return uBoxMin + mod(q - uBoxMin, uBoxSize); }

void main() {
  vec4 s = aSeed;
  float t = uEnvTime;
  int kind = int(uKind + 0.5);
  vec2 wind = uPWind.xy * uPWind.z;
  vec3 base = s.xyz * uBoxSize;
  vec3 p = vec3(0.0);
  vec3 vel = vec3(0.0, -1.0, 0.0);
  vec3 col = vec3(1.0);
  bool streak = false;
  bool local = false;      // y follows the ground under it (sand, fireflies)
  float size = 0.04;
  float len = 0.0;
  float alpha = 1.0;
  float glow = 0.0;
  float spin = 0.0;
  float squash = 1.0;
  if (kind == 1) {
    vel = vec3(wind.x * 6.0, -13.0 - s.w * 4.0, wind.y * 6.0);
    p = wrapBox(base + vel * t);
    streak = true; len = 0.3 + 0.22 * s.w; size = 0.011;
    col = vec3(0.80, 0.86, 0.94); alpha = 0.7;
  } else if (kind == 2 || kind == 6) {
    float fallV = kind == 2 ? 0.85 + s.w * 0.55 : 0.38 + s.w * 0.3;
    vel = vec3(wind.x * 2.4, -fallV, wind.y * 2.4);
    p = wrapBox(base + vel * t);
    p.x += sin(t * (1.1 + s.w) + s.x * 40.0) * 0.16;
    p.z += cos(t * (0.9 + s.w * 0.7) + s.z * 33.0) * 0.16;
    size = kind == 2 ? 0.032 + s.w * 0.03 : 0.026 + s.w * 0.02;
    col = kind == 2 ? vec3(0.97, 0.98, 1.0) : mix(vec3(0.30, 0.29, 0.28), vec3(0.62, 0.60, 0.58), s.w);
    alpha = kind == 2 ? 0.92 : 0.8;
  } else if (kind == 3 || kind == 4) {
    float fallV = kind == 3 ? 0.65 + s.w * 0.4 : 0.42 + s.w * 0.3;
    vel = vec3(wind.x * 2.6 + 0.12, -fallV, wind.y * 2.6 + 0.08);
    p = wrapBox(base + vel * t);
    p.x += sin(t * 1.3 + s.w * 50.0) * 0.32;
    p.z += cos(t * 1.1 + s.y * 40.0) * 0.24;
    spin = t * (1.3 + s.w * 2.0) + s.x * 6.2831853;
    squash = 0.22 + 0.78 * abs(cos(t * (1.9 + s.y * 1.4) + s.z * 6.2831853));
    size = kind == 3 ? 0.07 + s.w * 0.04 : 0.045 + s.w * 0.025;
    if (kind == 3) {
      vec3 a = mix(vec3(0.86, 0.40, 0.11), vec3(0.95, 0.70, 0.18), smoothstep(0.0, 0.5, s.w));
      col = mix(a, vec3(0.62, 0.19, 0.10), smoothstep(0.6, 1.0, s.w));
    } else {
      col = mix(vec3(1.0, 0.76, 0.86), vec3(0.99, 0.94, 0.96), s.w);
    }
  } else if (kind == 5) {
    vel = vec3(wind.x * 1.4, 1.1 + s.w * 1.2, wind.y * 1.4);
    p = wrapBox(base + vel * t);
    p.x += sin(t * 2.3 + s.x * 30.0) * 0.12;
    p.z += cos(t * 1.9 + s.z * 30.0) * 0.12;
    size = 0.02 + s.w * 0.022;
    float flick = 0.6 + 0.4 * sin(t * (7.0 + s.w * 6.0) + s.y * 50.0);
    col = mix(vec3(1.0, 0.36, 0.07), vec3(1.0, 0.76, 0.32), s.w) * flick * 1.3;
    glow = 1.0;
    alpha = 1.0 - smoothstep(0.5, 1.0, (p.y - uBoxMin.y) / uBoxSize.y);
  } else if (kind == 7) {
    vec2 d = length(uPWind.xy) > 0.01 ? normalize(uPWind.xy) : vec2(1.0, 0.0);
    float sp = (5.0 + 9.0 * uPWind.z) * (0.8 + 0.4 * s.w);
    vec2 xz = uBoxMin.xz + mod(base.xz + d * sp * t - uBoxMin.xz, uBoxSize.xz);
    p = vec3(xz.x, groundAt(xz) + 0.04 + s.y * s.y * 1.6 + sin(t * 2.0 + s.x * 20.0) * 0.06, xz.y);
    vel = vec3(d.x * sp, 0.0, d.y * sp);
    streak = true; local = true; len = 0.16 + 0.3 * s.w; size = 0.012;
    col = mix(vec3(0.80, 0.66, 0.44), vec3(0.94, 0.83, 0.62), s.w); alpha = 0.5;
  } else {
    vec3 home = wrapBox(base);
    vec2 xz = home.xz + vec2(sin(t * 0.37 + s.w * 20.0), cos(t * 0.29 + s.x * 17.0)) * 0.45;
    p = vec3(xz.x, groundAt(xz) + 0.2 + s.y * 1.1 + sin(t * 0.8 + s.z * 9.0) * 0.12, xz.y);
    float blink = pow(max(sin(t * (0.6 + s.w * 0.5) + s.x * 37.0), 0.0), 5.0);
    local = true; size = 0.026 + s.w * 0.016;
    col = vec3(0.86, 1.0, 0.45) * (0.2 + 1.7 * blink);
    glow = 1.0;
  }
  if (glow < 0.5) {
    col = mix(col, uPTint.rgb * (0.4 + dot(col, vec3(0.333))), uPTint.a);
    col *= uAmbient * (uEnvFill * 1.05 + uEnvKey * 0.55) + vec3(uEnvFlash * 0.8);
  }
  // fade at the box's sides (it moves with the camera) and drop what is under ground
  vec3 lo = p - uBoxMin, hi = uBoxMin + uBoxSize - p;
  float edge = min(min(lo.x, hi.x), min(lo.z, hi.z)) / max(0.1 * min(uBoxSize.x, uBoxSize.z), 1e-3);
  alpha *= clamp(edge, 0.0, 1.0);
  float g = groundAt(p.xz);
  bool dead = g < -999.0 || (!local && p.y < g - 0.02) || alpha < 0.003;
  vAlpha = alpha;
  vCol = col;
  vGlow = glow;
  // a drop or a flake is never under a device pixel across, or it flickers away
  float w = max(size * uPScale, uPPx * (streak ? 0.9 : 1.5));
  vec4 vh = viewMatrix * vec4(p, 1.0);
  vec3 pos;
  if (streak) {
    vec3 tail = p - normalize(vel) * len * mix(1.0, uPScale, 0.5);
    vec4 vt = viewMatrix * vec4(tail, 1.0);
    vec2 d = vt.xy - vh.xy;
    float L = length(d);
    vec2 dir = L > 1e-5 ? d / L : vec2(0.0, 1.0);
    // a streak seen end-on still reads as a drop
    if (L < w * 3.0) vt.xy = vh.xy + dir * w * 3.0;
    pos = mix(vh.xyz, vt.xyz, position.y);
    pos.xy += vec2(-dir.y, dir.x) * position.x * w;
    vQ = position.xy;
  } else {
    vec2 c = vec2(position.x, position.y * 2.0 - 1.0);
    vQ = c;
    vec2 q = vec2(c.x * squash, c.y);
    float cs = cos(spin), sn = sin(spin);
    pos = vh.xyz + vec3(vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * w, 0.0);
  }
  gl_Position = dead ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(pos, 1.0);
}
`;

export const PARTICLE_FRAG = /* glsl */ `
uniform float uKind;
uniform float uPOpacity;
varying vec2 vQ;
varying vec3 vCol;
varying float vAlpha;
varying float vGlow;
void main() {
  int kind = int(uKind + 0.5);
  float a;
  vec3 col = vCol;
  if (kind == 1 || kind == 7) {
    // a streak: bright at the leading drop, thinning to the tail
    a = (1.0 - vQ.x * vQ.x) * smoothstep(0.0, 0.12, vQ.y) * (1.0 - vQ.y);
  } else if (kind == 3 || kind == 4) {
    // an almond with a midrib
    float hw = (1.0 - vQ.y * vQ.y) * (kind == 3 ? 0.55 : 0.8);
    a = 1.0 - smoothstep(hw - 0.14, hw, abs(vQ.x));
    if (kind == 3) col *= 0.78 + 0.22 * smoothstep(0.02, 0.12, abs(vQ.x));
  } else {
    float r = length(vQ);
    if (vGlow > 0.5) {
      a = exp(-r * r * 5.0) * (1.0 - smoothstep(0.75, 1.0, r));
      col += vec3(0.45) * exp(-r * r * 30.0);
    } else {
      a = 1.0 - smoothstep(0.4, 1.0, r);
    }
  }
  a *= vAlpha * uPOpacity;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col * a, a * (1.0 - vGlow));
}
`;

/*
 * Rain landing: rings on the ground and on water, one instanced draw. Each
 * instance moves to a new random spot every cycle (hashed from the cycle
 * count), so again nothing is computed per particle on the CPU.
 */
export const SPLASH_VERT = NOISE + GROUND_AT + /* glsl */ `
uniform float uEnvTime;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform float uPScale;
uniform float uPPx;
attribute vec4 aSeed;
varying vec2 vQ;
varying float vLife;
void main() {
  float rate = 1.3 + aSeed.w * 1.2;
  float ph = uEnvTime * rate + aSeed.z * 17.0;
  float cyc = floor(ph);
  vLife = fract(ph);
  vec2 rnd = vec2(dioHash(aSeed.xy * 31.7 + cyc * 0.731), dioHash(aSeed.yx * 17.3 + cyc * 1.37));
  vec2 xz = uBoxMin.xz + rnd * uBoxSize.xz;
  float g = groundAt(xz);
  float r = max((0.025 + 0.1 * vLife) * mix(1.0, uPScale, 0.5), uPPx * (2.0 + 6.0 * vLife));
  vQ = vec2(position.x, position.y * 2.0 - 1.0);
  vec3 p = vec3(xz.x + vQ.x * r, g + 0.012, xz.y + vQ.y * r);
  gl_Position = g < -999.0 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const SPLASH_FRAG = /* glsl */ `
uniform float uPOpacity;
uniform float uAmbient;
uniform vec3 uEnvSky;
uniform float uEnvFlash;
varying vec2 vQ;
varying float vLife;
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  float ring = exp(-pow((r - 0.8) * 8.0, 2.0)) * pow(1.0 - vLife, 1.4);
  float hit = (1.0 - smoothstep(0.0, 0.3, r)) * max(1.0 - vLife * 5.0, 0.0);
  float a = max(ring, hit * 0.7) * uPOpacity;
  if (a < 0.004) discard;
  vec3 col = mix(uEnvSky, vec3(1.0), 0.55) * (uAmbient + uEnvFlash);
  gl_FragColor = vec4(col * a, a);
}
`;

/* ---------------------------------------------------------------- fog of war */

/*
 * The fog of war as a bank of dark mist (render/fog.mjs): FOG_LAYERS sheets over
 * the board, one geometry, drawn floor first. The sheets lie along the ground
 * blurred over a few squares (the atmosphere layer's height texture), so the mist
 * follows the terraces and keeps no shape of anything standing in it. What is
 * under it was never drawn as itself: unseen ground is a flat backdrop at the far
 * plane (UNSEEN), unseen props and walls are discarded. The floor is a dark matte
 * slate lit by the sky alone, dense over every point nobody has seen (seen ≤ 0.5,
 * the threshold visionAt() uses), thinning where it turns edge-on to the camera
 * and fading out as a veil over the edge of sight; a curtain hangs from it down
 * the board's side to the plinth. The sheets above it are wisps: thin,
 * translucent streaks along the wind, each drifting at its own pace, reaching a
 * little past the edge of sight so the reveal is soft.
 */
export const FOG_LAYERS = 4;
export const FOG_VERT = GROUND_AT + /* glsl */ `
attribute float layer;
attribute float skirt;    // 1 on the foot of the curtain down the board's side
uniform vec2 uFogLevel;   // x the floor's height over the ground it covers (cells), y the step between sheets
uniform vec2 uHeightRange;
uniform float uFogCell;   // cells between two vertices of the bank
varying vec3 vWorld;
varying float vLayer;
varying float vSkirt;
/*
 * The ground around a vertex, blurred over about four squares: the bank lies
 * along the lie of the land, a terrace's worth of mist on a terrace, and never
 * stands up into the shape of a single tower. It does not have to cover what it
 * lies over: unseen ground is a backdrop that hides nothing (UNSEEN).
 */
float fogGround(vec2 xz) {
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    for (int j = 0; j < 8; j++) {
      vec2 o = (vec2(float(i), float(j)) - 3.5) * 0.5 * uFogCell;
      h += max(groundAt(xz + o), uHeightRange.x);
    }
  }
  return h / 64.0;
}
void main() {
  float top = fogGround(position.xz) + uFogLevel.x + layer * uFogLevel.y;
  vec3 p = vec3(position.x, mix(top, uHeightRange.x - 0.05, skirt), position.z);
  vWorld = p;
  vLayer = layer;
  vSkirt = skirt;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

export const FOG_FRAG = HEAD + /* glsl */ `
/** The floor's opacity where it is edge-on to the camera (1 facing it). */
const float FOG_FLANK = 0.55;
uniform vec2 uFogLevel;
uniform float uFogLayers;
varying vec3 vWorld;
varying float vLayer;
varying float vSkirt;
void main() {
  // derivatives up front: fwidth inside a branch is undefined
  vec3 nrm = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (uUseVision < 0.5 || uFogStyle.x < 0.5) discard;
  vec2 uv = vWorld.xz / uWorldSize;
  if (!dioInWorld(uv)) discard;
  vec4 v = texture2D(uVisionMap, uv);
  float seen = max(v.r, v.g);
  float k = vLayer / max(uFogLayers - 1.0, 1.0);
  float n = dioFogNoise(vWorld.xz, k);
  float unseen = 1.0 - fogSoftAt(vWorld.xz).y;
  // where the bank turns edge-on to the camera (the flank of a mound of mist):
  // a fog has no hard outline, so there it thins
  vec3 fwd = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  float flank = 1.0 - smoothstep(0.08, 0.7, abs(dot(nrm, fwd)));
  float a;
  if (vLayer < 0.5) {
    // the floor: opaque wherever seen <= 0.5 and it faces the camera, thinning on
    // its flanks to FOG_FLANK, then fading out over the soft map's blur, so its
    // rim is a fading veil and never a cut edge
    float veil = 0.6 * smoothstep(0.04, 0.5, unseen + 0.2 * (n - 0.5));
    a = max((1.0 - smoothstep(0.5, 0.8, seen)) * (1.0 - (1.0 - FOG_FLANK) * flank), veil);
  } else {
    // wisps: densest over the unseen, reaching a little past the edge of sight, never solid
    float reach = smoothstep(0.04, 0.55, unseen + 0.25 * (n - 0.5));
    float wisp = smoothstep(0.28 + 0.1 * k, 0.75, n);
    // they thin out over the board's edge (the floor and its curtain close it)
    float rim = min(min(vWorld.x, uWorldSize.x - vWorld.x), min(vWorld.z, uWorldSize.y - vWorld.z));
    a = reach * wisp * mix(0.6, 0.34, k) * smoothstep(0.0, 0.5 + 0.9 * n, rim) * (1.0 - 0.6 * flank);
  }
  if (a < 0.004) discard;
  // the wisps a shade lighter than the floor they drift over, so they read as moving air
  vec3 col = dioFogColor(k, n) * (1.0 + 0.5 * k);
  // the curtain down the board's side darkens towards the plinth
  col *= 1.0 - 0.3 * vSkirt;
  col += (dioHash(gl_FragCoord.xy + vLayer * 7.0) - 0.5) / 255.0;
  gl_FragColor = vec4(col, a);
}
`;

/* ---------------------------------------------------------------- fire */

/*
 * Flames (render/torches.mjs): one instanced draw, a quad per fire-like light,
 * standing up in view space like a standee card, so a flame reads the same at
 * every pitch. Stylized: three flat bands (ember red, orange, a pale core) with
 * device-pixel edges, tongues licking up through it on the flames' own clock,
 * the whole flame breathing with its light's flicker (aFire.a). A flame is drawn
 * only where this viewer sees its foot right now (vision r), never in the fog.
 *   aFlame  xyz its foot (cells), w its size (cells)
 *   aFire   rgb its light's tint, a its flicker multiplier now
 *   aSeed   x its own phase, y how much the light's colour recolours the fire
 */
const SEEN_AT = /* glsl */ `
uniform sampler2D uVisionMap;
uniform float uUseVision;
uniform vec2 uWorldSize;
/** 1 where this viewer sees the point right now (always without a vision bake). */
float seenNow(vec2 xz) {
  if (uUseVision < 0.5) return 1.0;
  vec2 uv = xz / uWorldSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  return step(0.5, texture2D(uVisionMap, uv).r);
}
`;

export const FLAME_VERT = SEEN_AT + /* glsl */ `
attribute vec4 aFlame;
attribute vec4 aFire;
attribute vec2 aSeed;
varying vec2 vQ;
varying vec3 vTint;
varying float vSeed;
varying float vRecolor;
void main() {
  float flick = aFire.a;
  vRecolor = aSeed.y;
  float w = aFlame.w * 0.62;
  float h = aFlame.w * (1.05 + 0.6 * (flick - 1.0) * 2.0);
  vec4 vb = viewMatrix * vec4(aFlame.xyz, 1.0);
  // a hair toward the camera, so a flame in a bowl is not cut by its rim
  vec3 pos = vb.xyz + vec3(position.x * w, position.y * h, 0.06);
  vQ = position.xy;
  vTint = aFire.rgb;
  vSeed = aSeed.x;
  gl_Position = seenNow(aFlame.xz) < 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(pos, 1.0);
}
`;

export const FLAME_FRAG = NOISE + /* glsl */ `
uniform float uFlameT;     // the flames' clock, in licks (TIMING.flameLick)
varying vec2 vQ;           // x -1..1 across, y -0.25 (under the foot) .. 1 (tip)
varying vec3 vTint;
varying float vSeed;
varying float vRecolor;
const vec3 F_OUTER = vec3(0.86, 0.24, 0.07);
const vec3 F_MID = vec3(1.0, 0.56, 0.12);
const vec3 F_CORE = vec3(1.0, 0.9, 0.62);
void main() {
  float t = uFlameT + vSeed * 31.0;
  float y = vQ.y;
  float yc = clamp(y, 0.0, 1.0);
  // tongues: a sideways lick that grows with height, noise rising through it
  float sway = (dioNoise(vec2(yc * 1.7 - t, vSeed * 11.0)) - 0.5) * 0.7 * yc;
  float x = vQ.x * 1.25 - sway;
  float lick = dioNoise(vec2(x * 1.9 + vSeed * 5.0, yc * 2.6 - t * 1.3));
  // a teardrop: round under the foot, widest a little above it, a point at the tip
  float prof = y < 0.0 ? sqrt(max(1.0 - (y / 0.25) * (y / 0.25), 0.0)) * 0.7
                       : 0.7 * (0.82 + 0.5 * smoothstep(0.0, 0.18, y)) * pow(max(1.0 - y, 0.0), 1.15);
  float f = 1.0 - abs(x) / max(prof, 1e-3) - (1.0 - lick) * 0.55 * smoothstep(0.15, 1.0, yc);
  float fw = max(fwidth(f), 1e-4);
  float outer = smoothstep(-fw, fw, f);
  float mid = smoothstep(0.3 - fw, 0.3 + fw, f + 0.1 * (1.0 - yc));
  float core = smoothstep(0.58 - fw, 0.58 + fw, f + 0.32 * (1.0 - yc) - 0.12);
  // A light of another colour burns in it (a green witch-fire stays green):
  // vRecolor is how much, decided per light by torches.mjs (flameRecolor).
  vec3 col = mix(mix(F_OUTER, F_MID, mid), F_CORE, core);
  vec3 tint = vTint / max(max(max(vTint.r, vTint.g), vTint.b), 1e-3);
  vec3 alt = mix(mix(tint * 0.62, tint * 0.9, mid), mix(tint, vec3(1.0), 0.6), core);
  col = mix(col, alt, vRecolor);
  float hue = vRecolor;
  float a = outer * (0.92 - 0.25 * smoothstep(0.6, 1.0, yc));
  // a faint glow around the foot, fading well inside the quad
  float r = length(vec2(vQ.x, (vQ.y - 0.05) * 1.6));
  float glow = exp(-r * r * 4.0) * (1.0 - smoothstep(0.7, 1.0, r)) * 0.35;
  vec3 glowC = mix(F_MID, tint, hue * 0.85);
  if (a + glow < 0.004) discard;
  gl_FragColor = vec4(col * a + glowC * glow * (1.0 - a), a * 0.9);
}
`;

/*
 * Embers: sparks rising off every fire, one instanced draw. Each instance
 * carries its fire's foot and a seed; its life is fract(clock × rate + seed), so
 * nothing is computed per spark on the CPU, and a spark is born and dies at
 * zero alpha, so its loop never shows. Never under 1.5 device px (uPPx).
 *   aBase  xyz the fire's foot (cells), w its size (cells)
 *   aSeed  four randoms
 */
export const EMBER_VERT = SEEN_AT + NOISE + /* glsl */ `
uniform float uEmberT;     // the embers' clock, in lives (TIMING.emberRise)
uniform float uPPx;        // one device pixel, in cells
uniform vec4 uEnvClouds;   // zw the wind on the map
attribute vec4 aBase;
attribute vec4 aSeed;
varying vec2 vQ;
varying float vLife;
varying float vHeat;
void main() {
  vec4 s = aSeed;
  float life = fract(uEmberT * (0.7 + 0.6 * s.w) + s.x);
  float H = aBase.w * (2.2 + 2.2 * s.y);
  vec2 wind = uEnvClouds.zw * 0.35;
  float a = s.z * 6.2831853 + life * (2.0 + 2.5 * s.w);
  vec3 p = aBase.xyz + vec3(
    cos(a) * aBase.w * (0.12 + 0.35 * life) + wind.x * life * H,
    aBase.w * 0.5 + life * H,
    sin(a) * aBase.w * (0.12 + 0.35 * life) + wind.y * life * H);
  float size = max(aBase.w * (0.035 + 0.03 * s.w) * (1.0 - 0.5 * life), uPPx * 1.5);
  vec4 vh = viewMatrix * vec4(p, 1.0);
  vQ = position.xy * 2.0 - 1.0;
  vLife = life;
  vHeat = s.y;
  vec3 pos = vh.xyz + vec3(vQ * size, 0.0);
  gl_Position = seenNow(aBase.xz) < 0.5 ? vec4(2.0, 2.0, 2.0, 1.0) : projectionMatrix * vec4(pos, 1.0);
}
`;

export const EMBER_FRAG = /* glsl */ `
uniform float uEmberOpacity;
varying vec2 vQ;
varying float vLife;
varying float vHeat;
void main() {
  float r = length(vQ);
  if (r > 1.0) discard;
  float fade = smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.5, 1.0, vLife));
  float a = (1.0 - smoothstep(0.35, 1.0, r)) * fade * uEmberOpacity;
  if (a < 0.004) discard;
  vec3 hot = mix(vec3(1.0, 0.86, 0.5), vec3(1.0, 0.5, 0.14), smoothstep(0.0, 0.55, vLife + vHeat * 0.2));
  vec3 col = mix(hot, vec3(0.85, 0.2, 0.06), smoothstep(0.5, 1.0, vLife));
  // additive: premultiplied colour, no coverage
  gl_FragColor = vec4(col * a * 1.3, 0.0);
}
`;

/*
 * A figure's shadow thrown by a torch (render/torches.mjs): a soft tongue
 * lying on the ground from the figure's foot, away from the light, as long as
 * the light is low. Its strength is the torch's share of the light at the foot
 * (written per frame), and it is drawn only where that light reaches the
 * ground in the bake (a wall between them already darkened it) and only on
 * ground this viewer sees now.
 *   aFoot  xyz the foot (cells), w the shadow's length (cells)
 *   aDir   xy away from the light (unit, on the map), z its width (cells), w its strength
 */
export const TORCH_SHADOW_VERT = /* glsl */ `
attribute vec4 aFoot;
attribute vec4 aDir;
varying vec2 vQ;
varying vec3 vWorld;
varying float vAlpha;
void main() {
  vec2 d = aDir.xy;
  vec2 perp = vec2(-d.y, d.x);
  float along = position.y;                 // -0.3 (behind the foot) .. 1 (the tip)
  float w = aDir.z * (1.0 + 0.3 * max(along, 0.0));
  vec2 xz = aFoot.xz + d * along * aFoot.w + perp * position.x * w;
  vWorld = vec3(xz.x, aFoot.y + 0.012, xz.y);
  vQ = vec2(position.x, along);
  vAlpha = aDir.w;
  gl_Position = projectionMatrix * viewMatrix * vec4(vWorld, 1.0);
}
`;

export const TORCH_SHADOW_FRAG = HEAD + /* glsl */ `
varying vec2 vQ;
varying vec3 vWorld;
varying float vAlpha;
void main() {
  if (visionAt(vWorld.xz) < 0.75) discard;
  float v = vQ.y;
  float rr = v < 0.0 ? sqrt(max(1.0 - (v / 0.3) * (v / 0.3), 0.0)) : 1.0;
  float edge = 1.0 - smoothstep(0.45 * rr, rr, abs(vQ.x));
  // full strength out past the figure's base, then soft to the tip
  float fade = 1.0 - smoothstep(0.3, 1.0, v);
  float reach = smoothstep(0.02, 0.22, dot(lightAt(vWorld.xz), DIO_LUMA));
  float a = edge * fade * reach * vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(0.02, 0.018, 0.03, a);
}
`;

/** Every program, for the check tool: name → { vertex, fragment }. */
export const PROGRAMS = Object.freeze({
  top: { vertex: TOP_VERT, fragment: TOP_FRAG },
  side: { vertex: SIDE_VERT, fragment: SIDE_FRAG },
  water: { vertex: WATER_VERT, fragment: WATER_FRAG },
  wall: { vertex: WALL_VERT, fragment: WALL_FRAG },
  card: { vertex: CARD_VERT, fragment: CARD_FRAG },
  solid: { vertex: SOLID_VERT, fragment: SOLID_FRAG },
  unlit: { vertex: UNLIT_VERT, fragment: UNLIT_FRAG },
  ring: { vertex: UNLIT_VERT, fragment: RING_FRAG },
  glass: { vertex: GLASS_VERT, fragment: GLASS_FRAG },
  footprint: { vertex: UNLIT_VERT, fragment: FOOTPRINT_FRAG },
  reticle: { vertex: UNLIT_VERT, fragment: RETICLE_FRAG },
  link: { vertex: LINK_VERT, fragment: LINK_FRAG },
  ribbon: { vertex: RIBBON_VERT, fragment: RIBBON_FRAG },
  backdrop: { vertex: BACKDROP_VERT, fragment: BACKDROP_FRAG },
  table: { vertex: TABLE_VERT, fragment: TABLE_FRAG },
  depth:{ vertex: DEPTH_VERT, fragment: DEPTH_FRAG },
  blur: { vertex: POST_VERT, fragment: BLUR_FRAG },
  particles: { vertex: PARTICLE_VERT, fragment: PARTICLE_FRAG },
  splash: { vertex: SPLASH_VERT, fragment: SPLASH_FRAG },
  fog: { vertex: FOG_VERT, fragment: FOG_FRAG },
  flame: { vertex: FLAME_VERT, fragment: FLAME_FRAG },
  ember: { vertex: EMBER_VERT, fragment: EMBER_FRAG },
  torchShadow: { vertex: TORCH_SHADOW_VERT, fragment: TORCH_SHADOW_FRAG },
});

/** Names of the uniforms a GLSL source declares. */
export function declaredUniforms(src) {
  const out = new Set();
  const re = /^\s*uniform\s+\w+\s+(\w+)\s*(\[\s*\d+\s*\])?\s*;/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}
