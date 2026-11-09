/**
 * Diorama — the Standee window: one actor's standee art, where the top of the
 * head and the soles of the feet are in that art, and how tall it stands.
 *
 *   art     the actor portrait by default (what every viewer's standee shows,
 *           view/snapshot.mjs tokenArtFor); a file picked here is the existing
 *           `dio.standee` override, which always wins.
 *   marks   two lines dragged over the art (`dio.artMarks`, fractions of its
 *           height, with the art they were made on). The standee is sized so
 *           the span between them is the creature's height and the feet line
 *           stands on the base (render/art.mjs composeCard). No marks: the
 *           whole art is the height, as it always was.
 *   height  centimetres (`dio.heightCm`), entered in cm or ft + in. Empty is
 *           automatic, from the creature's size (rules/creature.mjs). Saving
 *           clears the legacy `dio.height` flag, whose value it showed.
 *
 * Owners of the actor and GMs may edit; everyone else is refused. Opened from
 * the actor sheet's header and the Token HUD (view/token-hud.mjs), both
 * through `openStandeeConfig(actor)`.
 *
 * The ApplicationV2 subclass is built in a memoised factory and the view
 * modules it reads are imported on first open: nothing here touches `foundry`
 * at import, and the sheet hooks are wired only by `wireStandee()` (onInit).
 */

import { SUITE_ID, warn } from "../../../core/const.mjs";
import { FLAG_ART_MARKS, FLAG_CREATURE_HEIGHT, FLAG_HEIGHT_CM, FLAG_STANDEE } from "../constants.mjs";
import {
  CM_PER_FT, MIN_MARK_SPAN, artMarksOf, autoHeight, cmPerUnit, cmToFtIn, ftInToCm, heightCmOf, isMetric,
  legacyHeightOf, standeeMarks,
} from "../rules/creature.mjs";
import { el, t } from "./util.mjs";

const VIDEO_RE = /\.(webm|mp4|m4v|ogv|mov)(\?|#|$)/i;
/** Arrow-key nudge of a focused line, fraction of the art's height (Shift: coarse). */
const NUDGE = 0.004;
const NUDGE_COARSE = 0.02;

const leaf = (key) => key.split(".").pop();
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const round = (v, k) => Math.round(v * k) / k;

/** The scene units this client measures in (the viewed scene's), or "". */
const sceneUnits = () => globalThis.canvas?.scene?.grid?.units ?? globalThis.canvas?.grid?.units ?? "";

/** The token the actor stands as here, if any (its footprint decides an automatic height). */
function tokenOf(actor) {
  if (actor?.token) return actor.token;
  try { return actor?.getActiveTokens?.(false, true)?.[0] ?? null; } catch { return null; }
}

function fmtCm(cm) {
  return t("GLDIO.standee.height.fmtCm", { cm: Math.round(cm) });
}

function fmtFtIn(cm) {
  const v = cmToFtIn(cm);
  const inch = round(v.in, 10);
  return inch ? t("GLDIO.standee.height.fmtFtIn", { ft: v.ft, in: inch }) : t("GLDIO.standee.height.fmtFt", { ft: v.ft });
}

/** Delete a nested flag key in one update: v14's ForcedDeletion, else v13's "-=" key. */
function del(obj, key) {
  const D = globalThis._del ?? (globalThis.foundry?.data?.operators?.ForcedDeletion ? new foundry.data.operators.ForcedDeletion() : null);
  if (D) obj[key] = D;
  else obj[`-=${key}`] = null;
}

let _Class = null;
/** actor uuid → its open window */
const _open = new Map();
/** The view modules the window reads, imported on first open. */
let _mods = null;

function loadMods() {
  _mods ??= Promise.all([import("./snapshot.mjs"), import("../render/art.mjs")])
    .then(([snapshot, art]) => ({ snapshot, art }));
  return _mods;
}

function makeClass() {
  const { ApplicationV2 } = foundry.applications.api;

  return class DioramaStandeeApp extends ApplicationV2 {
    static DEFAULT_OPTIONS = {
      classes: ["gldio-standee", "gl-type"],
      tag: "div",
      window: { icon: "fa-solid fa-person", resizable: true },
      position: { width: 700, height: "auto" },
      actions: {
        browse: DioramaStandeeApp.#onBrowse,
        resetArt: DioramaStandeeApp.#onResetArt,
        resetMarks: DioramaStandeeApp.#onResetMarks,
        unit: DioramaStandeeApp.#onUnit,
        save: DioramaStandeeApp.#onSave,
        cancel: DioramaStandeeApp.#onCancel,
      },
    };

    /** @type {object} */
    actor;
    #mods;
    /** standee: override path | null; marks: {top, bottom} | null; cm: number | null; unit: "cm" | "ftin" */
    #s;
    /** The art's opaque top and bottom (the lines an unmarked standee is sized by). */
    #auto = { top: 0, bottom: 1 };
    #readable = true;
    #r = {};
    #drag = null;
    #loadId = 0;

    constructor(actor, mods, options = {}, synthetic = null) {
      super({ id: `gldio-standee-${String(actor.uuid).replace(/[^\w-]/g, "-")}`, ...options });
      this.actor = actor;
      /** The token's own actor this window was opened from, when it writes to the world actor instead. */
      this.synthetic = synthetic;
      this.#mods = mods;
      const units = sceneUnits();
      const legacy = legacyHeightOf(actor);
      const standee = mods.snapshot.standeeOf(actor);
      this.#s = {
        standee,
        marks: standeeMarks(artMarksOf(actor), this.#artFor(standee)),
        cm: heightCmOf(actor) ?? (legacy !== null ? round(legacy * cmPerUnit(units), 10) : null),
        unit: isMetric(units) ? "cm" : "ftin",
      };
    }

    get title() {
      return t("GLDIO.standee.title", { name: this.actor?.name ?? "" });
    }

    /** The art the standee draws for an observer with this override. */
    #artFor(standee) {
      const a = this.actor;
      return this.#mods.snapshot.tokenArtFor({
        standee, actorImg: a?.img ?? null, tokenImg: a?.prototypeToken?.texture?.src ?? null,
      });
    }

    get #art() { return this.#artFor(this.#s.standee); }

    /* ─────────────────────────── markup ─────────────────────────── */

    async _renderHTML() {
      const r = this.#r = {};
      const btn = (action, icon, label, extra = {}) => el("button", { type: "button", class: "gl-btn gldio-standee-btn", dataset: { action, ...extra } },
        [el("i", { class: icon }), el("span", { text: label })]);

      // the art, with the head and feet lines over it
      r.media = el("img", { class: "gldio-standee-media", alt: "", draggable: "false" });
      r.cut = el("div", { class: "gldio-standee-cut" });
      r.head = el("div", { class: "gldio-standee-room" });
      const line = (which) => el("div", {
        class: "gldio-standee-line", tabindex: "0", role: "slider", "aria-valuemin": "0", "aria-valuemax": "100",
        "aria-label": t(`GLDIO.standee.marks.${which}`), dataset: { line: which },
      }, [el("span", { class: "gldio-standee-tag", text: t(`GLDIO.standee.marks.${which}`) })]);
      r.top = line("top");
      r.bottom = line("bottom");
      r.span = el("div", { class: "gldio-standee-ruler" }, [el("span", { class: "gldio-standee-span" })]);
      r.frame = el("div", { class: "gldio-standee-frame" }, [r.media, r.head, r.cut, r.span, r.top, r.bottom]);
      r.tainted = el("p", { class: "gldio-standee-note", text: t("GLDIO.standee.art.tainted") });
      const stage = el("div", { class: "gldio-standee-stage" }, [r.frame]);

      // art
      r.artName = el("div", { class: "gldio-standee-path" });
      const art = el("section", { class: "gldio-standee-section" }, [
        el("h3", { class: "gldio-standee-headline", text: t("GLDIO.standee.art.head") }),
        r.artName,
        el("div", { class: "gldio-standee-row" }, [
          btn("browse", "fa-solid fa-folder-open", t("GLDIO.standee.art.browse")),
          r.resetArt = btn("resetArt", "fa-solid fa-rotate-left", t("GLDIO.standee.art.reset")),
        ]),
        el("p", { class: "gldio-standee-hint", text: t("GLDIO.standee.art.scope") }),
        r.tainted,
      ]);

      // height
      r.cmIn = el("input", { type: "number", min: "1", step: "1", inputmode: "decimal", name: "cm" });
      r.ftIn = el("input", { type: "number", min: "0", step: "1", inputmode: "numeric", name: "ft" });
      r.inIn = el("input", { type: "number", min: "0", max: "11.9", step: "0.5", inputmode: "decimal", name: "in" });
      r.cmBox = el("div", { class: "gldio-standee-num" }, [r.cmIn, el("span", { text: t("GLDIO.standee.height.cm") })]);
      r.ftBox = el("div", { class: "gldio-standee-num" }, [
        r.ftIn, el("span", { text: t("GLDIO.standee.height.ft") }), r.inIn, el("span", { text: t("GLDIO.standee.height.in") }),
      ]);
      r.unitCm = btn("unit", "fa-solid fa-ruler-vertical", t("GLDIO.standee.height.cm"), { unit: "cm" });
      r.unitFt = btn("unit", "fa-solid fa-ruler-vertical", t("GLDIO.standee.height.ftin"), { unit: "ftin" });
      r.convert = el("div", { class: "gldio-standee-out" });
      r.autoHint = el("p", { class: "gldio-standee-hint" });
      const height = el("section", { class: "gldio-standee-section" }, [
        el("h3", { class: "gldio-standee-headline", text: t("GLDIO.standee.height.head") }),
        el("div", { class: "gldio-standee-seg" }, [r.unitCm, r.unitFt]),
        el("label", { class: "gldio-standee-field" }, [el("span", { class: "gldio-standee-label", text: t("GLDIO.standee.height.label") }), r.cmBox, r.ftBox]),
        r.convert,
        r.autoHint,
      ]);

      // marks
      r.marksOut = el("div", { class: "gldio-standee-out" });
      const marks = el("section", { class: "gldio-standee-section" }, [
        el("h3", { class: "gldio-standee-headline", text: t("GLDIO.standee.marks.head") }),
        el("p", { class: "gldio-standee-hint", text: t("GLDIO.standee.marks.hint") }),
        r.marksOut,
        el("div", { class: "gldio-standee-row" }, [
          r.resetMarks = btn("resetMarks", "fa-solid fa-wand-magic-sparkles", t("GLDIO.standee.marks.reset")),
        ]),
      ]);

      const side = el("div", { class: "gldio-standee-side" }, [art, height, marks]);
      const foot = el("footer", { class: "gldio-standee-foot" }, [
        btn("cancel", "fa-solid fa-xmark", t("GLDIO.standee.cancel")),
        btn("save", "fa-solid fa-check", t("GLDIO.standee.save")),
      ]);
      foot.lastChild.classList.add("gldio-standee-save");
      return el("div", { class: "gldio-standee-body" }, [stage, side, foot]);
    }

    _replaceHTML(result, content) {
      content.replaceChildren(result);
    }

    async _onRender(context, options) {
      await super._onRender?.(context, options);
      this.#wire();
      this.#fillHeight();
      this.#loadArt();
      this.#sync();
    }

    _onClose(options) {
      super._onClose?.(options);
      if (_open.get(this.actor?.uuid) === this) _open.delete(this.actor.uuid);
    }

    /* ─────────────────────────── art ─────────────────────────── */

    /** Show the current art and find its opaque top and bottom (the auto lines). */
    #loadArt() {
      const r = this.#r;
      const src = this.#art;
      const id = ++this.#loadId;
      // A video shows its first frame; the img element cannot play one.
      if (VIDEO_RE.test(src) && r.media.tagName !== "VIDEO") {
        const v = el("video", { class: "gldio-standee-media", muted: true, playsinline: true, preload: "auto" });
        v.muted = true;
        r.media.replaceWith(v);
        r.media = v;
      } else if (!VIDEO_RE.test(src) && r.media.tagName !== "IMG") {
        const i = el("img", { class: "gldio-standee-media", alt: "", draggable: "false" });
        r.media.replaceWith(i);
        r.media = i;
      }
      r.media.src = src;
      r.artName.textContent = this.#s.standee ? src : t("GLDIO.standee.art.default");
      r.artName.title = src;
      this.#auto = { top: 0, bottom: 1 };
      this.#readable = true;
      this.#mods.art.loadDrawable(src).then((c) => {
        if (id !== this.#loadId) return;
        this.#readable = !!c;
        this.#auto = (c && this.#mods.art.artBounds(c)) ?? { top: 0, bottom: 1 };
        this.#sync();
      });
    }

    /* ─────────────────────────── state → DOM ─────────────────────────── */

    #lines() { return this.#s.marks ?? this.#auto; }

    #sync() {
      const r = this.#r, s = this.#s;
      if (!r.frame) return;
      const m = this.#lines();
      const pct = (v) => `${round(v * 100, 100)}%`;
      r.frame.dataset.auto = s.marks ? "0" : "1";
      r.top.style.top = pct(m.top);
      r.bottom.style.top = pct(m.bottom);
      r.top.setAttribute("aria-valuenow", String(round(m.top * 100, 10)));
      r.bottom.setAttribute("aria-valuenow", String(round(m.bottom * 100, 10)));
      r.head.style.height = pct(m.top);
      r.cut.style.top = pct(m.bottom);
      r.span.style.top = pct(m.top);
      r.span.style.height = pct(m.bottom - m.top);
      const cm = s.cm ?? this.#autoCm().cm;
      r.span.firstChild.textContent = s.unit === "cm" ? fmtCm(cm) : fmtFtIn(cm);
      r.marksOut.textContent = s.marks
        ? t("GLDIO.standee.marks.readout", { top: round(m.top * 100, 10), bottom: round(m.bottom * 100, 10) })
        : t("GLDIO.standee.marks.auto");
      r.resetMarks.disabled = !s.marks;
      r.resetArt.disabled = !s.standee;
      r.tainted.hidden = this.#readable;
      // height
      r.cmBox.hidden = s.unit !== "cm";
      r.ftBox.hidden = s.unit === "cm";
      r.unitCm.classList.toggle("is-on", s.unit === "cm");
      r.unitFt.classList.toggle("is-on", s.unit !== "cm");
      r.convert.textContent = s.cm ? t("GLDIO.standee.height.value", { cm: fmtCm(s.cm), ft: fmtFtIn(s.cm) }) : t("GLDIO.standee.height.empty");
      const a = this.#autoCm();
      r.autoHint.textContent = t("GLDIO.standee.height.auto", { ft: fmtFtIn(a.cm), cm: fmtCm(a.cm), size: t(`GLDIO.standee.size.${a.size}`) });
    }

    #autoCm() {
      const a = autoHeight(this.actor, tokenOf(this.actor));
      return { cm: a.ft * CM_PER_FT, size: a.size };
    }

    /** Write the stored height into the inputs of the current unit. */
    #fillHeight() {
      const r = this.#r, cm = this.#s.cm;
      if (!r.cmIn) return;
      r.cmIn.value = cm ? String(round(cm, 10)) : "";
      const v = cm ? cmToFtIn(cm) : null;
      r.ftIn.value = v ? String(v.ft) : "";
      r.inIn.value = v ? String(round(v.in, 10)) : "";
      const a = this.#autoCm();
      r.cmIn.placeholder = String(Math.round(a.cm));
      const av = cmToFtIn(a.cm);
      r.ftIn.placeholder = String(av.ft);
      r.inIn.placeholder = String(round(av.in, 10));
    }

    /** Read the height inputs: centimetres, or null for automatic. */
    #readHeight() {
      const r = this.#r;
      const num = (i) => (i.value.trim() === "" ? null : Number(i.value));
      if (this.#s.unit === "cm") {
        const v = num(r.cmIn);
        return v !== null && Number.isFinite(v) && v > 0 ? v : null;
      }
      const ft = num(r.ftIn), inch = num(r.inIn);
      if (ft === null && inch === null) return null;
      const cm = ftInToCm(ft ?? 0, inch ?? 0);
      return Number.isFinite(cm) && cm > 0 ? cm : null;
    }

    /* ─────────────────────────── input ─────────────────────────── */

    #wire() {
      const r = this.#r;
      for (const i of [r.cmIn, r.ftIn, r.inIn]) i.addEventListener("input", () => { this.#s.cm = this.#readHeight(); this.#sync(); });
      r.frame.addEventListener("pointerdown", (ev) => this.#dragStart(ev));
      r.frame.addEventListener("pointermove", (ev) => this.#dragMove(ev));
      for (const n of ["pointerup", "pointercancel", "lostpointercapture"]) r.frame.addEventListener(n, () => { this.#drag = null; });
      for (const ln of [r.top, r.bottom]) ln.addEventListener("keydown", (ev) => this.#nudge(ev, ln.dataset.line));
    }

    /** The pointer's height on the art, 0..1. */
    #at(ev) {
      const rect = this.#r.media.getBoundingClientRect();
      return rect.height > 0 ? clamp01((ev.clientY - rect.top) / rect.height) : 0;
    }

    #dragStart(ev) {
      if (ev.button !== 0) return;
      const f = this.#at(ev);
      const m = this.#lines();
      // a line under the pointer, else whichever line is nearer
      const which = ev.target.closest?.("[data-line]")?.dataset.line
        ?? (Math.abs(f - m.top) <= Math.abs(f - m.bottom) ? "top" : "bottom");
      this.#drag = which;
      try { this.#r.frame.setPointerCapture(ev.pointerId); } catch { /* not capturable */ }
      ev.preventDefault();
      this.#r[which].focus({ preventScroll: true });
      this.#place(which, f);
    }

    #dragMove(ev) {
      if (this.#drag) this.#place(this.#drag, this.#at(ev));
    }

    #nudge(ev, which) {
      const d = ev.key === "ArrowUp" ? -1 : ev.key === "ArrowDown" ? 1 : 0;
      if (!d) return;
      ev.preventDefault();
      const m = this.#lines();
      this.#place(which, m[which] + d * (ev.shiftKey ? NUDGE_COARSE : NUDGE));
    }

    /** Move one line, keeping the head above the feet by MIN_MARK_SPAN. Marks start from the auto lines. */
    #place(which, f) {
      const m = { ...this.#lines() };
      if (which === "top") m.top = Math.max(0, Math.min(f, m.bottom - MIN_MARK_SPAN));
      else m.bottom = Math.min(1, Math.max(f, m.top + MIN_MARK_SPAN));
      this.#s.marks = { top: round(m.top, 10000), bottom: round(m.bottom, 10000) };
      this.#sync();
    }

    /* ─────────────────────────── actions ─────────────────────────── */

    static #onBrowse() {
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
      if (!FP) return;
      new FP({
        type: "imagevideo",
        current: this.#s.standee ?? this.#art,
        callback: (path) => {
          if (!path || path === this.#s.standee) return;
          this.#s.standee = path;
          this.#s.marks = null; // lines on other art mean nothing here
          this.#loadArt();
          this.#sync();
        },
      }).render(true);
    }

    static #onResetArt() {
      if (!this.#s.standee) return;
      this.#s.standee = null;
      this.#s.marks = null;
      this.#loadArt();
      this.#sync();
    }

    static #onResetMarks() {
      this.#s.marks = null;
      this.#sync();
    }

    static #onUnit(_ev, target) {
      const unit = target?.dataset?.unit === "cm" ? "cm" : "ftin";
      if (unit === this.#s.unit) return;
      this.#s.cm = this.#readHeight();
      this.#s.unit = unit;
      this.#fillHeight();
      this.#sync();
    }

    static async #onSave() {
      const s = this.#s;
      s.cm = this.#readHeight();
      const dio = {};
      if (s.standee) dio[leaf(FLAG_STANDEE)] = s.standee; else del(dio, leaf(FLAG_STANDEE));
      if (s.marks) dio[leaf(FLAG_ART_MARKS)] = { top: s.marks.top, bottom: s.marks.bottom, src: this.#art };
      else del(dio, leaf(FLAG_ART_MARKS));
      if (s.cm) dio[leaf(FLAG_HEIGHT_CM)] = round(s.cm, 10); else del(dio, leaf(FLAG_HEIGHT_CM));
      // The legacy flag's value was shown (and is now saved) as centimetres.
      del(dio, leaf(FLAG_CREATURE_HEIGHT));
      try {
        await this.actor.update({ flags: { [SUITE_ID]: { dio } } });
        await clearTokenOverride(this.synthetic);
        this.close();
      } catch (e) {
        warn("diorama: saving the standee failed", e);
        ui.notifications?.error(t("GLDIO.standee.failed"));
      }
    }

    static #onCancel() {
      this.close();
    }
  };
}

/**
 * Open the Standee window for an actor (one per actor). Owners and GMs only.
 * @param {Actor} actor
 * @returns {Promise<object|null>} the window, or null when refused
 */
export async function openStandeeConfig(actor) {
  if (!actor) return null;
  if (!(game.user?.isGM || actor.isOwner)) {
    ui.notifications?.warn(t("GLDIO.standee.denied"));
    return null;
  }
  // A token's own actor (an unlinked token's sheet, the Token HUD) edits the
  // world actor behind it when this user may, so every token of it, placed or
  // dragged out later, stands the same art.
  const { target, synthetic } = standeeTarget(actor);
  const open = _open.get(target.uuid);
  if (open) { open.render({ force: true }); open.bringToFront?.(); return open; }
  const mods = await loadMods();
  _Class ??= makeClass();
  const app = new _Class(target, mods, {}, synthetic);
  _open.set(target.uuid, app);
  app.render({ force: true });
  return app;
}

/**
 * Where a standee is stored: on the world actor, which every token of it reads
 * (an unlinked token's flags fall through to its world actor). A token's own
 * actor is used only when this user may not edit the world one (a player who
 * owns this token and not the actor). Pure but for the documents it is handed.
 * @param {Actor} actor
 * @returns {{target: Actor, synthetic: Actor|null}}
 */
export function standeeTarget(actor) {
  if (!actor?.isToken) return { target: actor, synthetic: null };
  const base = actor.token?.baseActor ?? globalThis.game?.actors?.get?.(actor.id) ?? null;
  const may = base && (globalThis.game?.user?.isGM || base.isOwner);
  return may ? { target: base, synthetic: actor } : { target: actor, synthetic: null };
}

/**
 * A token whose own actor carried an older standee (saved from its Token HUD)
 * would shadow the world actor's: that override is dropped once the world
 * actor is saved, so the token stands what the actor says.
 */
async function clearTokenOverride(synthetic) {
  const delta = synthetic?.token?.delta;
  if (!delta?.flags?.[SUITE_ID]?.dio) return;
  try {
    await delta.update({ [`flags.${SUITE_ID}.-=dio`]: null });
  } catch (e) {
    warn("diorama: could not clear the token's own standee", e);
  }
}

/** Owners and GMs see the header entry. */
const mayEdit = (actor) => !!actor && (!!game.user?.isGM || !!actor.isOwner);

/** v14 ApplicationV2 actor sheets: a header control. */
function onHeaderControls(app, controls) {
  const actor = app?.document ?? app?.actor;
  if (!mayEdit(actor) || !Array.isArray(controls) || controls.some((c) => c?.action === "gldioStandee")) return;
  controls.push({
    action: "gldioStandee",
    icon: "fa-solid fa-person",
    label: "GLDIO.standee.header",
    visible: true,
    onClick: () => openStandeeConfig(actor),
  });
}

/** AppV1 actor sheets (PF2e 8.x): a header button. */
function onHeaderButtons(app, buttons) {
  const actor = app?.actor ?? app?.document ?? app?.object;
  if (!mayEdit(actor) || !Array.isArray(buttons) || buttons.some((b) => b?.class === "gldio-standee-open")) return;
  buttons.unshift({
    label: t("GLDIO.standee.header"),
    class: "gldio-standee-open",
    icon: "fa-solid fa-person",
    onclick: () => openStandeeConfig(actor),
  });
}

let _wired = false;

/** Called from onInit: the actor sheet header entries. */
export function wireStandee() {
  if (_wired) return;
  _wired = true;
  Hooks.on("getHeaderControlsActorSheetV2", onHeaderControls);
  Hooks.on("getActorSheetHeaderButtons", onHeaderButtons);
}
