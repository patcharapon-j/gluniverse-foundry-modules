/**
 * GLUniverse Suite — Arcane Surge lifecycle.
 *
 * Nothing here runs at import time: the adapter is imported unconditionally so
 * its settings exist, but a disabled feature must stay completely inert.
 *
 * This feature deliberately owns NO motion-tier setting. `applyMotionTier()`
 * writes the suite-global `--gl-motion-scale`, so a second feature setting it
 * from its own preference would silently retime Loot Gen, Destiny Dice and
 * Statsblock Import — the three the design system says own that control.
 */

import { log } from "../../core/const.mjs";
import { onSocket } from "../../core/socket.mjs";
import { destroyCracks, syncCracks, warmCracks } from "./cracks.mjs";
import { registerBanner } from "./banner.mjs";
import { destroyBurst, playBurst, warmBurst } from "./burst.mjs";
import { registerCheck } from "./check.mjs";
import { registerContextMenu } from "./context-menu.mjs";
import { FEATURE_ID } from "./constants.mjs";
import { registerSurgeDie } from "./die.mjs";
import { registerDiceSoNice, registerFontDefinition } from "./dsn.mjs";
import { destroyHud, paint, registerHud } from "./hud.mjs";
import { isLevel } from "./levels.mjs";
import { registerSeverityRendering } from "./severity.mjs";
import { registerSheet } from "./sheet.mjs";
import { armedMode, clearArmedMode } from "./settings.mjs";

export function onInit() {
  registerFontDefinition();
  registerSurgeDie();
  registerCheck();
  registerBanner();
  registerSeverityRendering();
  registerHud();
  registerSheet();
  registerContextMenu();
}

export async function onReady() {
  // Dice So Nice assigns `game.dice3d` after the suite's init phase, so it is
  // read lazily here and through its own ready hook — never at import.
  if (game.dice3d) registerDiceSoNice(game.dice3d);
  else Hooks.once("diceSoNiceReady", (dice3d) => registerDiceSoNice(dice3d));

  /**
   * The only job this feature's socket has.
   *
   * Stability level changes ride the world setting's own `onChange`, and a
   * player-cast surge rides the chat message flag. Neither works for a GM
   * releasing a held NPC surge: by then the message is old, its freshness
   * window has expired on every client, and a flag update alone would play
   * nothing anywhere. The releasing GM plays it locally, because Foundry does
   * not echo a socket back to its sender.
   */
  onSocket(FEATURE_ID, (payload) => {
    if (payload.type === "surge") playBurst(payload.level);
  }, {
    validate: (payload) => payload?.type === "surge" && isLevel(payload.level),
  });

  // paint() attaches the crack canvas to the chip it just drew and syncs it.
  paint();

  /* Warm every shader at load, off-screen.
   *
   * Every pass runs LIVE now, and a GL program is not really
   * compiled when `linkProgram` returns — drivers specialize on first draw. Left
   * cold, the first surge of a session pays for that mid-animation, which is the
   * one moment a stutter is unmissable. This is deferred past the ready frame so
   * it never lengthens world load itself; `requestIdleCallback` where it exists,
   * a short timeout where it does not (Safari).
   */
  const warmAll = () => {
    warmBurst();
    warmCracks();
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(warmAll, { timeout: 4000 });
  else setTimeout(warmAll, 1200);

  // An armed choice must not survive a scene change: a "next cast" a player set
  // an hour ago in a different room is a trap, not a declaration.
  Hooks.on("canvasReady", async () => {
    if (armedMode() !== "none") await clearArmedMode();
    paint();
  });

  log("Arcane Surge | ready");
}

/** Torn down when the feature is disabled live from the Control Center. */
export function teardown() {
  destroyCracks();
  destroyBurst();
  destroyHud();
}

export const api = { paint, syncCracks, playBurst, teardown };
