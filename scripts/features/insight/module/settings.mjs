// module/settings.mjs — Module settings registration

import { SUITE_ID } from "../../../core/const.mjs";

export function registerSettings() {

  game.settings.register(SUITE_ID, "insight.theme", {
    name: "INSIGHT.SettingTheme",
    hint: "INSIGHT.SettingThemeHint",
    scope: "world",
    config: true,
    type: String,
    default: "dreadlight",
    choices: {
      dreadlight: "INSIGHT.ThemeDreadlight",
      fantasy: "INSIGHT.ThemeFantasy",
    },
  });

  game.settings.register(SUITE_ID, "insight.soundEnabled", {
    name: "INSIGHT.SettingSoundEnabled",
    hint: "INSIGHT.SettingSoundEnabledHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(SUITE_ID, "insight.soundVolume", {
    name: "INSIGHT.SettingSoundVolume",
    hint: "INSIGHT.SettingSoundVolumeHint",
    scope: "client",
    config: true,
    type: Number,
    default: 0.5,
    range: { min: 0, max: 1, step: 0.1 },
  });

  game.settings.register(SUITE_ID, "insight.soundFile", {
    name: "INSIGHT.SettingSoundFile",
    hint: "INSIGHT.SettingSoundFileHint",
    scope: "world",
    config: true,
    type: String,
    default: "",
    filePicker: "audio",
  });

  game.settings.register(SUITE_ID, "insight.animationSpeed", {
    name: "INSIGHT.SettingAnimationSpeed",
    hint: "INSIGHT.SettingAnimationSpeedHint",
    scope: "client",
    config: true,
    type: String,
    default: "normal",
    choices: {
      normal: "INSIGHT.AnimationNormal",
      fast: "INSIGHT.AnimationFast",
      instant: "INSIGHT.AnimationInstant",
    },
  });

  console.log("Insight | Settings registered");
}
