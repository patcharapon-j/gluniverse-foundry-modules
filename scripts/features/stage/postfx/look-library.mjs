/**
 * Stage character grade — the look library.
 *
 * Turns a look id into the LUT strip the shader samples, caching the result.
 *
 *   builtin:<slug>  a recipe shipped in lut.mjs, baked on first use
 *   custom:<slug>   a `.cube` file a GM imported, stored in the world's own
 *                   folder and listed in the `stage.lookLibrary` world setting
 *
 * Deliberately free of `game`: the custom entries and the file fetch are
 * handed in, so the check tool can drive the whole thing under plain Node.
 * Every failure resolves to null — a look that cannot be loaded is drawn at
 * opacity 0, never as an error on a player's screen.
 */

import { BUILTIN_LOOKS, bakeRecipe, parseCube, resampleLut, lutToStrip, sampleStrip } from "./lut.mjs";

/**
 * Coerce a stored custom-look entry. `rev` changes whenever the file behind the
 * id is replaced, so a cached strip is never reused for different contents.
 */
export function normalizeCustomLook(raw) {
  const id = typeof raw?.id === "string" ? raw.id : "";
  if (!/^custom:[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return null;
  const path = typeof raw?.path === "string" ? raw.path.trim() : "";
  if (!path) return null;
  const name = typeof raw?.name === "string" && raw.name.trim() ? raw.name.trim().slice(0, 80) : id.slice(7);
  const rev = Number.isFinite(Number(raw?.rev)) ? Number(raw.rev) : 0;
  return { id, name, path, rev };
}

/** A slug for a new custom look, from its name, unique against `taken`. */
export function customLookId(name, taken = []) {
  const base = String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "look";
  const used = new Set(taken);
  let id = `custom:${base}`;
  for (let n = 2; used.has(id); n++) id = `custom:${base}-${n}`;
  return id;
}

/** Wrap a strip for both consumers: the GPU (`key`, `strip`) and the CPU
 *  reference (`sample`). */
function entry(key, strip) {
  return { key, strip, sample: (c) => sampleStrip(strip, c) };
}

export class LookLibrary {
  /**
   * @param {object} opts
   * @param {() => object[]} [opts.customLooks]  The stored custom entries.
   * @param {(path: string) => Promise<string>} [opts.fetchText]  Reads a file.
   * @param {(msg: string) => void} [opts.warn]  Told once per look that fails.
   */
  constructor({ customLooks = () => [], fetchText = null, warn = () => {} } = {}) {
    this._customLooks = customLooks;
    this._fetchText = fetchText;
    this._warn = warn;
    this._cache = new Map(); // key → entry
    this._pending = new Map(); // key → Promise<entry|null>
    this._failed = new Set(); // keys that failed; not retried until invalidated
  }

  /** Every look a grade can use, built-ins first, in a stable order. */
  list() {
    const builtins = Object.entries(BUILTIN_LOOKS).map(([id, look]) => ({ id, name: look.name, builtin: true }));
    const customs = this._customs().map((c) => ({ id: c.id, name: c.name, builtin: false, path: c.path }));
    return [...builtins, ...customs];
  }

  _customs() {
    let raw;
    try {
      raw = this._customLooks();
    } catch (_e) {
      raw = [];
    }
    return (Array.isArray(raw) ? raw : []).map(normalizeCustomLook).filter(Boolean);
  }

  /** The cache key for an id: a custom look's key carries its revision. */
  keyFor(id) {
    if (BUILTIN_LOOKS[id]) return id;
    const custom = this._customs().find((c) => c.id === id);
    return custom ? `${id}@${custom.rev}` : null;
  }

  /** A look already loaded, or null. Synchronous — for the render path. */
  peek(id) {
    const key = this.keyFor(id);
    return key ? this._cache.get(key) ?? null : null;
  }

  /** Load a look. Resolves to `{ key, strip, sample }` or null; never rejects. */
  async get(id) {
    const key = this.keyFor(id);
    if (!key) return null;
    const cached = this._cache.get(key);
    if (cached) return cached;
    if (this._failed.has(key)) return null;
    if (this._pending.has(key)) return this._pending.get(key);

    const job = (async () => {
      try {
        let lut;
        const builtin = BUILTIN_LOOKS[id];
        if (builtin) {
          lut = bakeRecipe(builtin.recipe);
        } else {
          const custom = this._customs().find((c) => c.id === id);
          if (!custom || !this._fetchText) return null;
          lut = resampleLut(parseCube(await this._fetchText(custom.path)));
        }
        const result = entry(key, lutToStrip(lut));
        this._cache.set(key, result);
        return result;
      } catch (err) {
        this._failed.add(key);
        this._warn(`look "${id}" could not be loaded: ${err?.message ?? err}`);
        return null;
      } finally {
        this._pending.delete(key);
      }
    })();
    this._pending.set(key, job);
    return job;
  }

  /** Forget a look (or all of them) so it is loaded again on next use. */
  invalidate(id = null) {
    if (!id) {
      this._cache.clear();
      this._failed.clear();
      return;
    }
    for (const key of [...this._cache.keys(), ...this._failed]) {
      if (key === id || key.startsWith(`${id}@`)) {
        this._cache.delete(key);
        this._failed.delete(key);
      }
    }
  }
}
