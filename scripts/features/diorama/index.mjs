/**
 * GLUniverse Suite — Diorama feature adapter.
 *
 * The battle map as a painted 3D diorama: height-painted ground, Foundry walls
 * and doors as 3D walls, tokens as paper standees. Height is mechanical: it
 * occludes sight and light (on the 2D canvas too), moves tokens up and down,
 * stops walking at cliffs and shows cover. See docs/DIORAMA.md.
 *
 * Nothing here runs at import: every hook, keybinding and backend is wired from
 * onInit / onReady in main.mjs, so a disabled feature is inert.
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { FEATURE_ID, PREFIX, SETTINGS, WALL_MATERIALS } from "./constants.mjs";
import { OPTIONS } from "./options.mjs";
import { onInit, onReady, api } from "./main.mjs";

Suite.register({
  id: FEATURE_ID,
  title: "GLDIO.title",
  hint: "GLDIO.hint",
  icon: "fa-solid fa-cubes",
  settingPrefix: PREFIX,
  system: null,
  minimumGeneration: 14,
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    game.settings.register(SUITE_ID, SETTINGS.rules, {
      name: "GLDIO.settings.rules.name",
      hint: "GLDIO.settings.rules.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: true,
      requiresReload: true,
    });
    game.settings.register(SUITE_ID, SETTINGS.stepHeight, {
      name: "GLDIO.settings.stepHeight.name",
      hint: "GLDIO.settings.stepHeight.hint",
      scope: "world",
      config: true,
      type: Number,
      default: 2.5,
    });
    game.settings.register(SUITE_ID, SETTINGS.wallHeight, {
      name: "GLDIO.settings.wallHeight.name",
      hint: "GLDIO.settings.wallHeight.hint",
      scope: "world",
      config: true,
      type: Number,
      default: 10,
    });
    game.settings.register(SUITE_ID, SETTINGS.wallMaterial, {
      name: "GLDIO.settings.wallMaterial.name",
      hint: "GLDIO.settings.wallMaterial.hint",
      scope: "world",
      config: true,
      type: String,
      choices: Object.fromEntries(WALL_MATERIALS.map((k) => [k, `GLDIO.material.wall.${k}`])),
      default: "stone",
    });
    game.settings.register(SUITE_ID, SETTINGS.cutout, {
      name: "GLDIO.settings.cutout.name",
      hint: "GLDIO.settings.cutout.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
    });
    game.settings.register(SUITE_ID, SETTINGS.tiltShift, {
      name: "GLDIO.settings.tiltShift.name",
      hint: "GLDIO.settings.tiltShift.hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: false,
    });
    game.settings.register(SUITE_ID, SETTINGS.yawSnap, {
      name: "GLDIO.settings.yawSnap.name",
      hint: "GLDIO.settings.yawSnap.hint",
      scope: "world",
      config: true,
      type: Number,
      choices: { 90: "GLDIO.settings.yawSnap.90", 45: "GLDIO.settings.yawSnap.45" },
      default: 90,
    });
    game.settings.register(SUITE_ID, SETTINGS.grid, {
      name: "GLDIO.settings.grid.name",
      hint: "GLDIO.settings.grid.hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: true,
    });
    game.settings.register(SUITE_ID, SETTINGS.effects, {
      name: "GLDIO.settings.effects.name",
      hint: "GLDIO.settings.effects.hint",
      scope: "client",
      config: true,
      type: String,
      choices: { halo: "GLDIO.settings.effects.halo", plate: "GLDIO.settings.effects.plate" },
      default: "halo",
    });
    game.settings.register(SUITE_ID, SETTINGS.invite, {
      name: "GLDIO.settings.invite.name",
      hint: "GLDIO.settings.invite.hint",
      scope: "client",
      config: true,
      type: String,
      choices: {
        ask: "GLDIO.settings.invite.ask",
        auto: "GLDIO.settings.invite.auto",
        never: "GLDIO.settings.invite.never",
      },
      default: "ask",
    });
    game.settings.register(SUITE_ID, SETTINGS.follow, {
      name: "GLDIO.settings.follow.name",
      hint: "GLDIO.settings.follow.hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: false,
    });
    game.settings.register(SUITE_ID, SETTINGS.effectOrient, {
      scope: "world",
      config: false,
      type: Object,
      default: {},
    });
    // Graphics (per user) and the table's environment and prop rules (GM): options.mjs.
    for (const o of OPTIONS) {
      const label = (v) => `GLDIO.settings.${o.name}.${v}`;
      game.settings.register(SUITE_ID, o.key, {
        name: `GLDIO.settings.${o.name}.name`,
        hint: `GLDIO.settings.${o.name}.hint`,
        scope: o.scope,
        config: true,
        type: o.type === "boolean" ? Boolean : o.type === "number" ? Number : String,
        ...(o.choices ? { choices: Object.fromEntries(o.choices.map((v) => [v, label(v)])) } : {}),
        ...(o.range ? { range: { ...o.range } } : {}),
        default: o.default,
      });
    }
  },

  onInit,
  onReady,
  api,
});
