/**
 * Hexcrawl — party movement: the rules, travel, auto-reveal, and undo.
 *
 * Three clients, three jobs:
 *
 *   MOVING client (preUpdateToken) — enforces the rules a player is held to
 *     (players may move at all? one hex at a time? on the map?) and TAGS the
 *     update: options.glhex = { travel, from }. `from` is computed here because
 *     this is the only client that still has the old position in hand; the
 *     updateToken diff elsewhere carries the new one only. A GM drag is a
 *     reposition unless Alt is held at drag time.
 *
 *   ACTIVE GM (updateToken) — the single writer. Reveals around the party on
 *     every move, travel or not; for travel, also costs time, records the move
 *     and posts the arrival card. One GM, `game.users.activeGM`, so two GMs
 *     never both write the reveal and double-advance the clock.
 *
 *   EVERY client — plays its own step sound (sounds.mjs); the reveal sound
 *     comes from each client's store diff, not from here.
 *
 * Nothing on this path ever LOWERS a hex state: autoRevealPatch only raises,
 * and undoing a move only clears the `vs` (visited) marks that move added.
 * Knowledge the party gained is not taken back by rewinding the walk.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";
import { FLAGS, MOVE_HISTORY_CAP } from "./constants.mjs";
import { distance, foundryAdapter, isHexType, line, unionRange } from "./hex-math.mjs";
import { autoRevealPatch, costSeconds, isBorder, travelCost } from "./model.mjs";
import { L } from "./labels.mjs";
import { isParty, partyCentres, positionForKey, tokenKey } from "./party.mjs";
import { hexPatchUpdate, isHexcrawlScene, readMap } from "./store.mjs";
import { playSound } from "./sounds.mjs";

/** Scene flag holding the current journey leg id (the arrival card's "New leg"). */
export const LEG_FLAG = "hex.leg";

const MOVES_PATH = `flags.${SUITE_ID}.hex.moves`;

/**
 * An adapter for ANY scene, not just the one on the canvas: the active GM may
 * be looking at a different scene while a player walks the party. Scene#grid
 * is Foundry's own grid instance for that scene, so this still defers to
 * Foundry for every pixel↔hex question.
 */
export function sceneAdapter(scene) {
  if (!scene?.grid || !isHexType(scene.grid.type)) return null;
  if (scene === canvas?.scene && canvas.ready) return foundryAdapter(canvas.grid, canvas.dimensions.sceneRect);
  const dims = scene.dimensions ?? scene.getDimensions?.();
  return foundryAdapter(scene.grid, dims?.sceneRect ?? null);
}

const moved = (changes) => changes && ("x" in changes || "y" in changes);

const altHeld = () => {
  try {
    const KM = foundry.helpers?.interaction?.KeyboardManager ?? globalThis.KeyboardManager;
    return !!game.keyboard?.isModifierActive?.(KM?.MODIFIER_KEYS?.ALT ?? "Alt");
  } catch { return false; }
};

/* ── Moving client ──────────────────────────────────────────────────────── */

export function onPreUpdateToken(doc, changes, options, userId) {
  if (userId && userId !== game.user.id) return;
  if (!moved(changes) || options?.glhex?.undo) return;
  const scene = doc.parent;
  if (!isHexcrawlScene(scene) || !isParty(doc)) return;
  const adapter = sceneAdapter(scene);
  if (!adapter) return;

  const from = tokenKey(adapter, doc);
  const to = tokenKey(adapter, doc, { x: changes.x ?? doc._source.x, y: changes.y ?? doc._source.y });

  if (!game.user.isGM) {
    const map = readMap(scene);
    if (!map.config.playersMove) {
      ui.notifications.warn(L("GLHEX.notify.playersCannotMove"));
      return false;
    }
    // Off the scene and off the map are the same refusal to a player: a border
    // hex is not somewhere they were told they could not go, it is not a place.
    if (!adapter.inBounds(to) || isBorder(map, to)) {
      ui.notifications.warn(L("GLHEX.notify.offMap"));
      return false;
    }
    if (from !== to && distance(adapter, from, to) > 1) {
      ui.notifications.warn(L("GLHEX.notify.oneHex"));
      return false;
    }
    options.glhex = { travel: from !== to, from };
    return;
  }
  options.glhex = { travel: altHeld() && from !== to, from };
}

/* ── Every client ───────────────────────────────────────────────────────── */

export function onUpdateTokenAll(doc, changes, options) {
  if (!moved(changes) || options?.glhex?.undo) return;
  if (!isHexcrawlScene(doc.parent) || !isParty(doc)) return;
  if (doc.parent !== canvas?.scene) return;
  if (doc.hidden && !game.user.isGM) return;
  playSound("step");
}

/* ── Active GM ──────────────────────────────────────────────────────────── */

const isActiveGM = () => !!game.user.isGM && (game.users.activeGM?.id ?? game.user.id) === game.user.id;

/** Did this update touch our token flags? Checked on flattened keys, because a
 *  dotted setFlag key arrives literally (flags[scope]["hex.party"]) under one
 *  write path and nested under another. The VALUE is then read off the document. */
function touchedHexFlag(changes) {
  const f = changes?.flags?.[SUITE_ID];
  if (f === undefined) return false;
  if (!f || typeof f !== "object") return true;
  return Object.keys(foundry.utils.flattenObject(f)).some((k) => /^(-=|==)?hex(\.|$)/.test(k));
}

/** Serialise the GM's writes per scene: two quick moves must not interleave. */
const queues = new Map();
function enqueue(sceneId, fn) {
  const prev = queues.get(sceneId) ?? Promise.resolve();
  const next = prev.then(fn).catch((e) => warn("hexcrawl | move processing failed", e));
  queues.set(sceneId, next);
  return next;
}

export function onUpdateTokenGM(doc, changes, options) {
  if (!isActiveGM()) return;
  const scene = doc.parent;
  if (!isHexcrawlScene(scene)) return;

  const partyChanged = touchedHexFlag(changes);
  if (partyChanged && isParty(doc) && !moved(changes)) {
    // Newly flagged as party (or its sight changed): reveal around it, no record.
    enqueue(scene.id, () => revealAround(scene));
    return;
  }
  if (!moved(changes) || options?.glhex?.undo || !isParty(doc)) return;
  enqueue(scene.id, () => processMove(scene, doc, options?.glhex ?? {}));
}

/** Reveal everything the party can see right now (no travel, no record). */
export async function revealAround(scene) {
  const adapter = sceneAdapter(scene);
  if (!adapter) return;
  const map = readMap(scene);
  const centres = partyCentres(scene, adapter, map);
  if (!centres.length) return;
  const patch = autoRevealPatch(map, { entered: centres.map((c) => c.key), seen: unionRange(adapter, centres) });
  const upd = hexPatchUpdate(patch);
  if (Object.keys(upd).length) await scene.update(upd);
}

async function processMove(scene, doc, tag) {
  const adapter = sceneAdapter(scene);
  if (!adapter) return;
  const map = readMap(scene);
  const to = tokenKey(adapter, doc);          // off the DOCUMENT: its x/y is already the destination
  // A GM may reposition the party onto the black (nothing stops a GM drag), but
  // nothing follows from it: no reveal, no cost, no record, no arrival card.
  if (!adapter.inBounds(to) || isBorder(map, to)) return;
  const from = typeof tag.from === "string" ? tag.from : null;
  const centres = partyCentres(scene, adapter, map);
  const patch = autoRevealPatch(map, { entered: [to], seen: unionRange(adapter, centres) });
  const upd = hexPatchUpdate(patch);

  const travel = !!tag.travel && !!from && from !== to;
  let record = null;
  if (travel) {
    const cost = travelCost(map, to);
    const seconds = costSeconds(map.config, cost);
    record = {
      id: foundry.utils.randomID(),
      token: doc.id,
      from, to, cost, seconds,
      visited: map.hexes[to]?.vs ? [] : [to],
      trail: line(adapter, from, to),
      at: Date.now(),
      advanced: false,
      leg: String(scene.getFlag(SUITE_ID, LEG_FLAG) ?? "0"),
    };
    if (map.config.advanceTime && seconds > 0 && Suite.enabled("clocks-tracker")) record.advanced = true;
    const moves = scene.getFlag(SUITE_ID, FLAGS.moves);
    upd[MOVES_PATH] = [...(Array.isArray(moves) ? moves : []), record].slice(-MOVE_HISTORY_CAP);
  }

  if (Object.keys(upd).length) await scene.update(upd);
  if (record?.advanced) {
    try { await game.time.advance(record.seconds); } catch (e) { warn("hexcrawl | time advance failed", e); }
  }
  if (record && map.config.arrivalCard) {
    const { postArrivalCard } = await import("./arrival.mjs");
    await postArrivalCard(scene, record);
  }
}

/* ── Undo last move (GM, token HUD) ─────────────────────────────────────── */

export function lastMove(scene) {
  const moves = scene?.getFlag(SUITE_ID, FLAGS.moves);
  return Array.isArray(moves) && moves.length ? moves[moves.length - 1] : null;
}

export async function undoLastMove(scene) {
  if (!game.user.isGM || !scene) return false;
  return enqueue(scene.id, async () => {
    const moves = scene.getFlag(SUITE_ID, FLAGS.moves);
    const list = Array.isArray(moves) ? [...moves] : [];
    const rec = list.pop();
    if (!rec) return false;
    const adapter = sceneAdapter(scene);
    const doc = scene.tokens.get(rec.token);
    if (doc && adapter && typeof rec.from === "string") {
      await doc.update(positionForKey(adapter, doc, rec.from), { glhex: { undo: true } });
    }
    if (rec.advanced && rec.seconds > 0) {
      try { await game.time.advance(-rec.seconds); } catch (e) { warn("hexcrawl | time rewind failed", e); }
    }
    // Clear only the visited marks this move added. States are never lowered.
    const map = readMap(scene);
    const patch = {};
    for (const k of Array.isArray(rec.visited) ? rec.visited : []) {
      const h = map.hexes[k];
      if (!h?.vs) continue;
      const n = structuredClone(h); delete n.vs;
      patch[k] = n;
    }
    const upd = hexPatchUpdate(patch);
    upd[MOVES_PATH] = list;
    await scene.update(upd);
    return true;
  });
}

/** Total seconds of the recorded moves in the current leg. */
export function legSeconds(scene) {
  const leg = String(scene.getFlag(SUITE_ID, LEG_FLAG) ?? "0");
  const moves = scene.getFlag(SUITE_ID, FLAGS.moves);
  return (Array.isArray(moves) ? moves : []).filter((m) => String(m?.leg ?? "0") === leg)
    .reduce((a, m) => a + (Number(m?.seconds) || 0), 0);
}

export async function newLeg(scene) {
  if (!game.user.isGM || !scene) return;
  await scene.setFlag(SUITE_ID, LEG_FLAG, foundry.utils.randomID());
}
