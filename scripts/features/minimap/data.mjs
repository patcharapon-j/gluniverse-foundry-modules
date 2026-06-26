/**
 * GLUniverse Suite — Minimap data layer.
 *
 * Two world settings back the feature:
 *   - `mm.maps`       the GM's authoritative library + draft (never rendered by
 *                     players directly).
 *   - `mm.published`  the player-visible snapshot of the active map, with hidden
 *                     elements and GM-only notes stripped. Everyone renders this.
 *
 * The GM edits the library; "publishing" projects the active map into the
 * published snapshot (silently or as a broadcast). Clients diff the new snapshot
 * against the one they were showing to animate the change.
 */

import { MODULE_ID, SETTINGS, MAP_W, MAP_H, DEFAULT_VIEW_MODE, makeId } from "./const.mjs";

const clone = (v) => (foundry?.utils?.deepClone ? foundry.utils.deepClone(v) : JSON.parse(JSON.stringify(v ?? null)));

function defaultLibrary() {
  return { schemaVersion: 1, maps: {}, activeMapId: null, rev: 0 };
}

export const MapStore = {
  /* ----------------------------- library I/O ----------------------------- */

  /** Full library blob (a clone — callers mutate then `write`). */
  read() {
    let blob;
    try {
      blob = game.settings.get(MODULE_ID, SETTINGS.maps);
    } catch {
      blob = null;
    }
    if (!blob || typeof blob !== "object") return defaultLibrary();
    return clone(blob);
  },

  async write(blob) {
    blob.rev = (Number(blob.rev) || 0) + 1;
    await game.settings.set(MODULE_ID, SETTINGS.maps, blob);
    return blob;
  },

  list() {
    const blob = this.read();
    return Object.values(blob.maps).sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  },

  get(id) {
    return this.read().maps[id] ?? null;
  },

  activeMapId() {
    return this.read().activeMapId ?? null;
  },

  activeMap() {
    const blob = this.read();
    return blob.activeMapId ? blob.maps[blob.activeMapId] ?? null : null;
  },

  /* ------------------------------ mutations ------------------------------ */

  async createMap(name) {
    const blob = this.read();
    const id = makeId("map");
    const now = Date.now();
    blob.maps[id] = {
      id,
      name: name || game.i18n.localize("GLMM.studio.newMapName"),
      w: MAP_W,
      h: MAP_H,
      viewMode: DEFAULT_VIEW_MODE,
      elements: [],
      createdAt: now,
      updatedAt: now
    };
    await this.write(blob);
    return id;
  },

  async renameMap(id, name) {
    const blob = this.read();
    const m = blob.maps[id];
    if (!m) return;
    m.name = String(name ?? "").slice(0, 80) || m.name;
    m.updatedAt = Date.now();
    await this.write(blob);
  },

  async deleteMap(id) {
    const blob = this.read();
    if (!blob.maps[id]) return;
    delete blob.maps[id];
    const wasActive = blob.activeMapId === id;
    if (wasActive) blob.activeMapId = null;
    await this.write(blob);
    if (wasActive) await this.clearPublished();
  },

  async setViewMode(id, mode) {
    const blob = this.read();
    const m = blob.maps[id];
    if (!m) return;
    m.viewMode = mode;
    m.updatedAt = Date.now();
    await this.write(blob);
  },

  async setActiveMap(id) {
    const blob = this.read();
    if (id && !blob.maps[id]) return;
    blob.activeMapId = id ?? null;
    await this.write(blob);
  },

  /* ------------------------------ elements ------------------------------- */

  async addElement(mapId, el) {
    const blob = this.read();
    const m = blob.maps[mapId];
    if (!m) return null;
    el.id ??= makeId(el.type ?? "el");
    m.elements.push(el);
    m.updatedAt = Date.now();
    await this.write(blob);
    return el.id;
  },

  async updateElement(mapId, elId, patch) {
    const blob = this.read();
    const m = blob.maps[mapId];
    if (!m) return;
    const el = m.elements.find((e) => e.id === elId);
    if (!el) return;
    Object.assign(el, patch);
    m.updatedAt = Date.now();
    await this.write(blob);
  },

  async removeElement(mapId, elId) {
    const blob = this.read();
    const m = blob.maps[mapId];
    if (!m) return;
    m.elements = m.elements.filter((e) => e.id !== elId);
    m.updatedAt = Date.now();
    await this.write(blob);
  },

  /** Reorder one element along the z-stack (array position). */
  async reorderElement(mapId, elId, delta) {
    const blob = this.read();
    const m = blob.maps[mapId];
    if (!m) return;
    const i = m.elements.findIndex((e) => e.id === elId);
    if (i < 0) return;
    const j = Math.max(0, Math.min(m.elements.length - 1, i + delta));
    if (i === j) return;
    const [el] = m.elements.splice(i, 1);
    m.elements.splice(j, 0, el);
    m.updatedAt = Date.now();
    await this.write(blob);
  },

  /* ------------------------------ publishing ----------------------------- */

  /** Project a map into a player-safe snapshot: drop hidden elements and any
   *  GM-only notes. `userId` bindings are preserved (the renderer resolves the
   *  player's live colour/name). */
  computePublished(map, rev) {
    if (!map) return null;
    const elements = (map.elements ?? [])
      .filter((e) => !e.hidden)
      .map((e) => {
        const out = clone(e);
        delete out.noteGM;
        delete out.hidden;
        return out;
      });
    return {
      mapId: map.id,
      name: map.name,
      w: map.w ?? MAP_W,
      h: map.h ?? MAP_H,
      viewMode: map.viewMode ?? DEFAULT_VIEW_MODE,
      elements,
      rev,
      publishedAt: Date.now()
    };
  },

  readPublished() {
    let snap;
    try {
      snap = game.settings.get(MODULE_ID, SETTINGS.published);
    } catch {
      snap = null;
    }
    return snap && typeof snap === "object" && snap.mapId ? clone(snap) : null;
  },

  /** Publish the active map. Returns the snapshot (with a freshly bumped rev). */
  async publishActive() {
    const map = this.activeMap();
    if (!map) {
      await this.clearPublished();
      return null;
    }
    const prev = this.readPublished();
    const rev = (Number(prev?.rev) || 0) + 1;
    const snap = this.computePublished(map, rev);
    await game.settings.set(MODULE_ID, SETTINGS.published, snap);
    return snap;
  },

  async clearPublished() {
    try {
      await game.settings.set(MODULE_ID, SETTINGS.published, null);
    } catch {
      /* ignore */
    }
  },

  /* -------------------------------- diff --------------------------------- */

  /** Representative anchor point of an element (for move detection / centring). */
  anchorOf(el) {
    if (!el) return { x: MAP_W / 2, y: MAP_H / 2 };
    switch (el.type) {
      case "room":
        if (el.shape === "polygon" && Array.isArray(el.points) && el.points.length) {
          const n = el.points.length;
          const c = el.points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
          return { x: c.x / n, y: c.y / n };
        }
        return { x: (el.x ?? 0) + (el.w ?? 0) / 2, y: (el.y ?? 0) + (el.h ?? 0) / 2 };
      case "connector":
        if (Array.isArray(el.points) && el.points.length) {
          const mid = el.points[Math.floor(el.points.length / 2)];
          return { x: mid.x, y: mid.y };
        }
        return { x: 0, y: 0 };
      default:
        return { x: el.x ?? 0, y: el.y ?? 0 };
    }
  },

  /** Signature of the visual properties whose change should be highlighted. */
  _visualSig(el) {
    return JSON.stringify({
      t: el.type, c: el.color, l: el.label, ic: el.icon, tx: el.text,
      w: el.w, h: el.h, r: el.r, sh: el.shape, p: el.points, u: el.userId, sz: el.size
    });
  },

  /**
   * Diff two snapshots by element id.
   * Returns { added, removed, moved, changed, unchanged }; `moved` carries the
   * from/to anchor so the renderer can tween.
   */
  diff(oldSnap, newSnap) {
    const oldEls = new Map((oldSnap?.elements ?? []).map((e) => [e.id, e]));
    const newEls = new Map((newSnap?.elements ?? []).map((e) => [e.id, e]));
    const added = [], removed = [], moved = [], changed = [], unchanged = [];

    for (const [id, el] of newEls) {
      const prev = oldEls.get(id);
      if (!prev) { added.push(el); continue; }
      const a0 = this.anchorOf(prev), a1 = this.anchorOf(el);
      const dist = Math.hypot(a1.x - a0.x, a1.y - a0.y);
      const visualChanged = this._visualSig(prev) !== this._visualSig(el);
      if (dist > 2) moved.push({ id, el, from: a0, to: a1, visualChanged });
      else if (visualChanged) changed.push(el);
      else unchanged.push(el);
    }
    for (const [id, el] of oldEls) if (!newEls.has(id)) removed.push(el);

    return { added, removed, moved, changed, unchanged };
  },

  hasChanges(d) {
    return !!d && (d.added.length || d.removed.length || d.moved.length || d.changed.length);
  }
};
