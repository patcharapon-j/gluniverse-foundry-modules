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
import { NEUTRAL_LIGHT } from "../environment.mjs";

const MAX_EFFECT_LIGHTS = 8;
export { MAX_EFFECT_LIGHTS };
/** Foundry lights that shade and flicker at once (LIT uTorch*[8]). */
export const MAX_TORCHES = 8;

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
    // shadows, and lit and shaded faces of every block read apart. The
    // environment moves it with the time of day (atmosphere.mjs).
    uKeyDir: { value: new THREE.Vector3(...NEUTRAL_LIGHT.dir) },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowMode: { value: 0 },
    uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    uEffPos: { value: Array.from({ length: MAX_EFFECT_LIGHTS }, () => new THREE.Vector4()) },
    uEffCol: { value: Array.from({ length: MAX_EFFECT_LIGHTS }, () => new THREE.Vector3()) },
    uEffCount: { value: 0 },
    uAOOn: { value: 1 },
    // The terrain field (terrain-field.mjs), written by the terrain layer on
    // every terrain change; uHeightRange is the lowest and highest ground (y).
    uField: { value: blankTexture([255, 255, 0, 255]) },
    uFieldOn: { value: 0 },
    uHeightRange: { value: new THREE.Vector2(0, 1) },
    uTime: { value: 0 },
    // The square grid on tops: rgb colour, a strength (0 = off). setOptions({grid}).
    uGrid: { value: new THREE.Vector4(0, 0, 0, 0) },
    // The environment (render/atmosphere.mjs writes them; glsl.mjs LIT documents
    // each). These starting values are the neutral light: today's look exactly.
    uEnvFill: { value: new THREE.Vector3(...NEUTRAL_LIGHT.fill) },
    uEnvKey: { value: new THREE.Vector3(...NEUTRAL_LIGHT.key) },
    uEnvBounce: { value: new THREE.Vector3(...NEUTRAL_LIGHT.bounce) },
    uEnvSky: { value: new THREE.Vector3(...NEUTRAL_LIGHT.sky) },
    uEnvOvercast: { value: 0 },
    uEnvFlash: { value: 0 },
    uEnvFog: { value: new THREE.Vector4(0.8, 0.82, 0.86, 0) },
    uEnvAtmo: { value: new THREE.Vector4(1, 0, 0, 0) },
    uEnvClouds: { value: new THREE.Vector4(0, 0.2, 1, 0) },
    uEnvFocus: { value: new THREE.Vector3() },
    uEnvSurface: { value: new THREE.Vector4(0, 0, 0, 0) },
    uEnvFlow: { value: new THREE.Vector4(1, 0, 0, 0) },
    uEnvFx: { value: new THREE.Vector4(1, 1, 1, 0) },
    uEnvTime: { value: 0 },
    // the room around the table, tinted by the hour's sky (1 = untinted)
    uEnvBack: { value: new THREE.Vector3(1, 1, 1) },
    // The few lights that shade and flicker (render/torches.mjs writes them;
    // glsl.mjs LIT documents each). Count 0: the bake alone, today's look.
    uTorchPos: { value: Array.from({ length: MAX_TORCHES }, () => new THREE.Vector4()) },
    uTorchCol: { value: Array.from({ length: MAX_TORCHES }, () => new THREE.Vector4(0, 0, 0, 1)) },
    uTorchInfo: { value: Array.from({ length: MAX_TORCHES }, () => new THREE.Vector2(0, 0)) },
    uTorchCount: { value: 0 },
    uTorchDir: { value: 0 },
    // The fog of war's soft map and style (render/fog.mjs). Off: today's flat fog.
    uFogMap: { value: blankTexture([255, 255, 0, 255]) },
    uFogStyle: { value: new THREE.Vector2(0, 0) },
  };
}

/** The shared uniforms a weather program reads, by reference. */
function envRefs(shared) {
  const pick = (k, v) => shared?.[k] ?? { value: v };
  return {
    uAmbient: pick("uAmbient", 1),
    uEnvFill: pick("uEnvFill", new THREE.Vector3(...NEUTRAL_LIGHT.fill)),
    uEnvKey: pick("uEnvKey", new THREE.Vector3(...NEUTRAL_LIGHT.key)),
    uEnvSky: pick("uEnvSky", new THREE.Vector3(...NEUTRAL_LIGHT.sky)),
    uEnvFlash: pick("uEnvFlash", 0),
    uEnvTime: pick("uEnvTime", 0),
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
      uniforms: uniformsFor(shared, {
        uSidePaint: { value: paint },
        // the board's plinth and the one trim line along its top
        uPlinth: { value: vec3(mix(PALETTE.ink2, PALETTE.ink3, 0.7)) },
        uTrim: { value: vec3(mix(PALETTE.textDim, PALETTE.accent, 0.35)) },
      }),
    });
  },

  /** The board's soft shadow on the table under it (TABLE_FRAG). */
  table(shared, { color = PALETTE.ink0, opacity = 0.6 } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.table",
      vertexShader: PROGRAMS.table.vertex,
      fragmentShader: PROGRAMS.table.fragment,
      uniforms: {
        uBounds: { value: new THREE.Vector4(0, 0, 1, 1) },
        uKeyDir: shared?.uKeyDir ?? { value: new THREE.Vector3(0, 1, 0) },
        uColor: { value: vec3(color) },
        uOpacity: { value: opacity },
      },
      transparent: true,
      depthWrite: false,
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

  backdrop(shared, { top = mix(PALETTE.ink3, PALETTE.accent, 0.12), bottom = PALETTE.ink1 } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.backdrop",
      vertexShader: PROGRAMS.backdrop.vertex,
      fragmentShader: PROGRAMS.backdrop.fragment,
      uniforms: {
        uTop: { value: vec3(top) }, uBottom: { value: vec3(bottom) },
        uEnvBack: shared?.uEnvBack ?? { value: new THREE.Vector3(1, 1, 1) },
      },
      depthWrite: false,
      depthTest: false,
    });
  },

  /**
   * Weather particles (PARTICLE_VERT): one instanced draw. `height` and
   * `heightInfo` are the atmosphere layer's ground lookup, shared by reference
   * with the splashes. Premultiplied output: lit kinds cover, glowing kinds add.
   */
  particles(shared, { height, heightInfo, box } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.particles",
      vertexShader: PROGRAMS.particles.vertex,
      fragmentShader: PROGRAMS.particles.fragment,
      uniforms: {
        ...envRefs(shared),
        uKind: { value: 0 },
        uBoxMin: box?.min ?? { value: new THREE.Vector3() },
        uBoxSize: box?.size ?? { value: new THREE.Vector3(1, 1, 1) },
        uPScale: box?.scale ?? { value: 1 },
        uPPx: box?.px ?? { value: 0.01 },
        uPWind: { value: new THREE.Vector4(1, 0, 0, 0) },
        uPTint: { value: new THREE.Vector4(1, 1, 1, 0) },
        uPOpacity: { value: 1 },
        uHeightTex: height ?? { value: null },
        uHeightInfo: heightInfo ?? { value: new THREE.Vector3(1, 1, 1) },
      },
      transparent: true,
      depthWrite: false,
      // a streak's quad faces whichever way it falls across the screen
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  },

  /** Rain landing on the ground and on water (SPLASH_VERT). */
  splash(shared, { height, heightInfo, box } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.splash",
      vertexShader: PROGRAMS.splash.vertex,
      fragmentShader: PROGRAMS.splash.fragment,
      uniforms: {
        ...envRefs(shared),
        uBoxMin: box?.min ?? { value: new THREE.Vector3() },
        uBoxSize: box?.size ?? { value: new THREE.Vector3(1, 1, 1) },
        uPScale: box?.scale ?? { value: 1 },
        uPPx: box?.px ?? { value: 0.01 },
        uPOpacity: { value: 1 },
        uHeightTex: height ?? { value: null },
        uHeightInfo: heightInfo ?? { value: new THREE.Vector3(1, 1, 1) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  },

  /**
   * The fog of war's bank of cloud (FOG_FRAG): drawn after the board, over it,
   * depth tested so what stands in front of the bank stays in front.
   */
  /**
   * The fog of war's bank (FOG_VERT). `height` and `heightInfo` are the
   * atmosphere layer's ground lookup, shared by reference, so the bank drapes
   * over the ground it hides; `cell` is the cells between two of its vertices.
   */
  fog(shared, { layers = 4, height, heightInfo, cell } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.fog",
      vertexShader: PROGRAMS.fog.vertex,
      fragmentShader: PROGRAMS.fog.fragment,
      uniforms: uniformsFor(shared, {
        uFogLevel: { value: new THREE.Vector2(0.06, 0.2) },
        uFogLayers: { value: layers },
        uFogCell: cell ?? { value: 1 },
        uHeightTex: height ?? { value: null },
        uHeightInfo: heightInfo ?? { value: new THREE.Vector3(1, 1, 1) },
      }),
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  },

  /** Flames on fire-like lights (FLAME_VERT). `clock` is shared by reference with the embers. */
  flame(shared, { clock } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.flame",
      vertexShader: PROGRAMS.flame.vertex,
      fragmentShader: PROGRAMS.flame.fragment,
      uniforms: {
        uVisionMap: shared?.uVisionMap ?? { value: blankTexture([255, 255, 0, 255]) },
        uUseVision: shared?.uUseVision ?? { value: 0 },
        uWorldSize: shared?.uWorldSize ?? { value: new THREE.Vector2(1, 1) },
        uFlameT: clock ?? { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  },

  /** Sparks rising off fires (EMBER_VERT). Additive. */
  ember(shared, { px } = {}) {
    return new THREE.ShaderMaterial({
      name: "dio.ember",
      vertexShader: PROGRAMS.ember.vertex,
      fragmentShader: PROGRAMS.ember.fragment,
      uniforms: {
        uVisionMap: shared?.uVisionMap ?? { value: blankTexture([255, 255, 0, 255]) },
        uUseVision: shared?.uUseVision ?? { value: 0 },
        uWorldSize: shared?.uWorldSize ?? { value: new THREE.Vector2(1, 1) },
        uEnvClouds: shared?.uEnvClouds ?? { value: new THREE.Vector4(0, 0.2, 1, 0) },
        uEmberT: { value: 0 },
        uPPx: px ?? { value: 0.01 },
        uEmberOpacity: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
  },

  /** Figures' shadows thrown by torches (TORCH_SHADOW_FRAG). */
  torchShadow(shared) {
    return new THREE.ShaderMaterial({
      name: "dio.torchShadow",
      vertexShader: PROGRAMS.torchShadow.vertex,
      fragmentShader: PROGRAMS.torchShadow.fragment,
      uniforms: uniformsFor(shared),
      transparent: true,
      depthWrite: false,
      // the quad is laid out on the ground by a reflection of its own plane: either face may be up
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
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
  unlit: "unlit", ring: "ring", glass: "glass", footprint: "footprint", reticle: "reticle", link: "link", ribbon: "ribbon", backdrop: "backdrop", table: "table", depth: "depth", blur: "blur",
  particles: "particles", splash: "splash",
  fog: "fog", flame: "flame", ember: "ember", torchShadow: "torchShadow",
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
