/**
 * Theatre — the seam with Stage.
 *
 * Theatre works with Stage disabled and Stage works with Theatre disabled, so
 * nothing here is imported statically from the stage feature. Everything is
 * reached through Stage's public feature api (registered with the suite), and
 * only while `Suite.enabled("stage")` says it is running. Every function here
 * degrades to "no grade" rather than throwing.
 *
 * What crosses the seam:
 *   gradeUpdateData(grade)  the update-data fragment that writes a scene's grade
 *                           as a FORCED replacement, merged into Theatre's own
 *                           single scene.update so a cut is one write
 *   tweenUpdateOptions(t)   the update OPTIONS carrying the relight timing (key TWEEN_OPTION)
 *   gradeFromSrc(src)       a proposed grade sampled from a shot's image
 *   readSceneGrade(scene)   the grade currently on the scene ("capture current grade")
 *
 * A stored grade is the light's DIALS only. What Stage draws behind the cast —
 * the picture (`src`) and how it is cropped and graded (`picture`: the shot's
 * focus and treatment) — belongs to the shot, so `shotLight` takes both from
 * the shot at the moment of the cut. Stored, they go stale the moment the GM
 * swaps the shot's image or re-grades it, and a light captured on one shot and
 * saved to another would draw the first shot's picture behind the second.
 */

import { warn } from "../../core/const.mjs";
import { Suite } from "../../core/registry.mjs";

const STAGE_ID = "stage";
/** Stage's own key, restated only as the fallback for an api that predates it. */
const TWEEN_OPTION_FALLBACK = "glStageTween";

export function stageEnabled() {
  try { return Suite.enabled(STAGE_ID); } catch { return false; }
}

/**
 * Stage's feature api, or null when Stage is off. The api object exists even
 * when Stage is disabled, so the enabled gate comes first, always.
 */
export function stageApi() {
  if (!stageEnabled()) return null;
  try {
    return Suite.get(STAGE_ID)?.api ?? globalThis.GLUniverseStage ?? null;
  } catch {
    return null;
  }
}

export function tweenOptionKey() {
  return stageApi()?.TWEEN_OPTION ?? TWEEN_OPTION_FALLBACK;
}

/**
 * The update OPTIONS carrying a relight's timing. `at` is the cue's server
 * time; `delayMs` and `durationMs` are ALREADY motion-scaled (Stage does not
 * rescale an explicit duration).
 */
export function tweenOptions({ at, delayMs = 0, durationMs }) {
  const api = stageApi();
  if (typeof api?.tweenUpdateOptions === "function") {
    try { return api.tweenUpdateOptions({ at, delayMs, durationMs }) ?? {}; } catch (e) { warn("theatre | Stage tweenUpdateOptions failed", e); }
  }
  return { [tweenOptionKey()]: { at, delayMs, durationMs } };
}

/**
 * The scene-update fragment that writes `grade` to the scene, or null when
 * Stage is off or the api is missing. The caller merges it into its own update.
 */
export function gradeFragment(grade) {
  if (!grade || typeof grade !== "object") return null;
  const api = stageApi();
  if (typeof api?.gradeUpdateData !== "function") return null;
  try {
    const frag = api.gradeUpdateData(grade);
    return frag && typeof frag === "object" ? frag : null;
  } catch (e) {
    warn("theatre | Stage gradeUpdateData failed", e);
    return null;
  }
}

/** A light without the shot's own picture: the dials a shot stores. */
export function dialsOf(grade) {
  if (!grade || typeof grade !== "object") return null;
  const { src: _src, picture: _picture, ...dials } = grade;
  return dials;
}

/**
 * How the shot's picture is shown, as Stage's `light.picture`: the crop focus
 * always, the treatment's grade and blur only where Theatre draws them (Canvas
 * mode hands the picture to Foundry, which draws it as it is).
 */
export function pictureOf(shot, { canvasMode = false } = {}) {
  const focus = { x: shot?.focus?.x ?? 0.5, y: shot?.focus?.y ?? 0.5 };
  if (canvasMode) return { focus };
  const t = shot?.treatment ?? {};
  return { focus, exposure: t.exposure, saturation: t.saturation, tint: t.tint, tintAmount: t.tintAmount, blur: t.blur };
}

/**
 * The light a cut to `shot` writes: the shot's dials (a shot with none keeps
 * the scene's — `null` leaves the GM's light alone), always on the shot's own
 * picture, cropped and graded as Theatre shows it. Null when there is nothing
 * to write.
 */
export function shotLight(shot, scene, { canvasMode = false } = {}) {
  if (!shot?.src && !shot?.grade) return null;
  const dials = dialsOf(shot.grade) ?? dialsOf(currentGrade(scene)) ?? {};
  return { ...dials, src: shot.src || shot.grade?.src || null, picture: pictureOf(shot, { canvasMode }) };
}

/** A grade proposed from an image, or null (Stage off, a video, a load failure). */
export async function sampleGrade(src) {
  const api = stageApi();
  if (!src || typeof api?.gradeFromSrc !== "function") return null;
  try {
    const grade = await api.gradeFromSrc(src);
    return grade && typeof grade === "object" ? dialsOf(grade) : null;
  } catch (e) {
    warn(`theatre | Stage could not sample a grade from ${src}`, e);
    return null;
  }
}

/** The grade on a scene right now, or null when Stage is off. */
export function currentGrade(scene) {
  const api = stageApi();
  if (!scene || typeof api?.readSceneGrade !== "function") return null;
  try {
    const grade = api.readSceneGrade(scene);
    return grade && typeof grade === "object" ? foundry.utils.deepClone(grade) : null;
  } catch (e) {
    warn("theatre | Stage readSceneGrade failed", e);
    return null;
  }
}

/**
 * The grade a Theatre scene should start with, so Stage never auto-seeds it
 * from the flat black background: the first graded shot's light, else the grade
 * the scene already resolves to (its own, or the world default). Null when Stage is off.
 */
export function initialGrade(scene, shots = [], { canvasMode = false } = {}) {
  if (!stageEnabled()) return null;
  const shot = shots.find((s) => s?.grade);
  return shot ? shotLight(shot, scene, { canvasMode }) : currentGrade(scene);
}
