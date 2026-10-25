/** PF2e AoE — the canvas host: which Regions get a Spellglass area, and when. */

import { Budget } from "../../core/budget.mjs";
import { warn } from "../../core/const.mjs";
import { AoeAnim, SHED_ORDER } from "./anim.mjs";
import { auraNativeNodes, auraRegionFor, auraRegions } from "./aura.mjs";
import { cellStateAt, regionCells, regionGeometry, isEffectRegion } from "./data.mjs";
import { presentationStyle } from "./presentation.mjs";
import { createMeasurementPresenter, layoutPresenters, measurementSummary } from "./measurement.mjs";
import { sceneUsesNativePresentation } from "./scene-config.mjs";
import { AreaView } from "./render/area.mjs";

const ROOT_Z = 650; // over tokens, under walls/controls
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

function sameCells(a, b) {
  if (!a || !b || a.width !== b.width || a.height !== b.height
    || a.minX !== b.minX || a.minY !== b.minY || a.data.length !== b.data.length) return false;
  for (let i = 0; i < a.data.length; i += 4) if (a.data[i] !== b.data[i]) return false;
  return true;
}

/** Everything an AreaView is built from, other than the coverage cells. */
function viewKey(geometry, look) {
  return JSON.stringify([geometry.shapeId, geometry.gridless, geometry.grid, geometry.radius, geometry.direction,
    geometry.angle, geometry.base, geometry.origin.x, geometry.origin.y, look]);
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

function destroyNode(node) {
  if (!node || node.destroyed) return;
  if (node.parent) node.parent.removeChild(node);
  try { node.destroy({ children: true }); } catch { /* noop */ }
}

function tokenFor(id) {
  try {
    return canvas?.tokens?.get?.(id)
      ?? canvas?.tokens?.placeables?.find?.((token) => token?.id === id)
      ?? null;
  } catch { return null; }
}

function tokenCenter(token) {
  return {
    x: token.center?.x ?? token.x + token.w / 2,
    y: token.center?.y ?? token.y + token.h / 2,
  };
}

function tokenCovered(entry, token) {
  if (!token?.visible) return false;
  const c = tokenCenter(token);
  if (!entry.geometry.gridless) return cellStateAt(entry.cells, c.x, c.y, entry.geometry.grid) >= 0.75;
  try {
    return Boolean(entry.region.document?.testPoint?.({
      x: c.x,
      y: c.y,
      elevation: entry.region.document?.elevation?.bottom ?? 0,
    }));
  } catch { return false; }
}

/** Whether a Token change can possibly move this entry's marks: it already
 *  carries one, or the token stands somewhere inside its box. */
function marksTouchedBy(entry, token, id) {
  if (entry.markIds?.has(id)) return true;
  if (!token) return false;
  const b = entry.geometry.bounds;
  const c = tokenCenter(token);
  return c.x >= b.x && c.y >= b.y && c.x <= b.x + b.width && c.y <= b.y + b.height;
}

function suppressNativeHighlights(region) {
  const children = canvas.regions?._highlights?.children ?? [];
  const nativeIndex = children.findIndex((child) => child?.region === region);
  if (nativeIndex < 0) return [];
  const native = children[nativeIndex];
  const suppressed = [{ node: native, renderable: native.renderable }];

  /* Newer PF2e releases add their blocked-cell Graphics immediately after
     the RegionMesh. Hide it only when that relationship is unambiguous; our
     rules outline already draws those cells with the Spellglass hatch. */
  const blocked = children[nativeIndex + 1];
  if (blocked instanceof PIXI.Graphics && blocked?.region == null && blocked.zIndex === native.zIndex) {
    suppressed.push({ node: blocked, renderable: blocked.renderable });
  }
  for (const item of suppressed) item.node.renderable = false;
  return suppressed;
}

/** Whether the current canvas can host a Spellglass area for this Region. */
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

const stageZoom = () => Math.abs(canvas?.stage?.scale?.x ?? 1) || 1;

class AoeHost {
  constructor() {
    this.entries = new Map();
    this.options = { motionScale: 1, maxConcurrent: 24, quality: "auto" };
    this.auraNative = new Map();
    this.errors = new Set();
    this.minShed = 0;
    /* Shedding rides the suite's shared frame budget (core/budget.mjs). Bound
       in attach(), not here — this host is a module-scope singleton, and a
       ladder starts the budget's frame loop, which must not happen at import
       time. */
    this.ladder = null;
    this._unbudget = null;
    this._last = 0;
    /* Stable reference: the ticker removes by identity. */
    this._tick = Budget.measure("pf2e-aoe", this.tick.bind(this));
    this._ticking = false;
    /* tokenId -> whether its aura entries need a full rebuild, not just marks. */
    this._dirtyTokens = new Map();
    this._tokensQueued = false;
    /* tokenId -> the aura ids it produced at the last full refresh. A Token
       change is only worth a full refresh when this set moves. */
    this._auraSets = new Map();
  }

  configure(options = {}) {
    this.options = { ...this.options, ...options };
    this.minShed = { high: 0, medium: 2, low: 4 }[this.options.quality] ?? 0;
    for (const entry of this.entries.values()) entry.anim.motionScale = this.options.motionScale;
    this.updateActivity();
  }

  attach() {
    this.detach();
    if (!canvas?.ready || !PIXI?.Container) return;
    this.ladder = Budget.ladder("pf2e-aoe", SHED_ORDER, { minShed: () => this.minShed });
    /* The level can move while the tick is stopped (a still look, motion
       "none", a tier change from the Performance feature), and nothing else
       would write the gates until the next pan. */
    this._unbudget = Budget.onChange(() => { if (!this._ticking) this.writeAll(); });
    this.ground = new PIXI.Container();
    this.ground.name = "gl-aoe-ground";
    this.ground.eventMode = "none";

    this.spectacle = new PIXI.Container();
    this.spectacle.name = "gl-aoe-overlay";
    this.spectacle.sortableChildren = true;
    this.spectacle.eventMode = "none";
    this.spectacle.zIndex = ROOT_Z;
    /* Hidden until something is on it: an invisible container is skipped. */
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
    this.restoreAuraNative();
    this._unbudget?.();
    this._unbudget = null;
    this.ladder?.dispose();
    this.ladder = null;
  }

  /** Behaviours shed off the front of SHED_ORDER right now. */
  get shedLevel() {
    return this.ladder ? this.ladder.level : this.minShed;
  }

  /** True while some entry needs a frame it will not be given by an event. */
  needsFrames() {
    for (const entry of this.entries.values()) {
      if (entry.anim?.hot) return true;
      if (!entry.anim?.still && entry.view?.animated) return true;
      /* Auras have no Region hooks: the tick is what follows their Token. */
      if (entry.region?.glAoeAuraRenderer || entry.settleAt) return true;
    }
    return false;
  }

  /**
   * Show the layers only while they hold something, and run the ticker only
   * while something moves. A static look that has landed, or motion tier
   * "none", changes nothing between frames, so the tick stops and the view is
   * written from events instead (pan/zoom, hover, control, refresh).
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
    /* While this host wants frames something on the canvas is moving on its
       own, so the Performance feature's idle-rate drop must not slow it. */
    Budget.claimMotion("pf2e-aoe", this._ticking);
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
       analytic shape. Hex Scenes keep the native mesh rather than pretending
       square cells are hexes. */
    const geometry = canRenderEffectRegion(region) ? regionGeometry(region) : null;
    const style = geometry ? presentationStyle(region) : null;
    const cells = style ? regionCells(region, geometry) : null;
    if (!cells) { this.remove(region.id); return; }

    const key = viewKey(geometry, style.look);
    const reuse = previous?.view && !previous.view.ground.destroyed
      && previous.viewKey === key && sameCells(previous.cells, cells);
    if (previous && !reuse) this.dropView(previous);
    const anim = previous?.anim ?? new AoeAnim({ motionScale: this.options.motionScale });
    anim.motionScale = this.options.motionScale;
    const entry = previous ?? {
      region, anim, view: null, viewKey: null, label: null, labelKey: null,
      markIds: new Set(), suppressedHighlights: [], settleAt: 0,
    };
    for (const item of entry.suppressedHighlights ?? []) {
      if (!item.node.destroyed) item.node.renderable = item.renderable;
    }
    Object.assign(entry, { region, geometry, cells, style, builtGeometry: null });
    try {
      if (!reuse) {
        entry.view = new AreaView(PIXI, { geometry, cells, look: style.look, zoom: stageZoom() });
        entry.viewKey = key;
        this.ground.addChild(entry.view.ground);
        this.spectacle.addChild(entry.view.overlay);
      } else entry.view.translate(0, 0);
      /* Register before native suppression, so every later failure takes the
         ordinary teardown path, which restores the native nodes. */
      this.entries.set(region.id, entry);
      entry.suppressedHighlights = region.glAoeAuraRenderer ? [] : suppressNativeHighlights(region);
      this.syncMarks(entry);
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
    } catch (error) {
      if (this.entries.has(region.id)) this.remove(region.id);
      else this.dropView(entry);
      throw error;
    }
  }

  dropView(entry) {
    entry.view?.destroy();
    entry.view = null;
    entry.viewKey = null;
  }

  rebuildLabel(entry) {
    destroyNode(entry.label);
    entry.label = createMeasurementPresenter(entry.region, entry.style, entry.geometry);
    entry.labelKey = labelKey(entry.region, entry.style, entry.geometry);
    if (entry.label) { entry.label.zIndex = 3; this.spectacle?.addChild(entry.label); }
  }

  /** Translate an attached effect without rebuilding its area or its mask. */
  reposition(region, replacement = region) {
    const entry = this.entries.get(region?.id);
    if (!entry) return false;
    const geometry = regionGeometry(replacement);
    const changed = (a, b) => Math.abs(a - b) > 0.01;
    const vectorChanged = (a, b) => a.length !== b.length || a.some((value, i) => changed(value, b[i]));
    const built = entry.builtGeometry ?? entry.geometry;
    if (!geometry || geometry.shapeId !== built.shapeId
      || geometry.gridless !== built.gridless
      || changed(geometry.radius, built.radius)
      || changed(geometry.direction, built.direction)
      || changed(geometry.angle, built.angle)
      || vectorChanged(geometry.base, built.base)
      || Math.abs(geometry.quad.width - built.quad.width) > 0.01
      || Math.abs(geometry.quad.height - built.quad.height) > 0.01) return false;
    const moved = changed(geometry.quad.x, entry.geometry.quad.x) || changed(geometry.quad.y, entry.geometry.quad.y);
    entry.builtGeometry = built;
    entry.region = replacement;
    entry.geometry = geometry;
    /* The coverage outline is reused rigidly during a translation: the whole
       staircase moves with the Token, and is rebuilt once the move has been
       quiet for SETTLE_MS (walls may block different squares at the new spot). */
    entry.view?.translate(geometry.quad.x - built.quad.x, geometry.quad.y - built.quad.y);
    this.syncMarks(entry);
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
    this.dropView(entry);
    destroyNode(entry.label);
    this.updateActivity();
  }

  /** Reconcile one entry's Token brackets with the Tokens standing in it. */
  syncMarks(entry) {
    const rects = [];
    const ids = new Set();
    for (const token of canvas?.tokens?.placeables ?? []) {
      if (!tokenCovered(entry, token)) continue;
      ids.add(token.id);
      const w = token.w ?? token.document?.width * entry.geometry.grid;
      const h = token.h ?? token.document?.height * entry.geometry.grid;
      const c = tokenCenter(token);
      if (Number.isFinite(w) && Number.isFinite(h)) rects.push([c.x - w / 2, c.y - h / 2, w, h]);
    }
    entry.markIds = ids;
    entry.view?.setTokenMarks(rects);
  }

  /**
   * A Token changed. Coalesced to one pass per microtask, because a moving
   * Token raises refreshVisibility on every animation frame. `rebuild` marks a
   * committed change (drawn, updated, its actor changed), which rebuilds that
   * Token's aura entries in place; everything else only reconciles marks.
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
        /* An aura appeared or went away: membership and the concurrency cap
           are refreshAll's business. */
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
        if (!marksTouchedBy(entry, tokenFor(id), id)) continue;
        this.syncMarks(entry);
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
    this.updateActivity();
    return true;
  }

  /** Re-write one entry when no tick is doing it. */
  touch(id) {
    if (this._ticking) return;
    const entry = this.entries.get(id);
    if (entry) this.write(entry);
  }

  /** Pan/zoom moved the stroke widths and the label scale. */
  onView() {
    if (this._ticking || this._viewQueued || !this.entries.size) return;
    const ticker = canvas?.app?.ticker;
    if (!ticker) { this.writeAll(); return; }
    /* canvasPan fires before the stage's transforms are recomputed, so the
       zoom read now would describe the previous one. Write after the render. */
    this._viewQueued = true;
    ticker.addOnce(() => { this._viewQueued = false; this.writeAll(); }, this, PIXI.UPDATE_PRIORITY?.UTILITY ?? -50);
  }

  writeAll() {
    for (const entry of this.entries.values()) this.write(entry);
  }

  write(entry) {
    const { anim } = entry;
    entry.view?.update({
      time: anim.time,
      enter: anim.enter,
      eased: anim.eased,
      presence: anim.presence,
      shock: anim.shock,
      pulse: anim.pulseProgress,
      zoom: stageZoom(),
      shed: this.shedLevel,
      still: anim.still,
      motionScale: anim.motionScale,
    });
    if (entry.label) {
      const scale = clamp(1 / stageZoom(), 0.78, 1.35);
      entry.label.scale.set(scale);
      entry.label.setInspected?.(Boolean(entry.region?.hover || entry.region?.controlled));
    }
  }

  tick() {
    if (!this.entries.size) { this.updateActivity(); return; }
    const now = performance.now();
    const dt = this._last ? Math.min(100, now - this._last) : 16;
    this._last = now;

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
      entry.builtGeometry = null;
      const renderer = entry.region.glAoeAuraRenderer;
      const region = renderer ? auraRegionFor(renderer) : entry.region;
      if (region) this.tryRefresh(region);
    }
    this.syncAuraNative();
    this.updateActivity();
  }
}

export const host = new AoeHost();
