/**
 * Diorama — materials.
 *
 * Every program in glsl.mjs is built here, and every uniform it declares is
 * given a value here. Lit materials share one uniform set (`createShared()`):
 * the objects are shared by reference, so the renderer writes the light, the
 * vision, the shadow and the map once and every material sees it.
 *
 * Importable under Node: nothing touches the DOM or a GL context until a
 * material is compiled by the WebGLRenderer.
 */

import * as THREE from "./three.mjs";
import { PROGRAMS } from "./glsl.mjs";
import { PALETTE, hexToRgbFloat, mix } from "../../../core/theme.mjs";

const MAX_EFFECT_LIGHTS = 8;
export { MAX_EFFECT_LIGHTS };

/** The fallback ground colour where the map art does not reach. */
const GROUND_FALLBACK = mix(PALETTE.ink3, PALETTE.textDim, 0.25);

function blankTexture(rgba = [0, 0, 0, 255]) {
  const t = new THREE.DataTexture(new Uint8Array(rgba), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

/**
 * The uniforms every lit program shares (MAP + LIT chunks), by reference.
 * @returns {Record<string, {value:any}>}
 */
export function createShared() {
  return {
    uMap: { value: null },
    uMapRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    uHasMap: { value: 0 },
    uGroundColor: { value: new THREE.Vector3(...hexToRgbFloat(GROUND_FALLBACK)) },
    uLightMap: { value: blankTexture() },
    uVisionMap: { value: blankTexture([255, 255, 0, 255]) },
    uUseVision: { value: 0 },
    uWorldSize: { value: new THREE.Vector2(1, 1) },
    uAmbient: { value: 1 },
    // A low sun (≈38° up) from the back-left of the default view: long cast
    // shadows, and lit and shaded faces of every block read apart.
    uKeyDir: { value: new THREE.Vector3(-0.74, 0.62, -0.26).normalize() },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMode: { value: 0 },
    uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    uEffPos: { value: Array.from({ length: MAX_EFFECT_LIGHTS }, () => new THREE.Vector4()) },
    uEffCol: { value: Array.from({ length: MAX_EFFECT_LIGHTS }, () => new THREE.Vector3()) },
    uEffCount: { value: 0 },
    uAOOn: { value: 1 },
    uTime: { value: 0 },
    // The square grid on tops: rgb colour, a strength (0 = off). setOptions({grid}).
    uGrid: { value: new THREE.Vector4(0, 0, 0, 0) },
  };
}

/** Pick the shared uniforms a program actually declares, plus its own. */
function uniformsFor(shared, own = {}) {
  return { ...shared, ...own };
}

const vec3 = (hex) => new THREE.Vector3(...hexToRgbFloat(hex));

/** Wall material keys → shader ids (WALL_MATERIALS order, plus door). */
export const WALL_SHADER_ID = Object.freeze({ stone: 0, plaster: 1, palisade: 2, hedge: 3, cave: 4, map: 5, door: 6 });

/**
 * Material factories. The check tool builds each one and requires every
 * uniform its GLSL declares to be present here.
 */
export const MATERIALS = {
  top(shared) {
    return new THREE.ShaderMaterial({
      name: "dio.top",
      vertexShader: PROGRAMS.top.vertex,
      fragmentShader: PROGRAMS.top.fragment,
      uniforms: uniformsFor(shared),   // fwidth (the grid) is core in WebGL2
    });
  },

  /** Cliff faces. uSidePaint: how much the map's paint at the lip wins over the material's colour. */
  side(shared, { paint = 0.85 } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.side",
      vertexShader: PROGRAMS.side.vertex,
      fragmentShader: PROGRAMS.side.fragment,
      uniforms: uniformsFor(shared, { uSidePaint: { value: paint } }),
    });
  },

  water(shared) {
    return new THREE.ShaderMaterial({
      name: "dio.water",
      vertexShader: PROGRAMS.water.vertex,
      fragmentShader: PROGRAMS.water.fragment,
      uniforms: uniformsFor(shared),
      transparent: true,
      depthWrite: false,
    });
  },

  /** @param {{ mat?: string, opacity?: number }} [o] */
  wall(shared, { mat = "stone", opacity = 1 } = {}) {
    return new THREE.ShaderMaterial({
      name: `dio.wall.${mat}`,
      vertexShader: PROGRAMS.wall.vertex,
      fragmentShader: PROGRAMS.wall.fragment,
      uniforms: uniformsFor(shared, {
        uWallMat: { value: WALL_SHADER_ID[mat] ?? 0 },
        uOpacity: { value: opacity },
        uTint: { value: vec3(PALETTE.violet) },
        uTintAmt: { value: 0 },
        uLocked: { value: 0 },
        uGlyph: { value: vec3(PALETTE.hazard) },
      }),
      transparent: opacity < 1,
      depthWrite: opacity >= 1,
    });
  },

  /**
   * A standee card. `mode` picks the job of the one card program (CARD_FRAG):
   * "card" (opaque, alpha to coverage), "xray" (only where hidden), "glow".
   * The three share their margin uniform by reference, so one write sizes all.
   */
  card(shared, { facing, mode = "card", margin } = {}) {
    const m = new THREE.ShaderMaterial({
      name: `dio.card.${mode}`,
      vertexShader: PROGRAMS.card.vertex,
      fragmentShader: PROGRAMS.card.fragment,
      uniforms: uniformsFor(shared, {
        uCard: { value: null },
        uOpacity: { value: 1 },
        uGhost: { value: 0 },
        uLift: { value: 0 },
        uFacing: facing ?? { value: new THREE.Vector3(0, 0, 1) },
        uMargin: margin ?? { value: new THREE.Vector2(0, 0) },
        uOutline: { value: new THREE.Vector4(...hexToRgbFloat(PALETTE.ink0), 2) },
        uGlow: { value: 0 },
        uMode: { value: mode === "xray" ? 1 : mode === "glow" ? 2 : 0 },
      }),
    });
    if (mode === "card") {
      m.alphaToCoverage = true;
    } else {
      m.transparent = true;
      m.depthWrite = false;
      if (mode === "xray") m.depthFunc = THREE.GreaterDepth;
    }
    return m;
  },

  solid(shared, { color = PALETTE.ink2, opacity = 1 } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.solid",
      vertexShader: PROGRAMS.solid.vertex,
      fragmentShader: PROGRAMS.solid.fragment,
      uniforms: uniformsFor(shared, {
        uColor: { value: vec3(color) },
        uOpacity: { value: opacity },
      }),
      transparent: opacity < 1,
    });
  },

  unlit(_shared, { map = null, color = "#ffffff", opacity = 1, additive = false, depthTest = true } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.unlit",
      vertexShader: PROGRAMS.unlit.vertex,
      fragmentShader: PROGRAMS.unlit.fragment,
      uniforms: {
        uTex: { value: map },
        uUseTex: { value: map ? 1 : 0 },
        uColor: { value: vec3(color) },
        uOpacity: { value: opacity },
      },
      transparent: true,
      depthWrite: false,
      depthTest,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      side: THREE.DoubleSide,
    });
  },

  ring(_shared, { color = "#ffffff", opacity = 1, inner = 0.8, outer = 0.95, soft = 0.04, fill = 0, additive = false } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.ring",
      vertexShader: PROGRAMS.ring.vertex,
      fragmentShader: PROGRAMS.ring.fragment,
      uniforms: {
        uColor: { value: vec3(color) },
        uOpacity: { value: opacity },
        uInner: { value: inner },
        uOuter: { value: outer },
        uSoft: { value: soft },
        uFill: { value: fill },
      },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  },

  /** A flyer's glass column (see GLASS_FRAG). Own sun direction, by reference. */
  glass(shared, { color = "#ffffff", opacity = 1 } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.glass",
      vertexShader: PROGRAMS.glass.vertex,
      fragmentShader: PROGRAMS.glass.fragment,
      uniforms: {
        uColor: { value: vec3(color) },
        uOpacity: { value: opacity },
        uGround: { value: 0 },
        uKeyDir: shared?.uKeyDir ?? { value: new THREE.Vector3(0, 1, 0) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  },

  /** The squares under a flyer (see FOOTPRINT_FRAG). */
  footprint(_shared, { color = "#ffffff", opacity = 1 } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.footprint",
      vertexShader: PROGRAMS.footprint.vertex,
      fragmentShader: PROGRAMS.footprint.fragment,
      uniforms: {
        uColor: { value: vec3(color) },
        uOpacity: { value: opacity },
        uSize: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  },

  /** The ring and arrows under a targeted token (see RETICLE_FRAG). */
  reticle(_shared, { color = "#ffffff", opacity = 1 } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.reticle",
      vertexShader: PROGRAMS.reticle.vertex,
      fragmentShader: PROGRAMS.reticle.fragment,
      uniforms: {
        uColor: { value: vec3(color) },
        uOpacity: { value: opacity },
        uBreathe: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
  },

  /**
   * A target line (see LINK_VERT). Drawn over the board, never depth tested:
   * it reads like the 2D canvas's targeting lines. `viewport` is shared by
   * reference so one write per resize serves every line.
   */
  link(_shared, { color = "#ffffff", opacity = 1, viewport } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.link",
      vertexShader: PROGRAMS.link.vertex,
      fragmentShader: PROGRAMS.link.fragment,
      uniforms: {
        uViewport: viewport ?? { value: new THREE.Vector2(1, 1) },
        uWidth: { value: 2.4 },
        uColor: { value: vec3(color) },
        uOpacity: { value: opacity },
        uPhase: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
  },

  ribbon(_shared, { opacity = 1, depthTest = true } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.ribbon",
      vertexShader: PROGRAMS.ribbon.vertex,
      fragmentShader: PROGRAMS.ribbon.fragment,
      uniforms: { uOpacity: { value: opacity } },
      transparent: true,
      depthWrite: false,
      depthTest,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
  },

  backdrop(_shared, { top = mix(PALETTE.ink3, PALETTE.accent, 0.12), bottom = PALETTE.ink1 } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.backdrop",
      vertexShader: PROGRAMS.backdrop.vertex,
      fragmentShader: PROGRAMS.backdrop.fragment,
      uniforms: { uTop: { value: vec3(top) }, uBottom: { value: vec3(bottom) } },
      depthWrite: false,
      depthTest: false,
    });
  },

  depth() {
    return new THREE.ShaderMaterial({
      name: "dio.depth",
      vertexShader: PROGRAMS.depth.vertex,
      fragmentShader: PROGRAMS.depth.fragment,
      side: THREE.DoubleSide,
      colorWrite: false,
    });
  },

  blur() {
    return new THREE.ShaderMaterial({
      name: "dio.blur",
      vertexShader: PROGRAMS.blur.vertex,
      fragmentShader: PROGRAMS.blur.fragment,
      uniforms: {
        uTex: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uDir: { value: new THREE.Vector2(1, 0) },
        uFocus: { value: new THREE.Vector2(0.5, 0.17) },
        uStrength: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
  },
};

/** Which program each factory compiles (for the check tool). */
export const MATERIAL_PROGRAM = Object.freeze({
  top: "top", side: "side", water: "water", wall: "wall", card: "card", solid: "solid",
  unlit: "unlit", ring: "ring", glass: "glass", footprint: "footprint", reticle: "reticle", link: "link", ribbon: "ribbon", backdrop: "backdrop", depth: "depth", blur: "blur",
});

/** "#rrggbb" / any CSS colour → THREE.Color, total. */
export function cssColor(css, fallback = PALETTE.accent) {
  const c = new THREE.Color();
  try {
    if (typeof css === "number") return c.setHex(css, THREE.NoColorSpace);
    if (typeof css === "string" && css.trim()) {
      c.setStyle(css.trim(), THREE.NoColorSpace);
      return c;
    }
  } catch { /* fall through */ }
  return c.setStyle(fallback, THREE.NoColorSpace);
}

/** CSS colour → [r, g, b] 0..1 in the art's own values. */
export function cssRgb(css, fallback) {
  const c = cssColor(css, fallback);
  return [c.r, c.g, c.b];
}
