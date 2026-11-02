/**
 * Diorama view — the HUD: toolbar, "Not set up" chip, floating labels and the
 * token menu. Etched Glass (`.gl-glass`, `.gl-btn`), sized by this feature
 * (`.gl-btn` declares no font-size), every string through i18n and every name
 * set as text, never markup.
 */

import { el, t } from "./util.mjs";

/** Toolbar buttons, in order. `gm` = GM only; `toggle` = shows a pressed state. */
export const TOOLBAR = Object.freeze([
  { act: "yawLeft", icon: "fa-solid fa-rotate-left", key: "GLDIO.view.yawLeft" },
  { act: "yawRight", icon: "fa-solid fa-rotate-right", key: "GLDIO.view.yawRight" },
  { act: "pitch", icon: "fa-solid fa-mountain-sun", key: "GLDIO.view.pitch" },
  { act: "zoomIn", icon: "fa-solid fa-magnifying-glass-plus", key: "GLDIO.view.zoomIn" },
  { act: "zoomOut", icon: "fa-solid fa-magnifying-glass-minus", key: "GLDIO.view.zoomOut" },
  { sep: true },
  { act: "grid", icon: "fa-solid fa-border-all", key: "GLDIO.view.grid", toggle: true },
  { act: "tiltShift", icon: "fa-solid fa-camera-retro", key: "GLDIO.view.tiltShift", toggle: true },
  { act: "cutaway", icon: "fa-solid fa-scissors", key: "GLDIO.view.cutaway", toggle: true },
  { act: "follow", icon: "fa-solid fa-crosshairs", key: "GLDIO.view.follow", toggle: true },
  { act: "graphics", icon: "fa-solid fa-sliders", key: "GLDIO.view.graphics" },
  { sep: true, gm: true },
  { act: "environment", icon: "fa-solid fa-cloud-sun-rain", key: "GLDIO.view.environment", gm: true },
  { act: "summon", icon: "fa-solid fa-users-viewfinder", key: "GLDIO.view.summon", gm: true },
  { act: "asPlayers", icon: "fa-solid fa-eye", key: "GLDIO.view.asPlayers", gm: true, toggle: true },
  { sep: true },
  { act: "close", icon: "fa-solid fa-xmark", key: "GLDIO.view.close" },
]);

/** Tones a label badge may take: each is a suite token (`--gl-<tone>`). */
export const CHIP_TONES = Object.freeze(["info", "good", "warn", "hazard", "peril"]);

export class Hud {
  /**
   * @param {HTMLElement} root
   * @param {{isGM:boolean, actions:Record<string, () => void>}} o
   */
  constructor(root, { isGM, actions }) {
    this.root = root;
    this.actions = actions;
    this.buttons = new Map();

    const bar = el("div", { class: "gldio-toolbar gl-glass", role: "toolbar", "aria-label": t("GLDIO.view.toolbar") });
    for (const b of TOOLBAR) {
      if (b.gm && !isGM) continue;
      if (b.sep) { bar.append(el("span", { class: "gldio-sep", "aria-hidden": "true" })); continue; }
      const label = t(b.key);
      const btn = el("button", {
        type: "button", class: "gldio-btn gl-btn", title: label, "aria-label": label,
        "aria-pressed": b.toggle ? "false" : null, dataset: { act: b.act },
      }, [el("i", { class: b.icon, "aria-hidden": "true" })]);
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); this.actions[b.act]?.(); });
      this.buttons.set(b.act, btn);
      bar.append(btn);
    }
    this.bar = bar;

    this.chip = el("div", { class: "gldio-chip gl-glass", hidden: true }, [
      el("span", { class: "gldio-chip-text", text: t("GLDIO.view.notSetUp") }),
    ]);
    if (isGM) {
      const auto = el("button", { type: "button", class: "gldio-btn gldio-btn--text gl-btn gl-btn-accent", text: t("GLDIO.view.autoSetup") });
      auto.addEventListener("click", (ev) => { ev.stopPropagation(); this.actions.autoSetup?.(); });
      this.chip.append(auto);
    }

    this.labels = el("div", { class: "gldio-labels", "aria-hidden": "true" });
    this.labelEls = new Map();
    this.menuEl = null;
    this._outside = (ev) => { if (this.menuEl && !this.menuEl.contains(ev.target)) this.closeMenu(); };

    root.append(this.labels, bar, this.chip);
  }

  setPressed(act, on) {
    this.buttons.get(act)?.setAttribute("aria-pressed", on ? "true" : "false");
  }

  setSetup(show) {
    this.chip.hidden = !show;
  }

  /**
   * Show or move a floating label at client px. `lines` are plain text, or a
   * badge `{ text, chip: tone }`: a solid chip in that tone's colour (a cover
   * value, a fall's damage), so the one fact that decides a turn reads first.
   * @param {string} id
   * @param {{x:number, y:number}|null} at
   * @param {Array<string|{text:string, chip:string}>} lines
   * @param {string} [tone]  info | warn | hazard | peril
   */
  label(id, at, lines = [], tone = "info") {
    if (!at || !lines.length || !Number.isFinite(at.x) || !Number.isFinite(at.y)) { this.hideLabel(id); return; }
    let n = this.labelEls.get(id);
    if (!n) {
      n = el("div", { class: "gldio-label gl-glass" });
      this.labelEls.set(id, n);
      this.labels.append(n);
    }
    const key = lines.map((s) => (typeof s === "string" ? s : `${s?.chip}:${s?.text}`)).join("\n");
    if (n.dataset.text !== key) {
      n.dataset.text = key;
      n.replaceChildren(...lines.map((s, k) => {
        if (s && typeof s === "object") {
          const chip = el("span", { class: "gl-chip gl-chip-solid", text: String(s.text ?? ""), style: `--gl-accent: var(--gl-${CHIP_TONES.includes(s.chip) ? s.chip : "info"})` });
          return el("div", { class: "gldio-label-sub" }, [chip]);
        }
        return el("div", { class: k ? "gldio-label-sub" : "gldio-label-main", text: s });
      }));
    }
    n.dataset.tone = tone;
    const r = this.root.getBoundingClientRect();
    n.style.setProperty("--gldio-x", `${Math.round(at.x - r.left)}px`);
    n.style.setProperty("--gldio-y", `${Math.round(at.y - r.top)}px`);
  }

  hideLabel(id) {
    const n = this.labelEls.get(id);
    if (n) { n.remove(); this.labelEls.delete(id); }
  }

  /**
   * A small menu at client px.
   * @param {{x:number, y:number}} at
   * @param {Array<{icon:string, label:string, run:() => void}>} items
   */
  menu(at, items) {
    this.closeMenu();
    if (!items.length) return;
    const m = el("div", { class: "gldio-menu gl-glass", role: "menu" });
    for (const it of items) {
      const b = el("button", { type: "button", class: "gldio-menu-item", role: "menuitem" }, [
        el("i", { class: it.icon, "aria-hidden": "true" }),
        el("span", { text: it.label }),
      ]);
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        this.closeMenu();
        try { it.run(); } catch (e) { console.error(e); }
      });
      m.append(b);
    }
    const r = this.root.getBoundingClientRect();
    m.style.setProperty("--gldio-x", `${Math.round(at.x - r.left)}px`);
    m.style.setProperty("--gldio-y", `${Math.round(at.y - r.top)}px`);
    this.root.append(m);
    this.menuEl = m;
    m.querySelector("button")?.focus({ preventScroll: true });
    setTimeout(() => document.addEventListener("pointerdown", this._outside, true), 0);
  }

  get menuOpen() { return !!this.menuEl; }

  closeMenu() {
    if (!this.menuEl) return false;
    this.menuEl.remove();
    this.menuEl = null;
    document.removeEventListener("pointerdown", this._outside, true);
    return true;
  }

  dispose() {
    this.closeMenu();
    this.labels.remove();
    this.bar.remove();
    this.chip.remove();
    this.labelEls.clear();
  }
}
