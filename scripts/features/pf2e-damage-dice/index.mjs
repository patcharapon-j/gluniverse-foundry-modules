/**
 * GLUniverse Suite — PF2e Damage Dice.
 *
 * Overrides the 3D dice of every PF2e damage roll so the dice look like the
 * damage: colour, texture, bump map, shader material and emission map chosen by
 * damage type, with the numerals set in the suite's bundled dice face.
 *
 * Requires Dice So Nice — without it there are no 3D dice to override, so the
 * feature stays inert rather than doing half a job.
 *
 * Layout:
 *   damage-types.mjs   the table: one entry per PF2e damage type
 *   dsn.mjs            registers textures / colorsets / systems with DSN
 *   apply.mjs          routes a rolled die to its damage type
 *   settings.mjs       the four client preferences
 */

import { Suite } from "../../core/registry.mjs";
import { warn } from "../../core/const.mjs";
import { DAMAGE_TYPES, DAMAGE_TYPE_IDS } from "./damage-types.mjs";
import { describeRegistration, registerDiceSoNice, registerFontDefinition } from "./dsn.mjs";
import { activate, applyDamageAppearance, deactivate } from "./apply.mjs";
import { registerSettings } from "./settings.mjs";

Suite.register({
  id: "pf2e-damage-dice",
  title: "GLDMG.feature.title",
  hint: "GLDMG.feature.hint",
  icon: "fa-solid fa-dice-d20",
  settingPrefix: "dmg.",
  system: "pf2e",
  requires: ["dice-so-nice"],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    registerSettings();
  },

  onInit() {
    // Must land before Dice So Nice asks Foundry whether the face exists.
    registerFontDefinition();
  },

  onReady() {
    activate();

    // `diceSoNiceReady` has already fired if DSN initialised first, so take
    // whichever of the two paths is still open.
    if (game.dice3d) {
      registerDiceSoNice(game.dice3d).catch((e) =>
        warn("pf2e-damage-dice | Dice So Nice registration failed:", e)
      );
    } else {
      Hooks.once("diceSoNiceReady", (dice3d) => {
        registerDiceSoNice(dice3d).catch((e) =>
          warn("pf2e-damage-dice | Dice So Nice registration failed:", e)
        );
      });
    }
  },

  api: {
    /** The damage types this feature covers. */
    types: DAMAGE_TYPE_IDS,
    /** The full table, for anyone who wants to match a UI to the dice. */
    table: DAMAGE_TYPES,
    /** What actually got registered with Dice So Nice on this client. */
    describe: describeRegistration,
    /** Paint a roll by hand — useful from a macro, and for smoke tests. */
    apply: applyDamageAppearance,
    /** Stop overriding without disabling the whole feature. */
    stop: deactivate,
    /** Resume after `stop()`. */
    start: activate,
  },
});
