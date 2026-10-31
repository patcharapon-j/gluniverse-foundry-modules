import { RollCard } from "../cards/roll-card.js";
import { waitForDiceAnimation } from "../../stream/dice-wait.js";
import { getChatSettings } from "../../stream/settings.js";
import { getDefaultRollArt } from "../settings.js";
import { portraitFramer } from "../framing/portrait-framer.js";
import { artFor } from "../pf2e/read-message.js";
import { readMessage } from "./read-message.js";
import { snapshotMessage } from "./snapshot.js";

/** Damage merges into the attack card that offered it, if that card is this recent and still up. */
export const MERGE_WINDOW_MS = 60_000;

/**
 * Turns new Daggerheart chat messages into roll cards on the stream, and keeps them in step.
 *
 * Unlike PF2e, this system never replaces a message: a reroll and the GM's Fear are both written onto
 * the message that was posted (`dice/reroll.ts`, `applyFear` in `dice/chat.ts`), so they arrive as
 * `updateChatMessage` and the card is rewritten where it stands. Damage is a message of its own that
 * names no attack — the damage button reads the weapon off the attack card and rolls afresh — so it
 * joins the most recent card from the same actor that offered "Roll damage".
 *
 * Cards share the chat overlay's stack, so `maxVisible` and removal cover them like any other card. There
 * are no status cards in a Daggerheart world.
 */
export class DaggerheartCardFeed {
  /**
   * @param {object} overlay  the stream's ChatOverlay
   * @param {object} [deps]   seams for the tests, which drive the feed under plain Node with no DOM
   * @param {Function} [deps.Card]        the card class (`RollCard`)
   * @param {Function} [deps.snapshot]    live message -> plain snapshot (`snapshotMessage`)
   * @param {Function} [deps.waitForDice] resolves once a message's dice have landed
   * @param {Function} [deps.chatSettings] the overlay's lifetime settings
   */
  constructor(overlay, { Card = RollCard, snapshot = snapshotMessage, waitForDice = waitForDiceAnimation, chatSettings = getChatSettings } = {}) {
    this.overlay = overlay;
    this.Card = Card;
    this.snapshot = snapshot;
    this.waitForDice = waitForDice;
    this.chatSettings = chatSettings;
    /** messageId -> record, for the message each card shows (and every damage message merged into it). */
    this.byMessageId = new Map();
  }

  read(message) {
    return readMessage(this.snapshot(message));
  }

  async handleCreate(message) {
    if (!this.read(message)) return;
    await this.waitForDice(message);
    const live = game.messages?.get?.(message.id);
    if (!this.overlay.streamMode.active || !live) return;
    // Read again: the GM's Fear is claimed onto a fear roll moments after it posts, and a reroll can land
    // while the dice were still tumbling. The card shows the message as it is now.
    const model = this.read(live);
    if (!model) return;
    if (model.kind === "damage") {
      const target = this.findMergeTarget(model);
      if (target) return this.mergeDamage(target, message.id, model);
    }
    this.show(message.id, model);
  }

  /**
   * A message changed after it was posted: a reroll (a new total, the Reroll chip), the Fear claim (a
   * chip and nothing else), or a merged damage message rewritten. Anything else — a button somebody
   * pressed, a claim this card does not draw — changes nothing the card says and is left alone.
   */
  async handleUpdate(message, changes) {
    const record = this.byMessageId.get(message?.id);
    if (!record || record.exiting || record.card?.destroyed) return;
    if (Array.isArray(changes?.rolls)) {
      // Dice So Nice animates the rerolled die on the update itself; the new number waits for it.
      await this.waitForDice(message);
      // While the dice rolled, the message may have been unmerged (its attack turned blind, it was deleted).
      if (record.exiting || record.card?.destroyed || this.byMessageId.get(message.id) !== record) return;
    }
    const live = game.messages?.get?.(message.id) ?? message;
    const model = this.read(live);

    if (message.id !== record.messageId) {
      // A damage message merged under an attack. It can only lose its visibility or its numbers here, and
      // a row whose message turned private must not keep printing its numbers.
      if (!model?.damage || record.model.visibility === "ownBlind") return this.unmergeDamage(record, message.id);
      if (sameDamage(record.damage, model.damage)) return;
      record.damage = model.damage;
      this.touch(record, record.model.fx);
      return record.card.addDamage(model.damage);
    }

    if (!model) return this.retire(record);
    // An attack that turned into a blind roll shows nothing of how it went, its damage included.
    if (model.visibility === "ownBlind") {
      for (const id of [...record.messageIds]) if (id !== record.messageId) this.unmergeDamage(record, id);
    }
    const previous = record.model;
    record.model = model;
    if (resultSignature(previous) !== resultSignature(model)) {
      this.touch(record, model.fx);
      return record.card.update(model, { reroll: model.rerolls > previous.rerolls });
    }
    if (chipSignature(previous) !== chipSignature(model)) record.card.setChips(model);
  }

  handleDelete(message) {
    const record = this.byMessageId.get(message?.id);
    if (!record) return false;
    // A deleted merged damage roll takes only its row; losing the card's own message takes the card down.
    if (message.id !== record.messageId) {
      this.unmergeDamage(record, message.id);
      return true;
    }
    this.byMessageId.delete(message.id);
    record.messageIds.delete(message.id);
    this.retire(record);
    return true;
  }

  /** Drops a merged damage message from its card. The slot stays spent: the attack offered one roll. */
  unmergeDamage(record, messageId) {
    if (this.byMessageId.get(messageId) === record) this.byMessageId.delete(messageId);
    record.messageIds.delete(messageId);
    record.damage = null;
    record.card.removeDamage?.();
  }

  /** The most recent card from the same actor that offered "Roll damage", within the window. */
  findMergeTarget(model) {
    if (!model.originKey) return null;
    const now = Date.now();
    let best = null;
    for (const record of this.byMessageId.values()) {
      if (record.exiting || record.damageTaken || record.originKey !== model.originKey || !record.model.opensDamage) continue;
      // A blind attack keeps its result off the stream, so its damage cannot sit under it.
      if (record.model.visibility === "ownBlind") continue;
      if (now - record.touchedAt > MERGE_WINDOW_MS) continue;
      if (!best || record.touchedAt > best.touchedAt) best = record;
    }
    return best;
  }

  show(messageId, model) {
    const overlay = this.overlay;
    overlay.applySettings();
    const card = new this.Card(model, { label: localizeLabel, framer: portraitFramer });
    const record = {
      element: card.element,
      card,
      messageId,
      messageIds: new Set([messageId]),
      model,
      damage: null,
      damageTaken: false,
      originKey: model.originKey,
      touchedAt: 0,
      timeout: null,
      exiting: false
    };
    card.element.dataset.streamMessageId = messageId;
    overlay.streamMode.getChatRoot().append(card.element);
    overlay.cards.push(record);
    this.byMessageId.set(messageId, record);
    this.touch(record, model.fx);
    overlay.enforceMaxVisible();
    card.enter();
  }

  async mergeDamage(record, messageId, model) {
    record.messageIds.add(messageId);
    this.byMessageId.set(messageId, record);
    record.damage = model.damage;
    // One damage roll per attack card. The system claims the button when it is pressed, so the next
    // damage roll from this actor belongs to something else and gets a card of its own. Kept on the
    // record, not the model: every update to the attack (a reroll, the Fear claim) replaces the model.
    record.damageTaken = true;
    this.touch(record, model.damage?.crit ? "gold" : record.model.fx);
    await record.card.addDamage(model.damage);
  }

  /** Restarts the card's lifetime. Critical cards stay up longer. */
  touch(record, fx) {
    const settings = this.chatSettings();
    const lifetime = Math.max(0, Number(settings.lifetimeMs) || 0);
    const multiplier = fx === "gold" || fx === "red" ? Math.max(1, Number(settings.critLifetimeMultiplier) || 1) : 1;
    record.touchedAt = Date.now();
    window.clearTimeout(record.timeout);
    record.timeout = window.setTimeout(() => this.retire(record), lifetime * multiplier);
  }

  /** Removes the card through the overlay, which owns the stack. */
  retire(record) {
    this.overlay.removeCard(record.element);
  }

  /** Called by the overlay once one of this feed's cards leaves the stack, however it left. */
  forget(record) {
    record.exiting = true;
    window.clearTimeout(record.timeout);
    for (const id of record.messageIds) {
      if (this.byMessageId.get(id) === record) this.byMessageId.delete(id);
    }
  }

  /**
   * Frames the art of everyone likely to roll before they do: each player's character, the current
   * combatants and the world's default GM roll art. Portrait first, as the cards choose it.
   */
  prescan() {
    const sources = [getDefaultRollArt().src];
    const add = (actor, token) => sources.push(artFor(actor?.img, token?.texture?.src, false));
    for (const user of game.users ?? []) if (user.character) add(user.character, user.character.prototypeToken);
    for (const combatant of game.combat?.combatants ?? []) add(combatant.actor, combatant.token);
    portraitFramer.prescan(sources.filter(Boolean));
  }

  clear() {
    for (const record of this.byMessageId.values()) window.clearTimeout(record.timeout);
    this.byMessageId.clear();
  }
}

/** Everything the result column draws. A change here is a new roll on the same card. */
function resultSignature(model) {
  if (!model) return "";
  const { roll, duality, tone, fx, rerolls } = model;
  return JSON.stringify([roll?.total, roll?.natural, roll?.outcomeKey, roll?.verdictKey, roll?.dcVisible, roll?.dc, duality, tone, fx, rerolls, model.visibility]);
}

function chipSignature(model) {
  return (model?.chips ?? []).map((chip) => chip.id).join("|");
}

function sameDamage(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function localizeLabel(key) {
  const path = `GLUNIVERSE_STREAM.rollCard.${key}`;
  return game.i18n?.has?.(path) ? game.i18n.localize(path) : undefined;
}
