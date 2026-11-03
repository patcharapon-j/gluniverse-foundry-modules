/**
 * Mythic GME: a roll, from the click to the log.
 *
 * The panel, the quick palette and the api all roll through here, so a roll
 * reads the same Chaos Factor, lists and linked table whichever way it was
 * asked for, and lands in the log once. Rolls are silent: no chat message, no
 * 3D dice, no socket. Nothing leaves this client until the GM posts a card
 * (`chat.mjs`).
 */

import {
  adjustEntry, askFate, chaosEntry, elementEntry, eventEntry, listEntry, meaningEntry, sceneEntry, stamp,
} from "./oracle.mjs";
import {
  autoEvent, canWriteWorld, getChaos, pushLog, readLists, resolveActions1, setChaos, writeUi,
} from "./store.mjs";

const listeners = new Set();

/** Be told when an entry lands: `fn(entry)`. Returns the unsubscribe. */
export function onLogged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

async function land(entry) {
  if (!entry) return null;
  const stamped = stamp(entry);
  await pushLog(stamped);
  for (const fn of listeners) {
    try {
      fn(stamped);
    } catch {
      /* a listener's failure is its own */
    }
  }
  return stamped;
}

const context = async () => ({ actions1: (await resolveActions1()).column, lists: readLists() });

export async function rollAskFate(oddsId, question = "") {
  writeUi({ odds: oddsId });
  const ctx = await context();
  return land(askFate({ oddsId, cf: getChaos(), question, autoEvent: autoEvent(), ...ctx }));
}

export async function rollEvent() {
  return land(eventEntry(await context()));
}

export async function rollCoreMeaning(table) {
  const { actions1 } = await context();
  return land(meaningEntry(table, { actions1 }));
}

export const rollElementTable = (id) => land(elementEntry(id));

export async function rollSceneCheck() {
  return land(sceneEntry({ cf: getChaos(), ...(await context()) }));
}

export const rollAdjustment = () => land(adjustEntry());

/** End a scene: log it and move the Chaos Factor. A player's client only reads. */
export async function endScene(inControl) {
  if (!canWriteWorld()) return null;
  const entry = chaosEntry(getChaos(), inControl);
  await setChaos(entry.to);
  return land(entry);
}

export const rollList = (list) => land(listEntry(list, readLists()[list]));
