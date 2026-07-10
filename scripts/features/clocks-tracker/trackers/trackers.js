/**
 * TrackerStore — the world-scope data layer for the global Tracker HUD.
 *
 * Trackers live in a single world-scope setting (`trackers`), so every GM
 * edit, reorder, roll, or visibility change propagates to all clients via the
 * setting's onChange → TrackerHud.refresh() pipeline (same model the calendar
 * HUD uses). Players read the array but never write it: a player-initiated pool
 * roll rolls + posts its result card on the player's own client, and the
 * responsible GM persists the new count when that card is created (see
 * registerHandlers) — keeping the GM authoritative over world state without a
 * dedicated module socket channel.
 *
 * The tracker *shape*, its coercion, stepping and pool maths are shared with the
 * per-actor backend (see tracker-model.js + actor-trackers.js); this class only
 * owns the world-storage + GM-authority concerns. It exposes the same small
 * interface the editor drives — `canWrite`, `isActor`, `makeNew`, `get`,
 * `create`, `update` — so the editor can target either backend uniformly.
 */

import { MODULE_ID, FLAG_NS, SETTINGS, HOOKS } from "../const.js";
import { makeNewTracker, sanitizeTracker, stepTracker, rollPoolDice, poolCardContent, tInt, clamp } from "./tracker-model.js";

export class TrackerStore {
  /** This backend is world-scoped, GM-authoritative (lets the editor branch on it). */
  static isActor = false;
  static get canWrite() { return game.user?.isGM ?? false; }

  /* ------------------------------- reads ------------------------------- */

  static get all() {
    try { return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.trackers) ?? []); }
    catch { return []; }
  }

  /** Trackers ordered for display, filtered to what the current viewer may see. */
  static visible() {
    const isGM = game.user?.isGM ?? false;
    return this.all
      .filter(t => isGM || t.visibleToPlayers)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }

  static get(id) { return this.all.find(t => t.id === id) ?? null; }

  /* ------------------------------- writes (GM) ------------------------------- */

  static async save(trackers) {
    if (!game.user.isGM) return;
    await game.settings.set(MODULE_ID, SETTINGS.trackers, trackers);
    // onChange handles the local + broadcast refresh; fire the public hook too.
    Hooks.callAll(HOOKS.trackersChanged, trackers);
  }

  /** Build a fresh tracker of `type`, optionally overriding default fields. */
  static makeNew(type, overrides = {}) {
    return makeNewTracker(type, overrides, this.all);
  }

  static async create(type, overrides = {}) {
    if (!game.user.isGM) return null;
    const tracker = this.makeNew(type, overrides);
    const all = this.all;
    all.push(tracker);
    await this.save(all);
    return tracker;
  }

  /** Merge `patch` into an existing tracker, coercing numeric fields per type. */
  static async update(id, patch) {
    if (!game.user.isGM) return;
    const all = this.all;
    const t = all.find(x => x.id === id);
    if (!t) return;
    Object.assign(t, patch);
    sanitizeTracker(t);
    await this.save(all);
  }

  static async delete(id) {
    if (!game.user.isGM) return;
    await this.save(this.all.filter(t => t.id !== id));
  }

  static async setVisibility(id, visible) {
    return this.update(id, { visibleToPlayers: !!visible });
  }

  /** Make one shared-HUD tracker visually dominant for every connected user. */
  static async setProminent(id, prominent) {
    return this.update(id, { prominent: !!prominent });
  }

  /** Persist a new display order from an array of ids (drag-reorder result). */
  static async reorder(idsInOrder) {
    if (!game.user.isGM) return;
    const all = this.all;
    idsInOrder.forEach((id, i) => { const t = all.find(x => x.id === id); if (t) t.order = i; });
    await this.save(all);
  }

  /* ------------------------------- value mutations ------------------------------- */

  /** Step a point/clock/task/hazard up or down. Returns nothing; saves state. */
  static async step(id, delta) {
    if (!game.user.isGM) return;
    const all = this.all;
    const t = all.find(x => x.id === id);
    if (!t) return;
    if (!stepTracker(t, delta)) return;
    await this.save(all);
  }

  /** Refill a pool to its full count (GM right-click / reset). */
  static async resetPool(id) {
    if (!game.user.isGM) return;
    const all = this.all;
    const t = all.find(x => x.id === id);
    if (!t || t.type !== "pool") return;
    t.current = tInt(t.count, 0);
    await this.save(all);
  }

  /* ------------------------------- pool rolling ------------------------------- */

  /**
   * Roll a resource pool.
   *
   * The roll, its 3D dice, and the result card all happen on whichever client
   * clicked: players are allowed to roll dice and post chat messages, so this
   * needs no GM round-trip. The one thing a player can't do is write the pool's
   * new count (a world-scope setting), so the result card carries the new
   * `current` in its flags and the responsible GM persists it from the
   * `createChatMessage` hook (see registerHandlers). That rides Foundry's
   * always-present document socket, so — unlike a module socket channel — it
   * works without the server having to be restarted to register a namespace.
   *
   * Players may only roll a pool whose `playerRoll` flag is set.
   */
  static async rollPool(id) {
    const t = this.get(id);
    if (!t || t.type !== "pool") return;
    if (!game.user.isGM && !t.playerRoll) return;
    // The roll only matters once the shared count updates, and only a GM can
    // write that — so a player needs at least one active GM to make it stick.
    if (!game.user.isGM && !game.users.some(u => u.isGM && u.active)) {
      ui.notifications?.warn(game.i18n.localize("GLCT.tracker.noGM"));
      return;
    }

    const rolled = await rollPoolDice(t);
    if (!rolled) return;   // an exhausted pool stays empty until the GM resets it
    const { roll, faces, size, discard, remaining } = rolled;

    // Roll the 3D dice for everyone and WAIT for them to settle before the result
    // card lands. showForRoll(...synchronize=true) broadcasts the animation to all
    // clients in the roller's colours and resolves once it finishes.
    if (game.dice3d) {
      try { await game.dice3d.showForRoll(roll, game.user, true); }
      catch (err) { console.warn(`${MODULE_ID} | Dice So Nice roll failed`, err); }
    }

    // Post the card; its flag carries the new count for the responsible GM to
    // persist. (No Roll attached → Foundry won't render a duplicate dice box.)
    const content = poolCardContent({ tracker: t, faces, discard, size, remaining });
    const speaker = ChatMessage.implementation.getSpeaker({ alias: t.name ?? "Resource Pool" });
    await ChatMessage.implementation.create({
      speaker, content,
      flags: { [MODULE_ID]: { [FLAG_NS]: { poolRoll: true, requestedBy: game.user.id, trackerId: t.id, current: remaining } } }
    });
  }

  /** Persist a rolled pool's new count. GM-only; clamped to the pool's size. */
  static async _applyPoolResult(id, current) {
    if (!game.user.isGM) return;
    const all = this.all;
    const t = all.find(x => x.id === id);
    if (!t || t.type !== "pool") return;
    const v = clamp(tInt(current, 0), 0, tInt(t.count, 0));
    if (t.current === v) return;          // already applied (e.g. a duplicate hook)
    t.current = v;
    await this.save(all);
  }

  /* ------------------------------- internals ------------------------------- */

  /** The one GM responsible for handling routed player requests: the active GM
   *  with the lowest id, computed explicitly so we don't depend on the `activeGM`
   *  getter (which can read null and would then drop the request on every GM). */
  static _isResponsibleGM() {
    if (!game.user?.isGM) return false;
    const gms = game.users.filter(u => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id));
    return gms[0]?.id === game.user.id;
  }

  /** Wire GM-side pool-roll persistence once (called from the ready hook).
   *  A pool roll posts a result card on the roller's client; the responsible GM
   *  applies the new count when that card is created. Riding the core document
   *  socket means this needs no module socket channel — and so no server restart
   *  for the manifest's `socket` flag to take effect. Actor-scoped pools never
   *  enter here: their owner writes the new count directly (see ActorTrackerStore),
   *  so those cards carry no world `trackerId` to act on. */
  static registerHandlers() {
    Hooks.on("createChatMessage", (message) => {
      const flag = message?.flags?.[MODULE_ID]?.[FLAG_NS];
      if (!flag?.poolRoll || flag.trackerId == null || flag.actorPool) return;
      // Only the primary active GM writes, to avoid double-handling on multi-GM tables.
      if (!this._isResponsibleGM()) return;
      this._applyPoolResult(flag.trackerId, flag.current);
    });
  }
}
