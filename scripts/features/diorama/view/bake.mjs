/**
 * Diorama view — world-space light and vision bakes.
 *
 * Foundry's illumination and vision render textures are screen-space (they
 * follow the 2D camera), so they cannot be laid on the diorama. These bakes
 * redraw Foundry's OWN computed polygons into world-space canvases covering
 * the whole grid, at BAKE_PX_PER_CELL. The polygons already carry the height
 * occlusion (the sight backend), so the 2D canvas and the 3D view agree by
 * construction.
 *
 *   LIGHT   RGB = light added to the ambient: every active light source's
 *           polygon (`source.shape`), filled with a radial falloff of its
 *           colour, full to the bright radius, fading to 0 at the dim radius.
 *   VISION  R = visible now, G = explored. Visible = each vision source's
 *           range-limited polygon (`shape`), plus its unlimited line of sight
 *           (`los`) wherever that is lit. Explored = Foundry's own fog
 *           exploration texture, read back at bake resolution once a second.
 *           null for "everything visible" (the GM, or a scene without token
 *           vision).
 *   SOURCES the same lights as plain data (lightData): where each is, its
 *           radii, colour and Foundry animation, for the renderer's flicker,
 *           flames and torch shading (render/torches.mjs).
 *
 * "View as players" (GM) builds line of sight for every player-owned token
 * with sight through the installed sight backend, since a GM has no vision
 * sources for tokens it does not control. It has no explored fog (the GM's
 * exploration is not a player's), and it hands back a point test so the view
 * can hide tokens no player sees.
 */

import { BAKE_PX_PER_CELL, TIMING } from "../constants.mjs";

/** No bake side longer than this (px); big maps drop resolution instead. */
const MAX_SIDE = 4096;
/** The fog exploration changes slowly; read it back at most this often. */
const EXPLORED_EVERY = TIMING.bakeThrottle * 20;

const YELLOW = "rgb(255, 255, 0)"; // R = visible, G = explored (visible is explored)

/** Path a PIXI.Polygon-like `points` array into a 2D context. */
function tracePoly(ctx, poly) {
  const p = poly?.points;
  if (!p || p.length < 6) return false;
  ctx.moveTo(p[0], p[1]);
  for (let k = 2; k < p.length; k += 2) ctx.lineTo(p[k], p[k + 1]);
  ctx.closePath();
  return true;
}

function sourceList(coll) {
  if (!coll) return [];
  try { return Array.from(coll.values ? coll.values() : coll); } catch { return []; }
}

function rgbOf(src) {
  const a = src.colorRGB;
  if (Array.isArray(a) && a.length >= 3) return a;
  const c = src.data?.color;
  if (Number.isFinite(c)) return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
  return null;
}

/** Light colour and strength, 0..255 per channel. */
export function lightTint(data, rgb) {
  const alpha = Math.max(0, Math.min(1, Number(data?.alpha ?? 0.5)));
  const lum = Number(data?.luminosity ?? 0.5);
  const k = Math.max(0.3, Math.min(1, 0.5 + lum));
  const mixT = rgb ? Math.min(1, alpha * 2) : 0;
  const c = [0, 1, 2].map((i) => (1 - mixT) + mixT * (rgb ? rgb[i] : 1));
  return c.map((v) => Math.round(v * k * 255));
}

/**
 * One light source as plain data for the renderer (render/torches.mjs): what
 * flickers, burns and shades. Position and radii in px, elevation in scene
 * distance units, `tint` the colour and strength the bake drew it with (0..1),
 * `color` its own colour (null for an uncoloured light), `anim` its Foundry
 * animation, `token` whether a token carries it (no flame is drawn for one).
 * @returns {object|null}
 */
export function lightData(src) {
  const d = src?.data ?? {};
  const x = Number(d.x), y = Number(d.y);
  const dim = Math.max(Number(d.dim) || 0, Number(d.bright) || 0, Number(d.radius) || 0);
  if (!Number.isFinite(x) || !Number.isFinite(y) || dim <= 0) return null;
  const rgb = rgbOf(src);
  const hasColor = d.color !== null && d.color !== undefined && Number.isFinite(Number(d.color));
  const anim = d.animation ?? src?.animation ?? {};
  const doc = src?.object?.document;
  const token = doc?.documentName === "Token" || String(src?.sourceId ?? "").startsWith("Token.");
  return {
    id: String(src?.sourceId ?? `${x},${y}`),
    x, y, dim, bright: Math.max(0, Math.min(dim, Number(d.bright) || 0)),
    elevation: Number(d.elevation ?? doc?.elevation) || 0,
    tint: lightTint(d, rgb).map((v) => v / 255),
    color: hasColor && rgb ? rgb.slice(0, 3) : null,
    anim: { type: typeof anim.type === "string" && anim.type ? anim.type : null, speed: Number(anim.speed ?? 5), intensity: Number(anim.intensity ?? 5) },
    token,
  };
}

export class Baker {
  /**
   * @param {object} o
   * @param {{cols:number, rows:number, size:number}} o.grid
   * @param {() => ("own"|"players"|null)} o.mode   vision mode
   * @param {(result:{darkness:number, light:HTMLCanvasElement, vision:HTMLCanvasElement|null, sources:object[]}) => void} o.onBaked
   */
  constructor({ grid, mode, onBaked }) {
    this.mode = mode;
    this.onBaked = onBaked;
    this.timer = 0;
    this.again = false;
    this.disposed = false;
    this.explored = null;
    this.exploredAt = -Infinity;
    this.seen = null;
    this.light = document.createElement("canvas");
    this.vision = document.createElement("canvas");
    this.setGrid(grid);
  }

  setGrid(grid) {
    this.grid = grid;
    const ppc = Math.max(2, Math.min(BAKE_PX_PER_CELL, Math.floor(MAX_SIDE / Math.max(grid.cols, grid.rows, 1))));
    this.ppc = ppc;
    this.scale = ppc / (grid.size || 100);
    for (const c of [this.light, this.vision]) {
      c.width = Math.max(1, grid.cols * ppc);
      c.height = Math.max(1, grid.rows * ppc);
    }
    this.exploredAt = -Infinity;
  }

  /** Ask for a bake; coalesced over TIMING.bakeThrottle. */
  request() {
    if (this.disposed) return;
    if (this.timer) { this.again = true; return; }
    this.timer = setTimeout(() => {
      this.timer = 0;
      this.again = false;
      try { this.bake(); } catch (e) { console.error("GLUniverse Suite | diorama bake failed", e); }
      if (this.again) this.request();
    }, TIMING.bakeThrottle);
  }

  /** Bake now. */
  bake() {
    if (this.disposed) return;
    const env = globalThis.canvas?.environment;
    const globalLit = !!env?.globalLightSource?.active;
    const darkness = globalLit ? 0 : Math.max(0, Math.min(1, Number(env?.darknessLevel ?? globalThis.canvas?.darknessLevel ?? 0)));
    const lights = this.lightSources(env);
    this.drawLight(lights);
    const mode = this.mode();
    let vision = null;
    this.seen = null;
    if (mode === "own") { this.drawOwnVision(lights, globalLit); vision = this.vision; }
    else if (mode === "players") { this.drawPlayersVision(lights, globalLit); vision = this.vision; }
    const sources = [];
    for (const src of lights) { const s = lightData(src); if (s) sources.push(s); }
    this.onBaked({ darkness, light: this.light, vision, sources });
  }

  lightSources(env) {
    const out = [];
    for (const src of sourceList(globalThis.canvas?.effects?.lightSources)) {
      if (!src?.active || src === env?.globalLightSource || src.sourceId === "globalLight") continue;
      if (!src.shape?.points?.length) continue;
      out.push(src);
    }
    return out;
  }

  drawLight(lights) {
    const ctx = this.light.getContext("2d");
    const s = this.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.fillRect(0, 0, this.light.width, this.light.height);
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (const src of lights) {
      const d = src.data ?? {};
      const x = Number(d.x), y = Number(d.y);
      const dim = Math.max(Number(d.dim) || 0, Number(d.bright) || 0, Number(d.radius) || 0);
      if (!Number.isFinite(x) || !Number.isFinite(y) || dim <= 0) continue;
      const bright = Math.max(0, Math.min(dim, Number(d.bright) || 0));
      const [r, g, b] = lightTint(d, rgbOf(src));
      const grad = ctx.createRadialGradient(x, y, 0, x, y, dim);
      grad.addColorStop(0, `rgb(${r}, ${g}, ${b})`);
      grad.addColorStop(Math.max(0, Math.min(0.999, bright / dim)), `rgb(${r}, ${g}, ${b})`);
      grad.addColorStop(1, "rgb(0, 0, 0)");
      ctx.save();
      ctx.beginPath();
      if (!tracePoly(ctx, src.shape)) { ctx.restore(); continue; }
      ctx.clip();
      ctx.fillStyle = grad;
      ctx.fillRect(x - dim, y - dim, dim * 2, dim * 2);
      ctx.restore();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  beginVision() {
    const ctx = this.vision.getContext("2d");
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgb(0, 0, 0)";
    ctx.fillRect(0, 0, this.vision.width, this.vision.height);
    return ctx;
  }

  /** fov ∪ (los ∩ lit) for one viewer, in yellow, additive. */
  drawSight(ctx, { fov, los, lights, globalLit, blinded }) {
    const s = this.scale;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = YELLOW;
    if (fov) { ctx.beginPath(); if (tracePoly(ctx, fov)) ctx.fill(); }
    if (los && !blinded) {
      ctx.save();
      ctx.beginPath();
      if (tracePoly(ctx, los)) {
        ctx.clip();
        if (globalLit) ctx.fillRect(0, 0, this.vision.width / s, this.vision.height / s);
        else for (const l of lights) { ctx.beginPath(); if (tracePoly(ctx, l.shape)) ctx.fill(); }
      }
      ctx.restore();
    }
  }

  drawOwnVision(lights, globalLit) {
    const ctx = this.beginVision();
    const now = performance.now();
    if (now - this.exploredAt >= EXPLORED_EVERY) {
      this.exploredAt = now;
      try { this.explored = this.readExplored(); } catch (e) { console.warn("GLUniverse Suite | diorama: fog read failed", e); this.explored = null; }
    }
    if (this.explored) {
      ctx.globalCompositeOperation = "lighter";
      const e = this.explored;
      ctx.drawImage(e.canvas, e.x, e.y, e.w, e.h);
    }
    for (const src of sourceList(globalThis.canvas?.effects?.visionSources)) {
      if (!src?.active) continue;
      this.drawSight(ctx, { fov: src.shape ?? src.fov, los: src.los, lights, globalLit, blinded: !!src.isBlinded });
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
  }

  drawPlayersVision(lights, globalLit) {
    const ctx = this.beginVision();
    const viewers = playerSight();
    for (const v of viewers) this.drawSight(ctx, { ...v, lights, globalLit, blinded: false });
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    this.seen = (x, y) => viewers.some((v) => v.fov?.contains?.(x, y)
      || (v.los?.contains?.(x, y) && (globalLit || lights.some((l) => l.shape?.contains?.(x, y)))));
  }

  /**
   * Foundry's fog exploration (canvas.fog.sprite: a RED render texture over
   * the scene rect) drawn down to bake resolution on the GPU, swizzled red →
   * green, and read back. Small and throttled: a full-resolution read of the
   * exploration texture is tens of megabytes.
   */
  readExplored() {
    const fog = globalThis.canvas?.fog;
    const sprite = fog?.sprite;
    const tex = sprite?.texture;
    const renderer = globalThis.canvas?.app?.renderer;
    const PIXI = globalThis.PIXI;
    if (!tex || tex.valid === false || !renderer?.extract || !PIXI) return null;
    const s = this.scale;
    const w = Math.max(1, Math.round(sprite.width * s)), h = Math.max(1, Math.round(sprite.height * s));
    if (!this.rt || this.rt.width !== w || this.rt.height !== h) {
      this.rt?.destroy(true);
      this.rt = PIXI.RenderTexture.create({ width: w, height: h });
    }
    this.spr ??= new PIXI.Sprite();
    this.spr.texture = tex;
    this.spr.position.set(0, 0);
    this.spr.width = w;
    this.spr.height = h;
    const CMF = PIXI.ColorMatrixFilter ?? PIXI.filters?.ColorMatrixFilter;
    let swizzled = false;
    if (CMF) {
      this.swizzle ??= new CMF();
      this.swizzle.matrix = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];
      this.spr.filters = [this.swizzle];
      swizzled = true;
    }
    renderer.render(this.spr, { renderTexture: this.rt, clear: true });
    const c = renderer.extract.canvas(this.rt);
    if (!swizzled) {
      const cx = c.getContext("2d");
      const img = cx.getImageData(0, 0, c.width, c.height);
      const d = img.data;
      for (let k = 0; k < d.length; k += 4) { d[k + 1] = d[k]; d[k] = 0; d[k + 2] = 0; d[k + 3] = 255; }
      cx.putImageData(img, 0, 0);
    }
    return { canvas: c, x: sprite.x * s, y: sprite.y * s, w, h };
  }

  dispose() {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = 0;
    try { this.rt?.destroy(true); } catch { /* gone */ }
    try { this.spr?.destroy(); } catch { /* gone */ }
    this.rt = null;
    this.spr = null;
  }
}

/**
 * Line of sight for every player-owned token with sight, through the
 * installed sight backend (so it carries the height occlusion).
 * @returns {Array<{fov:object|null, los:object|null}>}
 */
function playerSight() {
  const out = [];
  const Backend = globalThis.CONFIG?.Canvas?.polygonBackends?.sight;
  const dpx = globalThis.canvas?.dimensions?.distancePixels ?? 1;
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
    const doc = token.document;
    if (!doc || doc.hidden || !token.actor?.hasPlayerOwner) continue;
    if (doc.sight?.enabled === false) continue;
    const c = token.center;
    if (!c) continue;
    let los = null;
    try {
      const origin = { x: c.x, y: c.y, elevation: Number(doc.elevation) || 0 };
      los = Backend?.create?.(origin, { type: "sight", source: token.vision ?? undefined }) ?? null;
    } catch {
      los = token.vision?.los ?? null;
    }
    if (!los) continue;
    const range = Number(doc.sight?.range) || 0;
    let fov = null;
    if (range > 0 && globalThis.PIXI?.Circle) {
      try {
        const circle = new PIXI.Circle(c.x, c.y, range * dpx);
        fov = los.intersectCircle ? los.intersectCircle(circle, { density: 48 }) : null;
      } catch { fov = null; }
    }
    out.push({ fov, los });
  }
  return out;
}
