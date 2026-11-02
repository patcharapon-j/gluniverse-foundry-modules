/**
 * Diorama view — which Levels of a multi-Level scene the 3D view draws, and
 * how. Pure: the overlay hands it the Levels (terrain/levels.mjs levelsOf)
 * and the viewed Level's id; it reads no globals.
 *
 * The viewed Level is the one Foundry views on the canvas (`scene._view`). The
 * 3D view never picks its own: switching Level is Foundry's (the scene
 * navigation's Level buttons, a token taking a staircase), which redraws the
 * canvas, and the view follows on canvasReady.
 *
 *   • The viewed Level is the board: lit, walked on, picked.
 *   • Levels BELOW it are drawn as quieter floors, each at its own base, when
 *     this viewer may see them: Foundry draws a Level's art while another is
 *     viewed only when the viewed Level lists it in `visibility.levels`
 *     (Level#isVisible, Scene#_configureLevelTextures), so a player gets exactly
 *     those. The GM's own view (not "view as players") also gets the rest, as
 *     dimmer ghosts, so a GM can see the whole stack.
 *   • Levels ABOVE it (a higher base) are cut away, never drawn: the floor you
 *     are on is never covered by the one over it. A Level at the same base is
 *     treated as above.
 *   • A token keeps Foundry's visibility (token.isVisible is the truth); one
 *     standing on a cut-away Level becomes a ghost, which the GM sees faded and
 *     a player's renderer does not draw at all.
 */

/** How much of the scene's light a visible floor below keeps, per Level down. */
export const BELOW_DIM = 0.72;
/** A floor the GM sees that the players would not, on top of BELOW_DIM. */
export const GHOST_DIM = 0.55;
/** Floors below the viewed one drawn at most (the nearest ones). */
export const MAX_BELOW = 4;

/**
 * @param {ReturnType<import("../terrain/levels.mjs").levelsOf>} levels  lowest first
 * @param {string|null} viewedId
 * @param {{gm?: boolean}} [o]  the GM's own view (not "view as players")
 * @returns {{viewed: object|null, below: Array<object & {dim:number, ghost:boolean, depth:number}>, cut: Set<string>}}
 */
export function stackPlan(levels, viewedId, { gm = false } = {}) {
  const list = Array.isArray(levels) ? levels : [];
  const viewed = list.find((l) => l.id === viewedId) ?? null;
  const cut = new Set();
  const below = [];
  if (!viewed || list.length < 2) return { viewed, below, cut };
  const lower = [];
  for (const l of list) {
    if (l.id === viewed.id) continue;
    if (l.base < viewed.base) lower.push(l);
    else cut.add(l.id);
  }
  // nearest first, so the depth (and the dim) counts down from the viewed floor
  lower.sort((a, b) => b.base - a.base);
  for (const l of lower) {
    const seen = viewed.visible?.has?.(l.id) ?? false;
    if (!seen && !gm) continue;
    if (below.length >= MAX_BELOW) break;
    const depth = below.length + 1;
    below.push({ ...l, depth, ghost: !seen, dim: BELOW_DIM ** depth * (seen ? 1 : GHOST_DIM) });
  }
  below.reverse(); // lowest first
  return { viewed, below, cut };
}

/**
 * Tokens on a cut-away Level: in the GM's own view they become ghosts
 * (TokenState.ghost, drawn faded); in any other view they leave the board
 * altogether, so nothing hangs a line, an aura or a reach off a figure that is
 * not drawn. Everything else passes untouched.
 * @param {object[]} tokens  TokenState[]
 * @param {(id:string) => string|null} levelOf  a token id's Level
 * @param {Set<string>} cut
 * @param {{gm?: boolean}} [o]
 */
export function cutTokens(tokens, levelOf, cut, { gm = false } = {}) {
  if (!cut?.size) return tokens;
  const out = [];
  for (const tk of tokens ?? []) {
    if (!cut.has(levelOf(tk.id))) { out.push(tk); continue; }
    if (gm) out.push(tk.ghost ? tk : { ...tk, ghost: true });
  }
  return out;
}

/**
 * The renderer's setLevels() input for a plan: each floor below, its terrain
 * already in the absolute frame and its art if loaded. Pure.
 * @param {ReturnType<typeof stackPlan>} plan
 * @param {(id:string) => object|null} terrainOf  absolute ground of a Level
 * @param {(id:string) => any} imageOf  loaded art, or null
 * @param {object|null} rect  the scene rect (px)
 */
export function levelInputs(plan, terrainOf, imageOf, rect = null) {
  const out = [];
  for (const l of plan?.below ?? []) {
    const terrain = terrainOf(l.id);
    if (!terrain) continue;
    out.push({ id: l.id, terrain, image: imageOf(l.id) ?? null, rect, dim: l.dim });
  }
  return out;
}

/** A stable key for a plan, so an unchanged stack costs no rebuild. */
export function planKey(plan) {
  if (!plan?.viewed) return "";
  return `${plan.viewed.id}@${plan.viewed.base}|${(plan.below ?? []).map((l) => `${l.id}@${l.base}:${l.ghost ? 1 : 0}`).join(",")}|${[...(plan.cut ?? [])].sort().join(",")}`;
}
