/**
 * Save Resolution — markup. One renderer for both hosts: the panel window and
 * the session's chat card draw the same rows from the same view, so a row can
 * never say two things in two places. Pure: the preview page imports it.
 *
 * Every string a row prints arrives already gated (model.mjs `rowView`); this
 * only escapes and lays it out.
 */

import { escapeHTML } from "../../core/util.mjs";
import { DEGREES, MULTS } from "./constants.mjs";

const ident = (k) => k;
const D = ["cf", "f", "s", "c"];

const multText = (m) => (m === 0.5 ? "×½" : `×${m}`);

function degreeChip(row, t) {
  if (row.degree == null) return "";
  const key = DEGREES[row.degree];
  return `<span class="glsv-degree" data-d="${D[row.degree]}">${escapeHTML(t(`GLSV.degree.${key}`))}</span>`;
}

function rollFigure(row) {
  if (row.face == null && row.total == null) return "";
  const face = row.face != null ? `<span class="glsv-face" data-nat="${row.face === 20 ? "hi" : row.face === 1 ? "lo" : ""}">${row.face}</span>` : "";
  const total = row.total != null ? `<span class="glsv-total">${row.total}</span>` : "";
  return `<span class="glsv-roll">${face}${total}</span>`;
}

function previewText(p, t) {
  if (!p) return "";
  const notes = p.notes.map((n) => `<span class="glsv-iwr" data-k="${n.kind}">${escapeHTML(t(`GLSV.iwr.${n.kind}`).replace("{label}", n.label).replace("{n}", String(n.amount)))}</span>`).join("");
  const pers = p.persistent ? `<span class="glsv-iwr" data-k="persistent">${escapeHTML(t("GLSV.iwr.persistent"))}</span>` : "";
  return `<div class="glsv-preview"><span class="glsv-takes">${escapeHTML(t("GLSV.row.takes").replace("{n}", String(p.final)))}</span>${notes}${pers}</div>`;
}

function effectsText(effects) {
  if (!effects?.length) return "";
  return `<div class="glsv-effects">${effects.map((e) => `<span class="glsv-effect">${escapeHTML(e.label)}</span>`).join("")}</div>`;
}

function multSelect(row, t) {
  if (row.mult == null) return "";
  const opts = MULTS.map((m) => `<option value="${m}"${m === row.mult ? " selected" : ""}>${escapeHTML(multText(m))}</option>`).join("");
  return `<select class="glsv-mult" data-change="rowMult" data-row="${escapeHTML(row.id)}" aria-label="${escapeHTML(t("GLSV.row.mult"))}">${opts}</select>`;
}

const STATE_ICON = { waiting: "fa-hourglass-half", sealed: "fa-eye-slash", rolled: "fa-dice-d20", applied: "fa-check" };

export function rowHTML(row, { t = ident } = {}) {
  const btn = (action, icon, label, cls = "") =>
    `<button type="button" class="gl-btn glsv-btn ${cls}" data-action="${action}" data-row="${escapeHTML(row.id)}" data-tooltip="${escapeHTML(label)}" aria-label="${escapeHTML(label)}"><i class="fa-solid ${icon}"></i></button>`;
  const status = row.state === "waiting" || row.state === "sealed" || row.state === "applied"
    ? `<span class="glsv-state" data-s="${row.state}"><i class="fa-solid ${STATE_ICON[row.state]}"></i> ${escapeHTML(t(`GLSV.state.${row.state}`))}</span>`
    : "";
  const img = row.img ? `<img class="glsv-img" src="${escapeHTML(row.img)}" alt="">` : `<span class="glsv-img glsv-img--blank"><i class="fa-solid fa-question"></i></span>`;
  const name = row.name ? escapeHTML(row.name) : `<em>${escapeHTML(t("GLSV.row.unknown"))}</em>`;
  return `<li class="glsv-row" data-row="${escapeHTML(row.id)}" data-kind="${row.kind}" data-state="${row.state}"${row.degree != null ? ` data-d="${D[row.degree]}"` : ""}${row.hidden ? " data-hidden" : ""}>
    ${img}
    <div class="glsv-main">
      <div class="glsv-name">${name}${row.hidden ? ` <i class="fa-solid fa-eye-slash glsv-hid" data-tooltip="${escapeHTML(t("GLSV.row.hidden"))}"></i>` : ""}</div>
      <div class="glsv-line">${degreeChip(row, t)}${rollFigure(row)}${status}${row.odds ? `<span class="glsv-odds">${row.odds}</span>` : ""}</div>
      ${previewText(row.preview, t)}${effectsText(row.effects)}
    </div>
    <div class="glsv-acts">
      ${multSelect(row, t)}
      ${row.canRoll ? btn("roll", "fa-dice-d20", t("GLSV.row.roll"), "glsv-btn--roll") : ""}
      ${row.canApply ? btn("apply", "fa-check", t("GLSV.row.apply"), "glsv-btn--apply") : ""}
      ${row.canRevert ? btn("revert", "fa-rotate-left", t("GLSV.row.revert")) : ""}
      ${row.canRemove ? btn("remove", "fa-xmark", t("GLSV.row.remove"), "glsv-btn--quiet") : ""}
    </div>
  </li>`;
}

function blockedHTML(view, t) {
  if (!view.blocked?.length) return "";
  const rows = view.blocked.map((b) => `<li class="glsv-blocked-row">
      ${b.img ? `<img class="glsv-img" src="${escapeHTML(b.img)}" alt="">` : `<span class="glsv-img glsv-img--blank"></span>`}
      <span class="glsv-name">${b.name ? escapeHTML(b.name) : `<em>${escapeHTML(t("GLSV.row.unknown"))}</em>`}</span>
      ${view.isGM ? `<button type="button" class="gl-btn glsv-btn" data-action="unblock" data-row="${escapeHTML(b.id)}" data-tooltip="${escapeHTML(t("GLSV.blocked.add"))}"><i class="fa-solid fa-plus"></i></button>` : ""}
    </li>`).join("");
  return `<section class="glsv-blocked"><h4 class="glsv-sub">${escapeHTML(t("GLSV.blocked.title"))}<span class="glsv-hint">${escapeHTML(t("GLSV.blocked.hint"))}</span></h4><ul class="glsv-list">${rows}</ul></section>`;
}

function configHTML(view, t) {
  if (!view.isGM || !view.config) return "";
  const rows = DEGREES.slice().reverse().map((k) => {
    const i = DEGREES.indexOf(k);
    const m = view.config.mult[k];
    const opts = MULTS.map((x) => `<option value="${x}"${x === m ? " selected" : ""}>${escapeHTML(multText(x))}</option>`).join("");
    const chips = view.config.effects[k].map((e, n) => `<span class="glsv-effect glsv-effect--edit">${escapeHTML(e.label)}${e.value != null
      ? ` <input type="number" class="glsv-effect-value" min="1" max="9" value="${e.value}" data-change="effectValue" data-degree="${k}" data-index="${n}" aria-label="${escapeHTML(t("GLSV.config.value"))}">` : ""}<button type="button" class="glsv-x" data-action="effectRemove" data-degree="${k}" data-index="${n}" aria-label="${escapeHTML(t("GLSV.config.remove"))}"><i class="fa-solid fa-xmark"></i></button></span>`).join("");
    return `<div class="glsv-config-row" data-d="${D[i]}">
      <span class="glsv-degree" data-d="${D[i]}">${escapeHTML(t(`GLSV.degree.${k}`))}</span>
      <select class="glsv-mult" data-change="configMult" data-degree="${k}" aria-label="${escapeHTML(t("GLSV.row.mult"))}">${opts}</select>
      <span class="glsv-config-effects">${chips}<button type="button" class="gl-btn glsv-btn glsv-btn--quiet" data-action="effectAdd" data-degree="${k}" data-tooltip="${escapeHTML(t("GLSV.config.add"))}"><i class="fa-solid fa-plus"></i></button></span>
    </div>`;
  }).join("");
  return `<details class="glsv-config"${view.configOpen ? " open" : ""}><summary class="glsv-sub">${escapeHTML(t("GLSV.config.title"))}<span class="glsv-hint">${escapeHTML(t("GLSV.config.hint"))}</span></summary>${rows}</details>`;
}

function toolbarHTML(view, t) {
  if (!view.isGM) return "";
  const b = (action, icon, label, on = true, cls = "") =>
    `<button type="button" class="gl-btn glsv-tool ${cls}" data-action="${action}"${on ? "" : " disabled"}><i class="fa-solid ${icon}"></i> ${escapeHTML(label)}</button>`;
  const dmg = view.damage
    ? `<span class="glsv-damage" data-tooltip="${escapeHTML(view.damage.formula)}"><i class="fa-solid fa-burst"></i> ${escapeHTML(view.damage.total)} ${escapeHTML(view.damage.types)}</span>`
    : "";
  return `<div class="glsv-toolbar">
    ${b("rollNpcs", "fa-dice", t("GLSV.tool.rollNpcs"), view.npcsToRoll > 0)}
    ${b("rollDamage", "fa-burst", t(view.damage ? "GLSV.tool.rerollDamage" : "GLSV.tool.rollDamage"), view.canRollDamage)}
    ${dmg}
    <span class="glsv-spacer"></span>
    ${b("addTargets", "fa-crosshairs", t("GLSV.tool.addTargets"))}
    ${b("applyAll", "fa-check-double", t("GLSV.tool.applyAll"), view.toApply > 0, "glsv-tool--primary")}
    ${b("revertAll", "fa-rotate-left", t("GLSV.tool.revertAll"), view.toRevert > 0)}
  </div>`;
}

/**
 * The whole session.
 * @param {{title, save, dc, basic, isGM, rows, blocked, config, damage, npcsToRoll,
 *          toApply, toRevert, canRollDamage, compact}} view
 */
export function sessionHTML(view, { t = ident } = {}) {
  const head = `<header class="glsv-head">
    ${view.img ? `<img class="glsv-spell" src="${escapeHTML(view.img)}" alt="">` : ""}
    <div class="glsv-title"><span class="glsv-spell-name">${escapeHTML(view.title)}</span>
      <span class="glsv-save">${escapeHTML(view.saveLine)}</span></div>
    ${view.compact && view.canOpen ? `<button type="button" class="gl-btn glsv-btn" data-action="openPanel" data-tooltip="${escapeHTML(t("GLSV.card.open"))}"><i class="fa-solid fa-up-right-from-square"></i></button>` : ""}
  </header>`;
  const rows = view.rows.length
    ? `<ul class="glsv-list">${view.rows.map((r) => rowHTML(r, { t })).join("")}</ul>`
    : `<p class="glsv-empty">${escapeHTML(t("GLSV.empty"))}</p>`;
  return `<div class="glsv-session${view.compact ? " glsv-session--card" : ""}">${head}${view.compact ? "" : toolbarHTML(view, t)}${rows}${view.compact ? "" : blockedHTML(view, t) + configHTML(view, t)}${view.compact && view.isGM && view.toRevert ? `<div class="glsv-card-foot">${`<button type="button" class="gl-btn glsv-tool" data-action="revertAll"><i class="fa-solid fa-rotate-left"></i> ${escapeHTML(t("GLSV.tool.revertAll"))}</button>`}</div>` : ""}</div>`;
}
