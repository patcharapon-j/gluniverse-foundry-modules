import { registerFateDie } from "./fate-die.mjs";
import { registerDiceSoNice } from "./dsn.mjs";
import { registerFateRendering } from "./fate-result.mjs";
import { registerPF2eIntegration } from "./pf2e-integration.mjs";
import { migrateLegacySettings, registerSettings } from "./settings.mjs";

export { registerSettings };

/* Wired only when the feature is enabled and available; nothing at import. */
export function onInit() {
  registerFateDie();
  registerFateRendering();
  registerPF2eIntegration();
  // Optional: the fate is the same without it, the die just is not 3D.
  Hooks.once("diceSoNiceReady", (dice3d) => registerDiceSoNice(dice3d));
}

export async function onReady() {
  await migrateLegacySettings();
}
