/**
 * GLUniverse Targeting Lines — configuration surface.
 *
 * One template, two homes. When `stream` is enabled the same markup is
 * contributed into its control panel, so the arcs are configured beside the
 * shot they appear in; when `stream` is disabled it is the body of this
 * feature's own editor, reached from the Control Center.
 *
 * That duplication is the price of the sibling split, and it is paid once here
 * rather than by keeping two copies of the fields: a feature that can run alone
 * has to be configurable alone, and a config reachable only through another
 * feature's panel is not that.
 */

import { featurePath } from "../../core/const.mjs";
import { TARGET_LINE_VISIBILITY, TARGETS_FEATURE_ID } from "../stream/constants.js";
import { getTargetingSettings, setTargetingSettings, streamFeatureActive, visibilityChoices } from "./settings.js";

const VISIBILITY_LABELS = {
  [TARGET_LINE_VISIBILITY.everyone]: "Everyone",
  [TARGET_LINE_VISIBILITY.gmAndStream]: "GMs and the stream",
  [TARGET_LINE_VISIBILITY.streamOnly]: "Stream only"
};

export async function renderSection() {
  const targeting = getTargetingSettings();
  const choices = visibilityChoices();
  return foundry.applications.handlebars.renderTemplate(
    featurePath(TARGETS_FEATURE_ID, "templates/section.hbs"),
    {
      targeting,
      canEdit: Boolean(game.user?.isGM),
      // With no stream client there is only one audience, so the control is
      // absent rather than a select with a single option.
      showVisibility: streamFeatureActive() && choices.length > 1,
      visibilityOptions: choices.map((value) => ({
        value,
        label: VISIBILITY_LABELS[value] ?? value,
        selected: value === targeting.visibility ? "selected" : ""
      }))
    }
  );
}

/**
 * Claim a form change from the host panel. Returns true when this feature owns
 * the field, which is how the host knows to stop offering it around.
 */
export async function claimChange(name, value) {
  if (typeof name !== "string" || !name.startsWith("targeting.")) return false;
  if (!game.user?.isGM) return true; // ours, but refused — do not fall through
  await setTargetingSettings({ [name.slice("targeting.".length)]: value });
  return true;
}
