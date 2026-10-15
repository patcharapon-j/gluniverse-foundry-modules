/**
 * When has a check's die come to rest on the Dice So Nice board — the one
 * clock both landing beats wait on (the badge's face pulse and the ring).
 *
 * Pure: the board, the timers and the clock are injected, so the check tool
 * drives every road out of here. Nothing in it registers a Foundry hook; the
 * adapter feeds it `start` (diceSoNiceRollStart), `forget` (deleteChatMessage)
 * and `clear` (teardown), and every watch ends — settled, or null — within a
 * bounded time, removing its own timers and its own entry:
 *
 *   • settled   the kept die is at rest on the board → `{x, y, r}`;
 *   • unseen    DSN never started a throw for the message (hidden NPC rolls,
 *               "only my rolls", DSN off on this client …) → null after
 *               `startGrace`;
 *   • unshown   it started one but none of its dice reached the board while
 *               the board was idle (visibility "none", off during combat, a
 *               skipped background tab) → null after `spawnGrace` of idle;
 *   • too long  → null after `maxWait`, whatever happened;
 *   • deleted / torn down → null at once.
 *
 * A message's dice are recognised by the identity of their result objects,
 * taken from the roll DSN itself was handed (see dsn-host.mjs boardState).
 */

const D20_RESULTS = (roll) => {
  const out = [];
  const walk = (r) => {
    for (const die of r?.dice ?? []) if (die?.faces === 20) for (const res of die.results ?? []) out.push(res);
  };
  walk(roll);
  return out;
};

/**
 * @param {{
 *   readBoard: (results: Set<object>) => {busy: boolean, present: boolean, settled: object|null},
 *   setTimer?: Function, clearTimer?: Function, now?: () => number,
 *   poll?: number, startGrace?: number, spawnGrace?: number, maxWait?: number,
 * }} deps
 */
export function createDiceWatch({
  readBoard,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => Date.now(),
  poll = 100,
  startGrace = 1500,
  spawnGrace = 4000,
  maxWait = 10000,
}) {
  /** messageId → { results, started, waiters, born, idleSince, timers } */
  const watches = new Map();

  const finish = (id, die) => {
    const w = watches.get(id);
    if (!w) return;
    watches.delete(id);
    for (const t of w.timers) clearTimer(t);
    w.timers.clear();
    for (const resolve of w.waiters) resolve(die ?? null);
  };

  const later = (w, ms, fn) => {
    const t = setTimer(() => {
      w.timers.delete(t);
      fn();
    }, ms);
    w.timers.add(t);
  };

  const ensure = (id) => {
    let w = watches.get(id);
    if (w) return w;
    w = { results: new Set(), started: false, waiters: [], born: now(), idleSince: null, timers: new Set() };
    watches.set(id, w);
    later(w, maxWait, () => finish(id, null));
    return w;
  };

  const tick = (id) => {
    const w = watches.get(id);
    if (!w) return;
    let board;
    try {
      board = readBoard(w.results);
    } catch {
      board = { busy: false, present: false, settled: null };
    }
    if (board.settled) return finish(id, board.settled);
    if (board.present || board.busy) w.idleSince = null;
    else if (w.idleSince == null) w.idleSince = now();
    else if (now() - w.idleSince >= spawnGrace) return finish(id, null);
    later(w, poll, () => tick(id));
  };

  return {
    /** DSN began showing (part of) this message's dice; `roll` is the roll it was handed. */
    start(messageId, roll) {
      if (!messageId) return;
      const results = D20_RESULTS(roll);
      if (!results.length) return;
      const w = ensure(messageId);
      for (const r of results) w.results.add(r);
      if (w.started) return;
      w.started = true;
      tick(messageId);
    },

    /** Resolves with `{x, y, r}` once the kept d20 rests on the board, else null. */
    wait(messageId) {
      if (!messageId) return Promise.resolve(null);
      const w = ensure(messageId);
      if (!w.started) {
        later(w, startGrace, () => {
          if (!watches.get(messageId)?.started) finish(messageId, null);
        });
      }
      return new Promise((resolve) => w.waiters.push(resolve));
    },

    forget(messageId) {
      finish(messageId, null);
    },

    clear() {
      for (const id of [...watches.keys()]) finish(id, null);
    },

    /** Open watches (the check tool asks that every road out of here empties it). */
    get size() {
      return watches.size;
    },
  };
}
