/**
 * Stage — the DOM half of the overlay: the canvas the renderer draws into and
 * the name card. Pure DOM, no Foundry, so the preview page mounts this exact
 * markup.
 *
 * The name card is the only text the stage ever draws. This table plays by
 * voice, so there are no lines and no dialogue box: a name, and an epithet if
 * the GM gave one, when the camera pushes in (or on whoever has the focus, if
 * the GM asks for that).
 */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/**
 * @param {HTMLElement} parent
 * @returns {{ root: HTMLElement, canvas: HTMLCanvasElement, update(frame): void, destroy(): void }}
 */
export function mountStageDom(parent) {
  const root = document.createElement("div");
  root.className = "glstage-root gl-type";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <canvas class="glstage-canvas"></canvas>
    <div class="glstage-plate" data-mode="close">
      <span class="glstage-plate-rule"></span>
      <span class="glstage-plate-name"></span>
      <span class="glstage-plate-title"></span>
    </div>`;
  parent.append(root);
  const canvas = root.querySelector(".glstage-canvas");
  const plate = root.querySelector(".glstage-plate");
  const nameEl = root.querySelector(".glstage-plate-name");
  const titleEl = root.querySelector(".glstage-plate-title");
  let shown = null;

  return {
    root,
    canvas,
    update(frame) {
      const p = frame?.nameplate;
      root.classList.toggle("is-live", (frame?.figures?.length ?? 0) > 0 || (frame?.close?.amount ?? 0) > 0);
      if (!p || p.amount <= 0.01) {
        if (shown !== null) { plate.style.opacity = "0"; shown = null; }
        return;
      }
      const key = `${p.id}|${p.close}`;
      if (shown !== key) {
        nameEl.innerHTML = esc(p.name);
        titleEl.innerHTML = esc(p.title);
        titleEl.hidden = !p.title;
        plate.dataset.mode = p.close ? "close" : "focus";
        shown = key;
      }
      plate.style.opacity = String(Math.min(1, p.amount));
      plate.style.setProperty("--glstage-plate-in", String(Math.min(1, p.amount)));
      if (!p.close && p.anchor) {
        plate.style.left = `${p.anchor[0]}px`;
      } else {
        plate.style.left = "";
      }
    },
    destroy() { root.remove(); },
  };
}
