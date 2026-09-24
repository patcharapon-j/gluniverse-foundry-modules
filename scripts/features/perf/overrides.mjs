/**
 * Performance — the list of Foundry values this client is overriding.
 *
 * The feature never writes a core setting. It changes what those settings
 * produce, at runtime, and switching the feature off (or choosing Quality)
 * leaves every one of them exactly as the user set it. That has a cost: a user
 * who opens Foundry's own settings and sees "Performance mode: High" while the
 * canvas is running at Low is looking at a setting that appears to do nothing.
 * So every override is registered here, and the overlay prints them beside the
 * user's own value.
 */

/** key → { label, value, own } */
const _overrides = new Map();
/** @type {Set<() => void>} */
const _listeners = new Set();

function changed() {
  for (const fn of _listeners) {
    try { fn(); } catch { /* a listener's problem */ }
  }
}

export const Overrides = {
  /**
   * @param {string} key    stable id, also the i18n key GLPERF.override.<key>
   * @param {string} value  what is in force
   * @param {string} own    what the user's own setting says
   */
  set(key, value, own) {
    const prev = _overrides.get(key);
    if (prev && prev.value === String(value) && prev.own === String(own)) return;
    _overrides.set(key, { key, value: String(value), own: String(own) });
    changed();
  },

  clear(key) {
    if (_overrides.delete(key)) changed();
  },

  list() {
    return [..._overrides.values()];
  },

  onChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
  },
};
