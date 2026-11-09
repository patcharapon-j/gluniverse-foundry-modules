/**
 * Diorama — the stream capture's 2D / 3D switch, in stream's Control Room.
 *
 * A director (the GM, or a trusted director) chooses whether the capture shows
 * the 2D map or the 3D view, and the capture obeys. Everything rides `stream`'s
 * own channels through its extension slots (stream/extensions.mjs), so `stream`
 * still imports nothing of ours:
 *
 *   command  `diorama.view` { mode: "2d" | "3d" }, sent as the director's own
 *            User-flag command (director-auth.mjs). Only the stream client runs
 *            it, and only for an author that is a director.
 *   status   `diorama` { view, offered } in the stream client's status report,
 *            so the room shows what the capture has up right now.
 *   section  "Board view" on the Shot tab: two pressed-state buttons.
 *
 * The switch is momentary: the capture still joins the GM's invite when the GM
 * next opens the view, and leaves on a scene the view cannot show.
 */

import { escapeHTML } from "../../core/util.mjs";
import {
  registerPanelSection, registerStatusField, registerStreamCommand,
  reportStreamStatus, sendStreamCommand, streamClientStatus,
} from "../stream/extensions.mjs";

export const STREAM_VIEW_COMMAND = "diorama.view";
export const STREAM_STATUS_FIELD = "diorama";
export const VIEW_MODES = Object.freeze(["2d", "3d"]);

const ACTION = Object.freeze({ "gldio-stream-2d": "2d", "gldio-stream-3d": "3d" });

/** What a director's command asks for, or null for anything that is not a mode. Pure. */
export function viewModeOf(args) {
  const mode = String(args?.mode ?? "").toLowerCase();
  return VIEW_MODES.includes(mode) ? mode : null;
}

/**
 * The section's state from the capture's last status report. Pure.
 * @param {object|undefined} status  stream's client status
 */
export function roomState(status) {
  const live = Boolean(status?.active);
  const field = status?.features?.[STREAM_STATUS_FIELD];
  const view = VIEW_MODES.includes(field?.view) ? field.view : null;
  return { live, view, offered: field?.offered !== false };
}

/** The section's markup. Pure: `t` localises. */
export function sectionHtml(state, t) {
  const off = !state.live || !state.offered;
  const btn = (mode, icon, key) => {
    const on = state.live && state.view === mode;
    return `<button type="button" data-action="gldio-stream-${mode}" aria-pressed="${on ? "true" : "false"}"${off ? " disabled" : ""}>`
      + `<i class="fa-solid ${icon}" aria-hidden="true"></i> ${escapeHTML(t(key))}</button>`;
  };
  const hint = !state.live ? "GLDIO.stream.hintOffAir" : !state.offered ? "GLDIO.stream.hintUnsupported" : "GLDIO.stream.hint";
  return `<section class="gluniverse-stream-panel">`
    + `<h2>${escapeHTML(t("GLDIO.stream.heading"))}</h2>`
    + `<span class="gluniverse-stream-segmented" role="group" aria-label="${escapeHTML(t("GLDIO.stream.heading"))}">`
    + btn("2d", "fa-map", "GLDIO.stream.map2d") + btn("3d", "fa-cubes", "GLDIO.stream.view3d")
    + `</span>`
    + `<p class="gluniverse-stream-form-hint">${escapeHTML(t(hint))}</p>`
    + `</section>`;
}

let _wired = false;

/**
 * Called from onReady. `view` opens, closes and reads the 3D view on this client.
 * @param {{open: () => Promise<boolean>, close: () => boolean, isOpen: () => boolean, offered: () => boolean}} view
 */
export function wireStreamBridge(view) {
  if (_wired) return;
  _wired = true;
  // The stream client: obey a director's switch.
  registerStreamCommand(STREAM_VIEW_COMMAND, async (args) => {
    const mode = viewModeOf(args);
    // a scene the view cannot show is refused quietly: a warning there would be on the broadcast
    if (mode === "3d" && !view.isOpen() && view.offered()) await view.open();
    else if (mode === "2d" && view.isOpen()) view.close();
  });
  registerStatusField(STREAM_STATUS_FIELD, () => ({ view: view.isOpen() ? "3d" : "2d", offered: view.offered() }));
  // The room: a director's two buttons. Not gmOnly: commands are a director's own channel.
  registerPanelSection({
    id: "diorama",
    tab: "shot",
    order: -10,
    render: () => sectionHtml(roomState(streamClientStatus()), (k) => game.i18n.localize(k)),
    action: async (action) => {
      const mode = ACTION[action];
      if (!mode) return false;
      await sendStreamCommand(STREAM_VIEW_COMMAND, { mode });
      return true;
    },
  });
}

/** The view opened or closed here: on the stream client, the room hears it now. */
export function reportViewToStream() {
  reportStreamStatus();
}
