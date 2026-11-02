/**
 * Diorama — the "3D view" chip on the 2D board: the way in, labelled, where a
 * player looks at the map rather than in the scene-control column.
 *
 * Light on purpose (no three.js, no overlay): main.mjs builds it at ready and
 * gates it. It sits beside the scene controls at the height the 3D toolbar
 * uses, right after #board at the board's layer, so Foundry's whole interface
 * (and the token HUD, palettes and windows) stays in front of it. Hidden while
 * the view is open and on the stream capture in stream mode (diorama.css).
 */

import { el, keyHint, t } from "./util.mjs";

export class EntryChip {
  /** @param {{onOpen: () => void}} o */
  constructor({ onOpen }) {
    this.onOpen = onOpen;
    this.node = null;
  }

  _build() {
    if (this.node) return;
    const b = el("button", { type: "button", class: "gldio-entry gldio-door gl-btn gl-btn-accent", hidden: true }, [
      el("i", { class: "fa-solid fa-cubes", "aria-hidden": "true" }),
      el("span", { text: t("GLDIO.entry.label") }),
    ]);
    b.addEventListener("click", (ev) => { ev.stopPropagation(); this.onOpen?.(); });
    b.addEventListener("contextmenu", (ev) => ev.preventDefault());
    (document.getElementById("board") ?? document.body).after(b);
    this.node = b;
  }

  /** Show or hide it. Built on the first show; the tooltip reads the keys afresh each time. */
  set(show) {
    if (!show) { if (this.node) this.node.hidden = true; return; }
    this._build();
    const keys = keyHint("dio.toggle");
    this.node.title = keys ? t("GLDIO.entry.title", { keys }) : t("GLDIO.entry.label");
    this.place();
    this.node.hidden = false;
  }

  /** Beside Foundry's scene controls, whatever their width (the 3D toolbar does the same). */
  place() {
    if (!this.node) return;
    const sc = document.getElementById("scene-controls") ?? document.getElementById("ui-left-column-1");
    const right = sc?.getBoundingClientRect?.().right;
    this.node.style.setProperty("--gldio-left", `${Math.round(Number.isFinite(right) && right > 0 ? right : 88)}px`);
  }

  dispose() {
    this.node?.remove();
    this.node = null;
  }
}
