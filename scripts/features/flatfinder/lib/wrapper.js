/**
 * libWrapper integration.
 *
 * Prefers the lib-wrapper module (https://github.com/ruipin/fvtt-lib-wrapper) when it
 * is installed and active, so this module plays nicely with every other module that
 * wraps the same methods. When lib-wrapper is absent, a small, guarded fallback patch
 * is used instead, exposing the same WRAPPER/MIXED/OVERRIDE semantics for the subset
 * of behaviour this module relies on (wrapping a named function on an object).
 */

import { MODULE_ID } from "../constants.js";

export const WRAPPER = "WRAPPER";
export const MIXED = "MIXED";
export const OVERRIDE = "OVERRIDE";

/** True when the genuine lib-wrapper module (not a shim/fallback) is available. */
export function hasLibWrapper() {
  return !!globalThis.libWrapper && globalThis.libWrapper.is_fallback !== true;
}

/** Resolve a dotted target path into the owning object and the property name. */
function resolveTarget(target) {
  const parts = target.split(".");
  const key = parts.pop();
  let obj = globalThis;
  for (const part of parts) obj = obj?.[part];
  if (!obj || !key) throw new Error(`libWrapper integration: cannot resolve target '${target}'.`);
  return { obj, key };
}

/** Minimal fallback used only when lib-wrapper is not installed. */
function fallbackRegister(target, fn, type) {
  const { obj, key } = resolveTarget(target);

  // Walk the prototype chain to find the existing descriptor (for inherited methods).
  let owner = obj;
  let descriptor;
  while (owner) {
    descriptor = Object.getOwnPropertyDescriptor(owner, key);
    if (descriptor) break;
    owner = Object.getPrototypeOf(owner);
  }

  const original = descriptor?.value ?? obj[key];
  if (typeof original !== "function") {
    throw new Error(`libWrapper integration: target '${target}' is not a function.`);
  }

  const wrapper =
    type === OVERRIDE
      ? function (...args) {
          return fn.call(this, ...args);
        }
      : function (...args) {
          return fn.call(this, original.bind(this), ...args);
        };

  Object.defineProperty(obj, key, {
    value: wrapper,
    configurable: true,
    writable: true,
    enumerable: descriptor?.enumerable ?? false,
  });
}

/**
 * Per-target handler registry. libWrapper (and our fallback) only allow ONE
 * registration per (package, target); flatfinder wraps `game.pf2e.Check.roll`
 * from both the Incapacitation and DC-flattening features, so we register a
 * single dispatcher per target and chain any additional handlers onto it.
 * target → { handlers: Function[], backend: "libwrapper"|"fallback" }
 */
const _wrapped = new Map();

/**
 * Register a wrapper around `target`. Multiple handlers may be registered for
 * the same target (from this one package); they run in registration order, each
 * receiving the next handler as its `wrapped` argument, ending in the genuine
 * original function — the same chaining libWrapper provides across packages.
 * Only WRAPPER/MIXED handlers (which receive `wrapped`) may share a target.
 * @param {string} target  Dotted path, e.g. "game.pf2e.Check.roll".
 * @param {Function} fn     Wrapper `(wrapped, ...args) => {}` (or `(...args)` for OVERRIDE).
 * @param {string} [type]   WRAPPER | MIXED | OVERRIDE.
 * @returns {"libwrapper"|"fallback"} which backend was used.
 */
export function registerWrapper(target, fn, type = MIXED) {
  const existing = _wrapped.get(target);
  if (existing) {
    // A dispatcher is already installed for this target — just add the handler.
    existing.handlers.push(fn);
    return existing.backend;
  }

  const handlers = [fn];
  // One dispatcher composes every handler registered for this target, in
  // registration order, ending in the genuine wrapped function.
  const dispatcher = function (wrapped, ...args) {
    const self = this;
    let next = wrapped;
    for (let i = handlers.length - 1; i >= 0; i--) {
      const handler = handlers[i];
      const inner = next;
      next = (...a) => handler.call(self, inner, ...a);
    }
    return next.call(self, ...args);
  };

  let backend;
  if (hasLibWrapper()) {
    libWrapper.register(MODULE_ID, target, dispatcher, type);
    backend = "libwrapper";
  } else {
    fallbackRegister(target, dispatcher, type);
    backend = "fallback";
  }
  _wrapped.set(target, { handlers, backend });
  return backend;
}
