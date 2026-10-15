/**
 * The landing — the badge's face pulse and stamp, and the degree on the Dice
 * So Nice die (`od.dice`) — conducted from one place, on one clock.
 *
 * When a PF2e check is posted, this asks landing.mjs what THIS viewer may see
 * land, waits once for the kept d20 to come to rest (dice-watch.mjs; at once
 * when there is no Dice So Nice), and then plays both beats together: the
 * badge on the targeting line (line-badges.mjs `land`) and a ring in the
 * degree's colour around the die with its stamp — Crit, Hit, Miss, Fumble; or
 * Crit success … Crit fail — beneath it.
 *
 * The ring is a DOM layer stacked directly above DSN's board, never a
 * material: Spotlight Roll's `dsn-host.mjs` stays the only file that reaches
 * into DSN, and only to READ where a die rests. The layer is re-stacked on
 * every draw, because DSN's "auto" layering raises its board above whichever
 * window is open each time it shows a throw.
 *
 * Spotlight Roll's own messages get no ring — that feature draws its own die.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { boardContainer, boardState } from "../spotlight-roll/dsn-host.mjs";
import { SETTINGS, TIMING } from "./constants.mjs";
import { createDiceWatch } from "./dice-watch.mjs";
import { landingOf } from "./landing.mjs";
import { diceHTML } from "./render.mjs";
import { get } from "./settings.mjs";

const DSN_ID = "dice-so-nice";
let layer = null;
let watch = null;
let wired = false;

/**
 * DSN builds `game.dice3d` in its OWN ready hook, which may run after ours,
 * so the module being active is the whole test: the hooks below need nothing
 * from `game.dice3d` to register, and read the board only while a throw runs.
 */
export const dsnActive = () => !!game.modules?.get(DSN_ID)?.active;

const L = (key) => (typeof key === "string" && key ? game.i18n.localize(key) : "");

/** The overlay sits directly above DSN's board, at whatever height DSN gave it this throw. */
function mountLayer() {
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "glod-dice";
    layer.className = "glod-dice-layer gl-type";
  }
  const board = boardContainer();
  if (board?.isConnected) {
    if (layer.previousElementSibling !== board) board.after(layer);
    // DSN's three layerings: "over" 1000, "auto" raised above the open window
    // per throw, and "under" — no z-index, placed after #board. Copy all three,
    // `auto` included: falling back to this sheet's HUD height would lift the
    // ring over interface layers that cover the die it belongs to.
    layer.style.zIndex = board.style.zIndex || getComputedStyle(board).zIndex || "auto";
  } else if (!layer.isConnected) {
    document.body.append(layer);
  }
  return layer;
}

function draw(landing, die, motion) {
  const root = mountLayer();
  const el = document.createElement("div");
  el.className = "glod-dice";
  el.style.setProperty("--glod-die-x", `${Math.round(die.x)}px`);
  el.style.setProperty("--glod-die-y", `${Math.round(die.y)}px`);
  el.style.setProperty("--glod-die-r", `${Math.round(die.r)}px`);
  el.innerHTML = diceHTML(landing, { t: L });
  root.append(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), TIMING.leave * Math.max(0, motion));
  }, Math.max(TIMING.diceHoldMin, TIMING.diceHold * (motion || 1)));
}

/**
 * Every check holds the badges it touches (line-badges.mjs `hold`) from the
 * moment it is posted, and this releases them once the die has landed and the
 * stamp has been read — so a number never moves while its die is in the air.
 */
async function onMessage(message, deps) {
  const lines = deps.badges();
  const held = !!lines?.hold(message);
  let landed = false;
  try {
    landed = await play(message, deps, held);
  } finally {
    const m = deps.motion();
    lines?.release(message.id, landed ? Math.max(TIMING.diceHoldMin, TIMING.stampHold * (m || 1)) : 0);
  }
}

/** The landing beats; true when the badge's beat played. */
async function play(message, { badges, motion }, held) {
  const landing = landingOf(message);
  const lines = badges();
  const shed = lines?.ladder?.allows("landBeat") === false;
  const badge = !!landing && !shed && !!lines?.hasLine(landing);
  // Spotlight Roll posts its card at its own degree beat and tells DSN to skip
  // it: no throw is coming, so nothing waits for one and no ring is drawn.
  const spotlight = !!message.flags?.[SUITE_ID]?.spotlight;
  const ring = !!landing && !shed && watch && landing.degree != null && get(SETTINGS.dice, true) && !spotlight;
  // A held badge waits for the die too, even with no beat of its own to play.
  if (!badge && !ring && !held) return false;
  const die = watch && !spotlight ? await watch.wait(message.id) : null;
  // Deleted while its die was in the air: the roll is gone, so nothing lands.
  if (!game.messages?.get(message.id)) return false;
  const m = motion();
  if (badge) badges()?.land(landing, m);
  if (ring && die) draw(landing, die, m);
  return badge;
}

/**
 * @param {{badges: () => object|null, motion: () => number}} deps
 */
export function wireLanding(deps) {
  if (wired) return;
  wired = true;
  if (dsnActive()) {
    watch = createDiceWatch({
      readBoard: boardState,
      poll: TIMING.dicePoll,
      startGrace: TIMING.diceStartGrace,
      spawnGrace: TIMING.diceSpawnGrace,
      maxWait: TIMING.diceWait,
    });
    Hooks.on("diceSoNiceRollStart", (messageId, context) => {
      // Only checks are watched; DSN's direct showForRoll calls carry no message.
      if (!messageId || !game.messages?.get(messageId)?.flags?.pf2e?.context) return;
      watch?.start(messageId, context?.dsnRoll ?? context?.roll);
    });
    Hooks.on("deleteChatMessage", (message) => watch?.forget(message?.id));
  }
  Hooks.on("createChatMessage", (message) => {
    onMessage(message, deps).catch((error) => warn("pf2e-odds | landing failed", error));
  });
}
