/**
 * SupportEditor — the roster & ability editor (a Settings-menu app, modeled on
 * WeatherEditor). Left: the support roster. Right: the selected support's fields
 * (level, pool, faction, images, passive effect) and its four ability slots.
 *
 * Edits run on an in-memory working copy of the roster; Save writes it back to
 * the world `supports` setting via SupportStore (and re-seats the active support's
 * passive aura). Effect links accept drag-drop of PF2e Effect items.
 */

import { MODULE_ID, SUPPORT_ABILITY_KINDS, SUPPORT_FACTION_MOD } from "../const.js";
import { SupportStore, defaultFrames } from "../support/support-store.js";

/** Per-surface preview geometry — mirrors the real CSS so the framing is WYSIWYG.
 *  coin: round, art width-based, centred; card/exp: art height-based, left-anchored. */
const FRAME_SURFACES = {
  coin: { w: 74,  h: 74,  round: true,  art: "width:170%;height:auto",  origin: "top center",
          mask: "radial-gradient(125% 95% at 50% 32%,#000 62%,transparent 94%)" },
  card: { w: 240, h: 92,  round: false, art: "height:210%;width:auto", origin: "top left",
          mask: "linear-gradient(100deg,#000 28%,transparent 72%)" },
  exp:  { w: 240, h: 104, round: false, art: "height:200%;width:auto", origin: "top left",
          mask: "linear-gradient(100deg,#000 34%,transparent 76%)" }
};

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const KIND_META = {
  passive:      { icon: "fa-solid fa-shield-halved",   cls: "passive", burn: false },
  radio:        { icon: "fa-solid fa-tower-broadcast", cls: "radio",   burn: false },
  fieldCombat:  { icon: "fa-solid fa-bolt",            cls: "fc",      burn: true },
  fieldExplore: { icon: "fa-solid fa-route",           cls: "fx",      burn: true }
};

const TOKEN_HELP = `
  <code>{level}</code> <code>{half}</code> <code>{pool}</code> — computed numbers ·
  <code>@check[reflex|high]</code> save the target rolls vs your DC ·
  <code>@roll[athletics|moderate]</code> a check you roll ·
  <code>@atk[high]</code> Strike ·
  <code>@dmg[moderate]</code> Strike damage ·
  <code>@damage[2d6+{level}]</code> / <code>@heal[2d8+{level}]</code> ·
  <code>@dc[dc|high]</code> a bare number ·
  <code>@effect[0]</code> link the Nth dropped Effect.
  Tiers: extreme · high · moderate · low · terrible.`;

const TE = () => foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
const FP = () => foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;

export class SupportEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  static instance = null;

  static async show() {
    if (!game.user.isGM) return;
    if (!this.instance) this.instance = new this();
    await this.instance.render(true);
    return this.instance;
  }

  static DEFAULT_OPTIONS = {
    id: "glct-support-editor",
    classes: ["glct", "glct-supeditor"],
    tag: "form",
    window: { title: "GLCT.support.editor.title", icon: "fa-solid fa-user-shield", resizable: true },
    position: { width: 820, height: "auto" },
    actions: {
      addSupport: SupportEditor.prototype._onAdd,
      dupSupport: SupportEditor.prototype._onDup,
      delSupport: SupportEditor.prototype._onDel,
      importPreset: SupportEditor.prototype._onImportPreset,
      importJson: SupportEditor.prototype._onImportJson,
      exportJson: SupportEditor.prototype._onExport,
      saveRoster: SupportEditor.prototype._onSave,
      setActive: SupportEditor.prototype._onSetActive,
      pickImg: SupportEditor.prototype._onPickImg,
      clearField: SupportEditor.prototype._onClearField,
      framePortrait: SupportEditor.prototype._onFramePortrait
    }
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/support-editor.hbs` } };

  _working = null;   // working copy of the roster array
  _selId = null;

  _ensureWorking() {
    if (!this._working) {
      this._working = SupportStore.roster();
      this._selId = this._working[0]?.id ?? null;
    }
    if (this._selId && !this._working.some(s => s.id === this._selId)) this._selId = this._working[0]?.id ?? null;
  }

  _sel() { return this._working?.find(s => s.id === this._selId) ?? null; }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this._ensureWorking();
    const activeId = SupportStore.data.activeId;
    const sel = this._sel();

    const factionOptions = [0, 1, 2, 3, 4, 5].map(v => {
      const mod = SUPPORT_FACTION_MOD[v] ?? 0;
      const modTxt = mod > 0 ? `+${mod}d6` : mod < 0 ? `${mod}d6` : "±0";
      return { v, label: `${v} · ${modTxt}`, sel: sel ? sel.faction === v : false };
    });

    const abilities = sel ? SUPPORT_ABILITY_KINDS.map(key => {
      const a = sel.abilities[key];
      return {
        key, a,
        label: game.i18n.localize(`GLCT.support.kinds.${key}`),
        icon: KIND_META[key].icon, cls: KIND_META[key].cls, burn: KIND_META[key].burn,
        traitsStr: (a.traits ?? []).join(", "),
        effectsStr: (a.effectUuids ?? []).join("\n")
      };
    }) : [];

    return Object.assign(context, {
      roster: this._working.map(s => ({ id: s.id, name: s.name, accent: s.accent, selected: s.id === this._selId, active: s.id === activeId })),
      sel, factionOptions, abilities, tokenHelp: TOKEN_HELP
    });
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const root = this.element;

    // roster selection
    root.querySelectorAll(".sup-ed-row").forEach(row => {
      row.addEventListener("click", () => { this._selId = row.dataset.id; this.render(); });
    });
    this._wireReorder();

    // live input binding
    const form = root.querySelector("[data-form]");
    if (form) {
      form.addEventListener("input", ev => this._bindInput(ev));
      form.addEventListener("change", ev => this._bindInput(ev));
    }

    // effect drag-drop zones
    root.querySelectorAll("[data-drop]").forEach(zone => {
      zone.addEventListener("dragover", ev => { ev.preventDefault(); zone.classList.add("drop-hot"); });
      zone.addEventListener("dragleave", () => zone.classList.remove("drop-hot"));
      zone.addEventListener("drop", ev => this._onDropEffect(ev, zone));
    });
  }

  /* ------------------------------ live binding ------------------------------ */

  _bindInput(ev) {
    const el = ev.target;
    const field = el.dataset.field;
    if (!field) return;
    const sel = this._sel();
    if (!sel) return;
    const abilityKey = el.dataset.ability;
    const target = abilityKey ? (sel.abilities[abilityKey] ??= {}) : sel;

    let val;
    if (el.type === "checkbox") val = el.checked;
    else if (el.type === "number") val = Number(el.value);
    else val = el.value;

    if (field === "traits") val = String(el.value).split(",").map(s => s.trim()).filter(Boolean);
    else if (field === "effectUuids") val = String(el.value).split(/[\n,]/).map(s => s.trim()).filter(Boolean);

    target[field] = val;

    // reflect name/accent into the roster list without a full re-render
    if (!abilityKey && (field === "name" || field === "accent")) {
      const row = this.element.querySelector(`.sup-ed-row[data-id="${sel.id}"]`);
      if (row) { if (field === "name") row.querySelector(".nm").textContent = el.value; else row.querySelector(".dot").style.background = el.value; }
    }
  }

  /* ------------------------------ drag-drop / reorder ------------------------------ */

  async _onDropEffect(ev, zone) {
    ev.preventDefault();
    zone.classList.remove("drop-hot");
    let data = null;
    try { data = TE().getDragEventData(ev); } catch { /* ignore */ }
    const uuid = data?.uuid ?? (data?.type === "Item" && data?.id ? `Item.${data.id}` : null);
    if (!uuid) return;
    const sel = this._sel();
    if (!sel) return;

    if (zone.dataset.drop === "passive") {
      sel.passiveEffectUuid = uuid;
    } else if (zone.dataset.drop === "ability") {
      const key = zone.dataset.ability;
      const a = sel.abilities[key]; if (!a) return;
      a.effectUuids = [...(a.effectUuids ?? []), uuid];
    }
    this.render();
  }

  _wireReorder() {
    const list = this.element.querySelector("[data-list]");
    if (!list) return;
    let dragId = null;
    list.querySelectorAll(".sup-ed-row").forEach(row => {
      row.addEventListener("dragstart", () => { dragId = row.dataset.id; });
      row.addEventListener("dragover", ev => ev.preventDefault());
      row.addEventListener("drop", ev => {
        ev.preventDefault();
        const targetId = row.dataset.id;
        if (!dragId || dragId === targetId) return;
        const from = this._working.findIndex(s => s.id === dragId);
        const to = this._working.findIndex(s => s.id === targetId);
        if (from < 0 || to < 0) return;
        const [moved] = this._working.splice(from, 1);
        this._working.splice(to, 0, moved);
        this._working.forEach((s, i) => { s.order = i; });
        this.render();
      });
    });
  }

  /* ------------------------------ actions ------------------------------ */

  _onAdd() {
    const s = SupportStore.makeNew();
    this._working.push(s);
    this._selId = s.id;
    this.render();
  }

  _onDup() {
    const sel = this._sel();
    if (!sel) return;
    const copy = foundry.utils.deepClone(sel);
    copy.id = foundry.utils.randomID();
    copy.name = `${sel.name} (copy)`;
    copy.order = this._working.length;
    this._working.push(copy);
    this._selId = copy.id;
    this.render();
  }

  async _onDel() {
    const sel = this._sel();
    if (!sel) return;
    const ok = await DialogV2.confirm({
      window: { title: game.i18n.localize("GLCT.support.editor.delete") },
      content: `<p>${game.i18n.format("GLCT.support.editor.deleteConfirm", { name: sel.name })}</p>`
    });
    if (!ok) return;
    this._working = this._working.filter(s => s.id !== sel.id);
    this._selId = this._working[0]?.id ?? null;
    this.render();
  }

  async _onImportPreset() {
    const { makeSupportPresets } = await import("../support/presets.js");
    const presets = makeSupportPresets();
    // Split each preset's bundled passiveEffect into the shared import shape so
    // Razor & Tourniquet go through the exact create-effect-and-link path as a
    // pasted JSON bundle (no separate macro needed).
    const supports = [], effects = [];
    for (const p of presets) {
      const sup = foundry.utils.deepClone(p);
      const fx = sup.passiveEffect;
      delete sup.passiveEffect;
      if (fx && typeof fx === "object") {
        effects.push(fx);
        if (!sup.passiveEffectUuid && !sup.passiveEffectRef) sup.passiveEffectRef = fx.name;
      }
      supports.push(sup);
    }
    const r = await this._ingestBundle({ supports, effects });
    ui.notifications?.info(game.i18n.format("GLCT.support.editor.presetImported", { linked: r.linked }));
  }

  /* ------------------------------ JSON import ------------------------------ */

  /** Open the Import Support dialog: paste a bundle (or load a file), validated
   *  live, then materialise it (create + link the passive Effect, add to roster). */
  async _onImportJson() {
    const L = (k) => game.i18n.localize(k);
    const content = `<div class="glct-sup-import">
      <p class="imp-intro">${L("GLCT.support.editor.importIntro")}</p>
      <textarea class="imp-ta" spellcheck="false" placeholder="${foundry.utils.escapeHTML(L("GLCT.support.editor.importPlaceholder"))}"></textarea>
      <div class="imp-row">
        <span class="imp-chip idle"><i class="fa-solid fa-circle-info"></i> ${L("GLCT.support.editor.importWaiting")}</span>
        <span class="imp-spacer"></span>
        <button type="button" class="sup-eb imp-file"><i class="fa-solid fa-folder-open"></i> ${L("GLCT.support.editor.importLoadFile")}</button>
      </div>
      <p class="imp-hint"><i class="fa-solid fa-wand-magic-sparkles"></i> ${L("GLCT.support.editor.importSkillHint")}</p>
    </div>`;

    let bundleText = "";
    let confirmed = false;

    await DialogV2.wait({
      window: { title: L("GLCT.support.editor.importTitle"), icon: "fa-solid fa-file-import" },
      classes: ["glct", "glct-supeditor", "glct-sup-import-dlg"],
      content,
      rejectClose: false,
      render: (event, dialog) => {
        const host = dialog?.element ?? event?.currentTarget;
        if (!host) return;
        const ta = host.querySelector(".imp-ta");
        const chip = host.querySelector(".imp-chip");
        const setChip = (cls, icon, msg) => { if (chip) { chip.className = `imp-chip ${cls}`; chip.innerHTML = `<i class="fa-solid ${icon}"></i> ${msg}`; } };
        const validate = () => {
          const t = bundleText.trim();
          if (!t) return setChip("idle", "fa-circle-info", L("GLCT.support.editor.importWaiting"));
          let parsed;
          try { parsed = this._parseSupportBundle(t); }
          catch (e) { return setChip("err", "fa-triangle-exclamation", e.message); }
          const n = parsed.supports.length;
          const fx = parsed.effects.length;
          setChip("ok", "fa-circle-check", game.i18n.format("GLCT.support.editor.importValid", { n, fx }));
        };
        ta?.addEventListener("input", () => { bundleText = ta.value; validate(); });
        host.querySelector(".imp-file")?.addEventListener("click", () => {
          const input = document.createElement("input");
          input.type = "file"; input.accept = "application/json,.json";
          input.addEventListener("change", async () => {
            const file = input.files?.[0]; if (!file) return;
            try { bundleText = await file.text(); if (ta) ta.value = bundleText; validate(); }
            catch (e) { setChip("err", "fa-triangle-exclamation", e.message); }
          });
          input.click();
        });
        validate();
      },
      buttons: [
        { action: "import", label: L("GLCT.support.editor.importBtn"), icon: "fa-solid fa-check", default: true, callback: () => { confirmed = true; } },
        { action: "cancel", label: L("GLCT.calendarView.close") }
      ]
    }).catch(() => {});

    if (confirmed) await this._applyImport(bundleText);
  }

  /**
   * Parse + normalise an import bundle into `{ supports:[…], effects:[…] }`.
   * Accepts three shapes (decision: auto-detect):
   *   • single NPC   → { support:{…}, passiveEffect:{…}? }
   *   • roster bundle → { roster:[…], effects:[…]? }
   *   • a bare support object (has name + abilities)
   * Throws a localised Error on anything unusable.
   */
  _parseSupportBundle(text) {
    let o;
    try { o = JSON.parse(text); }
    catch (e) { throw new Error(game.i18n.format("GLCT.support.editor.importBadJson", { msg: e.message })); }
    if (!o || typeof o !== "object") throw new Error(game.i18n.localize("GLCT.support.editor.importBadShape"));

    let supports = [];
    let effects = [];

    if (Array.isArray(o.roster)) {
      supports = o.roster.filter(s => s && typeof s === "object");
      effects = Array.isArray(o.effects) ? o.effects.filter(e => e && typeof e === "object") : [];
    } else if (o.support && typeof o.support === "object") {
      const sup = o.support;
      supports = [sup];
      if (o.passiveEffect && typeof o.passiveEffect === "object") {
        effects = [o.passiveEffect];
        // Wire the single NPC to its bundled effect if not already referenced.
        if (!sup.passiveEffectUuid && !sup.passiveEffectRef) sup.passiveEffectRef = o.passiveEffect.name;
      }
    } else if (o.name && o.abilities && typeof o.abilities === "object") {
      supports = [o];
      if (o.passiveEffect && typeof o.passiveEffect === "object") {
        effects = [o.passiveEffect];
        if (!o.passiveEffectUuid && !o.passiveEffectRef) o.passiveEffectRef = o.passiveEffect.name;
      }
    } else {
      throw new Error(game.i18n.localize("GLCT.support.editor.importBadShape"));
    }

    if (!supports.length) throw new Error(game.i18n.localize("GLCT.support.editor.importNoSupport"));
    return { supports, effects };
  }

  /** Materialise a parsed bundle from pasted/loaded JSON, then notify. */
  async _applyImport(text) {
    let parsed;
    try { parsed = this._parseSupportBundle(text); }
    catch (e) { ui.notifications?.error(e.message); return; }
    const r = await this._ingestBundle(parsed);
    ui.notifications?.info(game.i18n.format("GLCT.support.editor.importDone", { n: r.added, fx: r.fxCount, linked: r.linked }));
  }

  /**
   * Shared materialiser for both the JSON import and the bundled-preset import:
   * create/update the bundle's passive Effect items, then add each support (fresh
   * id, reset live-state, passive resolved + linked) into the working roster.
   * Returns `{ added, linked, fxCount }`; the caller notifies.
   */
  async _ingestBundle({ supports = [], effects = [] }) {
    // Create / update the bundled passive Effect items (PF2e). Map name|slug → uuid.
    let uuidByKey = new Map();
    try { uuidByKey = await SupportStore.importEffectItems(effects); }
    catch (e) { console.error(`${MODULE_ID} | effect import`, e); }
    const fxCount = new Set(uuidByKey.values()).size;

    let order = this._working.reduce((m, s) => Math.max(m, s.order ?? 0), 0) + 1;
    let added = 0, linked = 0, lastId = null;

    for (const raw of supports) {
      const ov = foundry.utils.deepClone(raw);

      // Resolve the passive link: explicit uuid wins, else a ref / the passive
      // ability's name matched against the freshly-created effect items.
      let uuid = String(ov.passiveEffectUuid || "").trim();
      if (!uuid) {
        const ref = String(ov.passiveEffectRef || ov.abilities?.passive?.name || "").trim().toLowerCase();
        if (ref && uuidByKey.has(ref)) uuid = uuidByKey.get(ref);
      }
      delete ov.passiveEffectRef;
      delete ov.passiveEffect;
      delete ov.id;

      // Start from a fully-defaulted support so a partial bundle still renders,
      // then deep-merge the imported fields on top (abilities merge per-slot).
      const s = SupportStore.makeNew();
      foundry.utils.mergeObject(s, ov, { inplace: true });
      s.id = foundry.utils.randomID();
      s.order = order++;
      s.passiveEffectUuid = uuid;
      // Fresh live-state — never import a stale pool / Downed flag.
      s.downed = false; s.downedLastMission = false; s.radioUsed = false;
      s.current = SupportStore.poolMax(s);

      this._working.push(s);
      lastId = s.id; added++;
      if (uuid) linked++;
    }

    if (lastId) this._selId = lastId;
    this.render();
    return { added, linked, fxCount };
  }

  _onExport() {
    const json = JSON.stringify({ schemaVersion: 1, roster: this._working }, null, 2);
    try { (foundry.utils.saveDataToFile ?? globalThis.saveDataToFile)(json, "application/json", "support-roster.json"); }
    catch { DialogV2.prompt({ window: { title: game.i18n.localize("GLCT.support.editor.export") }, content: `<textarea rows="14" style="width:100%">${foundry.utils.escapeHTML(json)}</textarea>` }); }
  }

  async _onSave() {
    await SupportStore.save({ schemaVersion: 1, activeId: SupportStore.data.activeId, roster: this._working });
    // Re-seat the active support's passive in case its effect/level/name changed.
    if (SupportStore.active()) await SupportStore.applyPassive();
    // Re-sync the working copy to the sanitized result.
    this._working = SupportStore.roster();
    ui.notifications?.info(game.i18n.localize("GLCT.support.editor.saved"));
    this.render();
  }

  async _onSetActive() {
    const sel = this._sel();
    if (!sel) return;
    await this._onSave();
    await SupportStore.setActive(sel.id);
    ui.notifications?.info(game.i18n.format("GLCT.support.missionStarted", { name: sel.name }));
    this.render();
  }

  async _onPickImg(ev, target) {
    const btn = target instanceof HTMLElement ? target : ev?.target?.closest("[data-target]");
    const field = btn?.dataset?.target;
    if (!field) return;
    const sel = this._sel();
    const current = sel?.[field] || "";
    const Picker = FP();
    const picker = new Picker({
      type: "image", current,
      callback: (path) => {
        const input = this.element.querySelector(`[data-field="${field}"]:not([data-ability])`);
        if (input) { input.value = path; input.dispatchEvent(new Event("change", { bubbles: true })); }
      }
    });
    picker.render(true);
  }

  /* ------------------------------ portrait framing ------------------------------ */

  /** Open the per-surface portrait framing dialog for the selected support. */
  async _onFramePortrait() {
    const sel = this._sel();
    if (!sel) return;
    if (!sel.img) {
      ui.notifications?.warn(game.i18n.localize("GLCT.support.editor.frameNoImg"));
      return;
    }
    const frames = foundry.utils.deepClone(sel.frames ?? defaultFrames());
    const L = (k) => game.i18n.localize(k);
    const tabs = [
      ["coin", L("GLCT.support.editor.frameCoin")],
      ["card", L("GLCT.support.editor.frameCard")],
      ["exp",  L("GLCT.support.editor.frameExp")]
    ];
    const pv = (key, label) => {
      const cfg = FRAME_SURFACES[key];
      return `<div class="frm-pv${key === "coin" ? " active" : ""}" data-surf="${key}">
        <span class="cap">${label}</span>
        <div class="frame ${key}" style="width:${cfg.w}px;height:${cfg.h}px;${cfg.round ? "border-radius:50%" : "border-radius:8px"}">
          <img alt="" src="${sel.img}"></div></div>`;
    };
    const content = `<div class="frm" style="--glct-sup-accent:${sel.accent}">
      <div class="frm-tabs">${tabs.map(([k, l], i) => `<button type="button" class="frm-tab${i === 0 ? " on" : ""}" data-surf="${k}">${l}</button>`).join("")}</div>
      <div class="frm-previews">${tabs.map(([k, l]) => pv(k, l)).join("")}</div>
      <div class="frm-ctrls">
        <div class="frm-ctrl"><label>X</label><input type="range" data-k="x" min="-300" max="300" step="1"><span class="val" data-v="x"></span></div>
        <div class="frm-ctrl"><label>Y</label><input type="range" data-k="y" min="-400" max="200" step="1"><span class="val" data-v="y"></span></div>
        <div class="frm-ctrl"><label>${L("GLCT.support.editor.frameScale")}</label><input type="range" data-k="s" min="20" max="400" step="1"><span class="val" data-v="s"></span></div>
      </div>
      <div class="frm-foot"><button type="button" class="frm-reset">${L("GLCT.support.editor.frameReset")}</button>
        <span class="frm-hint">${L("GLCT.support.editor.frameDragHint")}</span></div>
    </div>`;

    let saved = false;
    await DialogV2.wait({
      window: { title: `${L("GLCT.support.editor.framePortrait")} — ${sel.name}` },
      classes: ["glct", "glct-frame-dlg"],
      content,
      rejectClose: false,
      render: (event, dialog) => this._wireFrameDialog(dialog?.element ?? event?.currentTarget, frames),
      buttons: [
        { action: "save", label: L("GLCT.support.editor.frameSave"), default: true, callback: () => { saved = true; } },
        { action: "cancel", label: L("GLCT.calendarView.close") }
      ]
    }).catch(() => {});

    if (saved) { sel.frames = frames; this.render(); }
  }

  /** Wire tabs / sliders / drag for the framing dialog; mutates `frames` live. */
  _wireFrameDialog(host, frames) {
    if (!host) return;
    let surf = "coin";

    const applyOne = (key) => {
      const cfg = FRAME_SURFACES[key], f = frames[key];
      const img = host.querySelector(`.frm-pv[data-surf="${key}"] img`);
      if (!img) return;
      img.style.cssText = `position:absolute;left:${cfg.round ? "50%" : "0"};top:0;${cfg.art};` +
        `transform-origin:${cfg.origin};` +
        (cfg.round
          ? `transform:translate(calc(-50% + ${f.x}px),${f.y}px) scale(${f.s});`
          : `transform:translate(${f.x}px,${f.y}px) scale(${f.s});`) +
        `-webkit-mask-image:${cfg.mask};mask-image:${cfg.mask};`;
    };
    const applyAll = () => Object.keys(frames).forEach(applyOne);

    const syncSliders = () => {
      const f = frames[surf];
      host.querySelectorAll("[data-k]").forEach(inp => {
        const k = inp.dataset.k;
        inp.value = k === "s" ? Math.round(f.s * 100) : f[k];
      });
      host.querySelector('[data-v="x"]').textContent = Math.round(frames[surf].x);
      host.querySelector('[data-v="y"]').textContent = Math.round(frames[surf].y);
      host.querySelector('[data-v="s"]').textContent = `${frames[surf].s.toFixed(2)}×`;
    };
    const selectSurf = (key) => {
      surf = key;
      host.querySelectorAll(".frm-tab").forEach(t => t.classList.toggle("on", t.dataset.surf === key));
      host.querySelectorAll(".frm-pv").forEach(p => p.classList.toggle("active", p.dataset.surf === key));
      syncSliders();
    };

    host.querySelectorAll(".frm-tab").forEach(t => t.addEventListener("click", () => selectSurf(t.dataset.surf)));

    host.querySelectorAll("[data-k]").forEach(inp => inp.addEventListener("input", () => {
      const k = inp.dataset.k;
      frames[surf][k] = k === "s" ? (Number(inp.value) / 100) : Number(inp.value);
      applyOne(surf); syncSliders();
    }));

    host.querySelector(".frm-reset")?.addEventListener("click", () => {
      frames[surf] = { ...defaultFrames()[surf] };
      applyOne(surf); syncSliders();
    });

    // drag inside a preview to position that surface
    host.querySelectorAll(".frm-pv .frame").forEach(frame => {
      const key = frame.closest(".frm-pv").dataset.surf;
      frame.style.cursor = "grab";
      frame.addEventListener("pointerdown", ev => {
        selectSurf(key);
        const sx = ev.clientX, sy = ev.clientY, f0 = { ...frames[key] };
        frame.setPointerCapture(ev.pointerId);
        const move = e => {
          frames[key].x = f0.x + (e.clientX - sx);
          frames[key].y = f0.y + (e.clientY - sy);
          applyOne(key); syncSliders();
        };
        const up = () => { frame.removeEventListener("pointermove", move); frame.removeEventListener("pointerup", up); };
        frame.addEventListener("pointermove", move);
        frame.addEventListener("pointerup", up);
      });
    });

    applyAll();
    selectSurf("coin");
  }

  _onClearField(ev, target) {
    const btn = target instanceof HTMLElement ? target : ev?.target?.closest("[data-target]");
    const field = btn?.dataset?.target;
    if (!field) return;
    const sel = this._sel();
    if (sel) sel[field] = "";
    this.render();
  }
}

/** Register the Support roster editor as a settings menu (GM only). */
export function registerSupportMenu() {
  game.settings.registerMenu(MODULE_ID, "supportEditor", {
    name: "GLCT.support.editor.title",
    label: "GLCT.support.editor.menuLabel",
    hint: "GLCT.support.editor.menuHint",
    icon: "fa-solid fa-user-shield",
    type: SupportEditor,
    restricted: true
  });
}
