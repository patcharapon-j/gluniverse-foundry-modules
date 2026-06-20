/**
 * DelvingEditor — the visual editor for Delving Mode (a Settings-menu app modeled
 * on the Weather / Support editors). Configures:
 *   • the turn definition (unit × count + label) and the weather-every-N-turns cadence;
 *   • full CRUD on delving RESOURCES and their ordered STAGES (each a dice pool
 *     {size, count, discard} + an effect look {archetype, intensity, two tints,
 *     drift, ominous}), with a live Pixi preview of the focused stage;
 *   • which resource is "featured" (drives the HUD), per-resource player visibility;
 *   • preset load (Torches / Corruption) + JSON import/export.
 *
 * Edits run on an in-memory working copy of the whole config; Save writes it back
 * via DelvingStore, preserving the live delve counters.
 */

import {
  MODULE_ID, DELVING_UNITS, WEATHER_ARCHETYPES, WEATHER_DRIFTS,
  DELVING_TURN_COUNT_RANGE, DELVING_STAGE_RANGE
} from "../const.js";
import { DelvingStore } from "../delving/delving-store.js";
import { DELVING_PRESETS, STAGE_LOOKS, STAGE_LOOK_LIST, makeResource, makeStage } from "../delving/presets.js";
import { WeatherEffect } from "../weather/effects.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

export class DelvingEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async show() {
    if (!game.user.isGM) return;
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  static DEFAULT_OPTIONS = {
    id: "glct-delving-editor",
    classes: ["glct", "glct-delveditor-app"],
    tag: "form",
    window: { title: "GLCT.delving.editor.title", icon: "fa-solid fa-dungeon", resizable: true },
    position: { width: 740, height: "auto" },
    actions: {
      loadPreset: DelvingEditor.prototype._onLoadPreset,
      importJson: DelvingEditor.prototype._onImport,
      exportJson: DelvingEditor.prototype._onExport,
      addResource: DelvingEditor.prototype._onAddResource,
      saveDelving: DelvingEditor.prototype._onSave
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/delving-editor.hbs` } };

  _working = null;     // working copy of the whole delving config
  _preview = null;     // Pixi preview of the focused stage

  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!this._working) this._working = foundry.utils.deepClone(DelvingStore.data);

    this._fillSelect("[data-turnunit]", DELVING_UNITS.map(u => [u, game.i18n.localize(`GLCT.delving.unit.${u}`)]));
    this._fillSelect("[data-presetsel]", Object.entries(DELVING_PRESETS).map(([id, build]) => [id, build().name]));

    const el = this.element;
    const t = this._working.turn ?? {};
    el.querySelector("[data-turnunit]").value = DELVING_UNITS.includes(t.unit) ? t.unit : "stretch";
    el.querySelector("[data-turncount]").value = t.count ?? 1;
    el.querySelector("[data-turnlabel]").value = t.label ?? "Turn";
    el.querySelector("[data-weatherevery]").value = this._working.weatherEveryTurns ?? 0;

    el.querySelector("[data-turnunit]").addEventListener("change", e => { this._working.turn.unit = e.target.value; this._syncHint(); });
    el.querySelector("[data-turncount]").addEventListener("input", e => { this._working.turn.count = Math.max(1, Math.trunc(+e.target.value || 1)); this._syncHint(); });
    el.querySelector("[data-turnlabel]").addEventListener("input", e => { this._working.turn.label = e.target.value; });
    el.querySelector("[data-weatherevery]").addEventListener("input", e => { this._working.weatherEveryTurns = Math.max(0, Math.trunc(+e.target.value || 0)); });

    this._working.turn ??= { unit: "stretch", count: 1, label: "Turn" };
    this._syncHint();
    this._buildResources();
    this._initPreview();
  }

  async _onClose(options) {
    this._preview?.destroy(); this._preview = null;
    return super._onClose(options);
  }

  /* ------------------------------ helpers ------------------------------ */

  _el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }

  _fillSelect(sel, pairs, selected) {
    const s = this.element.querySelector(sel);
    if (!s) return;
    s.replaceChildren(...pairs.map(([v, label]) => {
      const o = document.createElement("option"); o.value = v; o.textContent = label;
      if (v === selected) o.selected = true;
      return o;
    }));
  }

  _syncHint() {
    const t = this._working.turn ?? {};
    const unit = game.i18n.localize(`GLCT.delving.unit.${DELVING_UNITS.includes(t.unit) ? t.unit : "stretch"}`);
    this.element.querySelector("[data-turnhint]").textContent =
      game.i18n.format("GLCT.delving.editor.turnHint", { count: Math.max(1, t.count ?? 1), unit, label: t.label || "Turn" });
  }

  /* ------------------------------ resources ------------------------------ */

  _buildResources() {
    const host = this.element.querySelector("[data-resources]");
    if (!host) return;
    host.replaceChildren();
    const resources = this._working.resources ?? (this._working.resources = []);
    if (!resources.length) { host.appendChild(this._el("p", "dx-ed-empty", game.i18n.localize("GLCT.delving.editor.empty"))); return; }
    resources.forEach((r, ri) => host.appendChild(this._buildResourcePanel(r, ri)));
  }

  _buildResourcePanel(r, ri) {
    const panel = this._el("section", "dx-ed-res");

    const head = this._el("div", "dx-ed-reshead");
    const featured = this._el("label", "dx-ed-featured");
    const radio = document.createElement("input");
    radio.type = "radio"; radio.name = "dx-featured"; radio.checked = this._working.featuredId === r.id;
    radio.addEventListener("change", () => { if (radio.checked) this._working.featuredId = r.id; });
    featured.append(radio, this._el("span", null, game.i18n.localize("GLCT.delving.editor.featured")));

    const icon = document.createElement("input");
    icon.type = "text"; icon.className = "dx-ed-icon"; icon.value = r.icon ?? "";
    icon.placeholder = "fa-solid fa-fire";
    icon.addEventListener("input", () => { r.icon = icon.value; });

    const name = document.createElement("input");
    name.type = "text"; name.className = "dx-ed-name"; name.value = r.name ?? "";
    name.placeholder = game.i18n.localize("GLCT.delving.editor.resourceName");
    name.addEventListener("input", () => { r.name = name.value; });

    const vis = this._el("label", "dx-ed-vis");
    const visBox = document.createElement("input");
    visBox.type = "checkbox"; visBox.checked = r.visibleToPlayers !== false;
    visBox.addEventListener("change", () => { r.visibleToPlayers = visBox.checked; });
    vis.append(visBox, this._el("span", null, game.i18n.localize("GLCT.delving.editor.visible")));

    const del = this._el("button", "dx-ed-del", null);
    del.type = "button"; del.title = game.i18n.localize("GLCT.delving.editor.deleteResource");
    del.appendChild(this._el("i", "fa-solid fa-trash"));
    del.addEventListener("click", async () => {
      const ok = await DialogV2.confirm({
        window: { title: game.i18n.localize("GLCT.delving.editor.deleteResource") },
        content: `<p>${game.i18n.format("GLCT.delving.editor.confirmDeleteResource", { name: foundry.utils.escapeHTML(r.name || "") })}</p>`
      });
      if (!ok) return;
      this._working.resources.splice(ri, 1);
      if (this._working.featuredId === r.id) this._working.featuredId = this._working.resources[0]?.id ?? null;
      this._buildResources();
    });

    head.append(featured, icon, name, vis, del);
    panel.appendChild(head);

    // The resource's own "ended" name — shown when its final stage is depleted.
    const endRow = this._el("div", "dx-ed-endrow");
    endRow.appendChild(this._el("i", "fa-solid fa-skull"));
    endRow.appendChild(this._el("span", "dx-ed-endlbl", game.i18n.localize("GLCT.delving.editor.endName")));
    const endName = document.createElement("input");
    endName.type = "text"; endName.className = "dx-ed-endname"; endName.value = r.endName ?? "";
    endName.placeholder = game.i18n.localize("GLCT.delving.editor.endNamePlaceholder");
    endName.addEventListener("input", () => { r.endName = endName.value; });
    endRow.appendChild(endName);
    panel.appendChild(endRow);

    // stages table
    const stages = r.stages ?? (r.stages = []);
    const table = this._el("div", "dx-ed-stages");
    stages.forEach((s, si) => table.appendChild(this._buildStageRow(r, s, si)));
    panel.appendChild(table);

    const addStage = this._el("button", "dx-ed-addstage", null);
    addStage.type = "button";
    addStage.append(this._el("i", "fa-solid fa-plus"), this._el("span", null, game.i18n.localize("GLCT.delving.editor.addStage")));
    addStage.disabled = stages.length >= DELVING_STAGE_RANGE.max;
    addStage.addEventListener("click", () => { stages.push(makeStage(`Stage ${stages.length + 1}`)); this._buildResources(); });
    panel.appendChild(addStage);

    return panel;
  }

  _buildStageRow(r, s, si) {
    const e = s.effect ?? (s.effect = {});
    const row = this._el("div", "dx-ed-stage");

    const idx = this._el("span", "dx-ed-stageidx", String(si + 1));

    const name = document.createElement("input");
    name.type = "text"; name.className = "dx-ed-sname"; name.value = s.name ?? "";
    name.placeholder = game.i18n.localize("GLCT.delving.editor.stageName");
    name.addEventListener("input", () => { s.name = name.value; });

    const mkNum = (val, min, max, cls, on) => {
      const i = document.createElement("input");
      i.type = "number"; i.className = cls; i.value = val; i.min = min; i.max = max;
      i.addEventListener("input", () => on(Math.max(min, Math.min(max, Math.trunc(+i.value || min)))));
      return i;
    };
    const count = mkNum(s.count ?? 6, 0, 50, "dx-ed-num", v => { s.count = v; });
    const dxd = this._el("span", "dx-ed-dlabel", "×d");
    const size = mkNum(s.size ?? 6, 2, 100, "dx-ed-num", v => { s.size = v; });
    const dropLbl = this._el("span", "dx-ed-dlabel", "≤");
    const discard = mkNum(s.discard ?? 2, 0, 100, "dx-ed-num", v => { s.discard = v; });

    // look quick-pick → seeds the effect, then archetype/colours editable below
    const look = document.createElement("select");
    look.className = "dx-ed-look";
    look.append(...[["", game.i18n.localize("GLCT.delving.editor.lookPick")], ...STAGE_LOOK_LIST.map(l => [l.key, l.label])]
      .map(([v, lbl]) => { const o = document.createElement("option"); o.value = v; o.textContent = lbl; return o; }));
    look.addEventListener("change", () => {
      const l = STAGE_LOOKS[look.value];
      if (l) { s.effect = foundry.utils.deepClone(l.effect); this._buildResources(); }
    });

    const arch = document.createElement("select");
    arch.className = "dx-ed-arch";
    arch.append(...WEATHER_ARCHETYPES.map(a => { const o = document.createElement("option"); o.value = a; o.textContent = a; if (a === e.archetype) o.selected = true; return o; }));
    arch.addEventListener("change", () => { e.archetype = arch.value; this._focusPreview(s); });

    const tintP = document.createElement("input");
    tintP.type = "color"; tintP.value = /^#[0-9a-f]{6}$/i.test(e.tintParticle) ? e.tintParticle : "#ff9a3c";
    tintP.title = game.i18n.localize("GLCT.delving.editor.tintParticle");
    tintP.addEventListener("input", () => { e.tintParticle = tintP.value; this._focusPreview(s); });

    const tintG = document.createElement("input");
    tintG.type = "color"; tintG.value = /^#[0-9a-f]{6}$/i.test(e.tintGlow) ? e.tintGlow : "#ffd27a";
    tintG.title = game.i18n.localize("GLCT.delving.editor.tintGlow");
    tintG.addEventListener("input", () => { e.tintGlow = tintG.value; this._focusPreview(s); });

    const drift = document.createElement("select");
    drift.className = "dx-ed-drift";
    drift.append(...WEATHER_DRIFTS.map(d => { const o = document.createElement("option"); o.value = d; o.textContent = game.i18n.localize(`GLCT.delving.drift.${d}`); if (d === e.drift) o.selected = true; return o; }));
    drift.addEventListener("change", () => { e.drift = drift.value; this._focusPreview(s); });

    const omin = this._el("label", "dx-ed-omin");
    const ominBox = document.createElement("input");
    ominBox.type = "checkbox"; ominBox.checked = !!e.ominous;
    ominBox.addEventListener("change", () => { e.ominous = ominBox.checked; });
    omin.append(ominBox, this._el("i", "fa-solid fa-skull"));
    omin.title = game.i18n.localize("GLCT.delving.editor.ominous");

    const del = this._el("button", "dx-ed-del", null);
    del.type = "button"; del.title = game.i18n.localize("GLCT.delving.editor.deleteStage");
    del.appendChild(this._el("i", "fa-solid fa-xmark"));
    del.disabled = (r.stages?.length ?? 1) <= 1;
    del.addEventListener("click", () => { r.stages.splice(si, 1); this._buildResources(); });

    row.append(idx, name, count, dxd, size, dropLbl, discard, look, arch, tintP, tintG, drift, omin, del);
    row.addEventListener("pointerdown", () => this._focusPreview(s), true);
    return row;
  }

  /* ------------------------------ preview ------------------------------ */

  _initPreview() {
    const host = this.element.querySelector("[data-preview]");
    if (!host) return;
    const first = this._working.resources?.[0]?.stages?.[0];
    if (first) this._focusPreview(first);
  }

  _focusPreview(stage) {
    const host = this.element.querySelector("[data-preview]");
    if (!host || !stage?.effect) return;
    this.element.querySelector("[data-previewlabel]").textContent = stage.name ?? "";
    if (!this._preview) this._preview = WeatherEffect.create(host, stage.effect);
    else this._preview.setSpec(stage.effect);
    this._preview?.resize();
    this._preview?.resume();
  }

  /* ------------------------------ actions ------------------------------ */

  _onLoadPreset() {
    const id = this.element.querySelector("[data-presetsel]")?.value;
    const build = DELVING_PRESETS[id];
    if (!build) return;
    const res = build();
    this._working.resources.push(res);
    if (!this._working.featuredId) this._working.featuredId = res.id;
    this._buildResources();
    this._focusPreview(res.stages[0]);
    ui.notifications.info(game.i18n.format("GLCT.delving.editor.presetAdded", { name: res.name }));
  }

  _onAddResource() {
    const r = makeResource();
    this._working.resources.push(r);
    if (!this._working.featuredId) this._working.featuredId = r.id;
    this._buildResources();
  }

  _onImport() {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "application/json,.json";
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.resources)) {
          ui.notifications.error(game.i18n.localize("GLCT.delving.editor.importError")); return;
        }
        if (parsed.turn) this._working.turn = parsed.turn;
        if (Number.isFinite(+parsed.weatherEveryTurns)) this._working.weatherEveryTurns = +parsed.weatherEveryTurns;
        this._working.resources = parsed.resources;
        if (parsed.featuredId) this._working.featuredId = parsed.featuredId;
        await this.render();   // reflect the imported config across every field
        ui.notifications.info(game.i18n.localize("GLCT.delving.editor.imported"));
      } catch (err) {
        ui.notifications.error(game.i18n.localize("GLCT.delving.editor.importError"));
        console.warn(`${MODULE_ID} | Delving import failed`, err);
      }
    });
    input.click();
  }

  _onExport() {
    const out = {
      turn: this._working.turn,
      weatherEveryTurns: this._working.weatherEveryTurns,
      featuredId: this._working.featuredId,
      resources: this._working.resources
    };
    const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "delving.json"; a.click();
    URL.revokeObjectURL(a.href);
    ui.notifications.info(game.i18n.localize("GLCT.delving.editor.exported"));
  }

  async _onSave() {
    if (!this._working.resources?.length) { ui.notifications.error(game.i18n.localize("GLCT.delving.editor.needResource")); return; }
    if (this._working.turn) {
      this._working.turn.count = Math.max(DELVING_TURN_COUNT_RANGE.min, Math.min(DELVING_TURN_COUNT_RANGE.max, Math.trunc(+this._working.turn.count || 1)));
    }
    const working = foundry.utils.deepClone(this._working);
    // Persist the edited config but keep the LIVE delve state (counters/history/
    // active flag), and preserve each surviving resource's stageIndex/current.
    await DelvingStore.update(data => {
      const prev = new Map((data.resources ?? []).map(r => [r.id, r]));
      data.turn = working.turn;
      data.weatherEveryTurns = working.weatherEveryTurns;
      data.featuredId = working.featuredId;
      data.resources = working.resources.map(r => {
        const old = prev.get(r.id);
        if (old) { r.stageIndex = old.stageIndex; r.current = old.current; }
        return r;
      });
      return { reason: "editorSave" };
    });
    ui.notifications.info(game.i18n.localize("GLCT.delving.editor.saved"));
  }
}

/** Register the Delving settings menu (alongside Calendar / Weather / Support). */
export function registerDelvingMenu() {
  game.settings.registerMenu(MODULE_ID, "delvingEditor", {
    name: "GLCT.delving.editor.title",
    label: "GLCT.delving.editor.menuLabel",
    hint: "GLCT.delving.editor.menuHint",
    icon: "fa-solid fa-dungeon",
    type: DelvingEditor,
    restricted: true
  });
}
