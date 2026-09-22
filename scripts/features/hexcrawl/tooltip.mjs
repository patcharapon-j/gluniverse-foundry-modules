/**
 * Hexcrawl — the hover tooltip (every client).
 *
 * Everything it prints comes out of viewFor(map, key, { asGM }), with asGM
 * false for players AND for a GM who switched on "view as players". That one
 * call is the only thing standing between a masked hex and its withheld name,
 * so nothing here reads map.hexes / map.regions for a player directly — the
 * GM-only block is built from the raw map, and only inside `if (gm)`.
 *
 * No capture layer: it listens to canvas.stage's pointermove, which Foundry
 * already delivers, and maps the world point through the store's adapter.
 */

import { escapeHTML } from "../../core/util.mjs";
import { MASK_FIELDS, RATING_MAX } from "./constants.mjs";
import { glyphSvgPath } from "./glyphs.mjs";
import { effectiveTerrainId, encounterDice, getHex, getRegion, maskFields, resolveAsset, travelCost, viewFor, visualFor } from "./model.mjs";
import { featurePath } from "../../core/const.mjs";
import { FEATURE_ID } from "./constants.mjs";
import { L, costLabel, presetName, ratingName, terrainName, tooltipDelay } from "./labels.mjs";
import { host } from "./host.mjs";
import { HexStore } from "./store.mjs";

const OFFSET = 18;         // px from the cursor
const EDGE = 8;            // px kept clear of the viewport edge
const PIN_SLOP = 4;        // px a left press may travel and still pin

const uiScale = (el) => {
  const z = parseFloat(getComputedStyle(el).zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
};

export function glyphSvg(id, color = null) {
  const d = glyphSvgPath(id);
  if (!d) return "";
  const style = color ? ` style="color:${escapeHTML(color)}"` : "";
  return `<svg class="glhex-glyph" viewBox="-10 -10 20 20" aria-hidden="true"${style}><path d="${escapeHTML(d)}"/></svg>`;
}

export function pipsHTML(n, { masked = false } = {}) {
  let out = `<span class="glhex-pips${masked ? " is-masked" : ""}"${n ? ` data-glhex-rating="${n}"` : ""} aria-hidden="true">`;
  for (let i = 1; i <= RATING_MAX; i++) out += `<i class="glhex-pip${n && i <= n ? " is-on" : ""}"></i>`;
  return `${out}</span>`;
}

function canView(uuid) {
  if (!uuid) return false;
  if (game.user.isGM) return true;
  try {
    const doc = fromUuidSync(uuid);
    return !!doc?.testUserPermission?.(game.user, "LIMITED");
  } catch { return false; }
}

/** Tooltip body HTML for one hex, or null when this viewer gets nothing. */
export function tooltipHTML(store, key) {
  const map = store.map;
  const gm = !!game.user.isGM && !store.viewAsPlayers;
  const v = viewFor(map, key, { asGM: gm });
  const hidden = v.state === "hidden";
  if (!gm && hidden && !v.landmarks.length) return null;

  const rows = [];
  const title = v.name || (v.nameUnknown ? L("GLHEX.tooltip.unknownName") : "")
    || (v.terrain && !hidden ? terrainName(map, v.terrain.id) : "") || L("GLHEX.tooltip.uncharted");
  rows.push(`<header class="glhex-tip-head"><span class="glhex-tip-name">${escapeHTML(title)}</span>`
    + (gm ? `<span class="glhex-tip-state is-${v.state}">${escapeHTML(L(`GLHEX.state.${v.state}`))}</span>` : "")
    + `</header>`);

  if (!gm && hidden) rows.push(`<div class="glhex-tip-line is-dim">${escapeHTML(L("GLHEX.tooltip.uncharted"))}</div>`);

  if (v.terrain) {
    const tid = v.terrain.id ?? effectiveTerrainId(map, key);
    // The same art the map draws (a region variant, else the terrain icon), tinted by CSS mask.
    const icon = visualFor(map, key, v).icon;
    const url = icon ? resolveAsset(icon, { assetBase: map.assetBase, builtinRoot: featurePath(FEATURE_ID, "assets/x").slice(0, -1) }) : null;
    const mark = url
      ? `<span class="glhex-tip-icon" style="color:${escapeHTML(v.terrain.color)};--glhex-icon:url(&quot;${escapeHTML(url)}&quot;)" aria-hidden="true"></span>`
      : glyphSvg(v.terrain.glyph, v.terrain.color);
    rows.push(`<div class="glhex-tip-line glhex-tip-terrain">${mark}`
      + `<span>${escapeHTML(terrainName(map, tid))}</span>`
      + (v.blight ? `<span class="glhex-tip-blight">${escapeHTML(L("GLHEX.tooltip.blight"))}</span>` : "")
      + `</div>`);
  }

  if (v.rating != null) {
    const cost = travelCost(map, key);
    rows.push(`<div class="glhex-tip-line glhex-tip-rating" data-glhex-rating="${v.rating}">${pipsHTML(v.rating)}`
      + `<span class="glhex-rating-word">${escapeHTML(ratingName(v.rating))}</span>`
      + `<span class="glhex-tip-cost gl-numeric">${escapeHTML(costLabel(map.config, cost))}</span></div>`);
  } else if (!hidden && v.state === "masked") {
    rows.push(`<div class="glhex-tip-line glhex-tip-rating">${pipsHTML(0, { masked: true })}`
      + `<span class="is-dim">${escapeHTML(L("GLHEX.tooltip.ratingUnknown"))}</span></div>`);
  }

  if (v.rumor) rows.push(`<div class="glhex-tip-line glhex-tip-rumor"><i class="fa-solid fa-comment-dots"></i><span>${escapeHTML(v.rumor)}</span></div>`);

  if (v.landmarks.length) {
    const items = v.landmarks.map((lm) => {
      // The badge's own colour, so the row and the mark on the map match.
      const style = lm.color ? ` style="color:${escapeHTML(lm.color)}"` : "";
      const icon = lm.icon ? `<i class="${escapeHTML(lm.icon)}"${style}></i>` : `<i class="fa-solid fa-diamond"${style}></i>`;
      const label = escapeHTML(lm.label || L("GLHEX.tooltip.landmark"));
      // GM only: whether the party can see this badge right now (viewFor's `seen`),
      // and the rule behind it. Players are handed nothing they cannot see.
      const gmTag = gm
        ? `<span class="glhex-tip-tag ${lm.seen ? "is-seen" : "is-unseen"}">`
          + `<i class="fa-solid ${lm.seen ? "fa-eye" : "fa-eye-slash"}"></i>`
          + `${escapeHTML(L(lm.seen ? "GLHEX.tooltip.lmSeen" : "GLHEX.tooltip.lmUnseen"))}`
          + ` · ${escapeHTML(L(`GLHEX.landmarkVis.${lm.vis}`))}</span>`
        : "";
      return canView(lm.journal)
        ? `<li><a class="glhex-tip-lm is-link" data-uuid="${escapeHTML(lm.journal)}">${icon}<span>${label}</span></a>${gmTag}</li>`
        : `<li><span class="glhex-tip-lm">${icon}<span>${label}</span></span>${gmTag}</li>`;
    }).join("");
    rows.push(`<ul class="glhex-tip-landmarks">${items}</ul>`);
  }

  if (gm) {
    const h = getHex(map, key), region = getRegion(map, key);
    const gmRows = [];
    if (v.state === "masked") {
      const f = maskFields(map, h);
      const shown = MASK_FIELDS.filter((x) => f[x]).map((x) => L(`GLHEX.field.${x}`));
      gmRows.push(`<div class="glhex-tip-line"><span class="glhex-tip-k">${escapeHTML(presetName(map, h.mk?.p))}</span>`
        + `<span>${escapeHTML(shown.join(" · ") || L("GLHEX.tooltip.nothingShown"))}</span></div>`);
    }
    if (region?.name && !region.nk) {
      gmRows.push(`<div class="glhex-tip-line is-dim"><i class="fa-solid fa-eye-slash"></i><span>${escapeHTML(L("GLHEX.tooltip.nameHidden"))}</span></div>`);
    }
    if (region?.enc?.text) {
      const dice = encounterDice(map, key);
      gmRows.push(`<div class="glhex-tip-line"><span class="glhex-tip-k">${escapeHTML(L("GLHEX.tooltip.encounter"))}</span>`
        + `<span>${escapeHTML(region.enc.text)}${dice.formula ? ` <span class="gl-numeric">(${escapeHTML(dice.formula)} ≤ ${dice.trigger})</span>` : ""}</span></div>`);
    }
    if (region?.rumor?.text) {
      gmRows.push(`<div class="glhex-tip-line"><span class="glhex-tip-k">${escapeHTML(L("GLHEX.tooltip.rumor"))}</span>`
        + `<span>${escapeHTML(L(`GLHEX.truth.${region.rumor.truth}`))} · ${escapeHTML(L(region.rumor.known ? "GLHEX.tooltip.known" : "GLHEX.tooltip.unknown"))}</span></div>`);
    }
    for (const note of [h.nt, region?.notes]) {
      if (note) gmRows.push(`<div class="glhex-tip-line glhex-tip-note">${escapeHTML(note)}</div>`);
    }
    if (gmRows.length) rows.push(`<section class="glhex-tip-gm"><div class="glhex-tip-gm-label gl-tech-label">${escapeHTML(L("GLHEX.tooltip.gmOnly"))}</div>${gmRows.join("")}</section>`);
  }
  return rows.join("");
}

class Tooltip {
  constructor() {
    this.el = null;
    this.key = null;
    this.pinned = null;
    this._timer = null;
    this._last = { x: 0, y: 0 };
    this._down = null;
    this._bound = false;
    this._handlers = {};
  }

  attach() {
    if (this._bound || !canvas?.stage) return;
    const h = this._handlers;
    h.move = (ev) => this._onMove(ev);
    h.down = (ev) => { if (ev.button === 0) this._down = { x: ev.global.x, y: ev.global.y, target: ev.target }; };
    h.up = (ev) => this._onUp(ev);
    h.leave = () => { if (!this.pinned) this._clear(); };
    h.key = (ev) => { if (ev.key === "Escape" && this.pinned) this.unpin(); };
    h.docDown = (ev) => {
      if (!this.pinned) return;
      if (this.el?.contains(ev.target)) return;
      if (ev.target === canvas.app?.view) return;   // canvas clicks are handled by the stage
      this.unpin();
    };
    canvas.stage.on("pointermove", h.move);
    canvas.stage.on("pointerdown", h.down);
    canvas.stage.on("pointerup", h.up);
    canvas.app?.view?.addEventListener("pointerleave", h.leave);
    document.addEventListener("keydown", h.key);
    document.addEventListener("pointerdown", h.docDown, true);
    this._bound = true;
  }

  detach() {
    const h = this._handlers;
    try {
      canvas?.stage?.off("pointermove", h.move);
      canvas?.stage?.off("pointerdown", h.down);
      canvas?.stage?.off("pointerup", h.up);
      canvas?.app?.view?.removeEventListener("pointerleave", h.leave);
    } catch { /* canvas already gone */ }
    document.removeEventListener("keydown", h.key);
    document.removeEventListener("pointerdown", h.docDown, true);
    this._bound = false;
    this.pinned = null;
    this._clear();
    this.el?.remove();
    this.el = null;
  }

  _client(ev) {
    if (Number.isFinite(ev.clientX)) return { x: ev.clientX, y: ev.clientY };
    const r = canvas.app.view.getBoundingClientRect();
    return { x: r.left + ev.global.x, y: r.top + ev.global.y };
  }

  _keyAt(ev) {
    const s = HexStore.current;
    if (!s) return null;
    const p = canvas.stage.toLocal(ev.global);
    const k = s.adapter.keyAt(p);
    return s.adapter.inBounds(k) ? k : null;
  }

  _onMove(ev) {
    const s = HexStore.current;
    if (!s) return;
    this._last = this._client(ev);
    const k = this._keyAt(ev);
    if (k !== this.key) {
      this.key = k;
      host.setHover(k);
      if (this.pinned) return;
      this._hide();
      clearTimeout(this._timer);
      if (k) this._timer = setTimeout(() => this._show(k, this._last, false), tooltipDelay());
    } else if (!this.pinned && this.el?.classList.contains("is-visible")) {
      this._place(this._last);
    }
  }

  _onUp(ev) {
    const d = this._down; this._down = null;
    if (!d || ev.button !== 0) return;
    if (Math.hypot(ev.global.x - d.x, ev.global.y - d.y) > PIN_SLOP) return;   // a drag
    if (d.target !== canvas.stage) return;        // a token, a template, the paint capture
    const k = this._keyAt(ev);
    if (!k || k === this.pinned) { this.unpin(); return; }
    this.pinned = k;
    clearTimeout(this._timer);
    this._show(k, this._client(ev), true);
  }

  unpin() {
    this.pinned = null;
    this._hide();
  }

  /** Re-render in place (map changed under an open tooltip). */
  refresh() {
    const k = this.pinned ?? (this.el?.classList.contains("is-visible") ? this.key : null);
    if (k) this._show(k, null, !!this.pinned);
  }

  _ensureEl() {
    if (this.el) return this.el;
    const el = document.createElement("div");
    el.className = "glhex-tooltip gl-glass gl-type";
    el.setAttribute("role", "tooltip");
    el.addEventListener("click", (ev) => {
      const a = ev.target.closest?.("[data-uuid]");
      if (!a) return;
      ev.preventDefault();
      fromUuid(a.dataset.uuid).then((doc) => {
        if (!doc) return;
        if (!game.user.isGM && !doc.testUserPermission?.(game.user, "LIMITED")) return;
        (doc.sheet ?? doc.parent?.sheet)?.render(true, doc.documentName === "JournalEntryPage" ? { pageId: doc.id } : {});
      });
    });
    document.body.appendChild(el);
    this.el = el;
    return el;
  }

  _show(key, at, pinned) {
    const s = HexStore.current;
    if (!s) return;
    const html = tooltipHTML(s, key);
    if (!html) { this._hide(); if (pinned) this.pinned = null; return; }
    const el = this._ensureEl();
    el.innerHTML = html;
    el.classList.toggle("is-pinned", !!pinned);
    el.classList.add("is-visible");
    el.dataset.key = key;
    if (at) this._place(at);
  }

  _place({ x, y }) {
    const el = this.el;
    if (!el) return;
    // The tooltip sits in the suite's interface-scale roster (CSS zoom), so
    // left/top are multiplied by the zoom: position in unzoomed units, measure
    // the rendered box.
    const z = uiScale(el);
    const box = el.getBoundingClientRect();
    const w = box.width, h = box.height;
    let left = x + OFFSET, top = y + OFFSET;
    if (left + w > window.innerWidth - EDGE) left = Math.max(EDGE, x - OFFSET - w);
    if (top + h > window.innerHeight - EDGE) top = Math.max(EDGE, y - OFFSET - h);
    el.style.left = `${Math.round(left / z)}px`;
    el.style.top = `${Math.round(top / z)}px`;
  }

  _hide() {
    this.el?.classList.remove("is-visible", "is-pinned");
  }

  _clear() {
    clearTimeout(this._timer);
    this._timer = null;
    this.key = null;
    host.setHover(null);
    this._hide();
  }
}

export const tooltip = new Tooltip();
