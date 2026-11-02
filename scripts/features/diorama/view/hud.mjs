/**
 * Diorama view — the HUD: toolbar, "Not set up" chip, floating labels and the
 * drag-select box (a token's own controls are Foundry's Token HUD,
 * view/token-hud.mjs). Etched Glass (`.gl-glass`, `.gl-btn`), sized by this feature
 * (`.gl-btn` declares no font-size), every string through i18n and every name
 * set as text, never markup.
 */

import { el, keyHint, t } from "./util.mjs";

/**
 * Toolbar buttons, in order. `gm` = GM only; `toggle` = shows a pressed state;
 * `bind` = a keybinding whose current keys are added to the tooltip. The way
 * out is not in this list: it is the labelled "Exit 3D" button under the bar.
 */
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
  { act: "peek", icon: "fa-solid fa-map", key: "GLDIO.view.peek", toggle: true, bind: "dio.peek" },
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
      const keys = b.bind ? keyHint(b.bind) : "";
      const btn = el("button", {
        type: "button", class: "gldio-btn gl-btn", title: keys ? `${label} (${keys})` : label, "aria-label": label,
        "aria-pressed": b.toggle ? "false" : null, dataset: { act: b.act },
      }, [el("i", { class: b.icon, "aria-hidden": "true" })]);
      btn.addEventListener("click", (ev) => { ev.stopPropagation(); this.actions[b.act]?.(); });
      this.buttons.set(b.act, btn);
      bar.append(btn);
    }
    this.bar = bar;

    // The way back to 2D: labelled and in the accent, so nobody has to guess
    // which glyph leaves the view. Its keys are in the tooltip.
    const exitKeys = ["Esc", keyHint("dio.toggle")].filter(Boolean).join(" / ");
    const exit = el("button", {
      type: "button", class: "gldio-exit gldio-door gl-btn gl-btn-accent",
      title: t("GLDIO.view.exitTitle", { keys: exitKeys }), dataset: { act: "close" },
    }, [el("i", { class: "fa-solid fa-arrow-right-from-bracket", "aria-hidden": "true" }), el("span", { text: t("GLDIO.view.exit") })]);
    exit.addEventListener("click", (ev) => { ev.stopPropagation(); this.actions.close?.(); });
    this.buttons.set("close", exit);

    this.chip = el("div", { class: "gldio-chip gl-glass", hidden: true }, [
      el("span", { class: "gldio-chip-text", text: t("GLDIO.view.notSetUp") }),
    ]);
    if (isGM) {
      const auto = el("button", { type: "button", class: "gldio-btn gldio-btn--text gl-btn gl-btn-accent", text: t("GLDIO.view.autoSetup") });
      auto.addEventListener("click", (ev) => { ev.stopPropagation(); this.actions.autoSetup?.(); });
      this.chip.append(auto);
    }

    // One column beside the scene controls: the "Not set up" chip, the bar, the way out.
    this.rail = el("div", { class: "gldio-rail" }, [this.chip, bar, exit]);

    this.labels = el("div", { class: "gldio-labels", "aria-hidden": "true" });
    this.labelEls = new Map();
    this.marqueeEl = null;

    root.append(this.labels, this.rail);
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
   * The drag-select box between two client points, or null to take it away.
   * @param {{x:number, y:number}|null} a
   * @param {{x:number, y:number}} [b]
   */
  marquee(a, b) {
    if (!a || !b) { this.marqueeEl?.remove(); this.marqueeEl = null; return; }
    if (!this.marqueeEl) {
      this.marqueeEl = el("div", { class: "gldio-marquee", "aria-hidden": "true" });
      this.root.append(this.marqueeEl);
    }
    const r = this.root.getBoundingClientRect();
    const s = this.marqueeEl.style;
    s.setProperty("--gldio-x", `${Math.round(Math.min(a.x, b.x) - r.left)}px`);
    s.setProperty("--gldio-y", `${Math.round(Math.min(a.y, b.y) - r.top)}px`);
    s.setProperty("--gldio-w", `${Math.round(Math.abs(b.x - a.x))}px`);
    s.setProperty("--gldio-h", `${Math.round(Math.abs(b.y - a.y))}px`);
  }

  dispose() {
    this.marquee(null);
    this.labels.remove();
    this.rail.remove();
    this.chip.remove();
    this.labelEls.clear();
  }
}
