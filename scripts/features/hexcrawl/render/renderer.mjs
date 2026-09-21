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
 *   tex        region textures: one Graphics, a texture fill per textured hex body
 *              (fit: one image over the region's bounding box — no repeat, no seam)
 *   tiles      chunked static Graphics, rebuilt per chunk when a hex in it changes
 *              (each chunk also owns one Graphics in the veins and hatch layers)
 *   anim       transient per-hex containers while a hex reveals / masks / hides
 *   qmarks     the fog "?" — one Sprite per fog hex, all sharing ONE rasterised
 *              Text in the region-label face (text per hex would be thousands)
 *   icons      image terrain/region icons: a tinted Sprite + dark halo per hex
 *   blight     the blight overlay: one Mesh + shader over every blighted hex body,
 *              above the ground and fill, beneath icons (blight.mjs)
 *   hover
 *   hatch      GM view of what players cannot see (hairline, redrawn on zoom settle)
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
import { effectiveRating, resolveAsset, stateDiff, terrainDef, viewFor, visualFor } from "../model.mjs";
import { dur, makeHexAnim, pulse, staggerDelays, easeOutCubic, clamp01 } from "./anim.mjs";
import { tracePoly } from "./geom.mjs";
import { eachText, makeLandmarkNode, makeRegionLabel, regionLabels } from "./labels.mjs";
import {
  drawHover, drawParty, drawSight, drawStaged, drawTrail, sightEdges,
} from "./overlays.mjs";
import {
  ALPHA, ANIM_CAP, CHUNK, GEO, HAIR, TEXT_RES_DRIFT, TEXT_RES_MAX, ZOOM_SETTLE_MS, hairline, makeColors,
} from "./style.mjs";
import { MeshPen } from "./pen.mjs";
import { BLIGHT_LOOP, blightGeometry, blightShader } from "./blight.mjs";
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
   * @param {string} [o.assetRoot]    where "glhex:" art lives (the module's assets/hexcrawl/)
   */
  constructor({ PIXI, adapter, keys, loadTexture = null, resolveIcon = null, palette, terrainName = null, fontFamily = null, resolution = null, assetRoot = "" }) {
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
    this.assetRoot = assetRoot;
    this.fontFamily = fontFamily ?? "Oxanium, 'Segoe UI Symbol', sans-serif";
    this.dpr = resolution ?? globalThis.devicePixelRatio ?? 1;
    this.R = adapter.radius ?? adapter.size / Math.sqrt(3);
    // Every hex is the same hexagon translated: geometry is computed once.
    this.tpl = makeTemplate(this.adapter, this.R, this.keys[0] ?? "0,0");

    this.root = new PIXI.Container();
    this.root.sortableChildren = false;
    const layer = (name) => { const c = new PIXI.Container(); c.name = `glhex-${name}`; this.root.addChild(c); return c; };
    this.L = {
      tex: layer("tex"), tiles: layer("tiles"), blight: layer("blight"), anim: layer("anim"), qmarks: layer("qmarks"), icons: layer("icons"), hover: layer("hover"),
      hatch: layer("hatch"), trail: layer("trail"), staged: layer("staged"),
      sight: layer("sight"), party: layer("party"), marks: layer("marks"), labels: layer("labels"),
    };
    const g = (parent) => parent.addChild(new PIXI.Graphics());
    this.G = {
      hover: g(this.L.hover), tex: g(this.L.tex),
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
      if (!ch) { ch = { g: this._pen(this.L.tiles), h: this._pen(this.L.hatch), keys: [] }; this._chunks.set(id, ch); }
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
    this._qmarks = new Map();   // fog key → Sprite
    this._qText = null;         // the one rasterised "?" every qmark Sprite shows
    this._art = new Map();      // key → { icon: url|null, tex: {url,mode,scale,region}|null } (drawn hexes)
    this._images = new Map();   // url → { status: "loading"|"ok"|"fail", tex }
    this._icons = new Map();    // key → { node, sig }
    this._texSig = "";
    this._blight = null;        // { mesh, shader } over every blighted hex body
    this._blightSig = "";
    this._artDirty = false;
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
    this._computeArt();

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
    this._syncQmarks(animKeys);
    this._drawTex(ctx);
    this._drawBlight(ctx);
    this._syncIcons(ctx, animKeys, prevViews);
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
    if (this._artDirty) this._refreshArt();
    if (this._anims.size) this._stepAnims(dt);
    if (this._fades.length) this._stepFades(dt);
    if (this._motion > 0) {
      this._time += dt;
      if (this._blight) this._blight.shader.uniforms.uTime = (this._time % BLIGHT_LOOP) / BLIGHT_LOOP;
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
    this._qText?.destroy(true);
    this._qText = null;
    this._images.clear();
    for (const t of [...(this._shadows?.values() ?? []), ...(this._lit?.values() ?? [])]) t?.destroy(true);
    this._shadows?.clear();
    this._lit?.clear();
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
      boundary: (k) => this._boundary(k),
      art: (k) => this._artState(k),
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

  /** Which region a drawn hex belongs to, as far as this viewer can tell: a masked
   *  hex withholding its region is its own island (no neighbour fuses with it). */
  _group(k, v) {
    return v.regionId ?? (v.regionWithheld ? `?${k}` : "");
  }

  /** Boundary edges of hex k (bit e): the map edge, fog, or a different region across it. */
  _boundary(k) {
    const v = this._views.get(k);
    const across = this._nbr.get(k);
    if (!v || !across) return 63;
    const mine = this._group(k, v);
    let mask = 0;
    for (let e = 0; e < 6; e++) {
      const n = across[e];
      const w = n ? this._views.get(n) : null;
      if (!w || lookFor(w, this._full) === "fog" || this._group(n, w) !== mine) mask |= 1 << e;
    }
    return mask;
  }

  _sig(k, v, ctx) {
    const look = lookFor(v, this._full);
    const rc = v.regionId ? ctx.map.regions[v.regionId]?.color ?? "" : "";
    const lm = v.landmarks?.length ? v.landmarks.map((l) => `${l.id}:${l.icon}:${l.img}:${l.label}`).join("|") : "";
    const pips = v.rating != null && ctx.showPips(v) ? v.rating : 0;
    const withheld = look === "masked" && v.rating == null && effectiveRating(ctx.map, k) != null ? 1 : 0;
    const hatch = this._full ? v.playerState : "";
    // The boundary mask is a fact about the NEIGHBOURS: a region change next door redraws this hex.
    const edge = look === "fog" ? "" : this._boundary(k);
    // Art arrives asynchronously: a texture landing (the fill thins) or an icon failing
    // (the glyph comes back) must change the signature, or the hex never redraws.
    const art = this._artState(k);
    const artSig = art ? `${art.tex ? 1 : 0}${art.icon ? 1 : 0}${art.tex ? this._map.config?.texStrength : ""}` : "";
    return `${look}|${v.terrain?.color ?? ""}|${v.terrain?.glyph ?? ""}|${pips}|${withheld}|${v.blight ? 1 : 0}|${v.regionId ?? ""}|${rc}|${lm}|${this._labelKeys.has(k) ? 1 : 0}|${hatch}|${edge}|${artSig}`;
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
      for (const k of ch.keys) {
        if (skip?.has(k)) continue;
        const v = this._views.get(k);
        const look = lookFor(v, this._full);
        const c = this.adapter.center(k);
        ch.g.stamp(this._stamp(ctx, k, v, look, c), c.x, c.y);
        n++;
      }
      ch.g.commit();
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
      if (this._qText) { this._qText.resolution = res; this._qText.updateText(true); }
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

  /** The shared "?" raster: the region-label face, small and dim. */
  _qTexture() {
    if (!this._qText) {
      const size = GEO.fogQSize * this.R;
      this._qText = new this.PIXI.Text("?", new this.PIXI.TextStyle({
        fontFamily: this.fontFamily, fontSize: size, fontWeight: "500", fill: this.colors.css.textDim,
      }));
      this._qText.resolution = this._textRes;
      this._qText.updateText(true);
    }
    return this._qText.texture;
  }

  /**
   * One "?" per fog hex without a landmark. A hex animating INTO fog gets a
   * fresh Sprite that fades in with the animation; one animating OUT of fog
   * keeps its old Sprite, fading it out, until the animation bakes.
   */
  _syncQmarks(animKeys) {
    const want = new Set();
    if (!this._full) {
      for (const [k, v] of this._views) if (lookFor(v, false) === "fog" && !v.landmarks?.length) want.add(k);
    }
    for (const [k, sp] of this._qmarks) {
      if (want.has(k)) continue;
      this._qmarks.delete(k);
      const rec = this._anims.get(k);
      if (rec && animKeys.has(k)) { rec.qOut = sp; continue; }
      sp.destroy();
    }
    if (!want.size) return;
    const tex = this._qTexture();
    for (const k of want) {
      if (this._qmarks.has(k)) continue;
      const sp = new this.PIXI.Sprite(tex);
      sp.anchor.set(0.5);
      const c = this.adapter.center(k);
      sp.position.set(c.x, c.y);
      sp.alpha = ALPHA.fogQ;
      this.L.qmarks.addChild(sp);
      this._qmarks.set(k, sp);
      const rec = this._anims.get(k);
      if (rec && animKeys.has(k)) { sp.alpha = 0; rec.qIn = sp; }
    }
  }

  /* ── Art: region textures and image icons ─────────────────────────── */

  /** What art each drawn hex shows, as URLs (model.visualFor + resolveAsset). */
  _computeArt() {
    const map = this._map;
    const opts = { assetBase: map.assetBase ?? "", builtinRoot: this.assetRoot };
    this._art = new Map();
    for (const [k, v] of this._views) {
      if (lookFor(v, this._full) === "fog") continue;
      const a = visualFor(map, k, v);
      if (!a.icon && !a.tex) continue;
      const icon = a.icon ? resolveAsset(a.icon, opts) : null;
      const tex = a.tex ? { ...a.tex, url: resolveAsset(a.tex.src, opts) } : null;
      if (icon) this._want(icon);
      if (tex) this._want(tex.url);
      this._art.set(k, { icon, tex });
    }
  }

  /** Start loading an image once; a finished load re-draws the art next frame. */
  _want(url) {
    if (this._images.has(url)) return;
    if (!this.loadTexture) { this._images.set(url, { status: "fail", tex: null }); return; }
    const rec = { status: "loading", tex: null };
    this._images.set(url, rec);
    Promise.resolve().then(() => this.loadTexture(url)).then((tex) => {
      if (this.destroyed) return;
      rec.status = tex ? "ok" : "fail"; rec.tex = tex ?? null;
      this._artDirty = true;
    }).catch(() => { rec.status = "fail"; this._artDirty = true; });
  }

  /** For drawHex: is an icon standing in for the glyph, and is a texture under the fill?
   *  A LOADING icon already suppresses the glyph (no flash of the old mark); a
   *  FAILED one gives it back. A texture thins the fill only once it has arrived. */
  _artState(k) {
    const a = this._art.get(k);
    if (!a) return null;
    const icon = a.icon && this._images.get(a.icon)?.status !== "fail" ? a.icon : null;
    const tex = a.tex && this._images.get(a.tex.url)?.status === "ok" ? a.tex : null;
    return icon || tex ? { icon, tex } : null;
  }

  /** Images arrived (or failed): redraw every hex whose art state changed. */
  _refreshArt() {
    this._artDirty = false;
    if (!this._map) return;
    const ctx = this._ctx();
    const dirty = new Set();
    for (const k of this.keys) {
      const sg = this._sig(k, this._views.get(k), ctx);
      if (sg !== this._sigs.get(k)) { this._sigs.set(k, sg); dirty.add(this._chunkOf.get(k)); }
    }
    if (dirty.size) this._rebuildChunks(dirty, ctx, this._anims.size ? new Set(this._anims.keys()) : null);
    this._drawTex(ctx);
    this._syncIcons(ctx, new Map(), this._views);
  }

  /** World-space bounding box of every hex a region owns (drawn or not), so its
   *  texture sits in the same place however much of the region is revealed. */
  _regionBox(id) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [k, h] of Object.entries(this._map.hexes)) {
      if (h.rg !== id || !this.keySet.has(k)) continue;
      const c = this.adapter.center(k);
      x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
    }
    if (x0 === Infinity) return null;
    const R = this.R;
    return { x: x0 - R, y: y0 - R, w: x1 - x0 + 2 * R, h: y1 - y0 + 2 * R };
  }

  /** The texture layer: every drawn, textured hex body, filled from its region's image. */
  _drawTex(ctx) {
    const byRegion = new Map();
    let sig = "";
    for (const [k, a] of this._art) {
      const t = a.tex;
      if (!t || this._images.get(t.url)?.status !== "ok") continue;
      const mask = this._boundary(k);
      sig += `${k}:${mask}:${t.url}:${t.mode}:${t.scale}:${t.pixel ? 1 : 0};`;
      let list = byRegion.get(t.region);
      if (!list) byRegion.set(t.region, (list = { t, keys: [] }));
      list.keys.push([k, mask]);
    }
    if (sig === this._texSig) return;
    this._texSig = sig;
    const g = this.G.tex;
    g.clear();
    const PIXI = this.PIXI;
    for (const [id, { t, keys }] of byRegion) {
      const tex = this._images.get(t.url).tex;
      const tw = tex.width || 1, th = tex.height || 1;
      const scaleMode = t.pixel ? PIXI.SCALE_MODES.NEAREST : PIXI.SCALE_MODES.LINEAR;
      if (tex.baseTexture.scaleMode !== scaleMode) tex.baseTexture.scaleMode = scaleMode;
      const m = new PIXI.Matrix();
      if (t.mode === "tile") {
        tex.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
        const s = (t.scale * 2 * this.R) / tw;
        m.scale(s, s);
      } else {
        const box = this._regionBox(id);
        if (!box) continue;
        const s = Math.max(box.w / tw, box.h / th);   // cover: no letterbox, centred
        m.scale(s, s).translate(box.x + (box.w - tw * s) / 2, box.y + (box.h - th * s) / 2);
      }
      g.beginTextureFill({ texture: tex, matrix: m });
      for (const [k, mask] of keys) {
        const c = this.adapter.center(k);
        const body = ctx.tpl.fused(mask).body;
        g.drawPolygon(body.flatMap((p) => [p.x + c.x, p.y + c.y]));
      }
      g.endFill();
    }
  }

  /**
   * A soft shadow for an icon image: its silhouette, blurred by `blur` source
   * pixels and filled with ink, baked ONCE per (icon, blur) into a texture padded
   * so the blur is never clipped — the same centre, so it shares the icon's
   * anchor and scale. Null where the environment has no 2D canvas filter (the
   * icon then simply has no shadow). Returned textures live as long as the renderer.
   */
  _iconShadow(url, tex, blur) {
    const key = `${url}|${blur}`;
    this._shadows ??= new Map();
    if (this._shadows.has(key)) return this._shadows.get(key);
    let out = null;
    try {
      const src = tex.baseTexture?.resource?.source;
      const doc = globalThis.document;
      if (src && doc) {
        const w = tex.width, h = tex.height, pad = Math.ceil(blur * 3);
        const cv = doc.createElement("canvas");
        cv.width = w + pad * 2; cv.height = h + pad * 2;
        const g = cv.getContext("2d");
        if (g && "filter" in g) {
          g.filter = `blur(${blur}px)`;
          g.drawImage(src, pad, pad, w, h);
          g.filter = "none";
          g.globalCompositeOperation = "source-in";
          g.fillStyle = this.palette.ink0;
          g.fillRect(0, 0, cv.width, cv.height);
          out = this.PIXI.Texture.from(cv);
        }
      }
    } catch { out = null; }
    this._shadows.set(key, out);
    return out;
  }

  /**
   * The icon with light falling from above baked in: its silhouette filled with a
   * top-to-bottom ramp (full white → a cool grey) that the terrain tint then
   * multiplies, so the mark reads as a lit object rather than a flat cut-out.
   * Same size as the source, so it shares the icon's anchor and scale.
   */
  _iconLit(url, tex) {
    this._lit ??= new Map();
    if (this._lit.has(url)) return this._lit.get(url);
    let out = null;
    try {
      const src = tex.baseTexture?.resource?.source;
      const doc = globalThis.document;
      if (src && doc) {
        const cv = doc.createElement("canvas");
        cv.width = tex.width; cv.height = tex.height;
        const g = cv.getContext("2d");
        g.drawImage(src, 0, 0, cv.width, cv.height);
        g.globalCompositeOperation = "source-in";
        const ramp = g.createLinearGradient(0, 0, 0, cv.height);
        ramp.addColorStop(0, "#ffffff");
        ramp.addColorStop(0.55, "#eef0f4");
        ramp.addColorStop(1, "#aeb4c0");
        g.fillStyle = ramp;
        g.fillRect(0, 0, cv.width, cv.height);
        out = this.PIXI.Texture.from(cv);
      }
    } catch { out = null; }
    this._lit.set(url, out);
    return out;
  }

  /** The blight overlay: rebuilt only when the set of blighted hexes (or their shape) changes. */
  _drawBlight(ctx) {
    const cells = [];
    let sig = "";
    for (const [k, v] of this._views) {
      if (!v.blight || lookFor(v, this._full) === "fog") continue;
      const mask = this._boundary(k);
      sig += `${k}:${mask};`;
      // The glow gathers where the blight meets unblighted ground (or fog, or the map edge).
      let edge = 0;
      (this._nbr.get(k) ?? []).forEach((n, e) => { const w = n ? this._views.get(n) : null; if (!w?.blight || lookFor(w, this._full) === "fog") edge |= 1 << e; });
      cells.push({ c: this.adapter.center(k), body: ctx.tpl.fused(mask).body, edge });
    }
    if (sig === this._blightSig) return;
    this._blightSig = sig;
    const PIXI = this.PIXI;
    if (!cells.length) { if (this._blight) this._blight.mesh.visible = false; return; }
    if (!this._blight) {
      const shader = blightShader(PIXI, {
        R: this.R, color: this.colors.violet, hot: this.colors.violetHot, bruise: this.colors.bruise,
        pixel: GEO.blightPixel, alpha: ALPHA.blight,
      });
      const mesh = new PIXI.Mesh(blightGeometry(PIXI, cells), shader);
      mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
      this.L.blight.addChild(mesh);
      this._blight = { mesh, shader };
    } else {
      const old = this._blight.mesh.geometry;
      this._blight.mesh.geometry = blightGeometry(PIXI, cells);
      old.destroy();
      this._blight.mesh.visible = true;
    }
  }

  /** Image icons, tinted in the terrain's glyph colour, over two soft baked shadows
   *  (a tight contact shadow and a wide ambient one) so they sit ON the ground
   *  texture instead of sinking into it. */
  _syncIcons(ctx, animKeys, prevViews) {
    const PIXI = this.PIXI;
    const keep = new Set();
    for (const [k, a] of this._art) {
      if (!a.icon) continue;
      const img = this._images.get(a.icon);
      if (img?.status !== "ok") continue;
      const v = this._views.get(k);
      const lmN = v.landmarks?.length ?? 0;
      if (this._labelKeys.has(k) && !lmN) continue;   // the label names this hex
      const masked = lookFor(v, this._full) === "masked";
      const region = v.regionId ? this._map.regions[v.regionId]?.color ?? null : null;
      const tint = this.colors.tile(v.terrain?.color ?? "#5b6478", { blight: !!v.blight, region, masked }).glyph;
      const sig = `${a.icon}|${tint}|${lmN ? 1 : 0}|${masked ? 1 : 0}`;
      keep.add(k);
      const cur = this._icons.get(k);
      if (cur?.sig === sig) continue;
      const rec = this._anims.get(k);
      if (cur) { if (rec && animKeys.has(k)) rec.iOut = cur.node; else cur.node.destroy({ children: true }); }
      const node = new PIXI.Container();
      const c = this.adapter.center(k);
      node.position.set(c.x, c.y + (lmN ? GEO.lmGlyphY : GEO.glyphY) * this.R);
      const size = GEO.iconSize * this.R * (lmN ? GEO.lmGlyphScale : 1);
      const k0 = size / Math.max(img.tex.width || 1, img.tex.height || 1);
      const R = this.R * (lmN ? GEO.lmGlyphScale : 1);
      const sprite = (tex, alpha, dy = 0, color = null) => {
        const sp = new PIXI.Sprite(tex);
        sp.anchor.set(0.5); sp.scale.set(k0); sp.alpha = alpha; sp.position.set(0, dy);
        if (color != null) sp.tint = color;
        return sp;
      };
      const ambient = this._iconShadow(a.icon, img.tex, GEO.iconAmbientBlur);
      const contact = this._iconShadow(a.icon, img.tex, GEO.iconContactBlur);
      if (ambient) node.addChild(sprite(ambient, ALPHA.iconAmbient, GEO.iconAmbientDrop * R));
      if (contact) node.addChild(sprite(contact, ALPHA.iconContact, GEO.iconContactDrop * R));
      node.addChild(sprite(this._iconLit(a.icon, img.tex) ?? img.tex, masked ? ALPHA.maskIcon : 1, 0, tint));
      this.L.icons.addChild(node);
      this._icons.set(k, { node, sig });
      if (rec && animKeys.has(k)) { node.alpha = 0; rec.iIn = node; }
    }
    for (const [k, cur] of this._icons) {
      if (keep.has(k)) continue;
      this._icons.delete(k);
      const rec = this._anims.get(k);
      if (rec && animKeys.has(k)) rec.iOut = cur.node; else cur.node.destroy({ children: true });
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
      if (rec.qIn && !rec.qIn.destroyed) rec.qIn.alpha = ALPHA.fogQ * s.to;
      if (rec.iIn && !rec.iIn.destroyed) rec.iIn.alpha = s.to;
      if (rec.iOut && !rec.iOut.destroyed) rec.iOut.alpha = s.from;
      if (rec.qOut && !rec.qOut.destroyed) rec.qOut.alpha = ALPHA.fogQ * s.from;
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
    for (const rec of this._anims.values()) {
      if (rec.marks && !rec.marks.destroyed) rec.marks.alpha = 1;
      if (rec.qIn && !rec.qIn.destroyed) rec.qIn.alpha = ALPHA.fogQ;
      if (rec.qOut && !rec.qOut.destroyed) rec.qOut.destroy();
      if (rec.iIn && !rec.iIn.destroyed) rec.iIn.alpha = 1;
      if (rec.iOut && !rec.iOut.destroyed) rec.iOut.destroy({ children: true });
    }
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
