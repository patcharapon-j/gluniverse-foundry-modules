/**
 * GLUniverse Suite — single entry point.
 *
 * Imports the core framework and every feature adapter (each self-registers
 * with the Suite registry on import), then drives the shared lifecycle:
 *
 *   init  → register all settings (so every toggle/menu exists), then run
 *           onInit for enabled+available features.
 *   ready → wire the shared socket channel, run one-time migrations, then run
 *           onReady for enabled+available features. Finally expose the API.
 */

import { SUITE_ID, SUITE_TITLE, log } from "./core/const.mjs";
import { Suite, Features } from "./core/registry.mjs";
import { registerCoreSettings } from "./core/settings.mjs";
import { initSocketDispatcher } from "./core/socket.mjs";
import { runMigrations } from "./core/migration.mjs";

// Side-effecting import: every feature calls Suite.register(...) on load.
import "./features/index.mjs";

Hooks.once("init", async () => {
  registerCoreSettings();
  Suite.registerAllSettings();
  await Suite.runPhase("onInit");
  log(`Initialised — ${Suite.all().filter((f) => Suite.enabled(f.id)).length}/${Suite.all().length} features active.`);
});

Hooks.once("ready", async () => {
  initSocketDispatcher();
  await runMigrations();
  await Suite.runPhase("onReady");

  const mod = game.modules.get(SUITE_ID);
  if (mod) {
    mod.api = {
      Suite,
      Features,
      features: Object.fromEntries(
        Suite.all().map((f) => [f.id, f.api ?? null])
      ),
    };
  }
});
