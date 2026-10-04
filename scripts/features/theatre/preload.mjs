/**
 * Theatre — background preloading and the readiness gate.
 *
 * Every client preloads every shot of the viewed Theatre scene, so a cut almost
 * never waits on the network. When one does, the cue starts at
 * max(cue time, image ready) on that client: `whenReady` resolves when the
 * renderer's own loader (`host.load`, the cache the shot layer draws from) has
 * the texture, or after LOAD_TIMEOUT so a broken path can never hold a cue
 * forever. Before the layer is attached it falls back to Foundry's loader.
 */

import { warn } from "../../core/const.mjs";
import { LOAD_TIMEOUT } from "./constants.mjs";
import { host } from "./host.mjs";

/** src → Promise<boolean> (true = loaded). */
const _ready = new Map();

const loader = () => (host.attached
  ? (src) => host.load(src)
  : globalThis.foundry?.canvas?.loadTexture ?? globalThis.loadTexture ?? null);

function load(src) {
  if (!src) return Promise.resolve(false);
  let p = _ready.get(src);
  if (p) return p;
  const fn = loader();
  p = fn
    ? Promise.resolve().then(() => fn(src)).then((tex) => !!tex, (e) => { warn(`theatre | could not load ${src}`, e); return false; })
    : Promise.resolve(false);
  _ready.set(src, p);
  // A failure is not cached: the GM may fix the file and cut to it again.
  p.then((ok) => { if (!ok) _ready.delete(src); });
  return p;
}

/** Warm every src in the background (fire and forget). */
export function preloadAll(srcs) {
  const list = [...new Set((srcs ?? []).filter(Boolean))];
  if (!list.length) return;
  try { host.preload(list); } catch (e) { warn("theatre | host preload failed", e); }
  for (const src of list) load(src);
}

/** Resolves (never rejects) once `src` is ready or LOAD_TIMEOUT has passed. */
export function whenReady(src) {
  if (!src) return Promise.resolve(true);
  return Promise.race([
    load(src),
    new Promise((resolve) => setTimeout(() => resolve(false), LOAD_TIMEOUT)),
  ]);
}

export function clearPreloads() {
  _ready.clear();
}
