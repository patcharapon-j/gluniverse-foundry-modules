/**
 * Performance — the core-patch registry.
 *
 * Every wrap of a Foundry method this feature makes goes through here, and each
 * one has to earn its place three times before it installs:
 *
 *   1. GENERATION. The patch was written against the Foundry generations in
 *      VERIFIED_GENERATIONS. On any other it stays off and says so — a wrap
 *      written for v14's `render` guessing at v15's is how a performance module
 *      breaks every sheet in a world the day core updates.
 *   2. INTEGRITY. Each patch names a fragment of the pristine method's source
 *      (`signature`). If the function at the target no longer contains it, then
 *      either core changed the method or another module already replaced it —
 *      and in both cases the patch's premise is gone. It stays off, with the
 *      reason "conflict". This is the check that catches a second performance
 *      module "fixing" the same hot path, with or without libWrapper.
 *   3. SWITCHES. A world switch (the GM's one-click kill for the whole table)
 *      and a client switch. Both are read on every call, so turning a patch off
 *      takes effect live; turning one on that never installed installs it then.
 *
 * libWrapper, when present, additionally reports conflicts it detects at call
 * time; a patch it names is deactivated on the spot.
 *
 * A wrapper that is "off" still sits in the chain and calls straight through —
 * the suite's wrapper layer has no unregister, and a pass-through costs one
 * boolean read. What it never does is run its own logic while off.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { registerWrapper, MIXED } from "../../core/wrapper.mjs";
import { PATCHES, VERIFIED_GENERATIONS } from "./constants.mjs";

/** @typedef {"active"|"off"|"version"|"conflict"|"missing"|"error"|"idle"} PatchState */

/**
 * @typedef {object} PatchDef
 * @property {string} id           one of PATCHES
 * @property {string} target       dotted path from globalThis
 * @property {string} signature    a fragment the pristine method's source contains
 * @property {string} [type]       WRAPPER | MIXED | OVERRIDE (default MIXED)
 * @property {Function} handler    (wrapped, ...args) => any, `this` = instance
 * @property {string[]} [overlaps] module ids whose presence switches this off
 */

/** id → { def, state, reason, installed } */
const _patches = new Map();
let _isOn = () => true;

function resolveFn(target) {
  const parts = target.split(".");
  let obj = globalThis;
  for (const part of parts) {
    obj = obj?.[part];
    if (obj == null) return null;
  }
  return typeof obj === "function" ? obj : null;
}

function currentGeneration() {
  return Number(globalThis.game?.release?.generation ?? 0);
}

function evaluate(entry) {
  const { def } = entry;
  if (!VERIFIED_GENERATIONS.includes(currentGeneration())) {
    return ["version", `Foundry generation ${currentGeneration()} is not one this patch was written for (${VERIFIED_GENERATIONS.join(", ")}).`];
  }
  const overlap = (def.overlaps ?? []).find((id) => globalThis.game?.modules?.get(id)?.active);
  if (overlap) return ["conflict", `"${overlap}" is active and covers the same ground.`];
  const fn = resolveFn(def.target);
  if (!fn) return ["missing", `${def.target} does not exist.`];
  let src = "";
  try { src = Function.prototype.toString.call(fn); } catch { src = ""; }
  if (!src.includes(def.signature)) {
    return ["conflict", `${def.target} is not the method this patch was written against (core changed it, or another module replaced it).`];
  }
  return ["ok", null];
}

function install(entry) {
  const [verdict, reason] = evaluate(entry);
  if (verdict !== "ok") {
    entry.state = verdict;
    entry.reason = reason;
    return false;
  }
  const { def } = entry;
  try {
    registerWrapper(def.target, function (wrapped, ...args) {
      if (entry.state !== "active" || !_isOn(def.id)) return wrapped(...args);
      return def.handler.call(this, wrapped, ...args);
    }, def.type ?? MIXED);
    entry.installed = true;
    entry.state = "active";
    entry.reason = null;
    return true;
  } catch (e) {
    entry.state = "error";
    entry.reason = String(e?.message ?? e);
    warn(`perf | patch "${def.id}" could not install`, e);
    return false;
  }
}

export const Patches = {
  /** Tell the registry how to read the switches (Perf.patchOn). */
  configure({ isOn }) {
    if (typeof isOn === "function") _isOn = isOn;
  },

  /** @param {PatchDef} def */
  define(def) {
    if (!PATCHES.some((p) => p.id === def.id && p.core)) throw new Error(`perf | "${def.id}" is not a core patch in PATCHES.`);
    if (_patches.has(def.id)) return;
    _patches.set(def.id, { def, state: "idle", reason: null, installed: false });
  },

  /** Install every defined patch whose switches are on. */
  installAll() {
    for (const entry of _patches.values()) {
      if (entry.installed || !_isOn(entry.def.id)) continue;
      install(entry);
    }
    Hooks.on("libWrapper.ConflictDetected", (pkg, other, target) => {
      if (pkg !== SUITE_ID && other !== SUITE_ID) return;
      for (const entry of _patches.values()) {
        if (entry.def.target !== target || entry.state !== "active") continue;
        entry.state = "conflict";
        entry.reason = `libWrapper reports a conflict with "${pkg === SUITE_ID ? other : pkg}".`;
        warn(`perf | patch "${entry.def.id}" switched itself off: ${entry.reason}`);
      }
    });
  },

  /** A switch changed: install lazily if it is now on and never installed. */
  refresh(id) {
    const entry = _patches.get(id);
    if (!entry || entry.installed || !_isOn(id)) return;
    install(entry);
  },

  /** Whether a patch's own logic is running right now. */
  active(id) {
    const entry = _patches.get(id);
    return !!entry && entry.state === "active" && _isOn(id);
  },

  /**
   * One row per intervention, core or not, for the overlay and reports.
   * @returns {{ id: string, core: boolean, state: PatchState, reason: string|null }[]}
   */
  status() {
    return PATCHES.map(({ id, core }) => {
      if (!core) return { id, core, state: _isOn(id) ? "active" : "off", reason: null };
      const entry = _patches.get(id);
      if (!entry) return { id, core, state: "idle", reason: null };
      if (entry.state === "active" && !_isOn(id)) return { id, core, state: "off", reason: null };
      if (!entry.installed && entry.state === "idle") return { id, core, state: _isOn(id) ? "idle" : "off", reason: null };
      return { id, core, state: entry.state, reason: entry.reason };
    });
  },

  /** Test seam. */
  _evaluate(def) {
    return evaluate({ def });
  },
};
