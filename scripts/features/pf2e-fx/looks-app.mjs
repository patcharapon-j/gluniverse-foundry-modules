/**
 * Spellsprite — the look editor and the GM's rules.
 *
 * A player restyles their own items and character; the GM restyles anything,
 * and sets world rules by item slug (`fx.rules`, `"*"` being the default for
 * everything). A look is stored as `flags[SUITE_ID]["fx.look"]`, read through
 * looks.mjs, and the editor shows the result live on a small pixel stage.
 *
 * Both windows are built in memoised factories: this module is imported by the
 * adapter at load time, and `foundry.applications` is reached only on first use.
 */

import { SUITE_ID } from "../../core/const.mjs";
import { escapeHTML } from "../../core/util.mjs";
import { FLOURISHES, LOOK_FLAG, MATERIALS, SETTINGS, TIMING, WEAPON_STYLES } from "./constants.mjs";
import { applyLook, isEmptyLook, mergeLooks, normalizeLook } from "./looks.mjs";
import { compile } from "./compile.mjs";
import { Layers } from "./core/pix.mjs";
import { Blit } from "./core/blit.mjs";
import { topView, paintFrame } from "./core/frame.mjs";

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const LOOKABLE_ITEMS = new Set(["spell", "weapon", "melee", "action", "feat", "consumable", "shield"]);

/* ── reading and writing ─────────────────────────────────────────────── */

export function readRules() {
  let raw = null;
  try { raw = game.settings.get(SUITE_ID, SETTINGS.rules); } catch { raw = null; }
  const out = {};
  if (raw && typeof raw === "object") for (const [slug, look] of Object.entries(raw)) {
    const key = String(slug).trim();
    if (!key) continue;
    const l = normalizeLook(look);
    if (!isEmptyLook(l)) out[key] = l;
  }
  return out;
}

const flagOf = (doc) => { try { return doc?.getFlag?.(SUITE_ID, LOOK_FLAG) ?? null; } catch { return null; } };

async function writeLook(doc, look) {
  const l = normalizeLook(look);
  if (isEmptyLook(l)) return doc.unsetFlag(SUITE_ID, LOOK_FLAG);
  /* A forced replacement: a plain nested update merges, so a field the player
     cleared would survive. */
  await doc.unsetFlag(SUITE_ID, LOOK_FLAG);
  return doc.setFlag(SUITE_ID, LOOK_FLAG, l);
}

/** Everything under this document's own layer: world default, GM rule, then the actor for an item. */
function inheritedLook(doc) {
  const rules = readRules();
  const layers = [rules["*"]];
  if (doc?.documentName === "Item") {
    layers.push(rules[doc.slug ?? doc.system?.slug ?? ""]);
    if (doc.actor) layers.push(flagOf(doc.actor));
  }
  return mergeLooks(...layers);
}

export function mayEdit(doc) {
  return Boolean(doc?.isOwner || game.user?.isGM);
}

/* ── the preview stage ───────────────────────────────────────────────── */

/** A sample effect for a document, so a look is judged on something like its own effect. */
export function sampleSpec(doc, material, seed) {
  const caster = { id: "c", x: 2, y: 3.2, size: 1, h: 1.3 };
  const target = { id: "t", x: 6.4, y: 3.2, size: 1, h: 1.3, outcome: "hit" };
  const base = { id: "preview", seed, rank: 3, tradition: "arcane", caster, targets: [target], outcome: "hit", accent: null, material, func: "harm", look: null };
  const type = doc?.type;
  if (type === "weapon" || type === "melee" || type === "shield") {
    const ranged = type === "weapon" ? Boolean(doc.isRanged ?? doc.system?.range) : (doc.system?.traits?.value ?? []).some((t) => /^range/.test(t));
    const dmg = doc.system?.damage?.damageType ?? Object.values(doc.system?.damageRolls ?? {})[0]?.damageType;
    const style = ranged ? "ranged" : dmg === "piercing" ? "pierce" : dmg === "bludgeoning" ? "bludgeon" : "slash";
    return { ...base, kind: "strike", weapon: { style: WEAPON_STYLES.includes(style) ? style : "slash", ranged }, caster: { ...caster, x: 4.6 }, targets: [{ ...target, x: 5.8 }] };
  }
  const area = doc?.system?.area;
  if (area?.type && area?.value) {
    const r = Math.max(1, Math.min(4, Number(area.value) / 5));
    if (area.type === "cone" || area.type === "line") {
      return { ...base, kind: "area", area: { shape: area.type, x: caster.x, y: caster.y, r, len: r, width: 1, dir: 0 } };
    }
    return { ...base, kind: "area", area: { shape: "burst", x: target.x, y: target.y, r: Math.min(r, 2.5) } };
  }
  return { ...base, kind: "attack" };
}

class Stage {
  constructor(canvasEl) {
    this.el = canvasEl;
    this.ctx = canvasEl.getContext("2d");
    this.k = 2;
    this.L = new Layers(Math.ceil(canvasEl.width / this.k), Math.ceil(canvasEl.height / this.k));
    this.B = new Blit();
    this.sim = null;
    this.spec = null;
    this.raf = 0;
    this.last = 0;
    this.seed = 11;
  }

  play(spec) {
    this.spec = spec;
    this.restart();
    if (!this.raf) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  restart() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0;
    try { this.sim = this.spec ? compile({ ...this.spec, seed: this.seed }) : null; } catch { this.sim = null; }
    this.rest = 0;
  }

  frame(t) {
    this.raf = 0;
    if (!this.el.isConnected) return;
    const dt = this.last ? Math.min(TIMING.maxDt, (t - this.last) / 1000) : 0;
    this.last = t;
    const s = this.sim;
    if (s) {
      let acc = (this.acc ?? 0) + dt;
      while (acc >= TIMING.step) { s.step(TIMING.step); acc -= TIMING.step; }
      this.acc = acc;
      if (s.done) { this.rest += dt; if (this.rest > 0.5) this.restart(); }
    }
    this.draw();
    this.raf = requestAnimationFrame((u) => this.frame(u));
  }

  draw() {
    const { ctx, el, k } = this;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    const style = getComputedStyle(el);
    ctx.fillStyle = style.getPropertyValue("--glfx-floor").trim() || "#16141c";
    ctx.fillRect(0, 0, el.width, el.height);
    const aps = 26, ox = 0, oy = 0;
    ctx.strokeStyle = style.getPropertyValue("--glfx-grid").trim() || "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x < el.width; x += aps * k) { ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, el.height); ctx.stroke(); }
    for (let y = 0; y < el.height; y += aps * k) { ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(el.width, y + 0.5); ctx.stroke(); }
    const s = this.sim;
    if (!s) return;
    for (const T of [s.spec.caster, ...(s.spec.targets ?? [])].filter(Boolean)) {
      ctx.fillStyle = T === s.spec.caster ? "#5fb0ff" : "#e05a50";
      ctx.beginPath(); ctx.arc(T.x * aps * k, T.y * aps * k, 0.4 * aps * k, 0, Math.PI * 2); ctx.fill();
    }
    paintFrame([s], topView({ ox, oy, aps }), this.L, { bright: false });
    this.B.update(this.L, false);
    this.B.draw(ctx, "flat", k);
    this.B.draw(ctx, "stand", k);
    this.B.draw(ctx, "light", k, 0, 0, "lighter");
  }

  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

/* ── markup ──────────────────────────────────────────────────────────── */

const option = (value, label, selected) => `<option value="${escapeHTML(value)}"${selected ? " selected" : ""}>${escapeHTML(label)}</option>`;

function fieldsHTML(look, inherited, prefix = "") {
  const n = (f) => `${prefix}${f}`;
  const inheritLabel = (v) => L("GLFX.look.inherit", { value: v ?? L("GLFX.look.automatic") });
  const mats = [option("", inheritLabel(inherited.material ? L(`GLFX.material.${inherited.material}`) : null), !look.material),
    ...MATERIALS.map((m) => option(m, L(`GLFX.material.${m}`), look.material === m))].join("");
  const flourishes = [option("", inheritLabel(inherited.flourish ? L(`GLFX.flourish.${inherited.flourish}`) : null), !look.flourish),
    ...FLOURISHES.map((f) => option(f, L(`GLFX.flourish.${f}`), look.flourish === f))].join("");
  const layouts = [option("", inheritLabel(inherited.layout != null ? L("GLFX.look.take", { n: inherited.layout + 1 }) : null), look.layout == null),
    ...[0, 1, 2].map((i) => option(String(i), L("GLFX.look.take", { n: i + 1 }), look.layout === i))].join("");
  const hueOn = look.hue != null;
  return `
    <label class="glfx-row"><span>${L("GLFX.look.material")}</span><select name="${n("material")}">${mats}</select></label>
    <div class="glfx-row"><span>${L("GLFX.look.hue")}</span>
      <span class="glfx-hue">
        <input type="checkbox" name="${n("hueOn")}"${hueOn ? " checked" : ""} aria-label="${escapeHTML(L("GLFX.look.hueOn"))}">
        <input type="range" name="${n("hue")}" min="0" max="359" step="1" value="${hueOn ? look.hue : 0}"${hueOn ? "" : " disabled"}>
      </span></div>
    <label class="glfx-row"><span>${L("GLFX.look.flourish")}</span><select name="${n("flourish")}">${flourishes}</select></label>
    <label class="glfx-row"><span>${L("GLFX.look.layout")}</span><select name="${n("layout")}">${layouts}</select></label>
    <label class="glfx-row glfx-check"><input type="checkbox" name="${n("off")}"${look.off ? " checked" : ""}><span>${L("GLFX.look.off")}</span></label>`;
}

function readFields(form, prefix = "") {
  const v = (f) => form.elements.namedItem(`${prefix}${f}`);
  const hueOn = v("hueOn")?.checked;
  return normalizeLook({
    material: v("material")?.value || null,
    hue: hueOn ? v("hue")?.value : null,
    flourish: v("flourish")?.value || null,
    layout: v("layout")?.value ?? null,
    off: v("off")?.checked === true,
  });
}

/* ── the windows ─────────────────────────────────────────────────────── */

let _lookApp = null;
let _rulesApp = null;

export function lookAppClass() {
  if (_lookApp) return _lookApp;
  const { ApplicationV2 } = foundry.applications.api;
  _lookApp = class SpellspriteLookApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["glfx", "glfx-look"],
      tag: "form",
      window: { icon: "fa-solid fa-wand-magic-sparkles", resizable: false },
      position: { width: 420, height: "auto" },
      form: { handler: SpellspriteLookApp.#save, submitOnChange: false, closeOnSubmit: true },
      actions: { reset: SpellspriteLookApp.prototype._onReset },
    };

    constructor(doc, options = {}) {
      super({ ...options, id: `glfx-look-${doc.uuid.replaceAll(".", "-")}` });
      this.doc = doc;
      this.draft = normalizeLook(flagOf(doc));
    }

    get title() { return L("GLFX.look.title", { name: this.doc.name }); }

    async _renderHTML() {
      return `
        <div class="glfx-body gl-type">
          <canvas class="glfx-stage" width="384" height="160"></canvas>
          <p class="glfx-hint">${L(this.doc.documentName === "Actor" ? "GLFX.look.hintActor" : "GLFX.look.hintItem")}</p>
          ${fieldsHTML(this.draft, inheritedLook(this.doc))}
          <footer class="glfx-foot">
            <button type="button" class="gl-btn glfx-btn" data-action="reset"><i class="fa-solid fa-rotate-left"></i> ${L("GLFX.look.reset")}</button>
            <button type="submit" class="gl-btn glfx-btn"><i class="fa-solid fa-check"></i> ${L("GLFX.look.save")}</button>
          </footer>
        </div>`;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    _onRender() {
      const form = this.element;
      this.stage?.stop();
      this.stage = new Stage(form.querySelector(".glfx-stage"));
      const update = () => {
        const hue = form.elements.namedItem("hue");
        hue.disabled = !form.elements.namedItem("hueOn").checked;
        this.draft = readFields(form);
        const look = mergeLooks(inheritedLook(this.doc), this.draft);
        const spec = sampleSpec(this.doc, look.material ?? "arcane", 11);
        this.stage.play(look.off ? null : applyLook(spec, look));
      };
      form.addEventListener("input", update);
      update();
    }

    _onClose(options) {
      this.stage?.stop();
      super._onClose?.(options);
    }

    _onReset() {
      this.draft = normalizeLook(null);
      this.render();
    }

    static async #save(_event, form) {
      if (!mayEdit(this.doc)) return;
      await writeLook(this.doc, readFields(form));
    }
  };
  return _lookApp;
}

export function rulesAppClass() {
  if (_rulesApp) return _rulesApp;
  const { ApplicationV2 } = foundry.applications.api;
  _rulesApp = class SpellspriteRulesApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      id: "glfx-rules",
      classes: ["glfx", "glfx-rules"],
      tag: "form",
      window: { icon: "fa-solid fa-wand-magic-sparkles", title: "GLFX.rules.title", resizable: true },
      position: { width: 560, height: "auto" },
      form: { handler: SpellspriteRulesApp.#save, submitOnChange: false, closeOnSubmit: true },
      actions: { add: SpellspriteRulesApp.prototype._onAdd, remove: SpellspriteRulesApp.prototype._onRemove },
    };

    constructor(options = {}) {
      super(options);
      const rules = readRules();
      this.rows = Object.entries(rules).filter(([k]) => k !== "*").map(([slug, look]) => ({ slug, look }));
      this.base = rules["*"] ?? normalizeLook(null);
    }

    async _renderHTML() {
      const none = normalizeLook(null);
      const rows = this.rows.map((r, i) => `
        <fieldset class="glfx-rule">
          <legend><input type="text" name="r${i}.slug" value="${escapeHTML(r.slug)}" placeholder="${escapeHTML(L("GLFX.rules.slug"))}">
            <button type="button" class="gl-btn glfx-btn glfx-icon" data-action="remove" data-index="${i}" aria-label="${escapeHTML(L("GLFX.rules.remove"))}"><i class="fa-solid fa-trash"></i></button></legend>
          ${fieldsHTML(r.look, none, `r${i}.`)}
        </fieldset>`).join("");
      return `
        <div class="glfx-body gl-type">
          <p class="glfx-hint">${L("GLFX.rules.hint")}</p>
          <fieldset class="glfx-rule"><legend>${L("GLFX.rules.default")}</legend>${fieldsHTML(this.base, none, "base.")}</fieldset>
          ${rows}
          <footer class="glfx-foot">
            <button type="button" class="gl-btn glfx-btn" data-action="add"><i class="fa-solid fa-plus"></i> ${L("GLFX.rules.add")}</button>
            <button type="submit" class="gl-btn glfx-btn"><i class="fa-solid fa-check"></i> ${L("GLFX.look.save")}</button>
          </footer>
        </div>`;
    }

    _replaceHTML(result, content) {
      content.innerHTML = result;
    }

    _onRender() {
      this.element.addEventListener("input", (event) => {
        const box = event.target;
        if (box?.name?.endsWith("hueOn")) {
          const hue = this.element.elements.namedItem(box.name.replace(/hueOn$/, "hue"));
          if (hue) hue.disabled = !box.checked;
        }
      });
    }

    collect() {
      const form = this.element;
      this.base = readFields(form, "base.");
      this.rows = this.rows.map((_, i) => ({
        slug: String(form.elements.namedItem(`r${i}.slug`)?.value ?? "").trim(),
        look: readFields(form, `r${i}.`),
      }));
    }

    _onAdd() {
      this.collect();
      this.rows.push({ slug: "", look: normalizeLook(null) });
      this.render();
    }

    _onRemove(_event, target) {
      this.collect();
      this.rows.splice(Number(target.dataset.index), 1);
      this.render();
    }

    static async #save() {
      if (!game.user.isGM) return;
      this.collect();
      const out = {};
      if (!isEmptyLook(this.base)) out["*"] = this.base;
      for (const { slug, look } of this.rows) if (slug && slug !== "*" && !isEmptyLook(look)) out[slug] = look;
      await game.settings.set(SUITE_ID, SETTINGS.rules, out);
    }
  };
  return _rulesApp;
}

export function openLook(doc) {
  if (!doc || !mayEdit(doc)) return;
  const App = lookAppClass();
  new App(doc).render({ force: true });
}

/* ── where the button appears ────────────────────────────────────────── */

function lookableDoc(app) {
  const doc = app?.document ?? app?.object;
  if (!doc || !mayEdit(doc)) return null;
  if (doc.documentName === "Actor") return doc;
  if (doc.documentName === "Item" && LOOKABLE_ITEMS.has(doc.type)) return doc;
  return null;
}

/** Header buttons on item and actor sheets, ApplicationV2 and AppV1 alike. */
export function addLookControls(on) {
  on("getHeaderControlsApplicationV2", (app, controls) => {
    const doc = lookableDoc(app);
    if (!doc) return;
    controls.push({ icon: "fa-solid fa-wand-magic-sparkles", label: "GLFX.look.button", onClick: () => openLook(doc) });
  });
  const legacy = (app, buttons) => {
    const doc = lookableDoc(app);
    if (!doc) return;
    buttons.unshift({ class: "glfx-open", icon: "fa-solid fa-wand-magic-sparkles", label: L("GLFX.look.button"), onclick: () => openLook(doc) });
  };
  on("getActorSheetHeaderButtons", legacy);
  on("getItemSheetHeaderButtons", legacy);
}
