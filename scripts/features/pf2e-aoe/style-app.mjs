/** PF2e AoE — GM world-default palette editor. */

import { SUITE_ID } from "../../core/const.mjs";
import { ARCHETYPES, SETTINGS } from "./constants.mjs";
import { DEFAULT_STYLE_COLORS, normalizeColor, styleDefaults } from "./data.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const TEMPLATE = `modules/${SUITE_ID}/templates/pf2e-aoe/style-defaults.hbs`;

export class AoeStyleDefaultsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gl-aoe-style-defaults",
    tag: "form",
    classes: ["gls-scope", "gl-aoe-style-app", "gl-type"],
    window: {
      title: "GLAOE.StyleDefaults.Title",
      icon: "fa-solid fa-wand-magic-sparkles",
      contentClasses: ["standard-form"],
      resizable: true,
    },
    position: { width: 620, height: "auto" },
    form: { handler: AoeStyleDefaultsApp.#submit, closeOnSubmit: true },
    actions: { reset: AoeStyleDefaultsApp.#reset },
  };

  static PARTS = { form: { template: TEMPLATE } };

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const colors = styleDefaults();
    return Object.assign(context, {
      intro: game.i18n.localize("GLAOE.StyleDefaults.Intro"),
      rows: ARCHETYPES.map((id) => ({
        id,
        label: game.i18n.localize(`GLAOE.Archetype.${id}`),
        color: colors[id],
        defaultColor: DEFAULT_STYLE_COLORS[id],
      })),
      reset: game.i18n.localize("GLAOE.StyleDefaults.Reset"),
      save: game.i18n.localize("GLAOE.StyleDefaults.Save"),
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const input of this.element.querySelectorAll('input[type="color"]')) {
      input.addEventListener("input", () => {
        const row = input.closest(".gl-aoe-style-row");
        row?.style.setProperty("--gl-aoe-row-color", input.value);
        const code = row?.querySelector("code");
        if (code) code.textContent = input.value;
      });
    }
  }

  static async #submit(_event, _form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const colors = Object.fromEntries(ARCHETYPES.map((id) => [
      id,
      normalizeColor(expanded.colors?.[id], DEFAULT_STYLE_COLORS[id]),
    ]));
    await game.settings.set(SUITE_ID, SETTINGS.styleDefaults, colors);
    ui.notifications?.info(game.i18n.localize("GLAOE.StyleDefaults.Saved"));
  }

  static async #reset() {
    await game.settings.set(SUITE_ID, SETTINGS.styleDefaults, { ...DEFAULT_STYLE_COLORS });
    this.render({ force: true });
  }
}
