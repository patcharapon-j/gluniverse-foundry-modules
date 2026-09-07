/**
 * GLUniverse Suite — the GM's manual surge.
 *
 * A right-click entry on any chat card that forces a surge onto it, plays the
 * beat, and posts the severity card. It exists because the automatic check can
 * only ever see what PF2e tells it: a spell cast through a macro, an ability
 * the GM rules is spell-like, a ritual the draft leaves to adjudication, or a
 * casting the check quite reasonably skipped and the GM has decided should count
 * anyway. Without this the GM's only options are to narrate a surge with no
 * ceremony behind it, or to fake one by casting something.
 *
 * The entry is GM-only, and it is deliberately available on cards that already
 * have a check: `Surge again` is a legitimate thing for a GM to want, and the
 * banner records that the result was applied by hand rather than rolled, so the
 * table can tell the difference between the system saying so and the GM saying
 * so.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { emitSocket } from "../../core/socket.mjs";
import { playBurst } from "./burst.mjs";
import { FEATURE_ID, FLAGS } from "./constants.mjs";
import { isPlayerCast } from "./check.mjs";
import { resolveExposure } from "./levels.mjs";
import { postSeverityCard } from "./severity.mjs";
import { currentLevel, levelConfig } from "./settings.mjs";

export function registerContextMenu() {
  // Foundry v13+ fires the V2 hook; the legacy name is kept so the entry does
  // not silently vanish on an older client.
  Hooks.on("getChatMessageContextOptions", addEntries);
  Hooks.on("getChatLogEntryContext", addEntries);
}

function addEntries(_app, options) {
  if (!Array.isArray(options)) return;
  // Guard against both hooks firing on the same client, which would otherwise
  // show the entry twice.
  if (options.some((entry) => entry?.name === "GLAS.context.surge")) return;

  options.push({
    name: "GLAS.context.surge",
    icon: '<i class="fa-solid fa-burst"></i>',
    condition: (li) => game.user.isGM && !!resolveMessage(li),
    callback: (li) => applyManualSurge(resolveMessage(li)),
  });
}

/** Both hook generations hand the callback a different shape of element. */
function resolveMessage(li) {
  const el = li instanceof HTMLElement ? li : li?.[0] ?? null;
  const id = el?.dataset?.messageId;
  return id ? game.messages.get(id) : null;
}

/**
 * Force a surge onto a message.
 *
 * No d20 is rolled. The GM has already decided; a die whose result is
 * predetermined would misrepresent the odds, exactly as it would for an invited
 * casting. The banner reads as a GM ruling rather than as a check result.
 */
export async function applyManualSurge(message) {
  if (!game.user.isGM || !message) return null;

  const actor = message.actor ?? message.speakerActor ?? null;
  const playerCast = isPlayerCast(actor);
  const exposure = resolveExposure(currentLevel(), "none", levelConfig());

  /* A manual surge in a Stable area is legitimate — the GM is overriding, and
     the whole point of the entry is to cover what the rules did not. The row
     falls back to the mildest one that exists so the severity card still has a
     table to read against. */
  const row = exposure.effective === "stable" ? "fraying" : exposure.row;

  const check = {
    level: exposure.areaLevel,
    effective: exposure.effective === "stable" ? "fraying" : exposure.effective,
    row,
    threshold: exposure.threshold,
    mode: "none",
    die: null,
    surged: true,
    // A manual surge is never held: the GM is the one triggering it, so there is
    // nothing left for them to decide before the table sees it.
    held: false,
    playerCast,
    manual: true,
    voided: false,
    roll: null,
    user: game.user.id,
    appliedAt: Date.now(),
  };

  await message.setFlag(SUITE_ID, FLAGS.check, check);
  await postSeverityCard(message, check);

  /* Played locally AND broadcast: Foundry does not echo a socket to its sender,
     and the flag's own render path deliberately stands down for manual surges
     (see banner.mjs) so this is the only thing that fires it. */
  playBurst(check.effective);
  emitSocket(FEATURE_ID, { type: "surge", level: check.effective });

  return check;
}
