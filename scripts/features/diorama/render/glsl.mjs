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

bool dioInWorld(vec2 uv) { return uv.x >= 0.0 && uv.y >= 0.0 && uv.x <= 1.0 && uv.y <= 1.0; }

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

float shadowAt(vec3 wp, vec3 n) {
  if (uShadowMode < 0.5) return 1.0;
  vec4 lp = uShadowMatrix * vec4(wp + n * 0.03, 1.0);
  vec3 p = lp.xyz / lp.w * 0.5 + 0.5;
  if (!dioInWorld(p.xy) || p.z > 1.0) return 1.0;
  if (uShadowMode < 1.5) return shadowTap(p, vec2(0.0));
  float s = 0.0;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) s += shadowTap(p, vec2(float(x), float(y)) * 1.25);
  return s / 9.0;
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
 * a face turned away as dark as a shadow.
 */
const vec3 SKY_FILL = vec3(0.46, 0.50, 0.58);
const vec3 SUN_KEY = vec3(0.86, 0.80, 0.70);

/** The sun alone, for a surface with normal n and shadow term sh. */
vec3 sunlight(vec3 n, float sh) {
  float ndl = max(dot(n, uKeyDir), 0.0);
  return uAmbient * (SKY_FILL + SUN_KEY * ndl * sh);
}

/** Albedo under the sun + the light bake + effect lights. */
vec3 shade(vec3 albedo, vec3 wp, vec3 n, float ao, vec2 lightXZ) {
  vec3 sun = sunlight(n, shadowAt(wp, n));
  vec3 lit = sun + lightAt(lightXZ) + effectLight(wp, n);
  lit *= mix(1.0, ao, uAOOn);
  return albedo * lit;
}

/** Soft shoulder, then the explored-not-visible look (desaturated, dim). */
vec3 finish(vec3 c, float vis) {
  vec3 over = max(c - 0.82, 0.0);
  c = min(c, 0.82) + 0.18 * (1.0 - exp(-over / 0.18));
  if (vis < 0.75) {
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c = mix(vec3(l), c, 0.22) * 0.5;
  }
  return c;
}
`;

const HEAD = NOISE + MAP + LIT;

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

export const TOP_FRAG = HEAD + /* glsl */ `
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

void main() {
  float vis = visionAt(vWorld.xz);
  if (vis <= 0.0) discard;
  vec3 albedo = mapAt(vWorld.xz) * vTint;
  vec3 c = shade(albedo, vWorld, normalize(vNormal), vAO, vWorld.xz);
  if (uGrid.a > 0.0) {
    // Ink at the lit surface's own brightness: a dark grid darkens, a light
    // one tints, and neither glows brighter than the ground it lies on.
    float lum = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 ink = min(uGrid.rgb * (0.25 + lum), vec3(1.0));
    c = mix(c, ink, gridLine(vWorld.xz) * uGrid.a);
  }
  gl_FragColor = vec4(finish(c, vis), 1.0);
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

export const SIDE_FRAG = HEAD + /* glsl */ `
uniform float uSidePaint;
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
 * A cliff face continues the paint of the top it hangs from: its colour is the
 * map at the lip (vLip, fixed down the face, so it streaks straight down), and
 * the material only adds relief, its pattern's light and dark at RELIEF
 * strength. uSidePaint is how much of the paint wins over the material's own
 * colour (1 = all paint).
 */
const float RELIEF = 0.3;
vec3 paintedSide(int m, vec3 lipC, float a, float d, float y) {
  vec3 pat = sideAlbedo(m, lipC, a, d, y);
  float l = dot(pat, vec3(0.299, 0.587, 0.114));
  float l0 = max(dot(sideBase(m, lipC), vec3(0.299, 0.587, 0.114)), 0.04);
  float relief = clamp(l / l0, 0.35, 1.7);
  float streak = 0.9 + 0.2 * dioNoise(vec2(a * 13.0, y * 0.8)) + 0.06 * dioNoise(vec2(a * 41.0, y * 2.0));
  vec3 paint = lipC * streak * mix(1.0, relief, RELIEF);
  return mix(pat, paint, uSidePaint);
}

void main() {
  float vis = visionAt(vLip);
  if (vis <= 0.0) discard;
  vec3 n = normalize(vNormal);
  // the paint just inside the lip, on the top the face hangs from, not the
  // ground beyond its edge
  vec3 lipC = mapAt(vLip - n.xz * 0.05);
  int m = int(vMat + 0.5);
  vec3 c = paintedSide(m, lipC, vAlong, vDepth, vWorld.y);
  // darker with depth (a tall face keeps its paint well down), a lit lip
  c *= mix(1.0, 0.6, smoothstep(0.0, 3.6, vDepth));
  c *= 1.0 + 0.2 * (1.0 - smoothstep(0.0, 0.05, vDepth));
  float flag = vFlag;
  if (flag >= 1.5) {
    c = mix(c, vec3(0.015, 0.012, 0.02), smoothstep(0.05, 1.4, vDepth));
    flag -= 2.0;
  }
  float ao = 1.0;
  if (flag > 0.5) ao = mix(0.5, 1.0, smoothstep(0.0, 0.32, vDrop - vDepth));
  vec3 lit = shade(c, vWorld, n, ao, vWorld.xz + n.xz * 0.12);
  gl_FragColor = vec4(finish(lit, vis), 1.0);
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

export const WATER_FRAG = HEAD + /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
varying float vShore;
const vec3 WATER = vec3(0.20, 0.47, 0.66);
const vec3 FOAM = vec3(0.86, 0.94, 0.97);
void main() {
  float vis = visionAt(vWorld.xz);
  if (vis <= 0.0) discard;
  vec2 p = vWorld.xz;
  float t = uTime;
  vec2 w = vec2(sin(p.y * 3.1 + t * 1.3) + sin(p.x * 2.3 - t * 0.9),
                cos(p.x * 2.7 + t * 1.1) + sin(p.y * 1.9 + t * 0.7));
  vec3 under = mapAt(p + w * 0.012);
  vec3 col = mix(under * vec3(0.55, 0.72, 0.82), WATER, 0.42);
  float rip = dioNoise(p * 3.6 + vec2(t * 0.32, -t * 0.22)) * dioNoise(p * 6.5 - vec2(t * 0.18, t * 0.27));
  col += smoothstep(0.36, 0.55, rip) * 0.2;
  float foam = smoothstep(0.5, 1.0, vShore) * (0.55 + 0.45 * dioNoise(p * 9.0 + t * 0.4));
  col = mix(col, FOAM, foam * 0.5);
  vec3 lit = shade(col, vWorld, vec3(0.0, 1.0, 0.0), 1.0, p);
  gl_FragColor = vec4(finish(lit, vis), 0.8 + foam * 0.15);
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
  gl_FragColor = vec4(finish(lit, vis), uOpacity);
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
  vec3 lit = c.rgb / max(c.a, 0.05) * (sun + lightAt(vFoot.xz) + effectLight(p, uFacing));
  lit *= 1.0 + uLift;
  vec3 col = mix(uOutline.rgb, finish(lit, 1.0), artCov);
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
  gl_FragColor = vec4(finish(lit, 1.0), uOpacity);
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
varying vec2 vUv;
void main() {
  vec3 c = mix(uBottom, uTop, smoothstep(0.0, 1.0, vUv.y));
  float v = length(vUv - vec2(0.5, 0.55));
  c *= 1.0 - 0.35 * smoothstep(0.3, 0.85, v);
  // a dark, wide gradient bands in 8 bits: dither it by half a level
  c += (dioHash(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
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
  depth: { vertex: DEPTH_VERT, fragment: DEPTH_FRAG },
  blur: { vertex: POST_VERT, fragment: BLUR_FRAG },
});

/** Names of the uniforms a GLSL source declares. */
export function declaredUniforms(src) {
  const out = new Set();
  const re = /^\s*uniform\s+\w+\s+(\w+)\s*(\[\s*\d+\s*\])?\s*;/gm;
  let m;
  while ((m = re.exec(src))) out.add(m[1]);
  return [...out];
}
