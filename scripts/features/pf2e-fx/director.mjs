/**
 * Spellsprite — the Director: owns every running effect and steps it.
 *
 * One clock for every host. The 2D host and the Diorama mirror only PAINT the
 * sims the Director holds, so an effect looks the same in both views and is
 * never stepped twice. The Director runs its own animation-frame loop while
 * anything is running and stops when nothing is, so an idle table costs
 * nothing.
 *
 *   play(spec, { sceneId, delay })      one-shot effect, returns its key
 *   startLoop(key, spec, { sceneId })   a condition loop, idempotent by key
 *   stopLoop(key)                       the loop fades out and is dropped
 *   sims(sceneId)                       [{ key, sim, sceneId }]
 *   onChange(fn)                        the running set changed
 *
 * A loop's sim is compiled where its creature stood; while it runs the
 * Director sets `sim.offset` from `locate()` so every host draws it where the
 * creature is now (core/frame.mjs `viewFor`).
 *
 * No `game` here: the clock, the frame source and the hook are injected, so
 * the check tool drives the real Director under Node.
 */

import { compile } from "./compile.mjs";
import { SHED_ORDER, TIMING } from "./constants.mjs";

const DEFAULT_MAX = 12;

export class Director {
  /**
   * @param {object} [o]
   * @param {() => number} [o.now]           seconds
   * @param {(fn: FrameRequestCallback) => number} [o.raf]
   * @param {(id: number) => void} [o.caf]
   * @param {{ allows(name: string): boolean } | null} [o.ladder]   the Budget ladder
   * @param {(on: boolean) => void} [o.claim]     Budget.claimMotion for this feature
   * @param {(running: object[]) => void} [o.announce]   e.g. Hooks.callAll
   * @param {(fn: Function) => Function} [o.measure]     Budget.measure
   */
  constructor({ now, raf, caf, ladder = null, claim = () => {}, announce = () => {}, measure = (fn) => fn, locate = null } = {}) {
    /** (tokenId, sceneId) → {x, y} in squares, where a creature stands now. */
    this.locate = locate;
    this.now = now ?? (() => (globalThis.performance?.now?.() ?? Date.now()) / 1000);
    this.raf = raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
    this.caf = caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
    this.ladder = ladder;
    this.claim = claim;
    this.announce = announce;
    /** key → { key, sim, sceneId, loop, startAt } */
    this.running = new Map();
    this.listeners = new Set();
    this.maxConcurrent = DEFAULT_MAX;
    this.paused = false;
    this._seq = 0;
    this._raf = 0;
    this._last = 0;
    this._acc = 0;
    this._frame = measure(this.frame.bind(this));
  }

  /** Compile and start a one-shot effect. Returns its key, or null when nothing plays. */
  play(spec, { sceneId = null, delay = 0, key = null } = {}) {
    if (!spec) return null;
    const sim = this.build(spec);
    if (!sim) return null;
    const k = key ?? `${spec.id ?? "fx"}#${++this._seq}`;
    this.running.get(k)?.sim.stop();
    this.running.set(k, { key: k, sim, sceneId, loop: false, startAt: this.now() + Math.max(0, delay) });
    this.trim();
    this.changed();
    this.wake();
    return k;
  }

  /** Start (or keep) a loop. Re-starting a loop that is fading out replaces it. */
  startLoop(key, spec, { sceneId = null } = {}) {
    const cur = this.running.get(key);
    if (cur && cur.loop && !cur.sim.stopped && cur.sig === signature(spec)) return key;
    if (cur) cur.sim.stop();
    const sim = this.build(spec);
    if (!sim) return null;
    this.running.set(key, { key, sim, sceneId, loop: true, startAt: this.now(), sig: signature(spec) });
    this.changed();
    this.wake();
    return key;
  }

  stopLoop(key) {
    const cur = this.running.get(key);
    if (!cur) return false;
    cur.sim.stop();
    this.wake();
    return true;
  }

  /** Stop every loop whose key starts with `prefix` (an actor's conditions). */
  stopLoops(prefix) {
    for (const [key, entry] of this.running) if (entry.loop && key.startsWith(prefix)) entry.sim.stop();
    this.wake();
  }

  /** Drop everything at once (canvas teardown, feature off). */
  clear() {
    if (!this.running.size) return;
    this.running.clear();
    this.changed();
    this.sleep();
  }

  /** The sims a host should paint. Waiting (delayed) effects are not listed. */
  sims(sceneId = null) {
    const out = [];
    const now = this.now();
    for (const e of this.running.values()) {
      if (e.startAt > now) continue;
      if (sceneId != null && e.sceneId != null && e.sceneId !== sceneId) continue;
      out.push({ key: e.key, sim: e.sim, sceneId: e.sceneId });
    }
    return out;
  }

  onChange(fn) {
    if (typeof fn !== "function") return () => {};
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  build(spec) {
    try { return compile(spec); }
    catch (e) { console.warn("Spellsprite | could not compile an effect", e, spec); return null; }
  }

  /** Over the cap, the oldest one-shots go first; loops are kept. */
  trim() {
    let max = this.maxConcurrent;
    if (this.ladder && !this.ladder.allows("concurrency")) max = Math.max(2, Math.floor(max / 2));
    const shots = [...this.running.values()].filter((e) => !e.loop);
    const over = this.running.size - max;
    for (let i = 0; i < over && i < shots.length; i++) this.running.delete(shots[i].key);
  }

  changed() {
    const list = this.sims();
    for (const fn of this.listeners) { try { fn(list); } catch (e) { console.warn("Spellsprite |", e); } }
    try { this.announce(list); } catch { /* a listener threw */ }
  }

  wake() {
    if (this._raf || this.paused || !this.running.size) return;
    this._last = 0;
    this.claim(true);
    this._raf = this.raf(this._frame) || 0;
    if (!this._raf) this._raf = -1; // no frame source (Node): step() is driven by hand
  }

  sleep() {
    if (this._raf > 0) this.caf(this._raf);
    this._raf = 0;
    this._last = 0;
    this._acc = 0;
    this.claim(false);
  }

  frame(ms) {
    this._raf = 0;
    const t = Number.isFinite(ms) ? ms / 1000 : this.now();
    const dt = this._last ? Math.min(TIMING.maxDt, Math.max(0, t - this._last)) : 0;
    this._last = t;
    this.advance(dt);
    if (this.running.size && !this.paused) this._raf = this.raf(this._frame) || 0;
    else this.sleep();
  }

  /** Step every started sim by `dt` seconds at the fixed rate. Public for tools. */
  advance(dt) {
    this._acc += dt;
    const steps = Math.min(12, Math.floor(this._acc / TIMING.step));
    this._acc -= steps * TIMING.step;
    if (this._acc > TIMING.step) this._acc = 0;
    const shed = this.shedSet();
    const now = this.now();
    let removed = false, started = false;
    for (const [key, e] of this.running) {
      if (e.startAt > now) continue;
      if (!e.begun) { e.begun = true; started = true; }
      if (e.startAt + TIMING.stale < now && !e.loop && e.sim.t === 0) { this.running.delete(key); removed = true; continue; }
      e.sim.shed = shed;
      if (e.loop) this.carry(e);
      for (let i = 0; i < steps; i++) e.sim.step(TIMING.step);
      if (e.sim.done) { this.running.delete(key); removed = true; }
    }
    if (removed || started) this.changed();
  }

  /** A loop follows its creature: the sim is drawn offset by how far the token moved. */
  carry(e) {
    const T = e.sim.spec?.targets?.[0];
    if (!T?.id || typeof this.locate !== "function") return;
    let at = null;
    try { at = this.locate(T.id, e.sceneId); } catch { at = null; }
    if (!at) return;
    const dx = at.x - T.x, dy = at.y - T.y;
    e.sim.offset = Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4 ? { x: dx, y: dy } : null;
  }

  shedSet() {
    const set = new Set();
    if (this.ladder) for (const name of SHED_ORDER) if (!this.ladder.allows(name)) set.add(name);
    return set;
  }
}

/** Two loop specs that would draw the same thing. */
function signature(spec) {
  if (!spec) return "";
  return JSON.stringify([spec.material, spec.condition?.slug, spec.condition?.value, spec.look, spec.targets?.[0]?.id]);
}
