/**
 * Performance — Foundry's UI.
 *
 *   appRender          (core patch) ApplicationV2 renders are serialised by a
 *                      semaphore but never merged: one PF2e action that fires
 *                      five document updates renders the open sheet five times
 *                      in a row. Calls that arrive while a render is in flight
 *                      collapse into ONE trailing render with their options
 *                      merged, and every caller's promise resolves after a
 *                      render that includes its change.
 *   directoryDebounce  (core patch) a bulk create/update/delete re-renders each
 *                      sidebar directory once per document. The first call goes
 *                      through at once (a single edit has no added latency);
 *                      calls within the window after it collapse into one.
 *   chatPrune          while the log sits at the bottom, only the newest
 *                      CHAT_KEEP messages stay in the DOM. Removal goes through
 *                      ChatLog#deleteMessage — the UI-only removal Foundry uses
 *                      itself, which keeps its own "oldest rendered" pointer
 *                      right — so scrolling up re-renders older batches exactly
 *                      as it always did. No ChatMessage is touched.
 */

import { Patches } from "./patches.mjs";
import { Perf } from "./runtime.mjs";
import { CHAT_KEEP, CHAT_SLACK } from "./constants.mjs";

/* ══════════════════════════════════════════════════════════════════════
   appRender — merge renders that queue behind one in flight
   ══════════════════════════════════════════════════════════════════════ */

/** app → { trailing: { options, promise, resolve, reject } | null } */
const _inflight = new WeakMap();

/**
 * A deferred render NEVER calls a `wrapped` it kept from an earlier call.
 * libWrapper invalidates that function as soon as anything re-registers on the
 * chain, and then throws when it is called ("This wrapper function … is no
 * longer valid"), which took down the trailing render of a burst. A deferred
 * render goes back in through the public method instead, so it gets the chain
 * as it stands now, and this one-shot marker tells the handler to pass it on.
 */
let _reentry = null;

function reenter(target, call) {
  _reentry = target;
  try { return call(); } finally { _reentry = null; }
}

/**
 * Merge two sets of render options into one render that satisfies both.
 * `force` is sticky; `parts` is a union, and a call with no `parts` (a full
 * render) wins outright; everything else is last-writer-wins, which is what
 * the second of two sequential renders would have done anyway.
 */
export function mergeRenderOptions(a, b) {
  const out = { ...a, ...b };
  out.force = !!(a.force || b.force);
  if (Array.isArray(a.parts) && Array.isArray(b.parts)) out.parts = [...new Set([...a.parts, ...b.parts])];
  else delete out.parts;
  return out;
}

function normalise(options, _options) {
  if (typeof options === "boolean") return { ...(_options ?? {}), force: options };
  return { ...(options ?? {}) };
}

function launch(app, call, options, entry) {
  let promise;
  try {
    promise = Promise.resolve(call(options));
  } catch (e) {
    promise = Promise.reject(e);
  }
  const next = () => {
    const trailing = entry.trailing;
    if (!trailing) {
      _inflight.delete(app);
      return;
    }
    entry.trailing = null;
    const p = launch(app, (o) => reenter(app, () => app.render(o)), trailing.options, entry);
    p.then(trailing.resolve, trailing.reject);
  };
  promise.then(next, next);
  return promise;
}

Patches.define({
  id: "appRender",
  target: "foundry.applications.api.ApplicationV2.prototype.render",
  signature: "#semaphore.add(this.#render.bind(this), options)",
  handler(wrapped, options = {}, _options = {}) {
    const opts = normalise(options, _options);
    if (_reentry === this) {
      _reentry = null;
      return wrapped(opts);
    }
    const entry = _inflight.get(this);
    if (!entry) {
      const fresh = { trailing: null };
      _inflight.set(this, fresh);
      return launch(this, (o) => wrapped(o), opts, fresh);
    }
    if (entry.trailing) {
      entry.trailing.options = mergeRenderOptions(entry.trailing.options, opts);
      return entry.trailing.promise;
    }
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    entry.trailing = { options: opts, promise, resolve, reject };
    return promise;
  },
});

/* ══════════════════════════════════════════════════════════════════════
   directoryDebounce — one directory refresh per burst
   ══════════════════════════════════════════════════════════════════════ */

const DIRECTORY_WINDOW_MS = 120;
/** collection → { timer, force, options } */
const _dirTimers = new WeakMap();

Patches.define({
  id: "directoryDebounce",
  target: "foundry.documents.abstract.DocumentCollection.prototype.render",
  signature: "opts.force = force;",
  handler(wrapped, force = false, options = {}) {
    if (_reentry === this) {
      _reentry = null;
      return wrapped(force, options);
    }
    const pending = _dirTimers.get(this);
    if (!pending) {
      // Leading edge: a single edit renders immediately.
      _dirTimers.set(this, { timer: window.setTimeout(() => flushDirectory(this), DIRECTORY_WINDOW_MS), force: false, options: null });
      return wrapped(force, options);
    }
    pending.force ||= !!force;
    pending.options = options;
    return undefined;
  },
});

function flushDirectory(collection) {
  const pending = _dirTimers.get(collection);
  _dirTimers.delete(collection);
  // Trailing edge only if something arrived during the window.
  if (pending?.options) reenter(collection, () => collection.render(pending.force, pending.options));
}

/* ══════════════════════════════════════════════════════════════════════
   chatPrune — keep the rendered log short while it sits at the bottom
   ══════════════════════════════════════════════════════════════════════ */

let _pruneTimer = 0;

function schedulePrune() {
  if (_pruneTimer) return;
  _pruneTimer = window.setTimeout(() => {
    _pruneTimer = 0;
    prune();
  }, 2000);
}

export function prune() {
  if (!Perf.patchOn("chatPrune")) return 0;
  const log = ui.chat;
  if (!log?.rendered || !log.isAtBottom || typeof log.deleteMessage !== "function") return 0;
  // A row already on its way out (Foundry animates the removal) is not counted
  // twice, or a second prune before the first finished would remove twice as many.
  const rows = log.element?.querySelectorAll(".chat-log > .message[data-message-id]:not(.deleting)");
  if (!rows || rows.length <= CHAT_KEEP + CHAT_SLACK) return 0;
  const drop = rows.length - CHAT_KEEP;
  // Oldest first: ChatLog#deleteMessage moves its "oldest rendered" pointer to
  // the next sibling only when the removed row IS the oldest, so removing from
  // the top keeps it exact and a later scroll-up re-renders from the right place.
  for (let i = 0; i < drop; i++) log.deleteMessage(rows[i].dataset.messageId);
  return drop;
}

export function startUiTuning() {
  Hooks.on("createChatMessage", schedulePrune);
  Hooks.on("renderChatLog", schedulePrune);
}
