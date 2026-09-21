/**
 * Hexcrawl — the runtime store. What the apps, the input layer and the host
 * talk to (contract: docs/HEXCRAWL.md, "The store").
 *
 * One store per VIEWED hexcrawl scene. It owns no truth of its own: the map is
 * always re-read off the Scene document after an update (never assembled from
 * the `updateScene` diff, whose shape for dotted keys is not the shape the
 * document ends up with). What it does own is per-client, per-session state —
 * the brush, the staged-reveal set, "view as players", the GM's undo history,
 * and a local paint preview.
 *
 * Writes are targeted dotted-path updates so a one-hex edit does not resend a
 * 2,400-hex object. Every replacement is FORCED (v14 `ForcedReplacement`, v13
 * `==key`): a plain nested update MERGES, so a hex that loses `bl` or a region
 * that loses its colour would keep the old field forever.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { FLAGS, BUILTIN_TERRAINS } from "./constants.mjs";
import {
  applyPatch as applyPatchToMap, brushPatch, invertPatch, isBlankHex, newId,
  normalizeConfig, normalizeHex, normalizeMap, normalizeRegion, normalizeTerrain, stateDiff,
} from "./model.mjs";

/** Fired with (store|null) whenever HexStore.current changes. Namespaced. */
export const HOOK_STORE_CHANGED = "glhex.storeChanged";

const UNDO_CAP = 100;
const MAP_PATH = `flags.${SUITE_ID}.hex.map`;
const FLAG_ROOT = `flags.${SUITE_ID}`;

/** Undo history survives a scene switch within the session: sceneId → entries. */
const HISTORY = new Map();

/* ── Update builders (runtime only) ─────────────────────────────────────── */

const operators = () => globalThis.foundry?.data?.operators ?? null;

/** Force-replace the value at a dotted path. */
export function forceSet(upd, path, value) {
  const O = operators();
  if (O?.ForcedReplacement) { upd[path] = O.ForcedReplacement.create(value); return upd; }
  const i = path.lastIndexOf(".");
  upd[`${path.slice(0, i)}.==${path.slice(i + 1)}`] = value;
  return upd;
}

/** Delete the key at a dotted path. */
export function forceDelete(upd, path) {
  const O = operators();
  if (O?.ForcedDeletion) { upd[path] = new O.ForcedDeletion(); return upd; }
  const i = path.lastIndexOf(".");
  upd[`${path.slice(0, i)}.-=${path.slice(i + 1)}`] = null;
  return upd;
}

/** A hex patch as scene update data (replacement semantics; null deletes). */
export function hexPatchUpdate(patch, upd = {}) {
  for (const [k, h] of Object.entries(patch ?? {})) {
    const path = `${MAP_PATH}.hexes.${k}`;
    if (h == null || isBlankHex(h)) forceDelete(upd, path);
    else forceSet(upd, path, normalizeHex(h));
  }
  return upd;
}

/** Read the normalized map off a scene document. */
export function readMap(scene) {
  return normalizeMap(scene?.getFlag?.(SUITE_ID, FLAGS.map));
}

export const isHexcrawlScene = (scene) => !!scene?.getFlag?.(SUITE_ID, FLAGS.enabled);

/** Did an updateScene change touch our flags? (checked on the flattened diff) */
function touched(changes, prefix) {
  if (!changes) return false;
  const flat = globalThis.foundry?.utils?.flattenObject?.(changes) ?? changes;
  return Object.keys(flat).some((k) => k.startsWith(prefix) || k === `${FLAG_ROOT}.-=hex` || k === `${FLAG_ROOT}.==hex`);
}

/* ── The store ──────────────────────────────────────────────────────────── */

export class HexStore {
  /** @type {HexStore|null} */
  static current = null;

  /**
   * Replace HexStore.current for the viewed scene. Returns the new store (or
   * null) and fires HOOK_STORE_CHANGED when it actually changed.
   */
  static rebuild(scene, adapter) {
    const prev = HexStore.current;
    const want = scene && adapter && isHexcrawlScene(scene);
    if (prev && want && prev.scene === scene) { prev.adapter = adapter; return prev; }
    if (!prev && !want) return null;
    prev?._destroy();
    HexStore.current = want ? new HexStore(scene, adapter) : null;
    globalThis.Hooks?.callAll(HOOK_STORE_CHANGED, HexStore.current);
    return HexStore.current;
  }

  constructor(scene, adapter) {
    this.scene = scene;
    this.adapter = adapter;
    this._base = readMap(scene);
    this._preview = null;          // local paint preview patch
    this._previewMap = null;
    this._listeners = new Map();
    this.brush = { tool: "select", value: null, stage: false };
    this.staged = new Set();
    this.viewAsPlayers = false;
    this.paletteOpen = false;
    if (!HISTORY.has(scene.id)) HISTORY.set(scene.id, []);
    this._hook = globalThis.Hooks?.on("updateScene", (doc, changes) => this._onUpdateScene(doc, changes));
  }

  _destroy() {
    if (this._hook != null) globalThis.Hooks?.off("updateScene", this._hook);
    this._hook = null;
    this._listeners.clear();
  }

  /* ── Reading ── */

  get isGM() { return !!globalThis.game?.user?.isGM; }

  /** The map as this client should draw it (base + local paint preview). */
  get map() {
    if (!this._preview) return this._base;
    return (this._previewMap ??= applyPatchToMap(this._base, this._preview));
  }

  /** The map as stored — brushes compute against this, never the preview. */
  get baseMap() { return this._base; }

  get moves() {
    const m = this.scene.getFlag(SUITE_ID, FLAGS.moves);
    return Array.isArray(m) ? m : [];
  }

  get canUndo() { return (HISTORY.get(this.scene.id)?.length ?? 0) > 0; }

  /* ── Events ── */

  on(event, fn) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return fn;
  }

  off(event, fn) { this._listeners.get(event)?.delete(fn); }

  _emit(event, detail = {}) {
    for (const fn of this._listeners.get(event) ?? []) {
      try { fn(this, detail); } catch (e) { warn("hexcrawl | store listener failed", e); }
    }
  }

  _onUpdateScene(doc, changes) {
    if (doc !== this.scene && doc?.id !== this.scene.id) return;
    const mapChanged = touched(changes, MAP_PATH);
    const movesChanged = touched(changes, `${FLAG_ROOT}.hex.moves`);
    const flagsChanged = touched(changes, `${FLAG_ROOT}.hex`) && !mapChanged && !movesChanged;
    if (!mapChanged && !movesChanged && !flagsChanged) return;
    const prev = this._base;
    if (mapChanged || flagsChanged) {
      this._base = readMap(this.scene);   // off the document, never the diff
      this._previewMap = null;
    }
    const diff = mapChanged || flagsChanged ? stateDiff(prev, this._base) : null;
    this._emit("change", { kind: "scene", map: mapChanged || flagsChanged, moves: movesChanged || flagsChanged, prev, diff });
  }

  /* ── Local state ── */

  setBrush(partial) {
    this.brush = { ...this.brush, ...(partial ?? {}) };
    this._emit("change", { kind: "brush" });
  }

  setViewAsPlayers(on) {
    this.viewAsPlayers = !!on;
    this._emit("change", { kind: "view" });
  }

  /** The palette reports its own open state here (the input layer reads it). */
  setPaletteOpen(on) {
    this.paletteOpen = !!on;
    this._emit("change", { kind: "palette" });
  }

  stage(keys) {
    let n = 0;
    for (const k of keys) if (!this.staged.has(k)) { this.staged.add(k); n++; }
    if (n) this._emit("change", { kind: "staged" });
  }

  unstage(keys) {
    let n = 0;
    for (const k of keys) if (this.staged.delete(k)) n++;
    if (n) this._emit("change", { kind: "staged" });
  }

  clearStaged() {
    if (!this.staged.size) return;
    this.staged.clear();
    this._emit("change", { kind: "staged" });
  }

  /** Show a patch locally without writing it (paint strokes). null clears. */
  previewPatch(patch) {
    this._preview = patch && Object.keys(patch).length ? patch : null;
    this._previewMap = null;
    this._emit("change", { kind: "preview", map: true });
  }

  /* ── Writing (GM) ── */

  _gmOnly() {
    if (this.isGM) return true;
    warn("hexcrawl | only a GM can edit the hex map");
    return false;
  }

  _push(entry) {
    const stack = HISTORY.get(this.scene.id);
    stack.push(entry);
    if (stack.length > UNDO_CAP) stack.splice(0, stack.length - UNDO_CAP);
  }

  async _write(upd) {
    if (!Object.keys(upd).length) return;
    await this.scene.update(upd);
  }

  /**
   * Apply a hex patch (model.mjs shape: { key: Hex|null }). Undoable by default.
   * The token-move pipeline passes undoable:false (moves have their own undo).
   */
  async applyPatch(patch, { undoable = true, label = "" } = {}) {
    if (!this._gmOnly()) return;
    const keys = Object.keys(patch ?? {});
    if (!keys.length) { if (this._preview) this.previewPatch(null); return; }
    if (undoable) this._push({ label, ops: [{ kind: "hex", inverse: invertPatch(this._base, patch) }] });
    try {
      await this._write(hexPatchUpdate(patch));
    } finally {
      if (this._preview) { this._preview = null; this._previewMap = null; this._emit("change", { kind: "preview", map: true }); }
    }
  }

  /** Paint helper: the patch a brush would produce over keys, against the stored map. */
  brushPatchFor(keys, brush = this.brush) {
    return brushPatch(this._base, keys, brush);
  }

  async setRegion(id, data) {
    if (!this._gmOnly()) return null;
    id ||= newId("r");
    const norm = normalizeRegion({ ...(data ?? {}), id }, id);
    this._push({ label: "region", ops: [{ kind: "region", id, prev: this._base.regions[id] ?? null }] });
    await this._write(forceSet({}, `${MAP_PATH}.regions.${id}`, norm));
    return id;
  }

  async deleteRegion(id) {
    if (!this._gmOnly() || !id) return;
    const patch = {};
    for (const [k, h] of Object.entries(this._base.hexes)) {
      if (h.rg !== id) continue;
      const n = structuredClone(h); delete n.rg;
      patch[k] = isBlankHex(n) ? null : n;
    }
    this._push({ label: "region", ops: [
      { kind: "region", id, prev: this._base.regions[id] ?? null },
      { kind: "hex", inverse: invertPatch(this._base, patch) },
    ] });
    const upd = forceDelete({}, `${MAP_PATH}.regions.${id}`);
    hexPatchUpdate(patch, upd);
    await this._write(upd);
  }

  async setTerrain(id, data) {
    if (!this._gmOnly()) return null;
    id ||= newId("t");
    const norm = normalizeTerrain({ ...(data ?? {}), id }, id);
    this._push({ label: "terrain", ops: [{ kind: "terrain", id, prev: this._base.terrains[id] ?? null }] });
    await this._write(forceSet({}, `${MAP_PATH}.terrains.${id}`, norm));
    return id;
  }

  /**
   * Delete a custom terrain. Hexes and regions pointing at it are cleared —
   * unless the id is also a built-in (the custom one was shadowing it), in
   * which case they fall back to the built-in and are left alone.
   */
  async deleteTerrain(id) {
    if (!this._gmOnly() || !id) return;
    const ops = [{ kind: "terrain", id, prev: this._base.terrains[id] ?? null }];
    const upd = forceDelete({}, `${MAP_PATH}.terrains.${id}`);
    if (!Object.hasOwn(BUILTIN_TERRAINS, id)) {
      const patch = {};
      for (const [k, h] of Object.entries(this._base.hexes)) {
        if (h.t !== id) continue;
        const n = structuredClone(h); delete n.t;
        patch[k] = isBlankHex(n) ? null : n;
      }
      ops.push({ kind: "hex", inverse: invertPatch(this._base, patch) });
      hexPatchUpdate(patch, upd);
      for (const [rid, r] of Object.entries(this._base.regions)) {
        if (r.t !== id) continue;
        ops.push({ kind: "region", id: rid, prev: r });
        forceSet(upd, `${MAP_PATH}.regions.${rid}`, { ...r, t: null });
      }
    }
    this._push({ label: "terrain", ops });
    await this._write(upd);
  }

  async setConfig(partial) {
    if (!this._gmOnly()) return;
    const merged = normalizeConfig(deepMerge(structuredClone(this._base.config), partial ?? {}));
    this._push({ label: "config", ops: [{ kind: "config", prev: this._base.config }] });
    await this._write(forceSet({}, `${MAP_PATH}.config`, merged));
  }

  /** Reveal every staged hex in one write, then clear the set. */
  async commitStaged() {
    if (!this._gmOnly() || !this.staged.size) return;
    const patch = brushPatch(this._base, [...this.staged], { tool: "state", value: "revealed" });
    this.staged.clear();
    this._emit("change", { kind: "staged" });
    await this.applyPatch(patch, { label: "reveal" });
  }

  /** Undo the last GM edit made on this client for this scene. */
  async undo() {
    if (!this._gmOnly()) return false;
    const entry = HISTORY.get(this.scene.id)?.pop();
    if (!entry) return false;
    const upd = {};
    // Inverse ops apply in reverse order, so a compound entry unwinds cleanly.
    for (const op of [...entry.ops].reverse()) {
      if (op.kind === "hex") hexPatchUpdate(op.inverse, upd);
      else if (op.kind === "region") {
        const p = `${MAP_PATH}.regions.${op.id}`;
        if (op.prev) forceSet(upd, p, op.prev); else forceDelete(upd, p);
      } else if (op.kind === "terrain") {
        const p = `${MAP_PATH}.terrains.${op.id}`;
        if (op.prev) forceSet(upd, p, op.prev); else forceDelete(upd, p);
      } else if (op.kind === "config") forceSet(upd, `${MAP_PATH}.config`, op.prev);
    }
    await this._write(upd);
    return true;
  }
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === "object" && !Array.isArray(v) && target[k] && typeof target[k] === "object" && !Array.isArray(target[k])) {
      deepMerge(target[k], v);
    } else target[k] = v;
  }
  return target;
}
