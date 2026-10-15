/**
 * The degree on the Dice So Nice die (`od.dice`).
 *
 * When a PF2e check's dice come to rest, a ring in the degree's colour is
 * drawn around the kept d20 and its stamp — Crit, Hit, Miss, Fumble; or Crit
 * success … Crit fail — is set beneath it. It is a DOM layer over DSN's
 * canvas, never a material: Spotlight Roll's `dsn-host.mjs` stays the only file
 * that reaches into DSN, and only to READ where the die landed.
 *
 * Visibility is landing.mjs's: no ring at all when PF2e would hide the result
 * from this viewer. Spotlight Roll's own messages are skipped — that feature
 * draws its own die.
 *
 * The badge's own landing beat waits for the same moment (line-badges.mjs asks
 * DSN to finish the message's animation first), so the face pulses on the
 * targeting line as the die stops rather than when the card was posted.
 */

import { SUITE_ID, warn } from "../../core/const.mjs";
import { boardCanvas, boardDiceIds, landedD20s } from "../spotlight-roll/dsn-host.mjs";
import { SETTINGS, TIMING } from "./constants.mjs";
import { landingOf } from "./landing.mjs";
import { diceHTML } from "./render.mjs";
import { get } from "./settings.mjs";

const DSN_ID = "dice-so-nice";
const before = new Map();
let layer = null;
let wired = false;

/**
 * DSN builds `game.dice3d` in its OWN ready hook, which may run after ours,
 * so the module being active is the whole test: the hooks below need nothing
 * from `game.dice3d` to register, and read the board only when a throw ends.
 */
export const dsnActive = () => !!game.modules?.get(DSN_ID)?.active;

const L = (key) => (typeof key === "string" && key ? game.i18n.localize(key) : "");

/** The overlay sits one step above DSN's own canvas, wherever DSN put it. */
function mountLayer() {
  if (layer?.isConnected) return layer;
  layer = document.createElement("div");
  layer.id = "glod-dice";
  layer.className = "glod-dice-layer gl-type";
  const dsnCanvas = boardCanvas();
  const z = Number.parseInt(dsnCanvas ? getComputedStyle(dsnCanvas).zIndex : "", 10);
  if (Number.isFinite(z)) layer.style.zIndex = String(z + 1);
  document.body.append(layer);
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
  }, Math.max(400, TIMING.diceHold * (motion || 1)));
}

/**
 * Wire both landing beats onto DSN's throw lifecycle.
 * @param {{badges: () => object|null, motion: () => number}} deps
 */
export function wireDiceHighlight({ badges, motion }) {
  if (wired || !dsnActive()) return false;
  wired = true;
  Hooks.on("diceSoNiceRollStart", (messageId) => {
    try {
      before.set(messageId, boardDiceIds());
    } catch {
      before.set(messageId, new Set());
    }
  });
  Hooks.on("diceSoNiceRollComplete", (messageId) => {
    const snapshot = before.get(messageId) ?? new Set();
    before.delete(messageId);
    const message = game.messages?.get(messageId);
    if (!message) return;
    try {
      const landing = landingOf(message);
      if (!landing) return;
      const m = motion();
      if (!get(SETTINGS.dice, true) || message.flags?.[SUITE_ID]?.spotlight) return;
      if (landing.degree == null || badges()?.ladder?.allows("landBeat") === false) return;
      // The kept die: the d20 that shows the natural (the other of a fortune pair stays dark).
      const dice = landedD20s(snapshot);
      const die = dice.find((d) => d.result === landing.face) ?? (dice.length === 1 ? dice[0] : null);
      if (die) draw(landing, die, m);
    } catch (error) {
      warn("pf2e-odds | dice highlight failed", error);
    }
  });
  return true;
}
