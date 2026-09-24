/**
 * GLUniverse Suite — Performance feature adapter.
 *
 * Makes Foundry and the suite cheaper to run, per client, without writing a
 * single core setting. See docs/PERFORMANCE.md. The moving parts:
 *
 *   core/budget.mjs  the shared frame clock every shedding feature reads —
 *                    works with this feature off, this feature sets its policy
 *   tiers.mjs        the tier table and how a client's tier is resolved
 *   governor.mjs     Auto: steps a tier down on stutter, up on headroom
 *   runtime.mjs      resolution, the policy push, the work bracket
 *   patches.mjs      the core-patch registry (version-gated, integrity-checked)
 *   overlay.mjs      the per-client measurement overlay
 *   report.mjs       snapshots, the 30 s benchmark, GM report pulls
 *   floor-app.mjs    the GM's floor sheet
 *   audit-app.mjs    the GM's texture audit (rules in audit-rules.mjs)
 *   canvas.mjs       performance mode, resolution, sight throttle, idle rate,
 *                    texture loading
 *   ui.mjs           render merging, directory batching, chat trimming
 *   ambient.mjs      glass level, ambient loops held while panning, zoom blur
 */

import { Suite } from "../../core/registry.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { FEATURE_ID, MENUS, PATCHES, SETTINGS, TARGETS, patchClientKey, patchWorldKey } from "./constants.mjs";
import { AUTO, DEFAULT_TIER, TIERS } from "./tiers.mjs";
import { Perf } from "./runtime.mjs";
import { Patches } from "./patches.mjs";
import { Overlay } from "./overlay.mjs";
import { wireSocket } from "./report.mjs";
import { FloorApp } from "./floor-app.mjs";
import { AuditApp } from "./audit-app.mjs";
// canvas.mjs and ui.mjs define their core patches on import; installAll()
// (onInit) is what actually wraps anything.
import { initCanvasTuning, startCanvasTuning } from "./canvas.mjs";
import { startUiTuning } from "./ui.mjs";
import { startAmbient } from "./ambient.mjs";

const reresolve = () => {
  if (Suite.enabled(FEATURE_ID) && Perf.state) Perf.resolve("settings");
};

const onPatchSwitch = (id) => () => {
  if (!Suite.enabled(FEATURE_ID) || !Perf.state) return;
  Patches.refresh(id);
  Perf.resolve(`patch:${id}`);
};

Suite.register({
  id: FEATURE_ID,
  title: "GLPERF.title",
  hint: "GLPERF.hint",
  icon: "fa-solid fa-gauge-high",
  settingPrefix: "perf.",
  system: null,
  requires: [],
  core: false,
  // On by default, and harmless by default: the default tier is Balanced,
  // which is defined as "no visible change". See tiers.mjs.
  defaultEnabled: true,

  registerSettings() {
    game.settings.register(SUITE_ID, SETTINGS.tier, {
      name: "GLPERF.setting.tier.name",
      hint: "GLPERF.setting.tier.hint",
      scope: "client",
      config: true,
      type: String,
      choices: Object.fromEntries([AUTO, ...TIERS].map((id) => [id, `GLPERF.tier.${id}`])),
      default: DEFAULT_TIER,
      onChange: reresolve,
    });

    game.settings.register(SUITE_ID, SETTINGS.targetFps, {
      name: "GLPERF.setting.targetFps.name",
      hint: "GLPERF.setting.targetFps.hint",
      scope: "client",
      config: true,
      type: String,
      choices: Object.fromEntries(TARGETS.map((id) => [id, `GLPERF.target.${id}`])),
      default: "display",
      onChange: reresolve,
    });

    game.settings.register(SUITE_ID, SETTINGS.overlay, {
      name: "GLPERF.setting.overlay.name",
      hint: "GLPERF.setting.overlay.hint",
      scope: "client",
      config: true,
      type: Boolean,
      default: false,
      onChange: () => {
        if (Suite.enabled(FEATURE_ID)) Overlay.sync();
      },
    });

    game.settings.register(SUITE_ID, SETTINGS.preload, {
      name: "GLPERF.setting.preload.name",
      hint: "GLPERF.setting.preload.hint",
      scope: "world",
      config: true,
      type: Boolean,
      default: false,
    });

    game.settings.register(SUITE_ID, SETTINGS.floor, {
      scope: "world",
      config: false,
      type: Object,
      default: { max: TIERS[0], users: {} },
      onChange: reresolve,
    });

    for (const { id } of PATCHES) {
      game.settings.register(SUITE_ID, patchWorldKey(id), {
        name: `GLPERF.patch.${id}.name`,
        hint: `GLPERF.patch.${id}.hint`,
        scope: "world",
        config: true,
        type: Boolean,
        default: true,
        onChange: onPatchSwitch(id),
      });
      game.settings.register(SUITE_ID, patchClientKey(id), {
        name: `GLPERF.patch.${id}.clientName`,
        hint: "GLPERF.patchClientHint",
        scope: "client",
        config: true,
        type: Boolean,
        default: true,
        onChange: onPatchSwitch(id),
      });
    }

    game.settings.registerMenu(SUITE_ID, MENUS.floor, {
      name: "GLPERF.floor.menuName",
      label: "GLPERF.floor.menuLabel",
      hint: "GLPERF.floor.menuHint",
      icon: "fa-solid fa-gauge-high",
      type: FloorApp(),
      restricted: true,
    });

    game.settings.registerMenu(SUITE_ID, MENUS.audit, {
      name: "GLPERF.audit.menuName",
      label: "GLPERF.audit.menuLabel",
      hint: "GLPERF.audit.menuHint",
      icon: "fa-solid fa-images",
      type: AuditApp(),
      restricted: true,
    });
  },

  onInit() {
    Patches.configure({ isOn: (id) => Perf.patchOn(id) });
    // Wraps go on at init: the canvas is configured during setup, before ready.
    Patches.installAll();
    initCanvasTuning();
  },

  async onReady() {
    wireSocket();
    await Perf.start();
    startCanvasTuning();
    startUiTuning();
    startAmbient();
    Overlay.sync();
  },

  api: {
    get state() {
      return Perf.state;
    },
    resolve: () => Perf.resolve("api"),
    patches: () => Patches.status(),
  },
});
