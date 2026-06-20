import { registerFateDie } from "./fate-die.mjs";
import { registerDiceSoNice } from "./dsn.mjs";
import { registerFateRendering } from "./fate-result.mjs";
import { patchPF2eCheckMethods, registerPF2eIntegration } from "./pf2e-integration.mjs";
import { applyMotionTier, applyThemeFromSettings, migrateLegacySettings, registerSettings } from "./settings.mjs";

export { registerSettings };

// Everything from the old `init` hook. Foundry hooks are wired here (only when
// the feature is enabled & available); nothing runs at import time.
export function onInit() {
  registerFateDie();
  registerFateRendering();
  registerPF2eIntegration();

  // Dice So Nice integration is optional — only fires if DSN is present.
  Hooks.once("diceSoNiceReady", (dice3d) => {
    registerDiceSoNice(dice3d);
  });
}

// Everything from the old `ready` hook (plus the deferred PF2e Check patch that
// previously rode its own `Hooks.once("ready")`).
export async function onReady() {
  await migrateLegacySettings();
  applyThemeFromSettings();
  applyMotionTier();
  patchPF2eCheckMethods();
}
