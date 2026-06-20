import { registerFateDie } from "./fate-die.mjs";
import { registerDiceSoNice } from "./dsn.mjs";
import { registerFateRendering } from "./fate-result.mjs";
import { registerPF2eIntegration } from "./pf2e-integration.mjs";
import { applyMotionTier, applyThemeFromSettings, migrateLegacySettings, registerSettings } from "./settings.mjs";

Hooks.once("init", () => {
  registerSettings();
  registerFateDie();
  registerFateRendering();
  registerPF2eIntegration();
});

Hooks.once("ready", async () => {
  await migrateLegacySettings();
  applyThemeFromSettings();
  applyMotionTier();
});

Hooks.once("diceSoNiceReady", (dice3d) => {
  registerDiceSoNice(dice3d);
});
