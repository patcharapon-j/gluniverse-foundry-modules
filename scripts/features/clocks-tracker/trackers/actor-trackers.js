/**
 * ActorTrackerStore: a PC's private trackers, in the actor's flags.
 *
 * The counterpart to the world {@link TrackerStore}: these live on one actor
 * (`flags[MODULE_ID].ct.trackers`) and show only on that PC's sheet tab, which
 * opens only for the actor's owners and the GM. The owner owns the actor, so
 * they write directly: no GM relay. A pool roll persists its own new count and
 * whispers the dice and the card to the owners and the GM.
 *
 * Writes are queued per actor, exactly like the world store, so two quick
 * clicks land as two steps rather than one. The queue is keyed by the actor's
 * UUID: an unlinked token's actor shares its base actor's id, and keying on the
 * id let one sheet's writes queue behind (and read) the other's.
 */

import { MODULE_ID, FLAG_NS } from "../const.js";
import {
  makeNewTracker, sanitizeTracker, stepTracker, setTrackerValue, normalizeList,
  reorderList, tallyPool, rangeOf,
} from "./tracker-model.js";
import { rollPool } from "./pool-roll.js";

const FLAG = `${FLAG_NS}.trackers`;
const queues = new Map();   // actor uuid -> tail promise

export class ActorTrackerStore {
  /** @param {Actor} actor */
  constructor(actor) { this.actor = actor; }

  get isActor() { return true; }

  /** The actor's owners and any GM may write. */
  get canWrite() { return !!this.actor?.isOwner; }

  get key() { return this.actor?.uuid ?? this.actor?.id ?? ""; }

  /* ------------------------------- reads ------------------------------- */

  get all() {
    let raw = [];
    try { raw = this.actor?.getFlag(MODULE_ID, FLAG) ?? []; } catch { /* no flags */ }
    return normalizeList(raw);
  }

  /** Every tracker: a private tab has no per-tracker visibility. */
  visible() { return this.all; }

  get(id) { return this.all.find((t) => t.id === id) ?? null; }

  /* ------------------------------- writes ------------------------------- */

  #mutate(fn) {
    const run = async () => {
      if (!this.canWrite) return false;
      const list = this.all;
      if (!(await fn(list))) return false;
      // {render:false}: the open tab repaints itself in place off updateActor
      // (TrackerSheet), so a value change animates instead of redrawing the sheet.
      await this.actor.update({ [`flags.${MODULE_ID}.${FLAG}`]: list }, { render: false });
      return true;
    };
    const tail = queues.get(this.key) ?? Promise.resolve();
    const p = tail.then(run, run);
    queues.set(this.key, p.catch((err) => console.error(`${MODULE_ID} | sheet tracker write failed`, err)));
    return p;
  }

  async save(trackers) {
    return this.#mutate((list) => { list.splice(0, list.length, ...normalizeList(trackers)); return true; });
  }

  makeNew(type, overrides = {}) { return makeNewTracker(type, overrides, this.all); }

  async create(type, overrides = {}) {
    let made = null;
    await this.#mutate((list) => { made = makeNewTracker(type, overrides, list); list.push(made); return true; });
    return made;
  }

  async update(id, patch) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      if (!t) return false;
      const { id: _id, type: _type, ...rest } = patch ?? {};
      Object.assign(t, rest);
      sanitizeTracker(t);
      return true;
    });
  }

  async delete(id) {
    return this.#mutate((list) => {
      const i = list.findIndex((t) => t.id === id);
      if (i < 0) return false;
      list.splice(i, 1);
      return true;
    });
  }

  async duplicate(id) {
    return this.#mutate((list) => {
      const i = list.findIndex((t) => t.id === id);
      if (i < 0) return false;
      const { id: _id, ...source } = list[i];
      list.splice(i + 1, 0, makeNewTracker(source.type, source, []));
      list.forEach((t, n) => { t.order = n; });
      return true;
    });
  }

  async reorder(idsInOrder) { return this.#mutate((list) => reorderList(list, idsInOrder)); }

  async step(id, delta) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      return !!t && stepTracker(t, delta);
    });
  }

  async setTo(id, end) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      if (!t) return false;
      const { min, max } = rangeOf(t);
      const v = end === "max" ? max : (min ?? 0);
      return v !== null && setTrackerValue(t, v);
    });
  }

  async resetPool(id) {
    return this.#mutate((list) => {
      const t = list.find((x) => x.id === id);
      return t?.type === "pool" && setTrackerValue(t, t.count);
    });
  }

  /* ------------------------------- pool rolling ------------------------------- */

  /** Roll a private pool: the owner persists it, the owners and GMs see it. */
  async rollPool(id) {
    if (!this.canWrite) return;
    const t = this.get(id);
    if (!t || t.type !== "pool") return;
    const whisper = this._recipients();
    await rollPool(t, {
      key: `actor:${this.key}:${t.id}`,
      whisper,
      speaker: ChatMessage.implementation.getSpeaker({ actor: this.actor, alias: t.name || this.actor.name }),
      flags: { actorPool: true, actorId: this.actor.id },
      // Spend exactly the dice that were rolled, from the pool as it stands
      // when the write runs: a refill that landed meanwhile is not undone.
      before: (remaining, faces) => this.#mutate((list) => {
        const p = list.find((x) => x.id === id);
        if (!p || p.type !== "pool" || p.current !== faces.length) return false;
        return setTrackerValue(p, tallyPool(faces, p.discard));
      }),
    });
  }

  /** The owners of this PC and every GM. */
  _recipients() {
    return game.users.filter((u) => u.isGM || this.actor.testUserPermission(u, "OWNER")).map((u) => u.id);
  }
}
