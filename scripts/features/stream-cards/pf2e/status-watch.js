/**
 * The hooks behind the status cards.
 *
 * Registered once, from this feature's `onReady`, and pointed at whichever status feed the current chat
 * overlay owns. The overlay is torn down and rebuilt every time stream mode is toggled, so the hooks
 * cannot belong to a feed instance — three listeners per rebuild is a leak that shows up as one
 * condition drawing four cards after an evening of toggling.
 *
 * The sink is bound by `RollCardFeed`, which is the thing the overlay actually holds. With no overlay
 * (stream mode off, a non-PF2e world, this feature disabled) the sink is null and every hook is a
 * single map lookup.
 *
 * `preUpdateItem` is deliberately absent: it only fires on the client that made the change, which is
 * never the stream client, so the previous value is remembered in the feed instead.
 */

import { warn } from "../../../core/const.mjs";

let sink = null;
let registered = false;

/** Called by the roll-card feed as it is built. The last overlay to be built wins, which is the live one. */
export function bindStatusSink(feed) {
  sink = feed ?? null;
}

export function currentStatusSink() {
  return sink;
}

/** Idempotent: the feature's onReady may run again in a world that re-enables it without a reload. */
export function registerStatusHooks() {
  if (registered) return;
  registered = true;
  Hooks.on("createItem", (item) => dispatch("handleCreate", item));
  Hooks.on("deleteItem", (item) => dispatch("handleDelete", item));
  Hooks.on("updateItem", (item, changed) => dispatch("handleUpdate", item, changed));
}

function dispatch(method, item, changed) {
  if (!sink || !isStatusItem(item)) return;
  try {
    sink[method](item, changed);
  } catch (error) {
    warn("Stream cards: a status change could not be drawn:", error);
  }
}

/** A condition or effect on an actor. Anything else — gear, spells, world items — is not a status. */
function isStatusItem(item) {
  if (item?.type !== "condition" && item?.type !== "effect") return false;
  return item.parent?.documentName === "Actor";
}
