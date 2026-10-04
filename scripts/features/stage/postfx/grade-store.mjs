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
import { sampleScene, sampleSrc, invalidateSceneSamples } from "./scene-sample.mjs";
import { TWEEN_OPTION } from "./tween-timing.mjs";

export { TWEEN_OPTION };
import { seedFromSample } from "./seed.mjs";
import { parseCube } from "./lut.mjs";
import { normalizeCustomLook, customLookId } from "./look-library.mjs";

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

/** Foundry's scene darkness, 0..1. The wash layer's `darkness` dial decides
 *  how much of it reaches the cast. */
export function readSceneDarkness(scene) {
  const d = Number(scene?.environment?.darknessLevel ?? 0);
  return Number.isFinite(d) ? Math.min(Math.max(d, 0), 1) : 0;
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

/** The flag's full update path, `flags.<suite>.stage.grade`. */
export const GRADE_PATH = `flags.${MODULE_ID}.${GRADE_FLAG}`;

/**
 * The update-data fragment that stores `grade` on a scene as a FORCED
 * replacement, for a writer that wants the grade in its own single
 * `scene.update` (Theatre writes the cue and the relight together).
 *
 * Forced because a plain nested update merges into what is stored; a total
 * grade happens to survive a merge today, but the fragment should not depend
 * on that. v14: the path set to `foundry.data.operators.ForcedReplacement`;
 * v13: the last segment prefixed `==`. The value is always normalized.
 *
 * @param {object} grade
 * @returns {object} e.g. `{ "flags.<suite>.stage.==grade": {…} }` on v13
 */
export function gradeUpdateData(grade) {
  const value = normalizeGrade(grade);
  const O = globalThis.foundry?.data?.operators;
  if (O?.ForcedReplacement) return { [GRADE_PATH]: O.ForcedReplacement.create(value) };
  const i = GRADE_PATH.lastIndexOf(".");
  return { [`${GRADE_PATH.slice(0, i)}.==${GRADE_PATH.slice(i + 1)}`]: value };
}

/**
 * The update options that make every client land a grade change at a set
 * moment rather than on receipt. Merge into the options of the update that
 * carries {@link gradeUpdateData}.
 *
 * @param {object} [timing]
 * @param {number} [timing.at]          serverTime ms the delay counts from;
 *                                      defaults to now.
 * @param {number} [timing.delayMs]     hold before the tween starts (from `at`)
 * @param {number} [timing.durationMs]  tween length; omit for Stage's default
 */
export function tweenUpdateOptions({ at, delayMs = 0, durationMs } = {}) {
  const stamp = Number.isFinite(at) ? at : game.time?.serverTime ?? Date.now();
  const opt = { at: stamp, delayMs: Math.max(Number(delayMs) || 0, 0) };
  if (Number.isFinite(durationMs)) opt.durationMs = Math.max(durationMs, 0);
  return { [TWEEN_OPTION]: opt };
}

/**
 * Store a grade on a scene with tween timing. GM only; resolves false when
 * refused. With neither `delayMs` nor `durationMs` this is a plain forced
 * write and every client eases in on receipt, exactly as before.
 */
export async function setSceneGrade(scene, grade, { delayMs, durationMs } = {}) {
  if (!scene || !game.user?.isGM) return false;
  const timed = Number.isFinite(delayMs) || Number.isFinite(durationMs);
  await scene.update(gradeUpdateData(grade), timed ? tweenUpdateOptions({ delayMs, durationMs }) : {});
  return true;
}

/**
 * The grade proposed for an image or video: `base` with the colours and light
 * direction read off the asset — the same proposal a scene's first use on the
 * stage makes from its background. An asset whose pixels cannot be read
 * proposes nothing, and `base` comes back unchanged (normalized): with no
 * scene there is no meaningful flat colour to propose from.
 */
export async function gradeFromSrc(src, base = readWorldDefaults()) {
  const sample = await sampleSrc(src);
  if (!sample?.ok || sample.degraded) return normalizeGrade(base);
  return seedFromSample(sample, base);
}

/** Drop a scene's own grade so it follows the world default again. */
export async function clearSceneGrade(scene) {
  if (!scene || !game.user?.isGM) return false;
  await scene.unsetFlag(MODULE_ID, GRADE_FLAG);
  return true;
}

/** Scenes with a seed in flight, so two triggers cannot sample twice. */
const _seeding = new Set();

/**
 * Propose starting values from the scene's background and store them.
 *
 * `force` is the GM's "Re-sample background": it re-reads the background and
 * replaces the colours and the light direction, keeping every amount the scene
 * already has. Without it this only runs on a scene with no grade of its own —
 * the first time a scene is used on the stage — and is a no-op everywhere
 * else, so it is safe to call on every stage update. Only the active GM writes,
 * so a table with two GMs connected seeds once.
 */
export async function seedSceneGrade(scene, { force = false } = {}) {
  if (!scene || !game.user?.isGM) return false;
  if (!force && game.users?.activeGM && !game.users.activeGM.isSelf) return false;
  if (!force && hasSceneGrade(scene)) return false;
  if (_seeding.has(scene.id)) return false;
  _seeding.add(scene.id);
  try {
    if (force) invalidateSceneSamples(scene.background?.src || null);
    const sample = await sampleScene(scene);
    const base = force ? readSceneGrade(scene) : readWorldDefaults();
    if (!force && hasSceneGrade(scene)) return false; // someone graded it meanwhile
    return writeSceneGrade(scene, seedFromSample(sample, base));
  } finally {
    _seeding.delete(scene.id);
  }
}

// ─── Custom looks ───

const LOOKS_KEY = "stage.lookLibrary";

/** Folder, inside the world, that imported `.cube` files are uploaded to. */
export function lookFolder() {
  return `worlds/${game.world?.id ?? "world"}/gluniverse/luts`;
}

/** The custom looks this world has imported, normalized. */
export function readCustomLooks() {
  let raw;
  try {
    raw = game.settings.get(MODULE_ID, LOOKS_KEY);
  } catch (_e) {
    raw = [];
  }
  return (Array.isArray(raw) ? raw : []).map(normalizeCustomLook).filter(Boolean);
}

/** Replace the custom look list. GM only. */
export async function writeCustomLooks(list) {
  if (!game.user?.isGM) return false;
  await game.settings.set(MODULE_ID, LOOKS_KEY, list.map(normalizeCustomLook).filter(Boolean));
  return true;
}

/**
 * Import a `.cube` file: check that it parses, upload it into the world's own
 * folder, and list it. Re-importing under an existing name replaces that look
 * and bumps its revision, so every client reloads it.
 *
 * @param {File} file   The file the GM picked.
 * @param {string} name What to call it in the look list.
 * @returns {Promise<{id: string}>} Throws with a message the GM can act on.
 */
export async function importCubeLook(file, name) {
  if (!game.user?.isGM) throw new Error("only a GM can import looks");
  // Parse before uploading: a file that is not a LUT should never reach the
  // world folder, and the parser's message says why it is not one.
  parseCube(await file.text());

  const list = readCustomLooks();
  const existing = list.find((l) => l.name.toLowerCase() === String(name).trim().toLowerCase());
  const id = existing?.id ?? customLookId(name, list.map((l) => l.id));
  const filename = `${id.slice(7)}.cube`;
  const folder = lookFolder();

  const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
  await FP.createDirectory("data", `worlds/${game.world.id}/gluniverse`).catch(() => {});
  await FP.createDirectory("data", folder).catch(() => {});
  const upload = new File([file], filename, { type: "text/plain" });
  const result = await FP.upload("data", folder, upload, {}, { notify: false });
  const path = result?.path ?? `${folder}/${filename}`;

  const entry = { id, name: String(name).trim() || id.slice(7), path, rev: (existing?.rev ?? 0) + 1 };
  const next = existing ? list.map((l) => (l.id === id ? entry : l)) : [...list, entry];
  await writeCustomLooks(next);
  return { id };
}

/** Remove a custom look from the list. The file stays in the world folder. */
export async function removeCustomLook(id) {
  return writeCustomLooks(readCustomLooks().filter((l) => l.id !== id));
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
