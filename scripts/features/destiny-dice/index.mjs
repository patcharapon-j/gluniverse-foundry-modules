import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { onInit, onReady, registerSettings } from "./main.mjs";

const OLD_ID = "gluniverse-destiny-dice";

// Old (unprefixed) standalone setting keys → new suite keys (prefixed "dd.").
const LEGACY_SETTINGS = {
  preset: "dd.preset",
  emissiveIntensity: "dd.emissiveIntensity",
  motionTier: "dd.motionTier",
};
for (const face of [1, 2, 3, 4, 5, 6]) {
  LEGACY_SETTINGS[`face${face}Kind`] = `dd.face${face}Kind`;
  LEGACY_SETTINGS[`face${face}Bonus`] = `dd.face${face}Bonus`;
  LEGACY_SETTINGS[`face${face}Image`] = `dd.face${face}Image`;
}

Suite.register({
  id: "destiny-dice",
  title: "GLS.feature.destiny-dice.title",
  hint: "GLS.feature.destiny-dice.hint",
  icon: "fa-solid fa-dice-d6",
  settingPrefix: "dd.",
  system: "pf2e",
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    registerSettings();
  },

  onInit() {
    onInit();
  },

  async onReady() {
    await onReady();
  },

  legacy: {
    id: OLD_ID,
    settings: LEGACY_SETTINGS,
    // Move the standalone module's fate flag on existing chat messages from
    // scope "gluniverse-destiny-dice" (key "fate") to scope "gluniverse-foundry-modules"
    // (key "dd.fate"). Best-effort and guarded — never blocks startup.
    migrate: async () => {
      try {
        for (const message of game.messages ?? []) {
          const old = message?.flags?.[OLD_ID]?.fate;
          if (!old) continue;
          if (message.getFlag?.(SUITE_ID, "dd.fate")) continue;
          await message.setFlag(SUITE_ID, "dd.fate", old);
          await message.unsetFlag?.(OLD_ID, "fate");
        }
      } catch (e) {
        console.warn("GLUniverse Suite | destiny-dice flag migration skipped:", e);
      }
    },
  },

  api: null,
});
