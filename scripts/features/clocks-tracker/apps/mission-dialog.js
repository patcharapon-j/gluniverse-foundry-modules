/**
 * GM dialog to start or clear a "mission" — a stretch countdown to a target.
 *
 * The target can be entered either as a number of stretches from now or as an
 * exact calendar date & time; both resolve to an absolute, stretch-snapped world
 * time stored in the `mission` world setting. The HUD meter then adapts to count
 * the remaining stretches (see GlctHud._paint / hud.css .mission).
 */

import { MODULE_ID, SETTINGS } from "../const.js";
import { TimeEngine } from "../engine.js";
import { SECONDS_PER_STRETCH, snapToStretch } from "../time-math.js";

const { DialogV2 } = foundry.applications.api;

export class MissionDialog {
  static async show() {
    if (!game.user.isGM) return;
    const L = k => game.i18n.localize(k);
    const cal = game.time.calendar;
    const c = game.time.components;
    const cur = TimeEngine.mission;
    const months = cal?.months?.values ?? [];
    const monthOpts = months
      .map((m, i) => `<option value="${i}" ${i === c.month ? "selected" : ""}>${m.name}</option>`)
      .join("");

    const dl = cur.kind === "deadline";
    const content = `
      <div class="glct-mission" style="display:flex;flex-direction:column;gap:10px;">
        <p class="glct-trk-pick">${L("GLCT.mission.hint")}</p>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;">
          <label>${L("GLCT.mission.typeLabel")}</label>
          <select name="kind">
            <option value="goal" ${dl ? "" : "selected"}>${L("GLCT.mission.typeGoal")}</option>
            <option value="deadline" ${dl ? "selected" : ""}>${L("GLCT.mission.typeDeadline")}</option>
          </select>
          <label>${L("GLCT.mission.labelField")}</label>
          <input type="text" name="label" value="${cur.label ?? ""}" placeholder="${L("GLCT.mission.labelPlaceholder")}">
          <label>${L("GLCT.mission.modeLabel")}</label>
          <select name="mode">
            <option value="stretches" selected>${L("GLCT.mission.modeStretches")}</option>
            <option value="time">${L("GLCT.mission.modeTime")}</option>
          </select>
        </div>
        <fieldset data-pane="stretches" style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;">
          <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;">
            <label>${L("GLCT.mission.stretches")}</label>
            <input type="number" name="stretches" value="6" min="1" step="1">
          </div>
        </fieldset>
        <fieldset data-pane="time" style="border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 10px;display:none;">
          <div style="display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;">
            <label>Year</label>   <input type="number" name="year"   value="${c.year}">
            <label>Month</label>  <select name="month">${monthOpts}</select>
            <label>Day</label>    <input type="number" name="day"    value="${(c.dayOfMonth ?? 0) + 1}" min="1">
            <label>Hour</label>   <input type="number" name="hour"   value="${c.hour ?? 0}" min="0" max="23">
            <label>Minute</label> <input type="number" name="minute" value="${c.minute ?? 0}" min="0" max="59" step="10">
          </div>
        </fieldset>
      </div>`;

    const setMission = async form => {
      const label = String(form.label?.value ?? "").trim();
      let target;
      if (form.mode.value === "time") {
        target = TimeEngine.componentsToWorldTime({
          year: Number(form.year.value),
          month: Number(form.month.value),
          dayOfMonth: Math.max(0, Number(form.day.value) - 1),
          hour: Number(form.hour.value),
          minute: Number(form.minute.value),
          second: 0
        });
      } else {
        const n = Math.max(1, Math.round(Number(form.stretches.value) || 0));
        target = snapToStretch(TimeEngine.worldTime) + n * SECONDS_PER_STRETCH;
      }
      if (!Number.isFinite(target)) return;
      const kind = form.kind.value === "deadline" ? "deadline" : "goal";
      await game.settings.set(MODULE_ID, SETTINGS.mission, { active: true, target, label, kind });
    };

    const clearMission = () =>
      game.settings.set(MODULE_ID, SETTINGS.mission, { active: false, target: 0, label: "", kind: "goal" });

    try {
      await DialogV2.wait({
        window: { title: L("GLCT.mission.title") },
        classes: ["glct-settime"],
        content,
        // Show only the active mode's input pane.
        render: (event, dialog) => {
          const host = dialog?.element ?? event?.currentTarget;
          const sel = host?.querySelector?.('select[name="mode"]');
          const panes = host?.querySelectorAll?.("fieldset[data-pane]") ?? [];
          const sync = () => panes.forEach(f => { f.style.display = f.dataset.pane === sel.value ? "" : "none"; });
          sel?.addEventListener("change", sync);
          sync();
        },
        buttons: [
          { action: "set", label: L("GLCT.mission.set"), default: true, callback: (e, btn) => setMission(btn.form) },
          { action: "clear", label: L("GLCT.mission.clear"), callback: () => clearMission() },
          { action: "cancel", label: L("GLCT.calendarView.close") }
        ]
      });
    } catch { /* dialog dismissed */ }
  }
}
