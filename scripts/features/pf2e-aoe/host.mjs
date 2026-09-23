/** PF2e AoE — layered PIXI host for Region effects. */

import { createBloomFilter } from "../../core/bloom.mjs";
import { SUITE_ID, warn } from "../../core/const.mjs";
import { PRECISION } from "../../core/glsl.mjs";
import { TREATMENTS } from "./constants.mjs";
import { AoeAnim, SHED_AT, SHED_ORDER, UNSHED_AT } from "./anim.mjs";
import { auraNativeNodes, auraRegionFor, auraRegions } from "./aura.mjs";
import { cellStateAt, regionCells, regionGeometry, seedFor, isEffectRegion } from "./data.mjs";
import { presentationStyle } from "./presentation.mjs";
import { createMeasurementPresenter, layoutPresenters, measurementSummary } from "./measurement.mjs";
import { sceneUsesNativePresentation } from "./scene-config.mjs";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shader.mjs";

const FINISH = 0.88; // settled Spellglass review value
const ENTER_MODE = 2; // ignite: extent readable on frame one
const ROOT_Z = 650; // over tokens, under walls/controls
const BLOOM_PAD = 16; // screen px of bleed the bloom needs past the drawn bounds
const SETTLE_MS = 160; // quiet time after the last move before the mask is rebuilt
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function priority(region) {
  let score = 0;
  if (region?.controlled || region?.hover) score += 1000;
  if (region?.document?.attachment?.token) score += 500;
  if (region?.glAoeAuraRenderer) score += 300;
  const bounds = region?.bounds ?? region?.document?.bounds;
  const screen = canvas?.dimensions?.sceneRect;
  if (bounds && screen && bounds.x < screen.x + screen.width && bounds.x + bounds.width > screen.x
    && bounds.y < screen.y + screen.height && bounds.y + bounds.height > screen.y) score += 100;
  return score;
}

const EDGE_FRAGMENT = PRECISION + `
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec2 uStep;
uniform vec2 uLightDir;
uniform vec3 uTint;
uniform float uStrength;
void main(void) {
  float a = texture2D(uSampler, vTextureCoord).a;
  float l = texture2D(uSampler, vTextureCoord - vec2(uStep.x, 0.0)).a;
  float r = texture2D(uSampler, vTextureCoord + vec2(uStep.x, 0.0)).a;
  float u = texture2D(uSampler, vTextureCoord - vec2(0.0, uStep.y)).a;
  float d = texture2D(uSampler, vTextureCoord + vec2(0.0, uStep.y)).a;
  vec2 grad = vec2(l - r, u - d);
  float edge = max(0.0, a - min(min(l, r), min(u, d)));
  float facing = 0.30 + 0.70 * max(0.0, dot(normalize(grad + vec2(0.0001)), uLightDir));
  float alpha = edge * facing * uStrength;
  gl_FragColor = vec4(uTint * alpha, alpha);
}`;

function quad(width = 1, height = 1) {
  return new PIXI.Geometry()
    .addAttribute("aVertexPosition", [0, 0, width, 0, width, height, 0, height], 2)
    .addAttribute("aUvs", [0, 0, 1, 0, 1, 1, 0, 1], 2)
    .addIndex([0, 1, 2, 0, 2, 3]);
}

function cellsTexture(cells) {
  const texture = PIXI.Texture.fromBuffer(cells.data, cells.width, cells.height, {
    scaleMode: PIXI.SCALE_MODES?.NEAREST,
  });
  texture.baseTexture.scaleMode = PIXI.SCALE_MODES?.NEAREST ?? texture.baseTexture.scaleMode;
  return texture;
}

let sharedAtlas = null;
function materialAtlas() {
  if (sharedAtlas && !sharedAtlas.destroyed) return sharedAtlas;
  try {
    sharedAtlas = PIXI.Texture.from(`modules/${SUITE_ID}/assets/pf2e-aoe/material-atlas.png`);
    /* The shader tiles each 128px tile with fract(), so the UV is discontinuous
       at every repeat. With mipmaps on, the derivative spike at that seam picks
       the smallest level for one pixel and draws a dark hairline grid across
       the area — at exactly the repeat period, on exactly the material it is
       meant to hide. Linear, no mips: the tiles are sized so the finer layer
       stays near 1:1 at ordinary zoom. */
    const base = sharedAtlas.baseTexture;
    if (base) {
      base.mipmap = PIXI.MIPMAP_MODES?.OFF ?? 0;
      base.scaleMode = PIXI.SCALE_MODES?.LINEAR ?? base.scaleMode;
      base.wrapMode = PIXI.WRAP_MODES?.CLAMP ?? base.wrapMode;
    }
  } catch { sharedAtlas = PIXI.Texture.WHITE; }
  return sharedAtlas;
}

function sameCells(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height
    || a.minX !== b.minX || a.minY !== b.minY
    || a.origin[0] !== b.origin[0] || a.origin[1] !== b.origin[1]
    || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** Everything the measurement plate is drawn from. Equal keys, equal plate. */
function labelKey(region, style, geometry) {
  const summary = measurementSummary(region?.document, {
    gridSize: geometry.grid,
    gridDistance: canvas?.dimensions?.distance ?? 5,
    units: canvas?.scene?.grid?.units || "ft",
  });
  return [style.label ?? "", style.color, Boolean(region?.document?.displayMeasurements),
    geometry.grid, Math.round(geometry.bounds.width), summary].join("|");
}

/** Every uniform that follows the Region's geometry, style and coverage rather
 *  than the clock. Shared by first build and in-place update, so the two
 *  cannot drift into writing different values. */
function staticUniforms(geometry, cells, style, seed) {
  const treatment = TREATMENTS[0];
  return {
    uView: new Float32Array(geometry.view),
    uSeed: seed,
    uShape: geometry.shapeId,
    uRadius: geometry.radius,
    uDirection: geometry.direction,
    uAngle: geometry.angle,
    uBase: new Float32Array(geometry.base),
    uArch: style.materialIndex,
    uFunction: style.functionIndex,
    uSecondary: style.secondaryFunctionIndex,
    uBehavior: style.behaviorIndex,
    uEnterMode: style.enterMode ?? ENTER_MODE,
    uGridless: geometry.gridless ? 1 : 0,
    uTint: style.tint,
    uTintHot: style.hot,
    uAccent: style.accent,
    uAtlasRect: new Float32Array([
      (style.canonicalMaterialIndex % 8) / 8,
      Math.floor(style.canonicalMaterialIndex / 8) / 4,
      1 / 8,
      1 / 4,
    ]),
    uMix: style.mix ?? new Float32Array([treatment.ground, treatment.air, treatment.skirt]),
    uChar: style.character ?? new Float32Array([treatment.scorch, treatment.motes, treatment.rim, treatment.turb]),
    uCells: cells.texture,
    uCellOrigin: new Float32Array(cells.origin),
    uCellSize: new Float32Array([cells.width, cells.height]),
    uGridOffset: new Float32Array(geometry.gridOffset),
  };
}

function placeMesh(mesh, geometry) {
  mesh.position.set(geometry.quad.x, geometry.quad.y);
  mesh.glAoeGridSpan = Math.max(geometry.view[2], geometry.view[3]);
  mesh.glAoeQuadPx = Math.max(geometry.quad.width, geometry.quad.height);
}

function meshFor(plane, geometry, cells, style, anim, seed) {
  const uniforms = {
    uTime: 0,
    uTexel: 0,
    uPlane: plane,
    uAtlas: materialAtlas(),
    uAtlasReady: sharedAtlas?.baseTexture?.valid && sharedAtlas !== PIXI.Texture.WHITE ? 1 : 0,
    uPhase: new Float32Array([anim.enter, anim.leave, anim.shock, anim.eased]),
    uFx: new Float32Array([1, 1, 1, 1]),
    uAlpha: FINISH,
    ...staticUniforms(geometry, cells, style, seed),
  };
  const mesh = new PIXI.Mesh(
    quad(geometry.quad.width, geometry.quad.height),
    PIXI.Shader.from(VERTEX_SHADER, FRAGMENT_SHADER, uniforms),
  );
  placeMesh(mesh, geometry);
  mesh.eventMode = "none";
  mesh.blendMode = plane === 3
    ? (PIXI.BLEND_MODES?.MULTIPLY ?? "multiply")
    : (PIXI.BLEND_MODES?.NORMAL ?? "normal");
  return mesh;
}

function destroyMesh(mesh) {
  if (!mesh || mesh.destroyed) return;
  const shader = mesh.shader;
  if (mesh.parent) mesh.parent.removeChild(mesh);
  try { mesh.destroy({ children: true, geometry: true }); } catch { /* already gone */ }
  try { shader?.destroy?.(); } catch { /* already gone */ }
}

function destroyNode(node) {
  if (!node || node.destroyed) return;
  for (const child of node.children ?? []) {
    for (const filter of child.filters ?? []) {
      try { filter.destroy?.(); } catch { /* noop */ }
    }
    child.filters = null;
  }
  if (node.parent) node.parent.removeChild(node);
  try { node.destroy({ children: true }); } catch { /* noop */ }
}

function tokenEdgeFilter(style, geometry, token) {
  const cx = token.center?.x ?? token.x + token.w / 2;
  const cy = token.center?.y ?? token.y + token.h / 2;
  const dx = geometry.origin.x - cx, dy = geometry.origin.y - cy;
  const length = Math.hypot(dx, dy) || 1;
  const texture = token.mesh?.texture;
  const width = Math.max(1, texture?.width ?? token.w);
  const height = Math.max(1, texture?.height ?? token.h);
  const filter = new PIXI.Filter(undefined, EDGE_FRAGMENT, {
    uStep: new Float32Array([1 / width, 1 / height]),
    uLightDir: new Float32Array([dx / length, dy / length]),
    uTint: style.tint,
    uStrength: 0.72 * FINISH,
  });
  filter.padding = 3;
  return filter;
}

function tokenFor(id) {
  try {
    return canvas?.tokens?.get?.(id)
      ?? canvas?.tokens?.placeables?.find?.((token) => token?.id === id)
      ?? null;
  } catch { return null; }
}

function repositionTokenEdges(entry) {
  for (const sprite of entry.edges?.children ?? []) {
    const token = tokenFor(sprite.glAoeTokenId);
    if (!token?.visible || !token.mesh?.texture) continue;
    const cx = token.center?.x ?? token.x + token.w / 2;
    const cy = token.center?.y ?? token.y + token.h / 2;
    sprite.position.set(cx, cy);
    sprite.width = token.w;
    sprite.height = token.h;
    sprite.angle = token.document?.rotation ?? 0;
    sprite.alpha = token.mesh.alpha ?? 1;

    const uniforms = sprite.filters?.[0]?.uniforms;
    if (!uniforms) continue;
    const texture = token.mesh.texture;
    const width = Math.max(1, texture.width ?? token.w);
    const height = Math.max(1, texture.height ?? token.h);
    uniforms.uStep?.set?.([1 / width, 1 / height]);
    const dx = entry.geometry.origin.x - cx;
    const dy = entry.geometry.origin.y - cy;
    const length = Math.hypot(dx, dy) || 1;
    uniforms.uLightDir?.set?.([dx / length, dy / length]);
  }
}

function tokenCovered(entry, token) {
  if (!token?.visible || !token.mesh?.texture) return false;
  const cx = token.center?.x ?? token.x + token.w / 2;
  const cy = token.center?.y ?? token.y + token.h / 2;
  if (!entry.geometry.gridless) return cellStateAt(entry.cells, cx, cy, entry.geometry.grid) >= 0.75;
  try {
    return Boolean(entry.region.document?.testPoint?.({
      x: cx,
      y: cy,
      elevation: entry.region.document?.elevation?.bottom ?? 0,
    }));
  } catch { return false; }
}

function destroyEdgeSprite(sprite) {
  for (const filter of sprite.filters ?? []) {
    try { filter.destroy?.(); } catch { /* noop */ }
  }
  sprite.filters = null;
  if (sprite.parent) sprite.parent.removeChild(sprite);
  try { sprite.destroy(); } catch { /* noop */ }
}

/** Whether a Token change can possibly move this entry's edge lights: it
 *  already lights the token, or the token stands somewhere on its quad. */
function edgesTouchedBy(entry, token, id) {
  if (entry.edges?.children?.some((sprite) => sprite.glAoeTokenId === id)) return true;
  if (!token) return false;
  const q = entry.geometry.quad;
  const cx = token.center?.x ?? token.x + token.w / 2;
  const cy = token.center?.y ?? token.y + token.h / 2;
  return cx >= q.x && cy >= q.y && cx <= q.x + q.width && cy <= q.y + q.height;
}

function suppressNativeHighlights(region) {
  const children = canvas.regions?._highlights?.children ?? [];
  const nativeIndex = children.findIndex((child) => child?.region === region);
  if (nativeIndex < 0) return [];
  const native = children[nativeIndex];
  const suppressed = [{ node: native, renderable: native.renderable }];

  /* Newer PF2e releases add their blocked-cell Graphics immediately after
     the RegionMesh. Hide it only when that relationship is unambiguous; our
     rules texture already renders those cells with the Spellglass treatment. */
  const blocked = children[nativeIndex + 1];
  if (blocked instanceof PIXI.Graphics && blocked?.region == null && blocked.zIndex === native.zIndex) {
    suppressed.push({ node: blocked, renderable: blocked.renderable });
  }
  for (const item of suppressed) item.node.renderable = false;
  return suppressed;
}

/** Whether the current canvas can host a Spellglass mesh for this Region. */
export function canRenderEffectRegion(region) {
  if (sceneUsesNativePresentation()) return false;
  const grid = canvas.grid;
  const document = region?.document;
  const shapes = region?.animationState?.shapes ?? document?.shapes;
  const list = shapes?.contents ?? shapes ?? [];
  const shape = list?.[0] ?? list?.at?.(0);
  const exactGridless = ["circle", "cone", "line", "emanation", "rectangle"].includes(shape?.type)
    && !(shape?.type === "rectangle" && Number(shape.rotation ?? 0) !== 0);
  return Boolean((grid?.isSquare || grid?.isGridless)
    && (!grid?.isGridless || (list.length === 1 && exactGridless))
    && isEffectRegion(document) && region?.visible !== false);
}

class AoeHost {
  constructor() {
    this.entries = new Map();
    this.options = { motionScale: 1, maxConcurrent: 24, quality: "auto" };
    this.shed = 0;
    this.frameAvg = 16;
    this.coolFrames = 0;
    this.auraNative = new Map();
    this.errors = new Set();
    this.minShed = 0;
    this._last = 0;
    this._tick = this.tick.bind(this);
    this._ticking = false;
    /* tokenId -> whether its aura entries need a full rebuild, not just edges. */
    this._dirtyTokens = new Map();
    this._tokensQueued = false;
    /* tokenId -> the aura ids it produced at the last full refresh. A Token
       change is only worth a full refresh when this set moves. */
    this._auraSets = new Map();
    this._atlasWatch = null;
  }

  configure(options = {}) {
    this.options = { ...this.options, ...options };
    this.minShed = { high: 0, medium: 2, low: 4 }[this.options.quality] ?? 0;
    this.shed = Math.max(this.shed, this.minShed);
    for (const entry of this.entries.values()) entry.anim.motionScale = this.options.motionScale;
    this.updateActivity();
  }

  attach() {
    this.detach();
    if (!canvas?.ready || !PIXI?.Container) return;
    this.ground = new PIXI.Container();
    this.ground.name = "gl-aoe-ground";
    this.ground.sortableChildren = true;
    this.ground.eventMode = "none";

    this.spectacle = new PIXI.Container();
    this.spectacle.name = "gl-aoe-spectacle";
    this.spectacle.sortableChildren = true;
    this.spectacle.eventMode = "none";
    this.spectacle.zIndex = ROOT_Z;
    /* No filterArea: PIXI then sizes the pass to the container's own bounds
       (the union of the live air, boundary, edge and label nodes) plus the
       filter's padding, clipped to the screen. A screen-sized filterArea made
       the four-pass bloom cost a full viewport on every frame of every Scene,
       whatever was actually on it. */
    this.spectacle.filterArea = null;
    /* The frame's rule and brackets sit at the top of the ramp on purpose so
       the bloom lifts them into light; the fill never reaches the knee. */
    this.bloom = createBloomFilter({ intensity: 0.62 });
    if (this.bloom) {
      this.bloom.resolution = canvas.app?.renderer?.resolution ?? 1;
      this.bloom.multisample = PIXI.MSAA_QUALITY?.NONE ?? 0;
      this.bloom.padding = BLOOM_PAD;
      this.spectacle.filters = [this.bloom];
    }
    /* Hidden until something is on it: an invisible container is skipped
       outright, filters included. */
    this.ground.visible = false;
    this.spectacle.visible = false;

    const groundParent = canvas.regions?._highlights ?? canvas.interface;
    groundParent?.addChild(this.ground);
    canvas.interface?.addChild(this.spectacle);
    this.refreshAll();
  }

  detach() {
    for (const id of [...this.entries.keys()]) this.remove(id);
    canvas?.app?.ticker?.remove(this._tick);
    this._ticking = false;
    this._dirtyTokens.clear();
    this._auraSets.clear();
    for (const container of [this.ground, this.spectacle]) {
      if (!container || container.destroyed) continue;
      if (container.parent) container.parent.removeChild(container);
      try { container.destroy({ children: true }); } catch { /* canvas teardown */ }
    }
    this.ground = null;
    this.spectacle = null;
    try { this.bloom?.destroy?.(); } catch { /* noop */ }
    this.bloom = null;
    this.restoreAuraNative();
  }

  /** True while some entry needs a frame it will not be given by an event. */
  needsFrames() {
    for (const entry of this.entries.values()) {
      if (!entry.anim?.still || entry.anim?.leaving) return true;
      /* Auras have no Region hooks: the tick is what follows their Token. */
      if (entry.region?.glAoeAuraRenderer || entry.settleAt) return true;
    }
    return false;
  }

  /**
   * Show the layers only while they hold something, and run the ticker only
   * while something moves. Under motion tier "none" with no aura to follow,
   * nothing changes between frames, so the tick stops and the view is written
   * from events instead (pan/zoom, hover, control, refresh, atlas load).
   */
  updateActivity() {
    const live = this.entries.size > 0;
    for (const container of [this.ground, this.spectacle]) {
      if (container && !container.destroyed) container.visible = live;
    }
    const ticker = canvas?.app?.ticker;
    const want = live && this.needsFrames();
    if (want && !this._ticking && ticker) {
      this._last = 0;
      ticker.add(this._tick);
      this._ticking = true;
    } else if (!want && this._ticking) {
      ticker?.remove(this._tick);
      this._ticking = false;
    }
  }

  refreshAll() {
    if (!this.ground || !this.spectacle) return;
    if (sceneUsesNativePresentation()) {
      for (const id of [...this.entries.keys()]) this.remove(id);
      this._auraSets.clear();
      this.syncAuraNative();
      this.updateActivity();
      return;
    }
    const auras = auraRegions();
    this._auraSets.clear();
    for (const region of auras) {
      const tokenId = region.glAoeAuraRenderer?.token?.id;
      if (!tokenId) continue;
      if (!this._auraSets.has(tokenId)) this._auraSets.set(tokenId, new Set());
      this._auraSets.get(tokenId).add(region.id);
    }
    const candidates = [
      ...(canvas.regions?.placeables ?? [])
        .filter((region) => isEffectRegion(region.document) && region.visible !== false),
      ...auras,
    ];
    const regions = candidates.map((region, order) => ({ region, order, priority: priority(region) }))
      .sort((a, b) => b.priority - a.priority || a.order - b.order)
      .slice(0, this.options.maxConcurrent).map((entry) => entry.region);
    const keep = new Set(regions.map((region) => region.id));
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.remove(id);
    for (const region of regions) this.tryRefresh(region);
    this.syncAuraNative();
    this.updateActivity();
  }

  /** refresh(), restoring the Region to native if the Spellglass build throws. */
  tryRefresh(region) {
    try { this.refresh(region); }
    catch (error) {
      const key = `${region?.id}:${error?.message ?? error}`;
      if (!this.errors.has(key)) { this.errors.add(key); warn("pf2e-aoe | Region restored to native after render failure", region?.id, error); }
      this.remove(region?.id);
    }
  }

  refresh(region) {
    if (!region?.id || !this.ground || !this.spectacle) return;
    const previous = this.entries.get(region.id) ?? null;
    /* Square grids use PF2e's rules lattice. Gridless Scenes use the Region's
       continuous shader geometry. Hex Scenes keep the native mesh rather than
       pretending square texels are hexes. */
    const geometry = canRenderEffectRegion(region) ? regionGeometry(region) : null;
    const style = geometry ? presentationStyle(region) : null;
    const cells = style ? regionCells(region, geometry) : null;
    if (!cells) { this.remove(region.id); return; }

    if (previous) {
      let updated = false;
      try { updated = this.update(previous, region, geometry, style, cells); }
      catch (error) { this.remove(region.id); throw error; }
      if (updated) return;
    }

    const previousAnim = previous?.anim ?? null;
    this.remove(region.id);
    const anim = previousAnim ?? new AoeAnim({ motionScale: this.options.motionScale });
    anim.motionScale = this.options.motionScale;
    const seed = seedFor(region.id);
    const entry = {
      region, geometry, cells, style, anim,
      meshes: [], label: null, labelKey: null, edges: null, suppressedHighlights: [], settleAt: 0,
    };
    try {
      cells.texture = cellsTexture(cells);
      entry.meshes = [3, 0, 1, 2].map((plane) => meshFor(plane, geometry, cells, style, anim, seed));
      const [shade, ground, air, boundary] = entry.meshes;
      shade.zIndex = 0; ground.zIndex = 1; air.zIndex = 1; boundary.zIndex = 2;
      this.ground.addChild(shade, ground);
      this.spectacle.addChild(air, boundary);

      /* Register the partially constructed entry before native suppression.
         Every later failure can then use the ordinary teardown path, which
         restores native nodes and frees all GPU resources transactionally. */
      this.entries.set(region.id, entry);
      entry.suppressedHighlights = region.glAoeAuraRenderer ? [] : suppressNativeHighlights(region);
      this.syncEdges(entry);
      this.rebuildLabel(entry);
      this.watchAtlas();
      layoutPresenters(this.entries.values());
      this.write(entry);
      this.syncAuraNative();
      this.updateActivity();
    } catch (error) {
      const registered = this.entries.has(region.id);
      if (registered) this.remove(region.id);
      else {
        /* Texture creation can fail before the entry is registered. */
        for (const mesh of entry.meshes) destroyMesh(mesh);
        try { cells.texture?.destroy?.(true); } catch { /* noop */ }
      }
      throw error;
    }
  }

  /**
   * Bring a live entry up to date in place: same four meshes and programs, the
   * coverage texture kept whenever its contents are unchanged, the label kept
   * whenever it would draw the same plate. Most refreshes (hover, a flag
   * write, a committed move of an attached effect) change none of the
   * resources, and rebuilding them was the whole cost. Returns false when the
   * quad itself changed size; the caller then rebuilds.
   */
  update(entry, region, geometry, style, cells) {
    const q = geometry.quad, pq = entry.geometry.quad;
    if (entry.meshes.length !== 4 || entry.meshes.some((mesh) => !mesh || mesh.destroyed || !mesh.shader?.uniforms)
      || Math.abs(q.width - pq.width) > 0.01 || Math.abs(q.height - pq.height) > 0.01) return false;

    const reuseTexture = sameCells(entry.cells, cells) && entry.cells.texture && !entry.cells.texture.destroyed;
    const staleTexture = reuseTexture ? null : entry.cells.texture;
    cells.texture = reuseTexture ? entry.cells.texture : cellsTexture(cells);
    const seed = seedFor(region.id);
    for (const mesh of entry.meshes) {
      Object.assign(mesh.shader.uniforms, staticUniforms(geometry, cells, style, seed));
      placeMesh(mesh, geometry);
    }
    entry.cells = cells;
    if (staleTexture) { try { staleTexture.destroy(true); } catch { /* noop */ } }

    /* The native RegionMesh may have been redrawn under us; hand back what was
       hidden and hide whatever is there now. */
    for (const item of entry.suppressedHighlights ?? []) {
      if (!item.node.destroyed) item.node.renderable = item.renderable;
    }
    entry.region = region;
    entry.geometry = geometry;
    entry.style = style;
    entry.anim.motionScale = this.options.motionScale;
    entry.suppressedHighlights = region.glAoeAuraRenderer ? [] : suppressNativeHighlights(region);

    this.syncEdges(entry);
    if (labelKey(region, style, geometry) !== entry.labelKey) this.rebuildLabel(entry);
    else if (entry.label) {
      entry.label.position.set(geometry.labelAt.x, geometry.labelAt.y);
      entry.label.glAoeBaseY = geometry.labelAt.y;
      entry.label.glAoeRegion = region;
    }
    layoutPresenters(this.entries.values());
    this.write(entry);
    this.syncAuraNative();
    this.updateActivity();
    return true;
  }

  rebuildLabel(entry) {
    destroyNode(entry.label);
    entry.label = createMeasurementPresenter(entry.region, entry.style, entry.geometry);
    entry.labelKey = labelKey(entry.region, entry.style, entry.geometry);
    if (entry.label) { entry.label.zIndex = 3; this.spectacle?.addChild(entry.label); }
  }

  /** The atlas loads asynchronously; with no tick running, nothing else would
   *  ever tell the shader it arrived. */
  watchAtlas() {
    const base = sharedAtlas?.baseTexture;
    if (!base || base.valid || this._atlasWatch === base || typeof base.once !== "function") return;
    this._atlasWatch = base;
    base.once("loaded", () => {
      if (this._atlasWatch === base) this._atlasWatch = null;
      this.writeAll();
    });
  }

  /** Translate an attached effect without rebuilding its four meshes or mask. */
  reposition(region, replacement = region) {
    const entry = this.entries.get(region?.id);
    if (!entry) return false;
    const geometry = regionGeometry(replacement);
    const changed = (a, b) => Math.abs(a - b) > 0.01;
    const vectorChanged = (a, b) => a.length !== b.length || a.some((value, i) => changed(value, b[i]));
    if (!geometry || geometry.shapeId !== entry.geometry.shapeId
      || geometry.gridless !== entry.geometry.gridless
      || changed(geometry.radius, entry.geometry.radius)
      || changed(geometry.direction, entry.geometry.direction)
      || changed(geometry.angle, entry.geometry.angle)
      || vectorChanged(geometry.base, entry.geometry.base)
      || vectorChanged(geometry.view, entry.geometry.view)
      || Math.abs(geometry.quad.width - entry.geometry.quad.width) > 0.01
      || Math.abs(geometry.quad.height - entry.geometry.quad.height) > 0.01) return false;
    const moved = changed(geometry.quad.x, entry.geometry.quad.x) || changed(geometry.quad.y, entry.geometry.quad.y);
    entry.region = replacement;
    entry.geometry = geometry;
    for (const mesh of entry.meshes) {
      mesh.position.set(geometry.quad.x, geometry.quad.y);
    }
    /* The coverage texture is intentionally reused during a translation. Its
       cell origin and grid phase are both local to the old quad; changing only
       uGridOffset duplicates or drops an edge column during fractional moves.
       Keep the entire mask rigid and rebuild it once the move has been quiet
       for SETTLE_MS (walls may block different squares at the new spot). */
    repositionTokenEdges(entry);
    entry.label?.position?.set(geometry.labelAt.x, geometry.labelAt.y);
    if (entry.label) { entry.label.glAoeBaseY = geometry.labelAt.y; entry.label.glAoeRegion = replacement; }
    if (moved) {
      entry.settleAt = (globalThis.performance?.now?.() ?? Date.now()) + SETTLE_MS;
      if (!this._ticking) this.updateActivity();
    }
    return true;
  }

  restoreAuraNative() {
    for (const [node, renderable] of this.auraNative) {
      if (!node.destroyed) node.renderable = renderable;
    }
    this.auraNative.clear();
  }

  syncAuraNative() {
    const desired = new Set();
    for (const entry of this.entries.values()) {
      for (const node of auraNativeNodes(entry.region)) desired.add(node);
    }
    for (const [node, renderable] of [...this.auraNative]) {
      if (desired.has(node)) continue;
      if (!node.destroyed) node.renderable = renderable;
      this.auraNative.delete(node);
    }
    for (const node of desired) {
      if (!this.auraNative.has(node)) this.auraNative.set(node, node.renderable);
      node.renderable = false;
    }
  }

  remove(id, { release = false } = {}) {
    const entry = this.entries.get(id);
    if (!entry) return;
    if (release && !entry.anim.leaving) { entry.anim.release(); this.updateActivity(); return; }
    this.entries.delete(id);
    for (const item of entry.suppressedHighlights ?? []) {
      if (!item.node.destroyed) item.node.renderable = item.renderable;
    }
    for (const mesh of entry.meshes) destroyMesh(mesh);
    for (const child of [entry.edges, entry.label]) destroyNode(child);
    try { entry.cells.texture?.destroy?.(true); } catch { /* noop */ }
    this.updateActivity();
  }

  /**
   * Reconcile one entry's edge lights with the Tokens standing in it. Sprites
   * for Tokens still inside are kept and moved (their filter program and
   * uniforms survive); only Tokens that entered or left cost anything.
   */
  syncEdges(entry) {
    const want = new Map();
    for (const token of canvas?.tokens?.placeables ?? []) {
      if (tokenCovered(entry, token)) want.set(token.id, token);
    }
    if (!entry.edges && !want.size) return;
    if (!entry.edges) {
      entry.edges = new PIXI.Container();
      entry.edges.eventMode = "none";
      entry.edges.zIndex = 0;
      entry.edges.renderable = this.shed < 1;
      this.spectacle?.addChild(entry.edges);
    }
    const have = new Set();
    for (const sprite of [...entry.edges.children]) {
      const token = want.get(sprite.glAoeTokenId);
      if (!token) { destroyEdgeSprite(sprite); continue; }
      have.add(token.id);
      if (sprite.texture !== token.mesh.texture) sprite.texture = token.mesh.texture;
      const uniforms = sprite.filters?.[0]?.uniforms;
      if (uniforms) uniforms.uTint = entry.style.tint;
    }
    for (const [id, token] of want) {
      if (have.has(id)) continue;
      const sprite = new PIXI.Sprite(token.mesh.texture);
      sprite.glAoeTokenId = token.id;
      sprite.anchor.set(0.5);
      sprite.eventMode = "none";
      sprite.filters = [tokenEdgeFilter(entry.style, entry.geometry, token)];
      entry.edges.addChild(sprite);
    }
    repositionTokenEdges(entry);
    if (!entry.edges.children.length) {
      destroyNode(entry.edges);
      entry.edges = null;
    }
  }

  refreshTokenEdges() {
    for (const entry of this.entries.values()) this.syncEdges(entry);
  }

  /**
   * A Token changed. Coalesced to one pass per microtask, because a moving
   * Token raises refreshVisibility on every animation frame. `rebuild` marks a
   * committed change (drawn, updated, its actor changed), which rebuilds that
   * Token's aura entries in place; everything else only reconciles membership
   * and edge lights. No Region's meshes are touched here: Region geometry
   * never depends on a Token except through an attachment, and attached
   * Regions have their own refreshRegion path.
   */
  markTokens(ids, { rebuild = false } = {}) {
    for (const id of ids ?? []) {
      if (id) this._dirtyTokens.set(id, rebuild || this._dirtyTokens.get(id) === true);
    }
    if (this._tokensQueued || !this._dirtyTokens.size) return;
    this._tokensQueued = true;
    queueMicrotask(() => { this._tokensQueued = false; this.flushTokens(); });
  }

  flushTokens() {
    const dirty = this._dirtyTokens;
    this._dirtyTokens = new Map();
    if (!dirty.size || !this.ground || !this.spectacle || sceneUsesNativePresentation()) return;

    const rebuild = [];
    for (const [id, full] of dirty) {
      const token = tokenFor(id);
      const auras = [];
      for (const renderer of token?.auras?.values?.() ?? []) {
        const region = auraRegionFor(renderer);
        if (region) auras.push(region);
      }
      const known = this._auraSets.get(id) ?? new Set();
      if (auras.length !== known.size || auras.some((region) => !known.has(region.id))) {
        /* An aura appeared or went away (hidden, destroyed, a rule changed):
           membership and the concurrency cap are refreshAll's business. */
        this.refreshAll();
        return;
      }
      if (full) rebuild.push(...auras);
    }
    for (const region of rebuild) {
      if (this.entries.has(region.id)) this.tryRefresh(region);
    }
    for (const entry of this.entries.values()) {
      for (const id of dirty.keys()) {
        if (!edgesTouchedBy(entry, tokenFor(id), id)) continue;
        this.syncEdges(entry);
        break;
      }
    }
    this.updateActivity();
  }

  /** Refresh every live entry whose Region passes the test, in place. */
  refreshWhere(test) {
    for (const entry of [...this.entries.values()]) {
      if (entry.region?.glAoeAuraRenderer) continue;
      let hit = false;
      try { hit = Boolean(test(entry.region)); } catch { hit = false; }
      if (hit) this.tryRefresh(entry.region);
    }
  }

  pulse(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.anim.pulse();
    return true;
  }

  /** Re-write one entry's view-dependent uniforms when no tick is doing it. */
  touch(id) {
    if (this._ticking) return;
    const entry = this.entries.get(id);
    if (entry) this.write(entry);
  }

  /** Pan/zoom changed uTexel and the label scale; the tick covers it when running. */
  onView() {
    if (this._ticking || this._viewQueued || !this.entries.size) return;
    const ticker = canvas?.app?.ticker;
    if (!ticker) { this.writeAll(); return; }
    /* canvasPan fires before the stage's world transforms are recomputed, so
       uTexel read now would describe the previous zoom. Write once after the
       next render instead; the frame after it is exact. */
    this._viewQueued = true;
    ticker.addOnce(() => { this._viewQueued = false; this.writeAll(); }, this, PIXI.UPDATE_PRIORITY?.UTILITY ?? -50);
  }

  writeAll() {
    for (const entry of this.entries.values()) this.write(entry);
  }

  write(entry) {
    const fx = [this.shed < 2 ? 1 : 0, this.shed < 3 ? 1 : 0, this.shed < 4 ? 1 : 0, this.shed < 5 ? 1 : 0];
    for (const mesh of entry.meshes) {
      const u = mesh.shader?.uniforms;
      if (!u) continue;
      u.uTime = entry.anim.time;
      u.uAtlasReady = sharedAtlas?.baseTexture?.valid && sharedAtlas !== PIXI.Texture.WHITE ? 1 : 0;
      u.uPhase[0] = entry.anim.enter;
      u.uPhase[1] = entry.anim.leave;
      u.uPhase[2] = entry.anim.shock;
      u.uPhase[3] = entry.anim.eased;
      u.uFx.set(fx);
      const transform = mesh.worldTransform;
      const det = transform ? Math.abs(transform.a * transform.d - transform.b * transform.c) : 1;
      const scale = Math.sqrt(Math.max(det, 1e-9));
      const resolution = canvas.app?.renderer?.resolution ?? 1;
      const pixels = mesh.glAoeQuadPx * scale * resolution;
      u.uTexel = pixels > 0 ? mesh.glAoeGridSpan / pixels : 0;
    }
    if (entry.edges) entry.edges.renderable = this.shed < 1;
    if (entry.label) {
      const zoom = Math.abs(canvas.stage?.scale?.x ?? 1) || 1;
      const scale = clamp(1 / zoom, 0.78, 1.35);
      entry.label.scale.set(scale);
      entry.label.setInspected?.(Boolean(entry.region?.hover || entry.region?.controlled));
    }
  }

  tick() {
    if (!this.entries.size) { this.updateActivity(); return; }
    const now = performance.now();
    const dt = this._last ? Math.min(100, now - this._last) : 16;
    this._last = now;
    this.frameAvg = this.frameAvg * 0.94 + dt * 0.06;
    if (this.frameAvg > SHED_AT && this.shed < SHED_ORDER.length) {
      this.shed += 1; this.coolFrames = 0;
    } else if (this.frameAvg < UNSHED_AT && this.shed > this.minShed) {
      if (++this.coolFrames > 120) { this.shed -= 1; this.coolFrames = 0; }
    } else this.coolFrames = 0;

    const settled = [];
    for (const [id, entry] of this.entries) {
      const renderer = entry.region.glAoeAuraRenderer;
      if (renderer) {
        const tokenId = renderer.token?.id ?? id.split(":")[1];
        const replacement = renderer.destroyed ? null : auraRegionFor(renderer);
        /* A destroyed renderer (PF2e rebuilt the Token's auras) or a shape the
           rigid move cannot follow (the aura's radius changed) both need the
           Token's current auras, not this frame's translation. */
        if (!replacement || !this.reposition(entry.region, replacement)) this.markTokens([tokenId], { rebuild: true });
      }
      if (entry.settleAt && now >= entry.settleAt) { entry.settleAt = 0; settled.push(entry); }
      entry.anim.step(dt);
      if (entry.anim.dead) { this.remove(id); continue; }
      this.write(entry);
    }
    /* Outside the loop: a rebuild may replace entries, which a live Map
       iteration would then visit a second time. */
    for (const entry of settled) {
      if (this.entries.get(entry.region?.id) !== entry) continue;
      const renderer = entry.region.glAoeAuraRenderer;
      const region = renderer ? auraRegionFor(renderer) : entry.region;
      if (region) this.tryRefresh(region);
    }
    this.syncAuraNative();
    this.updateActivity();
  }
}

export const host = new AoeHost();
