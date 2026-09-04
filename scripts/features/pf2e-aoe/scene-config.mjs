/** Scene-wide native-presentation opt-out. */

import { SUITE_ID } from "../../core/const.mjs";
import { FLAGS } from "./constants.mjs";

export function injectScenePresentation(app, element) {
  if (!game.user?.isGM) return;
  const scene = app?.document ?? app?.object;
  const root = element instanceof HTMLElement ? element : element?.[0];
  const form = root?.matches?.("form") ? root : root?.querySelector?.("form");
  if (!form || scene?.documentName !== "Scene" || form.querySelector("[data-gl-aoe-scene-native]")) return;
  const group = document.createElement("div"); group.className = "form-group"; group.dataset.glAoeSceneNative = "1";
  const label = document.createElement("label"); label.textContent = game.i18n.localize("GLAOE.Scene.Native");
  const fields = document.createElement("div"); fields.className = "form-fields";
  const toggle = document.createElement("input"); toggle.type = "checkbox";
  toggle.name = `flags.${SUITE_ID}.${FLAGS.sceneNative}`;
  try { toggle.checked = Boolean(scene.getFlag(SUITE_ID, FLAGS.sceneNative)); } catch { toggle.checked = false; }
  fields.append(toggle); group.append(label, fields);
  const hint = document.createElement("p"); hint.className = "hint"; hint.textContent = game.i18n.localize("GLAOE.Scene.NativeHint"); group.append(hint);
  const footer = form.querySelector("footer.form-footer, .form-footer"); if (footer) footer.before(group); else form.append(group);
}

export function sceneUsesNativePresentation() {
  try { return Boolean(canvas?.scene?.getFlag?.(SUITE_ID, FLAGS.sceneNative)); } catch { return false; }
}
