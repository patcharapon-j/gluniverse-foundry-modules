/**
 * Status cards on the stream: one card per creature, folding in every change that lands while it is up.
 *
 * It shares the chat overlay's stack with the roll cards, so `maxVisible`, the removal animation and the
 * teardown cover both kinds. Only two things are its own: the fold window, and the fact that a status
 * card lives for a fraction of a roll card's lifetime — a condition is worth a glance, not a read.
 */

import { StatusCard } from "../cards/status-card.js";
import { getChatSettings } from "../../stream/settings.js";
import { getStatusSettings } from "../settings.js";
import { portraitFramer } from "../framing/portrait-framer.js";
import { foldChanges, readStatusChange } from "./read-status.js";
import { snapshotStatusChange } from "./status-snapshot.js";

/**
 * A change to a creature that already has a card up joins it, rather than opening a second one. Long
 * enough that a spell applying three conditions over a couple of PF2e updates is one card; short enough
 * that the next round's frightened tick is its own moment.
 */
export const FOLD_WINDOW_MS = 4_000;

export class StatusCardFeed {
  constructor(overlay) {
    this.overlay = overlay;
    /** actor key -> the record currently showing that creature's changes. */
    this.byKey = new Map();
    /**
     * item id -> the condition's value as this client last saw it.
     *
     * Foundry's `updateItem` hook hands over the *new* values only, and `preUpdateItem` fires solely on
     * the client that made the change — never on the stream client. So the previous value has to be
     * remembered, or a frightened 2 ticking to 1 cannot be told from one rising to 2. Primed for every
     * observable creature when stream mode starts, so it is right from the first tick rather than from
     * the second.
     */
    this.values = new Map();
  }

  /** True while status cards should be drawn at all. */
  get live() {
    return Boolean(this.overlay?.streamMode?.active) && getStatusSettings().enabled;
  }

  handleCreate(item) {
    const value = valueOf(item);
    if (item?.id) this.values.set(item.id, value);
    this.offer(item, "gained", value);
  }

  handleDelete(item) {
    const value = this.values.get(item?.id) ?? valueOf(item);
    if (item?.id) this.values.delete(item.id);
    this.offer(item, "lost", value);
  }

  handleUpdate(item, changed) {
    // Only a condition's value moving is a status change; PF2e rewrites these items for many other
    // reasons (duration ticks, rule-element bookkeeping) and none of them is a moment on the stream.
    if (changed?.system?.value?.value === undefined) return;
    const next = valueOf(item);
    const previous = this.values.get(item?.id);
    if (item?.id) this.values.set(item.id, next);
    if (!Number.isFinite(next) || next === previous) return;
    // No remembered value: the direction is unknowable, so the card says it arrived rather than
    // inventing an arrow that might point the wrong way.
    const direction = !Number.isFinite(previous) ? "gained" : next > previous ? "raised" : "lowered";
    this.offer(item, direction, next);
  }

  offer(item, direction, value) {
    if (!this.live) return;
    const snapshot = snapshotStatusChange(item, direction, value);
    if (!snapshot) return;
    const model = readStatusChange(snapshot, getStatusSettings());
    if (!model) return;
    const record = this.find(model.key);
    if (record) return this.fold(record, model.changes[0]);
    this.show(model);
  }

  /** The card this creature's changes are folding into, if one is still up and still recent. */
  find(key) {
    const record = this.byKey.get(key);
    if (!record || record.exiting || !record.element?.isConnected) return null;
    return Date.now() - record.openedAt > FOLD_WINDOW_MS ? null : record;
  }

  show(model) {
    const overlay = this.overlay;
    overlay.applySettings();
    const card = new StatusCard(model, { label: localizeLabel, framer: portraitFramer });
    const record = {
      element: card.element,
      card,
      statusKey: model.key,
      changes: model.changes,
      openedAt: Date.now(),
      timeout: null,
      exiting: false
    };
    card.element.dataset.streamStatusKey = model.key;
    overlay.streamMode.getChatRoot().append(card.element);
    overlay.cards.push(record);
    this.byKey.set(model.key, record);
    this.touch(record);
    overlay.enforceMaxVisible();
    card.enter();
  }

  fold(record, change) {
    const changes = foldChanges(record.changes, change);
    // Everything folded away: the creature gained and lost the same thing while the card was up, so
    // there is nothing left to say and the card goes rather than sitting there empty.
    if (!changes.length) return this.retire(record);
    record.changes = changes;
    this.touch(record);
    record.card.addChanges(changes);
  }

  /** Restarts the card's lifetime, a fraction of the chat overlay's. */
  touch(record) {
    const lifetime = Math.max(0, Number(getChatSettings().lifetimeMs) || 0);
    const factor = getStatusSettings().lifetimeFactor;
    window.clearTimeout(record.timeout);
    record.timeout = window.setTimeout(() => this.retire(record), Math.max(1200, lifetime * factor));
  }

  /** Removes the card through the overlay, which owns the stack. */
  retire(record) {
    this.overlay.removeCard(record.element);
  }

  /** Called by the roll-card feed once a status card leaves the stack, however it left. */
  forget(record) {
    record.exiting = true;
    window.clearTimeout(record.timeout);
    if (this.byKey.get(record.statusKey) === record) this.byKey.delete(record.statusKey);
  }

  /**
   * Remembers the condition values of every creature that could produce a card, so the first tick after
   * stream mode starts already knows which way it went rather than reading as an arrival.
   *
   * Exactly the two sets `readStatusChange` can say yes to: player-owned actors, wherever they are, and
   * whatever is standing on the scene. Walking every actor in the world instead would be a pass over
   * every item of every bestiary entry a GM has ever duplicated, to remember values for creatures that
   * can never be drawn.
   */
  prime() {
    this.values.clear();
    if (!getStatusSettings().enabled) return;
    for (const actor of game.actors ?? []) if (actor.hasPlayerOwner) this.remember(actor);
    for (const token of canvas?.tokens?.placeables ?? []) this.remember(token.actor);
  }

  remember(actor) {
    for (const item of actor?.items ?? []) {
      if (item.type === "condition" && item.id) this.values.set(item.id, valueOf(item));
    }
  }

  clear() {
    for (const record of this.byKey.values()) window.clearTimeout(record.timeout);
    this.byKey.clear();
    this.values.clear();
  }
}

function valueOf(item) {
  const value = item?.system?.value?.value;
  return Number.isFinite(value) ? value : null;
}

function localizeLabel(key) {
  const path = `GLUNIVERSE_STREAM.statusCard.${key}`;
  return game.i18n?.has?.(path) ? game.i18n.localize(path) : undefined;
}
