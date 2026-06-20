/** GM dialog to set an exact date & time using the active calendar. */

import { TimeEngine } from "../engine.js";

const { DialogV2 } = foundry.applications.api;

export class SetTimeDialog {
  static async show() {
    if (!game.user.isGM) return;
    const cal = game.time.calendar;
    const c = game.time.components;
    const months = cal?.months?.values ?? [];

    const monthOpts = months
      .map((m, i) => `<option value="${i}" ${i === c.month ? "selected" : ""}>${m.name}</option>`)
      .join("");

    const content = `
      <div class="glct-settime" style="display:grid;grid-template-columns:auto 1fr;gap:8px 10px;align-items:center;">
        <label>Year</label>   <input type="number" name="year"  value="${c.year}">
        <label>Month</label>  <select name="month">${monthOpts}</select>
        <label>Day</label>    <input type="number" name="day"   value="${(c.dayOfMonth ?? 0) + 1}" min="1">
        <label>Hour</label>   <input type="number" name="hour"  value="${c.hour ?? 0}" min="0" max="23">
        <label>Minute</label> <input type="number" name="minute" value="${c.minute ?? 0}" min="0" max="59" step="10">
      </div>`;

    try {
    await DialogV2.prompt({
      window: { title: game.i18n.localize("GLCT.controls.setTime") },
      content,
      ok: {
        label: game.i18n.localize("GLCT.editor.save"),
        callback: (event, button) => {
          const form = button.form;
          const data = {
            year: Number(form.year.value),
            month: Number(form.month.value),
            dayOfMonth: Math.max(0, Number(form.day.value) - 1),
            hour: Number(form.hour.value),
            minute: Number(form.minute.value),
            second: 0
          };
          TimeEngine.setExact(data);
        }
      }
    });
    } catch { /* dialog dismissed */ }
  }
}
