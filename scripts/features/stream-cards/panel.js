/**
 * GLUniverse Stream Roll Cards — its section of the stream control panel.
 *
 * The default-GM-art picker and the Frame Portraits button were fields in the
 * stream client's own template. They are contributed back through its section
 * slot now, so the panel keeps the same shape for a GM while this feature owns
 * the setting, the sanitiser, the file picker and the framing app.
 *
 * There is no standalone editor here, unlike `stream-targets`: this feature
 * requires `stream`, so its panel always exists when these controls could
 * matter.
 */

import { featurePath } from "../../core/const.mjs";
import { CARDS_FEATURE_ID } from "../stream/constants.js";
import { STATUS_LIFETIME_RANGE, getDefaultRollArt, getStatusSettings, setDefaultRollArt, setStatusSettings } from "./settings.js";
import { openPortraitFramingApp } from "./framing/portrait-framing-app.js";

export async function renderSection() {
  return foundry.applications.handlebars.renderTemplate(
    featurePath(CARDS_FEATURE_ID, "templates/section.hbs"),
    {
      defaultRollArt: getDefaultRollArt(),
      status: getStatusSettings(),
      statusLifetime: { ...STATUS_LIFETIME_RANGE, percent: Math.round(getStatusSettings().lifetimeFactor * 100) },
      canEdit: Boolean(game.user?.isGM)
    }
  );
}

/**
 * Claim the fields this feature owns in the host panel.
 *
 * `statusUpdates.*` is written as a patch through this feature's own sanitizer rather than as a whole
 * object, so two switches flipped in quick succession cannot overwrite each other with a stale copy.
 */
export async function claimChange(name, value) {
  if (name === "defaultRollArt.src") {
    await setArt(String(value ?? ""));
    return true;
  }
  if (name.startsWith("statusUpdates.")) {
    await setStatusSettings({ [name.slice("statusUpdates.".length)]: value });
    return true;
  }
  return false;
}

/** Claim the three actions this feature owns. */
export async function claimAction(action, _element) {
  switch (action) {
    case "portrait-framing":
      openPortraitFramingApp();
      return true;
    case "frame-default-roll-art":
      openPortraitFramingApp({ defaultArt: true });
      return true;
    case "browse-default-roll-art":
      await browse();
      return true;
    default:
      return false;
  }
}

/** Foundry's file picker, on the picture GM rolls fall back to. */
async function browse() {
  const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  if (!Picker) return;
  const current = getDefaultRollArt().src;
  return new Picker({ type: "image", current, callback: (p) => setArt(p) }).browse();
}

/** A new picture invalidates the framing the old one was given, so framing starts again. */
async function setArt(src) {
  const next = String(src ?? "").trim();
  if (next === getDefaultRollArt().src) return;
  await setDefaultRollArt({ src: next, focus: null });
}
