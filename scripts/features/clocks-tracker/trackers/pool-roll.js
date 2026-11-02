/**
 * The Foundry half of a pool roll: the Roll, its Dice So Nice throw, the card.
 *
 * Both stores roll through here. What differs between them is who persists the
 * new count (the GM for the world store, the owner for a sheet pool) and who
 * sees the throw, so both are the caller's.
 */

import { MODULE_ID, FLAG_NS } from "../const.js";
import { tInt } from "./tracker-model.js";
import { poolCardView } from "./view.js";
import { poolCardHTML } from "./tracker-render.js";

const L = (k, d) => (d ? game.i18n.format(k, d) : game.i18n.localize(k));

/** Pools with a roll in flight on this client: a double click rolls once. */
const inFlight = new Set();

/**
 * Roll `t` (a clean pool tracker) and post its card.
 *
 * @param {object} t
 * @param {object} o
 * @param {string} o.key           In-flight key (store scope + tracker id).
 * @param {string[]|null} o.whisper  Card + dice audience, or null for everyone.
 * @param {object} o.speaker       ChatMessage speaker data.
 * @param {object} o.flags         Extra flag fields (actorPool, actorId…).
 * @param {(remaining:number, faces:number[])=>Promise<void>} [o.before]
 *        Runs after the dice settle and before the card posts (an owner's own
 *        write, so the sheet catches up as the card lands).
 */
export async function rollPool(t, { key, whisper = null, speaker, flags = {}, before = null }) {
  if (t?.type !== "pool" || inFlight.has(key)) return null;
  const n = tInt(t.current, 0);
  if (n <= 0) return null;             // an exhausted pool stays empty until it is refilled
  inFlight.add(key);
  try {
    const size = tInt(t.size, 6);
    const discard = tInt(t.discard, 2);
    const roll = await new Roll(`${n}d${size}`).evaluate();
    const faces = roll.dice[0]?.results?.map((r) => r.result) ?? [];
    const card = poolCardView({ name: t.name, faces, size, discard, before: n });

    // Throw the dice for the card's audience and wait for them to settle before
    // the result lands. synchronize=true broadcasts in the roller's colours.
    if (game.dice3d) {
      try { await game.dice3d.showForRoll(roll, game.user, true, whisper ?? null); }
      catch (err) { console.warn(`${MODULE_ID} | Dice So Nice roll failed`, err); }
    }

    await before?.(card.after, faces);

    // No Roll is attached, so Foundry draws no second dice box. The flags carry
    // the faces: whoever persists the result re-derives the count from them.
    await ChatMessage.implementation.create({
      speaker,
      content: poolCardHTML(card, L),
      ...(whisper ? { whisper } : {}),
      flags: {
        [MODULE_ID]: {
          [FLAG_NS]: {
            poolRoll: true,
            requestedBy: game.user.id,
            trackerId: t.id,
            current: card.after,
            faces, size, discard, before: n,
            ...flags,
          },
        },
      },
    });
    return card;
  } finally {
    inFlight.delete(key);
  }
}
