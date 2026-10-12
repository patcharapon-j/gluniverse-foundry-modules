/**
 * Stage — the comms overlay: characters calling in from off stage.
 *
 * A stack of portrait cards on one screen edge, like a radio or hologram
 * call-in in a game HUD. The table plays by voice, so a card carries no
 * dialogue: a face, a name, an epithet if the GM gave one, and an unmistakable
 * "this one is talking now" state. Three looks share one DOM (`holo`, `radio`,
 * `clean`); the stylesheet (`styles/stage-comms.css`) decides which parts each
 * one draws, so a style change is a data attribute and applies live.
 *
 * Pure DOM: no `game`, `foundry`, `canvas`, `ui` or `Hooks`, so the preview
 * page (`tools/stage-comms-preview.mjs`) drives this exact module.
 *
 * Every animation is CSS on the motion tokens, so the motion tier reaches all
 * of it. The two JS timers (an entrance's class, a leaving card's removal)
 * shadow CSS durations and go through `scaledMs` for that reason.
 *
 * Layering rule worth knowing before you touch the markup: the clean card's
 * blur is a `backdrop-filter` on `.glstage-comms-glass`, and an ancestor with
 * opacity, filter, clip-path or a mask becomes its backdrop root — the glass
 * then blurs nothing and pops sharp when the animation ends. So the card and
 * body only ever move (transform); fades and wipes are applied to the
 * children, never to an ancestor of the glass, in the clean style.
 */

import { coverPlacement, cropFor, viewBoxStyle } from "../../../core/face-frame-math.mjs";
import { scaledMs } from "../../../core/theme.mjs";

/**
 * The face-frame preset a comms portrait is cropped to: a square window with
 * head and shoulders, the head about a third of the frame — a call window, not
 * a face-filling avatar. The host passes `img => frameImage(img, COMMS_FACE_PRESET)`.
 */
export const COMMS_FACE_PRESET = "token-square";

/** Waveform bars per card; each style shows as many of them as it wants. */
const BARS = 16;
/** Signal-strength steps on the radio meter. */
const SIGNAL_STEPS = 5;

/**
 * Baselines (ms, before the motion tier) of the CSS the timers shadow:
 * the slot opening plus the longest staggered entrance, and the exit plus the
 * slot collapsing behind it. Kept a little long — removing a class or a node
 * after the animation has resolved is harmless; before it, it snaps.
 */
const ENTER_MS = 1500;
const LEAVE_MS = 1100;
/** Most staggered entrances counted into ENTER_MS. */
const STAGGER_SLOTS = 6;
const STAGGER_MS = 90;

/**
 * Density. The stack shrinks its cards to fit the screen; past a point a
 * portrait card is too small to read, and each call becomes a strip instead
 * (portrait on the screen edge, name beside it). CSS cannot compare computed
 * lengths to switch a layout, so the decision is made here — from the same
 * numbers the stylesheet fits with. Keep these equal to stage-comms.css:
 * --glstage-comms-margin (8vh), --glstage-comms-gap (14px), and each style's
 * --glstage-comms-k.
 */
const FIT_MARGIN = 0.08;
const FIT_GAP = 14;
const STYLE_K = Object.freeze({ holo: 1.3, radio: 1.42, clean: 1.08 });
/** A full card narrower than this share of its set width (capped) goes compact. */
const COMPACT_BELOW = 0.82;
const COMPACT_CAP = 168;

const VIEW_BOX = globalThis.CSS?.supports?.("object-view-box", "inset(0% 0% 0% 0%)") ?? false;

const defaultT = (key) => String(key).split(".").pop();

function el(tag, cls, parent = null) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (parent) parent.append(node);
  return node;
}

/** Deterministic 0..1 per bar, so every client draws the same waveform. */
const seed = (i, k) => {
  const s = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const castMap = (cast) => {
  if (cast instanceof Map) return cast;
  const list = Array.isArray(cast) ? cast : cast && typeof cast === "object" ? Object.values(cast) : [];
  return new Map(list.filter((m) => m && m.id).map((m) => [m.id, m]));
};

const TINT_RE = /^#[0-9a-f]{6}$/i;

export class CommsOverlay {
  /** @type {Map<string, object>} callId → slot entry */
  #slots = new Map();
  #frame;
  #t;
  #shown = false;
  #destroyed = false;
  #count = 0;
  #width = 188;
  #onResize = () => this.#density();

  /**
   * @param {HTMLElement} parent
   * @param {{ frame?: (img: HTMLImageElement) => void, t?: (key: string) => string }} [opts]
   */
  constructor(parent, { frame = null, t = null } = {}) {
    this.#frame = typeof frame === "function" ? frame : null;
    this.#t = typeof t === "function" ? t : defaultT;
    this.root = el("div", "glstage-comms gl-type is-hidden");
    this.root.setAttribute("aria-hidden", "true");
    this.root.dataset.edge = "right";
    this.root.dataset.align = "center";
    this.root.dataset.style = "holo";
    this.stack = el("div", "glstage-comms-stack", this.root);
    parent.append(this.root);
    this.root.ownerDocument.defaultView?.addEventListener("resize", this.#onResize);
  }

  /**
   * @param {{ comms: {visible:boolean, calls:{callId:string, castId:string}[], speaking:string|null},
   *           layout: {edge:string, align:string, style:string, width:number, inset:number, shift:number},
   *           cast: object[]|Map<string, object> }} data
   */
  update({ comms, layout, cast } = {}) {
    if (this.#destroyed) return;
    this.#applyLayout(layout);

    const members = castMap(cast);
    const calls = (Array.isArray(comms?.calls) ? comms.calls : []).filter((c) => c?.callId && members.has(c.castId));
    const visible = !!comms?.visible && calls.length > 0;
    const wanted = new Set(calls.map((c) => c.callId));
    const revealing = visible && !this.#shown;
    const hiding = !visible && this.#shown;

    // Gone: animate out (or drop at once while the stack is hidden).
    for (const entry of this.#slots.values()) {
      if (wanted.has(entry.callId) || entry.leaving) continue;
      if (visible) this.#leave(entry);
      else this.#drop(entry);
    }

    // Present: create, revive or refresh, in call order.
    const fresh = [];
    const revived = [];
    calls.forEach((call, i) => {
      let entry = this.#slots.get(call.callId);
      if (entry?.leaving) revived.push(entry);
      if (!entry) {
        entry = this.#create(call);
        this.#slots.set(call.callId, entry);
        if (visible && !revealing) fresh.push(entry);
        else entry.slot.classList.add("is-quiet");
      }
      this.#fill(entry, members.get(call.castId), i);
    });
    this.#order(calls);
    for (const entry of revived) this.#revive(entry);
    fresh.forEach((entry, i) => this.#enter(entry, i, true));

    // Shown / hidden: every card plays its own entrance or exit, staggered.
    if (revealing) {
      let i = 0;
      for (const call of calls) this.#enter(this.#slots.get(call.callId), i++);
    }
    if (hiding) {
      for (const entry of this.#slots.values()) entry.slot.classList.remove("is-entering");
    }
    this.root.classList.toggle("is-hidden", !visible);
    this.#shown = visible;

    // Who is talking.
    const speaking = visible && comms?.speaking && wanted.has(comms.speaking) ? comms.speaking : null;
    if (speaking) this.root.dataset.speaking = "1";
    else delete this.root.dataset.speaking;
    for (const entry of this.#slots.values()) {
      entry.slot.classList.toggle("is-speaking", !entry.leaving && entry.callId === speaking);
    }
    this.#count = calls.length;
    this.root.style.setProperty("--glstage-comms-n", String(Math.max(1, calls.length)));
    this.#density();
  }

  destroy() {
    this.#destroyed = true;
    this.root.ownerDocument.defaultView?.removeEventListener("resize", this.#onResize);
    for (const entry of this.#slots.values()) clearTimeout(entry.timer);
    this.#slots.clear();
    this.root.remove();
  }

  /* ── layout ──────────────────────────────────────────────────────── */

  #applyLayout(layout) {
    const L = layout && typeof layout === "object" ? layout : {};
    const pick = (v, list, d) => (list.includes(v) ? v : d);
    const num = (v, lo, hi, d) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    const r = this.root;
    r.dataset.edge = pick(L.edge, ["right", "left"], "right");
    r.dataset.align = pick(L.align, ["top", "center", "bottom"], "center");
    r.dataset.style = pick(L.style, ["holo", "radio", "clean"], "holo");
    this.#width = num(L.width, 120, 320, 188);
    r.style.setProperty("--glstage-comms-width", String(this.#width));
    r.style.setProperty("--glstage-comms-inset", `${num(L.inset, 0, 240, 20)}px`);
    r.style.setProperty("--glstage-comms-shift", String(num(L.shift, -40, 40, 0)));
  }

  /** Full portrait cards, or compact strips when full ones would not read. */
  #density() {
    const n = Math.max(1, this.#count);
    const h = this.root.clientHeight || this.root.ownerDocument.defaultView?.innerHeight || 0;
    const k = STYLE_K[this.root.dataset.style] ?? STYLE_K.holo;
    const fit = (h * (1 - 2 * FIT_MARGIN) - n * FIT_GAP) / (n * k);
    const compact = h > 0 && fit < Math.min(this.#width, COMPACT_CAP) * COMPACT_BELOW;
    this.root.dataset.density = compact ? "compact" : "full";
  }

  /* ── one card ────────────────────────────────────────────────────── */

  #create(call) {
    const slot = el("div", "glstage-comms-slot");
    slot.dataset.callId = call.callId;
    const hold = el("div", "glstage-comms-hold", slot);
    const card = el("div", "glstage-comms-card", hold);
    const body = el("div", "glstage-comms-body", card);
    el("div", "glstage-comms-glass", body);

    // Radio header: transmit lamp, label, channel.
    const head = el("div", "glstage-comms-head", body);
    el("span", "glstage-comms-lamp", head);
    el("span", "glstage-comms-tx", head).textContent = this.#t("GLSTAGE.comms.transmit");
    el("span", "glstage-comms-rule", head);
    const channel = el("span", "glstage-comms-chan", head);

    // The picture window and everything laid over it.
    const win = el("div", "glstage-comms-window", body);
    const art = el("div", "glstage-comms-art", win);
    const img = el("img", "glstage-comms-img", art);
    img.alt = "";
    img.draggable = false;
    for (const part of ["tone", "noise", "lines", "scan", "flash", "vignette"]) el("div", `glstage-comms-${part}`, win);
    for (const c of ["tl", "tr", "bl", "br"]) el("span", "glstage-comms-corner", win).dataset.c = c;
    const live = el("span", "glstage-comms-live", win);
    el("i", "glstage-comms-live-dot", live);
    el("span", "glstage-comms-live-text", live).textContent = this.#t("GLSTAGE.comms.live");

    // Holo emitter under the window.
    el("div", "glstage-comms-base", body);

    // Name plate, waveform, signal meter.
    const plate = el("div", "glstage-comms-plate", body);
    const id = el("div", "glstage-comms-id", plate);
    const name = el("span", "glstage-comms-name", id);
    const title = el("span", "glstage-comms-title", id);
    const wave = el("div", "glstage-comms-wave", plate);
    for (let i = 0; i < BARS; i++) {
      const bar = el("i", "", wave);
      const bell = Math.sin(Math.PI * (i + 0.5) / BARS);
      bar.style.setProperty("--glstage-comms-e", (0.35 + 0.65 * bell * (0.7 + 0.3 * seed(i, 3))).toFixed(3));
      bar.style.setProperty("--glstage-comms-k", (0.42 + 0.5 * seed(i, 1)).toFixed(3));
      bar.style.setProperty("--glstage-comms-o", (seed(i, 2)).toFixed(3));
    }
    const signal = el("div", "glstage-comms-signal", plate);
    for (let i = 0; i < SIGNAL_STEPS; i++) el("i", "", signal).style.setProperty("--glstage-comms-s", String(i));

    img.addEventListener("load", () => this.#placeArt(entry));
    img.addEventListener("error", () => slot.classList.add("is-artless"));

    const entry = { callId: call.callId, slot, card, img, name, title, channel, member: null, artKey: null, leaving: false, timer: 0 };
    return entry;
  }

  #fill(entry, member, index) {
    entry.member = member;
    const name = String(member.name ?? "");
    const title = String(member.title ?? "");
    if (entry.name.textContent !== name) entry.name.textContent = name;
    if (entry.title.textContent !== title) entry.title.textContent = title;
    entry.title.hidden = !title;
    entry.slot.classList.toggle("has-title", !!title);
    entry.channel.textContent = `${this.#t("GLSTAGE.comms.channel")} ${String(index + 1).padStart(2, "0")}`;
    const tint = typeof member.tint === "string" && TINT_RE.test(member.tint) ? member.tint : "";
    if (tint) entry.card.style.setProperty("--glstage-comms-tint", tint);
    else entry.card.style.removeProperty("--glstage-comms-tint");

    const src = String(member.image ?? "");
    const face = member.face && Number.isFinite(member.face.x) && Number.isFinite(member.face.y) ? member.face : null;
    const key = `${src}|${face ? `${face.x},${face.y},${face.h}` : this.#frame ? "auto" : "none"}`;
    if (key === entry.artKey) return;
    entry.artKey = key;
    entry.slot.classList.remove("is-artless");
    const img = entry.img;
    for (const p of ["objectViewBox", "objectPosition", "objectFit"]) img.style[p] = "";
    delete img.dataset.glFaceSrc;
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    if (!src) { entry.slot.classList.add("is-artless"); return; }
    if (img.complete && img.naturalWidth) this.#placeArt(entry);
  }

  /**
   * Crop the portrait on the head. A head the GM placed by hand wins; then
   * the host's face locator; otherwise the stylesheet's top-centred cover.
   */
  #placeArt(entry) {
    const { img, member } = entry;
    if (!member) return;
    const face = member.face;
    if (face && Number.isFinite(face.x) && Number.isFinite(face.y)) {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (!(w > 0 && h > 0)) return;
      const fh = Number.isFinite(face.h) ? face.h : 0.16;
      const fw = Math.min(1, (fh * h) / w);
      const crop = cropFor({ k: "s", w, h, b: [face.x - fw / 2, face.y - fh / 2, fw, fh] }, COMMS_FACE_PRESET);
      if (!crop) return;
      if (VIEW_BOX) {
        Object.assign(img.style, viewBoxStyle(crop, w, h));
        img.style.objectPosition = "50% 50%";
      } else {
        const { x, y } = coverPlacement(crop, w, h, 1, 1, { zoom: false });
        img.style.objectFit = "cover";
        img.style.objectPosition = `${x}% ${y}%`;
      }
      return;
    }
    if (this.#frame && img.dataset.glFaceSrc !== img.getAttribute("src")) {
      try { this.#frame(img); } catch { /* the stylesheet framing stands */ }
    }
  }

  /* ── arrival and departure ───────────────────────────────────────── */

  /** @param {boolean} [opening] a new slot: open its row in the stack first. */
  #enter(entry, order, opening = false) {
    if (!entry) return;
    const { slot } = entry;
    clearTimeout(entry.timer);
    slot.classList.remove("is-quiet", "is-entering");
    slot.style.setProperty("--glstage-comms-i", String(order));
    slot.classList.toggle("is-opening", opening);
    if (opening) slot.classList.add("is-collapsed");
    void slot.offsetHeight; // restart: the entrance must see its own first frame
    slot.classList.add("is-entering");
    slot.classList.remove("is-collapsed");
    const stagger = Math.min(order, STAGGER_SLOTS) * STAGGER_MS;
    entry.timer = setTimeout(() => slot.classList.remove("is-entering", "is-opening"), scaledMs(ENTER_MS + stagger, this.root));
  }

  #leave(entry) {
    entry.leaving = true;
    clearTimeout(entry.timer);
    entry.slot.classList.remove("is-entering", "is-speaking");
    entry.slot.classList.add("is-leaving");
    entry.timer = setTimeout(() => this.#drop(entry), scaledMs(LEAVE_MS, this.root));
  }

  #revive(entry) {
    entry.leaving = false;
    clearTimeout(entry.timer);
    entry.slot.classList.remove("is-leaving");
    this.#enter(entry, 0, false);
  }

  #drop(entry) {
    clearTimeout(entry.timer);
    entry.slot.remove();
    if (this.#slots.get(entry.callId) === entry) this.#slots.delete(entry.callId);
  }

  /**
   * Put the live slots in call order. Only moves what is out of place: moving
   * a node restarts every animation inside it. A leaving slot stays where it
   * was, so it closes in place.
   */
  #order(calls) {
    let prev = null;
    for (const call of calls) {
      const slot = this.#slots.get(call.callId)?.slot;
      if (!slot) continue;
      let expected = prev ? prev.nextElementSibling : this.stack.firstElementChild;
      while (expected && expected !== slot && expected.classList.contains("is-leaving")) expected = expected.nextElementSibling;
      if (expected !== slot) {
        if (prev) prev.after(slot);
        else this.stack.prepend(slot);
      }
      prev = slot;
    }
  }
}
