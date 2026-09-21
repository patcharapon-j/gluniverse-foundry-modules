/**
 * Hexcrawl — the renderer.
 *
 * Pure of Foundry: PIXI, the grid adapter, texture loading and icon resolution
 * all arrive by injection, and nothing here reads `game`, `canvas`, `foundry`,
 * `ui`, `Hooks` or the DOM. The preview page drives this exact file.
 *
 *   const r = new HexRenderer({ PIXI, adapter, keys, loadTexture, resolveIcon, palette });
 *   parent.addChild(r.root);
 *   r.setMap(map, { asGM, viewAsPlayers, animate });
 *   r.setParty([{ key, sight }]); r.setTrail(keys); r.setStaged(set); r.setHover(key|null);
 *   r.setZoom(stageScale); r.setMotionScale(k); r.update(dtMs); r.destroy();
 *
 * Visibility is never decided here — every hex asks model.mjs `viewFor`.
 *
 * Layers (bottom → top):
 *   tiles      chunked static Graphics, rebuilt per chunk when a hex in it changes
 *              (each chunk also owns one Graphics in the veins and hatch layers)
 *   anim       transient per-hex containers while a hex reveals / masks / hides
 *   veins      blight veins (pulse by alpha)
 *   hover
 *   hatch      GM view of what players cannot see (hairline, redrawn on zoom settle)
 *   borders    region borders (hairline)
 *   trail
 *   staged     GM staged outlines (hairline, pulse by alpha)
 *   sight      party sight boundary (hairline, dash drifts)
 *   party      occupied-hex outline (hairline)
 *   marks      landmark icons + captions (text)
 *   labels     region labels (text)
 *
 * Nothing uses a filter, so there is no filter resolution to get wrong.
 */

import { PIP_ZOOM_THRESHOLD } from "../constants.mjs";
import { cubeDistance, parseKey } from "../hex-math.mjs";
import { effectiveRating, stateDiff, terrainDef, viewFor } from "../model.mjs";
import { dur, makeHexAnim, pulse, staggerDelays, easeOutCubic, clamp01 } from "./anim.mjs";
import { tracePoly } from "./geom.mjs";
import { eachText, makeLandmarkNode, makeRegionLabel, regionLabels } from "./labels.mjs";
import {
  drawHover, drawParty, drawRegionBorders, drawSight, drawStaged, drawTrail, drawVeins, sightEdges,
} from "./overlays.mjs";
import {
  ANIM_CAP, CHUNK, GEO, HAIR, TEXT_RES_DRIFT, TEXT_RES_MAX, ZOOM_SETTLE_MS, hairline, makeColors,
} from "./style.mjs";
import { MeshPen } from "./pen.mjs";
import { makeTemplate } from "./template.mjs";
import { drawHatch, drawHex, hexPolys, lookFor, stampKey } from "./tiles.mjs";

const now = () => (globalThis.performance?.now?.() ?? Date.now());

/**
 * The grid never moves under a renderer (a grid change builds a new one), so
 * centres and vertices are memoised — Foundry's getCenterPoint/getVertices are
 * not free, and a rebuild asks for every hex several times.
 */
function memoAdapter(a) {
  const centers = new Map(), verts = new Map();
  return Object.assign(Object.create(a), {
    center(k) { let c = centers.get(k); if (!c) { c = a.center(k); centers.set(k, c); } return c; },
    vertices(k) { let v = verts.get(k); if (!v) { v = a.vertices(k); verts.set(k, v); } return v; },
    toCube: (k) => a.toCube(k), fromCube: (c) => a.fromCube(c), keyAt: (p) => a.keyAt(p), inBounds: (k) => a.inBounds(k),
  });
}

export class HexRenderer {
  /**
   * @param {object} o
   * @param {object} o.PIXI           PIXI v7 namespace
   * @param {object} o.adapter        grid adapter (hex-math.mjs)
   * @param {Iterable<string>} o.keys every drawable offset key
   * @param {(src:string)=>Promise<any>} [o.loadTexture]
   * @param {(fa:string)=>({char,fontFamily,fontWeight}|null)} [o.resolveIcon]
   * @param {object} o.palette        core/theme.mjs PALETTE (or a mirror)
   * @param {(id:string)=>string} [o.terrainName]  localised terrain name for built-ins
   * @param {string} [o.fontFamily]   label face (default the suite display face)
   * @param {number} [o.resolution]   device pixel ratio (default globalThis.devicePixelRatio)
   */
  constructor({ PIXI, adapter, keys, loadTexture = null, resolveIcon = null, palette, terrainName = null, fontFamily = null, resolution = null }) {
    if (!PIXI) throw new Error("HexRenderer: PIXI is required");
    if (!adapter) throw new Error("HexRenderer: adapter is required");
    this.PIXI = PIXI;
    this.adapter = memoAdapter(adapter);
    this.keys = [...(keys ?? [])];
    this.keySet = new Set(this.keys);
    this.loadTexture = loadTexture;
    this.resolveIcon = resolveIcon;
    this.palette = palette;
    this.colors = makeColors(palette);
    this.terrainNameFn = terrainName;
    this.fontFamily = fontFamily ?? "Oxanium, 'Segoe UI Symbol', sans-serif";
    this.dpr = resolution ?? globalThis.devicePixelRatio ?? 1;
    this.R = adapter.radius ?? adapter.size / Math.sqrt(3);
    // Every hex is the same hexagon translated: geometry is computed once.
    this.tpl = makeTemplate(this.adapter, this.R, this.keys[0] ?? "0,0");

    this.root = new PIXI.Container();
    this.root.sortableChildren = false;
    const layer = (name) => { const c = new PIXI.Container(); c.name = `glhex-${name}`; this.root.addChild(c); return c; };
    this.L = {
      tiles: layer("tiles"), anim: layer("anim"), veins: layer("veins"), hover: layer("hover"),
      hatch: layer("hatch"), borders: layer("borders"), trail: layer("trail"), staged: layer("staged"),
      sight: layer("sight"), party: layer("party"), marks: layer("marks"), labels: layer("labels"),
    };
    const g = (parent) => parent.addChild(new PIXI.Graphics());
    this.G = {
      hover: g(this.L.hover), borders: g(this.L.borders),
      trail: g(this.L.trail), staged: g(this.L.staged), sight: g(this.L.sight), party: g(this.L.party),
    };

    // Chunks: key → chunk id, chunk id → { g, keys }.
    this._chunkOf = new Map();
    this._chunks = new Map();
    for (const k of this.keys) {
      const { i, j } = parseKey(k);
      const id = `${Math.floor(i / CHUNK)},${Math.floor(j / CHUNK)}`;
      this._chunkOf.set(k, id);
      let ch = this._chunks.get(id);
      if (!ch) { ch = { g: this._pen(this.L.tiles), h: this._pen(this.L.hatch), v: this._pen(this.L.veins), keys: [] }; this._chunks.set(id, ch); }
      ch.keys.push(k);
    }
    // The neighbour across each edge (null off the map) — fog edges are owned
    // by one side only, which needs to know what is on the other.
    this._nbr = new Map();
    for (const k of this.keys) {
      const c = this.adapter.center(k);
      this._nbr.set(k, this.tpl.across.map((d) => {
        const n = this.adapter.keyAt({ x: c.x + d.x, y: c.y + d.y });
        return this.keySet.has(n) ? n : null;
      }));
    }
    this._skip = null;
    this._stamps = new Map();

    this._map = null;
    this._full = false;         // asGM && !viewAsPlayers — draw everything, hatch the rest
    this._asGM = false;
    this._views = new Map();
    this._sigs = new Map();
    this._labelKeys = new Set();
    this._labels = new Map();   // region id → { node, sig }
    this._marks = new Map();    // key → { node, sig }
    this._fades = [];           // { obj, t, D }
    this._anims = new Map();    // key → record
    this._animT = 0;

    this._party = [];
    this._sightEdges = [];
    this._sightPhase = -1;
    this._trail = [];
    this._staged = new Set();
    this._hover = null;

    this._zoom = 1;
    this._hairZoom = 1;
    this._pipLod = this._zoom >= PIP_ZOOM_THRESHOLD;
    this._textRes = this._targetRes();
    this._settle = -1;
    this._motion = 1;
    this._time = 0;
    this._gen = 0;
    this.destroyed = false;

    /** Readouts for previews / diagnostics. */
    this.stats = { staticMs: 0, staticHexes: 0, animating: 0 };
  }

  /* ── Public API ─────────────────────────────────────────────────────── */

  setMap(map, { asGM = false, viewAsPlayers = false, animate = false } = {}) {
    if (this.destroyed || !map) return;
    if (this._anims.size) this._bake();
    const full = !!asGM && !viewAsPlayers;
    const prev = this._map;
    const modeChanged = !prev || full !== this._full || prev.config?.render !== map.config?.render;
    this._map = map;
    this._full = full;
    this._asGM = !!asGM;
    this._gen++;

    // Every hex asks the model what this viewer sees.
    const prevViews = this._views;
    const views = new Map();
    for (const k of this.keys) views.set(k, viewFor(map, k, { asGM: full }));
    this._views = views;

    const ctx = this._ctx();
    const labels = regionLabels(ctx, views, (id) => this._terrainName(id));
    this._labelKeys = new Set(labels.map((l) => l.key));
    ctx.labelKeys = this._labelKeys;

    // Which hexes look different now.
    const changed = [];
    const sigs = new Map();
    for (const k of this.keys) {
      const s = this._sig(k, views.get(k), ctx);
      sigs.set(k, s);
      if (modeChanged || this._sigs.get(k) !== s) changed.push(k);
    }
    const prevSigs = this._sigs;
    this._sigs = sigs;

    // What animates: the state buckets, for hexes that also look different.
    let animKeys = new Map();
    if (animate && this._motion > 0 && !modeChanged && prev) {
      const diff = stateDiff(prev, map, this.keySet);
      const add = (list, kind) => { for (const k of list) if (prevSigs.get(k) !== sigs.get(k)) animKeys.set(k, kind); };
      add(diff.revealed, "reveal"); add(diff.masked, "mask"); add(diff.hidden, "hide");
      if (animKeys.size > ANIM_CAP) animKeys = new Map();
    }

    // Static layer: only the chunks that hold a changed hex.
    this._rebuildChunks(this._dirtyFor(changed), ctx, animKeys);

    if (animKeys.size) this._startAnims(animKeys, prevViews, prev, ctx);

    this._drawHairlines(ctx);
    drawTrail(this.G.trail, ctx, map.config?.trail ? this._trail : []);
    this._syncLabels(ctx, labels, !!prev && animate && this._motion > 0);
    this._syncMarks(ctx, animKeys, prevViews);
    this._redrawHover();
  }

  setParty(list) {
    this._party = (list ?? []).filter((p) => p?.key && this.keySet.has(p.key))
      .map((p) => ({ key: p.key, sight: Math.max(0, Number(p.sight) || 0) }));
    this._sightEdges = sightEdges(this.adapter, this._party);
    this._sightPhase = -1;
    if (!this._map) return;
    const ctx = this._ctx();
    drawParty(this.G.party, ctx, this._party, this._hair(HAIR.party));
    this._drawSightNow(ctx);
  }

  setTrail(keys) {
    this._trail = [...(keys ?? [])].filter((k) => this.keySet.has(k));
    if (!this._map) return;
    drawTrail(this.G.trail, this._ctx(), this._map.config?.trail ? this._trail : []);
  }

  setStaged(set) {
    this._staged = new Set(set ?? []);
    if (!this._map) return;
    drawStaged(this.G.staged, this._ctx(), this._asGM ? [...this._staged] : [], this._hair(HAIR.staged));
  }

  setHover(key) {
    this._hover = key && this.keySet.has(key) ? key : null;
    this._redrawHover();
  }

  setZoom(scale) {
    const z = Number(scale);
    if (!Number.isFinite(z) || z <= 0) return;
    this._zoom = z;
    if (!this._map) { this._hairZoom = z; this._pipLod = z >= PIP_ZOOM_THRESHOLD; this._textRes = this._targetRes(); return; }
    this._settle = ZOOM_SETTLE_MS;
  }

  setMotionScale(k) {
    this._motion = Math.max(0, Number(k) || 0);
    if (this._motion === 0 && this._anims.size) this._bake();
  }

  update(dtMs) {
    if (this.destroyed || !this._map) return;
    const dt = Math.max(0, Math.min(250, Number(dtMs) || 0));
    if (this._settle >= 0) {
      this._settle -= dt;
      if (this._settle < 0) this._applyZoom();
    }
    if (this._anims.size) this._stepAnims(dt);
    if (this._fades.length) this._stepFades(dt);
    if (this._motion > 0) {
      this._time += dt;
      this.L.veins.alpha = 0.5 + 0.5 * pulse(this._time, "blightPeriod");
      this.L.staged.alpha = 0.35 + 0.65 * pulse(this._time, "stagedPulse");
      if (this._sightEdges.length) this._drawSightNow(this._ctx());
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._anims.clear();
    this._fades = [];
    this.root.destroy({ children: true });
  }

  /* ── Internals: context & signatures ─────────────────────────────────── */

  /** The tessellated look for a hex, drawn once at the origin and cached by stampKey. */
  _stamp(ctx, k, v, look, c) {
    const skey = stampKey(ctx, k, v, look);
    let src = this._stamps.get(skey);
    if (!src) {
      if (this._stamps.size > 2048) this._stamps.clear();
      src = new MeshPen(null);
      drawHex(src, ctx, k, v, look, c.x, c.y);
      this._stamps.set(skey, src);
    }
    return src;
  }

  /** A MeshPen whose mesh lives in `parent`. */
  _pen(parent) {
    const pen = new MeshPen(this.PIXI);
    parent.addChild(pen.mesh);
    return pen;
  }

  _ctx() {
    const map = this._map;
    const lod = this._pipLod;
    return {
      adapter: this.adapter, tpl: this.tpl, R: this.R, colors: this.colors, map,
      fogEdge: (k, e) => e < 3 || !this._staticFog(this._nbr.get(k)?.[e]),
      mode: map?.config?.render ?? "tiles", fontFamily: this.fontFamily,
      labelKeys: this._labelKeys,
      showPips: (v) => !!(v.ratingOverridden || lod || map?.config?.alwaysPips),
    };
  }

  _terrainName(id) {
    const def = this._map ? terrainDef(this._map, id) : null;
    if (def?.name) return def.name;
    return this.terrainNameFn?.(id) ?? id;
  }

  _hair(n) { return hairline(n, this._hairZoom, this.dpr); }
  _targetRes() { return Math.max(0.5, Math.min(TEXT_RES_MAX, this._zoom * this.dpr)); }

  _sig(k, v, ctx) {
    const look = lookFor(v, this._full);
    const rc = v.regionId ? ctx.map.regions[v.regionId]?.color ?? "" : "";
    const lm = v.landmarks?.length ? v.landmarks.map((l) => `${l.id}:${l.icon}:${l.img}:${l.label}`).join("|") : "";
    const pips = v.rating != null && ctx.showPips(v) ? v.rating : 0;
    const withheld = look === "masked" && v.rating == null && effectiveRating(ctx.map, k) != null ? 1 : 0;
    const hatch = this._full ? v.playerState : "";
    return `${look}|${v.terrain?.color ?? ""}|${v.terrain?.glyph ?? ""}|${pips}|${withheld}|${v.blight ? 1 : 0}|${v.regionId ?? ""}|${rc}|${lm}|${this._labelKeys.has(k) ? 1 : 0}|${hatch}`;
  }

  /* ── Static layer ───────────────────────────────────────────────────── */

  /** Is `k` drawn as fog by the static layer right now (and so owns its low edges)? */
  _staticFog(k) {
    if (!k || this._skip?.has(k)) return false;
    const v = this._views.get(k);
    return !!v && lookFor(v, this._full) === "fog";
  }

  /** Chunks touched by a change to `keys`: theirs and their neighbours' (fog edge ownership). */
  _dirtyFor(keys) {
    const out = new Set();
    for (const k of keys) {
      out.add(this._chunkOf.get(k));
      for (const n of this._nbr.get(k) ?? []) if (n) out.add(this._chunkOf.get(n));
    }
    return out;
  }

  _rebuildChunks(ids, ctx, skip = null) {
    const t0 = now();
    let n = 0;
    this._skip = skip;
    const hatchW = this._hair(HAIR.hatch);
    for (const id of ids) {
      const ch = this._chunks.get(id);
      if (!ch) continue;
      ch.g.clear();
      const veins = [];
      for (const k of ch.keys) {
        if (skip?.has(k)) continue;
        const v = this._views.get(k);
        const look = lookFor(v, this._full);
        const c = this.adapter.center(k);
        ch.g.stamp(this._stamp(ctx, k, v, look, c), c.x, c.y);
        if (v.blight && look === "tile") veins.push({ key: k, rim: !!v.landmarks?.length });
        n++;
      }
      drawVeins(ch.v, ctx, veins);
      ch.g.commit(); ch.v.commit();
      this._drawChunkHatch(ch, ctx, hatchW);
    }
    this._skip = null;
    if (ids.size) this.stats = { ...this.stats, staticMs: now() - t0, staticHexes: n };
  }

  _drawChunkHatch(ch, ctx, width) {
    ch.h.clear();
    if (!this._full) { ch.h.commit(); return; }
    for (const k of ch.keys) {
      if (this._skip?.has(k) || this._anims.has(k)) continue;
      const st = this._views.get(k)?.playerState;
      if (st !== "hidden" && st !== "masked") continue;
      // Hatch is stamped per hex (anchored to the hex, not the world); the
      // gutter between tiles hides where one hex's lines meet the next's.
      const skey = `hatch|${st}|${width}`;
      let src = this._stamps.get(skey);
      if (!src) {
        const k0 = this.keys[0], c0 = this.adapter.center(k0);
        src = new MeshPen(null);
        drawHatch(src, ctx, k0, st, width, c0.x, c0.y);
        this._stamps.set(skey, src);
      }
      const c = this.adapter.center(k);
      ch.h.stamp(src, c.x, c.y);
    }
    ch.h.commit();
  }

  /** Every device-pixel-sized element, at the current settled zoom. */
  _drawHairlines(ctx) {
    // The borders cover the whole map, so they redraw only when what they
    // outline, or the zoom they are sized for, actually changed.
    const drawn = (v) => this._full || v.drawn;
    let borderSig = `${this._hairZoom}|`;
    for (const [k, v] of this._views) if (v.regionId && drawn(v)) borderSig += `${k}=${v.regionId};`;
    for (const r of Object.values(ctx.map.regions ?? {})) borderSig += `${r.id}:${r.color};`;
    if (borderSig !== this._borderSig) {
      this._borderSig = borderSig;
      this.G.borders.clear();
      drawRegionBorders(this.G.borders, ctx, this._views, this._hair(HAIR.border), drawn, this._nbr);
    }
    drawStaged(this.G.staged, ctx, this._asGM ? [...this._staged] : [], this._hair(HAIR.staged));
    drawParty(this.G.party, ctx, this._party, this._hair(HAIR.party));
    this._sightPhase = -1;
    this._drawSightNow(ctx);
  }

  _drawSightNow(ctx) {
    const P = dur("sightDashPeriod", 1) || 1;
    const phase = this._motion > 0 ? (this._time % P) / P : 0;
    // Redraw only once the dash has moved about half a device pixel.
    const moved = Math.abs(phase - this._sightPhase) * (this.R / 3);
    if (this._sightPhase >= 0 && moved < this._hair(0.5) && phase >= this._sightPhase) return;
    this._sightPhase = phase;
    drawSight(this.G.sight, ctx, this._sightEdges, this._hair(HAIR.sight), phase);
  }

  _applyZoom() {
    if (!this._map) { this._hairZoom = this._zoom; return; }
    const ctx = this._ctx();
    if (Math.abs(this._zoom / this._hairZoom - 1) > 0.01) {
      this._hairZoom = this._zoom;
      this._drawHairlines(ctx);
      if (this._full) {
        const w = this._hair(HAIR.hatch);
        for (const ch of this._chunks.values()) this._drawChunkHatch(ch, ctx, w);
      }
    }
    const lod = this._zoom >= PIP_ZOOM_THRESHOLD;
    if (lod !== this._pipLod) {
      this._pipLod = lod;
      const c2 = this._ctx();
      const dirty = new Set();
      for (const k of this.keys) {
        const sg = this._sig(k, this._views.get(k), c2);
        if (sg !== this._sigs.get(k)) { this._sigs.set(k, sg); dirty.add(this._chunkOf.get(k)); }
      }
      this._rebuildChunks(dirty, c2, this._anims.size ? new Set(this._anims.keys()) : null);
    }
    const res = this._targetRes();
    if (Math.abs(res / this._textRes - 1) > TEXT_RES_DRIFT) {
      this._textRes = res;
      const apply = (t) => { t.resolution = res; };
      eachText(this.L.labels, apply);
      eachText(this.L.marks, apply);
    }
  }

  /* ── Text layers ────────────────────────────────────────────────────── */

  _syncLabels(ctx, labels, fade) {
    const keep = new Set();
    for (const info of labels) {
      const sig = `${info.key}|${info.name}|${info.sub}|${this.R}`;
      keep.add(info.id);
      const cur = this._labels.get(info.id);
      if (cur?.sig === sig) continue;
      cur?.node.destroy({ children: true });
      const node = makeRegionLabel(this.PIXI, ctx, info, this._textRes);
      this.L.labels.addChild(node);
      this._labels.set(info.id, { node, sig });
      if (fade && !cur) { node.alpha = 0; this._fades.push({ obj: node, t: 0, D: dur("revealInk", this._motion) }); }
    }
    for (const [id, cur] of this._labels) {
      if (keep.has(id)) continue;
      cur.node.destroy({ children: true });
      this._labels.delete(id);
    }
  }

  _syncMarks(ctx, animKeys, prevViews) {
    const keep = new Set();
    for (const [k, v] of this._views) {
      if (!v.landmarks?.length) continue;
      keep.add(k);
      const sig = v.landmarks.map((l) => `${l.id}:${l.icon}:${l.img}:${l.label}`).join("|");
      const cur = this._marks.get(k);
      let node = cur?.node;
      if (cur?.sig !== sig) {
        cur?.node.destroy({ children: true });
        node = makeLandmarkNode(this.PIXI, ctx, k, v.landmarks, this._textRes, {
          resolveIcon: this.resolveIcon, loadTexture: this.loadTexture,
          alive: () => !this.destroyed && this._marks.get(k)?.node === node,
        });
        this.L.marks.addChild(node);
        this._marks.set(k, { node, sig });
      }
      const rec = this._anims.get(k);
      const had = prevViews.get(k)?.landmarks?.length;
      if (rec && !had) { node.alpha = 0; rec.marks = node; }
      else node.alpha = 1;
    }
    for (const [k, cur] of this._marks) {
      if (keep.has(k)) continue;
      cur.node.destroy({ children: true });
      this._marks.delete(k);
    }
  }

  _stepFades(dt) {
    for (const f of this._fades) {
      f.t += dt;
      if (!f.obj.destroyed) f.obj.alpha = f.D > 0 ? easeOutCubic(clamp01(f.t / f.D)) : 1;
    }
    this._fades = this._fades.filter((f) => !f.obj.destroyed && f.t < f.D);
  }

  /* ── Animation ──────────────────────────────────────────────────────── */

  _startAnims(animKeys, prevViews, prevMap, ctx) {
    const PIXI = this.PIXI;
    const delays = staggerDelays([...animKeys.keys()], {
      adapter: this.adapter, party: this._party, cubeDistance, scale: this._motion,
    });
    // The "from" look needs the previous map (region colours, withheld ratings).
    // A transient hex draws all its own fog edges (its neighbours still own theirs).
    const prevCtx = { ...ctx, map: prevMap ?? ctx.map, labelKeys: new Set(), fogEdge: null };
    const nextCtx = { ...ctx, fogEdge: null };
    this._animT = 0;
    for (const [k, kind] of animKeys) {
      const c = this.adapter.center(k);
      const cont = new PIXI.Container();
      cont.position.set(c.x, c.y);
      const oldV = prevViews.get(k) ?? viewFor(prevCtx.map, k, { asGM: this._full });
      const newV = this._views.get(k);
      const fromP = new MeshPen(PIXI);
      drawHex(fromP, prevCtx, k, oldV, lookFor(oldV, this._full), c.x, c.y);
      if (this._full && oldV.playerState !== "revealed") drawHatch(fromP, ctx, k, oldV.playerState, this._hair(HAIR.hatch), c.x, c.y);
      const toWrap = new PIXI.Container();
      const toP = new MeshPen(PIXI);
      drawHex(toP, nextCtx, k, newV, lookFor(newV, this._full), c.x, c.y);
      if (this._full && newV.playerState !== "revealed") drawHatch(toP, ctx, k, newV.playerState, this._hair(HAIR.hatch), c.x, c.y);
      const fromG = fromP.commit(), toG = toP.commit();
      toWrap.addChild(toG);
      toWrap.alpha = 0;
      const traceG = new PIXI.Graphics();
      cont.addChild(fromG, toWrap, traceG);
      this.L.anim.addChild(cont);
      this._anims.set(k, {
        anim: makeHexAnim(kind, delays.get(k) ?? 0, this._motion),
        cont, fromG, toWrap, traceG, lastTrace: -1, marks: null,
        poly: hexPolys(ctx, k).outer, c,
      });
    }
    this.stats = { ...this.stats, animating: this._anims.size };
  }

  _stepAnims(dt) {
    this._animT += dt;
    let all = true;
    const w = GEO.traceWidth * this.R;
    for (const rec of this._anims.values()) {
      const s = rec.anim.sample(this._animT);
      rec.fromG.alpha = s.from;
      rec.toWrap.alpha = s.to;
      rec.toWrap.scale.set(s.scale);
      if (rec.marks && !rec.marks.destroyed) rec.marks.alpha = s.to;
      if (rec.anim.kind === "reveal") {
        if (s.trace !== rec.lastTrace) {
          rec.lastTrace = s.trace;
          rec.traceG.clear();
          if (s.trace > 0) {
            rec.traceG.lineStyle({ width: w * 2.6, color: this.colors.accent, alpha: 0.18, cap: "round", join: "round" });
            tracePoly(rec.traceG, rec.poly, s.trace, rec.c.x, rec.c.y);
            rec.traceG.lineStyle({ width: w, color: this.colors.trace, alpha: 1, cap: "round", join: "round" });
            tracePoly(rec.traceG, rec.poly, s.trace, rec.c.x, rec.c.y);
          }
        }
        rec.traceG.alpha = s.traceAlpha;
      }
      if (!s.done) all = false;
    }
    if (all) this._bake();
  }

  /** Finish every animation: fold the animated hexes into the static layer. */
  _bake() {
    const keys = [...this._anims.keys()];
    for (const rec of this._anims.values()) if (rec.marks && !rec.marks.destroyed) rec.marks.alpha = 1;
    this._anims.clear();
    for (const ch of this.L.anim.removeChildren()) ch.destroy({ children: true });
    this.stats = { ...this.stats, animating: 0 };
    if (!this._map || !keys.length) return;
    const ctx = this._ctx();
    this._rebuildChunks(this._dirtyFor(keys), ctx);
  }

  _redrawHover() {
    if (!this._map) return;
    const k = this._hover;
    const v = k ? this._views.get(k) : null;
    drawHover(this.G.hover, this._ctx(), k, v, v ? lookFor(v, this._full) === "fog" : false);
  }
}
