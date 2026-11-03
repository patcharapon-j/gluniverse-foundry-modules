/**
 * Destiny Dice markup: the fate strip, the Fated Roll switch and the face
 * config window. Pure — data and a translate function in, HTML strings out —
 * so the preview draws exactly what a chat log draws.
 *
 * Text that came from a GM (a custom image path) is escaped here, once.
 */

import { escapeHTML } from "../../core/util.mjs";
import { FACE_NUMBERS, FATE_KINDS, KIND_OPPORTUNITY, PRESETS, PRESET_DEFAULT } from "./constants.mjs";
import { glyphSpec, signed, summarize } from "./faces.mjs";
import { glyphSvg } from "./glyphs.mjs";

const presetOf = (id) => PRESETS[id] ?? PRESETS[PRESET_DEFAULT];
export const toneOf = (presetId, kind) => presetOf(presetId).tones[kind] ?? "textDim";
export const labelKeyOf = (presetId, kind) => presetOf(presetId).labels[kind];

/* `GLDDF.Degree.<key>`: a dynamic family, resolved by the check. */
export const degreeLabelKey = (key) => `GLDDF.Degree.${key}`;

/**
 * What one viewer sees of one fate.
 *
 * @param {object} fate       fate.mjs `normalizeFate` output
 * @param {object} ctx
 * @param {string} ctx.preset
 * @param {(key: string, data?: object) => string} ctx.t
 * @param {boolean} ctx.seesOutcome  whether this viewer may see the check's degree
 *        (PF2e's "show check outcomes" setting, or a GM). The shift line is the
 *        degree in words, so it follows the same rule the card's own result does.
 */
export function fateModel(fate, { preset = PRESET_DEFAULT, t = (k) => k, seesOutcome = false } = {}) {
  if (!fate) return null;
  const kind = fate.kind;
  const spec = glyphSpec({ kind, bonus: fate.bonus });
  const showBonus = kind !== KIND_OPPORTUNITY && fate.bonus !== 0;
  const shifted = seesOutcome && fate.before && fate.after && fate.before !== fate.after;
  return {
    face: fate.face,
    kind,
    tone: toneOf(preset, kind),
    label: t(labelKeyOf(preset, kind)),
    kicker: t("GLDDF.Strip.Kicker", { face: fate.face }),
    bonus: showBonus ? signed(fate.bonus) : "",
    bonusHint: showBonus ? t("GLDDF.Strip.BonusHint") : "",
    refused: fate.accepted === false,
    refusedLabel: t("GLDDF.Strip.Refused"),
    shift: shifted
      ? { from: t(degreeLabelKey(fate.before)), to: t(degreeLabelKey(fate.after)), up: degreeRank(fate.after) > degreeRank(fate.before) }
      : null,
    shiftLabel: t("GLDDF.Strip.Shift"),
    glyph: glyphSvg(spec),
  };
}

const RANK = ["criticalFailure", "failure", "success", "criticalSuccess"];
const degreeRank = (k) => RANK.indexOf(k);

/** The strip under a check card. Classes keep the `glddf-fate-strip` name old CSS and checks key on. */
export function renderFateStrip(m) {
  if (!m) return "";
  const classes = ["glddf-fate-strip", `glddf-${m.kind}`, m.refused ? "glddf-refused" : ""].filter(Boolean).join(" ");
  const bonus = m.bonus
    ? `<span class="glddf-fate-bonus" title="${escapeHTML(m.bonusHint)}"><span class="glddf-fate-bonus-num">${escapeHTML(m.bonus)}</span></span>`
    : "";
  const shift = m.shift
    ? `<span class="glddf-fate-shift" data-dir="${m.shift.up ? "up" : "down"}" aria-label="${escapeHTML(m.shiftLabel)}">`
      + `<span class="glddf-fate-from">${escapeHTML(m.shift.from)}</span>`
      + `<i class="glddf-fate-arrow" aria-hidden="true"></i>`
      + `<span class="glddf-fate-to">${escapeHTML(m.shift.to)}</span></span>`
    : "";
  const refused = m.refused ? `<span class="glddf-fate-tag">${escapeHTML(m.refusedLabel)}</span>` : "";
  return `<footer class="${classes}" data-fate-face="${m.face}" data-tone="${m.tone}">`
    + `<i class="glddf-fate-rule" aria-hidden="true"></i>`
    + `<span class="glddf-fate-face" aria-hidden="true">${m.glyph}</span>`
    + `<span class="glddf-fate-body">`
    + `<span class="glddf-fate-kicker">${escapeHTML(m.kicker)}</span>`
    + `<span class="glddf-fate-name">${escapeHTML(m.label)}${refused}</span>`
    + shift
    + `</span>`
    + bonus
    + `</footer>`;
}

/** The Fated Roll switch injected into PF2e's check dialog. */
export function renderFatedToggle({ checked = false, t = (k) => k } = {}) {
  return `<label class="glddf-fated-roll-toggle" data-tooltip="${escapeHTML(t("GLDDF.Dialog.FatedRollHint"))}">`
    + `<span class="glddf-fated-roll-die" aria-hidden="true">${glyphSvg({ mark: "star" })}</span>`
    + `<span class="glddf-fated-roll-text">${escapeHTML(t("GLDDF.Dialog.FatedRoll"))}</span>`
    + `<input type="checkbox" name="glddfFated"${checked ? " checked" : ""}/>`
    + `<i class="glddf-switch" aria-hidden="true"></i>`
    + `</label>`;
}

/* ── The face config window ───────────────────────────────────────────── */

/**
 * @param {object} args
 * @param {Array<{face:number, kind:string, bonus:number, image:string}>} args.faces
 * @param {string} args.preset
 * @param {(key: string, data?: object) => string} args.t
 */
export function faceConfigModel({ faces, preset = PRESET_DEFAULT, t = (k) => k }) {
  const { counts, mean } = summarize(faces);
  return {
    preset,
    presetName: t(presetOf(preset).name),
    rows: faces.map((f) => ({
      face: f.face,
      kind: f.kind,
      bonus: f.kind === KIND_OPPORTUNITY ? 0 : f.bonus,
      bonusLocked: f.kind === KIND_OPPORTUNITY,
      image: f.image,
      tone: toneOf(preset, f.kind),
      glyph: glyphSvg(glyphSpec(f)),
    })),
    kinds: FATE_KINDS.map((k) => ({ value: k, label: t(labelKeyOf(preset, k)), tone: toneOf(preset, k) })),
    summary: FATE_KINDS.map((k) => ({ kind: k, tone: toneOf(preset, k), count: counts[k], label: t(labelKeyOf(preset, k)) })),
    mean: t("GLDDF.Config.Mean", { value: (mean >= 0 ? "+" : "−") + Math.abs(mean).toFixed(2) }),
    text: {
      intro: t("GLDDF.Config.Intro"),
      preset: t("GLDDF.Config.Preset"),
      face: t("GLDDF.Settings.FaceConfig.Face"),
      result: t("GLDDF.Settings.FaceConfig.Result"),
      value: t("GLDDF.Settings.FaceConfig.Value"),
      image: t("GLDDF.Settings.FaceConfig.Image"),
      imageHint: t("GLDDF.Config.ImageHint"),
      browse: t("GLDDF.Settings.FaceConfig.Browse"),
      reset: t("GLDDF.Config.Reset"),
      save: t("GLDDF.Settings.FaceConfig.Save"),
      reload: t("GLDDF.Settings.FaceConfig.ReloadHint"),
    },
  };
}

export function renderFaceRow(row, m) {
  const radios = m.kinds.map((k) => `<label class="glddf-cfg-kind" data-tone="${k.tone}">`
    + `<input type="radio" name="face.${row.face}.kind" value="${k.value}"${k.value === row.kind ? " checked" : ""}/>`
    + `<span>${escapeHTML(k.label)}</span></label>`).join("");
  return `<div class="glddf-cfg-row" data-face="${row.face}" data-tone="${row.tone}">`
    + `<span class="glddf-cfg-face"><span class="glddf-fate-face" aria-hidden="true">${row.glyph}</span>`
    + `<span class="glddf-cfg-num">${row.face}</span></span>`
    + `<span class="glddf-cfg-kinds" role="radiogroup" aria-label="${escapeHTML(m.text.result)}">${radios}</span>`
    + `<input class="glddf-cfg-value" type="number" name="face.${row.face}.bonus" value="${row.bonus}" min="-9" max="9" step="1" aria-label="${escapeHTML(m.text.value)}"${row.bonusLocked ? " disabled" : ""}/>`
    + `<span class="glddf-cfg-image"><input type="text" name="face.${row.face}.image" value="${escapeHTML(row.image)}" placeholder="${escapeHTML(m.text.imageHint)}" aria-label="${escapeHTML(m.text.image)}"/>`
    + `<button type="button" class="glddf-cfg-icon" data-action="browseImage" data-face="${row.face}" data-tooltip="${escapeHTML(m.text.browse)}" aria-label="${escapeHTML(m.text.browse)}"><i class="fa-solid fa-folder-open"></i></button></span>`
    + `</div>`;
}

export function renderSummary(m) {
  return m.summary.map((s) => `<span class="glddf-cfg-count" data-tone="${s.tone}"><b>${s.count}</b> ${escapeHTML(s.label)}</span>`).join("")
    + `<span class="glddf-cfg-mean">${escapeHTML(m.mean)}</span>`;
}

export function renderFaceConfig(m) {
  return `<div class="glddf-cfg">`
    + `<header class="glddf-cfg-head"><p>${escapeHTML(m.text.intro)}</p>`
    + `<span class="glddf-cfg-preset"><span class="glddf-cfg-label">${escapeHTML(m.text.preset)}</span> ${escapeHTML(m.presetName)}</span></header>`
    + `<div class="glddf-cfg-rows">`
    + `<div class="glddf-cfg-cols" aria-hidden="true"><span class="glddf-cfg-label">${escapeHTML(m.text.face)}</span><span class="glddf-cfg-label">${escapeHTML(m.text.result)}</span>`
    + `<span class="glddf-cfg-label">${escapeHTML(m.text.value)}</span><span class="glddf-cfg-label">${escapeHTML(m.text.image)}</span></div>`
    + `${m.rows.map((r) => renderFaceRow(r, m)).join("")}</div>`
    + `<div class="glddf-cfg-summary" aria-live="polite">${renderSummary(m)}</div>`
    + `<p class="glddf-cfg-note">${escapeHTML(m.text.reload)}</p>`
    + `<footer class="glddf-cfg-foot">`
    + `<button type="button" class="glddf-cfg-btn" data-action="resetFaces"><i class="fa-solid fa-rotate-left"></i> ${escapeHTML(m.text.reset)}</button>`
    + `<button type="submit" class="glddf-cfg-btn glddf-cfg-primary"><i class="fa-solid fa-check"></i> ${escapeHTML(m.text.save)}</button>`
    + `</footer></div>`;
}

/** Read the config form back into six faces. Pure: takes the form's flat entries. */
export function facesFromForm(entries) {
  const get = (k) => entries[k];
  return FACE_NUMBERS.map((face) => ({
    face,
    kind: get(`face.${face}.kind`),
    bonus: get(`face.${face}.bonus`),
    image: get(`face.${face}.image`) ?? "",
  }));
}
