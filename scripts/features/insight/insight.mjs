// insight.mjs — Insight feature entry point (ported into GLUniverse Suite)
import { registerSettings } from "./module/settings.mjs";
import { registerSocket } from "./module/socket.mjs";
import { InsightComposeDialog } from "./module/compose-dialog.mjs";

const COMPOSE_DIALOG_ID = "insight-compose-dialog";

export { registerSettings };

/** Everything that used to run in the `init` hook. */
export function onInit() {
  console.log("Insight | Initializing module");

  // Add scene control button (GM only)
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user.isGM) return;

    const tokenControls = controls.tokens;
    if (!tokenControls) return;

    tokenControls.tools.insight = {
      name: "insight",
      title: "INSIGHT.SceneControl",
      icon: "fas fa-eye",
      order: Object.keys(tokenControls.tools).length,
      button: true,
      visible: true,
      onChange: () => openComposeDialog(),
    };
  });

  // A `button` scene-control tool is meant to resolve on click via `onChange`, but
  // that dispatch is unreliable across v13/v14 builds: `onChange` only fires when the
  // active tool *changes*, so the button can stick as the active tool and then repeat
  // clicks fire no change event — the GM clicks Insight and nothing happens. Bind the
  // click on the rendered button directly so the dialog opens on every click.
  // openComposeDialog() reuses the open instance, so this never stacks duplicate
  // windows even if the native onChange also fires.
  Hooks.on("renderSceneControls", (_app, html) => {
    if (!game.user.isGM) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const button = root?.querySelector('[data-tool="insight"]');
    if (!button || button.dataset.insightBound) return;
    button.dataset.insightBound = "true";
    button.addEventListener("click", () => openComposeDialog());
  });
}

/** Everything that used to run in the `ready` hook (+ socket wiring). */
export function onReady() {
  registerSocket();
  console.log("Insight | Module ready");
}

/** Open the compose dialog, reusing the open instance instead of stacking a new one. */
function openComposeDialog() {
  const existing = foundry.applications.instances.get(COMPOSE_DIALOG_ID);
  if (existing) existing.render({ force: true });
  else new InsightComposeDialog().render({ force: true });
}
