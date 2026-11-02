/**
 * Diorama editor — the Auto setup options a GM sets before a run.
 *
 *   loadAutoOptions()               the last options used on this browser (sanitised)
 *   promptAutoOptions({ units })    ask, remember and return them; null when cancelled
 *   describeAuto(stats, options, t) the sentence the "done" notification ends with
 *
 * The dialog is a DialogV2 reached only inside promptAutoOptions, so nothing
 * here touches `foundry` at import and the check imports it under Node. The
 * options themselves (their shape, defaults and sanitising) belong to
 * auto-setup.mjs; this file only asks for them. They are remembered in
 * localStorage: a per-browser preference, not world data.
 */

import { SUITE_ID } from "../../../core/const.mjs";
import { LIGHT_DIRS, FACE_SIDES, LEVEL_STEPS, autoOptions } from "./auto-setup.mjs";

const STORE = `${SUITE_ID}.dio.autoSetup`;
const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** The last options used here, or the defaults. */
export function loadAutoOptions() {
  try {
    const raw = globalThis.localStorage?.getItem(STORE);
    return autoOptions(raw ? JSON.parse(raw) : {});
  } catch {
    return autoOptions({});
  }
}

/** Remember options for the next run (and for Auto setup on opening an unset scene). */
export function saveAutoOptions(o) {
  try { globalThis.localStorage?.setItem(STORE, JSON.stringify(autoOptions(o))); } catch { /* private mode */ }
}

/** The form's fields → options. `f` is a form's `elements` (or anything shaped like it). */
export function readAutoForm(f) {
  return autoOptions({
    heights: !!f.heights?.checked,
    light: f.light?.value,
    faces: f.faces?.value,
    heightScale: Number(f.heightScale?.value),
    step: Number(f.step?.value),
  });
}

/**
 * The dialog body. Pure given `t` (a localize function), so the check can
 * render it under Node and match its names against readAutoForm.
 */
export function autoDialogContent(opt, { units = "ft", t = L } = {}) {
  const o = autoOptions(opt);
  const u = esc(units || "ft");
  const options = (list, value, label) => list.map((v) => `<option value="${esc(v)}"${v === value ? " selected" : ""}>${esc(label(v))}</option>`).join("");
  const steps = LEVEL_STEPS.includes(o.step) ? LEVEL_STEPS : [...LEVEL_STEPS, o.step].sort((a, b) => a - b);
  const row = (name, label, control, hint) => `
    <div class="gldio-auto-row">
      <label class="gldio-auto-label" for="gldio-auto-${name}">${esc(t(label))}</label>
      ${control}
      <p class="gldio-auto-hint">${esc(t(hint))}</p>
    </div>`;
  return `
    <p class="gldio-dialog-text">${esc(t("GLDIO.editor.auto.intro"))}</p>
    <div class="gldio-auto">
      <label class="gldio-auto-check">
        <input type="checkbox" name="heights" id="gldio-auto-heights"${o.heights ? " checked" : ""}>
        <span>${esc(t("GLDIO.editor.auto.heights"))}</span>
      </label>
      <p class="gldio-auto-hint">${esc(t("GLDIO.editor.auto.heightsHint"))}</p>
      <fieldset class="gldio-auto-set" data-heights${o.heights ? "" : " disabled"}>
        ${row("light", "GLDIO.editor.auto.light",
          `<select name="light" id="gldio-auto-light">${options(LIGHT_DIRS, o.light, (v) => t(`GLDIO.editor.auto.dir.${v}`))}</select>`,
          "GLDIO.editor.auto.lightHint")}
        ${row("faces", "GLDIO.editor.auto.faces",
          `<select name="faces" id="gldio-auto-faces">${options(FACE_SIDES, o.faces, (v) => t(`GLDIO.editor.auto.face.${v}`))}</select>`,
          "GLDIO.editor.auto.facesHint")}
        ${row("heightScale", "GLDIO.editor.auto.scale",
          `<input type="number" name="heightScale" id="gldio-auto-heightScale" min="0.25" max="4" step="0.25" value="${o.heightScale}">`,
          "GLDIO.editor.auto.scaleHint")}
        ${row("step", "GLDIO.editor.auto.step",
          `<select name="step" id="gldio-auto-step">${options(steps, o.step, (v) => `${v} ${u}`)}</select>`,
          "GLDIO.editor.auto.stepHint")}
      </fieldset>
    </div>`;
}

/**
 * Ask for the options. Resolves to them (remembered for next time), or null
 * when the GM cancels or closes the dialog.
 * @param {{units?: string}} [o]  the scene's distance units, for the step labels
 */
export async function promptAutoOptions({ units = "ft" } = {}) {
  const { DialogV2 } = foundry.applications.api;
  const res = await DialogV2.wait({
    window: { title: L("GLDIO.editor.auto.title"), icon: "fa-solid fa-wand-sparkles" },
    classes: ["gldio-app", "gldio-dialog", "gldio-auto-dialog"],
    position: { width: 460 },
    content: autoDialogContent(loadAutoOptions(), { units }),
    buttons: [
      {
        action: "run", label: L("GLDIO.editor.auto.run"), icon: "fa-solid fa-wand-sparkles", default: true,
        class: "gl-btn gl-btn-accent gldio-auto-btn",
        callback: (_ev, button) => readAutoForm(button.form.elements),
      },
      { action: "cancel", label: L("GLDIO.editor.auto.cancel"), icon: "fa-solid fa-xmark", class: "gl-btn gldio-auto-btn", callback: () => null },
    ],
    render: (_ev, dialog) => {
      const form = dialog.element.querySelector("form");
      const set = form?.querySelector("[data-heights]");
      form?.elements.heights?.addEventListener("change", (e) => { if (set) set.disabled = !e.target.checked; });
    },
    rejectClose: false,
  }).catch(() => null);
  if (!res || typeof res !== "object") return null;
  saveAutoOptions(res);
  return res;
}

/** How the heights were read, for the "done" notification. */
export function describeAuto(stats, options, t = L) {
  const o = autoOptions(options);
  if (!o.heights || !stats?.sampled) return t("GLDIO.editor.auto.how.off");
  const parts = [stats.light
    ? t("GLDIO.editor.auto.how.light", { dir: t(`GLDIO.editor.auto.dir.${stats.light}`) })
    : t("GLDIO.editor.auto.how.noLight")];
  if (o.faces !== "none") parts.push(t("GLDIO.editor.auto.how.faces", { side: t(`GLDIO.editor.auto.face.${o.faces}`) }));
  return parts.join("; ");
}
