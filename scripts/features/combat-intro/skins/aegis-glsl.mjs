/**
 * Combat Intro — the Aegis Fallen backdrop, as GLSL ES 3.00.
 *
 * A port of the audience app's three Aegis shaders (src/fx/shaders/aegisField.ts,
 * aegisLink.ts, aegisBreach.ts and the prelude helpers in src/fx/gpu/stage.ts)
 * from WGSL, re-cut onto this feature's beats. Everything is printed: a red
 * halftone on a 15 degree screen over the void, seen through a monitor.
 *
 *   furnace   smoke rising off the bottom as coarse halftone dots, embers, a slow
 *             scan beam and the odd torn band of signal (aegisField)
 *   link      the scope tuning in: moire snow on a misregistered second screen
 *             resolving into the 19-hex survey over contour lines, range rings,
 *             bearing ticks, a sweep beam, contacts pinging on the roster
 *             anchors, lock arcs, the oscilloscope trace (aegisLink)
 *   events    the milestone shockwave, the cyan/magenta misprint, torn rows, the
 *             halftone blast, the fold into a horizon line (aegisLink)
 *   breach    focus scan, glitch tear, burning paper edge, cut to void (aegisBreach)
 *   table     a halftone pool under every die anchor, a flare when one lands, and
 *             torn bands streaking along the sort's travel
 *
 * Pure: strings only, no `game`, no DOM. Appended after backdrop.mjs's PRELUDE,
 * so uRes/uTime/uPhase/uAnchors/uAccent/uHot/uInk/uWarn/uIntensity come from there.
 *
 * Two rules every term below keeps:
 *   - uTime wraps every 64 s. Every idle term turns a WHOLE number of times per
 *     64 s: angular rates are integer multiples of W64 (TAU / 64), and every
 *     scrolling noise is periodic along its scroll axis with a period it crosses
 *     a whole number of times per loop (vnoiseP / fbmP / ember). Random ticks
 *     (floor(T * n)) re-roll every tick anyway, so their wrap is invisible.
 *   - Hairlines are sized in device pixels: PX is one drawing-buffer pixel in
 *     screen heights, never a CSS pixel.
 */

/** The skin's own uniforms. aegis.mjs declares and writes exactly these. */
export const UNIFORMS_GLSL = /* glsl */ `
uniform vec4 uField;    // x furnace intensity, y heat, z tear burst, w boot scan (0 off, 0..1 down the screen)
uniform vec4 uLink;     // x scope draw-on, y sync, z sweep (turns), w pulse (misprint + torn rows)
uniform vec4 uEvent;    // x shockwave ring progress, y fold to horizon, z slam blast, w warn
uniform vec4 uBreach;   // x focus, y glitch, z burn, w cut
uniform vec4 uSort;     // x streak (sort travel), y horizon line, z lock arcs close, w pool strength
uniform vec4 uFlare0;   // landing flare per anchor, 0..1 (anchors 0..3)
uniform vec4 uFlare1;   // anchors 4..7
uniform vec4 uFlare2;   // anchors 8..11
uniform vec4 uShedMask; // 1 = on: x misprint, y second screen, z smoke octaves, w embers
`;

/** Shared helpers: hashes, periodic value noise / fbm, the halftone screen, the hex grid. */
export const HELPERS_GLSL = /* glsl */ `
#define TAU 6.2831853
#define W64 0.0981747704   // TAU / 64: one whole turn per uTime loop
#define SQ3 1.7320508
#define SCREEN 0.2618      // the house 15 degree screen

const vec3 CYAN = vec3(.212, .839, 1.);
const vec3 MAGENTA = vec3(1., .169, .839);
const vec3 SNOW = vec3(.6, .53, .51);

float sq(float x) { return x * x; }
float ss(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
float lum(vec3 c) { return dot(c, vec3(.299, .587, .114)); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Hoskins hashes: stable for the integer-ish cell ids fed to them.
float h21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * .1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 h22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

// Value noise, periodic in y with period per (whole cells). A scroll of
// per * k / 64 cells a second therefore loops seamlessly with uTime.
float vnoiseP(vec2 p, float per) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3. - 2. * f);
  float y0 = mod(i.y, per), y1 = mod(i.y + 1., per);
  return mix(mix(h21(vec2(i.x, y0)), h21(vec2(i.x + 1., y0)), f.x),
             mix(h21(vec2(i.x, y1)), h21(vec2(i.x + 1., y1)), f.x), f.y);
}
float vnoise(vec2 p) { return vnoiseP(p, 4096.); }

// fbm whose every octave stays periodic: the lattice scale doubles exactly, so
// does the period, and the per-octave offset is a whole number in y.
float fbmP(vec2 p, float per, int oct) {
  float s = 0., a = .5, n = 0.;
  for (int i = 0; i < 5; i++) {
    if (i >= oct) break;
    s += a * vnoiseP(p, per);
    n += a;
    p = p * 2. + vec2(1.7, 9.);
    per *= 2.;
    a *= .5;
  }
  return s / n;
}

// A halftone screen at angle ang about origin o: (cell centre px, position in the cell).
vec4 cellAt(vec2 q, vec2 o, float pitch, float ang) {
  mat2 m = rot(ang);
  vec2 g = transpose(m) * (q - o) / pitch;
  vec2 id = floor(g);
  return vec4(m * ((id + .5) * pitch) + o, g - id - .5);
}
// The printed dot: area follows the value, edges antialiased to one device pixel.
float dotMask(vec2 inCell, float v, float pitch, float maxR) {
  float r = sqrt(clamp(v, 0., 1.)) * maxR;
  float aa = 1.1 / pitch;
  return (1. - ss(r - aa, r + aa, length(inCell))) * step(.002, v);
}

// Pointy-top hexes, inradius .5: (position in the cell, cell id). Centre = id * (1, sqrt 3).
vec4 hexOf(vec2 p) {
  vec2 s = vec2(1., SQ3);
  vec4 hc = floor(vec4(p, p - vec2(.5, 1.)) / s.xyxy) + .5;
  vec4 h = vec4(p - hc.xy * s, p - (hc.zw + .5) * s);
  if (dot(h.xy, h.xy) < dot(h.zw, h.zw)) return vec4(h.xy, hc.xy);
  return vec4(h.zw, hc.zw + .5);
}
float hexD(vec2 q) { vec2 a = abs(q); return max(dot(a, vec2(.5, .8660254)), a.x); }
float sdBox(vec2 p, vec2 b) { vec2 q = abs(p) - b; return length(max(q, 0.)) + min(max(q.x, q.y), 0.); }

// Premultiplied compositing for the breach layer.
vec4 over(vec4 acc, vec3 col, float m) { return vec4(col * m + acc.rgb * (1. - m), m + acc.a * (1. - m)); }
vec4 glowA(vec4 acc, vec3 col) {
  vec3 rgb = acc.rgb + col;
  return vec4(rgb, clamp(max(acc.a, max(rgb.r, max(rgb.g, rgb.b))), 0., 1.));
}
`;

/** Per-frame globals, set once at the top of main(). */
const GLOBALS = /* glsl */ `
float T, S, ASPECT, R, HEX, PX, PITCH, MAXR;
float INTRO, SYNC, LOCK, FRONT, PULSE, SWEEP, RINGR, RINGE, FOLD, SLAM, WARN;
vec3 RED, DEEP, PALE, VOID, AMBER, WHITE;

float flareOf(int i) {
  if (i < 4) return uFlare0[i];
  if (i < 8) return uFlare1[i - 4];
  return uFlare2[i - 8];
}
`;

/** The furnace ground (aegisField). */
export const FURNACE_GLSL = /* glsl */ `
// Embers: a jittered grid scrolling up n cells per loop; the cell hash wraps at n
// so the loop is seamless. Sway and flicker turn whole times per 64 s.
float ember(vec2 px, float scale, float n, float density) {
  vec2 g = px / uRes.y * scale;
  g.y += T * n / 64.;
  vec2 cell = floor(g);
  vec2 rnd = h22(vec2(cell.x, mod(cell.y, n)));
  vec2 f = fract(g) - .5;
  float kS = 7. + floor(rnd.x * 5.);
  float kF = 51. + floor(rnd.y * 90.);
  vec2 sway = vec2(sin(T * W64 * kS + rnd.y * 20.) * .22, 0.);
  float d = length(f - (rnd - .5) * .6 - sway);
  float size = .025 + rnd.x * .05;
  float flick = .55 + .45 * sin(T * W64 * kF + rnd.x * 40.);
  return exp(-d * d / (size * size)) * step(1. - density, rnd.y) * flick;
}

// The smoke's printed value at a halftone cell centre (px, y down).
float furnace(vec2 cpx) {
  vec2 cuv = cpx / uRes;
  vec2 p = (cuv - .5) * vec2(ASPECT, 1.);
  int oct = uShedMask.z > .5 ? 5 : 3;
  float s;
  if (uShedMask.z > .5) {
    // warped: two fbms bend the third. y scroll = period / 64 per second, one lap per loop.
    vec2 q = vec2(fbmP(p * 1.8 + vec2(0., T * .125), 8., 3),
                  fbmP(p * 1.8 + vec2(4.1, T * .0625), 4., 3));
    s = fbmP(vec2(p.x * 1.5, p.y * 2.2 + T * .125) + q * 1.7, 8., oct);
  } else {
    s = fbmP(vec2(p.x * 1.5, p.y * 2.2 + T * .125), 8., oct);
  }
  float heat = ss(.05 - uField.y * .45, 1.1, cuv.y);
  float side = exp(-sq((cuv.x - .85) / .45)) * .35 + exp(-sq((cuv.x - .1) / .35)) * .2;
  // a floor under the smoke, so the cold top of the screen prints no dots at all
  float v = max((s * 1.4 - .45) * (heat * 1.25 + side) - .05, 0.) * uField.x;
  // the slow scan beam, six sweeps a loop
  float beam = exp(-sq((fract(T * 6. / 64.) * 1.4 - .2 - cuv.y) / .04));
  v += beam * .16 * uField.x;
  // the boot scan: one hard pass down the screen as it wakes
  float bs = uField.w * 1.25 - .12;
  v += exp(-sq((cuv.y - bs) / .02)) * .9 * step(.001, uField.w) + ss(bs, bs - .25, cuv.y) * .0;
  return v;
}

// Halftone pools under each die anchor during the roll.
float pools(vec2 cpx) {
  float v = 0.;
  if (uSort.w < .001) return 0.;
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uAnchorN) break;
    vec4 a = uAnchors[i];
    float d = length(cpx - a.xy) / max(a.z, 8.);
    if (d > 1.6) continue;
    float st = a.w;
    float base = .32 + .18 * step(.5, st) + .12 * step(1.5, st);
    // a thrown die breathes, eight beats per loop
    base += step(.5, st) * step(st, 1.5) * .12 * (.5 + .5 * sin(T * W64 * 48.));
    float fl = flareOf(i);
    // a printed disc with range bands, not a glow: dots fall off over the rim
    float disc = ss(1.25, .7, d) * (.55 + .45 * step(.42, fract(d * 3.2 - .1)));
    v += disc * base * uSort.w;
    v += exp(-d * d * mix(1.1, 2.4, 1. - fl)) * fl * .9;
  }
  return v;
}
`;

/** The signal lock (aegisLink): the scope and its survey. */
export const LINK_GLSL = /* glsl */ `
float fbm3(vec2 p) { return fbmP(p, 4096., 3); }

// The printed value at p (screen heights, centred, y down) and how resolved the signal is.
vec2 linkField(vec2 p, vec2 key) {
  float r = length(p);
  float edge = (vnoiseP(p * 6. + vec2(0., T * 2. / 64. * 8.), 8.) - .5) * .045;
  float clear = 1. - ss(FRONT - .015, FRONT + .015, r + edge);

  vec4 hx = hexOf(p / HEX);
  float flower = 1. - step(2.1, length(hx.zw * vec2(1., SQ3)));
  float terr = h21(hx.zw + 3.7);
  float inScope = 1. - ss(R - .003, R + .003, r);
  float v = .025 + .09 * terr * (.35 + .65 * flower);
  float cl = abs(fract(fbm3(p * 2.2 + vec2(3.1, 0.)) * 7.) - .5);
  v += (1. - ss(.012, .045, cl)) * .3;
  v *= mix(.38, 1., inScope);

  float lag = fract((SWEEP - atan(p.y, p.x)) / TAU);
  v += exp(-lag * 9.) * inScope * (.3 + .45 * terr * flower) * (1. - WARN * .7);
  v += exp(-sq((r + edge - FRONT) / .007)) * .45 * (1. - LOCK) * step(.002, SYNC);
  v += exp(-sq((r - RINGR) / .018)) * RINGE * .95;
  v *= mix(.12, 1., ss(.36 * R, .8 * R, r));

  float tick = floor(T * 24.);
  float snow = h21(key + tick * 7.13);
  float streak = step(.975, h21(vec2(floor(p.y * 90.), tick)));
  float noise = snow * snow * snow * .3 + streak * .22;
  v = mix(v * .35, v, clear) + noise * ((1. - clear) + WARN * .35 * clear);
  return vec2(v * ss(0., .6, INTRO), clear);
}

// Line work over the print: hex outlines, contacts on the anchors, rings, ticks,
// sweep, lock arcs, the trace. p in screen heights about the centre.
vec3 linkLines(vec3 col, vec2 p, vec2 q, float clear) {
  float r = length(p);
  float inScope = 1. - ss(R - .003, R + .003, r);
  float flick = step(.3, h21(vec2(floor(T * 30.), 5.)));
  vec3 tint = mix(RED, AMBER, WARN * flick);
  float turn = fract(atan(p.y, p.x) / TAU + .25);

  vec4 hx = hexOf(p / HEX);
  vec2 hcen = hx.zw * vec2(1., SQ3) * HEX;
  float flower = 1. - step(2.1 * HEX, length(hcen));
  float ed = (.5 - hexD(hx.xy)) * HEX;
  float grow = ss(0., .08, INTRO * (MAXR + .1) - r);
  col = mix(col, RED, exp(-sq(ed / (1.1 * PX))) * mix(.07, .45, flower * inScope) * clear * grow);
  col += RED * exp(-sq((FRONT - length(hcen)) / .03)) * flower * .14 * (1. - LOCK);

  // Contacts: the roster portraits are the blips. Each pings as the sweep crosses
  // its bearing, and a bracket locks round it once the signal is held.
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uAnchorN || uPhase > .5) break;
    vec4 a = uAnchors[i];
    vec2 ap = (a.xy - uRes * .5) / uRes.y;
    float az = max(a.z, 24.) / uRes.y;
    vec2 dp = p - ap;
    float ping = exp(-fract((SWEEP - atan(ap.y, ap.x)) / TAU) * 4.) * ss(.15, .5, SYNC);
    float rr = length(dp);
    float pr = az * (.55 + .5 * (1. - ping));
    col += mix(tint, WHITE, .3) * exp(-sq((rr - pr) / (1.4 * PX))) * ping * 1.2;
    float bd = abs(dp.x) + abs(dp.y);
    col += AMBER * (1. - ss(.006, .006 + 2. * PX, bd - az * .62)) * 0. ;
    // L-bracket corners at the lock: four 1px corners round the portrait.
    vec2 c4 = abs(dp) - vec2(az * .62);
    float corner = step(-az * .22, c4.x) * step(-az * .22, c4.y) * step(min(c4.x, c4.y), 0.);
    float lineB = exp(-sq(max(c4.x, c4.y) / (1.2 * PX)));
    col += tint * corner * lineB * LOCK * 1.1;
  }

  float draw = step(turn, ss(.15, .9, INTRO) * 1.001);
  float rings = exp(-sq((r - R) / (1.3 * PX))) * .9
    + (exp(-sq((r - R * .6667) / PX)) + exp(-sq((r - R * .3333) / PX))) * .3;
  float tk = turn * 72.;
  float k = floor(tk + .5);
  float major = 1. - step(.5, abs(k - 6. * floor(k / 6. + .5)));
  float tickD = abs(tk - k) * TAU * r / 72.;
  float tlen = mix(.011, .026, major);
  float band = step(R + .005, r) * step(r, R + .005 + tlen);
  float ticks = exp(-sq(tickD / PX)) * band * mix(.45, .95, major);
  float dash = step(.45, fract(r / (7. * PX)));
  float hair = (exp(-sq(p.x / PX)) + exp(-sq(p.y / PX))) * step(.74 * R, r) * step(r, R) * dash * .35;
  col += tint * (rings + ticks + hair) * draw;

  vec2 dir = vec2(cos(SWEEP), sin(SWEEP));
  float along = dot(p, dir);
  float perp = abs(dot(p, vec2(-dir.y, dir.x)));
  float beam = exp(-sq(perp / (1.6 * PX))) * ss(.02, .1, along) * (1. - ss(R - .01, R, along));
  col += mix(tint, WHITE, .45) * beam * ss(.2, .7, INTRO) * (1. - LOCK * .6);

  // Four lock arcs close in as sync climbs, and all the way in on the threat.
  float conv = max(ss(0., 1., SYNC) * .75, uSort.z);
  float rl = R * mix(1.36, 1.08, conv) + WARN * (h21(vec2(floor(T * 30.), 2.)) - .5) * .02;
  float hs = mix(.025, .118, conv);
  float a4 = abs(fract(turn * 4.) - .5) / 4.;
  float arcOn = step(a4, hs);
  float arc = exp(-sq((r - rl) / (2. * PX))) * arcOn;
  float cap = exp(-sq((abs(a4 - hs) * TAU * r) / (1.2 * PX))) * step(abs(r - rl), .014);
  vec3 arcCol = mix(mix(RED, AMBER, WARN), WHITE, PULSE * LOCK);
  float arcShow = ss(.2, .6, INTRO);
  col += arcCol * (arc * 1.1 + cap * .9) * arcShow;
  col += RED * exp(-abs(r - rl) / (8. * PX)) * arcOn * (.15 + .35 * max(PULSE * LOCK, uSort.z)) * arcShow;

  // The oscilloscope trace either side of the scope: noise cleaning into a carrier.
  float ax = abs(p.x);
  float outX = ss(R * 1.05, R * 1.25, ax) * (1. - ss(ASPECT * .5 - .06, ASPECT * .5, ax));
  float un = 1. - SYNC;
  float ty = (vnoise(vec2(p.x * 38., floor(T * 24.) * .37)) - .5) * .09 * un * un;
  ty += (h21(vec2(floor(p.x * 260.), floor(T * 30.))) - .5) * .02 * un;
  ty += sin(p.x * 70. - T * W64 * 184.) * .014 * ss(.15, .6, SYNC) * (1. - LOCK);
  ty += (h21(vec2(floor(p.x * 60.), floor(T * 24.))) - .5) * .09 * WARN;
  float tr = exp(-sq((p.y - ty) / (1.6 * PX))) + exp(-abs(p.y - ty) / (9. * PX)) * .3;
  col += tint * tr * outX * ss(.3, .8, INTRO) * (.7 + .6 * LOCK);
  return col;
}
`;

/** Everything printed, at pixel q0: the fold squeezes it toward the centre line. */
const LAYER_GLSL = /* glsl */ `
vec3 layer(vec2 q0) {
  vec2 c = uRes * .5;
  float squeeze = mix(1., .003, FOLD);
  vec2 q = vec2(q0.x, (q0.y - c.y) / squeeze + c.y);
  float vis = step(0., q.y) * step(q.y, uRes.y) * (1. - ss(.55, .95, FOLD));
  if (vis < .001) return VOID;

  // The shockwave pushes the print outward as it passes.
  vec2 p = (q - c) / uRes.y;
  float r0 = length(p);
  p += p / max(r0, 1e-4) * exp(-sq((r0 - RINGR) / .035)) * RINGE * .018;
  q = p * uRes.y + c;
  float r = length(p);
  float inScope = 1. - ss(R - .003, R + .003, r);

  vec4 ca = cellAt(q, c, PITCH, SCREEN);
  float vf = furnace(ca.xy);
  vec2 fl = vec2(0., 1.);
  if (INTRO > .001) fl = linkField((ca.xy - c) / uRes.y, ca.xy);
  // the scope dims the smoke inside it, so the survey reads
  float v = mix(vf, vf * .35, inScope * INTRO) + fl.x + pools(ca.xy);
  float unres = (1. - fl.y) * step(.001, INTRO);
  float m = dotMask(ca.zw, v, PITCH, .6);

  // The misregistered second screen: where the signal is still noise, the two beat into moire.
  if (unres > .01 && uShedMask.y > .5) {
    float d = unres * (.09 + .04 * sin(T * W64 * 9.)) + WARN * .06;
    float pb = PITCH * (1. + .05 * unres);
    vec4 cb = cellAt(q, c, pb, SCREEN + d);
    vec2 fb = linkField((cb.xy - c) / uRes.y, cb.xy);
    m = max(m, dotMask(cb.zw, fb.x, pb, .62) * unres * .85);
  }

  vec3 ink = mix(DEEP, RED, ss(.22, .7, v));
  ink = mix(ink, PALE, ss(.85, 1.25, v) * .6);
  ink = mix(ink, SNOW * .6, unres * .75);
  ink = mix(ink, AMBER, WARN * .18 * fl.y * step(.001, INTRO));

  float heat = ss(.05 - uField.y * .45, 1.1, q.y / uRes.y);
  vec3 col = VOID + DEEP * (heat * .2 * uField.x + .12 * inScope * INTRO);
  col = mix(col, ink, m);

  if (INTRO > .001) col = linkLines(col, p, q, fl.y);
  return mix(VOID, col, vis);
}

// The misprint's ghost plate: the scope's print and line work only. The smoke and
// the second screen are left out, so the two ghosts cost a fraction of a layer.
float ghost(vec2 q) {
  vec2 c = uRes * .5;
  vec2 p = (q - c) / uRes.y;
  vec4 ca = cellAt(q, c, PITCH, SCREEN);
  vec2 fl = linkField((ca.xy - c) / uRes.y, ca.xy);
  vec3 col = RED * dotMask(ca.zw, fl.x, PITCH, .6);
  col = linkLines(col, p, q, fl.y);
  return lum(col);
}
`;

/** The breach (aegisBreach): focus scan, glitch tear, the burning edge, the cut. */
const BREACH_GLSL = /* glsl */ `
float spark(vec2 px, float scale, float n) {
  vec2 g = px / uRes.y * scale;
  g.y += T * n / 64.;
  vec2 cell = floor(g);
  vec2 rnd = h22(vec2(cell.x, mod(cell.y, n)));
  vec2 f = fract(g) - .5 - (rnd - .5) * .6;
  f.x += sin(T * W64 * (29. + floor(rnd.x * 8.)) + rnd.y * 30.) * .12;
  f.y *= .4;
  float size = .025 + rnd.x * .04;
  float flick = .6 + .4 * sin(T * W64 * (92. + floor(rnd.y * 112.)) + rnd.x * 50.);
  return exp(-dot(f, f) / (size * size)) * step(.6, rnd.y) * flick;
}

vec4 breach(vec2 px0, vec2 px, float row, float rowF, float rows, float torn) {
  vec2 A = vec2(ASPECT, 1.);
  vec2 uv = px0 / uRes;
  float focus = uBreach.x, glitch = uBreach.y, burn = uBreach.z, cut = uBreach.w;
  vec2 ctr = vec2(.5);
  vec2 hb = vec2(.42, .13);
  vec2 p = (px / uRes - ctr) * A;
  float d = sdBox(p, hb);
  float tick = floor(T * 20.);
  vec4 acc = vec4(0.);

  float outside = ss(.05, .42, d);
  float vig = ss(.25, 1.3, length((uv - ctr) * A));
  acc = over(acc, VOID, focus * (.5 * outside + .3 * vig));

  float inCard = 1. - ss(-.002, .002, d);
  float cy = clamp((p.y + hb.y) / (2. * hb.y), 0., 1.);
  float scanAt = focus * 1.2 - .1;
  float film = ss(cy, cy + .1, scanAt) * inCard * (1. - ss(0., .12, burn));
  float fpitch = PITCH * .7;
  vec4 fc = cellAt(px, vec2(0.), fpitch, SCREEN);
  float fv = film * (.16 + .16 * vnoise(fc.xy / (22. * S)));
  acc = over(acc, RED, dotMask(fc.zw, fv, fpitch, .6) * .9);
  float scanLine = exp(-sq((cy - scanAt) / .01)) * inCard * step(scanAt, 1.05) * step(.001, focus);
  acc = glowA(acc, (RED + WHITE * .35) * scanLine * .8);

  if (glitch > .001) {
    float cols = 8. + floor(h21(vec2(row, tick + 2.)) * 40.);
    float blk = h21(vec2(floor(px0.x / uRes.x * cols), row + tick * 17.));
    acc = over(acc, VOID, torn * .45 * glitch);
    acc = over(acc, mix(RED, CYAN, step(.94, blk)), step(.72, blk) * torn * .5 * glitch);
    float e = 1.5 * rows / uRes.y;
    float topE = (1. - ss(0., e, rowF)) * torn;
    float botE = ss(1. - e, 1., rowF) * torn;
    acc = glowA(acc, (CYAN * topE + RED * botE) * glitch);
    float snow = step(.94, h21(floor(px0 / (2. * S)) + tick * 3.1));
    acc = glowA(acc, vec3(.8, .75, .72) * snow * .3 * glitch);
    float scan = .5 + .5 * sin(px0.y / S * 1.5708);
    acc = over(acc, VOID, scan * .25 * glitch);
    float roll = exp(-sq((fract(uv.y - T * 83. / 64.) - .5) / .025));
    acc = glowA(acc, RED * roll * .3 * glitch);
  }

  float f0 = -1.;
  if (burn > .001) {
    float far = .5 * sqrt(ASPECT * ASPECT + 1.);
    float level = mix(-min(hb.x, hb.y), far + .5, burn);
    float climb = ss(0., .25, burn) * .24;
    float n0 = fbmP(p * 3.2 + vec2(0., T * 1.375), 8., 3);
    f0 = level - d - (n0 - .5) * .34 + max(-p.y, 0.) * climb;
    float fe = f0 + (vnoise(px / (3. * S)) - .5) * .012;

    // heat haze bends the print screen near the front (shed with the smoke octaves)
    float heatH = exp(-f0 * f0 / .03) * uShedMask.z;
    vec2 wob = vec2(0.);
    if (heatH > .01) wob = vec2(fbmP(p * 5. + vec2(0., T * 3.), 8., 2), fbmP(p * 5. + vec2(4.3, T * 3.375), 8., 2)) - .5;
    float pitch = PITCH * 1.17;
    vec4 cell = cellAt(px + wob * heatH * 22. * S, vec2(0.), pitch, SCREEN);
    vec2 cp = (cell.xy / uRes - ctr) * A;
    float cd = sdBox(cp, hb);
    float n = fbmP(cp * 3.2 + vec2(0., T * 1.375), 8., 3);
    float f = level - cd - (n - .5) * .34 + max(-cp.y, 0.) * climb;

    float charA = ss(-.003, .003, fe);
    vec3 ground = mix(DEEP * .45, VOID, ss(0., .3, f0));
    acc = over(acc, ground, charA);

    float tongue = fbmP(vec2(cp.x * 6., cp.y * 2. + T * 2.625), 8., 3);
    float ahead = ss(-.22 * tongue - .03, 0., f);
    float behind = 1. - ss(.02, .2, f);
    float v = ahead * behind * (.25 + 1.05 * tongue * tongue);
    float smoke = (fbmP(cp * 2.4 + vec2(0., T * .75), 8., 3) - .38) * ss(.05, .35, f) * (1. - ss(.7, 1.5, f));
    v = max(v, smoke * .4);
    float hot = exp(-f * f / .006);
    vec3 col = mix(DEEP * .8, RED, ss(.2, .55, v));
    col = mix(col, PALE, ss(.65, 1.05, v) * (.15 + .85 * hot));
    col = mix(col, WHITE, ss(.9, 1.25, v) * hot);
    acc = over(acc, col, dotMask(cell.zw, clamp(v, 0., 1.), pitch, .62));

    float edge = exp(-sq(fe / (2. * PX)));
    float halo = exp(-sq(max(-fe, 0.) / .045)) * (1. - charA);
    acc = glowA(acc, (WHITE * .8 + PALE * .6) * edge + RED * halo * .35);
  }

  acc = mix(acc, vec4(VOID, 1.), cut);

  if (burn > .001 && uShedMask.w > .5) {
    float sp = spark(px0, 8., 58.) * .7 + spark(px0, 15., 102.) + spark(px0 + 37., 26., 154.) * .8;
    float zone = max(ss(-.3, .05, f0) * (1. - ss(.8, 1.5, f0)), cut * .35);
    acc = glowA(acc, mix(RED, PALE, clamp(sp, 0., 1.)) * sp * zone * 1.6);
  }
  return acc;
}
`;

const MAIN_GLSL = /* glsl */ `
// Scanlines (every third device row), vignette, grain; premultiplied by the master fade.
void col3out(vec3 col, vec2 uv, vec2 px0) {
  col *= 1. - .14 * step(2., mod(px0.y, 3.));
  col *= 1. - ss(.45, 1.2, length((uv - .5) * vec2(ASPECT * .75, 1.))) * .6;
  col += (h21(px0 + fract(T * 7.) * 91.) - .5) * .035;
  col = clamp(col, 0., 1.);
  outColor = vec4(col * uIntensity, uIntensity);
}

void main() {
  vec2 px0 = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);   // top-left origin, y down
  vec2 uv = px0 / uRes;
  T = uTime;
  S = max(uRes.y / 1080., .5);
  ASPECT = uRes.x / uRes.y;
  R = min(.34, ASPECT * .36);
  HEX = R / 2.9;
  PX = 1. / uRes.y;                 // one device pixel, in screen heights
  PITCH = 6. * S;
  MAXR = .5 * sqrt(ASPECT * ASPECT + 1.);
  INTRO = uLink.x;
  SYNC = uLink.y;
  SWEEP = (uLink.z - .25) * TAU;
  PULSE = uLink.w;
  RINGR = uEvent.x * (MAXR + .1);
  RINGE = (1. - uEvent.x) * step(.001, uEvent.x);
  FOLD = uEvent.y;
  SLAM = uEvent.z;
  WARN = uEvent.w;
  LOCK = ss(.985, 1., SYNC);
  FRONT = SYNC * (MAXR + .06) - .03;
  RED = uAccent;
  DEEP = uAccent * uAccent * .55 + uInk * .3;   // #ff3b2f -> ~#8a0d12
  PALE = uHot;
  VOID = uInk;
  AMBER = uWarn;
  WHITE = mix(uHot, vec3(1., .95, .86), .7);

  // Torn rows: on the misprint pulse, the warning, the breach glitch.
  float tick = floor(T * 20.);
  float rows = 18. + floor(h21(vec2(tick, 1.3)) * 30.);
  float row = floor(uv.y * rows);
  float rowF = fract(uv.y * rows);
  float amt = max(max(WARN * .6, PULSE * .6), uBreach.y);
  float torn = step(1. - amt * .28, h21(vec2(row, tick))) * step(.001, amt);
  vec2 px = px0 + vec2((h21(vec2(row, tick + 7.)) - .5) * .12 * amt * torn * uRes.x, 0.);

  // The furnace's own torn signal: short bands that shove the picture sideways.
  float ftick = floor(T * 1.75);
  float tear = step(.86 - uField.z, h21(vec2(ftick, 3.))) * step(fract(T * 1.75), .18 + uField.z * .5);
  float bandY = h21(vec2(ftick, 9.));
  float inBand = step(abs(uv.y - bandY), .03 + h21(vec2(ftick, 5.)) * .05) * tear * step(.001, uField.x);

  // The sort: each travelling card drags a torn band of signal along its row.
  float streak = 0.;
  if (uSort.x > .001) {
    for (int i = 0; i < 12; i++) {
      if (float(i) >= uAnchorN) break;
      vec4 a = uAnchors[i];
      float h = max(a.z, 24.) * .3;
      float inRow = 1. - ss(h * .7, h, abs(px0.y - a.y));
      float lane = step(.7, h21(vec2(floor(px0.y / (3. * S)), tick + float(i) * 13.)));
      streak = max(streak, inRow * mix(.35, 1., lane));
    }
    streak *= uSort.x;
  }
  px.x += inBand * (h21(vec2(ftick, 7.)) - .5) * 60. * S;
  px.x += streak * (h21(vec2(floor(px0.y / (2. * S)), tick)) - .5) * 90. * S;

  // The breach is drawn first: where its char is opaque, nothing under it is computed.
  vec4 b = vec4(0.);
  if (dot(uBreach, vec4(1.)) > .001) b = breach(px0, px, row, rowF, rows, torn);
  if (b.a > .995) {
    col3out(b.rgb, uv, px0);
    return;
  }

  vec3 col = layer(px);

  // The misprint: cyan and magenta ghosts of the whole plate slide out on each event.
  if (PULSE > .04 && INTRO > .001 && uShedMask.x > .5) {
    vec2 off = vec2(PULSE * 10. * S, 0.);
    float gc = ghost(px + off);
    float gm = ghost(px - off);
    col = 1. - (1. - col) * (1. - CYAN * gc * PULSE * 1.4) * (1. - MAGENTA * gm * PULSE * 1.4);
  }

  // Colour split inside torn bands and sort streaks.
  float split = max(inBand, streak);
  col = mix(col, vec3(col.r * 1.5, col.g * .6, col.b * 1.3 + .05), split);
  col += (CYAN * step(.5, fract(px0.y / (2. * S))) + RED) * streak * .06;

  // Landing flares: a hot cross of light through each die that just landed.
  for (int i = 0; i < 12; i++) {
    if (float(i) >= uAnchorN || uSort.w < .001) break;
    float fl = flareOf(i);
    if (fl < .002) continue;
    vec4 a = uAnchors[i];
    vec2 dp = (px0 - a.xy) / max(a.z, 8.);
    float star = exp(-abs(dp.y) * 30.) * exp(-abs(dp.x) * .9) + exp(-abs(dp.x) * 30.) * exp(-abs(dp.y) * 2.2) * .5;
    float ring = exp(-sq((length(dp) - (1. - fl) * 1.6 - .3) * 9.)) * fl;
    col += (RED * 1.2 + WHITE * .5 * fl) * (star * fl + ring) * .9;
  }

  // The horizon: grows out from the centre as the fold lands, burns, then cuts.
  vec2 c = uRes * .5;
  float dy = (px0.y - c.y) / S;
  float dxN = abs(px0.x - c.x) / c.x;
  float g = ss(.25, .8, FOLD);
  float span = 1. - ss(g * 1.05 - .05, g * 1.05, dxN);
  float li = span * uSort.y * step(.001, FOLD);
  col += (WHITE * .7 + RED) * exp(-sq(dy / 1.3)) * li * 1.2;
  col += RED * exp(-abs(dy) / 14.) * li * .55;

  // The slam: a ragged halftone blast off the title's line, burning off.
  if (SLAM > .001) {
    float pitch = 7. * S;
    vec4 cl = cellAt(px0, c, pitch, SCREEN);
    float cdy = abs(cl.y - c.y) / S;
    float spread = (uRes.y / S) * (.004 + .17 * sqrt(SLAM));
    float rag = .55 + .9 * vnoise(vec2(cl.x / (38. * S), floor(T * 12.) * .23));
    float e = 1. - SLAM;
    float bv = exp(-cdy / (spread * rag)) * e * e * 1.4;
    vec3 bc = mix(DEEP, RED, ss(.1, .45, bv));
    bc = mix(bc, PALE, ss(.55, .9, bv));
    bc = mix(bc, WHITE, ss(.95, 1.4, bv));
    col = mix(col, bc, dotMask(cl.zw, clamp(bv, 0., 1.), pitch, .64));
  }

  // Embers, three depths, rising through everything but the void after a cut.
  if (uShedMask.w > .5 && uField.x > .001) {
    float heat = ss(.05 - uField.y * .45, 1.1, uv.y);
    float e = ember(px0, 7., 22., .35) * .6 + ember(px0, 13., 45., .3) * .8 + ember(px0, 22., 77., .25);
    col += mix(RED, PALE, clamp(e, 0., 1.)) * e * (.35 + heat) * uField.x * 1.3 * (1. - FOLD);
  }

  // The breach rides over the lot, premultiplied.
  col = b.rgb + col * (1. - b.a);
  col3out(col, uv, px0);
}
`;

/** The whole fragment the skin hands the backdrop (appended after the PRELUDE). */
export const FRAGMENT_GLSL = [UNIFORMS_GLSL, HELPERS_GLSL, GLOBALS, FURNACE_GLSL, LINK_GLSL, LAYER_GLSL, BREACH_GLSL, MAIN_GLSL].join("\n");
