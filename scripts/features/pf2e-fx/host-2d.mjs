/**
 * Spellsprite — the 2D canvas host. Paints the Director's sims onto Foundry's
 * canvas; it never steps them.
 *
 * One art buffer covers the visible part of the scene, its origin locked to
 * whole art pixels in world space, so a pixel never swims while the view pans.
 * Each frame the sims are painted top-down into three layers (core/pix.mjs),
 * copied to three small canvases (core/blit.mjs) and shown as nearest-sampled
 * PIXI sprites:
 *
 *   flat    decals, in canvas.primary just beneath the tokens (sort layer
 *           TOKENS - 1, initiative/token-overlay.mjs's slot), so a scorch is
 *           on the ground and under the creature standing in it
 *   light   the banded light pool: a tint on a bright floor, additive on a dark one
 *   stand   everything standing, in canvas.interface above the tokens
 *
 * Creatures react: a hit flashes the token, squashes it and knocks it back;
 * light falling on a creature tints it. The reaction moves Foundry's own token
 * mesh by a transient amount and gives it back exactly; a refresh in the middle
 * is detected and adopted as the new rest pose.
 *
 * Idle costs nothing: the ticker is removed and the sprites hidden while no
 * sim runs on this scene.
 */

import { Budget } from "../../core/budget.mjs";
import { Layers } from "./core/pix.mjs";
import { Blit } from "./core/blit.mjs";
import { topView, paintFrame } from "./core/frame.mjs";
import { S } from "./core/palette.mjs";
import { ART_PER_SQUARE } from "./constants.mjs";

const OVER_Z = 660;          // above Spellglass areas (650), under walls/controls
const MARGIN = 3;            // squares of buffer past the view edge (lifted shapes, knockback)
const MAX_ART = 2048;        // art pixels per side; past this the buffer follows the effects
const SIZE_STEP = 128;
const REACT = 0.7;           // seconds a hit reaction lasts
const MAX_LIT = 8;           // creatures tinted by effect light at once

const up = (n) => Math.ceil(n / SIZE_STEP) * SIZE_STEP;

function nearestTexture(source) {
  const tex = PIXI.Texture.from(source);
  const base = tex.baseTexture;
  base.scaleMode = PIXI.SCALE_MODES.NEAREST;
  base.mipmap = PIXI.MIPMAP_MODES?.OFF ?? 0;
  return tex;
}

function matrixFilter() {
  const F = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
  if (!F) return null;
  const f = new F();
  /* PIXI.Filter renders at resolution 1 unless told otherwise: on a HiDPI
     screen the token would go soft for exactly the frames it is lit. */
  f.resolution = canvas.app?.renderer?.resolution ?? globalThis.devicePixelRatio ?? 1;
  return f;
}

/** Paint a token's silhouette one flat colour. */
function solid(filter, [r, g, b]) {
  filter.matrix = [0, 0, 0, 0, r / 255, 0, 0, 0, 0, g / 255, 0, 0, 0, 0, b / 255, 0, 0, 0, 1, 0];
}

export class Host2D {
  /**
   * @param {import("./director.mjs").Director} director
   * @param {{ get: (key: string) => any }} opts  live options: floor, shake, impactFrames
   */
  constructor(director, opts) {
    this.director = director;
    this.opts = opts;
    this.L = null;
    this.B = new Blit();
    this.textures = { flat: null, stand: null, light: null };
    this.sprites = { flat: null, stand: null, light: null };
    this.ground = null;
    this.over = null;
    this.reactLayer = null;
    this.impact = null;
    this.reacting = new Map();   // tokenId → reaction state
    this.ticking = false;
    this.bright = false;
    this.shakeBase = null;
    this._tick = Budget.measure("pf2e-fx", this.tick.bind(this));
    this._off = null;
  }

  attach() {
    this.detach();
    if (!canvas?.ready || !globalThis.PIXI) return;
    const primary = canvas.primary;
    const PCG = foundry.canvas?.groups?.PrimaryCanvasGroup ?? globalThis.PrimaryCanvasGroup;
    const tokenSort = PCG?.SORT_LAYERS?.TOKENS ?? 700;

    this.ground = new PIXI.Container();
    this.ground.name = "gl-fx-ground";
    this.ground.eventMode = "none";
    this.ground.interactiveChildren = false;
    this.ground.elevation = 0;
    this.ground.sortLayer = tokenSort - 1;
    this.ground.sort = 1;
    this.ground.zIndex = tokenSort - 1;
    this.ground.visible = false;
    primary?.addChild(this.ground);
    if (primary) primary.sortDirty = true;

    this.over = new PIXI.Container();
    this.over.name = "gl-fx-over";
    this.over.eventMode = "none";
    this.over.interactiveChildren = false;
    this.over.zIndex = OVER_Z;
    this.over.visible = false;
    canvas.interface?.addChild(this.over);

    this.reactLayer = new PIXI.Container();
    this.impact = new PIXI.Graphics();
    this.impact.visible = false;
    for (const layer of ["flat", "light", "stand"]) {
      this.textures[layer] = nearestTexture(this.B[layer].canvas);
      const sprite = new PIXI.Sprite(this.textures[layer]);
      sprite.visible = false;
      this.sprites[layer] = sprite;
    }
    this.ground.addChild(this.sprites.flat);
    this.over.addChild(this.reactLayer, this.impact, this.sprites.light, this.sprites.stand);

    this.bright = this.guessBright();
    this.order();
    this._off = this.director.onChange(() => this.wake());
    this.wake();
  }

  detach() {
    this._off?.();
    this._off = null;
    this.sleep();
    this.releaseAll();
    for (const node of [this.ground, this.over]) {
      if (!node || node.destroyed) continue;
      node.parent?.removeChild(node);
      try { node.destroy({ children: true }); } catch { /* canvas teardown */ }
    }
    for (const layer of ["flat", "stand", "light"]) {
      try { this.textures[layer]?.destroy(true); } catch { /* already gone */ }
      this.textures[layer] = null;
      this.sprites[layer] = null;
    }
    this.B = new Blit();
    this.ground = this.over = this.reactLayer = this.impact = null;
  }

  /** Light draws under the standing shapes as a tint on a bright floor, over them additively on a dark one. */
  order() {
    const { light, stand } = this.sprites;
    if (!light || !stand) return;
    light.blendMode = this.bright ? PIXI.BLEND_MODES.NORMAL : PIXI.BLEND_MODES.ADD;
    const lightAbove = this.over.getChildIndex(light) > this.over.getChildIndex(stand);
    if (lightAbove === this.bright) this.over.swapChildren(light, stand);
  }

  /** The floor: the scene flag, else the client setting, else a guess from the scene's darkness. */
  guessBright() {
    const pick = (v) => (v === "bright" ? true : v === "dark" ? false : null);
    const flag = pick(canvas.scene?.getFlag?.("gluniverse-foundry-modules", "fx.floor"));
    if (flag != null) return flag;
    const opt = pick(this.opts.get("floor"));
    if (opt != null) return opt;
    const dark = canvas.environment?.darknessLevel ?? canvas.scene?.environment?.darknessLevel ?? 0;
    if (dark > 0.45) return false;
    return this.sampleBackground() ?? false;
  }

  /** Average luminance of the scene background, read once at 16×16. Null when it cannot be read. */
  sampleBackground() {
    const key = `${canvas.scene?.id}|${canvas.scene?.background?.src ?? ""}`;
    if (this._sample?.key === key) return this._sample.value;
    const value = this.readBackground();
    this._sample = { key, value };
    return value;
  }

  readBackground() {
    try {
      const tex = canvas.primary?.background?.texture;
      const renderer = canvas.app?.renderer;
      if (!tex?.valid || !renderer?.extract) return null;
      const sprite = new PIXI.Sprite(tex);
      sprite.width = 16; sprite.height = 16;
      const rt = PIXI.RenderTexture.create({ width: 16, height: 16 });
      renderer.render(sprite, { renderTexture: rt });
      const px = renderer.extract.pixels(rt);
      rt.destroy(true); sprite.destroy();
      let sum = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { if (!px[i + 3]) continue; sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; n++; }
      return n ? sum / n / 255 > 0.55 : null;
    } catch { return null; }
  }

  refreshFloor() {
    if (!this.over) return;
    this.bright = this.guessBright();
    this.order();
  }

  current() {
    return this.director.sims(canvas.scene?.id ?? null);
  }

  wake() {
    if (!this.over) return;
    const live = this.current().length > 0;
    if (live && !this.ticking) { canvas.app.ticker.add(this._tick); this.ticking = true; }
    if (!live) this.idle();
  }

  idle() {
    this.sleep();
    if (this.ground) this.ground.visible = false;
    if (this.over) this.over.visible = false;
    this.releaseAll();
    this.unshake();
  }

  sleep() {
    if (this.ticking) canvas?.app?.ticker?.remove(this._tick);
    this.ticking = false;
  }

  tick() {
    const list = this.current();
    if (!list.length) { this.idle(); return; }
    const sims = list.map((e) => e.sim);
    const g = canvas.dimensions?.size ?? canvas.grid?.size ?? 100;
    const aps = ART_PER_SQUARE;
    const box = this.artBox(sims, g, aps);
    if (!box) return;
    const w = box.x1 - box.x0, h = box.y1 - box.y0;
    if (!this.L) this.L = new Layers(up(w), up(h));
    else if (this.L.w < w || this.L.h < h) this.L.resize(up(Math.max(w, this.L.w)), up(Math.max(h, this.L.h)));
    const v = topView({ ox: -box.x0, oy: -box.y0, aps, key: "canvas" });
    paintFrame(sims, v, this.L, { bright: this.bright });
    this.B.update(this.L, this.bright);
    const k = g / aps;
    for (const layer of ["flat", "light", "stand"]) this.show(layer, box, k);
    this.ground.visible = true;
    this.over.visible = true;
    this.react(sims, g);
    this.drawImpact(sims);
    this.shake(sims);
  }

  /** The art-pixel box to paint: the view plus a margin, or the effects when the view is huge. */
  artBox(sims, g, aps) {
    const screen = canvas.app.renderer.screen;
    const tl = canvas.stage.toLocal({ x: 0, y: 0 });
    const br = canvas.stage.toLocal({ x: screen.width, y: screen.height });
    const toArt = (px) => (px / g) * aps;
    let x0 = Math.floor(toArt(tl.x)) - MARGIN * aps, y0 = Math.floor(toArt(tl.y)) - MARGIN * aps;
    let x1 = Math.ceil(toArt(br.x)) + MARGIN * aps, y1 = Math.ceil(toArt(br.y)) + MARGIN * aps;
    if (x1 - x0 > MAX_ART || y1 - y0 > MAX_ART) {
      let ax = Infinity, ay = Infinity, bx = -Infinity, by = -Infinity;
      for (const s of sims) {
        const o = s.offset ?? { x: 0, y: 0 };
        for (const p of [s.spec.caster, ...(s.spec.targets ?? []), s.spec.area].filter(Boolean)) {
          ax = Math.min(ax, p.x + o.x); ay = Math.min(ay, p.y + o.y); bx = Math.max(bx, p.x + o.x); by = Math.max(by, p.y + o.y);
        }
      }
      if (!Number.isFinite(ax)) return null;
      const cx = ((ax + bx) / 2) * aps, cy = ((ay + by) / 2) * aps, half = MAX_ART / 2;
      x0 = Math.floor(cx - half); y0 = Math.floor(cy - half); x1 = x0 + MAX_ART; y1 = y0 + MAX_ART;
    }
    return { x0, y0, x1, y1 };
  }

  show(layer, box, k) {
    const c = this.B[layer], sprite = this.sprites[layer], tex = this.textures[layer];
    if (c.empty) { sprite.visible = false; return; }
    const base = tex.baseTexture;
    /* A canvas resource re-reads the canvas size on update (the layer canvas
       resizes in 32 px buckets); BaseTexture#update alone keeps the old size.
       The texture re-checks its current frame against the new size, so a
       canvas that SHRANK would reject last frame's rectangle: park the frame
       on one pixel first. */
    if (base.width !== c.canvas.width || base.height !== c.canvas.height) tex.frame = new PIXI.Rectangle(0, 0, 1, 1);
    if (base.resource?.update) base.resource.update();
    else base.update();
    tex.frame = new PIXI.Rectangle(0, 0, Math.min(c.w, c.canvas.width), Math.min(c.h, c.canvas.height));
    sprite.visible = true;
    sprite.position.set((box.x0 + c.x) * k, (box.y0 + c.y) * k);
    sprite.scale.set(k, k);
  }

  /* ── creatures ─────────────────────────────────────────────────────── */

  /** The strongest current reaction per creature across every sim. */
  reactions(sims, g) {
    const out = new Map();
    for (const s of sims) {
      for (const [id, hit] of Object.entries(s.hits)) {
        const d = s.t - hit.at;
        if (d < 0 || d >= REACT) continue;
        const prev = out.get(id);
        if (!prev || hit.k > prev.hit.k) out.set(id, { hit, d, s });
      }
    }
    const lit = new Map();
    if (!sims.some((s) => s.shed.has("tokenLight"))) {
      for (const token of canvas.tokens?.placeables ?? []) {
        if (!token.visible || lit.size >= MAX_LIT) continue;
        const c = token.center, x = c.x / g, y = c.y / g;
        let best = null;
        for (const s of sims) { const l = s.lightAt(x, y); if (l && (!best || l.k > best.k)) best = l; }
        if (best) lit.set(token.id, best);
      }
    }
    return { hits: out, lit };
  }

  react(sims, g) {
    const { hits, lit } = this.reactions(sims, g);
    const ids = new Set([...hits.keys(), ...lit.keys()]);
    for (const id of [...this.reacting.keys()]) if (!ids.has(id)) this.release(id);
    for (const id of ids) {
      const token = canvas.tokens?.get(id);
      const mesh = token?.mesh;
      if (!mesh || mesh.destroyed || !token.visible) { this.release(id); continue; }
      const st = this.reacting.get(id) ?? this.adopt(id, mesh);
      this.restOf(st, mesh);
      let kx = 0, ky = 0, sqz = 1, flash = null;
      const h = hits.get(id);
      if (h) {
        const { hit, d } = h, c = token.center;
        const fx = c.x / g - (hit.from?.x ?? c.x / g), fy = c.y / g - (hit.from?.y ?? c.y / g), fl = Math.hypot(fx, fy) || 1;
        const kb = 0.12 * Math.min(1.5, hit.k) * Math.exp(-d * 9);
        kx = (fx / fl) * kb * g; ky = (fy / fl) * kb * g;
        sqz = 1 - 0.2 * Math.min(1.4, hit.k) * Math.exp(-d * 10) * Math.cos(d * 32);
        const fr = Math.floor(d * 12);
        if (fr < 4) flash = fr === 0 ? { c: [255, 255, 255], a: 0.85 } : { c: S(hit.R, 0.9), a: 0.6 * (1 - fr / 4) };
      }
      const sx = 1 + (1 - sqz) * 0.6, sy = sqz;
      st.applied = { x: st.rest.x + kx, y: st.rest.y + ky, sx: st.rest.sx * sx, sy: st.rest.sy * sy };
      mesh.position.set(st.applied.x, st.applied.y);
      mesh.scale.set(st.applied.sx, st.applied.sy);
      this.overlay(st, mesh, "flash", flash ? flash.c : null, flash?.a ?? 0, PIXI.BLEND_MODES.NORMAL);
      const L = lit.get(id);
      this.overlay(st, mesh, "light", L ? L.c : null, L ? L.k * (this.bright ? 0.1 : 0.16) : 0,
        this.bright ? PIXI.BLEND_MODES.NORMAL : PIXI.BLEND_MODES.ADD);
    }
  }

  adopt(id, mesh) {
    const rest = { x: mesh.position.x, y: mesh.position.y, sx: mesh.scale.x, sy: mesh.scale.y };
    const st = { id, mesh, rest, applied: { ...rest }, sprites: {} };
    this.reacting.set(id, st);
    return st;
  }

  /** Foundry redrew the token since our last frame: what it set is the new rest pose. */
  restOf(st, mesh) {
    const a = st.applied, eq = (u, v) => Math.abs(u - v) < 1e-6;
    if (!(eq(mesh.position.x, a.x) && eq(mesh.position.y, a.y) && eq(mesh.scale.x, a.sx) && eq(mesh.scale.y, a.sy))) {
      st.rest = { x: mesh.position.x, y: mesh.position.y, sx: mesh.scale.x, sy: mesh.scale.y };
    }
    if (st.mesh !== mesh) { this.dropSprites(st); st.mesh = mesh; }
  }

  overlay(st, mesh, name, color, alpha, blend) {
    let sp = st.sprites[name];
    if (!color || alpha <= 0.01) { if (sp) sp.visible = false; return; }
    if (!sp) {
      const filter = matrixFilter();
      if (!filter) return;
      sp = new PIXI.Sprite(mesh.texture);
      sp.filters = [filter];
      sp._filter = filter;
      st.sprites[name] = sp;
      this.reactLayer.addChild(sp);
    }
    if (sp.texture !== mesh.texture) sp.texture = mesh.texture;
    solid(sp._filter, color);
    sp.blendMode = blend;
    sp._filter.blendMode = blend;
    sp.alpha = alpha;
    sp.visible = true;
    sp.anchor.set(mesh.anchor?.x ?? 0.5, mesh.anchor?.y ?? 0.5);
    /* The mesh lives in canvas.primary, this sprite in canvas.interface: both
       share the stage's world space. */
    const gp = mesh.parent?.toGlobal?.(mesh.position);
    const lp = gp ? this.reactLayer.toLocal(gp) : mesh.position;
    sp.position.set(lp.x, lp.y);
    sp.scale.set(mesh.scale.x, mesh.scale.y);
    sp.rotation = mesh.rotation ?? 0;
  }

  dropSprites(st) {
    for (const sp of Object.values(st.sprites)) { try { sp.destroy(); } catch { /* gone */ } }
    st.sprites = {};
  }

  release(id) {
    const st = this.reacting.get(id);
    if (!st) return;
    const mesh = st.mesh;
    if (mesh && !mesh.destroyed) {
      const a = st.applied, eq = (u, v) => Math.abs(u - v) < 1e-6;
      /* Give the pose back only if it is still ours. */
      if (eq(mesh.position.x, a.x) && eq(mesh.position.y, a.y)) mesh.position.set(st.rest.x, st.rest.y);
      if (eq(mesh.scale.x, a.sx) && eq(mesh.scale.y, a.sy)) mesh.scale.set(st.rest.sx, st.rest.sy);
    }
    this.dropSprites(st);
    this.reacting.delete(id);
  }

  releaseAll() {
    for (const id of [...this.reacting.keys()]) this.release(id);
  }

  /* ── the frame itself ──────────────────────────────────────────────── */

  /** A crit's two impact frames: a dark then a pale veil over the table, under the effect. */
  drawImpact(sims) {
    const imp = this.opts.get("impactFrames") ? sims.find((s) => s.impact > 0) : null;
    if (!imp) { this.impact.visible = false; return; }
    const first = imp.impact > 1 / 12;
    const r = canvas.dimensions.rect;
    this.impact.clear();
    this.impact.beginFill(first ? 0x000000 : 0xffffff, first ? 0.55 : 0.35);
    this.impact.drawRect(r.x, r.y, r.width, r.height);
    this.impact.endFill();
    this.impact.visible = true;
  }

  /** Shake the view by whole screen pixels. The stage's rest position is adopted every frame. */
  shake(sims) {
    const amp = this.opts.get("shake") ? Math.max(0, ...sims.map((s) => (s.shake > 0.3 && !s.shed.has("shake") ? s.shake : 0))) : 0;
    const stage = canvas.stage;
    if (!amp) { this.unshake(); return; }
    const now = performance.now();
    const ox = Math.round(Math.sin(now * 0.09) * amp), oy = Math.round(Math.cos(now * 0.071) * amp * 0.6);
    if (!this.shakeBase || stage.position.x !== this.shakeBase.ax || stage.position.y !== this.shakeBase.ay) {
      this.shakeBase = { x: stage.position.x, y: stage.position.y };
    }
    const ax = this.shakeBase.x + ox, ay = this.shakeBase.y + oy;
    stage.position.set(ax, ay);
    this.shakeBase.ax = ax; this.shakeBase.ay = ay;
  }

  unshake() {
    const b = this.shakeBase;
    this.shakeBase = null;
    const stage = canvas?.stage;
    if (!b || !stage) return;
    if (stage.position.x === b.ax && stage.position.y === b.ay) stage.position.set(b.x, b.y);
  }
}
