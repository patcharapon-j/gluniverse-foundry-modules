import { Suite } from "../../core/registry.mjs";
import { featureRegisterSettings, onInit, onReady } from "./module.js";

Suite.register({
  id: "critical",
  title: "GLS.feature.critical.title",
  hint: "GLS.feature.critical.hint",
  icon: "fa-solid fa-bolt",
  system: ["pf2e", "dnd5e"],
  requires: [],
  core: false,
  defaultEnabled: false,

  registerSettings() {
    featureRegisterSettings();
  },

  onInit() {
    onInit();
  },

  async onReady() {
    await onReady();
  },

  legacy: {
    id: "gluniverse-critical",
    settings: {
      gmAvatar: "crit.gmAvatar",
      pcCriticalSfx: "crit.pcCriticalSfx",
      gmCriticalSfx: "crit.gmCriticalSfx",
      cinematicDuration: "crit.cinematicDuration",
      triggerMode: "crit.triggerMode",
      enableSkillCrits: "crit.enableSkillCrits",
      enablePerceptionCrits: "crit.enablePerceptionCrits",
      allowPlayerOptOut: "crit.allowPlayerOptOut",
      showCinematics: "crit.showCinematics",
      audioEnabled: "crit.audioEnabled",
      volume: "crit.volume",
    },
    // Move actor cinematic flags from the old scope to the suite scope.
    migrate: async () => {
      const OLD = "gluniverse-critical";
      const NEW = "gluniverse-suite";
      const map = {
        schemaVersion: "crit.schemaVersion",
        enabled: "crit.enabled",
        portraitOverride: "crit.portraitOverride",
      };
      const actors = game.actors?.contents ?? [];
      for (const actor of actors) {
        const old = actor.flags?.[OLD];
        if (!old) continue;
        for (const [oldKey, newKey] of Object.entries(map)) {
          const v = old[oldKey];
          if (v === undefined) continue;
          try {
            if (actor.getFlag(NEW, newKey) === undefined) {
              await actor.setFlag(NEW, newKey, v);
            }
          } catch (e) {
            console.warn(`gluniverse-suite | critical | actor flag migration failed for ${actor.id}:`, e);
          }
        }
      }
    },
  },

  api: null,
});
