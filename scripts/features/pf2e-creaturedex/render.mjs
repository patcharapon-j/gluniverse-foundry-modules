/**
 * Creaturedexing — markup for every surface the feature draws.
 *
 * Pure: every function takes a model from `model.mjs` and a context
 * `{ t, enrich }` (localise, and resolve PF2e's inline text) and returns a
 * string. No `game`, no `foundry`, no DOM. The window, the Falsify dialog, the
 * chat notice and the preview page all call these, so the preview draws the
 * markup the module ships rather than a hand-kept copy of it.
 *
 * Two rules from the book shape what is drawn.
 *
 * **An unknown section is drawn, not omitted.** The sealed plate is the point
 * of the feature: a player has to see that a creature *has* a Defense they have
 * not bought, or the dex is just a shorter stat block. It names the section and
 * nothing else; a row count, or labels with blanked values, would leak shape.
 *
 * **A false section is drawn exactly like a true one** in a player's view. The
 * model never hands a player a `false` state, and nothing here invents one.
 */

import { escapeHTML } from "../../core/util.mjs";

const esc = (v) => escapeHTML(String(v ?? ""));
const identity = async (html) => String(html ?? "");

/** The action cost a stat block prints. Passive prints nothing. */
export const costGlyph = (cost) => {
  if (cost === "reaction") return "⤾";
  if (cost === "free") return "◇";
  if (cost === "passive") return "";
  return "◆".repeat(Math.max(1, Math.min(3, Number(cost) || 1)));
};

const row = (label, valueHTML) =>
  `<div class="gldex-row"><span class="gldex-row-key">${esc(label)}</span><span class="gldex-row-val">${valueHTML}</span></div>`;

async function abilityHTML(entry, { enrich = identity } = {}) {
  const glyph = costGlyph(entry?.cost);
  const traits = entry?.traits?.length
    ? `<span class="gldex-traits">${entry.traits.map((t) => `<span class="gldex-trait">${esc(t)}</span>`).join("")}</span>`
    : "";
  const body = await enrich(entry?.html ?? "");
  return (
    `<div class="gldex-ability"><div class="gldex-ability-head">` +
    `<span class="gldex-ability-name">${esc(entry?.name)}</span>` +
    (glyph ? `<span class="gldex-cost" aria-hidden="true">${glyph}</span>` : "") +
    traits +
    `</div>` +
    (body ? `<div class="gldex-ability-body">${body}</div>` : "") +
    `</div>`
  );
}

function strikeHTML(entry, kind, t) {
  const bits = [
    entry.bonus ? `<span class="gldex-num">${esc(entry.bonus)}</span>` : "",
    entry.range ? `<span class="gldex-dim">${esc(entry.range)}</span>` : "",
    entry.traits?.length ? `<span class="gldex-dim">(${esc(entry.traits.join(", "))})</span>` : "",
    entry.damage ? `<span class="gldex-dmg">${esc(entry.damage)}</span>` : "",
    entry.effects?.length ? `<span class="gldex-dim">${esc(`plus ${entry.effects.join(", ")}`)}</span>` : "",
  ].filter(Boolean);
  return row(t(`GLDEX.row.${kind}`), `<strong>${esc(entry.name)}</strong> ${bits.join(" ")}`);
}

function spellHTML(block, t) {
  const meta = [block.tradition, block.dc, block.attack].filter(Boolean).join(", ");
  const ranks = (block.ranks ?? [])
    .map((r) => `<div class="gldex-spell-rank"><span>${esc(r.label)}</span> ${esc((r.names ?? []).join(", "))}</div>`)
    .join("");
  return row(t(`GLDEX.row.${block.kind}`), `${meta ? `<em class="gldex-dim">${esc(meta)}</em>` : ""}${ranks}`);
}

/** One held section, as the stat block fragment it is. */
export async function sectionHTML(section, ctx = {}) {
  const { t = (k) => k, enrich = identity } = ctx;
  if (!section) return "";
  const parts = (section.rows ?? []).map((r) => row(t(`GLDEX.row.${r.key}`), esc(r.value)));
  if (section.prose) {
    const prose = await enrich(section.prose);
    if (prose) parts.push(`<div class="gldex-prose">${prose}</div>`);
  }
  for (const entry of section.strikes?.melee ?? []) parts.push(strikeHTML(entry, "melee", t));
  for (const entry of section.strikes?.ranged ?? []) parts.push(strikeHTML(entry, "ranged", t));
  for (const block of section.spells ?? []) parts.push(spellHTML(block, t));
  for (const entry of section.abilities ?? []) parts.push(await abilityHTML(entry, ctx));
  return parts.join("");
}

/** The sealed plate: the section's name, and nothing about its shape. */
export function sealedHTML(key, { t = (k) => k } = {}) {
  const name = t(`GLDEX.section.${key}`);
  return (
    `<div class="gldex-sealed"><i class="fa-solid fa-lock" aria-hidden="true"></i>` +
    `<span class="gldex-sealed-line">${esc(t("GLDEX.app.sealedShort"))}</span>` +
    `<span class="gldex-sr">${esc(t("GLDEX.sealed", { section: name }))}</span></div>`
  );
}

/**
 * Fill every section's `html` (and the held-back abilities') ahead of drawing.
 * Async because PF2e's inline text is enriched; the markup itself is sync.
 */
export async function prepareDetail(detail, ctx = {}) {
  if (!detail) return detail;
  for (const s of detail.sections) s.html = s.snapshot ? await sectionHTML(s.snapshot, ctx) : sealedHTML(s.key, ctx);
  detail.deferredHTML = [];
  for (const entry of detail.deferred ?? []) detail.deferredHTML.push(await abilityHTML(entry, ctx));
  return detail;
}

/* ── the window ─────────────────────────────────────────────────────────── */

function barHTML(m, t) {
  const owners = m.showOwners
    ? `<div class="gldex-owners" role="group" aria-label="${esc(t(m.isGM ? "GLDEX.app.revealTo" : "GLDEX.app.knownTo"))}">` +
      `<span class="gldex-owners-label">${esc(t(m.isGM ? "GLDEX.app.revealTo" : "GLDEX.app.knownTo"))}</span>` +
      m.owners
        .map(
          (o) =>
            `<button type="button" class="gldex-owner${o.on ? " is-on" : ""}" data-action="setOwner" data-owner="${esc(o.id)}" aria-pressed="${o.on}">` +
            `${esc(o.everyone ? t("GLDEX.app.everyone") : o.name)}</button>`
        )
        .join("") +
      `</div>`
    : m.isGM
      ? `<span class="gldex-bar-owner">${esc(t("GLDEX.app.everyone"))}</span>`
      : `<span class="gldex-bar-owner">${esc(m.ownerName)}</span>`;
  const tag = m.party ? `<span class="gldex-bar-tag">${esc(t("GLDEX.app.party"))}</span>` : "";
  // The window frame already says "Creaturedex"; the bar says whose it is.
  return `<header class="gldex-bar"><span class="gldex-mark" aria-hidden="true"></span>${owners}${tag}</header>`;
}

const pipsHTML = (pips, t) =>
  `<span class="gldex-pips" aria-hidden="true">` +
  pips.map((p) => `<i class="gldex-pip" data-section="${esc(p.key)}" data-state="${esc(p.state)}" title="${esc(t(`GLDEX.section.${p.key}`))}"></i>`).join("") +
  `</span>`;

function entryHTML(e, t) {
  const status = e.complete
    ? `<i class="fa-solid fa-check gldex-entry-seal" aria-hidden="true"></i>`
    : `<span class="gldex-entry-count">${e.count}/${e.total}</span>`;
  const label = e.complete ? t("GLDEX.app.complete") : t("GLDEX.app.progress", { held: e.count, total: e.total });
  return (
    `<button type="button" class="gldex-entry${e.on ? " is-on" : ""}${e.complete ? " is-complete" : ""}${e.believed ? " is-believed" : ""}"` +
    ` data-action="setSubject" data-key="${esc(e.key)}" data-name="${esc(e.name)}" aria-current="${e.on}"${e.hidden ? " hidden" : ""}>` +
    (e.img ? `<img class="gldex-entry-img" src="${esc(e.img)}" alt="">` : `<span class="gldex-entry-img" aria-hidden="true"></span>`) +
    `<span class="gldex-entry-meta"><span class="gldex-entry-name">${esc(e.name)}</span>${pipsHTML(e.pips, t)}</span>` +
    `<span class="gldex-entry-state" title="${esc(label)}">${status}<span class="gldex-sr">${esc(label)}</span></span>` +
    `</button>`
  );
}

function shelfHTML(m, t) {
  const s = m.shelf;
  const search = s.searchable
    ? `<label class="gldex-search"><i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>` +
      `<input type="search" name="gldex-query" value="${esc(s.query)}" placeholder="${esc(t("GLDEX.app.search"))}" aria-label="${esc(t("GLDEX.app.search"))}" autocomplete="off" spellcheck="false"></label>`
    : "";
  return (
    `<nav class="gldex-shelf${s.empty ? " is-empty" : ""}" aria-label="${esc(t("GLDEX.app.title"))}">${search}` +
    `<div class="gldex-shelf-list">${s.entries.map((e) => entryHTML(e, t)).join("")}</div>` +
    `<p class="gldex-empty gldex-nomatch"${s.noMatch ? "" : " hidden"}>${esc(t("GLDEX.app.noMatch"))}</p>` +
    `</nav>`
  );
}

function noteHTML(n, t) {
  const sections = (n.sections ?? []).map((k) => t(`GLDEX.section.${k}`)).join(", ");
  return `<p class="gldex-note" data-tone="${esc(n.tone)}">${esc(t(n.key, { sections }))}</p>`;
}

function controlsHTML(s, t) {
  const b = (action, cls, label, icon) =>
    `<button type="button" class="gldex-ctl ${cls}" data-action="${action}" data-section="${esc(s.key)}"><i class="fa-solid ${icon}" aria-hidden="true"></i>${esc(t(label))}</button>`;
  return (
    `<span class="gldex-controls">` +
    (s.canReveal ? b("revealSection", "gldex-toggle gldex-reveal", "GLDEX.app.reveal", "fa-eye") : "") +
    (s.canFalsify ? b("falsifySection", "gldex-falsify", "GLDEX.app.falsify", "fa-mask") : "") +
    (s.canClear ? b("clearSection", "gldex-toggle gldex-redact", "GLDEX.app.redact", "fa-eye-slash") : "") +
    `</span>`
  );
}

function sectionPlateHTML(s, t, isGM) {
  return (
    `<article class="gldex-section${s.fresh ? " is-fresh" : ""}" data-section="${esc(s.key)}" data-state="${esc(s.state)}" style="--gldex-i:${s.index}">` +
    `<header class="gldex-section-head"><span class="gldex-section-label">${esc(t(`GLDEX.section.${s.key}`))}</span>` +
    (s.isLie ? `<span class="gldex-section-lie">${esc(t("GLDEX.app.false"))}</span>` : "") +
    (isGM ? controlsHTML(s, t) : "") +
    `</header><div class="gldex-section-body">${s.html ?? ""}</div></article>`
  );
}

function indexHTML(d, t) {
  return (
    `<nav class="gldex-index" aria-label="${esc(t("GLDEX.app.sections"))}">` +
    d.sections
      .map(
        (s) =>
          `<button type="button" class="gldex-index-item" data-action="jumpSection" data-section="${esc(s.key)}" data-state="${esc(s.state)}">` +
          `<i class="gldex-pip" data-section="${esc(s.key)}" data-state="${esc(s.state)}" aria-hidden="true"></i>` +
          `<span>${esc(t(`GLDEX.section.${s.key}`))}</span></button>`
      )
      .join("") +
    `</nav>`
  );
}

function detailHTML(m, t) {
  const d = m.detail;
  if (!d) return `<section class="gldex-detail"><p class="gldex-empty gldex-pick">${esc(t(m.shelf.empty ? "GLDEX.app.emptyHint" : "GLDEX.app.pick"))}</p></section>`;
  const progress = t("GLDEX.app.progress", { held: d.count, total: d.total });
  const status = d.complete
    ? `<span class="gldex-status is-complete"><i class="fa-solid fa-check" aria-hidden="true"></i>${esc(t("GLDEX.app.complete"))}</span>`
    : d.believed
      ? `<span class="gldex-status is-believed"><i class="fa-solid fa-mask" aria-hidden="true"></i>${esc(t("GLDEX.app.believed"))}</span>`
      : "";
  const tools = m.isGM
    ? `<div class="gldex-detail-tools">` +
      `<button type="button" class="gldex-tool gldex-refresh" data-action="refreshSubject" title="${esc(t("GLDEX.app.refreshHint"))}"><i class="fa-solid fa-rotate" aria-hidden="true"></i>${esc(t("GLDEX.app.refresh"))}</button>` +
      `<button type="button" class="gldex-tool gldex-forget" data-action="forgetSubject" data-key="${esc(d.key)}" title="${esc(t("GLDEX.app.forgetHint"))}"><i class="fa-solid fa-trash" aria-hidden="true"></i>${esc(t("GLDEX.forget.action"))}</button>` +
      `</div>`
    : "";
  const lies = d.lies ? ` · <span class="gldex-lie-count">${esc(t("GLDEX.app.lieCount", { n: d.lies }))}</span>` : "";
  const deferred = d.deferredHTML?.length
    ? `<article class="gldex-section gldex-section-extra" data-state="known" style="--gldex-i:${d.sections.length}">` +
      `<header class="gldex-section-head"><span class="gldex-section-label">${esc(t("GLDEX.app.deferredTitle"))}</span></header>` +
      `<div class="gldex-section-body">${d.deferredHTML.join("")}</div></article>`
    : "";
  return (
    `<section class="gldex-detail" data-kind="${esc(d.kind)}">` +
    `<header class="gldex-detail-head">` +
    (d.img ? `<img class="gldex-detail-img" src="${esc(d.img)}" alt="">` : `<span class="gldex-detail-img" aria-hidden="true"></span>`) +
    `<div class="gldex-detail-meta"><span class="gldex-detail-kind">${esc(t(`GLDEX.kind.${d.kind}`))}</span>` +
    `<h2 class="gldex-detail-name">${esc(d.name)}</h2>` +
    `<span class="gldex-detail-progress">${esc(progress)}${lies}</span></div>` +
    status +
    tools +
    `</header>` +
    indexHTML(d, t) +
    d.notes.map((n) => noteHTML(n, t)).join("") +
    `<div class="gldex-sections">${d.sections.map((s) => sectionPlateHTML(s, t, m.isGM)).join("")}${deferred}</div>` +
    `</section>`
  );
}

/** The whole window body. `prepareDetail` must have run on `model.detail`. */
export function dexHTML(model, { t = (k) => k } = {}) {
  return (
    `<div class="gldex-root gl-type" data-view="${model.isGM ? "gm" : "player"}"${model.entering ? " data-entering" : ""}>` +
    barHTML(model, t) +
    `<div class="gldex-body">${shelfHTML(model, t)}${detailHTML(model, t)}</div>` +
    `</div>`
  );
}

/* ── the Falsify dialog ─────────────────────────────────────────────────── */

export function falsifyHTML(m, { t = (k) => k } = {}) {
  const section = t(`GLDEX.section.${m.section}`);
  const mode = (id, label) =>
    `<button type="button" class="gldex-lie-mode${m.mode === id ? " is-on" : ""}" data-action="setMode" data-mode="${id}" aria-pressed="${m.mode === id}">${esc(t(label))}</button>`;
  const source =
    m.mode === "borrow"
      ? `<label class="gldex-lie-field"><span>${esc(t("GLDEX.falsify.sourceLabel"))}</span><select name="source">` +
        m.candidates
          .map((c) => `<option value="${esc(c.id)}"${c.selected ? " selected" : ""}>${esc(c.name)}${c.level != null ? ` (${esc(c.level)})` : ""}</option>`)
          .join("") +
        `</select></label><p class="gldex-lie-note">${esc(t("GLDEX.falsify.borrowHint"))}</p>`
      : `<p class="gldex-lie-note">${esc(t("GLDEX.falsify.doctorHint"))}${m.iwr ? ` ${esc(t("GLDEX.falsify.iwrOn"))}` : ""}</p>`;
  const draft = m.ready
    ? `<div class="gldex-lie-draft">` +
      `<div class="gldex-lie-cols" aria-hidden="true"><span></span><span>${esc(t("GLDEX.falsify.truth"))}</span><span>${esc(t("GLDEX.falsify.tag"))}</span></div>` +
      m.rows
        .map(
          (r) =>
            `<label class="gldex-lie-row${r.changed ? " is-changed" : ""}"><span class="gldex-lie-key">${esc(t(`GLDEX.row.${r.key}`))}</span>` +
            `<span class="gldex-lie-truth">${r.hasTruth ? esc(r.truth) : "–"}</span>` +
            `<input type="text" data-row-key="${esc(r.key)}" data-truth="${esc(r.truth)}" value="${esc(r.value)}" placeholder="${esc(t("GLDEX.falsify.omitted"))}" autocomplete="off" spellcheck="false"></label>`
        )
        .join("") +
      (m.extras.length ? `<ul class="gldex-lie-extras">${m.extras.map((x) => `<li>${esc(t(x.key, { n: x.n }))}</li>`).join("")}</ul>` : "") +
      `<p class="gldex-lie-note">${esc(t("GLDEX.falsify.editHint"))}</p>` +
      `</div>`
    : `<p class="gldex-lie-empty">${esc(t("GLDEX.falsify.empty"))}</p>`;
  return (
    `<div class="gldex-lie-root gl-type" data-mode="${m.mode}">` +
    `<header class="gldex-lie-head"><span class="gldex-lie-tag">${esc(t("GLDEX.falsify.tag"))}</span>` +
    `<h3 class="gldex-lie-title">${esc(section)} <span class="gldex-dim">·</span> ${esc(m.subjectName)}</h3>` +
    (m.toName ? `<p class="gldex-lie-for">${esc(t("GLDEX.falsify.for", { who: m.toName }))}</p>` : "") +
    `</header>` +
    `<div class="gldex-lie-modes" role="group">${mode("borrow", "GLDEX.falsify.borrow")}${mode("doctor", "GLDEX.falsify.doctor")}</div>` +
    source +
    draft +
    `<footer class="gldex-lie-foot">` +
    `<span class="gldex-lie-diff" data-total="${m.rows.length}">${m.ready ? esc(t("GLDEX.falsify.changed", { n: m.changed, total: m.rows.length })) : ""}</span>` +
    `<button type="button" class="gldex-lie-gen" data-action="generate"><i class="fa-solid fa-dice" aria-hidden="true"></i>${esc(t(m.ready ? "GLDEX.falsify.reroll" : "GLDEX.falsify.generate"))}</button>` +
    `<button type="button" class="gldex-lie-send" data-action="send"${m.ready ? "" : " disabled"}><i class="fa-solid fa-mask" aria-hidden="true"></i>${esc(t("GLDEX.falsify.send"))}</button>` +
    `</footer></div>`
  );
}

/* ── the reveal notice ──────────────────────────────────────────────────── */

/**
 * The chat card a reveal posts. A true reveal and a lie produce identical
 * markup: the model carries no truth flag, and nothing here could add one.
 */
export function noticeHTML(n, { t = (k) => k } = {}) {
  const section = t(`GLDEX.section.${n.section}`);
  const who = n.who?.length ? n.who.join(", ") : t("GLDEX.notice.party");
  return (
    `<div class="gldex-card" data-section="${esc(n.section)}" data-complete="${n.complete ? "true" : "false"}">` +
    `<div class="gldex-card-head"><span class="gldex-card-mark" aria-hidden="true"></span>` +
    `<span class="gldex-card-kicker">${esc(t("GLDEX.app.title"))}</span><span class="gldex-card-section">${esc(section)}</span></div>` +
    `<div class="gldex-card-line">${esc(t("GLDEX.chat.learned", { who, section, name: n.subjectName }))}</div>` +
    (n.complete ? `<div class="gldex-card-done"><i class="fa-solid fa-check" aria-hidden="true"></i>${esc(t("GLDEX.chat.complete"))}</div>` : "") +
    `</div>`
  );
}
