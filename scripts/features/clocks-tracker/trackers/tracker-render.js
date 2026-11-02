/**
 * Tracker rows: the DOM every surface draws.
 *
 * PURE in the sense the check tools pin: it touches `document` and nothing of
 * the world (no `game`, `foundry`, `ui`, `Hooks`, `canvas`). It is handed row
 * views from ./view.js and a localize function `L(key, data)`, and it reports
 * gestures through `onAction`; deciding what a gesture is allowed to do belongs
 * to the shell that owns the store. The dock, the PF2e sheet tab, the editor's
 * live sample and tools/trackers-preview.mjs all mount this one class, so the
 * preview is the code Foundry runs.
 *
 * The list is KEYED. A row that keeps its id and shape keeps its element, so a
 * value change animates in place (the number rolls, the meter fills, a delta
 * chip rises, the row's edge sweeps); a shape change rebuilds that row alone.
 * Animation restarts never force a layout: a one-shot replays by alternating
 * between two identical keyframes (`data-flash="a" | "b"`).
 */

import { escapeHTML as esc } from "../../../core/util.mjs";
import { TAGS, deltaText } from "./view.js";

const SVG = "http://www.w3.org/2000/svg";

/** Resolve a text ref ({ k, d } | { raw } | string) through `L`. */
export function text(ref, L) {
  if (ref === null || ref === undefined) return "";
  if (typeof ref === "string") return ref;
  if ("raw" in ref) return String(ref.raw ?? "");
  return L(ref.k, ref.d);
}

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined && txt !== null) e.textContent = txt;
  return e;
}

function icon(cls) {
  const i = el("i", cls);
  i.setAttribute("aria-hidden", "true");
  return i;
}

function button(act, cls, glyph, title) {
  const b = el("button", `trk-btn ${cls}`);
  b.type = "button";
  b.dataset.trkAct = act;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.tabIndex = -1;          // the row is the tab stop; its keys reach these
  b.append(icon(glyph));
  return b;
}

/* --------------------------------- pieces --------------------------------- */

/** A segmented clock face. Slices are separated by the panel's own ink. */
export function makePie(n, size) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 40 40");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", "trk-pie");
  svg.setAttribute("aria-hidden", "true");
  const segs = [];
  const r = 18, c = 20;
  for (let i = 0; i < n; i++) {
    const p = document.createElementNS(SVG, n === 1 ? "circle" : "path");
    if (n === 1) {
      p.setAttribute("cx", "20"); p.setAttribute("cy", "20"); p.setAttribute("r", String(r));
    } else {
      const a0 = (i / n) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2;
      const x0 = c + r * Math.cos(a0), y0 = c + r * Math.sin(a0);
      const x1 = c + r * Math.cos(a1), y1 = c + r * Math.sin(a1);
      const large = a1 - a0 > Math.PI ? 1 : 0;
      p.setAttribute("d", `M${c} ${c}L${x0.toFixed(3)} ${y0.toFixed(3)}A${r} ${r} 0 ${large} 1 ${x1.toFixed(3)} ${y1.toFixed(3)}Z`);
    }
    p.setAttribute("class", "trk-seg");
    svg.appendChild(p);
    segs.push(p);
  }
  return { svg, segs };
}

/** Per-digit reels: each digit is a strip of 0–9 moved into place. */
function setReel(host, value) {
  const s = String(value);
  const layout = s.replace(/\d/g, "#");
  const digits = s.replace(/\D/g, "");
  if (host._layout !== layout) {
    host.replaceChildren();
    host._strips = [];
    let d = 0;
    for (const ch of s) {
      if (ch >= "0" && ch <= "9") {
        const reel = el("span", "trk-reel");
        const strip = el("span", "trk-strip");
        for (let n = 0; n <= 9; n++) strip.appendChild(el("span", null, String(n)));
        // Placed before the reel joins the DOM, so its first value never rolls.
        strip.style.transform = `translateY(-${Number(digits[d++]) * 10}%)`;
        reel.appendChild(strip);
        host.appendChild(reel);
        host._strips.push(strip);
      } else {
        host.appendChild(el("span", "trk-sign", ch === "-" ? "−" : ch));
      }
    }
    host._layout = layout;
    host.setAttribute("aria-label", s);
    return false;
  }
  host._strips.forEach((strip, i) => { strip.style.transform = `translateY(-${Number(digits[i]) * 10}%)`; });
  host.setAttribute("aria-label", s);
  return true;
}

/** Replay a one-shot without a forced layout: flip between twin keyframes. */
function flash(node, attr = "flash") {
  node.dataset[attr] = node.dataset[attr] === "a" ? "b" : "a";
}

/* ---------------------------------- list ---------------------------------- */

export class TrackerList {
  /**
   * @param {HTMLElement} host  An element this list owns outright.
   * @param {object} o
   * @param {(k:string,d?:object)=>string} o.L
   * @param {(a:{act:string,id:string,ev:Event,row:HTMLElement})=>void} [o.onAction]
   * @param {"dock"|"sheet"|"sample"} [o.variant]
   */
  constructor(host, { L, onAction = null, variant = "dock" } = {}) {
    this.host = host;
    this.L = L ?? ((k) => k);
    this.onAction = onAction;
    this.variant = variant;
    this.rows = new Map();     // id -> { el, view, parts }
    this.compact = false;
    host.classList.add("trk-list");
    if (onAction) this.#wire();
  }

  /** Draw `view` (./view.js listView). `animate: false` for a first paint. */
  update(view, { animate = true } = {}) {
    const want = view.rows;
    this.compact = !!view.compact;
    const next = new Map();
    let prev = null;
    for (const r of want) {
      let rec = this.rows.get(r.id);
      let fresh = false;
      if (rec && rec.view.sig !== r.sig) { rec.el.remove(); rec = null; }
      if (!rec) { rec = this.#build(r); fresh = true; }
      else this.#patch(rec, r, animate);
      const slot = prev ? prev.nextSibling : this.host.firstChild;
      if (rec.el !== slot) this.host.insertBefore(rec.el, slot);
      if (fresh && animate && this.rows.size) flash(rec.el, "enter");
      prev = rec.el;
      next.set(r.id, rec);
    }
    for (const [id, rec] of this.rows) if (!next.has(id)) rec.el.remove();
    this.rows = next;
  }

  /** The element for a tracker id (drag-reorder, menus). */
  rowEl(id) { return this.rows.get(id)?.el ?? null; }

  destroy() {
    this._off?.();
    this.host.replaceChildren();
    this.rows.clear();
  }

  /* -------------------------------- build -------------------------------- */

  #build(r) {
    const L = this.L;
    const row = el("div", "trk-row");
    row.dataset.id = r.id;
    row.dataset.type = r.type;
    const parts = { row };

    if (r.type === "separator") {
      row.classList.add("trk-sep");
      parts.name = el("span", "trk-sep-label");
      row.append(el("i", "trk-sep-line"), parts.name, el("i", "trk-sep-line"));
      if (r.menu && this.variant !== "sample") {
        if (this.variant === "dock") row.prepend(this.#grip());
        row.append(el("span", "trk-tools", null));
        row.lastChild.append(button("menu", "trk-btn-more", "fa-solid fa-ellipsis", L("GLCT.tracker.ctx.more")));
      }
      const rec = { el: row, view: r, parts };
      this.#paint(rec, r);
      return rec;
    }

    if (r.prominent) row.classList.add("is-prominent");
    if (r.menu && this.variant === "dock") row.append(this.#grip());

    // the dial (a clock's face) sits in its own column across both lines
    if (r.meter?.kind === "pie") {
      const size = r.prominent ? 40 : 26;
      const dial = el("div", "trk-dial");
      const { svg, segs } = makePie(r.meter.n, size);
      dial.append(svg);
      if (r.canStep) dial.dataset.trkAct = "value";
      row.append(dial);
      parts.segs = segs;
    }

    const main = el("div", "trk-main");
    const nameLine = el("div", "trk-name");
    parts.eye = icon("fa-solid fa-eye-slash trk-eye");
    parts.eye.title = L("GLCT.tracker.ctx.hiddenMark");
    parts.name = el("span", "trk-name-text");
    nameLine.append(parts.eye, parts.name);
    main.append(nameLine);
    // the second line: the state tag ("Filled", "Doom"…) and the subtitle
    const subline = el("div", "trk-subline");
    parts.subline = subline;
    parts.tag = el("span", "trk-tag");
    parts.tag.setAttribute("aria-live", "polite");
    subline.append(parts.tag);
    if (r.sub) { parts.sub = el("span", "trk-sub"); subline.append(parts.sub); }
    main.append(subline);
    row.append(main);

    // the value: a rolling number and its cap
    const val = el("div", "trk-val");
    parts.reel = el("span", "trk-num");
    parts.cap = el("span", "trk-cap");
    val.append(parts.reel, parts.cap);
    if (r.type === "pool" ? r.rollable : r.canStep) val.dataset.trkAct = "value";
    parts.val = val;

    const side = el("div", "trk-side");
    if (r.type === "pool" && r.rollable && this.variant !== "sample") {
      parts.roll = button("roll", "trk-btn-roll", "fa-solid fa-dice", L("GLCT.tracker.roll"));
      side.append(parts.roll);
    }
    side.append(val);
    row.append(side);

    if (r.menu && this.variant !== "sample") {
      const tools = el("div", "trk-tools");
      if (r.type === "pool") tools.append(button("reset", "trk-btn-reset", "fa-solid fa-rotate-left", L("GLCT.tracker.ctx.refill")));
      else {
        tools.append(button("dec", "trk-btn-dec", "fa-solid fa-minus", L("GLCT.tracker.ctx.dec")));
        tools.append(button("inc", "trk-btn-inc", "fa-solid fa-plus", L("GLCT.tracker.ctx.inc")));
      }
      tools.append(button("menu", "trk-btn-more", "fa-solid fa-ellipsis", L("GLCT.tracker.ctx.more")));
      row.append(tools);
    }

    // the meter line (cells, pips, bar) spans the row under the name
    if (r.meter && r.meter.kind !== "pie") {
      const meter = el("div", `trk-meter trk-meter-${r.meter.kind}`);
      meter.setAttribute("aria-hidden", "true");
      if (r.meter.kind === "bar") {
        parts.bar = el("i", "trk-bar-fill");
        meter.append(parts.bar);
      } else {
        parts.cells = [];
        for (let i = 0; i < r.meter.n; i++) {
          const c = el("i", r.meter.kind === "cells" ? "trk-cell" : "trk-pip");
          meter.append(c);
          parts.cells.push(c);
        }
      }
      row.append(meter);
      parts.meter = meter;
    }

    row.append(el("i", "trk-sweep"));
    if (r.canStep || r.canRoll || r.menu) row.tabIndex = 0;

    const rec = { el: row, view: r, parts };
    this.#paint(rec, r);
    return rec;
  }

  #grip() {
    const g = el("span", "trk-grip");
    g.dataset.trkAct = "grip";
    g.setAttribute("aria-hidden", "true");
    return g;
  }

  /* -------------------------------- paint -------------------------------- */

  /** Paint every field of a freshly built row (no motion). */
  #paint(rec, r) {
    const { parts } = rec;
    const L = this.L;
    this.#classes(rec, r);
    if (r.type === "separator") {
      const label = String(r.name ?? "").trim();
      parts.name.textContent = label;
      parts.name.hidden = !label;
      return;
    }
    parts.name.textContent = r.name || L(`GLCT.tracker.types.${r.type}`);
    rec.el.title = parts.name.textContent;
    if (parts.sub) parts.sub.textContent = text(r.sub, L);
    setReel(parts.reel, r.value ?? 0);
    parts.cap.textContent = r.cap ?? "";
    this.#meter(rec, r, null);
    this.#tag(rec, r, false);
    if (parts.roll) parts.roll.disabled = !r.canRoll;
  }

  /** Patch a kept row to a new view, animating what moved. */
  #patch(rec, r, animate) {
    const before = rec.view;
    const { parts } = rec;
    rec.view = r;
    this.#classes(rec, r);
    if (r.type === "separator") {
      const label = String(r.name ?? "").trim();
      parts.name.textContent = label;
      parts.name.hidden = !label;
      return;
    }
    parts.name.textContent = r.name || this.L(`GLCT.tracker.types.${r.type}`);
    rec.el.title = parts.name.textContent;
    if (parts.sub) parts.sub.textContent = text(r.sub, this.L);
    parts.cap.textContent = r.cap ?? "";
    if (parts.roll) parts.roll.disabled = !r.canRoll;

    const moved = before.value !== r.value;
    const rolled = setReel(parts.reel, r.value ?? 0);
    this.#meter(rec, r, animate && moved ? before : null);
    this.#tag(rec, r, animate && before.tag !== r.tag);
    if (!animate || !moved) return;

    rec.el.dataset.dir = r.value > before.value ? "up" : "down";
    flash(rec.el);
    if (!rolled) flash(parts.reel, "pop");
    this.#delta(rec, before.value, r.value);
  }

  #classes(rec, r) {
    const row = rec.el;
    row.classList.toggle("is-hidden", !!r.hidden);
    row.dataset.tone = r.tone;
    row.classList.toggle("can-step", !!r.canStep);
    row.classList.toggle("is-tagged", !!r.tag);
    if (rec.parts.eye) rec.parts.eye.hidden = !r.hidden;
  }

  #meter(rec, r, from) {
    const { parts } = rec;
    const filled = r.meter?.filled ?? 0;
    if (parts.segs) {
      parts.segs.forEach((s, i) => {
        const on = i < filled;
        s.classList.toggle("is-on", on);
        if (from && on && i >= (from.meter?.filled ?? 0)) flash(s, "pop");
      });
    }
    if (parts.cells) {
      parts.cells.forEach((c, i) => {
        const on = i < filled;
        c.classList.toggle("is-on", on);
        c.classList.toggle("is-head", on && i === filled - 1 && filled < parts.cells.length);
        if (from && on && i >= (from.meter?.filled ?? 0)) flash(c, "pop");
      });
    }
    if (parts.bar) parts.bar.style.transform = `scaleX(${r.meter.fill})`;
  }

  #tag(rec, r, animate) {
    const tag = rec.parts.tag;
    tag.textContent = r.tag ? this.L(TAGS[r.tag]) : "";
    tag.dataset.tag = r.tag ?? "";
    tag.hidden = !r.tag;
    if (rec.parts.subline) rec.parts.subline.hidden = !r.tag && !(rec.parts.sub?.textContent);
    if (animate && r.tag) flash(tag, "pop");
  }

  /** A "+1" chip that rises off the value and fades (one at a time). */
  #delta(rec, from, to) {
    const t = deltaText(from, to);
    if (!t) return;
    rec.parts.delta?.remove();
    const chip = el("span", "trk-delta", t);
    chip.dataset.dir = to > from ? "up" : "down";
    chip.setAttribute("aria-hidden", "true");
    chip.addEventListener("animationend", () => chip.remove(), { once: true });
    rec.parts.val.append(chip);
    rec.parts.delta = chip;
  }

  /* ------------------------------- gestures ------------------------------- */

  #wire() {
    const host = this.host;
    const fire = (act, ev) => {
      const row = ev.target.closest?.(".trk-row");
      if (!row || !host.contains(row)) return false;
      this.onAction({ act, id: row.dataset.id, ev, row });
      return true;
    };
    const rowOf = (ev) => this.rows.get(ev.target.closest?.(".trk-row")?.dataset.id ?? "");

    const onClick = (ev) => {
      const hit = ev.target.closest?.("[data-trk-act]");
      if (!hit || !host.contains(hit)) return;
      const rec = rowOf(ev);
      if (!rec) return;
      let act = hit.dataset.trkAct;
      if (act === "grip") return;
      if (act === "value") act = rec.view.type === "pool" ? "roll" : "inc";
      if (act === "roll" && !rec.view.canRoll) return;
      ev.preventDefault();
      ev.stopPropagation();
      fire(act, ev);
    };
    const onContext = (ev) => {
      const rec = rowOf(ev);
      if (!rec) return;
      ev.preventDefault();
      ev.stopPropagation();
      const onValue = ev.target.closest?.("[data-trk-act='value']");
      // The value keeps its old shortcut: right-click steps it down (a pool's
      // refills). Anywhere else opens the menu for whoever may manage the row.
      if (onValue && rec.view.canStep) fire(rec.view.type === "pool" ? "reset" : "dec", ev);
      else if (rec.view.menu) fire("menu", ev);
    };
    const onKey = (ev) => {
      const row = ev.target.closest?.(".trk-row");
      if (!row || ev.target !== row) return;
      const rec = this.rows.get(row.dataset.id);
      if (!rec) return;
      const v = rec.view;
      const key = ev.key;
      let act = null;
      if ((key === "ArrowUp" || key === "ArrowRight" || key === "+" || key === "=") && v.canStep && v.type !== "pool") act = "inc";
      else if ((key === "ArrowDown" || key === "ArrowLeft" || key === "-") && v.canStep && v.type !== "pool") act = "dec";
      else if ((key === "Enter" || key === " ") && v.type === "pool" && v.canRoll) act = "roll";
      else if ((key === "Enter" || key === " ") && v.canStep && v.type !== "pool") act = "inc";
      else if ((key === "ContextMenu" || (key === "F10" && ev.shiftKey)) && v.menu) act = "menu";
      if (!act) return;
      ev.preventDefault();
      this.onAction({ act, id: row.dataset.id, ev, row });
    };
    const onDown = (ev) => {
      const grip = ev.target.closest?.("[data-trk-act='grip']");
      if (!grip || ev.button !== 0) return;
      fire("grip", ev);
    };
    host.addEventListener("click", onClick);
    host.addEventListener("contextmenu", onContext);
    host.addEventListener("keydown", onKey);
    host.addEventListener("pointerdown", onDown);
    this._off = () => {
      host.removeEventListener("click", onClick);
      host.removeEventListener("contextmenu", onContext);
      host.removeEventListener("keydown", onKey);
      host.removeEventListener("pointerdown", onDown);
    };
  }
}

/* --------------------------------- menu ---------------------------------- */

/**
 * A small context menu at a viewport point, inside `root` (which must sit
 * outside anything that clips). Items: { icon, label, run, danger } or
 * { sep: true }. Returns a close function; Escape and an outside press close it.
 */
export function openMenu(root, x, y, items) {
  const menu = el("div", "trk-menu");
  menu.setAttribute("role", "menu");
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    off();
    menu.remove();
  };
  for (const it of items) {
    if (it.sep) { menu.append(el("div", "trk-menu-sep")); continue; }
    const b = el("button", `trk-menu-item${it.danger ? " is-danger" : ""}`);
    b.type = "button";
    b.setAttribute("role", "menuitem");
    b.append(icon(it.icon), el("span", null, it.label));
    b.addEventListener("click", (e) => { e.stopPropagation(); close(); it.run(); });
    menu.append(b);
  }
  menu.style.visibility = "hidden";
  root.append(menu);
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const vw = root.ownerDocument.defaultView;
  menu.style.left = `${Math.round(Math.max(6, Math.min(x, vw.innerWidth - w - 6)))}px`;
  menu.style.top = `${Math.round(Math.max(6, Math.min(y, vw.innerHeight - h - 6)))}px`;
  menu.style.visibility = "";
  menu.querySelector("button")?.focus({ preventScroll: true });

  const onDown = (e) => { if (!menu.contains(e.target)) close(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const btns = [...menu.querySelectorAll("button")];
    const i = btns.indexOf(root.ownerDocument.activeElement);
    btns[(i + (e.key === "ArrowDown" ? 1 : btns.length - 1)) % btns.length]?.focus();
  };
  // Armed on the next turn, so the press that opened the menu cannot close it.
  const timer = setTimeout(() => {
    if (closed) return;
    vw.addEventListener("pointerdown", onDown, true);
    vw.addEventListener("contextmenu", onDown, true);
    vw.addEventListener("keydown", onKey, true);
  }, 0);
  const off = () => {
    clearTimeout(timer);
    vw.removeEventListener("pointerdown", onDown, true);
    vw.removeEventListener("contextmenu", onDown, true);
    vw.removeEventListener("keydown", onKey, true);
  };
  return close;
}

/* --------------------------------- shells --------------------------------- */

/** The dock's frame: head, rows host, empty state. Rows are TrackerList's. */
export function dockShellHTML({ canWrite = false, compact = false } = {}, L) {
  const t = (k) => esc(L(k));
  const btn = (action, glyph, title, extra = "") =>
    `<button type="button" class="trk-icon${extra}" data-action="${action}" title="${t(title)}" aria-label="${t(title)}">`
    + `<i class="fa-solid ${glyph}" aria-hidden="true"></i></button>`;
  return `<div class="glct-trk-root">`
    + `<section class="trk-dock${compact ? " is-compact" : ""}" data-dock aria-label="${t("GLCT.tracker.title")}">`
    + `<header class="trk-head" data-drag>`
    + `<span class="trk-head-mark" aria-hidden="true"></span>`
    + `<span class="trk-head-title">${t("GLCT.tracker.title")}</span>`
    + `<span class="trk-head-count" data-count></span>`
    + (canWrite
      ? `<span class="trk-head-hidden" data-hidden title="${t("GLCT.tracker.hiddenCount")}" hidden>`
        + `<i class="fa-solid fa-eye-slash" aria-hidden="true"></i><b></b></span>`
      : "")
    + btn("toggleCompact", compact ? "fa-up-right-and-down-left-from-center" : "fa-down-left-and-up-right-to-center",
      compact ? "GLCT.tracker.expand" : "GLCT.tracker.compact")
    + (canWrite ? btn("addTracker", "fa-plus", "GLCT.tracker.add", " trk-add") : "")
    + `</header>`
    + `<div class="trk-body" data-rows></div>`
    + (canWrite
      ? `<button type="button" class="trk-empty" data-empty data-action="addTracker">`
        + `<i class="fa-solid fa-plus" aria-hidden="true"></i><span>${t("GLCT.tracker.emptyHint")}</span></button>`
      : "")
    + `</section></div>`;
}

/** The PF2e sheet tab's panel. */
export function sheetShellHTML({ canWrite = false } = {}, L) {
  const t = (k) => esc(L(k));
  return `<div class="glct-trk-root">`
    + `<section class="trk-dock trk-sheet">`
    + `<header class="trk-head">`
    + `<span class="trk-head-mark" aria-hidden="true"></span>`
    + `<span class="trk-head-title">${t("GLCT.tracker.sheetTitle")}</span>`
    + `<span class="trk-head-count" data-count></span>`
    + (canWrite
      ? `<button type="button" class="trk-icon trk-add" data-add title="${t("GLCT.tracker.add")}" aria-label="${t("GLCT.tracker.add")}">`
        + `<i class="fa-solid fa-plus" aria-hidden="true"></i></button>`
      : "")
    + `</header>`
    + `<div class="trk-body" data-rows></div>`
    + `<div class="trk-empty is-static" data-empty><span>${t(canWrite ? "GLCT.tracker.sheetEmpty" : "GLCT.tracker.sheetEmptyRead")}</span></div>`
    + `</section></div>`;
}

/** Fill a shell's head from a list view (count, hidden count, empty state). */
export function paintShell(root, view) {
  const count = root.querySelector("[data-count]");
  if (count) count.textContent = view.count ? String(view.count) : "";
  const hidden = root.querySelector("[data-hidden]");
  if (hidden) {
    hidden.hidden = !view.hiddenCount;
    hidden.querySelector("b").textContent = String(view.hiddenCount);
  }
  const empty = root.querySelector("[data-empty]");
  if (empty) empty.hidden = !view.empty;
  root.querySelector("[data-dock]")?.classList.toggle("is-compact", !!view.compact);
}

/* ------------------------------- chat card ------------------------------- */

/**
 * The pool roll's chat card, as an HTML string (./view.js poolCardView).
 * Chat content is stored, so this markup outlives the code: the classes are
 * `glct-trk-card*` and never renamed.
 */
export function poolCardHTML(card, L) {
  const dice = card.faces
    .map((f) => `<span class="glct-trk-card-die${f.drop ? " is-drop" : ""}">${esc(f.v)}</span>`)
    .join("");
  const tally = card.empty
    ? `<span class="glct-trk-card-out">${esc(L("GLCT.tracker.poolEmpty"))}</span>`
    : `<span class="glct-trk-card-keep">${esc(L("GLCT.tracker.kept", { n: card.kept }))}</span>`
      + `<span class="glct-trk-card-gone">${esc(L("GLCT.tracker.discarded", { n: card.gone }))}</span>`;
  return `<div class="glct-trk-skin glct-trk-card${card.empty ? " is-empty" : ""}">`
    + `<div class="glct-trk-card-head">`
    + `<span class="glct-trk-card-mark" aria-hidden="true"></span>`
    + `<span class="glct-trk-card-name">${esc(card.name || L("GLCT.tracker.types.pool"))}</span>`
    + `<span class="glct-trk-card-count"><b>${esc(card.after)}</b><i>/${esc(card.before)}</i></span>`
    + `</div>`
    + `<div class="glct-trk-card-meta">${esc(L("GLCT.tracker.types.pool"))} · d${esc(card.size)} · ${esc(L("GLCT.tracker.dropLE", { n: card.discard }))}</div>`
    + `<div class="glct-trk-card-dice">${dice}</div>`
    + `<div class="glct-trk-card-tally">${tally}</div>`
    + `</div>`;
}
