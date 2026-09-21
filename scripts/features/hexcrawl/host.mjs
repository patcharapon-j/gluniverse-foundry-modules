/**
 * Hexcrawl — mounts the shipped renderer on Foundry's canvas and feeds it.
 *
 * The renderer (render/renderer.mjs) is pure: it takes PIXI and an adapter by
 * injection and never reads the world. Everything world-shaped — which scene,
 * whose view, where the party stands, what the trail is, the zoom, the motion
 * scale — is decided HERE and pushed in.
 *
 * Layering: a container in `canvas.primary` (where tile and token ART lives),
 * biased onto the TILES sort layer minus one — above the scene background,
 * beneath tiles, drawings and tokens. The primary group sorts by elevation,
 * then sortLayer, then sort (PrimaryCanvasGroup._compareObjects); a container
 * in canvas.interface would draw over the token art, which is exactly the
 * wrong way round for a map. Same technique as initiative/token-overlay.mjs's
 * ground layer. Elevation is copied off the scene background so a v14 Level
 * whose base is not 0 still puts the map on its floor.
 */

import { SUITE_ID, featurePath, warn } from "../../core/const.mjs";
import { PALETTE, motionScale, onThemeChange } from "../../core/theme.mjs";
import { FEATURE_ID, FLAGS } from "./constants.mjs";
import { foundryAdapter, keysInRect } from "./hex-math.mjs";
import { partyCentres } from "./party.mjs";
import { terrainName } from "./labels.mjs";
import { HexStore } from "./store.mjs";
import { resolveIcon } from "./icons.mjs";

export { resolveIcon };

/** Trail length drawn from the move history (visited keys, oldest first). */
const TRAIL_KEYS = 40;

const loadTexture = (src) => (foundry?.canvas?.loadTexture ?? globalThis.loadTexture)(src);

/* ── Host ───────────────────────────────────────────────────────────────── */

class Host {
  constructor() {
    this.renderer = null;
    this.layer = null;
    this.store = null;
    this.adapter = null;
    this.keys = null;
    this.drawn = false;
    this._tick = null;
    this._onChange = null;
    this._unTheme = null;
    this._RendererClass = null;
  }

  get attached() { return !!this.renderer; }

  /** Build everything for the current canvas + store. Idempotent. */
  async attach(store) {
    if (!store || !canvas?.ready) return;
    if (this.store === store && this.renderer) return;
    this.detach();
    this.store = store;
    this.adapter = store.adapter;
    const rect = canvas.dimensions.sceneRect;
    this.keys = keysInRect(this.adapter, rect);

    try {
      if (!this._RendererClass) ({ HexRenderer: this._RendererClass } = await import("./render/renderer.mjs"));
    } catch (e) {
      warn("hexcrawl | renderer failed to load", e);
      return;
    }
    // The store may have moved on while the module loaded.
    if (this.store !== store || store !== HexStore.current) return;

    this._build();
    this._onChange = (_s, detail) => this.feed(detail);
    store.on("change", this._onChange);
    this._tick = () => { try { this.renderer?.update(canvas.app.ticker.deltaMS); } catch (e) { warn("hexcrawl | render tick failed", e); this._stopTick(); } };
    canvas.app.ticker.add(this._tick);
    this._unTheme = onThemeChange(() => this.rebuild());
  }

  _ensureLayer() {
    const primary = canvas?.primary;
    if (!primary) return null;
    if (this.layer && !this.layer.destroyed && this.layer.parent === primary) return this.layer;
    const layer = new PIXI.Container();
    layer.eventMode = "none";
    layer.interactiveChildren = false;
    const PCG = foundry.canvas?.groups?.PrimaryCanvasGroup ?? globalThis.PrimaryCanvasGroup;
    const tiles = PCG?.SORT_LAYERS?.TILES ?? 500;
    layer.elevation = primary.background?.elevation ?? 0;
    layer.sortLayer = tiles - 1;   // above the scene background, beneath tiles/drawings/tokens
    layer.sort = 0;
    layer.zIndex = tiles - 1;
    primary.addChild(layer);
    primary.sortDirty = true;
    this.layer = layer;
    return layer;
  }

  _build() {
    const layer = this._ensureLayer();
    if (!layer) return;
    this.renderer = new this._RendererClass({
      PIXI,
      adapter: this.adapter,
      keys: this.keys,
      loadTexture,
      resolveIcon,
      palette: PALETTE,
      terrainName: (id) => terrainName(this.store?.map, id),
      // "glhex:icons/x.webp" → the module's assets/hexcrawl/icons/x.webp
      assetRoot: featurePath(FEATURE_ID, "assets/x").slice(0, -1),
    });
    layer.addChild(this.renderer.root);
    this.renderer.setZoom(canvas.stage.scale.x);
    this.renderer.setMotionScale(motionScale());
    this.drawn = false;
    this.feed({ kind: "all" });
  }

  /** Theme change: rebuild the renderer so every cached colour is re-struck. */
  rebuild() {
    if (!this.renderer) return;
    this._destroyRenderer();
    this._build();
  }

  /** Push whatever a store change touched. */
  feed(detail = {}) {
    const r = this.renderer, store = this.store;
    if (!r || !store) return;
    const kind = detail.kind ?? "all";
    try {
      if (kind === "all" || kind === "view" || kind === "preview" || (kind === "scene" && detail.map)) {
        r.setMap(store.map, {
          asGM: !!game.user.isGM,
          viewAsPlayers: !!store.viewAsPlayers,
          animate: this.drawn && kind !== "view",
        });
        this.drawn = true;
      }
      if (kind === "all" || kind === "staged") r.setStaged(game.user.isGM ? new Set(store.staged) : new Set());
      if (kind === "all" || kind === "scene" || kind === "view") {
        this.refreshParty();
        this.refreshTrail();
      }
    } catch (e) {
      warn("hexcrawl | renderer feed failed", e);
    }
  }

  refreshParty() {
    if (!this.renderer || !this.store) return;
    const list = partyCentres(this.store.scene, this.adapter, this.store.map, { viewer: true });
    this.renderer.setParty(list.map(({ key, sight }) => ({ key, sight })));
  }

  refreshTrail() {
    if (!this.renderer || !this.store) return;
    const map = this.store.map;
    if (!map.config.trail) { this.renderer.setTrail([]); return; }
    const moves = this.store.scene.getFlag(SUITE_ID, FLAGS.moves);
    const out = [];
    for (const m of Array.isArray(moves) ? moves : []) {
      for (const k of Array.isArray(m?.trail) && m.trail.length ? m.trail : [m?.from, m?.to]) {
        if (typeof k === "string" && out[out.length - 1] !== k) out.push(k);
      }
    }
    this.renderer.setTrail(out.slice(-TRAIL_KEYS));
  }

  setHover(key) { try { this.renderer?.setHover(key ?? null); } catch { /* cosmetic */ } }

  setZoom(scale) { try { this.renderer?.setZoom(scale); } catch { /* cosmetic */ } }

  _stopTick() {
    if (this._tick) { try { canvas?.app?.ticker?.remove(this._tick); } catch { /* torn down */ } }
    this._tick = null;
  }

  _destroyRenderer() {
    try { this.renderer?.destroy(); } catch { /* canvasTearDown may have destroyed the parent already */ }
    this.renderer = null;
  }

  detach() {
    this._stopTick();
    this._unTheme?.();
    this._unTheme = null;
    if (this.store && this._onChange) this.store.off("change", this._onChange);
    this._onChange = null;
    this._destroyRenderer();
    try { if (this.layer && !this.layer.destroyed) this.layer.destroy({ children: true }); } catch { /* torn down with its group */ }
    this.layer = null;
    this.store = null;
    this.adapter = null;
    this.keys = null;
    this.drawn = false;
  }
}

export const host = new Host();

/** The adapter for the live canvas (Foundry's grid is the authority). */
export const canvasAdapter = () => foundryAdapter(canvas.grid, canvas.dimensions.sceneRect);
