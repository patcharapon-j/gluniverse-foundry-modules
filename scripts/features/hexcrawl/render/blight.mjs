/**
 * Hexcrawl renderer — the blight overlay.
 *
 * Blight (Shadowblighted, the Verdant Death, whatever the table calls it) is a
 * corruption laid OVER a hex's ground, so it is its own layer above the texture
 * and the tile fill: one PIXI.Mesh covering every blighted hex body, drawn by a
 * small shader. A texture strong enough to read as ground swallowed the old
 * vector veins; this is lit, animated and sits on top.
 *
 * The look: crawling violet veins (ridged, domain-warped noise flowing slowly),
 * a pulsing inner glow that brightens toward the region edge, and a dark bruise
 * tint between — all SNAPPED TO A PIXEL GRID (uPixel per hex radius) so it
 * belongs to 16-bit pixel-art textures instead of floating over them.
 *
 * A Mesh with its own shader, not a filter: no filter resolution to get wrong,
 * no render-texture per frame. Pure of Foundry like the rest of render/.
 * Every term that animates turns a whole number of times per BLIGHT_LOOP ms, so
 * the loop never visibly jumps when uTime wraps.
 */

export const BLIGHT_LOOP = 24000;   // ms; uTime wraps at 1.0 per loop

export const BLIGHT_VERT = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute float aRim;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vPos;
varying float vRim;
void main() {
  vPos = aVertexPosition;
  vRim = aRim;
  gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
}`;

export const BLIGHT_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 vPos;
varying float vRim;
uniform float uTime;      // 0..1 over BLIGHT_LOOP
uniform float uR;         // hex circumradius, world units
uniform float uPixel;     // pixel-art cells per hex radius
uniform float uAlpha;     // overall strength
uniform vec3 uColor;      // violet
uniform vec3 uHot;        // hot violet
uniform vec3 uBruise;     // dark tint between veins

const float TAU = 6.28318530718;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int k = 0; k < 4; k++) { v += a * noise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return v;
}

void main() {
  // Snap to the pixel grid, in hex-radius units (world-anchored, so neighbours agree).
  vec2 p = floor(vPos / uR * uPixel) / uPixel;
  float t = uTime * TAU;
  // Slow domain warp: the veins crawl. Whole turns per loop (cos/sin of t, 2t).
  vec2 w = vec2(fbm(p * 1.3 + vec2(cos(t), sin(t)) * 0.35), fbm(p * 1.3 + vec2(sin(2.0 * t), cos(t)) * 0.35 + 5.2));
  float n = fbm(p * 2.2 + w * 1.6);
  float ridge = 1.0 - abs(n * 2.0 - 1.0);           // 1 on the vein spine
  float vein = smoothstep(0.80, 0.965, ridge);
  float core = smoothstep(0.93, 0.995, ridge);
  // A pulse travelling along the veins, and a heartbeat on the whole overlay.
  float travel = 0.5 + 0.5 * sin(n * 18.0 - t * 3.0);
  float beat = 0.75 + 0.25 * sin(t * 4.0);
  // Glow gathers toward the edge of the blighted area (vRim: 0 centre → 1 boundary).
  float edge = smoothstep(0.35, 1.0, vRim);
  vec3 col = mix(uBruise, uColor, vein) ;
  col = mix(col, uHot, core * travel);
  float a = 0.22 * (0.6 + 0.4 * edge)                 // bruise veil
          + vein * (0.55 + 0.35 * travel) * beat       // the veins
          + core * 0.25;
  // Quantise the alpha a little: pixel art has steps, not gradients.
  a = floor(a * 6.0 + 0.5) / 6.0;
  gl_FragColor = vec4(col * a, a) * uAlpha;           // premultiplied
}`;

/**
 * Geometry for every blighted hex body: a triangle fan per hex. aRim is 1 on a
 * perimeter vertex that touches a boundary edge of the BLIGHTED AREA and 0
 * elsewhere, so the glow gathers at the corruption's edge, not around every hex.
 * cells: [{ c: {x,y}, body: [{x,y}×6], edge: mask }] — bit e: edge e borders non-blight
 */
export function blightGeometry(PIXI, cells) {
  const pos = [], rim = [], idx = [];
  for (const { c, body, edge = 63 } of cells) {
    const base = pos.length / 2;
    pos.push(c.x, c.y); rim.push(0);
    body.forEach((p, i) => { pos.push(p.x + c.x, p.y + c.y); rim.push((edge >> i) & 1 || (edge >> ((i + 5) % 6)) & 1 ? 1 : 0); });
    const n = body.length;
    for (let e = 0; e < n; e++) idx.push(base, base + 1 + e, base + 1 + ((e + 1) % n));
  }
  const g = new PIXI.Geometry();
  g.addAttribute("aVertexPosition", new Float32Array(pos), 2);
  g.addAttribute("aRim", new Float32Array(rim), 1);
  g.addIndex(pos.length / 2 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx));
  return g;
}

/** The shader, with uniforms from the renderer's colours (ints) and radius. */
export function blightShader(PIXI, { R, color, hot, bruise, pixel = 22, alpha = 1 }) {
  const rgb = (i) => [((i >> 16) & 255) / 255, ((i >> 8) & 255) / 255, (i & 255) / 255];
  return PIXI.Shader.from(BLIGHT_VERT, BLIGHT_FRAG, {
    uTime: 0, uR: R, uPixel: pixel, uAlpha: alpha,
    uColor: rgb(color), uHot: rgb(hot), uBruise: rgb(bruise),
  });
}
