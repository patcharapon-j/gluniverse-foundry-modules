/**
 * PF2e HUD (`pf2e-rail`) — suite adapter.
 *
 * A bottom rail for playing a PF2e turn without the sheet: the character on a
 * plinth, vitals, strikes, a tabbed deck and the skill finder; on the GM's
 * screen the creature or hazard panel and a hand of every non-PC token. The
 * design is docs/adr/0013-pf2e-rail-skin.md; the wiring docs/PF2E_RAIL.md.
 *
 * Nothing at import time. The rail mounts in onReady, and only where
 * `shouldMount` says so: never on the stream login, never beside reonZ's
 * pf2e-hud (the GM is told once).
 */
import { Suite } from "../../core/registry.mjs";
import { warn } from "../../core/const.mjs";
import { FEATURE_ID, PREFIX } from "./const.mjs";
import { registerSettings } from "./settings.mjs";
import { shouldMount } from "./subject.mjs";
import { RailHost } from "./host.mjs";
import { isConfiguredStreamUser } from "../stream/settings.js";

let host = null;

/** The stream login is read through the stream feature's own setting, which
 *  is registered whether or not that feature is on. */
const isStream = () => {
  try { return isConfiguredStreamUser(game.user); } catch { return false; }
};

Suite.register({
  id: FEATURE_ID,
  title: "GLS.feature.pf2e-rail.title",
  hint: "GLS.feature.pf2e-rail.hint",
  icon: "fa-solid fa-diamond",
  settingPrefix: PREFIX,
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,
  registerSettings,

  onReady() {
    const pf2eHud = !!game.modules.get("pf2e-hud")?.active;
    if (pf2eHud && game.user.isGM) ui.notifications?.warn(game.i18n.localize("GLRAIL.warn.pf2eHud"), { permanent: false });
    if (!shouldMount({ system: game.system.id, stream: isStream(), pf2eHud })) return;
    host = new RailHost({ stream: isStream() });
    try { host.mount(); } catch (e) { warn("PF2e HUD | mount", e); }
  },

  api: {
    get host() { return host; },
  },
});
