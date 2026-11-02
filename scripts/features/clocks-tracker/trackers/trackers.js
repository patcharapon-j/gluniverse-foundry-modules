/**
 * TrackerStore: the world trackers behind the shared dock.
 *
 * One world setting (`ct.trackers`) holds the list, so every write reaches every
 * client through the setting's onChange. Only a GM writes it.
 *
 * Every read goes through `normalizeList` (ids repaired deterministically, every
 * field coerced). Every write goes through `#mutate`, which queues: a write
 * reads the list AFTER the previous one has landed. Without that, two quick
 * clicks both read 3 and both write 4, and the table loses a step.
 *
 * A player's pool roll is rolled and posted on the player's own client; the
 * responsible GM persists the result when the card is created (see
 * `registerHandlers`). That rides Foundry's document socket, so it needs no
 * module socket. The GM never trusts the count a card carries: it re-derives
 * it from the faces against the pool as it stands (`verifyPoolResult`).
 *
 * The same small interface as ActorTrackerStore (`canWrite`, `isActor`,
 * `makeNew`, `get`, `create`, `update`…), so the editor drives either.
 */

import { MODULE_ID, FLAG_NS, SETTINGS, HOOKS } from "../const.js";
import {
  makeNewTracker, sanitizeTracker, stepTracker, setTrackerValue, normalizeList,
  reorderList, verifyPoolResult, rangeOf,
} from "./tracker-model.js";
import { rollPool } from "./pool-roll.js";

export class TrackerStore {
  static isActor = false;
  static get canWrite() { return game.user?.isGM ?? false; }

  /* ------------------------------- reads ------------------------------- */

  /** Every tracker, clean and in display order. */
  static get all() {
    let raw = [];
    try { raw = game.settings.get(MODULE_ID, SETTINGS.trackers) ?? []; } catch { /* not registered yet */ }
    return normalizeList(raw);
  }

  /** What the current viewer may see. */
  static visible() {
    const isGM = game.user?.isGM ?? false;
    return this.all.filter((t) => isGM || t.visibleToPlayers);
  }

  static get(id) { return this.all.find((t) => t.id === id) ?? null; }

  /* ------------------------------- writes (GM) ------------------------------- */

  static #queue = Promise.resolve();

  /**
   * Run `fn(list)` on a fresh read and save the list if it returns true.
   * Serialised, so each write sees the last one's result.
   */
  static #mutate(fn) {
    const run = async () => {
      if (!game.user?.isGM) return false;
      const list = this.all;
      if (!(await fn(list))) return false;
      await game.settings.set(MODULE_ID, SETTINGS.trackers, list);
      return true;
    };
    const p = this.#queue.then(run, run);
    this.#queue = p.catch((err) => console.error(`${MODULE_ID} | tracker write failed`, err));
    return p;
  }

  /** Replace the whole list (a macro's import, say). */
  static async save(trackers) {
    return this.#mutate((list) => {
      list.splice(0, list.length, ...normalizeList(trackers));
      return true;
    });
  }

  static makeNew(type, overrides = {}) {
    return makeNewTracker(type, overrides, this.all);
  }

  static async create(type, overrides = {}) {
    let made = null;
    await this.#mutate((list) => {
      made = makeNewTracker(type, overrides, list);
      list.push(made);
      return true;
    });
    return made;
  }

  /** Merge `patch` into a tracker, coerced per its type. */
  static async update(id, patch) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      if (!t) return false;
      const { id: _id, type: _type, ...rest } = patch ?? {};
      Object.assign(t, rest);
      sanitizeTracker(t);
      return true;
    });
  }

  static async delete(id) {
    return this.#mutate((list) => {
      const i = list.findIndex((t) => t.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    });
  }

  /** A copy placed right after the original. */
  static async duplicate(id) {
    return this.#mutate((list) => {
      const i = list.findIndex((t) => t.id === id);
      if (i < 0) return false;
      const { id: _id, ...source } = list[i];
      list.splice(i + 1, 0, makeNewTracker(source.type, source, []));
      list.forEach((t, n) => { t.order = n; });
      return true;
    });
  }

  static async setVisibility(id, visible) { return this.update(id, { visibleToPlayers: !!visible }); }
  static async setProminent(id, prominent) { return this.update(id, { prominent: !!prominent }); }

  /** Persist a drag-reorder. Writes nothing when the order did not change. */
  static async reorder(idsInOrder) {
    return this.#mutate((list) => reorderList(list, idsInOrder));
  }

  /* ------------------------------- values ------------------------------- */

  static async step(id, delta) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      return !!t && stepTracker(t, delta);
    });
  }

  /** Empty (to the bottom of its range) or fill (to the top) a tracker. */
  static async setTo(id, end) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      if (!t) return false;
      const { min, max } = rangeOf(t);
      const v = end === "max" ? max : (min ?? 0);
      return v !== null && setTrackerValue(t, v);
    });
  }

  /** Refill a pool to its full count. */
  static async resetPool(id) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      return t?.type === "pool" && setTrackerValue(t, t.count);
    });
  }

  /* ------------------------------- pool rolling ------------------------------- */

  /** Roll a pool. A GM always may; a player only where `playerRoll` is set. */
  static async rollPool(id) {
    const t = this.get(id);
    if (!t || t.type !== "pool") return;
    if (!game.user.isGM && !t.playerRoll) return;
    // The roll only counts once a GM writes it, so a player needs one online.
    if (!game.user.isGM && !game.users.some((u) => u.isGM && u.active)) {
      ui.notifications?.warn(game.i18n.localize("GLCT.tracker.noGM"));
      return;
    }
    await rollPool(t, {
      key: `world:${t.id}`,
      speaker: ChatMessage.implementation.getSpeaker({ alias: t.name || game.i18n.localize("GLCT.tracker.types.pool") }),
    });
  }

  /** Persist a rolled pool, re-derived from its faces. GM only. */
  static async _applyPoolResult(id, result, author = null) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      if (!t || t.type !== "pool") return false;
      // A player may only spend a pool the GM opened to players.
      if (author && !author.isGM && !t.playerRoll) return false;
      const next = verifyPoolResult(t, result);
      if (next === null) {
        console.warn(`${MODULE_ID} | ignored a pool result that does not fit "${t.name}" as it stands`);
        return false;
      }
      return setTrackerValue(t, next);
    });
  }

  /* ------------------------------- change fan-out ------------------------------- */

  static #lastAnnounced = null;

  /**
   * Fire the public `trackersChanged` hook, on every client, once per real
   * change. Called from the setting's onChange path (TrackerHud.refresh), which
   * also runs for unrelated config changes, so it compares before it fires.
   */
  static announce() {
    const list = this.all;
    const sig = JSON.stringify(list);
    if (sig === this.#lastAnnounced) return;
    const first = this.#lastAnnounced === null;
    this.#lastAnnounced = sig;
    if (!first) Hooks.callAll(HOOKS.trackersChanged, list);
  }

  /* ------------------------------- internals ------------------------------- */

  /** The one GM who persists routed results: the active GM with the lowest id,
   *  computed here so nothing hangs on `activeGM` reading null mid-handoff. */
  static _isResponsibleGM() {
    if (!game.user?.isGM) return false;
    const gms = game.users.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id));
    return gms[0]?.id === game.user.id;
  }

  static #wired = false;

  /** Wire GM-side pool persistence, once. Sheet pools carry `actorPool` and
   *  are persisted by their owner, so they never enter here. */
  static registerHandlers() {
    if (this.#wired) return;
    this.#wired = true;
    this.announce();
    Hooks.on("createChatMessage", (message) => {
      const flag = message?.flags?.[MODULE_ID]?.[FLAG_NS];
      if (!flag?.poolRoll || flag.trackerId == null || flag.actorPool) return;
      if (!this._isResponsibleGM()) return;
      const author = message.author ?? game.users.get(message.user ?? message._source?.author) ?? null;
      this._applyPoolResult(flag.trackerId, flag, author);
    });
  }
}
