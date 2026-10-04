import { getCanvasToken } from "./token-utils.js";

/**
 * Resolve the combat that should drive stream framing for the current canvas scene.
 *
 * Relying on `game.combat` (a.k.a. `game.combats.viewed`) is unreliable for the
 * stream client. `viewed` tracks the combat tracker UI, which the stream client
 * hides, and several systems (D&D5e, PF2e, ...) subclass the tracker and bind their
 * combats to a scene. That can leave `game.combat` null or pointing at a combat on
 * another scene while a combat is genuinely active on the canvas scene, so the camera
 * never switches to the in-combat mode. Instead, scan the combats collection for an
 * encounter on the current scene (or a scene-less encounter), preferring the
 * active/started one, so combat detection no longer depends on tracker view state.
 */
export function getActiveSceneCombat() {
  const sceneId = canvas?.scene?.id ?? null;
  const matches = getCombatsList().filter(combat => {
    const combatSceneId = getCombatSceneId(combat);
    return combatSceneId == null || combatSceneId === sceneId;
  });
  if (!matches.length) return null;
  return matches.find(combat => combat?.active && combat?.started)
    ?? matches.find(combat => combat?.active)
    ?? matches.find(combat => combat?.started)
    ?? matches[0];
}

/**
 * The encounter the stream camera treats as "in combat": one on this scene that has actually begun.
 *
 * `getActiveSceneCombat` answers "is there an encounter here", and falls back to any matching one —
 * including an encounter the GM has prepared and not started, or a scene-less one left over from last
 * session. Driving the camera from that put a table that was plainly out of combat on the *combat*
 * camera mode, so moving or dropping a PC who had been added to the prepared encounter pulled the shot
 * to them while the Control Room's out-of-combat mode said Scene. Combat, for the camera, starts when
 * round 1 does.
 */
export function getRunningSceneCombat() {
  const sceneId = canvas?.scene?.id ?? null;
  const started = getCombatsList().filter(combat => {
    const combatSceneId = getCombatSceneId(combat);
    return combat?.started && (combatSceneId == null || combatSceneId === sceneId);
  });
  return started.find(combat => combat?.active) ?? started[0] ?? null;
}

export function getActiveCombatant(combat) {
  if (combat?.combatant) return combat.combatant;
  const turns = combat?.turns;
  const turn = combat?.turn;
  if (Array.isArray(turns) && Number.isInteger(turn)) return turns[turn] ?? null;
  return null;
}

export function getCombatantToken(combatant) {
  const direct = combatant?.token?.object ?? combatant?.tokenObject ?? combatant?.object;
  if (direct?.document) return direct;
  const tokenDocument = combatant?.token;
  if (tokenDocument?.object?.document) return tokenDocument.object;
  return getCanvasToken(combatant?.tokenId ?? tokenDocument?.id ?? combatant?.token?.document?.id);
}

export function getCombatants(combat) {
  const combatants = combat?.combatants;
  if (!combatants) return [];
  if (Array.isArray(combatants)) return combatants;
  if (typeof combatants.contents !== "undefined") return combatants.contents;
  return Array.from(combatants);
}

export function getCombatSceneId(combat) {
  const scene = combat?.scene;
  if (typeof scene === "string") return scene || null;
  return scene?.id ?? combat?.sceneId ?? null;
}

function getCombatsList() {
  const collection = game.combats;
  const list = collection?.contents ?? (Array.isArray(collection) ? collection : null);
  if (list?.length) return list;
  return game.combat ? [game.combat] : [];
}
