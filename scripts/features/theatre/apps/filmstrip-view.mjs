/**
 * Theatre — the filmstrip's view: its model and its markup.
 *
 * PURE: no `game`, `canvas`, `foundry`, `ui` or `Hooks`, and no DOM. The app
 * (filmstrip.mjs) reads the store and hands the values here; the preview page
 * (tools/theatre-apps-preview.mjs) hands it fixtures and renders the same
 * markup.
 *
 *   filmstripModel(input, L)   what the panel shows
 *   renderFilmstrip(model, L)  the panel's markup (a string)
 *
 * It reads like a vision mixer: PROGRAM is what the table sees (red), PREVIEW
 * is the shot the GM has cued up (green), and Go takes preview to program.
 * Every title, note, file name and folder name is escaped here.
 */

import { escapeHTML } from "../../../core/util.mjs";
import { STYLES } from "../constants.mjs";
import { groupShots, resolveFace, resolveStyle, searchText } from "../model.mjs";
import { faceSecondaryStyle, faceSpecimenStyle, folderStyle, isVideoSrc } from "./shared.mjs";

/** The folder filter's "whole reel" value. */
export const ALL = "*";

const e = escapeHTML;
const attr = (name, on) => (on ? ` ${name}` : "");
const icon = (cls) => `<i class="${e(cls)}" aria-hidden="true"></i>`;

const shotLabel = (s, L) => s.title || s.eyebrow || s.subtitle || L("GLTH.app.untitled");

/**
 * @param {object} input
 * @param {object[]} input.shots     the scene's shots, in play order
 * @param {object[]} input.folders   its folders
 * @param {object} input.config      its config
 * @param {object} input.state       its state ({ shotId, cue })
 * @param {string|null} input.selectedId  the cued-up shot
 * @param {string} input.filter      ALL, "" (unfiled) or a folder id
 * @param {string} input.query       the search text
 * @param {boolean} input.collapsed
 * @param {string} input.goStyle     "" (the shot's own) or a style key
 * @param {boolean} input.freePan    @param {boolean} input.canFreePan
 * @param {string} input.face        the GM's default title face
 * @param {(key: string, data?: object) => string} L
 */
export function filmstripModel(input, L) {
  const { shots, folders, config, state, selectedId = null, filter = ALL, query = "", collapsed = false, goStyle = "", freePan = false, canFreePan = false, face: gmFace } = input;
  const styleName = (k) => L(`GLTH.style.${k}.name`);
  const hasFolders = folders.length > 0;
  const indexOf = (id) => shots.findIndex((s) => s.id === id);
  const shot = (id) => (id ? shots.find((s) => s.id === id) ?? null : null);

  const frame = (s, i, folderName) => ({
    id: s.id,
    index: i + 1,
    pos: i,
    folder: s.folder ?? "",
    search: searchText(s, folderName),
    src: s.src,
    hasSrc: !!s.src,
    video: isVideoSrc(s.src),
    focus: `${Math.round((s.focus?.x ?? 0.5) * 100)}% ${Math.round((s.focus?.y ?? 0.5) * 100)}%`,
    label: shotLabel(s, L),
    untitled: !(s.title || s.eyebrow || s.subtitle),
    style: styleName(resolveStyle(s, config)),
    styleOverride: s.style != null,
    onAir: s.id === state.shotId,
    selected: s.id === selectedId,
    hasNotes: !!String(s.notes ?? "").trim(),
    hasGrade: !!s.grade,
  });

  // The reel in play order; with folders, each group opens with a slate.
  const groups = groupShots(shots, folders);
  const frames = [];
  const reel = [];
  const chips = [{ value: ALL, label: L("GLTH.folders.all"), count: shots.length, all: true, active: filter === ALL }];
  for (const g of groups) {
    const name = g.folder ? (g.folder.name || L("GLTH.folders.untitled")) : L("GLTH.folders.unfiled");
    const style = g.folder ? folderStyle(g.folder.color) : "";
    const value = g.folder?.id ?? "";
    if (hasFolders) {
      chips.push({ value, label: name, count: g.shots.length, style, unfiled: !g.folder, droppable: true, active: filter === value });
      if (g.shots.length) reel.push({ slate: true, folder: value, name, style, unfiled: !g.folder, count: g.shots.length, countLabel: L("GLTH.filmstrip.count", { n: g.shots.length }) });
    }
    for (const { shot: s, index } of g.shots) {
      const f = frame(s, index, g.folder?.name ?? "");
      frames.push(f);
      reel.push(f);
    }
  }

  const sel = shot(selectedId);
  const face = resolveFace(sel, config, gmFace);
  const onAirShot = shot(state.shotId);
  const onAirIndex = state.shotId ? indexOf(state.shotId) : -1;
  const cue = state.cue;

  return {
    empty: false,
    collapsed,
    frames,
    reel,
    chips,
    hasFolders,
    query,
    count: frames.length,
    countLabel: L("GLTH.filmstrip.count", { n: frames.length }),
    sel: sel ? {
      id: sel.id,
      index: indexOf(sel.id) + 1,
      src: sel.src,
      hasSrc: !!sel.src,
      video: isVideoSrc(sel.src),
      eyebrow: sel.eyebrow,
      title: sel.title,
      subtitle: sel.subtitle,
      hasTitle: !!(sel.eyebrow || sel.title || sel.subtitle),
      label: shotLabel(sel, L),
      notes: sel.notes,
      onAir: sel.id === state.shotId,
      style: styleName(resolveStyle(sel, config)),
      titleStyle: faceSpecimenStyle(face),
      secondaryStyle: faceSecondaryStyle(face),
      focus: `${Math.round(sel.focus.x * 100)}% ${Math.round(sel.focus.y * 100)}%`,
    } : null,
    program: onAirShot ? {
      label: shotLabel(onAirShot, L),
      index: onAirIndex + 1,
      src: onAirShot.src,
      hasSrc: !!onAirShot.src,
      video: isVideoSrc(onAirShot.src),
      focus: `${Math.round(onAirShot.focus.x * 100)}% ${Math.round(onAirShot.focus.y * 100)}%`,
    } : null,
    isBlack: !state.shotId,
    lastCue: cue ? L("GLTH.filmstrip.lastCue", { cue: L(`GLTH.cue.${cue.kind}`) }) : null,
    goStyles: [
      { value: "", label: L("GLTH.filmstrip.goShotStyle"), selected: !goStyle },
      ...STYLES.map((k) => ({ value: k, label: styleName(k), selected: goStyle === k })),
    ],
    freePan,
    canFreePan,
    canPrev: onAirIndex > 0,
    canNext: frames.length > 0 && (onAirIndex < 0 || onAirIndex < frames.length - 1),
  };
}

/* ── markup ─────────────────────────────────────────────────────────── */

function tbtn(action, iconCls, label, { disabled = false, on = null, cls = "", extra = "" } = {}) {
  return `<button type="button" class="glth-tbtn${cls ? ` ${cls}` : ""}${on ? " is-on" : ""}" data-action="${action}"${attr("disabled", disabled)}`
    + `${on === null ? "" : ` aria-pressed="${on ? "true" : "false"}"`} data-tooltip="${e(label)}" aria-label="${e(label)}"${extra}>${icon(iconCls)}</button>`;
}

function media(src, video, focus, cls) {
  if (!src) return `<span class="glth-mon-blank">${icon("fa-regular fa-image")}</span>`;
  return video
    ? `<video class="${cls}" src="${e(src)}" muted loop autoplay playsinline style="object-position: ${e(focus)}"></video>`
    : `<img class="${cls}" src="${e(src)}" alt="" decoding="async" draggable="false" style="object-position: ${e(focus)}">`;
}

function transport(m, L) {
  const p = m.program;
  const program = `<div class="glth-program${m.isBlack ? " is-black" : " is-live"}">`
    + `<span class="glth-program-thumb" aria-hidden="true">${p ? media(p.src, p.video, p.focus, "glth-program-media") : ""}</span>`
    + `<span class="glth-program-text"><span class="glth-program-kicker"><span class="glth-lamp" aria-hidden="true"></span>`
    + `${e(L(m.isBlack ? "GLTH.filmstrip.black" : "GLTH.filmstrip.onAir"))}${p ? `<span class="glth-program-index">${p.index}</span>` : ""}</span>`
    + `<span class="glth-program-main">${p ? e(p.label) : "&nbsp;"}</span>`
    + `${m.lastCue ? `<span class="glth-program-sub">${e(m.lastCue)}</span>` : ""}</span></div>`;
  const take = `<div class="glth-transport-main">`
    + tbtn("prev", "fa-solid fa-backward-step", L("GLTH.filmstrip.prev"), { disabled: !m.canPrev })
    + `<span class="glth-take"><button type="button" class="glth-go" data-action="go"${attr("disabled", !m.sel)} data-tooltip="${e(L("GLTH.filmstrip.goHint"))}">`
    + `${icon("fa-solid fa-play")}<span>${e(L("GLTH.filmstrip.go"))}</span></button>`
    + `<select class="glth-go-style" data-go-style aria-label="${e(L("GLTH.filmstrip.goStyle"))}" data-tooltip="${e(L("GLTH.filmstrip.goStyle"))}">`
    + m.goStyles.map((o) => `<option value="${e(o.value)}"${attr("selected", o.selected)}>${e(o.label)}</option>`).join("")
    + `</select></span>`
    + tbtn("next", "fa-solid fa-forward-step", L("GLTH.filmstrip.next"), { disabled: !m.canNext })
    + `</div>`;
  const collapseLabel = L(m.collapsed ? "GLTH.filmstrip.expand" : "GLTH.filmstrip.collapse");
  const cues = `<div class="glth-transport-cues">`
    + tbtn("reannounce", "fa-solid fa-heading", L("GLTH.filmstrip.reannounce"), { disabled: m.isBlack })
    + tbtn("card", "fa-solid fa-quote-left", L("GLTH.filmstrip.card"))
    + tbtn("black", "fa-solid fa-square", L("GLTH.filmstrip.cutBlack"), { cls: "glth-tbtn--black" })
    + tbtn("clear", "fa-solid fa-eraser", L("GLTH.filmstrip.clear"))
    + `<span class="glth-sep" aria-hidden="true"></span>`
    + (m.canFreePan ? tbtn("freePan", "fa-solid fa-up-down-left-right", L("GLTH.filmstrip.freePan"), { on: m.freePan }) : "")
    + tbtn("edit", "fa-solid fa-pen-ruler", L("GLTH.filmstrip.edit"))
    + tbtn("collapse", m.collapsed ? "fa-solid fa-chevron-up" : "fa-solid fa-chevron-down", collapseLabel, { extra: ` aria-expanded="${m.collapsed ? "false" : "true"}"` })
    + tbtn("close", "fa-solid fa-xmark", L("GLTH.app.close"))
    + `</div>`;
  return `<header class="glth-transport">${program}${take}${cues}</header>`;
}

function previewPane(m, L) {
  const s = m.sel;
  if (!s) {
    return `<aside class="glth-preview" aria-label="${e(L("GLTH.filmstrip.preview"))}"><p class="glth-empty">${icon("fa-regular fa-image")}${e(L("GLTH.filmstrip.nothingSelected"))}</p></aside>`;
  }
  const title = s.hasTitle ? `<div class="glth-preview-title">`
    + `${s.eyebrow ? `<span class="glth-pt-eyebrow" style="${e(s.secondaryStyle)}">${e(s.eyebrow)}</span>` : ""}`
    + `${s.title ? `<span class="glth-pt-title" style="${e(s.titleStyle)}">${e(s.title)}</span>` : ""}`
    + `${s.subtitle ? `<span class="glth-pt-sub" style="${e(s.secondaryStyle)}">${e(s.subtitle)}</span>` : ""}</div>` : "";
  return `<aside class="glth-preview" aria-label="${e(L("GLTH.filmstrip.preview"))}">`
    + `<div class="glth-preview-screen${s.onAir ? " is-on-air" : ""}">${media(s.src, s.video, s.focus, "glth-preview-media")}${title}`
    + `<span class="glth-preview-tag">${e(L(s.onAir ? "GLTH.filmstrip.onAir" : "GLTH.filmstrip.previewTag"))}</span></div>`
    + `<div class="glth-preview-meta"><span class="glth-preview-index">${s.index}</span><span class="glth-preview-label">${e(s.label)}</span>`
    + `<span class="glth-meta-style">${icon("fa-solid fa-film")}${e(s.style)}</span></div>`
    + `<div class="glth-notes glth-scroll">${s.notes ? `<p class="glth-notes-text">${e(s.notes)}</p>` : `<p class="glth-notes-empty">${e(L("GLTH.filmstrip.noNotes"))}</p>`}</div>`
    + `</aside>`;
}

function frameHTML(f, L) {
  const flags = [
    f.video ? `<i class="fa-solid fa-video" data-tooltip="${e(L("GLTH.app.video"))}"></i>` : "",
    f.styleOverride ? `<i class="fa-solid fa-wand-magic-sparkles" data-tooltip="${e(f.style)}"></i>` : "",
    f.hasGrade ? `<i class="fa-solid fa-lightbulb" data-tooltip="${e(L("GLTH.app.hasGrade"))}"></i>` : "",
    f.hasNotes ? `<i class="fa-solid fa-note-sticky" data-tooltip="${e(L("GLTH.app.hasNotes"))}"></i>` : "",
  ].join("");
  const pic = f.hasSrc
    ? (f.video ? `<video src="${e(f.src)}#t=0.1" muted preload="metadata" playsinline style="object-position: ${e(f.focus)}"></video>`
      : `<img src="${e(f.src)}" alt="" loading="lazy" decoding="async" draggable="false" style="object-position: ${e(f.focus)}">`)
    : `<span class="glth-frame-blank">${icon("fa-regular fa-image")}</span>`;
  return `<li class="glth-frame${f.onAir ? " is-on-air" : ""}${f.selected ? " is-selected" : ""}" data-id="${e(f.id)}" data-index="${f.pos}" data-folder="${e(f.folder)}"`
    + ` data-haystack="${e(f.search)}" draggable="true" data-action="select" data-tooltip="${e(f.label)} · ${e(f.style)}" aria-current="${f.onAir ? "true" : "false"}">`
    + `<div class="glth-frame-pic">${pic}<span class="glth-frame-index">${f.index}</span>`
    + `${flags ? `<span class="glth-frame-flags">${flags}</span>` : ""}`
    + `${f.onAir ? `<span class="glth-frame-live">${e(L("GLTH.filmstrip.onAir"))}</span>` : f.selected ? `<span class="glth-frame-cue">${e(L("GLTH.filmstrip.previewTag"))}</span>` : ""}</div>`
    + `<span class="glth-frame-label${f.untitled ? " is-untitled" : ""}">${e(f.label)}</span></li>`;
}

function strip(m, L) {
  const chips = m.hasFolders ? `<nav class="glth-chips glth-scroll" data-keep-scroll="chips" aria-label="${e(L("GLTH.folders.label"))}">`
    + m.chips.map((c) => `<button type="button" class="glth-chip${c.active ? " is-active" : ""}${c.unfiled ? " is-unfiled" : ""}" data-action="filter" data-folder-filter="${e(c.value)}"`
      + `${c.style ? ` style="${e(c.style)}"` : ""} aria-pressed="${c.active ? "true" : "false"}"${c.droppable ? ` data-drop-folder="${e(c.value)}"` : ""}>`
      + `${c.all ? icon("fa-solid fa-layer-group") : `<span class="glth-chip-dot" aria-hidden="true"></span>`}`
      + `<span class="glth-chip-name">${e(c.label)}</span><span class="glth-chip-count">${c.count}</span></button>`).join("")
    + `</nav>` : "";
  const reel = m.reel.length ? m.reel.map((r) => (r.slate
    ? `<li class="glth-slate${r.unfiled ? " is-unfiled" : ""}" data-slate data-folder="${e(r.folder)}" data-action="filter" data-folder-filter="${e(r.folder)}"`
      + `${r.style ? ` style="${e(r.style)}"` : ""} data-tooltip="${e(r.name)} · ${e(r.countLabel)}"><span class="glth-slate-name">${e(r.name)}</span><span class="glth-slate-count">${r.count}</span></li>`
    : frameHTML(r, L))).join("")
    : `<li class="glth-strip-empty">${icon("fa-solid fa-file-import")}${e(L("GLTH.filmstrip.empty"))}</li>`;
  return `<div class="glth-strip"><div class="glth-strip-head"><span class="glth-strip-label">${e(L("GLTH.filmstrip.reel"))}</span>`
    + `<label class="glth-search${m.query ? " is-active" : ""}">${icon("fa-solid fa-magnifying-glass")}`
    + `<input type="search" class="glth-search-input" data-search value="${e(m.query)}" spellcheck="false" autocomplete="off"`
    + ` placeholder="${e(L("GLTH.search.placeholder"))}" aria-label="${e(L("GLTH.search.label"))}" data-tooltip="${e(L("GLTH.search.hint"))}"></label>`
    + `<span class="glth-strip-count" data-count data-total="${m.count}">${e(m.countLabel)}</span></div>${chips}`
    + `<ol class="glth-strip-reel glth-scroll" data-keep-scroll="reel" aria-label="${e(L("GLTH.filmstrip.reel"))}">${reel}`
    + `<li class="glth-strip-empty glth-strip-nomatch" data-no-match hidden>${icon("fa-solid fa-magnifying-glass")}${e(L("GLTH.search.none"))}</li></ol></div>`;
}

/** The whole panel. `m.empty` draws the "not a Theatre scene" line. */
export function renderFilmstrip(m, L) {
  if (m.empty) return `<div class="glth-root glth-film gl-type"><p class="glth-empty">${e(L("GLTH.app.noScene"))}</p></div>`;
  return `<div class="glth-root glth-film gl-type${m.collapsed ? " is-collapsed" : ""}">${transport(m, L)}`
    + (m.collapsed ? "" : `<div class="glth-film-body">${previewPane(m, L)}${strip(m, L)}</div>`)
    + `</div>`;
}
