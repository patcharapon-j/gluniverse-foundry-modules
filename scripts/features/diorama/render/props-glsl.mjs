/**
 * Diorama — the GLSL of props. Pure strings, in three's GLSL1 dialect like
 * glsl.mjs, whose lit chunk (HEAD) every program here includes so a prop is
 * lit, shadowed, weathered and fogged exactly as the ground under it.
 *
 * Kept out of glsl.mjs on purpose: that file is the environment's. The check
 * tool (tools/diorama-check/props.mjs) parses every uniform declared here and
 * requires the material that compiles it to carry a value.
 *
 * Props are drawn INSTANCED, one InstancedMesh per (geometry part × material),
 * with three's own `instanceMatrix` (unit footprint [-0.5, 0.5] × [0, 1] × [-0.5,
 * 0.5] scaled to w × h × d, turned, and stood at its base) and three attributes:
 *   iTint  vec3   the GM's colour, or white
 *   iInfo  vec4   seed 0..1, ghost (GM-only prop), base y in cells, has tint
 *   iFade  float  1 drawn, 0 gone: a roof faded while a figure is under it
 *   iSeen  float  1 when a viewer sees the prop itself in 3D though the ground
 *                 under it is hidden (a tree's crown over a cliff's lip), else 0
 *
 * A prop draws where the ground at its centre or under the pixel has been seen,
 * or where iSeen says the prop itself is: who sees it is the view's question
 * (view/props-seen.mjs), asked the way Foundry is asked about a token on that
 * ground (foundry/sight-backend.mjs columnSeen).
 *
 * The look is painted, not photographed: a contact shadow and a soft base AO
 * ground every prop, box edges catch a lit bevel, a thin rim separates a prop
 * from the board behind it, and at high detail each material carries its own
 * relief (stone courses, marble veins, wood grain, crate planks, barrel
 * hoops, pillar flutes, leaf clumps, roof shingles). Foliage sways in the
 * scene's wind only at high detail, on the shared clock (uTime), so an idle
 * board stays idle.
 *
 * Level of detail: uPropLod (0..1) follows how many device pixels a cell
 * covers. Relief and sway fade with it, continuously, so zooming out never
 * pops a pattern off. It is a uniform, so the branches it guards are uniform
 * control flow and the derivatives inside them stay defined.
 *
 * A fade (a roof, iFade / aSlab.y) is a screen-door dither, not blending: the
 * program stays opaque, sorts with the depth buffer, and a faded roof needs no
 * second program.
 */

import { HEAD, SIDE_VERT, SIDE_FRAG } from "./glsl.mjs";

/** Material keys → shader ids (PROP_MATERIALS order). */
export const PROP_MAT_ID = Object.freeze({
  stone: 0, marble: 1, wood: 2, metal: 3, foliage: 4, crystal: 5, plaster: 6, cloth: 7, earth: 8, ice: 9, map: 10,
});

/** Geometry parts that carry their own relief (uPart). */
export const PROP_PART_ID = Object.freeze({
  plain: 0, crate: 1, barrel: 2, trunk: 3, rock: 4, pillar: 5, box: 6, roof: 7, coals: 8, lantern: 9, step: 10, iron: 11,
});

/* ------------------------------------------------------------------ shared */

/** Helpers every prop program reads. */
const PROP_COMMON = /* glsl */ `
const vec3 PROP_LUMA = vec3(0.299, 0.587, 0.114);

float propMid(vec3 d) { return max(min(d.x, d.y), min(max(d.x, d.y), d.z)); }

/** A line every 'period' cells along x, 'w' cells wide, antialiased. */
float propLines(float x, float period, float w) {
  float f = abs(fract(x / period + 0.5) - 0.5) * period;
  float aa = max(fwidth(x), 1e-4);
  return 1.0 - smoothstep(w, w + aa * 1.5, f);
}

/** Screen-door threshold, 0..1, per pixel: what a fade under 1 drops. */
float propDither() {
  return fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
}

/** A GM-only ghost: a hatch, never solid, so it reads as "not there". */
bool propHatch() { return mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 4.0) > 1.5; }
`;

/* ------------------------------------------------------------------ solid */

export const PROP_VERT = /* glsl */ `
attribute vec3 iTint;
attribute vec4 iInfo;
attribute float iFade;
attribute float iSeen;
uniform float uTime;
uniform float uPropSway;   // 0..1: foliage sway (high detail, wind), scaled by the level of detail
uniform vec3 uPropWind;    // x, z direction on the map, speed 0..1
uniform float uFoliage;    // this part sways
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vScale;
varying vec3 vTint;
varying vec4 vInfo;
varying vec2 vCenter;
varying float vFade;
varying float vSeen;
void main() {
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
  vec3 s = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vec3 n = mat3(im) * (normal / max(s * s, vec3(1e-6)));
  vSeen = iSeen;
  if (uFoliage > 0.5 && uPropSway > 0.001) {
    // planted at the base, moving most at the top; each prop on its own phase
    float k = position.y * position.y;
    float ph = iInfo.x * 6.2831853;
    float w = sin(uTime * 1.6 + ph + wp.x * 0.55 + wp.z * 0.35) * 0.65 + sin(uTime * 2.7 + ph * 1.7) * 0.35;
    vec2 dir = length(uPropWind.xy) > 0.001 ? normalize(uPropWind.xy) : vec2(1.0, 0.0);
    float amp = (0.015 + 0.06 * uPropWind.z) * min(s.y, 4.0) * k * uPropSway;
    wp.xz += dir * (w * 0.6 + 0.4 * uPropWind.z) * amp;
  }
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vLocal = position;
  vScale = s;
  vTint = iTint;
  vInfo = iInfo;
  vFade = iFade;
  vCenter = (modelMatrix * vec4(im[3].xyz, 1.0)).xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PROP_FRAG = HEAD + PROP_COMMON + /* glsl */ `
uniform float uPropMat;     // PROP_MAT_ID
uniform float uPart;        // PROP_PART_ID
uniform float uBevel;       // box-like: lit edges
uniform float uPropDetail;  // 1 = relief on (high detail)
uniform float uPropLod;     // 0..1: relief's share at this zoom
uniform float uFoliage;
uniform vec3 uGhostColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vLocal;
varying vec3 vScale;
varying vec3 vTint;
varying vec4 vInfo;
varying vec2 vCenter;
varying float vFade;
varying float vSeen;

/*
 * The material's colour at a point. 'hi' (0..1) is how much relief it
 * carries: each pattern is computed only while it shows, then mixed in by hi,
 * so a zoom never switches one off at a line.
 */
vec3 propAlbedo(int m, int part, vec3 wp, vec3 lp, vec3 n, float seed, float hi) {
  float up = n.y;
  vec2 t2 = normalize(vec2(-n.z, n.x) + vec2(1e-4, 0.0));
  float along = dot(wp.xz, t2);
  float nz = dioNoise(wp.xz * 3.1 + vec2(wp.y * 2.3, seed * 13.0));
  vec3 c;
  bool rel = hi > 0.001;
  if (m == 0) {
    // stone: grey with a warm cast, block courses on the sides, flags on tops
    c = vec3(0.58, 0.56, 0.52) * (0.88 + 0.2 * nz);
    if (rel) {
      vec3 b = c;
      if (abs(up) < 0.6) {
        float row = floor(wp.y / 0.32);
        float joint = max(propLines(wp.y, 0.32, 0.012), propLines(along + row * 0.27, 0.54, 0.012));
        c *= 1.0 - 0.32 * joint;
        c *= 0.94 + 0.1 * dioHash(vec2(floor((along + row * 0.27) / 0.54), row + seed * 7.0));
      } else {
        float joint = max(propLines(wp.x + seed, 0.5, 0.012), propLines(wp.z, 0.5, 0.012));
        c *= 1.0 - 0.25 * joint;
      }
      c *= 0.94 + 0.12 * dioFbm(wp.xz * 6.0 + wp.y * 3.0);
      c = mix(b, c, hi);
    }
  } else if (m == 1) {
    // marble: warm white, blue-grey veins
    c = vec3(0.88, 0.86, 0.82) * (0.96 + 0.06 * nz);
    if (rel) {
      float v = abs(sin((wp.x * 1.3 + wp.y * 2.1 + wp.z * 0.9) * 3.0 + dioFbm(wp.xz * 2.0 + vec2(wp.y * 1.5, seed * 9.0)) * 6.0));
      float vein = pow(1.0 - v, 10.0);
      c = mix(c, vec3(0.52, 0.55, 0.62), vein * 0.7 * hi);
    }
  } else if (m == 2) {
    // wood: brown, grain running up the piece
    c = vec3(0.54, 0.38, 0.23) * (0.9 + 0.16 * nz);
    if (rel) {
      vec3 b = c;
      float g = sin(along * 38.0 + dioNoise(vec2(along * 6.0, wp.y * 1.4 + seed * 5.0)) * 7.0);
      c *= 0.9 + 0.1 * g;
      if (up > 0.6) c *= 0.95 + 0.1 * sin(length(wp.xz - vCenter) * 60.0 + nz * 3.0);
      c = mix(b, c, hi);
    }
  } else if (m == 3) {
    // metal: cool grey, brushed
    c = vec3(0.56, 0.58, 0.62) * (0.92 + 0.1 * nz);
    if (rel) c *= 1.0 + hi * (-0.07 + 0.12 * dioNoise(vec2(along * 3.0, wp.y * 60.0)));
  } else if (m == 4) {
    // foliage: clumps of light and shade, lighter where they face the sky
    float cl = dioFbm(wp.xz * 2.6 + vec2(wp.y * 2.2, seed * 11.0));
    c = mix(vec3(0.24, 0.40, 0.17), vec3(0.42, 0.60, 0.25), cl);
    c *= 0.86 + 0.24 * clamp(up * 0.5 + 0.5, 0.0, 1.0);
    if (rel) {
      float leaf = dioNoise(wp.xz * 14.0 + wp.y * 9.0);
      c *= 1.0 + hi * (-0.14 + 0.26 * smoothstep(0.35, 0.8, leaf));
    }
  } else if (m == 5) {
    // crystal: pale cyan, facets kept by the flat normals
    c = vec3(0.58, 0.80, 0.96) * (0.92 + 0.12 * nz);
  } else if (m == 6) {
    // plaster: warm limewash with soft blotches
    c = vec3(0.86, 0.82, 0.74) * (0.95 + 0.06 * nz);
    if (rel) c *= 1.0 + hi * (-0.07 + 0.08 * dioFbm(wp.xz * 2.4 + wp.y * 1.9));
  } else if (m == 7) {
    // cloth: a dyed red, a fine weave, a few soft folds
    c = vec3(0.66, 0.24, 0.22);
    c *= 0.92 + 0.08 * sin(along * 7.0 + wp.y * 3.0 + seed * 6.0);
    if (rel) c *= 1.0 + hi * (-0.05 + 0.05 * sin(along * 140.0) * sin(wp.y * 140.0));
  } else if (m == 8) {
    // earth: packed soil, speckled
    c = vec3(0.47, 0.36, 0.25) * (0.86 + 0.24 * nz);
    if (rel) c *= 1.0 + hi * (-0.1 + 0.2 * step(0.82, dioHash(floor(wp.xz * 24.0) + floor(wp.y * 24.0))));
  } else if (m == 9) {
    // ice: pale blue, hairline cracks
    c = vec3(0.72, 0.87, 0.96) * (0.95 + 0.06 * nz);
    if (rel) {
      float cr = abs(dioNoise(wp.xz * 4.0 + wp.y * 3.0) - 0.5);
      c = mix(c, vec3(0.95, 0.98, 1.0), (1.0 - smoothstep(0.0, 0.03, cr)) * 0.5 * hi);
    }
  } else {
    // map: the map art under the prop, so it reads as part of the painting
    c = up > 0.5 ? mapAt(wp.xz) : mapSoft(vCenter) * (0.82 + 0.1 * nz);
  }

  // parts with relief of their own
  if (part == 1 && rel) {
    // crate: a frame round every face and planks across it
    vec3 d = (0.5 - abs(lp - vec3(0.0, 0.5, 0.0))) * vScale;
    float edge = propMid(d);
    float frame = 1.0 - smoothstep(0.08, 0.1, edge);
    float plank = propLines(lp.y * vScale.y, 0.25, 0.008);
    vec3 b = c;
    c *= 1.0 - 0.28 * max(plank * (1.0 - frame), 0.0);
    c *= mix(1.0, 0.82, frame);
    c = mix(b, c, hi);
  } else if (part == 2 && rel) {
    // barrel: staves round it, two dark hoops
    float a = atan(lp.z, lp.x);
    vec3 b = c;
    c *= 0.9 + 0.1 * smoothstep(0.0, 0.25, abs(fract(a * 2.5465) - 0.5));
    float hy = lp.y;
    float hoop = step(0.13, hy) * step(hy, 0.2) + step(0.8, hy) * step(hy, 0.87);
    c = mix(c, vec3(0.24, 0.24, 0.26), hoop * step(abs(n.y), 0.7));
    c = mix(b, c, hi);
  } else if (part == 3) {
    // trunk: bark, always brown whatever the crown is made of
    c = vec3(0.36, 0.26, 0.17) * (0.86 + 0.2 * nz);
    if (rel) c *= 1.0 + hi * (-0.18 + 0.22 * smoothstep(0.2, 0.8, dioNoise(vec2(atan(lp.z, lp.x) * 3.0, lp.y * 10.0))));
  } else if (part == 4 && rel) {
    // rock: lichen on what faces up
    float lic = smoothstep(0.62, 0.8, dioFbm(wp.xz * 5.0 + seed * 17.0)) * smoothstep(0.3, 0.8, up);
    c = mix(c, vec3(0.50, 0.56, 0.30), lic * 0.55 * hi);
  } else if (part == 5 && rel) {
    // pillar: flutes down the shaft
    float a = atan(lp.z, lp.x);
    float shaft = step(0.09, lp.y) * step(lp.y, 0.9);
    c *= 1.0 - 0.14 * hi * shaft * smoothstep(0.55, 1.0, abs(sin(a * 8.0)));
  } else if (part == 7) {
    // roof: courses of shingles down every slope, staggered, the eaves darker
    if (up > 0.12 && rel) {
      float row = floor(wp.y / 0.11);
      float course = propLines(wp.y, 0.11, 0.006);
      float joint = propLines(along + mod(row, 2.0) * 0.09, 0.18, 0.005);
      vec3 b = c;
      c *= 1.0 - 0.3 * max(course, joint * 0.7);
      c *= 0.92 + 0.14 * dioHash(vec2(floor((along + mod(row, 2.0) * 0.09) / 0.18), row + seed * 5.0));
      c = mix(b, c, hi);
    }
    c *= mix(0.78, 1.0, smoothstep(0.0, 0.25, lp.y));
  } else if (part == 8) {
    // coals: charred black, embers glowing between them (the glow is added after the light)
    c = vec3(0.12, 0.09, 0.08) * (0.7 + 0.5 * nz);
  } else if (part == 9) {
    // a lantern's panes: warm glass in a dark frame
    c = vec3(0.95, 0.78, 0.46);
  } else if (part == 10 && rel) {
    // a flight's treads: the nosing of every step a little lighter
    c *= 1.0 + 0.1 * hi * step(0.6, up);
  } else if (part == 11) {
    // wrought iron (a brazier, a lamp post): the material, blackened by fire and weather
    c *= 0.4;
  }
  return c;
}

void main() {
  float vis = max(max(visionAt(vWorld.xz), visionAt(vCenter)), vSeen);
  if (vis <= 0.0) discard;
  bool ghost = vInfo.y > 0.5;
  if (ghost && propHatch()) discard;
  if (vFade < 0.999 && propDither() >= vFade) discard;
  vec3 n = normalize(vNormal);
  int m = int(uPropMat + 0.5);
  int part = int(uPart + 0.5);
  float hi = uPropDetail * uPropLod;
  vec3 c = propAlbedo(m, part, vWorld, vLocal, n, vInfo.x, hi);
  if (vInfo.w > 0.5 && part != 8 && part != 9) {
    // the GM's colour: its hue, the material's own lightness
    float l = dot(c, PROP_LUMA);
    vec3 tc = vTint * l / max(dot(vTint, PROP_LUMA), 0.05);
    c = mix(c, tc, 0.85);
  }
  // soft AO where the prop meets what it stands on
  float above = vWorld.y - vInfo.z;
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.5, above));
  vec3 lit = shade(c, vWorld, n, ao, vWorld.xz + n.xz * 0.14);
  vec3 V = normalize(cameraPosition - vWorld);
  float ndv = clamp(dot(n, V), 0.0, 1.0);
  // shine: metal, ice and crystal catch the sun; marble a little
  float shine = m == 3 ? 0.55 : m == 9 ? 0.45 : m == 5 ? 0.6 : m == 1 ? 0.18 : 0.0;
  if (shine > 0.0) {
    float sh = shadowAt(vWorld, n);
    float sp = pow(max(dot(n, normalize(uKeyDir + V)), 0.0), m == 3 ? 28.0 : 60.0);
    lit += vec3(1.0, 0.96, 0.88) * sp * shine * sh * uAmbient;
  }
  if (m == 4) {
    // light through the leaves, from behind
    lit += vec3(0.10, 0.15, 0.04) * max(dot(-n, uKeyDir), 0.0) * uAmbient * 0.8;
  }
  if (m == 5 && part != 9) {
    // a soft glow of its own, strongest at the silhouette, never shadowed
    vec3 g = (vInfo.w > 0.5 ? vTint : vec3(0.55, 0.85, 1.0)) * (0.22 + 0.4 * pow(1.0 - ndv, 2.0));
    lit += g;
  }
  if (m == 9) lit = mix(lit, lit + vec3(0.18, 0.22, 0.26) * uAmbient, pow(1.0 - ndv, 3.0));
  if (part == 8) {
    // embers: a glow of their own in the cracks between the coals, never shadowed
    float crack = smoothstep(0.42, 0.72, dioNoise(vWorld.xz * 9.0 + vInfo.x * 31.0));
    float hot = 0.35 + 0.65 * smoothstep(0.2, 0.9, dioFbm(vWorld.xz * 4.0 + vInfo.x * 7.0));
    vec3 ember = (vInfo.w > 0.5 ? vTint : vec3(1.0, 0.42, 0.12));
    lit = lit * 0.6 + ember * crack * hot * 0.95;
  }
  if (part == 9) {
    // a lit lantern: its panes glow, brightest face on
    vec3 glow = vInfo.w > 0.5 ? vTint : vec3(1.0, 0.8, 0.5);
    lit = lit * 0.35 + glow * (0.62 + 0.28 * ndv);
  }
  if (uBevel > 0.5) {
    // a lit bevel along every box edge, a few hundredths of a cell wide
    vec3 d = (0.5 - abs(vLocal - vec3(0.0, 0.5, 0.0))) * vScale;
    float edge = propMid(d);
    float bev = 1.0 - smoothstep(0.0, 0.035, edge);
    lit *= 1.0 + 0.22 * bev * (0.4 + 0.6 * max(dot(n, uKeyDir), 0.0));
  }
  // a thin rim off the board behind it
  lit += lit * 0.12 * pow(1.0 - ndv, 3.0);
  vec3 outc = dioFinish(lit, vis, vWorld);
  if (ghost) outc = mix(outc, uGhostColor, 0.45);
  gl_FragColor = vec4(outc, 1.0);
}
`;

/* ------------------------------------------------------------------ model */

/** An imported model's mesh: as a prop, with its own base colour (map and factor). */
export const PROP_MODEL_VERT = /* glsl */ `
attribute vec3 iTint;
attribute vec4 iInfo;
attribute float iFade;
attribute float iSeen;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTint;
varying vec4 vInfo;
varying vec2 vCenter;
varying vec2 vUv;
varying float vFade;
varying float vSeen;
void main() {
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
  vec3 s = vec3(length(im[0].xyz), length(im[1].xyz), length(im[2].xyz));
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vec3 n = mat3(im) * (normal / max(s * s, vec3(1e-6)));
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * n);
  vTint = iTint;
  vInfo = iInfo;
  vFade = iFade;
  vSeen = iSeen;
  vUv = uv;
  vCenter = (modelMatrix * vec4(im[3].xyz, 1.0)).xz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PROP_MODEL_FRAG = HEAD + PROP_COMMON + /* glsl */ `
uniform sampler2D uModelMap;
uniform float uModelHasMap;
uniform vec3 uModelColor;
uniform float uModelAlphaTest;
uniform vec3 uGhostColor;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vTint;
varying vec4 vInfo;
varying vec2 vCenter;
varying vec2 vUv;
varying float vFade;
varying float vSeen;
void main() {
  float vis = max(max(visionAt(vWorld.xz), visionAt(vCenter)), vSeen);
  if (vis <= 0.0) discard;
  bool ghost = vInfo.y > 0.5;
  if (ghost && propHatch()) discard;
  if (vFade < 0.999 && propDither() >= vFade) discard;
  vec4 tex = uModelHasMap > 0.5 ? texture2D(uModelMap, vUv) : vec4(1.0);
  if (uModelAlphaTest > 0.0 && tex.a < uModelAlphaTest) discard;
  vec3 c = tex.rgb * uModelColor;
  if (vInfo.w > 0.5) {
    float l = dot(c, PROP_LUMA);
    c = mix(c, vTint * l / max(dot(vTint, PROP_LUMA), 0.05), 0.85);
  }
  vec3 n = normalize(vNormal);
  if (!gl_FrontFacing) n = -n;
  float above = vWorld.y - vInfo.z;
  float ao = mix(0.55, 1.0, smoothstep(0.0, 0.5, above));
  vec3 lit = shade(c, vWorld, n, ao, vWorld.xz + n.xz * 0.14);
  vec3 V = normalize(cameraPosition - vWorld);
  lit += lit * 0.12 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 3.0);
  vec3 outc = dioFinish(lit, vis, vWorld);
  if (ghost) outc = mix(outc, uGhostColor, 0.45);
  gl_FragColor = vec4(outc, 1.0);
}
`;

/* ------------------------------------------------------------------ slab */

/**
 * A slab's top: the terrain top's look over an outline at any precision. The
 * map art projected straight down (so it lines up with the 2D map exactly),
 * the same light, the same lip (a soft bevel and one device-px hairline, from
 * aEdge: cells in from the outline), the same grid, the same grading.
 *   aSlab  vec2  x ghost (GM only), y fade (a roof)
 */
export const SLAB_TOP_VERT = /* glsl */ `
attribute float aEdge;
attribute vec2 aSlab;
varying vec3 vWorld;
varying float vEdge;
varying vec2 vSlab;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vEdge = aEdge;
  vSlab = aSlab;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const SLAB_TOP_FRAG = HEAD + PROP_COMMON + /* glsl */ `
uniform vec4 uGrid;
uniform vec3 uGhostColor;
varying vec3 vWorld;
varying float vEdge;
varying vec2 vSlab;

/* The terrain top's grid (glsl.mjs TOP_FRAG): device-px hairlines, faded out before they moire. */
float slabGrid(vec2 xz) {
  vec2 fw = max(fwidth(xz), vec2(1e-5));
  vec2 d = abs(fract(xz + 0.5) - 0.5) / fw;
  float line = 1.0 - smoothstep(0.35, 1.25, min(d.x, d.y));
  return line * (1.0 - smoothstep(0.07, 0.2, max(fw.x, fw.y)));
}

void main() {
  float vis = visionAt(vWorld.xz);
  if (vis <= 0.0) discard;
  // derivatives before any branch that could leave a pixel early
  float fw = max(fwidth(vEdge), 1e-5);
  float grid = uGrid.a > 0.0 ? slabGrid(vWorld.xz) : 0.0;
  if (vSlab.x > 0.5 && propHatch()) discard;
  if (vSlab.y < 0.999 && propDither() >= vSlab.y) discard;
  vec3 c = shade(mapAt(vWorld.xz), vWorld, vec3(0.0, 1.0, 0.0), 1.0, vWorld.xz);
  float bevel = 1.0 - smoothstep(0.0, 0.09, vEdge);
  float hair = smoothstep(-0.6 * fw, 0.1 * fw, vEdge) * (1.0 - smoothstep(1.0 * fw, 2.1 * fw, vEdge));
  c *= 1.0 + 0.11 * bevel;
  c += (c * 0.5 + vec3(0.07, 0.064, 0.054)) * hair * 0.7;
  if (uGrid.a > 0.0) {
    float lum = dot(c, PROP_LUMA);
    c = mix(c, min(uGrid.rgb * (0.25 + lum), vec3(1.0)), grid * uGrid.a);
  }
  c = heightGrade(c, vWorld.y);
  vec3 outc = dioFinish(c, vis, vWorld);
  if (vSlab.x > 0.5) outc = mix(outc, uGhostColor, 0.45);
  gl_FragColor = vec4(outc, 1.0);
}
`;

/**
 * A slab's sides are the terrain's own cliff program (glsl.mjs SIDE_VERT /
 * SIDE_FRAG), so a slab's face is a terrain face to the pixel: painted from
 * the lip, the material's relief, the foot's AO, the lip's hairline. Only a
 * ghost and a fade are added (aSlab), spliced in at the program's own main();
 * every uniform the terrain declares is still there, and the check holds this
 * program to them like any other.
 */
function spliceMain(src, decl, head, tail = "") {
  const at = src.lastIndexOf("void main() {");
  if (at < 0) throw new Error("diorama: the side program has no main()");
  const open = at + "void main() {".length;
  const close = src.lastIndexOf("}");
  return `${src.slice(0, at)}${decl}\n${src.slice(at, open)}\n${head}${src.slice(open, close)}${tail}\n}\n`;
}

export const SLAB_SIDE_VERT = spliceMain(SIDE_VERT,
  "attribute vec2 aSlab;\nvarying vec2 vSlab;",
  "  vSlab = aSlab;");

export const SLAB_SIDE_FRAG = spliceMain(SIDE_FRAG,
  PROP_COMMON + "uniform vec3 uGhostColor;\nvarying vec2 vSlab;",
  "  if (vSlab.x > 0.5 && propHatch()) discard;\n  if (vSlab.y < 0.999 && propDither() >= vSlab.y) discard;",
  "  if (vSlab.x > 0.5) gl_FragColor.rgb = mix(gl_FragColor.rgb, uGhostColor, 0.45);");

/* ------------------------------------------------------------------ card */

/** An image card standing upright at its base, turned to the camera's yaw. */
export const PROP_CARD_VERT = /* glsl */ `
uniform vec2 uCardSize;    // width, height in cells
varying vec2 vUv;
varying vec3 vWorld;
varying vec2 vCenter;
varying vec3 vFace;
void main() {
  vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  right.y = 0.0;
  right = length(right) > 1e-4 ? normalize(right) : vec3(1.0, 0.0, 0.0);
  vec3 wp = c + right * position.x * uCardSize.x + vec3(0.0, position.y * uCardSize.y, 0.0);
  vUv = uv;
  vWorld = wp;
  vCenter = c.xz;
  vFace = normalize(cross(right, vec3(0.0, 1.0, 0.0)));
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

export const PROP_CARD_FRAG = HEAD + /* glsl */ `
uniform sampler2D uCardTex;
uniform float uHasTex;
uniform vec3 uCardTint;
uniform float uCardGhost;
uniform float uCardFade;
uniform float uCardSeen;   // iSeen, for the one card
uniform vec3 uGhostColor;
varying vec2 vUv;
varying vec3 vWorld;
varying vec2 vCenter;
varying vec3 vFace;
void main() {
  float vis = max(visionAt(vCenter), uCardSeen);
  if (vis <= 0.0) discard;
  vec4 tex = uHasTex > 0.5 ? texture2D(uCardTex, vUv) : vec4(0.5, 0.5, 0.55, 1.0);
  if (tex.a < 0.5) discard;
  if (uCardGhost > 0.5 && mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y), 4.0) > 1.5) discard;
  if (uCardFade < 0.999 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= uCardFade) discard;
  // lit like a standee: half toward the sky so it never goes black side-on
  vec3 n = normalize(mix(-vFace, vec3(0.0, 1.0, 0.0), 0.5));
  float ao = mix(0.7, 1.0, smoothstep(0.0, 0.4, vUv.y));
  vec3 lit = shade(tex.rgb * uCardTint, vWorld, n, ao, vCenter);
  vec3 outc = dioFinish(lit, vis, vWorld);
  if (uCardGhost > 0.5) outc = mix(outc, uGhostColor, 0.45);
  gl_FragColor = vec4(outc, 1.0);
}
`;

/* ------------------------------------------------------------------ contact */

/** The soft contact shadow under every prop: what plants it on the board. */
export const PROP_CONTACT_VERT = /* glsl */ `
attribute vec4 iInfo;      // seed, fade, round, strength
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vWorld;
void main() {
#ifdef USE_INSTANCING
  mat4 im = instanceMatrix;
#else
  mat4 im = mat4(1.0);
#endif
  vec4 wp = modelMatrix * im * vec4(position, 1.0);
  vUv = uv;
  vInfo = iInfo;
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

export const PROP_CONTACT_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uVisionMap;
uniform float uUseVision;
uniform vec2 uWorldSize;
varying vec2 vUv;
varying vec4 vInfo;
varying vec3 vWorld;
void main() {
  if (uUseVision > 0.5) {
    vec2 uv = vWorld.xz / uWorldSize;
    vec4 v = texture2D(uVisionMap, uv);
    if (v.r < 0.5 && v.g < 0.5) discard;
  }
  vec2 p = (vUv - 0.5) * 2.0;
  // round props: a disc; square ones: a rounded box. 1 at the quad's edge.
  float d = vInfo.z > 0.5 ? length(p) : 0.45 + 0.55 * length(max(abs(p) - 0.45, 0.0)) / 0.55;
  // vInfo.y: a roof faded away takes its contact with it
  float a = (1.0 - smoothstep(0.45, 1.0, d)) * vInfo.w * uOpacity * (1.0 - vInfo.y);
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

/** Every prop program, for the check tool: name → { vertex, fragment }. */
export const PROPS_PROGRAMS = Object.freeze({
  prop: { vertex: PROP_VERT, fragment: PROP_FRAG },
  propModel: { vertex: PROP_MODEL_VERT, fragment: PROP_MODEL_FRAG },
  propCard: { vertex: PROP_CARD_VERT, fragment: PROP_CARD_FRAG },
  propContact: { vertex: PROP_CONTACT_VERT, fragment: PROP_CONTACT_FRAG },
  slabTop: { vertex: SLAB_TOP_VERT, fragment: SLAB_TOP_FRAG },
  slabSide: { vertex: SLAB_SIDE_VERT, fragment: SLAB_SIDE_FRAG },
});
