/**
 * Hexcrawl — party tokens. A party token is any token carrying
 * flags[SUITE_ID].hex.party.on; its hex is read off the DOCUMENT position
 * (Foundry updates it to the destination immediately, while the placeable is
 * still animating), through TokenDocument#getCenterPoint so a hex-shaped token
 * of any size resolves to the hex Foundry itself would snap it to.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { FLAGS } from "./constants.mjs";

export const partyFlag = (doc) => doc?.getFlag?.(SUITE_ID, FLAGS.party) ?? null;
export const isParty = (doc) => !!partyFlag(doc)?.on;

/**
 * Pixel centre of a token document, optionally at a candidate position.
 *
 * Position comes from `_source`, never the prepared `doc.x`/`doc.y`: under v14's
 * movement API the prepared values hold the ANIMATED position, so inside the
 * very updateToken hook that moved the token they still say where it was —
 * every hex read off them is the hex being left (the move reveals nothing and
 * records nothing, silently). `_source` is the committed destination.
 */
export function tokenCenter(doc, data = {}) {
  const src = doc?._source ?? doc ?? {};
  data = { x: data.x ?? src.x ?? doc.x, y: data.y ?? src.y ?? doc.y };
  if (typeof doc?.getCenterPoint === "function") {
    const p = doc.getCenterPoint(data);
    return { x: p.x, y: p.y };
  }
  const grid = doc?.parent?.grid ?? canvas?.grid;
  const x = data.x, y = data.y;
  return { x: x + (doc.width * (grid?.sizeX ?? 100)) / 2, y: y + (doc.height * (grid?.sizeY ?? 100)) / 2 };
}

export const tokenKey = (adapter, doc, data = {}) => adapter.keyAt(tokenCenter(doc, data));

/** Effective sight of a party token: its own override, else the scene's. */
export function partySight(doc, map) {
  const s = partyFlag(doc)?.sight;
  return Number.isFinite(Number(s)) && s !== null && s !== "" ? Math.max(0, Math.min(6, Math.round(Number(s)))) : map.config.sight;
}

/**
 * Every party token on a scene as [{ id, key, sight, doc }].
 * `viewer` false → all of them (the reveal is a fact about the world);
 * true → only those this client may see (a hidden token draws no marker).
 */
export function partyCentres(scene, adapter, map, { viewer = false } = {}) {
  const out = [];
  for (const doc of scene?.tokens ?? []) {
    if (!isParty(doc)) continue;
    if (viewer && doc.hidden && !game.user.isGM) continue;
    const key = tokenKey(adapter, doc);
    if (!adapter.inBounds(key)) continue;
    out.push({ id: doc.id, key, sight: partySight(doc, map), doc });
  }
  return out;
}

/** Top-left document position that puts a token's centre on hex `key`. */
export function positionForKey(adapter, doc, key) {
  const c = adapter.center(key);
  const o = tokenCenter(doc, { x: 0, y: 0 });
  return { x: Math.round(c.x - o.x), y: Math.round(c.y - o.y) };
}
