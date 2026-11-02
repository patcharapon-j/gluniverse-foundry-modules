/**
 * Stage — the Director's view: the panel's model and its markup.
 *
 * PURE: no `game`, `canvas`, `foundry`, `ui` or `Hooks`, and no DOM. The app
 * (director-app.mjs) gathers the world through the store and hands it here; the
 * preview page (tools/director-preview.mjs) hands it fixtures and renders the
 * same markup, so the panel a GM sees is the one the preview shows.
 *
 *   directorModel(input, L)  what the panel shows, from the stored values
 *   renderDirector(model, L) the panel's markup (a string)
 *
 * Every name, title and path a GM typed is escaped here. Nothing in the model
 * is markup.
 *
 * The look is the console skin (styles/stage-director.css,
 * docs/adr/0004-stage-theatre-console.md): black slabs, paper type, and one
 * red for what the players can see right now.
 */

import { escapeHTML, foldText } from "../../../core/util.mjs";
import {
  COMMS_ALIGN, COMMS_EDGES, COMMS_STYLES, DEFAULT_IMAGE, MAX_CALLS, MAX_ON_STAGE, NAMEPLATES, REACTIONS,
} from "../model.mjs";
import { LIGHT_DIALS, MOODS, MOOD_ROOMS } from "../light/rig.mjs";

/** What a roster search matches against (search.mjs keeps the same rule for the world). */
const castHaystack = (m) => foldText([m?.name, m?.title].filter(Boolean).join(" "));

export const TABS = Object.freeze(["stage", "cast", "light", "comms"]);
export const SEARCH_PANES = Object.freeze(["stage", "cast", "comms"]);

/* Stage strip geometry, in fractions of the strip: where the front row's feet
   stand, how far up the upstage row is, how tall a height-1 figure draws at
   figure 1, and how much smaller the back row is. */
export const STRIP = Object.freeze({ foot: 0.07, rise: 0.4, figure: 0.62, shrink: 0.38 });
/** The lineup: a height-1 character's box, as a fraction of the lineup's height. */
export const LINEUP_UNIT = 0.44;
/** A face point placed without a size gets this head height (image fraction). */
export const DEFAULT_FACE_H = 0.16;

export const REACTION_ICONS = Object.freeze({
  nod: "fa-solid fa-angles-down",
  shake: "fa-solid fa-arrows-left-right",
  hop: "fa-solid fa-arrow-up",
  tremble: "fa-solid fa-wave-square",
  lean: "fa-solid fa-person-walking-arrow-right",
});
const EDGE_ICONS = Object.freeze({ left: "fa-solid fa-arrow-left", right: "fa-solid fa-arrow-right" });
const ALIGN_ICONS = Object.freeze({ top: "fa-solid fa-arrow-up", center: "fa-solid fa-grip-lines", bottom: "fa-solid fa-arrow-down" });
const TAB_ICONS = Object.freeze({ stage: "fa-solid fa-masks-theater", cast: "fa-solid fa-users", light: "fa-solid fa-lightbulb", comms: "fa-solid fa-tower-broadcast" });

const e = escapeHTML;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const r3 = (v) => Math.round(v * 1000) / 1000;

/** Format a dial's value for its readout. */
export function fmt(kind, v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  switch (kind) {
    case "pct": return `${Math.round(n * 100)}%`;
    case "spct": return `${n > 0 ? "+" : ""}${Math.round(n * 100)}%`;
    case "x": return `×${n.toFixed(2)}`;
    case "px": return `${Math.round(n)}px`;
    case "vh": return `${n > 0 ? "+" : ""}${Math.round(n)}vh`;
    case "deg": return `${Math.round(n)}°`;
    default: return n.toFixed(2);
  }
}

/** How far along its track a slider's thumb sits, 0..100, for the filled part of the track. */
export function fillOf(value, min, max) {
  const span = Number(max) - Number(min);
  return span > 0 ? r3(clamp((Number(value) - Number(min)) / span, 0, 1) * 100) : 0;
}

/** A dial row. */
function dial(ns, key, value, { min, max, step = 0.01, kind = "num", label, hint = "", member = null, disabled = false }) {
  return { ns, key, value, min, max, step, kind, label, hint, member, disabled, out: fmt(kind, value), fill: fillOf(value, min, max) };
}

/** A figure's box on the strip: where its feet stand and how tall it draws. */
export function figureBox(x, depth, height, figure) {
  const scale = 1 - STRIP.shrink * depth;
  return {
    left: r3(x * 100),
    bottom: r3((STRIP.foot + STRIP.rise * depth) * 100),
    height: r3(clamp(height * figure * STRIP.figure * scale, 0.05, 1.2) * 100),
    z: Math.round((1 - depth) * 100) + 1,
  };
}
const boxStyle = (b) => `left: ${b.left}%; bottom: ${b.bottom}%; height: ${b.height}%; z-index: ${b.z}`;

/** `object-position` for a manual face point; empty when the locator frames it. */
const facePosition = (m) => (m?.face ? `object-position: ${r3(m.face.x * 100)}% ${r3(m.face.y * 100)}%` : "");
const thumbOf = (m) => ({ src: m?.image || DEFAULT_IMAGE, style: facePosition(m), auto: !m?.face });

/* ── moods: each chip shows the room it stands for ─────────────────── */

const toHex = (lin) => "#" + lin.map((v) => {
  const c = clamp(v, 0, 1);
  const s = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(s * 255).toString(16).padStart(2, "0");
}).join("");

/** A mood's swatch: its sky over its ground, with its lamps. Null for auto and off. */
export function moodSwatch(mood) {
  const r = MOOD_ROOMS[mood];
  if (!r) return null;
  const lamps = (r.lights ?? []).map((l) => `radial-gradient(circle at ${r3(l.x * 100)}% ${r3(l.y * 100)}%, ${toHex(l.color.map((c) => c * 0.9))} 0, transparent 34%)`);
  return [...lamps, `linear-gradient(180deg, ${toHex(r.sky)} 0%, ${toHex(r.mean)} 55%, ${toHex(r.ground)} 100%)`].join(", ");
}

/* ── the model ─────────────────────────────────────────────────────── */

/**
 * @param {object} input
 * @param {object[]} input.cast         normalised cast
 * @param {object} input.state          normalised stage state
 * @param {object} input.layout         normalised layout
 * @param {object} input.comms          normalised comms
 * @param {object} input.commsLayout    normalised comms layout
 * @param {{id: string, name: string}|null} input.scene   the viewed scene
 * @param {object|null} input.light     that scene's normalised light
 * @param {string} input.backdrop       the picture behind the strip
 * @param {object} input.view           { tab, sel, castSel, castView, q }
 * @param {(key: string, data?: object) => string} L
 */
export function directorModel(input, L) {
  const { cast, state, layout, comms, commsLayout, scene = null, light = null, backdrop = "", view } = input;
  const byId = new Map(cast.map((m) => [m.id, m]));
  const onIds = new Set(state.on.map((m) => m.id));
  const full = state.on.length >= MAX_ON_STAGE;
  const tab = TABS.includes(view.tab) ? view.tab : "stage";
  const sel = view.sel && onIds.has(view.sel) ? view.sel : null;
  const castSel = view.castSel && byId.has(view.castSel) ? view.castSel : cast[0]?.id ?? null;

  const marks = state.on.map((mark) => {
    const m = byId.get(mark.id);
    const height = m?.height ?? 1;
    return {
      id: mark.id,
      name: m?.name ?? mark.id,
      title: m?.title ?? "",
      thumb: thumbOf(m),
      src: m?.image || DEFAULT_IMAGE,
      flip: mark.flip,
      masked: mark.masked,
      focus: state.focus === mark.id,
      closePush: state.shot === "close" && state.close === mark.id && state.cut === "push",
      closeCut: state.shot === "close" && state.close === mark.id && state.cut === "cut",
      selected: sel === mark.id,
      box: figureBox(mark.x, mark.depth, height, layout.figure),
      x: mark.x,
      depth: mark.depth,
      height,
    };
  });
  const closeName = state.shot === "close" ? byId.get(state.close)?.name ?? null : null;
  const focusName = state.focus ? byId.get(state.focus)?.name ?? null : null;
  const inset = r3(((1 - layout.width) / 2) * 100);

  const stage = {
    visible: state.visible,
    marks,
    any: marks.length > 0,
    full,
    count: L("GLSTAGE.director.stage.count", { n: state.on.length, max: MAX_ON_STAGE }),
    shot: closeName ? L("GLSTAGE.director.stage.shotClose", { name: closeName }) : L("GLSTAGE.director.stage.shotWide"),
    focus: focusName ? L("GLSTAGE.director.stage.focusOn", { name: focusName }) : null,
    isClose: !!closeName,
    figure: layout.figure,
    inset,
    backdrop,
    roster: cast.map((m) => ({ id: m.id, name: m.name, title: m.title, haystack: castHaystack(m), thumb: thumbOf(m), on: onIds.has(m.id), canEnter: !onIds.has(m.id) && !full })),
    layout: [
      dial("layout", "figure", layout.figure, { min: 0.4, max: 1.4, kind: "pct", label: L("GLSTAGE.director.layout.figure"), hint: L("GLSTAGE.director.layout.figureHint") }),
      dial("layout", "floor", layout.floor, { min: -0.5, max: 0.4, kind: "spct", label: L("GLSTAGE.director.layout.floor"), hint: L("GLSTAGE.director.layout.floorHint") }),
      dial("layout", "width", layout.width, { min: 0.4, max: 1, kind: "pct", label: L("GLSTAGE.director.layout.width"), hint: L("GLSTAGE.director.layout.widthHint") }),
    ],
    nameplates: NAMEPLATES.map((v) => ({ value: v, label: L(`GLSTAGE.nameplates.${v}`), active: layout.nameplates === v })),
  };
  const reactions = REACTIONS.map((kind) => ({ kind, label: L(`GLSTAGE.reaction.${kind}`), icon: REACTION_ICONS[kind] ?? "fa-solid fa-circle" }));

  /* cast */
  const selM = castSel ? byId.get(castSel) : null;
  const maxH = Math.max(1, ...cast.map((m) => m.height));
  const unit = Math.min(LINEUP_UNIT, 0.94 / maxH);
  const castCtx = {
    any: cast.length > 0,
    lineupView: view.castView === "lineup",
    unit,
    list: cast.map((m) => ({ id: m.id, name: m.name, title: m.title, haystack: castHaystack(m), thumb: thumbOf(m), active: m.id === castSel, on: onIds.has(m.id), linked: !!m.actorUuid })),
    sel: selM ? {
      id: selM.id,
      name: selM.name,
      title: selM.title,
      image: selM.image,
      src: selM.image || DEFAULT_IMAGE,
      tint: selM.tint || "#ffffff",
      actorUuid: selM.actorUuid || "",
      faces: ["left", "right", "front"].map((f) => ({ value: f, label: L(`GLSTAGE.director.cast.faces.${f}`), selected: selM.faces === f })),
      dials: [
        dial("member", "height", selM.height, { min: 0.3, max: 2, kind: "x", label: L("GLSTAGE.director.cast.height"), hint: L("GLSTAGE.director.cast.heightHint"), member: selM.id }),
        dial("member", "offsetX", selM.offsetX, { min: -1, max: 1, kind: "spct", label: L("GLSTAGE.director.cast.offsetX"), hint: L("GLSTAGE.director.cast.offsetXHint"), member: selM.id }),
        dial("member", "offsetY", selM.offsetY, { min: -1, max: 1, kind: "spct", label: L("GLSTAGE.director.cast.offsetY"), hint: L("GLSTAGE.director.cast.offsetYHint"), member: selM.id }),
      ],
      hasFace: !!selM.face,
      face: selM.face ? { x: r3(selM.face.x * 100), y: r3(selM.face.y * 100), h: r3(selM.face.h * 100) } : null,
      faceH: dial("face", "h", selM.face?.h ?? DEFAULT_FACE_H, { min: 0.03, max: 0.8, kind: "pct", label: L("GLSTAGE.director.cast.faceSize"), member: selM.id, disabled: !selM.face }),
      onStage: onIds.has(selM.id),
    } : null,
    guides: [0.5, 1, 1.5, 2].filter((h) => h * unit <= 0.97).map((h) => ({ label: `×${h}`, at: r3(h * unit * 100) })),
    figures: cast.map((m) => ({
      id: m.id,
      name: m.name,
      src: m.image || DEFAULT_IMAGE,
      active: m.id === castSel,
      box: r3(m.height * unit * 100),
      nudge: [r3(m.offsetX * 100), r3(-m.offsetY * 100)],
      height: dial("member", "height", m.height, { min: 0.3, max: 2, kind: "x", label: L("GLSTAGE.director.cast.height"), member: m.id }),
    })),
  };

  /* light */
  const lightCtx = scene && light ? {
    scene: scene.name || scene.id,
    backdrop,
    moods: MOODS.map((mood) => ({ mood, label: L(`GLSTAGE.mood.${mood}`), active: light.mood === mood, swatch: moodSwatch(mood) })),
    dials: Object.entries(LIGHT_DIALS).map(([key, [min, max]]) => dial("light", key, light[key], {
      min, max, kind: max > 1 ? "num" : "pct", label: L(`GLSTAGE.light.${key}.name`), hint: L(`GLSTAGE.light.${key}.hint`),
    })),
    angleAuto: light.angle === null,
    angle: dial("light", "angle", light.angle ?? 0, { min: -180, max: 180, step: 1, kind: "deg", label: L("GLSTAGE.director.light.angle"), hint: L("GLSTAGE.director.light.angleHint"), disabled: light.angle === null }),
    darkness: light.darkness,
    flicker: light.flicker,
    src: light.src ?? "",
    hasSrc: !!light.src,
    off: light.mood === "off",
  } : null;

  /* comms */
  const callCast = new Set(comms.calls.map((c) => c.castId));
  const commsCtx = {
    visible: comms.visible,
    any: comms.calls.length > 0,
    count: L("GLSTAGE.director.comms.count", { n: comms.calls.length, max: MAX_CALLS }),
    calls: comms.calls.map((c) => {
      const m = byId.get(c.castId);
      return { callId: c.callId, castId: c.castId, name: m?.name ?? c.castId, title: m?.title ?? "", thumb: thumbOf(m), speaking: comms.speaking === c.callId };
    }),
    roster: cast.map((m) => ({ id: m.id, name: m.name, title: m.title, haystack: castHaystack(m), thumb: thumbOf(m), calling: callCast.has(m.id), canCall: !callCast.has(m.id) && comms.calls.length < MAX_CALLS })),
    edges: COMMS_EDGES.map((v) => ({ key: "edge", value: v, label: L(`GLSTAGE.comms.edge.${v}`), icon: EDGE_ICONS[v], active: commsLayout.edge === v })),
    aligns: COMMS_ALIGN.map((v) => ({ key: "align", value: v, label: L(`GLSTAGE.comms.align.${v}`), icon: ALIGN_ICONS[v], active: commsLayout.align === v })),
    styles: COMMS_STYLES.map((v) => ({ key: "style", value: v, label: L(`GLSTAGE.comms.style.${v}`), active: commsLayout.style === v })),
    dials: [
      dial("commsLayout", "width", commsLayout.width, { min: 120, max: 320, step: 1, kind: "px", label: L("GLSTAGE.director.comms.width") }),
      dial("commsLayout", "inset", commsLayout.inset, { min: 0, max: 240, step: 1, kind: "px", label: L("GLSTAGE.director.comms.inset"), hint: L("GLSTAGE.director.comms.insetHint") }),
      dial("commsLayout", "shift", commsLayout.shift, { min: -40, max: 40, step: 1, kind: "vh", label: L("GLSTAGE.director.comms.shift"), hint: L("GLSTAGE.director.comms.shiftHint") }),
    ],
  };

  return {
    tab,
    sel,
    castSel,
    tabs: TABS.map((t) => ({ id: t, label: L(`GLSTAGE.director.tab.${t}`), icon: TAB_ICONS[t], active: tab === t })),
    stage,
    reactions,
    cast: castCtx,
    light: lightCtx,
    comms: commsCtx,
    search: Object.fromEntries(SEARCH_PANES.map((pane) => [pane, {
      pane, value: view.q?.[pane] ?? "", placeholder: L("GLSTAGE.search.placeholder"), hint: L(`GLSTAGE.search.hint.${pane}`), world: L("GLSTAGE.search.world"),
    }])),
  };
}

/* ── markup ─────────────────────────────────────────────────────────── */

const attr = (name, on) => (on ? ` ${name}` : "");
const pressed = (on) => ` aria-pressed="${on ? "true" : "false"}"`;
const icon = (cls) => `<i class="${e(cls)}" aria-hidden="true"></i>`;

/** A labelled icon button: the label is the tooltip and the accessible name. */
function iconBtn(action, iconCls, label, { data = {}, on = null, cls = "", disabled = false } = {}) {
  const ds = Object.entries(data).map(([k, v]) => ` data-${k}="${e(v)}"`).join("");
  return `<button type="button" class="glstage-dir-ib${cls ? ` ${cls}` : ""}${on ? " is-on" : ""}" data-action="${action}"${ds}`
    + `${on === null ? "" : pressed(on)} data-tooltip="${e(label)}" aria-label="${e(label)}"${attr("disabled", disabled)}>${icon(iconCls)}</button>`;
}

/** A text button with an optional icon. `kind`: "" (quiet), "primary", "live", "danger". */
function btn(action, label, { iconCls = "", kind = "", data = {}, disabled = false, tooltip = "", cls = "" } = {}) {
  const ds = Object.entries(data).map(([k, v]) => ` data-${k}="${e(v)}"`).join("");
  return `<button type="button" class="glstage-dir-btn${kind ? ` glstage-dir-btn--${kind}` : ""}${cls ? ` ${cls}` : ""}" data-action="${action}"${ds}`
    + `${tooltip ? ` data-tooltip="${e(tooltip)}"` : ""}${attr("disabled", disabled)}>${iconCls ? icon(iconCls) : ""}<span>${e(label)}</span></button>`;
}

function thumbImg(t, cls = "glstage-dir-thumb") {
  return `<img class="${cls}" src="${e(t.src)}" alt="" loading="lazy" decoding="async" draggable="false"${t.style ? ` style="${e(t.style)}"` : ""}${t.auto ? " data-auto-face" : ""}>`;
}

function who(name, title) {
  return `<span class="glstage-dir-who"><span class="glstage-dir-name">${e(name)}</span>${title ? `<span class="glstage-dir-sub">${e(title)}</span>` : ""}</span>`;
}

function dialRow(d) {
  return `<label class="glstage-dir-dial${d.disabled ? " is-off" : ""}" data-dial${d.hint ? ` data-tooltip="${e(d.hint)}"` : ""}>`
    + `<span class="glstage-dir-dial-label">${e(d.label)}</span><output class="glstage-dir-dial-out">${e(d.out)}</output>`
    + `<input type="range" class="glstage-dir-range" min="${d.min}" max="${d.max}" step="${d.step}" value="${e(d.value)}" style="--fill: ${d.fill}%"`
    + ` data-bind="${d.ns}:${d.key}" data-fmt="${d.kind}"${d.member ? ` data-member="${e(d.member)}"` : ""}${attr("disabled", d.disabled)}></label>`;
}

function seg(items, action, { icons = false } = {}) {
  return `<span class="glstage-dir-seg" role="group">${items.map((it) => `<button type="button" class="glstage-dir-seg-btn${it.active ? " is-active" : ""}" data-action="${action}"`
    + `${it.key ? ` data-key="${e(it.key)}"` : ""} data-value="${e(it.value)}"${pressed(it.active)}${icons && it.icon ? ` data-tooltip="${e(it.label)}"` : ""}>`
    + `${icons && it.icon ? icon(it.icon) : ""}<span>${e(it.label)}</span></button>`).join("")}</span>`;
}

function searchBox(s) {
  return `<label class="glstage-dir-search${s.value ? " is-active" : ""}">${icon("fa-solid fa-magnifying-glass")}`
    + `<input type="search" class="glstage-dir-search-input" data-dir-search="${s.pane}" value="${e(s.value)}" spellcheck="false" autocomplete="off"`
    + ` placeholder="${e(s.placeholder)}" aria-label="${e(s.placeholder)}" data-tooltip="${e(s.hint)}"></label>`;
}

const worldBox = (s) => `<div class="glstage-dir-world" data-world="${s.pane}" hidden><h4 class="glstage-dir-kicker">${e(s.world)}</h4><ul class="glstage-dir-list" data-world-list></ul></div>`;
const kicker = (text, extra = "") => `<h3 class="glstage-dir-kicker">${e(text)}${extra}</h3>`;

/* the header: what the players see right now */

function header(m, L) {
  const s = m.stage, c = m.comms;
  const tally = (action, on, label, upKey, downKey, disabled = false) => `<button type="button" class="glstage-dir-tally${on ? " is-live" : ""}" data-action="${action}"${pressed(on)}${attr("disabled", disabled)}`
    + ` data-tooltip="${e(L(on ? upKey : downKey))}">`
    + `<span class="glstage-dir-lamp" aria-hidden="true"></span><span class="glstage-dir-tally-text"><span class="glstage-dir-tally-name">${e(label)}</span>`
    + `<span class="glstage-dir-tally-state">${e(L(on ? "GLSTAGE.director.status.onAir" : "GLSTAGE.director.status.offAir"))}</span></span></button>`;
  return `<header class="glstage-dir-head">`
    + `<div class="glstage-dir-tallies">${tally("toggleStage", s.visible, L("GLSTAGE.director.tab.stage"), "GLSTAGE.director.status.stageUp", "GLSTAGE.director.status.stageDown")}`
    + `${tally("toggleComms", c.visible, L("GLSTAGE.director.tab.comms"), "GLSTAGE.director.status.commsUp", "GLSTAGE.director.status.commsDown", !c.any && !c.visible)}</div>`
    + `<div class="glstage-dir-shot${s.isClose ? " is-close" : ""}"><span class="glstage-dir-shot-main">${e(s.shot)}</span>`
    + `<span class="glstage-dir-shot-sub">${s.focus ? e(s.focus) : e(s.count)}</span></div>`
    + `${btn("wide", L("GLSTAGE.director.stage.wide"), { iconCls: "fa-solid fa-expand", disabled: !s.isClose, tooltip: L("GLSTAGE.director.stage.wideHint") })}`
    + `</header>`
    + `<nav class="glstage-dir-tabs" role="tablist">${m.tabs.map((t) => `<button type="button" class="glstage-dir-tab${t.active ? " is-active" : ""}" data-action="stageTab" data-tab="${t.id}" role="tab"`
      + ` aria-selected="${t.active ? "true" : "false"}">${icon(t.icon)}<span>${e(t.label)}</span></button>`).join("")}</nav>`;
}

/* stage */

function stagePane(m, L) {
  const s = m.stage;
  const figs = s.marks.map((k) => `<div class="glstage-dir-fig${k.selected ? " is-selected" : ""}${k.focus ? " is-focus" : ""}${k.closePush || k.closeCut ? " is-close" : ""}${k.masked ? " is-masked" : ""}"`
    + ` data-fig="${e(k.id)}" data-x="${k.x}" data-depth="${k.depth}" data-height="${k.height}" style="${boxStyle(k.box)}">`
    + `<img class="${k.flip ? "is-flipped" : ""}" src="${e(k.src)}" alt="" decoding="async" draggable="false">`
    + `<span class="glstage-dir-fig-name">${e(k.name)}</span></div>`).join("");
  const strip = `<div class="glstage-dir-strip" aria-label="${e(L("GLSTAGE.director.stage.strip"))}">`
    + `${s.backdrop ? `<img class="glstage-dir-strip-bg" src="${e(s.backdrop)}" alt="" decoding="async" draggable="false">` : ""}`
    + `<span class="glstage-dir-strip-floor" aria-hidden="true"></span>`
    + `<div class="glstage-dir-track" data-track data-figure="${s.figure}" style="left: ${s.inset}%; right: ${s.inset}%">${figs}</div>`
    + `${s.any ? "" : `<p class="glstage-dir-strip-empty">${e(L("GLSTAGE.director.stage.emptyStrip"))}</p>`}`
    + `<span class="glstage-dir-strip-count">${e(s.count)}</span>`
    + `${s.any ? `<span class="glstage-dir-strip-hint">${e(L("GLSTAGE.director.stage.dragHint"))}</span>` : ""}</div>`;

  const rows = s.marks.map((k) => {
    const data = { id: k.id };
    return `<li class="glstage-dir-mark${k.selected ? " is-selected" : ""}${k.focus ? " is-focus" : ""}" data-mark-row="${e(k.id)}">`
      + `<button type="button" class="glstage-dir-mark-who" data-action="pickMark" data-id="${e(k.id)}"><span class="glstage-dir-thumb-box">${thumbImg(k.thumb)}</span>${who(k.name, k.title)}</button>`
      + `<span class="glstage-dir-cluster" role="group">`
      + iconBtn("focus", "fa-solid fa-crosshairs", L("GLSTAGE.director.stage.focus"), { data, on: k.focus })
      + iconBtn("closeUp", "fa-solid fa-magnifying-glass-plus", L("GLSTAGE.director.stage.closePush"), { data: { id: k.id, cut: "push" }, on: k.closePush })
      + iconBtn("closeUp", "fa-solid fa-scissors", L("GLSTAGE.director.stage.closeCut"), { data: { id: k.id, cut: "cut" }, on: k.closeCut })
      + `</span><span class="glstage-dir-cluster glstage-dir-cluster--quiet" role="group" aria-label="${e(L("GLSTAGE.director.stage.reactions"))}">`
      + m.reactions.map((r) => iconBtn("react", r.icon, r.label, { data: { id: k.id, kind: r.kind } })).join("")
      + `</span><span class="glstage-dir-cluster" role="group">`
      + iconBtn("flip", "fa-solid fa-right-left", L("GLSTAGE.director.stage.flip"), { data, on: k.flip })
      + iconBtn("mask", k.masked ? "fa-solid fa-eye" : "fa-solid fa-user-secret", L(k.masked ? "GLSTAGE.director.stage.reveal" : "GLSTAGE.director.stage.mask"), { data, on: k.masked })
      + `</span>${iconBtn("exit", "fa-solid fa-right-from-bracket", L("GLSTAGE.director.stage.exit"), { data, cls: "glstage-dir-ib--danger" })}</li>`;
  }).join("");

  const roster = s.roster.map((r) => `<li class="glstage-dir-row${r.on ? " is-on" : ""}" data-search-row="${e(r.id)}" data-haystack="${e(r.haystack)}"${attr("data-ready", r.canEnter)}>`
    + `<span class="glstage-dir-thumb-box">${thumbImg(r.thumb)}</span>${who(r.name, r.title)}`
    + (r.on ? `<span class="glstage-dir-tag">${e(L("GLSTAGE.director.stage.onStage"))}</span>`
      : btn("enter", L("GLSTAGE.director.stage.enter"), { iconCls: "fa-solid fa-right-to-bracket", data: { id: r.id }, disabled: !r.canEnter, cls: "glstage-dir-btn--sm" })
        + iconBtn("enterMasked", "fa-solid fa-user-secret", L("GLSTAGE.director.stage.enterMasked"), { data: { id: r.id }, disabled: !r.canEnter }))
    + `</li>`).join("");

  return `<section class="glstage-dir-pane glstage-dir-pane--stage" data-pane="stage"${attr("hidden", m.tab !== "stage")}>`
    + `<div class="glstage-dir-split"><div class="glstage-dir-col glstage-dir-scroll" data-keep-scroll="stage-main">${strip}`
    + `<div class="glstage-dir-bar">${kicker(L("GLSTAGE.director.tab.stage"), `<span class="glstage-dir-kicker-count">${e(s.count)}</span>`)}<span class="glstage-dir-bar-end">`
    + btn("spread", L("GLSTAGE.director.stage.spread"), { iconCls: "fa-solid fa-arrows-left-right-to-line", disabled: !s.any, tooltip: L("GLSTAGE.director.stage.spreadHint"), cls: "glstage-dir-btn--sm" })
    + btn("clearStage", L("GLSTAGE.director.stage.clear"), { iconCls: "fa-solid fa-broom", kind: "danger", disabled: !s.any, tooltip: L("GLSTAGE.director.stage.clearHint"), cls: "glstage-dir-btn--sm" })
    + `</span></div>`
    + (s.any ? `<ul class="glstage-dir-marks">${rows}</ul>` : "")
    + `<section class="glstage-dir-group">${kicker(L("GLSTAGE.director.layout.title"))}<div class="glstage-dir-dials glstage-dir-dials--3">${s.layout.map(dialRow).join("")}</div>`
    + `<div class="glstage-dir-field-line"><span class="glstage-dir-label">${e(L("GLSTAGE.director.layout.nameplates"))}</span>${seg(s.nameplates, "nameplates")}</div></section>`
    + `</div><aside class="glstage-dir-side glstage-dir-scroll" data-keep-scroll="stage-side">${kicker(L("GLSTAGE.director.stage.cast"))}${searchBox(m.search.stage)}`
    + (s.roster.length ? `<ul class="glstage-dir-list">${roster}</ul>`
      : `<p class="glstage-dir-empty" data-search-empty>${e(L("GLSTAGE.director.stage.noCast"))}</p>`
        + `<span data-search-empty>${btn("stageTab", L("GLSTAGE.director.stage.toCast"), { iconCls: "fa-solid fa-users", data: { tab: "cast" } })}</span>`)
    + `<p class="glstage-dir-empty" data-no-match hidden>${e(L("GLSTAGE.search.none"))}</p>${worldBox(m.search.stage)}</aside></div></section>`;
}

/* cast */

function castPane(m, L) {
  const c = m.cast;
  const list = c.list.map((r) => `<li data-search-row="${e(r.id)}" data-haystack="${e(r.haystack)}" data-ready>`
    + `<button type="button" class="glstage-dir-row glstage-dir-row--pick${r.active ? " is-active" : ""}" data-action="castSelect" data-id="${e(r.id)}">`
    + `<span class="glstage-dir-thumb-box">${thumbImg(r.thumb)}</span>${who(r.name, r.title)}`
    + `${r.on ? `<i class="fa-solid fa-masks-theater glstage-dir-row-icon" data-tooltip="${e(L("GLSTAGE.director.stage.onStage"))}"></i>` : ""}`
    + `${r.linked ? `<i class="fa-solid fa-link glstage-dir-row-icon" data-tooltip="${e(L("GLSTAGE.director.cast.linked"))}"></i>` : ""}</button></li>`).join("");

  const side = `<aside class="glstage-dir-side glstage-dir-scroll" data-keep-scroll="cast-side">`
    + `<div class="glstage-dir-actions">${btn("castAdd", L("GLSTAGE.director.cast.add"), { iconCls: "fa-solid fa-user-plus", kind: "primary" })}`
    + `${btn("castFromTokens", L("GLSTAGE.director.cast.fromTokens"), { iconCls: "fa-solid fa-users-viewfinder", tooltip: L("GLSTAGE.director.cast.fromTokensHint") })}</div>`
    + `${searchBox(m.search.cast)}<ul class="glstage-dir-list">${list || `<li class="glstage-dir-empty">${e(L("GLSTAGE.director.cast.empty"))}</li>`}`
    + `<li class="glstage-dir-empty" data-no-match hidden>${e(L("GLSTAGE.search.none"))}</li></ul>${worldBox(m.search.cast)}`
    + `<p class="glstage-dir-hint glstage-dir-drop-hint">${icon("fa-solid fa-hand-pointer")}${e(L("GLSTAGE.director.cast.dropHint"))}</p></aside>`;

  const views = seg([
    { value: "edit", label: L("GLSTAGE.director.cast.edit"), icon: "fa-solid fa-pen", active: !c.lineupView },
    { value: "lineup", label: L("GLSTAGE.director.cast.lineup"), icon: "fa-solid fa-ruler-vertical", active: c.lineupView },
  ], "castView", { icons: true });

  let main;
  if (c.lineupView) {
    main = c.any ? `<p class="glstage-dir-hint">${e(L("GLSTAGE.director.cast.lineupHint"))}</p>`
      + `<div class="glstage-dir-lineup" data-lineup data-unit="${c.unit}"><div class="glstage-dir-lineup-stage">`
      + c.guides.map((g) => `<span class="glstage-dir-guide" style="bottom: ${g.at}%"><span>${e(g.label)}</span></span>`).join("")
      + c.figures.map((it) => `<div class="glstage-dir-lu${it.active ? " is-active" : ""}"><div class="glstage-dir-lu-box" data-lineup-box="${e(it.id)}" style="height: ${it.box}%">`
        + `<img src="${e(it.src)}" alt="" decoding="async" draggable="false" style="translate: ${it.nudge[0]}% ${it.nudge[1]}%"></div></div>`).join("")
      + `</div><div class="glstage-dir-lineup-labels">`
      + c.figures.map((it) => `<div class="glstage-dir-lu-label"><button type="button" class="glstage-dir-link" data-action="castSelect" data-id="${e(it.id)}">${e(it.name)}</button>${dialRow(it.height)}</div>`).join("")
      + `</div></div>` : `<p class="glstage-dir-empty">${e(L("GLSTAGE.director.cast.empty"))}</p>`;
  } else if (c.sel) {
    const s = c.sel;
    main = `<form class="glstage-dir-member" autocomplete="off">`
      + `<div class="glstage-dir-portrait"><div class="glstage-dir-face" data-face-pick="${e(s.id)}" data-tooltip="${e(L("GLSTAGE.director.cast.faceHint"))}">`
      + `<img src="${e(s.src)}" alt="" decoding="async" draggable="false">`
      + `<span class="glstage-dir-face-ring" data-face-ring${s.face ? ` style="left: ${s.face.x}%; top: ${s.face.y}%; height: ${s.face.h}%"` : " hidden"}></span></div>`
      + `<p class="glstage-dir-hint">${e(L(s.hasFace ? "GLSTAGE.director.cast.faceSet" : "GLSTAGE.director.cast.faceAuto"))}</p>`
      + `<div class="glstage-dir-face-tools">${dialRow(s.faceH)}${btn("faceAuto", L("GLSTAGE.director.cast.faceClear"), { iconCls: "fa-solid fa-wand-magic-sparkles", data: { id: s.id }, disabled: !s.hasFace, cls: "glstage-dir-btn--sm" })}</div></div>`
      + `<div class="glstage-dir-fields">`
      + `<label class="glstage-dir-field"><span class="glstage-dir-label">${e(L("GLSTAGE.director.cast.name"))}</span>`
      + `<input type="text" class="glstage-dir-input glstage-dir-input--name" value="${e(s.name)}" data-bind="member:name" data-member="${e(s.id)}" maxlength="120"></label>`
      + `<label class="glstage-dir-field"><span class="glstage-dir-label">${e(L("GLSTAGE.director.cast.titleField"))}</span>`
      + `<input type="text" class="glstage-dir-input" value="${e(s.title)}" data-bind="member:title" data-member="${e(s.id)}" maxlength="120" placeholder="${e(L("GLSTAGE.director.cast.titlePlaceholder"))}"></label>`
      + `<div class="glstage-dir-field"><span class="glstage-dir-label">${e(L("GLSTAGE.director.cast.image"))}</span><span class="glstage-dir-inline">`
      + `<input type="text" class="glstage-dir-input" value="${e(s.image)}" data-bind="member:image" data-member="${e(s.id)}" aria-label="${e(L("GLSTAGE.director.cast.image"))}">`
      + `${iconBtn("browseImage", "fa-solid fa-file-image", L("GLSTAGE.director.browse"), { data: { id: s.id }, cls: "glstage-dir-ib--field" })}</span></div>`
      + `<div class="glstage-dir-pair"><label class="glstage-dir-field"><span class="glstage-dir-label">${e(L("GLSTAGE.director.cast.faces.label"))}</span>`
      + `<select class="glstage-dir-input" data-bind="member:faces" data-member="${e(s.id)}" data-tooltip="${e(L("GLSTAGE.director.cast.faces.hint"))}">`
      + s.faces.map((f) => `<option value="${f.value}"${attr("selected", f.selected)}>${e(f.label)}</option>`).join("") + `</select></label>`
      + `<label class="glstage-dir-field glstage-dir-field--tint"><span class="glstage-dir-label">${e(L("GLSTAGE.director.cast.tint"))}</span>`
      + `<input type="color" class="glstage-dir-color" value="${e(s.tint)}" data-bind="member:tint" data-member="${e(s.id)}" data-tooltip="${e(L("GLSTAGE.director.cast.tintHint"))}"></label></div>`
      + `<div class="glstage-dir-dials">${s.dials.map(dialRow).join("")}</div>`
      + (s.actorUuid ? `<p class="glstage-dir-hint">${icon("fa-solid fa-link")} ${e(L("GLSTAGE.director.cast.linkedTo", { uuid: s.actorUuid }))}</p>` : "")
      + `<div class="glstage-dir-form-end">${s.onStage ? "" : btn("enter", L("GLSTAGE.director.stage.enter"), { iconCls: "fa-solid fa-right-to-bracket", data: { id: s.id } })}`
      + `${btn("castDelete", L("GLSTAGE.director.cast.delete"), { iconCls: "fa-solid fa-trash", kind: "danger", data: { id: s.id } })}</div>`
      + `</div></form>`;
  } else {
    main = `<p class="glstage-dir-empty">${e(L("GLSTAGE.director.cast.nothingSelected"))}</p>`;
  }

  return `<section class="glstage-dir-pane glstage-dir-pane--cast" data-pane="cast"${attr("hidden", m.tab !== "cast")}>`
    + `<div class="glstage-dir-split glstage-dir-split--side-first">${side}<div class="glstage-dir-col glstage-dir-scroll" data-keep-scroll="cast-main">`
    + `<div class="glstage-dir-bar">${views}</div>${main}</div></div></section>`;
}

/* light */

function lightPane(m, L) {
  const l = m.light;
  if (!l) {
    return `<section class="glstage-dir-pane glstage-dir-pane--light" data-pane="light"${attr("hidden", m.tab !== "light")}>`
      + `<p class="glstage-dir-empty">${e(L("GLSTAGE.director.light.noScene"))}</p></section>`;
  }
  const moods = l.moods.map((md) => {
    const swatch = md.mood === "auto"
      ? (l.backdrop ? `<img class="glstage-dir-swatch-img" src="${e(l.backdrop)}" alt="" decoding="async" draggable="false">` : "")
      : md.swatch ? `<span class="glstage-dir-swatch-fill" style="background: ${e(md.swatch)}"></span>` : "";
    return `<button type="button" class="glstage-dir-mood glstage-dir-mood--${md.mood}${md.active ? " is-active" : ""}" data-action="mood" data-mood="${md.mood}"${pressed(md.active)}>`
      + `<span class="glstage-dir-swatch" aria-hidden="true">${swatch}</span><span class="glstage-dir-mood-name">${e(md.label)}</span></button>`;
  }).join("");
  const toggle = (key, on, name, hint) => `<label class="glstage-dir-switch" data-tooltip="${e(hint)}"><input type="checkbox" data-bind="light:${key}"${attr("checked", on)}>`
    + `<span class="glstage-dir-switch-track" aria-hidden="true"></span><span class="glstage-dir-switch-text"><span class="glstage-dir-name">${e(name)}</span><span class="glstage-dir-sub">${e(hint)}</span></span></label>`;
  return `<section class="glstage-dir-pane glstage-dir-pane--light" data-pane="light"${attr("hidden", m.tab !== "light")}>`
    + `<div class="glstage-dir-col glstage-dir-scroll" data-keep-scroll="light">`
    + `<div class="glstage-dir-bar"><span class="glstage-dir-scene"><span class="glstage-dir-kicker">${e(L("GLSTAGE.director.light.scene"))}</span><span class="glstage-dir-scene-name">${e(l.scene)}</span></span>`
    + `<span class="glstage-dir-bar-end">${btn("lightReset", L("GLSTAGE.director.light.reset"), { iconCls: "fa-solid fa-rotate-left", cls: "glstage-dir-btn--sm" })}</span></div>`
    + `<section class="glstage-dir-group">${kicker(L("GLSTAGE.director.light.mood"))}<div class="glstage-dir-moods">${moods}</div>`
    + `<p class="glstage-dir-hint">${e(L(l.off ? "GLSTAGE.director.light.offHint" : "GLSTAGE.director.light.moodHint"))}</p></section>`
    + `<section class="glstage-dir-group${l.off ? " is-dimmed" : ""}">${kicker(L("GLSTAGE.director.light.dials"))}<div class="glstage-dir-dials glstage-dir-dials--2">${l.dials.map(dialRow).join("")}`
    + `<div class="glstage-dir-angle"><label class="glstage-dir-check"><input type="checkbox" data-bind="light:angleAuto"${attr("checked", l.angleAuto)}><span>${e(L("GLSTAGE.director.light.angleAuto"))}</span></label>${dialRow(l.angle)}</div></div>`
    + `<div class="glstage-dir-switches">${toggle("darkness", l.darkness, L("GLSTAGE.director.light.darkness"), L("GLSTAGE.director.light.darknessHint"))}`
    + `${toggle("flicker", l.flicker, L("GLSTAGE.director.light.flicker"), L("GLSTAGE.director.light.flickerHint"))}</div></section>`
    + `<section class="glstage-dir-group">${kicker(L("GLSTAGE.director.light.src"))}<span class="glstage-dir-inline">`
    + `<input type="text" class="glstage-dir-input" value="${e(l.src)}" data-bind="light:src" placeholder="${e(L("GLSTAGE.director.light.srcPlaceholder"))}" aria-label="${e(L("GLSTAGE.director.light.src"))}">`
    + `${iconBtn("browseSrc", "fa-solid fa-file-image", L("GLSTAGE.director.browse"), { cls: "glstage-dir-ib--field" })}`
    + `${iconBtn("clearSrc", "fa-solid fa-xmark", L("GLSTAGE.director.light.srcClear"), { cls: "glstage-dir-ib--field", disabled: !l.hasSrc })}</span>`
    + `<p class="glstage-dir-hint">${e(L("GLSTAGE.director.light.srcHint"))}</p></section></div></section>`;
}

/* comms */

function commsPane(m, L) {
  const c = m.comms;
  const calls = c.calls.map((k) => `<li class="glstage-dir-call${k.speaking ? " is-speaking" : ""}">`
    + `<span class="glstage-dir-thumb-box">${thumbImg(k.thumb)}</span>${who(k.name, k.title)}`
    + `<button type="button" class="glstage-dir-btn glstage-dir-btn--sm${k.speaking ? " glstage-dir-btn--live" : ""}" data-action="speak" data-call="${e(k.callId)}"${pressed(k.speaking)}>`
    + `${icon(k.speaking ? "fa-solid fa-microphone" : "fa-solid fa-microphone-slash")}<span>${e(L(k.speaking ? "GLSTAGE.director.comms.speaking" : "GLSTAGE.director.comms.speak"))}</span></button>`
    + `${iconBtn("hangUp", "fa-solid fa-phone-slash", L("GLSTAGE.director.comms.hangUp"), { data: { call: k.callId }, cls: "glstage-dir-ib--danger" })}</li>`).join("");
  const roster = c.roster.map((r) => `<li class="glstage-dir-row${r.calling ? " is-on" : ""}" data-search-row="${e(r.id)}" data-haystack="${e(r.haystack)}"${attr("data-ready", r.canCall)}>`
    + `<span class="glstage-dir-thumb-box">${thumbImg(r.thumb)}</span>${who(r.name, r.title)}`
    + (r.calling ? `<span class="glstage-dir-tag">${e(L("GLSTAGE.director.comms.onCall"))}</span>`
      : btn("call", L("GLSTAGE.director.comms.call"), { iconCls: "fa-solid fa-phone", data: { id: r.id }, disabled: !r.canCall, cls: "glstage-dir-btn--sm" }))
    + `</li>`).join("");
  const line = (label, body) => `<div class="glstage-dir-field-line"><span class="glstage-dir-label">${e(label)}</span>${body}</div>`;
  return `<section class="glstage-dir-pane glstage-dir-pane--comms" data-pane="comms"${attr("hidden", m.tab !== "comms")}>`
    + `<div class="glstage-dir-split"><div class="glstage-dir-col glstage-dir-scroll" data-keep-scroll="comms-main">`
    + `<div class="glstage-dir-bar">${kicker(L("GLSTAGE.director.comms.calls"), `<span class="glstage-dir-kicker-count">${e(c.count)}</span>`)}<span class="glstage-dir-bar-end">`
    + `${btn("clearComms", L("GLSTAGE.director.comms.clear"), { iconCls: "fa-solid fa-phone-slash", kind: "danger", disabled: !c.any, cls: "glstage-dir-btn--sm" })}</span></div>`
    + (c.any ? `<ul class="glstage-dir-calls">${calls}</ul>` : `<p class="glstage-dir-empty glstage-dir-empty--box">${e(L("GLSTAGE.director.comms.none"))}</p>`)
    + `<section class="glstage-dir-group">${kicker(L("GLSTAGE.director.comms.layout"))}`
    + line(L("GLSTAGE.director.comms.style"), seg(c.styles, "commsSet"))
    + line(L("GLSTAGE.director.comms.edge"), seg(c.edges, "commsSet", { icons: true }))
    + line(L("GLSTAGE.director.comms.align"), seg(c.aligns, "commsSet", { icons: true }))
    + `<div class="glstage-dir-dials glstage-dir-dials--3">${c.dials.map(dialRow).join("")}</div></section></div>`
    + `<aside class="glstage-dir-side glstage-dir-scroll" data-keep-scroll="comms-side">${kicker(L("GLSTAGE.director.comms.callIn"))}${searchBox(m.search.comms)}`
    + (c.roster.length ? `<ul class="glstage-dir-list">${roster}</ul>` : `<p class="glstage-dir-empty" data-search-empty>${e(L("GLSTAGE.director.stage.noCast"))}</p>`)
    + `<p class="glstage-dir-empty" data-no-match hidden>${e(L("GLSTAGE.search.none"))}</p>${worldBox(m.search.comms)}</aside></div></section>`;
}

/** The whole panel. */
export function renderDirector(m, L) {
  return `<div class="glstage-dir gl-type" data-tab="${m.tab}">${header(m, L)}${stagePane(m, L)}${castPane(m, L)}${lightPane(m, L)}${commsPane(m, L)}</div>`;
}

/**
 * One world Actor's row in a search's "from the world" list, as markup. The
 * name and type label are text (escaped); the buttons depend on the pane.
 * @param {{uuid: string, name: string, image: string, type: string}} a
 */
export function worldRowHTML(a, pane, L) {
  const data = { uuid: a.uuid };
  const actions = {
    stage: () => btn("worldEnter", L("GLSTAGE.search.worldEnter"), { iconCls: "fa-solid fa-right-to-bracket", data, cls: "glstage-dir-btn--sm" })
      + iconBtn("worldEnterMasked", "fa-solid fa-user-secret", L("GLSTAGE.director.stage.enterMasked"), { data }),
    cast: () => btn("worldCast", L("GLSTAGE.search.worldCast"), { iconCls: "fa-solid fa-user-plus", data, cls: "glstage-dir-btn--sm" }),
    comms: () => btn("worldCall", L("GLSTAGE.search.worldCall"), { iconCls: "fa-solid fa-phone", data, cls: "glstage-dir-btn--sm" }),
  }[pane] ?? (() => "");
  return `<li class="glstage-dir-row glstage-dir-row--world" data-world-row="${e(a.uuid)}"><span class="glstage-dir-thumb-box">`
    + `${thumbImg({ src: a.image || DEFAULT_IMAGE, style: "", auto: false })}</span>${who(a.name, a.type)}${actions()}</li>`;
}
