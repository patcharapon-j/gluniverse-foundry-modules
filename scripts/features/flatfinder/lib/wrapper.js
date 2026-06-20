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
 * Register a wrapper around `target`.
 * @param {string} target  Dotted path, e.g. "game.pf2e.Check.roll".
 * @param {Function} fn     Wrapper `(wrapped, ...args) => {}` (or `(...args)` for OVERRIDE).
 * @param {string} [type]   WRAPPER | MIXED | OVERRIDE.
 * @returns {"libwrapper"|"fallback"} which backend was used.
 */
export function registerWrapper(target, fn, type = MIXED) {
  if (hasLibWrapper()) {
    libWrapper.register(MODULE_ID, target, fn, type);
    return "libwrapper";
  }
  fallbackRegister(target, fn, type);
  return "fallback";
}
