/**
 * Mythic GME: the panel and the chat card, as markup.
 *
 * Pure: a model from `model.mjs` and a `t(key, data)` in, a string out. No
 * template, no `game`, no DOM, so the preview draws exactly this. Every word a
 * table or the GM supplied is escaped here, once, on its way into markup.
 *
 * Every `data-action` drawn here has a handler in `app.mjs`; the check tool
 * pins both directions.
 */

import { escapeHTML } from "../../core/util.mjs";

const esc = escapeHTML;

/** Resolve a model ref. */
export function text(ref, t) {
  if (ref == null) return "";
  if (typeof ref === "string") return ref;
  if ("raw" in ref) return ref.raw;
  return t(ref.k, ref.d);
}
const tx = (ref, t) => esc(text(ref, t));

const icon = (cls) => `<i class="${cls}" aria-hidden="true"></i>`;

/* ── chaos ───────────────────────────────────────────────────────────────── */

function chaosHTML(m, t) {
  const c = m.chaos;
  const pips = c.pips.map((p) => `<span class="gmyth-pip${p.on ? " is-on" : ""}" data-n="${p.n}"></span>`).join("");
  return `<header class="gmyth-chaos" data-tier="${c.tier}">
  <div class="gmyth-chaos-text">
    <span class="gmyth-eyebrow">${esc(t("GLMYTHIC.cf.title"))}</span>
    <span class="gmyth-chaos-tier">${esc(t(`GLMYTHIC.cf.tier.${c.tier}`))}</span>
  </div>
  <div class="gmyth-pips" aria-hidden="true">${pips}</div>
  <div class="gmyth-stepper">
    <button type="button" class="gmyth-step" data-action="cfDown" ${c.canDown && m.writable ? "" : "disabled"} aria-label="${esc(t("GLMYTHIC.cf.down"))}" data-tooltip="${esc(t("GLMYTHIC.cf.down"))}">${icon("fa-solid fa-minus")}</button>
    <output class="gmyth-chaos-val" data-cf aria-label="${esc(t("GLMYTHIC.cf.title"))}">${c.value}</output>
    <button type="button" class="gmyth-step" data-action="cfUp" ${c.canUp && m.writable ? "" : "disabled"} aria-label="${esc(t("GLMYTHIC.cf.up"))}" data-tooltip="${esc(t("GLMYTHIC.cf.up"))}">${icon("fa-solid fa-plus")}</button>
  </div>
</header>`;
}

/* ── pages ───────────────────────────────────────────────────────────────── */

function tabsHTML(m, t) {
  return `<nav class="gmyth-tabs" role="tablist">${m.tabs
    .map((tb) => `<button type="button" class="gmyth-tab${tb.active ? " is-active" : ""}" role="tab" data-action="setTab" data-tab="${tb.id}" aria-selected="${tb.active}">${tx(tb.label, t)}</button>`)
    .join("")}</nav>`;
}

function askHTML(m, t) {
  const odds = m.ask.odds
    .map(
      (o) => `<button type="button" class="gmyth-odd${o.active ? " is-last" : ""}" data-action="askFate" data-odds="${o.id}"
      data-tooltip="${esc(t("GLMYTHIC.fate.cell", { excYes: o.excYes || "–", yes: o.yes, excNo: o.excNo > 100 ? "–" : o.excNo }))}">
      <span class="gmyth-odd-name">${tx(o.label, t)}</span><span class="gmyth-odd-yes">${o.yes}<small>%</small></span></button>`
    )
    .join("");
  return `<section class="gmyth-page" data-page="ask" role="tabpanel">
  <label class="gmyth-field">
    <span class="gmyth-sr">${esc(t("GLMYTHIC.fate.question"))}</span>
    <input type="text" name="gmyth-question" class="gmyth-input" value="${esc(m.ask.question)}" placeholder="${esc(t("GLMYTHIC.fate.questionHint"))}" autocomplete="off" maxlength="200">
  </label>
  <div class="gmyth-odds" role="group" aria-label="${esc(t("GLMYTHIC.fate.odds"))}">${odds}</div>
  <div class="gmyth-actions">
    <button type="button" class="gmyth-btn" data-action="rollEvent">${icon("fa-solid fa-bolt")}<span>${esc(t("GLMYTHIC.event.button"))}</span></button>
  </div>
</section>`;
}

function sceneHTML(m, t) {
  return `<section class="gmyth-page" data-page="scene" role="tabpanel">
  <button type="button" class="gmyth-btn gmyth-btn-wide" data-action="sceneCheck">
    ${icon("fa-solid fa-clapperboard")}<span>${esc(t("GLMYTHIC.scene.check"))}</span>
    <small class="gmyth-btn-meta">${esc(t("GLMYTHIC.scene.checkHint", { change: m.scene.change }))}</small>
  </button>
  <div class="gmyth-split">
    <span class="gmyth-eyebrow">${esc(t("GLMYTHIC.scene.end"))}</span>
    <div class="gmyth-pair">
      <button type="button" class="gmyth-btn" data-action="endScene" data-control="1" ${m.writable ? "" : "disabled"}>
        <span>${esc(t("GLMYTHIC.scene.inControl"))}</span><small class="gmyth-btn-meta">${esc(t("GLMYTHIC.scene.down"))}</small></button>
      <button type="button" class="gmyth-btn" data-action="endScene" data-control="0" ${m.writable ? "" : "disabled"}>
        <span>${esc(t("GLMYTHIC.scene.outOfControl"))}</span><small class="gmyth-btn-meta">${esc(t("GLMYTHIC.scene.up"))}</small></button>
    </div>
  </div>
  <button type="button" class="gmyth-btn gmyth-btn-quiet" data-action="rollAdjust">${icon("fa-solid fa-shuffle")}<span>${esc(t("GLMYTHIC.adjust.button"))}</span></button>
</section>`;
}

function meaningHTML(m, t) {
  const mm = m.meaning;
  const core = mm.core
    .map(
      (c) => `<button type="button" class="gmyth-btn gmyth-core" data-action="rollMeaning" data-table="${c.id}">
      <span>${tx(c.label, t)}</span>${c.note ? `<small class="gmyth-btn-meta">${tx(c.note, t)}</small>` : ""}</button>`
    )
    .join("");
  const link = mm.actions1.linked
    ? `<div class="gmyth-link is-linked" data-drop="actions1">${icon("fa-solid fa-link")}<span>${esc(t("GLMYTHIC.meaning.linked", { name: text(mm.actions1.name, t) }))}</span>
        <button type="button" class="gmyth-icon" data-action="unlinkActions" aria-label="${esc(t("GLMYTHIC.meaning.unlink"))}" data-tooltip="${esc(t("GLMYTHIC.meaning.unlink"))}" ${m.writable ? "" : "disabled"}>${icon("fa-solid fa-xmark")}</button></div>`
    : `<div class="gmyth-link" data-drop="actions1">${icon("fa-solid fa-link-slash")}<span>${esc(t("GLMYTHIC.meaning.dropHint"))}</span></div>`;
  const groups = mm.groups
    .map(
      (g) => `<div class="gmyth-group" data-group="${g.category}"${g.hidden ? " hidden" : ""}>
      <h3 class="gmyth-eyebrow">${tx(g.label, t)}</h3>
      <div class="gmyth-chips">${g.tables
        .map((tb) => `<button type="button" class="gmyth-chip" data-action="rollElement" data-el="${esc(tb.id)}"${tb.hidden ? " hidden" : ""}>${esc(tb.name)}</button>`)
        .join("")}</div></div>`
    )
    .join("");
  return `<section class="gmyth-page" data-page="meaning" role="tabpanel">
  <div class="gmyth-core-row">${core}</div>
  ${link}
  <label class="gmyth-field gmyth-search">${icon("fa-solid fa-magnifying-glass")}
    <span class="gmyth-sr">${esc(t("GLMYTHIC.elements.search"))}</span>
    <input type="search" name="gmyth-query" class="gmyth-input" value="${esc(mm.query)}" placeholder="${esc(t("GLMYTHIC.elements.search"))}" autocomplete="off">
  </label>
  <div class="gmyth-groups">${groups}<p class="gmyth-none" data-none hidden>${esc(t("GLMYTHIC.elements.none"))}</p></div>
</section>`;
}

function listHTML(l, m, t) {
  const rows = l.rows.length
    ? l.rows
        .map(
          (r) => `<li class="gmyth-list-row" data-row="${esc(r.id)}">
        <span class="gmyth-list-name">${tx(r.name, t)}</span>
        <button type="button" class="gmyth-weight" data-action="stepWeight" data-list="${l.id}" data-row="${esc(r.id)}" data-delta="1"
          aria-label="${esc(t("GLMYTHIC.list.weight", { n: r.weight }))}" data-tooltip="${esc(t("GLMYTHIC.list.weightHint"))}">${r.pips
            .map((on) => `<span class="gmyth-wpip${on ? " is-on" : ""}"></span>`)
            .join("")}</button>
        <button type="button" class="gmyth-icon" data-action="removeRow" data-list="${l.id}" data-row="${esc(r.id)}" aria-label="${esc(t("GLMYTHIC.list.remove"))}">${icon("fa-solid fa-xmark")}</button>
      </li>`
        )
        .join("")
    : `<li class="gmyth-list-empty">${esc(t(`GLMYTHIC.list.empty.${l.id}`))}</li>`;
  return `<div class="gmyth-list" data-list="${l.id}">
  <div class="gmyth-list-head">
    <h3 class="gmyth-eyebrow">${tx(l.label, t)} <span class="gmyth-count">${l.count}/${l.max}</span></h3>
    <button type="button" class="gmyth-btn gmyth-btn-small" data-action="rollList" data-list="${l.id}" ${l.count ? "" : "disabled"}>${icon("fa-solid fa-dice")}<span>${esc(t("GLMYTHIC.list.roll"))}</span></button>
  </div>
  <ul class="gmyth-list-rows">${rows}</ul>
  <form class="gmyth-add" data-list="${l.id}">
    <input type="text" name="gmyth-add-${l.id}" class="gmyth-input" placeholder="${esc(t(`GLMYTHIC.list.add.${l.id}`))}" autocomplete="off" maxlength="80" ${l.full ? "disabled" : ""}>
    <button type="submit" class="gmyth-icon" aria-label="${esc(t("GLMYTHIC.list.addLabel"))}" ${l.full ? "disabled" : ""}>${icon("fa-solid fa-plus")}</button>
  </form>
</div>`;
}

function listsHTML(m, t) {
  return `<section class="gmyth-page" data-page="lists" role="tabpanel">
  ${m.lists.map((l) => listHTML(l, m, t)).join("")}
  <p class="gmyth-foot">${esc(t("GLMYTHIC.list.private"))}</p>
</section>`;
}

/* ── the log ─────────────────────────────────────────────────────────────── */

function lineHTML(l, t) {
  return `<div class="gmyth-line" data-tone="${l.tone}"><span class="gmyth-line-label">${tx(l.label, t)}</span><span class="gmyth-line-value">${tx(l.value, t)}</span>${
    l.meta ? `<span class="gmyth-line-meta">${tx(l.meta, t)}</span>` : ""
  }</div>`;
}

const metaText = (v, t) => v.meta.map((r) => text(r, t)).join(" · ");

function postButtons(v, t) {
  return `<div class="gmyth-post">
    <button type="button" class="gmyth-icon" data-action="whisperEntry" data-id="${esc(v.id)}" aria-label="${esc(t("GLMYTHIC.log.whisper"))}" data-tooltip="${esc(t("GLMYTHIC.log.whisper"))}">${icon("fa-solid fa-user-secret")}</button>
    <button type="button" class="gmyth-icon" data-action="revealEntry" data-id="${esc(v.id)}" aria-label="${esc(t("GLMYTHIC.log.reveal"))}" data-tooltip="${esc(t("GLMYTHIC.log.reveal"))}">${icon("fa-solid fa-bullhorn")}</button>
  </div>`;
}

/** The newest roll, at the size of an answer. */
export function heroHTML(v, t, { fresh = false } = {}) {
  return `<article class="gmyth-hero${fresh ? " is-fresh" : ""}" data-id="${esc(v.id)}" data-kind="${v.kind}" data-tone="${v.tone}">
  <div class="gmyth-hero-head">${icon(v.icon)}<span class="gmyth-hero-title">${tx(v.title, t)}</span>${v.flag ? `<span class="gmyth-flag">${tx(v.flag, t)}</span>` : ""}${postButtons(v, t)}</div>
  ${v.question ? `<p class="gmyth-question">${tx(v.question, t)}</p>` : ""}
  <p class="gmyth-headline">${tx(v.headline, t)}</p>
  ${v.meta.length ? `<p class="gmyth-meta">${esc(metaText(v, t))}</p>` : ""}
  ${v.note ? `<p class="gmyth-note">${tx(v.note, t)}</p>` : ""}
  ${v.lines.length ? `<div class="gmyth-lines">${v.lines.map((l) => lineHTML(l, t)).join("")}</div>` : ""}
</article>`;
}

/** An older roll: one row, the answer first. */
function rowHTML(v, t) {
  const sub = v.lines.length ? `<span class="gmyth-row-sub">${esc(v.lines.map((l) => text(l.value, t)).join(" · "))}</span>` : "";
  return `<li class="gmyth-row" data-id="${esc(v.id)}" data-kind="${v.kind}" data-tone="${v.tone}">
  ${icon(v.icon)}
  <div class="gmyth-row-body">
    <span class="gmyth-row-title">${tx(v.title, t)}${v.question ? ` · <q>${tx(v.question, t)}</q>` : ""}</span>
    <span class="gmyth-row-headline">${tx(v.headline, t)}</span>${sub}
  </div>
  ${postButtons(v, t)}
</li>`;
}

function logHTML(m, t) {
  const L = m.log;
  return `<section class="gmyth-log" aria-live="polite">
  <div class="gmyth-log-head">
    <span class="gmyth-eyebrow">${esc(t("GLMYTHIC.log.title"))}${L.count ? ` <span class="gmyth-count">${L.count}</span>` : ""}</span>
    <button type="button" class="gmyth-icon" data-action="clearLog" ${L.count ? "" : "disabled"} aria-label="${esc(t("GLMYTHIC.log.clear"))}" data-tooltip="${esc(t("GLMYTHIC.log.clear"))}">${icon("fa-solid fa-trash-can")}</button>
  </div>
  <div class="gmyth-log-scroll">
    ${L.hero ? heroHTML(L.hero, t, { fresh: L.fresh === L.hero.id }) : `<p class="gmyth-empty">${esc(t("GLMYTHIC.log.empty"))}</p>`}
    ${L.rest.length ? `<ol class="gmyth-rows">${L.rest.map((v) => rowHTML(v, t)).join("")}</ol>` : ""}
  </div>
</section>`;
}

/** The whole panel. */
export function panelHTML(m, t) {
  return `<div class="gmyth-root" data-tab="${m.tab}">
${chaosHTML(m, t)}
${tabsHTML(m, t)}
<div class="gmyth-pages">${askHTML(m, t)}${sceneHTML(m, t)}${meaningHTML(m, t)}${listsHTML(m, t)}</div>
${logHTML(m, t)}
</div>`;
}

/**
 * A roll as a chat message: the same card as the panel's, minus its buttons.
 * `audience` is "whisper" or "table", and only labels the card.
 */
export function chatHTML(v, t, { audience = "whisper" } = {}) {
  return `<div class="gmyth-card" data-kind="${v.kind}" data-tone="${v.tone}" data-audience="${audience}">
  <div class="gmyth-card-head">${icon(v.icon)}<span class="gmyth-hero-title">${tx(v.title, t)}</span></div>
  ${v.question ? `<p class="gmyth-question">${tx(v.question, t)}</p>` : ""}
  <p class="gmyth-headline">${tx(v.headline, t)}</p>
  ${v.meta.length ? `<p class="gmyth-meta">${esc(metaText(v, t))}</p>` : ""}
  ${v.note ? `<p class="gmyth-note">${tx(v.note, t)}</p>` : ""}
  ${v.lines.length ? `<div class="gmyth-lines">${v.lines.map((l) => lineHTML(l, t)).join("")}</div>` : ""}
</div>`;
}
