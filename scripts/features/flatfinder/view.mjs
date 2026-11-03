/**
 * Flatfinder — markup, as pure functions.
 *
 * Model in, string out: no `game`, no `document`, no world. Every string goes
 * through the injected `t(key, data)` so the preview can render with the
 * shipped lang file and the check tool can resolve every key, including the
 * ones built at runtime (`Encounter.Severity.*`, `Tag.*`, `Planner.Adjust.*`,
 * `Encounter.PartySource.*`, `Competence.Shift.*`). Names and image paths are
 * world data, so they are escaped here, once.
 *
 * Every element that carries an action is a real <button> with a
 * `data-ff-action`; flatfinder.js and planner.mjs bind those and nothing else.
 */

import { escapeHTML as esc } from "../../core/util.mjs";
import { COMPETENCE_BANDS, THREAT_ORDER } from "./constants.js";

const K = "PF2E-FLATFINDER.";
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** The i18n key of a threat rating's label (the standalone module's key family). */
export const severityKey = (rating) => `${K}Encounter.Severity.${cap(rating)}`;

/** A signed level difference, with a real minus sign. */
export function signed(n) {
  if (typeof n !== "number") return "—";
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "±0";
}

/** A fraction as a CSS number, rounded so a re-render with the same value writes the same string. */
const frac = (n) => String(Math.round(Math.max(0, Math.min(1, n)) * 10000) / 10000);

/* ── Competence badge ──────────────────────────────────────────────────── */

/**
 * The badge on a skill check's chat card.
 * @param {object} result  rules.competence(...) output
 */
export function competenceHTML(result, { t, fresh = false }) {
  if (!result?.band) return "";
  const { band, index, total, shifts } = result;
  const tip = [t(`${K}Competence.Tooltip.Total`, { total }), ...shifts.map((s) => t(`${K}Competence.Adjust.${cap(s)}`))].join("<br>");
  const ladder = COMPETENCE_BANDS.map((b, i) => {
    const cls = i === index ? "is-at" : i < index ? "is-on" : "";
    return `<i${cls ? ` class="${cls}"` : ""}></i>`;
  }).join("");
  const chips = shifts.length
    ? `<span class="ff-shifts">${shifts
        .map((s) => `<span class="ff-shift ${s === "nat1" ? "is-down" : "is-up"}">${esc(t(`${K}Competence.Shift.${cap(s)}`))}</span>`)
        .join("")}</span>`
    : "";
  return (
    `<div class="flatfinder-competence flatfinder-tier-${band.key} ff-root ff-comp${fresh ? " is-fresh" : ""}" data-tier="${band.key}" data-step="${index}" data-tooltip="${esc(tip)}">` +
    `<span class="ff-caption">${esc(t(`${K}Competence.Caption`))}</span>` +
    `<span class="ff-ladder" aria-hidden="true">${ladder}</span>` +
    `<span class="ff-label">${esc(t(band.label))}</span>` +
    chips +
    `</div>`
  );
}

/* ── Shared encounter pieces ───────────────────────────────────────────── */

/** The tags a row carries, as i18n refs. */
export function rowTags(row) {
  const tags = [];
  if (row.bossFactor > 1) tags.push({ k: "Tag.Boss", d: { factor: row.bossFactor }, tone: "boss" });
  if (row.adjustment === "elite") tags.push({ k: "Tag.Elite", tone: "up" });
  if (row.adjustment === "weak") tags.push({ k: "Tag.Weak", tone: "down" });
  if (row.hazard === "simple") tags.push({ k: "Tag.SimpleHazard" });
  if (row.hazard === "complex") tags.push({ k: "Tag.ComplexHazard" });
  if (row.minion) tags.push({ k: "Tag.Minion", tone: "down" });
  if (row.capped) tags.push({ k: "Tag.Capped" });
  if (row.hidden) tags.push({ k: "Tag.Hidden" });
  return tags;
}

const tagsHTML = (row, t) =>
  rowTags(row)
    .map((tag) => `<span class="ff-tag${tag.tone ? ` is-${tag.tone}` : ""}">${esc(t(K + tag.k, tag.d))}</span>`)
    .join("");

/**
 * The meter: a fill to the encounter's XP over five budget ticks.
 * `from` is the fill it last showed, so a change slides rather than jumps.
 */
export function meterHTML(model, { t, from = null, labels = false }) {
  const to = model.meter.fill;
  const start = typeof from === "number" ? from : to;
  const ticks = model.meter.ticks
    .map(
      (tick) =>
        `<span class="ff-tick${model.totalXp > tick.xp ? " is-past" : ""}" data-key="${tick.key}" style="--ff-at:${frac(tick.at)}"></span>` +
        (labels
          ? `<span class="ff-seg-label${tick.key === model.rating && model.rows.length ? " is-here" : ""}" style="--ff-mid:${frac(tick.mid)}"><b>${esc(t(severityKey(tick.key)))}</b>${tick.xp}</span>`
          : "")
    )
    .join("");
  const label = t(`${K}Encounter.MeterLabel`, { xp: model.totalXp, budget: model.budget, rating: t(severityKey(model.rating)) });
  return (
    `<div class="ff-meter${labels ? " has-labels" : ""}" role="img" aria-label="${esc(label)}">` +
    `<span class="ff-meter-track"><span class="ff-meter-fill" style="--ff-from:${frac(start)};--ff-to:${frac(to)}"></span></span>` +
    ticks +
    `</div>`
  );
}

/** "11 XP to Severe", "8 XP left in Extreme", "40 XP past Extreme", or exactly at the Extreme budget. */
export function nextText(model, t) {
  const n = model.next;
  if (n.key) return t(`${K}Encounter.ToNext`, { gap: n.gap, rating: t(severityKey(n.key)) });
  if (n.over > 0) return t(`${K}Encounter.Over`, { over: n.over });
  if (n.under > 0) return t(`${K}Encounter.Under`, { under: n.under });
  return t(`${K}Encounter.AtCeiling`);
}

/** The party line. Where it came from is only said when it is not the tracker's own PCs. */
const partyText = (model, t) => {
  const base = t(`${K}Encounter.Party`, { level: model.party.level, size: model.party.size });
  if (model.party.source === "combat") return base;
  return `${base} · ${t(`${K}Encounter.PartySource.${model.party.source}`)}`;
};

function rowsHTML(model, t) {
  return model.rows
    .map(
      (row) =>
        `<li class="ff-row${row.xp === 0 ? " is-zero" : ""}">` +
        (row.img ? `<img class="ff-row-img" src="${esc(row.img)}" alt="">` : `<span class="ff-row-img" aria-hidden="true"></span>`) +
        `<span class="ff-row-main"><span class="ff-row-name">${esc(row.name)}${row.count > 1 ? ` <em>×${row.count}</em>` : ""}</span>` +
        `<span class="ff-row-tags">${tagsHTML(row, t)}</span></span>` +
        `<span class="ff-row-diff" title="${esc(t(`${K}Encounter.LevelOf`, { level: row.level ?? "?" }))}">${signed(row.diff)}</span>` +
        `<span class="ff-row-xp">${row.xp}</span>` +
        `</li>`
    )
    .join("");
}

/* ── Combat tracker strip ──────────────────────────────────────────────── */

/**
 * The strip at the top of the combat tracker (GM only).
 * `model` is null when the encounter has no threats yet: the strip then says
 * so in one line and keeps the planner one click away.
 */
export function trackerHTML(model, { t, open = false, from = null, rerated = false }) {
  if (!model) {
    return (
      `<section class="flatfinder-encounter-budget ff-root ff-enc is-empty" data-severity="none">` +
      `<div class="ff-enc-empty"><span class="ff-caption">${esc(t(`${K}Encounter.Caption`))}</span>` +
      `<span class="ff-enc-empty-text">${esc(t(`${K}Encounter.NoThreats`))}</span>` +
      `<button type="button" class="ff-btn ff-btn-ghost" data-ff-action="plan"><i class="fa-solid fa-chess-rook" inert></i>${esc(t(`${K}Encounter.Plan`))}</button></div>` +
      `</section>`
    );
  }
  const id = "ff-enc-body";
  return (
    `<section class="flatfinder-encounter-budget ff-root ff-enc${open ? " is-open" : ""}${rerated ? " is-rerated" : ""}" data-severity="${model.rating}">` +
    `<button type="button" class="ff-enc-head" data-ff-action="toggle" aria-expanded="${open}" aria-controls="${id}" data-tooltip="${esc(t(`${K}Encounter.Toggle`))}">` +
    `<span class="ff-caption">${esc(t(`${K}Encounter.Caption`))}</span>` +
    `<span class="ff-enc-rating">${esc(t(severityKey(model.rating)))}</span>` +
    `<span class="ff-enc-xp"><b>${model.totalXp}</b><span>${esc(t(`${K}Encounter.Of`, { budget: model.budget }))}</span></span>` +
    `<i class="ff-chev fa-solid fa-chevron-down" inert></i>` +
    `</button>` +
    meterHTML(model, { t, from }) +
    `<div class="ff-enc-note"><span>${esc(partyText(model, t))}</span><span class="ff-enc-next">${esc(nextText(model, t))}</span></div>` +
    `<div class="ff-enc-body" id="${id}"><div class="ff-enc-inner">` +
    `<ol class="ff-rows">${rowsHTML(model, t)}</ol>` +
    `<div class="ff-enc-foot"><span>${esc(t(`${K}Encounter.Award`, { xp: model.award }))}</span>` +
    `<button type="button" class="ff-btn ff-btn-ghost" data-ff-action="plan"><i class="fa-solid fa-chess-rook" inert></i>${esc(t(`${K}Encounter.Plan`))}</button></div>` +
    `</div></div>` +
    `</section>`
  );
}

/* ── Planner ───────────────────────────────────────────────────────────── */

const ADJUST_CYCLE = Object.freeze(["normal", "elite", "weak"]);
export { ADJUST_CYCLE };

function stepper(name, value, label, t, { min, max }) {
  return (
    `<div class="ff-stepper" data-field="${name}">` +
    `<span class="ff-stepper-label">${esc(t(K + label))}</span>` +
    `<span class="ff-stepper-row">` +
    `<button type="button" class="ff-step" data-ff-action="step" data-field="${name}" data-delta="-1"${value <= min ? " disabled" : ""} aria-label="${esc(t(`${K}Planner.Less`))}"><i class="fa-solid fa-minus" inert></i></button>` +
    `<output class="ff-stepper-value">${value}</output>` +
    `<button type="button" class="ff-step" data-ff-action="step" data-field="${name}" data-delta="1"${value >= max ? " disabled" : ""} aria-label="${esc(t(`${K}Planner.More`))}"><i class="fa-solid fa-plus" inert></i></button>` +
    `</span></div>`
  );
}

/**
 * The planner window's content.
 * @param {object} model   buildEncounter output (rows in the GM's order)
 * @param {object} opts
 * @param {boolean} opts.manual   the party was set by hand (offer "Use the Party")
 * @param {boolean} opts.canCopy  a combat with threats exists to copy from
 * @param {boolean} opts.dragging a drag is over the window
 */
export function plannerHTML(model, { t, from = null, manual = false, canCopy = false, rerated = false }) {
  const empty = model.rows.length === 0;
  const rows = model.rows
    .map((row) => {
      const adj = row.adjustment ?? "normal";
      return (
        `<li class="ff-row ff-row-edit${row.xp === 0 ? " is-zero" : ""}" data-id="${esc(row.id)}">` +
        (row.img ? `<img class="ff-row-img" src="${esc(row.img)}" alt="">` : `<span class="ff-row-img" aria-hidden="true"></span>`) +
        `<span class="ff-row-main"><span class="ff-row-name">${esc(row.name)}</span>` +
        `<span class="ff-row-tags"><span class="ff-tag is-level">${esc(t(`${K}Encounter.LevelOf`, { level: row.level ?? "?" }))}</span>${tagsHTML(row, t)}</span></span>` +
        (row.hazard
          ? `<span class="ff-adj is-fixed"></span>`
          : `<button type="button" class="ff-adj" data-ff-action="adjust" data-id="${esc(row.id)}" data-adj="${adj}">${esc(t(`${K}Planner.Adjust.${adj}`))}</button>`) +
        `<span class="ff-count">` +
        `<button type="button" class="ff-step" data-ff-action="count" data-id="${esc(row.id)}" data-delta="-1"${row.count <= 1 ? " disabled" : ""} aria-label="${esc(t(`${K}Planner.Less`))}"><i class="fa-solid fa-minus" inert></i></button>` +
        `<output>${row.count}</output>` +
        `<button type="button" class="ff-step" data-ff-action="count" data-id="${esc(row.id)}" data-delta="1" aria-label="${esc(t(`${K}Planner.More`))}"><i class="fa-solid fa-plus" inert></i></button>` +
        `</span>` +
        `<span class="ff-row-diff">${signed(row.diff)}</span>` +
        `<span class="ff-row-xp">${row.xp}</span>` +
        `<button type="button" class="ff-remove" data-ff-action="remove" data-id="${esc(row.id)}" aria-label="${esc(t(`${K}Planner.Remove`))}" data-tooltip="${esc(t(`${K}Planner.Remove`))}"><i class="fa-solid fa-xmark" inert></i></button>` +
        `</li>`
      );
    })
    .join("");

  return (
    `<div class="ff-root ff-planner gl-type${empty ? " is-empty" : ""}${rerated ? " is-rerated" : ""}" data-severity="${empty ? "none" : model.rating}">` +
    `<header class="ff-plan-party">` +
    stepper("level", model.party.level, "Planner.PartyLevel", t, { min: -1, max: 25 }) +
    stepper("size", model.party.size, "Planner.PartySize", t, { min: 1, max: 12 }) +
    `<div class="ff-plan-source"><span>${esc(t(`${K}Encounter.PartySource.${model.party.source}`))}</span>` +
    (manual ? `<button type="button" class="ff-btn ff-btn-ghost" data-ff-action="party">${esc(t(`${K}Planner.UseParty`))}</button>` : "") +
    `</div></header>` +
    `<section class="ff-plan-summary">` +
    `<div class="ff-plan-rating"><span class="ff-caption">${esc(t(`${K}Encounter.Caption`))}</span>` +
    `<strong class="ff-enc-rating">${esc(empty ? "—" : t(severityKey(model.rating)))}</strong>` +
    `<span class="ff-enc-xp"><b>${model.totalXp}</b><span>${esc(t(`${K}Encounter.Of`, { budget: model.budget }))}</span></span></div>` +
    meterHTML(model, { t, from, labels: true }) +
    `<div class="ff-enc-note"><span>${esc(empty ? t(`${K}Planner.EmptyNote`) : nextText(model, t))}</span>` +
    `<span>${esc(t(`${K}Encounter.Award`, { xp: model.award }))}</span></div>` +
    `</section>` +
    (empty ? "" : `<ol class="ff-rows ff-rows-edit">${rows}</ol>`) +
    `<div class="ff-drop" data-ff-drop><i class="fa-solid fa-arrow-down" inert></i>` +
    `<span><b>${esc(t(`${K}Planner.Drop`))}</b>${esc(t(`${K}Planner.DropHint`))}</span></div>` +
    `<footer class="ff-plan-foot">` +
    `<button type="button" class="ff-btn" data-ff-action="copy"${canCopy ? "" : " disabled"}><i class="fa-solid fa-clone" inert></i>${esc(t(`${K}Planner.FromCombat`))}</button>` +
    `<button type="button" class="ff-btn ff-btn-ghost" data-ff-action="clear"${empty ? " disabled" : ""}><i class="fa-solid fa-trash-can" inert></i>${esc(t(`${K}Planner.Clear`))}</button>` +
    `</footer>` +
    `</div>`
  );
}

/** Every i18n key the views can build at runtime, for the check tool. */
export function dynamicKeys() {
  return [
    ...THREAT_ORDER.map(severityKey),
    ...["Lore", "Nat20", "Nat1"].flatMap((s) => [`${K}Competence.Shift.${s}`, `${K}Competence.Adjust.${s}`]),
    ...["Boss", "Elite", "Weak", "SimpleHazard", "ComplexHazard", "Minion", "Capped", "Hidden"].map((k) => `${K}Tag.${k}`),
    ...ADJUST_CYCLE.map((a) => `${K}Planner.Adjust.${a}`),
    ...["combat", "party", "manual", "default"].map((s) => `${K}Encounter.PartySource.${s}`),
    ...COMPETENCE_BANDS.map((b) => b.label),
  ];
}
