/** PF2e AoE — layered PIXI host for Region effects. */

import { createBloomFilter } from "../../core/bloom.mjs";
import { PRECISION } from "../../core/glsl.mjs";
import { lighten } from "../../core/theme.mjs";
import { TREATMENTS } from "./constants.mjs";
import { AoeAnim, SHED_AT, SHED_ORDER, UNSHED_AT } from "./anim.mjs";
import { auraNativeNodes, auraRegionFor, auraRegions } from "./aura.mjs";
import { cellStateAt, regionCells, regionGeometry, seedFor, authoredStyle, isEffectRegion } from "./data.mjs";
import { FRAGMENT_SHADER, VERTEX_SHADER } from "./shader.mjs";

const FINISH = 0.88; // settled Spellglass review value
const ENTER_MODE = 2; // ignite: extent readable on frame one
const ROOT_Z = 650; // over tokens, under walls/controls
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

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

function meshFor(plane, geometry, cells, style, anim, seed) {
  const treatment = TREATMENTS[0];
  const uniforms = {
    uView: new Float32Array(geometry.view),
    uTime: 0,
    uTexel: 0,
    uSeed: seed,
    uPlane: plane,
    uShape: geometry.shapeId,
    uRadius: geometry.radius,
    uDirection: geometry.direction,
    uAngle: geometry.angle,
    uBase: new Float32Array(geometry.base),
    uArch: style.archetypeIndex,
    uEnterMode: ENTER_MODE,
    uGridless: geometry.gridless ? 1 : 0,
    uTint: style.tint,
    uTintHot: style.hot,
    uMix: new Float32Array([treatment.ground, treatment.air, treatment.skirt]),
    uChar: new Float32Array([treatment.scorch, treatment.motes, treatment.rim, treatment.turb]),
    uPhase: new Float32Array([anim.enter, anim.leave, anim.shock, anim.eased]),
    uFx: new Float32Array([1, 1, 1, 1]),
    uAlpha: FINISH,
    uCells: cells.texture,
    uCellOrigin: new Float32Array(cells.origin),
    uCellSize: new Float32Array([cells.width, cells.height]),
    uGridOffset: new Float32Array(geometry.gridOffset),
  };
  const mesh = new PIXI.Mesh(
    quad(geometry.quad.width, geometry.quad.height),
    PIXI.Shader.from(VERTEX_SHADER, FRAGMENT_SHADER, uniforms),
  );
  mesh.position.set(geometry.quad.x, geometry.quad.y);
  mesh.eventMode = "none";
  mesh.glAoeGridSpan = Math.max(geometry.view[2], geometry.view[3]);
  mesh.glAoeQuadPx = Math.max(geometry.quad.width, geometry.quad.height);
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

function labelFor(style, geometry) {
  if (!style.label) return null;
  const root = new PIXI.Container();
  root.eventMode = "none";
  root.position.set(geometry.labelAt.x, geometry.labelAt.y);
  root.glAoeBaseScale = 1;

  const color = Number.parseInt(lighten(style.color, 0.48).slice(1), 16);
  const fontSize = clamp(Math.round(geometry.grid * 0.24), 14, 30);
  const text = new PIXI.Text(style.label.toUpperCase(), {
    fontFamily: "Oxanium, Rajdhani, sans-serif",
    fontSize,
    fontWeight: "650",
    letterSpacing: Math.max(1, Math.round(fontSize * 0.12)),
    fill: color,
    align: "center",
    stroke: 0x030509,
    strokeThickness: Math.max(2, Math.round(fontSize * 0.11)),
    dropShadow: true,
    dropShadowColor: color,
    dropShadowAlpha: 0.56,
    dropShadowBlur: Math.max(3, fontSize * 0.28),
    dropShadowDistance: 0,
  });
  text.anchor.set(0.5);
  text.resolution = Math.max(2, globalThis.devicePixelRatio || 2);

  const maxWidth = Math.max(geometry.grid * 1.6, geometry.bounds.width * 0.72);
  if (text.width > maxWidth) text.scale.set(maxWidth / text.width);
  const width = Math.min(maxWidth, text.width) + fontSize * 1.8;
  const backing = new PIXI.Graphics();
  backing.lineStyle({ width: 1, color, alpha: 0.62 });
  backing.moveTo(-width / 2, -fontSize * 0.72);
  backing.lineTo(width / 2, -fontSize * 0.72);
  backing.lineStyle({ width: 1, color, alpha: 0.38 });
  backing.moveTo(-width / 2, fontSize * 0.72);
  backing.lineTo(width / 2, fontSize * 0.72);
  root.addChild(backing, text);
  return root;
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

function tokenEdges(entry) {
  const edges = new PIXI.Container();
  edges.eventMode = "none";
  edges.zIndex = 0;
  for (const token of canvas?.tokens?.placeables ?? []) {
    if (!token?.visible || !token.mesh?.texture) continue;
    const cx = token.center?.x ?? token.x + token.w / 2;
    const cy = token.center?.y ?? token.y + token.h / 2;
    let covered = cellStateAt(entry.cells, cx, cy, entry.geometry.grid) >= 0.75;
    if (entry.geometry.gridless) {
      try {
        covered = Boolean(entry.region.document?.testPoint?.({
          x: cx,
          y: cy,
          elevation: entry.region.document?.elevation?.bottom ?? 0,
        }));
      } catch { covered = false; }
    }
    if (!covered) continue;
    const sprite = new PIXI.Sprite(token.mesh.texture);
    sprite.anchor.set(0.5);
    sprite.position.set(cx, cy);
    sprite.width = token.w;
    sprite.height = token.h;
    sprite.angle = token.document?.rotation ?? 0;
    sprite.alpha = token.mesh.alpha ?? 1;
    sprite.eventMode = "none";
    sprite.filters = [tokenEdgeFilter(entry.style, entry.geometry, token)];
    edges.addChild(sprite);
  }
  return edges;
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
  const grid = canvas.grid;
  return Boolean((grid?.isSquare || grid?.isGridless)
    && isEffectRegion(region?.document) && region?.visible !== false);
}

class AoeHost {
  constructor() {
    this.entries = new Map();
    this.options = { motionScale: 1, maxConcurrent: 24 };
    this.shed = 0;
    this.frameAvg = 16;
    this.coolFrames = 0;
    this.auraNative = new Map();
    this._last = 0;
    this._tick = this.tick.bind(this);
  }

  configure(options = {}) {
    this.options = { ...this.options, ...options };
    for (const entry of this.entries.values()) entry.anim.motionScale = this.options.motionScale;
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
    this.spectacle.filterArea = canvas.app?.screen ?? null;
    this.bloom = createBloomFilter({ intensity: 0.50 });
    if (this.bloom) {
      this.bloom.resolution = canvas.app?.renderer?.resolution ?? 1;
      this.bloom.multisample = PIXI.MSAA_QUALITY?.NONE ?? 0;
      this.spectacle.filters = [this.bloom];
    }

    const groundParent = canvas.regions?._highlights ?? canvas.interface;
    groundParent?.addChild(this.ground);
    canvas.interface?.addChild(this.spectacle);
    this.refreshAll();
    canvas.app?.ticker?.add(this._tick);
  }

  detach() {
    canvas?.app?.ticker?.remove(this._tick);
    for (const id of [...this.entries.keys()]) this.remove(id);
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

  refreshAll() {
    if (!this.ground || !this.spectacle) return;
    const regions = [
      ...(canvas.regions?.placeables ?? [])
        .filter((region) => isEffectRegion(region.document) && region.visible !== false),
      ...auraRegions(),
    ]
      .slice(0, this.options.maxConcurrent);
    const keep = new Set(regions.map((region) => region.id));
    for (const id of [...this.entries.keys()]) if (!keep.has(id)) this.remove(id);
    for (const region of regions) this.refresh(region);
    this.syncAuraNative();
  }

  refresh(region) {
    if (!region?.id || !this.ground || !this.spectacle) return;
    const previousAnim = this.entries.get(region.id)?.anim ?? null;
    this.remove(region.id);
    /* Square grids use PF2e's rules lattice. Gridless Scenes use the Region's
       continuous shader geometry. Hex Scenes keep the native mesh rather than
       pretending square texels are hexes. */
    if (!canRenderEffectRegion(region)) return;
    const geometry = regionGeometry(region);
    if (!geometry) return;
    const cells = regionCells(region, geometry);
    if (!cells) return;
    cells.texture = cellsTexture(cells);
    const style = authoredStyle(region.document);
    const anim = previousAnim ?? new AoeAnim({ motionScale: this.options.motionScale });
    anim.motionScale = this.options.motionScale;
    const seed = seedFor(region.id);
    const meshes = [3, 0, 1, 2].map((plane) => meshFor(plane, geometry, cells, style, anim, seed));
    const [shade, ground, air, boundary] = meshes;
    shade.zIndex = 0; ground.zIndex = 1; air.zIndex = 1; boundary.zIndex = 2;
    this.ground.addChild(shade, ground);
    this.spectacle.addChild(air, boundary);

    const suppressedHighlights = region.glAoeAuraRenderer ? [] : suppressNativeHighlights(region);
    const entry = { region, geometry, cells, style, anim, meshes, label: null, edges: null, suppressedHighlights };
    entry.edges = tokenEdges(entry);
    if (entry.edges.children.length) this.spectacle.addChild(entry.edges);
    else entry.edges.destroy({ children: true });
    entry.label = labelFor(style, geometry);
    if (entry.label) { entry.label.zIndex = 3; this.spectacle.addChild(entry.label); }
    this.entries.set(region.id, entry);
    this.write(entry);
    this.syncAuraNative();
  }

  /** Translate an attached effect without rebuilding its four meshes or mask. */
  reposition(region, replacement = region) {
    const entry = this.entries.get(region?.id);
    if (!entry) return false;
    const geometry = regionGeometry(replacement);
    if (!geometry || geometry.shapeId !== entry.geometry.shapeId
      || Math.abs(geometry.quad.width - entry.geometry.quad.width) > 0.01
      || Math.abs(geometry.quad.height - entry.geometry.quad.height) > 0.01) return false;
    entry.region = replacement;
    entry.geometry = geometry;
    for (const mesh of entry.meshes) {
      mesh.position.set(geometry.quad.x, geometry.quad.y);
      mesh.shader?.uniforms?.uGridOffset?.set(geometry.gridOffset);
    }
    entry.label?.position?.set(geometry.labelAt.x, geometry.labelAt.y);
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
    if (release && !entry.anim.leaving) { entry.anim.release(); return; }
    this.entries.delete(id);
    for (const item of entry.suppressedHighlights ?? []) {
      if (!item.node.destroyed) item.node.renderable = item.renderable;
    }
    for (const mesh of entry.meshes) destroyMesh(mesh);
    for (const child of [entry.edges, entry.label]) destroyNode(child);
    try { entry.cells.texture?.destroy?.(true); } catch { /* noop */ }
  }

  refreshTokenEdges() {
    for (const entry of this.entries.values()) {
      destroyNode(entry.edges);
      entry.edges = tokenEdges(entry);
      if (entry.edges.children.length) this.spectacle?.addChild(entry.edges);
      else { entry.edges.destroy({ children: true }); entry.edges = null; }
    }
  }

  pulse(id) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.anim.pulse();
    return true;
  }

  write(entry) {
    const fx = [this.shed < 2 ? 1 : 0, this.shed < 3 ? 1 : 0, this.shed < 4 ? 1 : 0, this.shed < 5 ? 1 : 0];
    for (const mesh of entry.meshes) {
      const u = mesh.shader?.uniforms;
      if (!u) continue;
      u.uTime = entry.anim.time;
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
    }
  }

  tick() {
    const now = performance.now();
    const dt = this._last ? Math.min(100, now - this._last) : 16;
    this._last = now;
    this.frameAvg = this.frameAvg * 0.94 + dt * 0.06;
    if (this.frameAvg > SHED_AT && this.shed < SHED_ORDER.length) {
      this.shed += 1; this.coolFrames = 0;
    } else if (this.frameAvg < UNSHED_AT && this.shed > 0) {
      if (++this.coolFrames > 120) { this.shed -= 1; this.coolFrames = 0; }
    } else this.coolFrames = 0;

    for (const [id, entry] of this.entries) {
      if (entry.region.glAoeAuraRenderer) {
        const replacement = auraRegionFor(entry.region.glAoeAuraRenderer);
        if (replacement) this.reposition(entry.region, replacement);
      }
      entry.anim.step(dt);
      if (entry.anim.dead) { this.remove(id); continue; }
      this.write(entry);
    }
    this.syncAuraNative();
  }
}

export const host = new AoeHost();
