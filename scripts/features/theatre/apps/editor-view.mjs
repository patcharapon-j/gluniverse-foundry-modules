/**
 * Theatre — the shot editor's view: its model and its markup.
 *
 * PURE: no `game`, `canvas`, `foundry`, `ui` or `Hooks`, and no DOM. The app
 * (editor.mjs) reads the store and hands the values here; the preview page
 * (tools/theatre-apps-preview.mjs) hands it fixtures and renders the same
 * markup.
 *
 *   editorModel(input, L)   what the editor shows (the draft wins over the stored shot)
 *   renderEditor(model, L)  the editor's markup (a string)
 *
 * Every name the form edits is the one `patchFromForm` reads in editor.mjs, so
 * the draft and the form cannot disagree. Every typed value is escaped here.
 */

import { escapeHTML } from "../../../core/util.mjs";
import { FACE_KEYS, MODES, STYLES, TIMING } from "../constants.mjs";
import { groupShots, normalizeShot, resolveFace, resolveHold, resolveStyle, searchText } from "../model.mjs";
import { faceSecondaryStyle, faceSpecimenStyle, folderStyle, isVideoSrc } from "./shared.mjs";

const e = escapeHTML;
const attr = (name, on) => (on ? ` ${name}` : "");
const icon = (cls) => `<i class="${e(cls)}" aria-hidden="true"></i>`;

export const sec = (ms) => Math.round((ms / 1000) * 10) / 10;

/** Range readouts, by `data-fmt`. */
export const FMT = Object.freeze({
  exposure: (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Number(v)).toFixed(2)}`,
  saturation: (v) => `×${Number(v).toFixed(2)}`,
  pct: (v) => `${Math.round(Number(v) * 100)}%`,
  letterbox: (v) => `${(Number(v) * 100).toFixed(1)}%`,
});

/** How far along its track a slider's thumb sits, 0..100. */
export function fillOf(value, min, max) {
  const span = Number(max) - Number(min);
  if (!(span > 0)) return 0;
  return Math.round(Math.min(1, Math.max(0, (Number(value) - Number(min)) / span)) * 1000) / 10;
}

/**
 * @param {object} input
 * @param {object[]} input.shots  @param {object[]} input.folders  @param {object} input.config  @param {object} input.state
 * @param {string|null} input.selectedId
 * @param {{id: string, values: object}|null} input.draft
 * @param {Set<string>} input.collapsed   collapsed folder ids ("" is unfiled)
 * @param {string} input.query  @param {"shot"|"scene"} input.tab
 * @param {boolean} input.stage           Stage is running
 * @param {string} input.face             the GM's default face
 * @param {number} input.shake            the GM's default shake
 * @param {(key: string, data?: object) => string} L
 */
export function editorModel(input, L) {
  const { shots, folders, config, state, selectedId, draft = null, collapsed = new Set(), query = "", tab = "shot", stage = false, face: gmFace, shake: gmShake } = input;
  const styleName = (k) => L(`GLTH.style.${k}.name`);
  const faceName = (k) => L(`GLTH.face.${k}`);
  const modeName = (k) => L(`GLTH.mode.${k}.name`);
  const override = (keys, label, selected, sceneValue, defaultKey = "GLTH.editor.sceneDefault") => [
    { value: "", label: L(defaultKey, { value: label(sceneValue) }), selected: selected == null },
    ...keys.map((k) => ({ value: k, label: label(k), selected: k === selected })),
  ];
  const plain = (keys, label, selected) => keys.map((k) => ({ value: k, label: label(k), selected: k === selected }));
  const stored = selectedId ? shots.find((s) => s.id === selectedId) ?? null : null;
  const dirty = !!draft && !!stored && draft.id === stored.id;

  const row = (s, i, folderName) => ({
    id: s.id,
    pos: i,
    index: i + 1,
    folder: s.folder ?? "",
    search: searchText(s, folderName),
    src: s.src,
    hasSrc: !!s.src,
    video: isVideoSrc(s.src),
    focus: `${Math.round(s.focus.x * 100)}% ${Math.round(s.focus.y * 100)}%`,
    label: s.title || s.eyebrow || s.subtitle || L("GLTH.app.untitled"),
    untitled: !(s.title || s.eyebrow || s.subtitle),
    sub: styleName(resolveStyle(s, config)),
    selected: s.id === selectedId,
    onAir: s.id === state.shotId,
    dirty: draft?.id === s.id,
  });

  const hasFolders = folders.length > 0;
  const groups = groupShots(shots, folders).map((g) => {
    const folder = g.folder?.id ?? "";
    return {
      folder,
      name: g.folder ? (g.folder.name || L("GLTH.folders.untitled")) : L("GLTH.folders.unfiled"),
      style: g.folder ? folderStyle(g.folder.color) : "",
      unfiled: !g.folder,
      showHead: hasFolders,
      collapsed: hasFolders && collapsed.has(folder),
      count: g.shots.length,
      rows: g.shots.map(({ shot, index }) => row(shot, index, g.folder?.name ?? "")),
    };
  });
  const count = groups.reduce((n, g) => n + g.rows.length, 0);

  let detail = null;
  if (stored) {
    // The draft wins over the stored shot for everything the form edits; grade is never drafted.
    const d = dirty ? normalizeShot({ ...stored, ...draft.values, id: stored.id, grade: stored.grade }) : stored;
    const sceneFace = config.face ?? gmFace;
    const face = resolveFace(d, config, gmFace);
    const shake = d.shake ?? gmShake;
    const t = d.treatment;
    detail = {
      id: d.id,
      index: shots.findIndex((s) => s.id === d.id) + 1,
      src: d.src,
      hasSrc: !!d.src,
      video: isVideoSrc(d.src),
      eyebrow: d.eyebrow,
      title: d.title,
      subtitle: d.subtitle,
      notes: d.notes,
      onAir: d.id === state.shotId,
      styles: override(STYLES, styleName, d.style, config.style),
      faces: override(FACE_KEYS, faceName, d.face, sceneFace),
      hold: d.hold == null ? "" : sec(d.hold),
      holdDefault: sec(config.hold),
      focusX: d.focus.x,
      focusY: d.focus.y,
      shakeOn: d.shake != null,
      shakeValue: shake,
      shakeDefault: FMT.pct(gmShake),
      t,
      letterboxOn: t.letterbox != null,
      letterboxValue: t.letterbox ?? config.letterbox,
      letterboxDefault: FMT.letterbox(config.letterbox),
      titleStyle: faceSpecimenStyle(face),
      secondaryStyle: faceSecondaryStyle(face),
      specimen: d.title || L("GLTH.editor.specimen"),
      specimenSub: d.subtitle || d.eyebrow || "",
      hasGrade: !!stored.grade,
      resolvedHold: sec(resolveHold(d, config)),
      folders: [
        { value: "", label: L("GLTH.folders.unfiled"), selected: !stored.folder },
        ...folders.map((f) => ({ value: f.id, label: f.name || L("GLTH.folders.untitled"), selected: f.id === stored.folder })),
      ],
    };
  }

  return {
    empty: false,
    tab: tab === "scene" ? "scene" : "shot",
    groups,
    query,
    count,
    detail,
    dirty,
    stage,
    holdMin: sec(TIMING.holdMin),
    holdMax: sec(TIMING.holdMax),
    config: {
      modes: plain(MODES, modeName, config.mode),
      modeHint: L(`GLTH.mode.${config.mode}.hint`),
      styles: plain(STYLES, styleName, config.style),
      faces: override(FACE_KEYS, faceName, config.face, gmFace, "GLTH.editor.gmDefault"),
      hold: sec(config.hold),
      letterbox: config.letterbox,
      tag: config.tag,
      styleHint: L(`GLTH.style.${config.style}.hint`),
      titleStyle: faceSpecimenStyle(config.face ?? gmFace),
      secondaryStyle: faceSecondaryStyle(config.face ?? gmFace),
    },
  };
}

/* ── markup ─────────────────────────────────────────────────────────── */

function mini(action, iconCls, label, cls = "") {
  return `<button type="button" class="glth-mini${cls ? ` ${cls}` : ""}" data-action="${action}" data-tooltip="${e(label)}" aria-label="${e(label)}">${icon(iconCls)}</button>`;
}

function btn(action, label, { iconCls = "", kind = "", tooltip = "", disabled = false, submit = false } = {}) {
  return `<button type="${submit ? "submit" : "button"}" class="glth-btn${kind ? ` glth-btn--${kind}` : ""}"${action ? ` data-action="${action}"` : ""}`
    + `${tooltip ? ` data-tooltip="${e(tooltip)}"` : ""}${attr("disabled", disabled)}>${iconCls ? icon(iconCls) : ""}<span>${e(label)}</span></button>`;
}

const options = (list) => list.map((o) => `<option value="${e(o.value)}"${attr("selected", o.selected)}>${e(o.label)}</option>`).join("");

function range(name, value, min, max, step, { disabled = false, label = "" } = {}) {
  return `<input type="range" class="glth-range" name="${name}" min="${min}" max="${max}" step="${step}" value="${e(value)}"`
    + ` style="--fill: ${fillOf(value, min, max)}%"${attr("disabled", disabled)}${label ? ` aria-label="${e(label)}"` : ""}>`;
}

function dial(L, labelKey, name, value, min, max, step, fmtKey) {
  return `<label class="glth-dial"><span class="glth-dial-head"><span class="glth-label">${e(L(labelKey))}</span>`
    + `<output data-for="${name}" data-fmt="${fmtKey}">${e(FMT[fmtKey](value))}</output></span>${range(name, value, min, max, step)}</label>`;
}

function thumb(r) {
  if (!r.hasSrc) return icon("fa-regular fa-image");
  return r.video
    ? `<video src="${e(r.src)}#t=0.1" muted preload="metadata" playsinline style="object-position: ${e(r.focus)}"></video>`
    : `<img src="${e(r.src)}" alt="" loading="lazy" decoding="async" draggable="false" style="object-position: ${e(r.focus)}">`;
}

function side(m, L) {
  const list = m.groups.map((g) => {
    const head = g.showHead ? `<li class="glth-group${g.collapsed ? " is-collapsed" : ""}${g.unfiled ? " is-unfiled" : ""}" data-group data-folder="${e(g.folder)}" data-action="toggleFolder"`
      + `${g.unfiled ? "" : ` draggable="true"`}${g.style ? ` style="${e(g.style)}"` : ""} aria-expanded="${g.collapsed ? "false" : "true"}">`
      + `<span class="glth-group-caret">${icon("fa-solid fa-chevron-down")}</span><span class="glth-group-dot" aria-hidden="true"></span>`
      + `<span class="glth-group-name">${e(g.name)}</span><span class="glth-group-count">${g.count}</span>`
      + (g.unfiled ? "" : `<span class="glth-row-acts">${mini("editFolder", "fa-solid fa-pen", L("GLTH.folders.edit"))}${mini("removeFolder", "fa-solid fa-trash", L("GLTH.folders.remove"), "glth-danger")}</span>`)
      + `</li>` : "";
    const rows = g.rows.map((r) => `<li class="glth-row${r.selected ? " is-selected" : ""}${r.onAir ? " is-on-air" : ""}${r.dirty ? " is-dirty" : ""}${g.showHead ? " is-filed" : ""}"`
      + ` data-id="${e(r.id)}" data-index="${r.pos}" data-folder="${e(r.folder)}" data-haystack="${e(r.search)}" draggable="true" data-action="select"${attr("hidden", g.collapsed)}>`
      + `<span class="glth-row-index">${r.index}</span><span class="glth-row-thumb">${thumb(r)}</span>`
      + `<span class="glth-row-main"><span class="glth-row-name${r.untitled ? " is-untitled" : ""}">${e(r.label)}</span>`
      + `<span class="glth-row-sub">${r.onAir ? `<span class="glth-live-dot" aria-hidden="true"></span>${e(L("GLTH.filmstrip.onAir"))} · ` : ""}${e(r.sub)}</span></span>`
      + `<span class="glth-row-dirty" aria-hidden="true"></span>`
      + `<span class="glth-row-acts">${mini("duplicate", "fa-regular fa-clone", L("GLTH.editor.duplicate"))}${mini("remove", "fa-solid fa-trash", L("GLTH.editor.remove"), "glth-danger")}</span></li>`).join("");
    return head + rows;
  }).join("");
  return `<aside class="glth-ed-side">`
    + `<div class="glth-ed-side-head"><span class="glth-kicker">${e(L("GLTH.editor.shots"))}</span><span class="glth-count">${m.count}</span>`
    + `${mini("addFolder", "fa-solid fa-folder-plus", L("GLTH.folders.new"))}</div>`
    + `<div class="glth-ed-adds">${btn("addShot", L("GLTH.editor.addShot"), { iconCls: "fa-solid fa-plus", kind: "primary" })}`
    + `${btn("importFolder", L("GLTH.editor.importFolder"), { iconCls: "fa-solid fa-folder-open", tooltip: L("GLTH.editor.importFolderHint") })}</div>`
    + `<label class="glth-search${m.query ? " is-active" : ""}">${icon("fa-solid fa-magnifying-glass")}`
    + `<input type="search" class="glth-search-input" data-search value="${e(m.query)}" spellcheck="false" autocomplete="off"`
    + ` placeholder="${e(L("GLTH.search.placeholder"))}" aria-label="${e(L("GLTH.search.label"))}"></label>`
    + `<ol class="glth-ed-list glth-scroll" data-keep-scroll="list">${list}`
    + (m.count ? "" : `<li class="glth-ed-empty">${icon("fa-solid fa-images")}<span>${e(L("GLTH.editor.noShots"))}</span></li>`)
    + `<li class="glth-ed-empty glth-ed-nomatch" data-no-match hidden>${icon("fa-solid fa-magnifying-glass")}<span>${e(L("GLTH.search.none"))}</span></li></ol>`
    + `<p class="glth-drop-hint">${icon("fa-solid fa-download")}${e(L("GLTH.editor.dropHint"))}</p></aside>`;
}

function shotForm(m, L) {
  const d = m.detail;
  if (!d) return `<p class="glth-empty">${icon("fa-solid fa-images")}${e(L("GLTH.editor.noShots"))}</p>`;
  const media = d.hasSrc
    ? (d.video ? `<video class="glth-focus-media" src="${e(d.src)}" muted loop autoplay playsinline></video>`
      : `<img class="glth-focus-media" src="${e(d.src)}" alt="" draggable="false">`)
    : "";
  const picture = `<section class="glth-block glth-block--pic">`
    + `<div class="glth-focus${d.hasSrc ? "" : " is-blank"}" data-focus data-tooltip="${e(L("GLTH.editor.focusHint"))}">${media}`
    + `<span class="glth-focus-crop" data-focus-crop hidden></span><span class="glth-focus-dot" data-focus-dot style="left: ${Number(d.focusX) * 100}%; top: ${Number(d.focusY) * 100}%"></span>`
    + `<span class="glth-focus-blank">${icon("fa-regular fa-image")}${e(L("GLTH.editor.noImage"))}</span></div>`
    + `<input type="hidden" name="focus.x" value="${e(d.focusX)}"><input type="hidden" name="focus.y" value="${e(d.focusY)}">`
    + `<div class="glth-pic-row"><input type="text" name="src" class="glth-input glth-src" value="${e(d.src)}" placeholder="${e(L("GLTH.editor.srcPlaceholder"))}" aria-label="${e(L("GLTH.editor.src"))}">`
    + `${mini("browseSrc", "fa-solid fa-folder-open", L("GLTH.editor.browse"), "glth-mini--field")}${mini("resetFocus", "fa-solid fa-crosshairs", L("GLTH.editor.resetFocus"), "glth-mini--field")}</div>`
    + `<p class="glth-note">${e(L("GLTH.editor.focusNote"))}</p></section>`;
  const field = (labelKey, name, value, extra = "", cls = "") => `<label class="glth-field"><span class="glth-label">${e(L(labelKey))}</span>`
    + `<input type="text" name="${name}" class="glth-input${cls ? ` ${cls}` : ""}" value="${e(value)}"${extra}></label>`;
  const words = `<section class="glth-block">`
    + `<h3 class="glth-block-head"><span>${e(L("GLTH.editor.titleGroup"))}</span></h3>`
    + `<div class="glth-specimen" data-specimen aria-hidden="true">`
    + `<span class="glth-spec-title" data-spec-title style="${e(d.titleStyle)}">${e(d.specimen)}</span>`
    + `<span class="glth-spec-sub" data-spec-sub style="${e(d.secondaryStyle)}">${e(d.specimenSub)}</span></div>`
    + field("GLTH.editor.eyebrow", "eyebrow", d.eyebrow, ` placeholder="${e(L("GLTH.editor.eyebrowPlaceholder"))}"`)
    + field("GLTH.editor.titleField", "title", d.title, "", "glth-input--title")
    + field("GLTH.editor.subtitle", "subtitle", d.subtitle)
    + `<label class="glth-field"><span class="glth-label">${icon("fa-solid fa-lock")}${e(L("GLTH.editor.notes"))}</span>`
    + `<textarea name="notes" class="glth-input glth-notes-field" rows="3" placeholder="${e(L("GLTH.editor.notesPlaceholder"))}">${e(d.notes)}</textarea></label></section>`;
  const cut = `<section class="glth-block"><h3 class="glth-block-head"><span>${e(L("GLTH.editor.cutGroup"))}</span></h3><div class="glth-grid2">`
    + `<label class="glth-field"><span class="glth-label">${e(L("GLTH.editor.style"))}</span><select name="style" class="glth-input">${options(d.styles)}</select></label>`
    + `<label class="glth-field"><span class="glth-label">${e(L("GLTH.editor.face"))}</span><select name="face" class="glth-input">${options(d.faces)}</select></label>`
    + `<label class="glth-field"><span class="glth-label">${e(L("GLTH.editor.hold"))}</span><input type="number" name="hold" class="glth-input glth-num" min="${m.holdMin}" max="${m.holdMax}" step="0.5"`
    + ` value="${e(d.hold)}" placeholder="${e(L("GLTH.editor.holdDefault", { value: d.holdDefault }))}"></label>`
    + `<label class="glth-field" data-tooltip="${e(L("GLTH.folders.pickHint"))}"><span class="glth-label">${icon("fa-solid fa-folder")}${e(L("GLTH.folders.folder"))}</span>`
    + `<select class="glth-input" data-folder-select>${options(d.folders)}</select></label></div></section>`;
  const t = d.t;
  const look = `<section class="glth-block"><h3 class="glth-block-head"><span>${e(L("GLTH.editor.lookGroup"))}</span>`
    + `<button type="button" class="glth-link-btn" data-action="resetTreatment">${icon("fa-solid fa-rotate-left")}${e(L("GLTH.editor.neutral"))}</button></h3>`
    + `<div class="glth-dials">`
    + dial(L, "GLTH.editor.exposure", "treatment.exposure", t.exposure, -2, 2, 0.05, "exposure")
    + dial(L, "GLTH.editor.saturation", "treatment.saturation", t.saturation, 0, 2, 0.05, "saturation")
    + dial(L, "GLTH.editor.vignette", "treatment.vignette", t.vignette, 0, 1, 0.05, "pct")
    + dial(L, "GLTH.editor.blur", "treatment.blur", t.blur, 0, 1, 0.05, "pct")
    + `<div class="glth-dial glth-dial--tint"><span class="glth-dial-head"><span class="glth-label">${e(L("GLTH.editor.tint"))}</span>`
    + `<output data-for="treatment.tintAmount" data-fmt="pct">${e(FMT.pct(t.tintAmount))}</output></span><span class="glth-tint-row">`
    + `<input type="color" class="glth-color" name="treatment.tint" value="${e(t.tint)}" aria-label="${e(L("GLTH.editor.tint"))}">`
    + `${range("treatment.tintAmount", t.tintAmount, 0, 1, 0.05, { label: L("GLTH.editor.tintAmount") })}</span></div>`
    + `<div class="glth-dial glth-dial--letterbox"><span class="glth-dial-head"><label class="glth-check"><input type="checkbox" name="treatment.letterboxOn"${attr("checked", d.letterboxOn)}>`
    + `<span class="glth-label">${e(L("GLTH.editor.letterboxOverride"))}</span></label><output data-for="treatment.letterbox" data-fmt="letterbox">${e(FMT.letterbox(d.letterboxValue))}</output></span>`
    + `${range("treatment.letterbox", d.letterboxValue, 0, 0.2, 0.005, { disabled: !d.letterboxOn, label: L("GLTH.editor.letterbox") })}</div>`
    + `<div class="glth-dial glth-dial--shake"><span class="glth-dial-head"><label class="glth-check"><input type="checkbox" name="shakeOn"${attr("checked", d.shakeOn)}>`
    + `<span class="glth-label">${e(L("GLTH.editor.shakeOverride"))}</span></label><output data-for="shake" data-fmt="pct">${e(FMT.pct(d.shakeValue))}</output></span>`
    + `${range("shake", d.shakeValue, 0, 1, 0.05, { disabled: !d.shakeOn, label: L("GLTH.editor.shake") })}</div>`
    + `</div><p class="glth-note">${e(L("GLTH.editor.letterboxNote", { value: d.letterboxDefault }))} ${e(L("GLTH.editor.shakeNote", { value: d.shakeDefault }))}</p></section>`;
  const stage = m.stage ? `<section class="glth-block glth-block--stage"><h3 class="glth-block-head"><span>${e(L("GLTH.editor.stageGroup"))}</span></h3>`
    + `<p class="glth-grade-state${d.hasGrade ? " is-set" : ""}">${icon(d.hasGrade ? "fa-solid fa-lightbulb" : "fa-solid fa-circle-minus")}`
    + `${e(L(d.hasGrade ? "GLTH.editor.gradeSet" : "GLTH.editor.gradeNone"))}</p><div class="glth-btn-row">`
    + btn("captureGrade", L("GLTH.editor.captureGrade"), { iconCls: "fa-solid fa-camera", tooltip: L("GLTH.editor.captureGradeHint") })
    + btn("resampleGrade", L("GLTH.editor.resampleGrade"), { iconCls: "fa-solid fa-eye-dropper", tooltip: L("GLTH.editor.resampleGradeHint"), disabled: !d.hasSrc })
    + (d.hasGrade ? btn("clearGrade", L("GLTH.editor.clearGrade"), { iconCls: "fa-solid fa-xmark", kind: "danger" }) : "")
    + `</div></section>` : "";
  return `<form class="glth-ed-form" data-shot-form data-shot-id="${e(d.id)}" autocomplete="off">`
    + `<div class="glth-ed-detail glth-scroll" data-keep-scroll="detail"><div class="glth-ed-top">${picture}${words}</div>${cut}${look}${stage}</div>`
    + `<footer class="glth-ed-foot">`
    + `<button type="button" class="glth-btn glth-btn--take" data-action="cue" data-tooltip="${e(L("GLTH.editor.cueHint"))}">${icon("fa-solid fa-play")}<span>${e(L("GLTH.editor.cue"))}</span></button>`
    + `${d.onAir ? `<span class="glth-on-air-note"><span class="glth-live-dot" aria-hidden="true"></span>${e(L("GLTH.filmstrip.onAir"))}</span>` : ""}`
    + `<span class="glth-dirty-note" data-tooltip="${e(L("GLTH.editor.unsavedHint"))}"><span class="glth-dirty-dot" aria-hidden="true"></span>${e(L("GLTH.editor.unsaved"))}</span>`
    + `<span class="glth-spacer"></span>${btn("revert", L("GLTH.editor.revert"))}${btn("", L("GLTH.editor.save"), { iconCls: "fa-solid fa-check", kind: "primary", submit: true })}`
    + `</footer></form>`;
}

function sceneForm(m, L) {
  const c = m.config;
  return `<form class="glth-ed-form" data-config-form autocomplete="off"><div class="glth-ed-detail glth-scroll" data-keep-scroll="scene">`
    + `<section class="glth-block"><h3 class="glth-block-head"><span>${e(L("GLTH.editor.sceneGroup"))}</span></h3>`
    + `<p class="glth-note">${e(L("GLTH.editor.sceneNote"))}</p>`
    + `<label class="glth-field"><span class="glth-label">${e(L("GLTH.editor.mode"))}</span><select name="mode" class="glth-input">${options(c.modes)}</select></label>`
    + `<p class="glth-note">${e(c.modeHint)}</p></section>`
    + `<section class="glth-block"><h3 class="glth-block-head"><span>${e(L("GLTH.editor.cutGroup"))}</span></h3><div class="glth-grid2">`
    + `<label class="glth-field"><span class="glth-label">${e(L("GLTH.editor.style"))}</span><select name="style" class="glth-input">${options(c.styles)}</select></label>`
    + `<label class="glth-field"><span class="glth-label">${e(L("GLTH.editor.face"))}</span><select name="face" class="glth-input">${options(c.faces)}</select></label></div>`
    + `<p class="glth-note">${e(c.styleHint)}</p>`
    + `<div class="glth-specimen" aria-hidden="true"><span class="glth-spec-title" style="${e(c.titleStyle)}">${e(L("GLTH.editor.specimen"))}</span>`
    + `<span class="glth-spec-sub" style="${e(c.secondaryStyle)}">${e(L("GLTH.editor.specimenSub"))}</span></div>`
    + `<div class="glth-grid2"><label class="glth-field"><span class="glth-label">${e(L("GLTH.editor.holdScene"))}</span>`
    + `<input type="number" name="hold" class="glth-input glth-num" min="${m.holdMin}" max="${m.holdMax}" step="0.5" value="${e(c.hold)}"></label>`
    + `<label class="glth-dial"><span class="glth-dial-head"><span class="glth-label">${e(L("GLTH.editor.letterbox"))}</span>`
    + `<output data-for="letterbox" data-fmt="letterbox">${e(FMT.letterbox(c.letterbox))}</output></span>${range("letterbox", c.letterbox, 0, 0.2, 0.005)}</label></div>`
    + `<label class="glth-check glth-check--row"><input type="checkbox" name="tag"${attr("checked", c.tag)}>`
    + `<span><span class="glth-check-title">${e(L("GLTH.editor.tag"))}</span><span class="glth-note">${e(L("GLTH.editor.tagHint"))}</span></span></label>`
    + `</section></div></form>`;
}

/** The whole editor. `m.empty` draws the "not a Theatre scene" line. */
export function renderEditor(m, L) {
  if (m.empty) return `<div class="glth-root glth-ed gl-type"><p class="glth-empty">${e(L("GLTH.app.noScene"))}</p></div>`;
  const tabBtn = (id, iconCls, key) => `<button type="button" role="tab" class="glth-tab${m.tab === id ? " is-active" : ""}" data-action="tab" data-tab="${id}"`
    + ` aria-selected="${m.tab === id ? "true" : "false"}">${icon(iconCls)}<span>${e(L(key))}</span></button>`;
  return `<div class="glth-root glth-ed gl-type${m.dirty ? " is-dirty" : ""}">${side(m, L)}`
    + `<main class="glth-ed-main"><nav class="glth-tabs" role="tablist">${tabBtn("shot", "fa-solid fa-image", "GLTH.editor.tabShot")}`
    + `${tabBtn("scene", "fa-solid fa-clapperboard", "GLTH.editor.tabScene")}</nav>`
    + (m.tab === "shot" ? shotForm(m, L) : sceneForm(m, L))
    + `</main></div>`;
}
