/**
 * GLUniverse Suite — Timer feature: GM control panel.
 *
 * The create / exact-set surface (the live ±adjust + pause controls live on the
 * HUD strip instead). Opened from the suite scene-control button when idle, or
 * from the HUD's "edit" button while a timer runs.
 */

import { featurePath } from "../../core/const.mjs";
import { FEATURE_ID, getState, remainingOf, TimerCtrl } from "./state.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TimerPanel extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "gltimer-panel",
    classes: ["gltimer-panel"],
    window: { title: "GLTIMER.panel.title", icon: "fa-solid fa-stopwatch" },
    position: { width: 340, height: "auto" },
    actions: {
      preset: TimerPanel._onPreset,
      start: TimerPanel._onStart,
      clear: TimerPanel._onClear,
    },
  };

  static PARTS = {
    main: { template: featurePath(FEATURE_ID, "templates/panel.hbs") },
  };

  static PRESETS = [
    { m: 1, s: 0, label: "1:00" },
    { m: 3, s: 0, label: "3:00" },
    { m: 5, s: 0, label: "5:00" },
    { m: 10, s: 0, label: "10:00" },
  ];

  /**
   * Open the panel, reusing the already-open instance instead of toggling or
   * stacking a second one. A single scene-control click can reach the opener
   * through BOTH the tool's `onChange` and the bound DOM click listener; keeping
   * this idempotent (open / bring-to-front, never close) is what stops the window
   * from flashing open then instantly shutting again. Mirrors the suite's
   * `insight` compose-dialog convention.
   */
  static open() {
    const existing = foundry.applications.instances.get("gltimer-panel");
    if (existing) { existing.render({ force: true }); return existing; }
    const panel = new TimerPanel();
    panel.render({ force: true });
    return panel;
  }

  async _prepareContext() {
    const s = getState();
    const totalSec = Math.round(remainingOf(s) / 1000);
    return {
      active: s.active,
      curM: s.active ? Math.floor(totalSec / 60) : 5,
      curS: s.active ? totalSec % 60 : 0,
      presets: TimerPanel.PRESETS,
    };
  }

  _readDurationMs() {
    const root = this.element;
    const m = Math.max(0, parseInt(root.querySelector('[name="min"]')?.value, 10) || 0);
    const s = Math.max(0, Math.min(59, parseInt(root.querySelector('[name="sec"]')?.value, 10) || 0));
    return (m * 60 + s) * 1000;
  }

  static _onPreset(event, target) {
    const m = Number(target.dataset.m) || 0;
    const s = Number(target.dataset.s) || 0;
    const root = this.element;
    const mi = root.querySelector('[name="min"]');
    const si = root.querySelector('[name="sec"]');
    if (mi) mi.value = m;
    if (si) si.value = s;
  }

  static async _onStart(event) {
    event?.preventDefault?.();
    const ms = this._readDurationMs();
    if (ms <= 0) {
      ui.notifications?.warn(game.i18n.localize("GLTIMER.warn.zero"));
      return;
    }
    await TimerCtrl.start(ms);
    this.close();
  }

  static async _onClear() {
    await TimerCtrl.clear();
    this.close();
  }
}
