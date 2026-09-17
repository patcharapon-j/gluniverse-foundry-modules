/**
 * GLUniverse Stream — suite identity.
 *
 * Ported from the standalone `gluniverse-stream` module, which became three
 * features rather than one:
 *
 *   `stream`          this one — the stream client: mode, UI hiding, camera,
 *                     chat and dialog overlays, and the control panel.
 *   `stream-cards`    PF2e roll cards and portrait framing. Renders *into* this
 *                     feature's overlay, so it nests under `stream.card`.
 *   `stream-targets`  combat targeting arcs. Draws on every client, not just
 *                     the stream one, so it is a sibling under `tgt.` and runs
 *                     with this feature disabled.
 *
 * Nothing here may collide with `stream-pacer` (prefix `sp.`), which despite
 * the name is a table-pacing and safety tool and shares no scope with this.
 */

export const FEATURE_ID = "stream";

/**
 * Every setting key this feature owns is prefixed with this, and the same
 * string is declared as `settingPrefix` in the adapter. The catalog routes on
 * it: a key whose prefix does not match is hidden from Foundry's native sheet
 * *and* absent from the Control Center, i.e. reachable only from the console.
 */
export const PREFIX = "stream.";

/** The child feature's prefix, strictly longer so the catalog claims it first. */
export const CARDS_PREFIX = "stream.card";
export const CARDS_FEATURE_ID = "stream-cards";

/** The sibling's prefix. Not nested — it is configurable with `stream` off. */
export const TARGETS_PREFIX = "tgt.";
export const TARGETS_FEATURE_ID = "stream-targets";
