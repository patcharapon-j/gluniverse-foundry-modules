/**
 * Where a grade is read from and written to.
 *
 * The only file in postfx/ that touches `game`. Everything it returns has been
 * through `normalizeGrade`, so callers never see a partial or out-of-range
 * stack.
 *
 *   scene   flags[SUITE_ID]["stage.grade"]   the room's own stack
 *   world   setting "stage.gradeDefaults"    what an ungraded scene uses
 *
 * A scene with no flag is not "neutral", it is "the world default" — so
 * changing the default reaches every scene nobody has graded yet, and none that
 * somebody has.
 */

import { MODULE_ID } from "../settings.js";
import { GRADE_FLAG, normalizeGrade, DEFAULT_GRADE } from "./grade-model.mjs";

const DEFAULTS_KEY = "stage.gradeDefaults";

/** The world default grade. */
export function readWorldDefaults() {
  let raw;
  try {
    raw = game.settings.get(MODULE_ID, DEFAULTS_KEY);
  } catch (_e) {
    raw = null;
  }
  return normalizeGrade(raw, DEFAULT_GRADE);
}

/** True when this scene carries a grade of its own. */
export function hasSceneGrade(scene) {
  const raw = scene?.getFlag?.(MODULE_ID, GRADE_FLAG);
  return !!raw && typeof raw === "object";
}

/** The grade that applies to a scene: its own, or the world default. */
export function readSceneGrade(scene) {
  const defaults = readWorldDefaults();
  const raw = scene?.getFlag?.(MODULE_ID, GRADE_FLAG);
  return raw && typeof raw === "object" ? normalizeGrade(raw, defaults) : defaults;
}

/**
 * Store a grade on a scene. GM only; resolves false when refused.
 *
 * Foundry merges a nested update into what is stored, so this relies on the
 * normalized grade always carrying every key of the schema: a merge of a
 * complete object replaces every value, and arrays are replaced wholesale.
 * Keep `normalizeGrade` total, or a key the GM removed would survive here.
 */
export async function writeSceneGrade(scene, grade) {
  if (!scene || !game.user?.isGM) return false;
  await scene.setFlag(MODULE_ID, GRADE_FLAG, normalizeGrade(grade));
  return true;
}

/** Drop a scene's own grade so it follows the world default again. */
export async function clearSceneGrade(scene) {
  if (!scene || !game.user?.isGM) return false;
  await scene.unsetFlag(MODULE_ID, GRADE_FLAG);
  return true;
}

/** Store the world default grade. GM only. */
export async function writeWorldDefaults(grade) {
  if (!game.user?.isGM) return false;
  await game.settings.set(MODULE_ID, DEFAULTS_KEY, normalizeGrade(grade));
  return true;
}

/**
 * Did this `updateScene` change touch the grade flag?
 *
 * Only decides *that* it moved. The value is read back off the document, never
 * out of the diff: a flag written through a dotted key can arrive in the diff
 * either as `flags[id]["stage.grade"]` or nested as `flags[id].stage.grade`,
 * and an unset arrives as a `-=` key.
 */
export function changeTouchesGrade(changes) {
  const flags = changes?.flags?.[MODULE_ID];
  if (!flags || typeof flags !== "object") return false;
  return Object.keys(flags).some((key) => key === GRADE_FLAG || key === "stage" || key === "-=stage" || key.startsWith("stage.") || key.startsWith("-=stage."));
}
