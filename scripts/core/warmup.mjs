/**
 * GLUniverse Suite — idle-time shader warm-up.
 *
 * A GL program is not ready when it is created: PIXI compiles and links it on
 * its first bind, and most drivers specialise it again on its first draw. Left
 * alone, that cost lands on the frame where an effect first appears, which is
 * the hitch a table sees the first time a template is placed or a critical
 * lands. A feature hands its warm-up here from `onReady`, and the queue runs one
 * task per idle slice once the canvas exists, so a disabled feature warms
 * nothing and no task lengthens world load.
 *
 * PIXI caches a Program by its source and keeps the compiled GLProgram per
 * renderer, so drawing a throwaway copy once into a tiny RenderTexture is all
 * the real effect needs to start warm.
 *
 * A batch of two or more tasks shows Foundry's own progress notification, so a
 * brief hitch while effects prepare reads as loading rather than lag. A lone
 * late task (a Theatre scene attaching) runs without one.
 *
 * Importable under Node: nothing touches `Hooks`, `canvas` or `PIXI` until a
 * task is queued.
 */

import { warn } from "./const.mjs";

const _queue = [];
let _running = false;
let _hooked = false;
let _bar = null;
let _done = 0;
let _total = 0;

const idle = (fn) => (typeof requestIdleCallback === "function"
  ? requestIdleCallback(fn, { timeout: 4000 })
  : setTimeout(fn, 200));

function canvasUp() {
  return !!globalThis.canvas?.ready && !!globalThis.canvas?.app?.renderer;
}

function progress() {
  if (!_bar || typeof game === "undefined") return;
  _bar.update({ pct: _done / _total, message: game.i18n.format("GLS.warmup.progress", { done: _done, total: _total }) });
  if (_done >= _total) { _bar = null; _done = 0; _total = 0; }
}

async function pump() {
  if (!_queue.length) { _running = false; _done = 0; _total = 0; return; }
  if (!canvasUp()) {
    _running = false;
    if (!_hooked && typeof Hooks !== "undefined") {
      _hooked = true;
      Hooks.once("canvasReady", () => { _hooked = false; start(); });
    }
    return;
  }
  if (!_bar && _total - _done >= 2 && globalThis.ui?.notifications) {
    _bar = ui.notifications.info(game.i18n.format("GLS.warmup.progress", { done: _done, total: _total }), { progress: true, console: false });
  }
  const { id, fn } = _queue.shift();
  try {
    await fn();
  } catch (e) {
    warn(`warm-up: ${id} failed, it compiles on first use`, e);
  }
  _done++;
  progress();
  idle(pump);
}

function start() {
  if (_running) return;
  _running = true;
  idle(pump);
}

/**
 * Queue `fn` to run at idle once the canvas is ready. Best effort: a task that
 * throws is logged and the effect compiles on first use as before.
 * @param {string} id
 * @param {() => (void|Promise<void>)} fn
 */
export function warmAtIdle(id, fn) {
  _queue.push({ id, fn });
  _total++;
  start();
}

/**
 * Draw each display object once into a 4×4 RenderTexture on `renderer`, then
 * destroy it. Pass a PIXI.Mesh for a shader, or a PIXI.Sprite carrying
 * `filters` for a filter. Defaults to Foundry's canvas renderer.
 * @param {PIXI.DisplayObject[]} objects
 * @param {PIXI.Renderer} [renderer]
 */
export function warmPixi(objects, renderer = globalThis.canvas?.app?.renderer) {
  if (!renderer) return;
  const rt = PIXI.RenderTexture.create({ width: 4, height: 4 });
  try {
    for (const o of objects) {
      if (!o) continue;
      try { renderer.render(o, { renderTexture: rt, clear: true }); }
      finally { o.destroy?.(); }
    }
    renderer.gl?.finish?.();
  } finally {
    rt.destroy(true);
  }
}

/** A 4×4 white sprite carrying `filters`, for `warmPixi`. */
export function filterProbe(...filters) {
  const s = new PIXI.Sprite(PIXI.Texture.WHITE);
  s.width = 4; s.height = 4;
  s.filters = filters.filter(Boolean);
  return s;
}
