/**
 * Diorama view — the HUD: the floating labels and the drag-select box. The
 * view's tools are Foundry's own scene-control tools (VIEW_TOOLS below), and a
 * token's own controls are Foundry's Token HUD (view/token-hud.mjs). Etched Glass (`.gl-glass`, `.gl-btn`), sized by this feature
 * (`.gl-btn` declares no font-size), every string through i18n and every name
 * set as text, never markup.
 */

import { el } from "./util.mjs";

/**
 * The view's tools, in order. The view does not draw them: while it is open
 * they join Foundry's Token Controls in the left panel, under the "3D view"
 * toggle that opened it (main.mjs), so nothing of the view's is pinned on the
 * board. `gm` = GM only; `toggle` = a pressed state the view reports
 * (`viewToolState` in overlay.mjs); `bind` = a keybinding whose current keys
 * join the title. Zoom (the wheel) and tilt-shift (the Graphics panel) live
 * elsewhere.
 */
export const VIEW_TOOLS = Object.freeze([
  { act: "yawLeft", icon: "fa-solid fa-rotate-left", key: "GLDIO.view.yawLeft" },
  { act: "yawRight", icon: "fa-solid fa-rotate-right", key: "GLDIO.view.yawRight" },
  { act: "pitch", icon: "fa-solid fa-mountain-sun", key: "GLDIO.view.pitch" },
  { act: "cutaway", icon: "fa-solid fa-scissors", key: "GLDIO.view.cutaway", toggle: true },
  { act: "grid", icon: "fa-solid fa-border-all", key: "GLDIO.view.grid", toggle: true },
  { act: "follow", icon: "fa-solid fa-crosshairs", key: "GLDIO.view.follow", toggle: true },
  { act: "peek", icon: "fa-solid fa-map", key: "GLDIO.view.peek", toggle: true, bind: "dio.peek" },
  { act: "graphics", icon: "fa-solid fa-sliders", key: "GLDIO.view.graphics" },
  { act: "asPlayers", icon: "fa-solid fa-eye", key: "GLDIO.view.asPlayers", gm: true, toggle: true },
  { act: "roofs", icon: "fa-solid fa-house", key: "GLDIO.view.roofs", gm: true, toggle: true, bind: "dio.roofs" },
  { act: "summon", icon: "fa-solid fa-users-viewfinder", key: "GLDIO.view.summon", gm: true },
  { act: "environment", icon: "fa-solid fa-cloud-sun-rain", key: "GLDIO.view.environment", gm: true },
  { act: "editTerrain", icon: "fa-solid fa-mountain", key: "GLDIO.controls.edit", gm: true },
]);

/** Tones a label badge may take: each is a suite token (`--gl-<tone>`). */
export const CHIP_TONES = Object.freeze(["info", "good", "warn", "hazard", "peril"]);

export class Hud {
  /** @param {HTMLElement} root */
  constructor(root) {
    this.root = root;
    this.labels = el("div", { class: "gldio-labels", "aria-hidden": "true" });
    this.labelEls = new Map();
    this.marqueeEl = null;

    root.append(this.labels);
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
    this.labelEls.clear();
  }
}
