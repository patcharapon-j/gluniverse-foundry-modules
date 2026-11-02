/**
 * Performance — sections other features add to the measurement overlay.
 *
 * A feature with a cost of its own that the shared budget cannot see (the 3D
 * view's GPU time, say) registers a reader here and the overlay prints its rows
 * under the feature's name on each repaint. Pure and dependency-free, so a
 * feature can import it whether or not Performance is switched on; nothing is
 * read unless the overlay is open.
 *
 * A reader returns `[label, value]` string pairs, or nothing to stay hidden.
 * It must be cheap and must not throw; a reader that throws is skipped.
 */

const _readers = new Map();

/**
 * @param {string} id     the section heading (already localised)
 * @param {() => Array<[string, string]>|null} read
 * @returns {() => void}  unregister
 */
export function registerReadout(id, read) {
  if (typeof read !== "function") return () => {};
  _readers.set(id, read);
  return () => { if (_readers.get(id) === read) _readers.delete(id); };
}

/** Every section with rows to show now. */
export function readouts() {
  const out = [];
  for (const [id, read] of _readers) {
    let rows = null;
    try { rows = read(); } catch { rows = null; }
    if (Array.isArray(rows) && rows.length) out.push({ id, rows: rows.filter((r) => Array.isArray(r) && r.length >= 2).map(([k, v]) => [String(k), String(v)]) });
  }
  return out;
}
