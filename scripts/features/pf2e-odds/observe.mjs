/**
 * Watching chat for what the party sees — and the ledger's only writer.
 *
 * The ACTIVE GM's client is the single writer of `od.ledger`: every client is
 * told about every message, so letting each one fold observations in would be
 * N racing writes of the same fact. A player's client never writes; a world
 * setting is GM-writable anyway.
 *
 * The visibility gate lives here, because it is a question about Foundry:
 *
 *   visible       the card reached at least one player: not blind, and either
 *                 public or whispered to a non-GM user
 *   resultsShown  PF2e's own "show results" metagame setting — PF2e prints a
 *                 card's degree under exactly that, whoever rolled
 *   dcShown       the DC itself is printed: the card marked it visible, or the
 *                 "show DCs" metagame setting is on. Then the DC is simply read.
 *
 * observe-model.mjs does nothing with a card that fails them.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { SETTINGS } from "./constants.mjs";
import { isCreature, kindOf, partyCharacterIds, partyMode, readLedger } from "./knowledge.mjs";
import { PARTY, fold, forget as forgetModel } from "./ledger-model.mjs";
import { observationsFrom } from "./observe-model.mjs";
import { bareDc, situational } from "./probe.mjs";

const isActiveGM = () => !!game.user?.isGM && (game.users?.activeGM ?? null)?.id === game.user.id;

const metagame = (key) => {
  try {
    return !!game.pf2e?.settings?.metagame?.[key];
  } catch {
    return false;
  }
};

function reachedPlayers(message) {
  if (message.blind) return false;
  const whisper = message.whisper ?? [];
  if (!whisper.length) return true;
  return whisper.some((id) => !game.users?.get(id)?.isGM);
}

function d20Natural(roll) {
  const die = roll?.dice?.find?.((d) => d.faces === 20);
  const kept = die?.results?.filter?.((r) => r.active !== false && !r.discarded) ?? [];
  return kept.length === 1 ? kept[0].result : null;
}

const actorFrom = (uuid) => {
  try {
    const doc = uuid ? fromUuidSync(uuid) : null;
    return doc?.actor ?? (doc?.documentName === "Actor" ? doc : null);
  } catch {
    return null;
  }
};

const side = (actor) => (actor ? { creature: isCreature(actor), kind: isCreature(actor) ? kindOf(actor) : null, actor } : null);

/** Today's DC minus the bare DC, for the defender's statistic named by dc.slug. */
function dcDeltaFor(defender, ctx) {
  const slug = String(ctx?.dc?.slug ?? "").replace(/-dc$/, "");
  const stat = defender?.getStatistic?.(slug === "ac" ? "armor" : slug);
  const dc = stat?.dc;
  if (!dc || !Number.isFinite(ctx?.dc?.value)) return 0;
  return ctx.dc.value - bareDc(dc, ctx.dc.value);
}

/** A creature's situational modifier delta, MAP included, off the card's own modifier list. */
function modDeltaFor(flags) {
  const mods = (flags?.modifiers ?? []).map((m) => ({
    slug: m.slug,
    value: m.modifier,
    kind: m.type ?? "untyped",
    enabled: !!m.enabled && !m.ignored,
  }));
  const map = mods.filter((m) => m.enabled && m.slug === "multiple-attack-penalty");
  return [...map, ...situational(mods)].reduce((a, m) => a + (Number(m.value) || 0), 0);
}

/** The owners an observation is filed under. */
function ownersFor() {
  if (partyMode()) return [PARTY];
  // Per character: the PC on the card saw it — the roller, or the PC a
  // creature rolled against — and so did the rest of the party at the table.
  // A table that wants separation per character wants it per *recall*, which
  // the dex already provides; dice on the table are everybody's.
  return partyCharacterIds();
}

let queue = Promise.resolve();

/** Serialise writes so two cards landing together cannot clobber each other. */
function write(mutator) {
  queue = queue.then(async () => {
    const before = readLedger();
    const after = mutator(before);
    if (after === before) return;
    await game.settings.set(SUITE_ID, SETTINGS.ledger, after);
  }).catch((error) => warn("pf2e-odds | could not write the ledger", error));
  return queue;
}

export function onChatMessage(message) {
  if (!isActiveGM()) return;
  try {
    const flags = message.flags?.pf2e;
    const ctx = flags?.context;
    const roll = message.rolls?.[0];
    if (!ctx || !roll) return;
    const rollerActor = message.actor ?? actorFrom(ctx.origin?.actor);
    const targetActor = actorFrom(ctx.target?.actor);
    const originActor = ctx.type === "saving-throw" ? actorFrom(ctx.origin?.actor) : null;
    const roller = side(rollerActor);
    if (!roller) return;
    const defender = ctx.type === "saving-throw" ? null : side(targetActor && targetActor !== rollerActor ? targetActor : null);
    const card = {
      context: ctx,
      modifierName: flags.modifierName ?? null,
      total: roll.total,
      natural: d20Natural(roll),
      visible: reachedPlayers(message),
      resultsShown: metagame("results"),
      dcShown: !!ctx.dc?.visible || metagame("dcs"),
      roller,
      defender,
      origin: originActor && originActor !== rollerActor ? side(originActor) : null,
      dcDelta: defender ? dcDeltaFor(targetActor, ctx) : 0,
      modDelta: roller.creature ? modDeltaFor(flags) : 0,
    };
    const found = observationsFrom(card);
    if (!found.length) return;
    const owners = ownersFor();
    const at = message.timestamp ?? Date.now();
    write((ledger) => {
      let next = ledger;
      for (const obs of found) {
        const name = [roller, defender, card.origin].find((s) => s?.kind === obs.kind)?.actor?.name ?? "";
        next = fold(next, { ...obs, owners, name, at, src: `${obs.src}:${message.id}` }).ledger;
      }
      return next;
    });
  } catch (error) {
    warn("pf2e-odds | could not read a check card", error);
  }
}

/** The GM's resets (Observations view). */
export const forgetStat = (kind, stat = null) => write((ledger) => forgetModel(ledger, kind, stat));
export const forgetAll = () => write(() => ({}));

