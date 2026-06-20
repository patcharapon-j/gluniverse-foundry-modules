/**
 * ActorTrackerStore — per-PC private trackers, stored in actor flags.
 *
 * A counterpart to the world-scope {@link TrackerStore}: instead of one shared
 * array every client sees, these trackers live on a single actor
 * (`flags.<module>.trackers`) and are private to that PC — only the actor's
 * owner(s) and the GM ever see or edit them (the sheet tab that hosts them is
 * itself owner-gated). Surfaced as a dedicated tab on the PF2e character sheet,
 * never on the global dock.
 *
 * Because the owning player *owns the actor*, they can write its flags directly:
 * there is none of the world store's GM-round-trip dance. A pool roll persists
 * its own new count and whispers its result card to the owner + GM, keeping the
 * "private stuff" private. The class mirrors TrackerStore's small interface
 * (`canWrite`, `isActor`, `makeNew`, `get`, `create`, `update`) so the shared
 * editor can target either backend uniformly.
 */

import { MODULE_ID, FLAG_NS } from "../const.js";
import { makeNewTracker, sanitizeTracker, stepTracker, rollPoolDice, poolCardContent, tInt, clamp } from "./tracker-model.js";

// Per-feature flag sub-key prefix: actor trackers live at flags[MODULE_ID].ct.trackers.
const FLAG = `${FLAG_NS}.trackers`;

export class ActorTrackerStore {
  /** @param {Actor} actor */
  constructor(actor) { this.actor = actor; }

  /** This backend is actor-scoped (lets the editor hide world-only fields). */
  get isActor() { return true; }

  /** Owner of the actor (the player whose PC this is) or any GM may write. */
  get canWrite() { return !!this.actor?.isOwner; }

  /* ------------------------------- reads ------------------------------- */

  get all() {
    try { return foundry.utils.deepClone(this.actor?.getFlag(MODULE_ID, FLAG) ?? []); }
    catch { return []; }
  }

  /** Every tracker, ordered. These are private to owner + GM, so there is no
   *  per-tracker visibility filter — anyone who can see the tab sees them all. */
  visible() {
    return this.all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  get(id) { return this.all.find(t => t.id === id) ?? null; }

  /* ------------------------------- writes (owner / GM) ------------------------------- */

  async save(trackers) {
    if (!this.canWrite) return;
    // {render:false} suppresses the heavy full sheet re-render this write would
    // otherwise trigger; the open Trackers tab repaints itself in place off the
    // updateActor hook instead (see TrackerSheet._repaint), so value changes
    // animate. The update still persists + broadcasts normally.
    await this.actor.update({ [`flags.${MODULE_ID}.${FLAG}`]: trackers }, { render: false });
  }

  /** Build a fresh tracker of `type`, ordered after this actor's existing ones. */
  makeNew(type, overrides = {}) {
    return makeNewTracker(type, overrides, this.all);
  }

  async create(type, overrides = {}) {
    if (!this.canWrite) return null;
    const tracker = this.makeNew(type, overrides);
    const all = this.all;
    all.push(tracker);
    await this.save(all);
    return tracker;
  }

  async update(id, patch) {
    if (!this.canWrite) return;
    const all = this.all;
    const t = all.find(x => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    sanitizeTracker(t);
    await this.save(all);
  }

  async delete(id) {
    if (!this.canWrite) return;
    await this.save(this.all.filter(t => t.id !== id));
  }

  async reorder(idsInOrder) {
    if (!this.canWrite) return;
    const all = this.all;
    idsInOrder.forEach((id, i) => { const t = all.find(x => x.id === id); if (t) t.order = i; });
    await this.save(all);
  }

  /* ------------------------------- value mutations ------------------------------- */

  async step(id, delta) {
    if (!this.canWrite) return;
    const all = this.all;
    const t = all.find(x => x.id === id);
    if (!t) return;
    if (!stepTracker(t, delta)) return;
    await this.save(all);
  }

  async resetPool(id) {
    if (!this.canWrite) return;
    const all = this.all;
    const t = all.find(x => x.id === id);
    if (!t || t.type !== "pool") return;
    t.current = tInt(t.count, 0);
    await this.save(all);
  }

  /* ------------------------------- pool rolling ------------------------------- */

  /**
   * Roll a private pool. The owner owns the actor, so — unlike the world store —
   * they persist the new count directly with no responsible-GM relay. The dice
   * animation and the result card are whispered to the owner + GM only, so the
   * rest of the party never learns this private resource exists.
   */
  async rollPool(id) {
    if (!this.canWrite) return;          // only the owner / GM roll a PC's private pool
    const t = this.get(id);
    if (!t || t.type !== "pool") return;

    const rolled = await rollPoolDice(t);
    if (!rolled) return;                 // an exhausted pool stays empty until reset
    const { roll, faces, size, discard, remaining } = rolled;

    const recipients = this._recipients();

    // Whisper the 3D dice to owner + GM only (DSN's 4th arg restricts the audience).
    if (game.dice3d) {
      try { await game.dice3d.showForRoll(roll, game.user, true, recipients); }
      catch (err) { console.warn(`${MODULE_ID} | Dice So Nice roll failed`, err); }
    }

    // Owner-writes-own-flag: persist the new count straight away, no relay.
    await this._applyPoolResult(id, remaining);

    const content = poolCardContent({ tracker: t, faces, discard, size, remaining });
    const speaker = ChatMessage.implementation.getSpeaker({ actor: this.actor, alias: t.name ?? this.actor.name });
    await ChatMessage.implementation.create({
      speaker, content,
      whisper: recipients,
      // actorPool flags this so the world store's GM-persist handler ignores it.
      flags: { [MODULE_ID]: { [FLAG_NS]: { poolRoll: true, actorPool: true, requestedBy: game.user.id, actorId: this.actor.id, trackerId: t.id, current: remaining } } }
    });
  }

  /** Persist a rolled pool's new count (clamped to its full count). */
  async _applyPoolResult(id, current) {
    if (!this.canWrite) return;
    const all = this.all;
    const t = all.find(x => x.id === id);
    if (!t || t.type !== "pool") return;
    const v = clamp(tInt(current, 0), 0, tInt(t.count, 0));
    if (t.current === v) return;
    t.current = v;
    await this.save(all);
  }

  /** User ids who may see this PC's private trackers: its owners + every GM. */
  _recipients() {
    return game.users
      .filter(u => u.isGM || this.actor.testUserPermission(u, "OWNER"))
      .map(u => u.id);
  }
}
