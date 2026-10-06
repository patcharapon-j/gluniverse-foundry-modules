/**
 * Combat Intro — the director: one sequence, on one screen, on one clock.
 *
 * Everything on screen is a function of server time. The phase clock is
 * `serverNow - state.at` (timeline.mjs), each die's tumble is
 * `serverNow - slot.throw.at`, and the DOM beats are anime.js timelines built
 * with `autoplay: false` and SOUGHT from that clock every frame — never played,
 * so a late client, a background tab coming back and a preview seek all land
 * on the same frame as everyone else, and nothing touches the shared engine.
 *
 * Pure: no game/canvas/foundry/ui/Hooks. main.mjs injects the Foundry half
 * (clocks, intents, the DSN host); the preview injects a three.js stand-in.
 *
 * Frame order matters for layout cost: every timeline seek (writes) first,
 * then every anchor rect (one forced layout), then text and data-* writes.
 */
import { createTimeline } from "../../core/motion.mjs";
import { createTumble, idlePose } from "../spotlight-roll/tumble.mjs";
import { INTRO, ROLL, SORT, HANDOFF, INTRO_MS, beatAt, beatStart, phaseClock } from "./timeline.mjs";
import { SEVERITIES } from "./constants.mjs";
import { npcGroups } from "./state-model.mjs";
import { MAX_ANCHORS } from "./backdrop.mjs";
import { SKIN_MODULES } from "./skins/index.mjs";

/** This feature's own sheddable extras, most expensive first: the cards' backdrop blur, the sort's comet trails. */
export const OWN_SHED = Object.freeze(["cardBlur", "trails"]);

/** The ladder order for one skin: own extras, the skin's, and the whole WebGL backdrop last. */
export function shedOrderFor(skin) {
  return Object.freeze([...new Set([...OWN_SHED, ...(skin?.SHED_ORDER ?? [])]), "backdrop"]);
}

/** The feature's ladder: own extras, every skin's names (deduped), "backdrop" last. */
export const SHED_ORDER = Object.freeze([...new Set([...OWN_SHED, ...Object.values(SKIN_MODULES).flatMap((s) => s?.SHED_ORDER ?? [])]), "backdrop"]);

/** The die fits the roll phase's tumble beat exactly: flight + settle = ROLL.tumble. */
export const TUMBLE_PARAMS = Object.freeze({
  duration: (ROLL.tumble / 1000) * 0.8,
  settle: (ROLL.tumble / 1000) * 0.2,
  spinPeak: 17, spinCross: 6, arrival: 2.4, rockHz: 2.8, rockDecay: 12, lift: 0.3, liftScale: 0.12,
});

const PHASE_INDEX = { intro: 0, rolling: 1, sorting: 2, handoff: 3 };
/** A beat crossed longer ago than this is a late join, not a cue: it is marked silently. */
const CUE_WINDOW_MS = 400;
const DAY_S = 86400;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const outCubic = (t) => 1 - (1 - t) ** 3;
const outBack = (t, s = 1.6) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2;
const toHex = (c) => "#" + (c ?? [1, 1, 1]).map((x) => Math.round(clamp01(x) * 255).toString(16).padStart(2, "0")).join("");
const idleSec = (serverMs) => (serverMs / 1000) % DAY_S;

export class Director {
  /** @param {object} o  see docs/COMBAT_INTRO.md › Director */
  constructor(o) {
    Object.assign(this, {
      backdrop: null, ladder: null, sound: null, motion: 1, railRect: () => null,
      now: () => performance.now(), serverNow: () => Date.now(),
      viewer: { userId: null, isGM: false, role: "spectator" }, mayAct: () => false,
      onIntent: () => {}, onGm: () => {}, palette: () => ({}), cssOnly: false,
    }, o);
    this.state = null;
    this.refs = null;
    this.results = new Map();
    this.totals = new Map();
    this.local = new Map();       // slotId → { die, tumble, key, label, chargeAt }
    this.written = new Map();     // cache of text / attribute writes
    this.cued = new Set();
    this.frozen = null;
    this.timelines = {};
    this.destroyed = false;
  }

  /* ── lifecycle ─────────────────────────────────────────────────────── */

  /** Build the DOM for `state.skin`, compile its backdrop if needed, create every die. */
  async mount(state) {
    this._teardown();
    this.destroyed = false;
    this.state = state;
    this.skinModule = SKIN_MODULES[state.skin] ?? this.skin ?? SKIN_MODULES.etched;
    const r = this.root.dataset;
    r.skin = state.skin;
    r.phase = state.phase;
    r.role = this.viewer?.role ?? "spectator";
    if (state.late) r.late = "1"; else delete r.late;
    this.root.style.setProperty("--glci-motion", String(this.motion ?? 1));
    this.pal = this.palette?.() ?? {};
    if (this.backdrop && this.backdrop.skin !== this.skinModule && this.backdrop.gl) {
      await this.backdrop.compile(this.skinModule);
    }
    this.refs = this.overlay.build({ layers: this.layers, state, i18n: this.i18n, viewer: this.viewer, mayAct: this.mayAct });
    this._wire();
    const shown = this._shown();
    const rows = await this.dice.createDice(shown.map((s) => [{ faces: 20, userId: s.appearanceUserId, actorUuid: s.actorUuid, small: s.kind === "npc" }]));
    if (this.destroyed || this.state !== state) { this.dice.clear?.(); return this; }
    shown.forEach((s, i) => this.local.set(s.id, { die: rows[i]?.[0] ?? null, tumble: null, key: null, label: null, chargeAt: null }));
    this.timelines.intro = state.late ? null : this._introTimeline();
    this.timelines.deal = this._dealTimeline();
    this.mounted = true;
    return this;
  }

  /** A new flag value. `totals` (slotId → number) arrives once the GM has committed. */
  setState(state, { totals = null } = {}) {
    if (!state) return null;
    if (totals) for (const [k, v] of totals) this.totals.set(k, v);
    const prev = this.state;
    const known = new Set(this.local.keys());
    const need = state.slots.some((s) => !known.has(s.id));
    if (!prev || prev.id !== state.id || prev.skin !== state.skin || prev.late !== state.late || need) {
      const keep = { results: this.results, totals: this.totals };
      return this.mount(state).then((d) => { this.results = keep.results; this.totals = keep.totals; return d; });
    }
    this.state = state;
    if (prev.phase !== state.phase) {
      if (state.phase !== "sorting" && state.phase !== "handoff") this._dropTimeline("sort");
      if (state.phase !== "handoff") this._dropTimeline("handoff");
    } else if (state.phase === "sorting" && String(prev.order) !== String(state.order)) this._dropTimeline("sort");
    this.overlay.sync(this.refs, { state, i18n: this.i18n, viewer: this.viewer, mayAct: this.mayAct });
    return null;
  }

  /** A normalized result, full or sealed. `localAt` is when this client heard the cue. */
  applyResult(result, localAt = this.now()) {
    if (!result?.slotId) return;
    const prev = this.results.get(result.slotId);
    if (prev && !prev.sealed && result.sealed) return;   // never downgrade a full result
    this.results.set(result.slotId, { ...result, localAt });
  }

  /** The palette changed (a retheme, a skin switch on the same root). */
  refreshPalette() { this.pal = this.palette?.() ?? {}; }

  /** Freeze the sequence `ms` into its current phase (preview, headless frames). */
  seek(ms) { this.frozen = Math.max(0, Number(ms) || 0); }
  play() { this.frozen = null; }

  /** Where each card ended after the collapse, for the rail's arrival. */
  handoffRects() {
    const plan = this._handoffPlan ?? this._planHandoff(this._order());
    return plan.map((p) => ({ combatantId: p.combatantId, rect: { ...p.rect } }));
  }

  destroy() {
    this._teardown();
    this.destroyed = true;
    for (const k of ["back", "front", "gm"]) this.layers[k]?.replaceChildren();
    for (const k of ["phase", "beat", "render", "late", "lite"]) delete this.root.dataset[k];
  }

  _teardown() {
    for (const k of Object.keys(this.timelines)) this._dropTimeline(k);
    this._unwire?.();
    this._unwire = null;
    this.dice?.clear?.();
    this.local.clear();
    this.written.clear();
    this.cued.clear();
    this.refs = null;
    this.mounted = false;
    this._handoffPlan = null;
    this._sortPlan = null;
  }

  _dropTimeline(k) {
    try { this.timelines[k]?.revert?.(); } catch { /* already gone */ }
    this.timelines[k] = null;
    if (k === "sort") { this._sortPlan = null; this.refs?.sort?.replaceChildren(); }
    if (k === "handoff") this._handoffPlan = null;
  }

  /* ── input ─────────────────────────────────────────────────────────── */

  _wire() {
    const onClick = (e) => {
      const el = e.target?.closest?.("button");
      if (!el || !this.root.contains(el) || el.disabled) return;
      const st = this.state;
      const card = el.closest(".glci-card");
      const volley = el.closest(".glci-volley");
      const slotId = card?.dataset.slot ?? null;
      if (el.dataset.gm) {
        const a = el.dataset.gm;
        if (a === "rollFor" || a === "lock") this.onGm(a, { slotId });
        else if (a === "volley") this.onGm("volley", { group: el.dataset.group });
        else this.onGm(a, {});
        return;
      }
      if (el.dataset.stat) {
        const statistic = el.dataset.stat;
        for (const c of (el.closest(".glci-card-controls") ?? el.parentElement).querySelectorAll(".glci-chip[data-stat]")) c.setAttribute("aria-pressed", c.dataset.stat === statistic ? "true" : "false");
        el.closest("details")?.removeAttribute("open");
        const ids = card ? [slotId] : (volley?.dataset.slots ?? "").split(" ").filter(Boolean);
        for (const id of ids) this.onIntent({ op: "stat", seqId: st.id, slotId: id, statistic });
        return;
      }
      if (el.dataset.mod && slotId) {
        const on = el.getAttribute("aria-pressed") !== "true";
        el.setAttribute("aria-pressed", on ? "true" : "false");
        this.onIntent({ op: "toggle", seqId: st.id, slotId, slug: el.dataset.mod, on });
        return;
      }
      if (el.dataset.action === "throw" && slotId) {
        const l = this.local.get(slotId);
        if (l && l.chargeAt == null) l.chargeAt = this.now();
        this.onIntent({ op: "throw", seqId: st.id, slotId });
      }
    };
    this.root.addEventListener("click", onClick);
    this._unwire = () => this.root.removeEventListener("click", onClick);
  }

  /* ── what is on screen ─────────────────────────────────────────────── */

  _shown() {
    const st = this.state;
    if (!st) return [];
    // A late sequence holds only its reinforcements, so every slot is shown.
    const list = st.slots;
    // Party first, then hostiles in volley order: the anchor order the backdrop sees.
    const pcs = list.filter((s) => s.kind === "pc");
    const byId = new Map(list.map((s) => [s.id, s]));
    const npcs = npcGroups(list).flatMap((g) => g.slotIds.map((id) => byId.get(id)));
    return [...pcs, ...npcs];
  }

  _order() {
    const shown = this._shown().map((s) => s.id);
    const order = (this.state?.order ?? []).filter((id) => shown.includes(id));
    for (const id of shown) if (!order.includes(id)) order.push(id);
    return order;
  }

  _throwAt(slot) {
    const at = slot.throw?.at ?? this.results.get(slot.id)?.at;
    return Number.isFinite(at) ? at : null;
  }

  _serverTime() {
    return this.frozen != null ? (Number(this.state?.at) || 0) + this.frozen : this.serverNow();
  }

  _allows(name) { return this.ladder ? this.ladder.allows(name) : true; }

  /* ── the DOM beats ─────────────────────────────────────────────────── */

  _introTimeline() {
    const el = this.refs.intro;
    if (!el) return null;
    const q = (s) => [...el.querySelectorAll(s)];
    const tl = createTimeline({ autoplay: false, defaults: { ease: "outQuart" } });
    const at = (name) => beatStart(INTRO, name);
    const eyebrow = q(".glci-intro-eyebrow"), title = q(".glci-intro-title"), motto = q(".glci-intro-motto");
    const party = q('.glci-roster-side[data-side="party"]'), hostiles = q('.glci-roster-side[data-side="hostiles"]');
    const items = q(".glci-roster-item"), versus = q(".glci-intro-versus"), threat = q(".glci-threat");
    tl.set(el, { opacity: 1, translateY: 0 }, 0)
      .set(eyebrow, { clipPath: "inset(0% 100% 0% 0%)" }, 0)
      .set([...title, ...motto, ...versus, ...items], { opacity: 0 }, 0)
      .set(party, { translateX: -140, opacity: 0 }, 0)
      .set(hostiles, { translateX: 140, opacity: 0 }, 0)
      .set(threat, { clipPath: "inset(0% 50% 0% 50%)" }, 0);
    // boot: the eyebrow is drafted in as the grid finishes
    tl.add(eyebrow, { clipPath: ["inset(0% 100% 0% 0%)", "inset(0% 0% 0% 0%)"], duration: 420, ease: "outQuart" }, at("boot") + 260);
    // roster: both sides slide in, then portrait by portrait
    const r0 = at("roster");
    tl.add(party, { translateX: [-140, 0], opacity: [0, 1], duration: 720, ease: "outExpo" }, r0)
      .add(hostiles, { translateX: [140, 0], opacity: [0, 1], duration: 720, ease: "outExpo" }, r0 + 90);
    const step = Math.min(110, 1050 / Math.max(1, items.length));
    items.forEach((it, i) => tl.add(it, { opacity: [0, 1], translateY: [26, 0], scale: [0.9, 1], duration: 420, ease: "outBack(1.4)" }, r0 + 180 + i * step));
    tl.add(versus, { opacity: [0, 1], scale: [2.6, 1], duration: 520, ease: "outExpo" }, r0 + 1050);
    // title: the strike
    const t0 = at("title");
    tl.add(title, { opacity: [0, 1], scale: [1.4, 1], letterSpacing: ["0.55em", "0.04em"], duration: 620, ease: "outExpo" }, t0)
      .add(motto, { opacity: [0, 1], translateY: [10, 0], duration: 460 }, t0 + 520);
    // threat: the readout locks
    tl.add(threat, { clipPath: ["inset(0% 50% 0% 50%)", "inset(0% 0% 0% 0%)"], duration: 460, ease: "outQuart" }, at("threat"));
    // out: the stage clears upward
    tl.add(el, { opacity: [1, 0], translateY: [0, -36], duration: 520, ease: "inQuad" }, at("out"));
    return tl;
  }

  _dealTimeline() {
    const { table, gm } = this.refs;
    const cards = [...table.querySelectorAll(".glci-card")], volleys = [...table.querySelectorAll(".glci-volley")];
    const tl = createTimeline({ autoplay: false, defaults: { ease: "outExpo" } });
    tl.set([...cards, ...volleys], { opacity: 0 }, 0).set(gm, { opacity: 0 }, 0);
    const n = cards.length + volleys.length;
    const step = Math.min(90, 420 / Math.max(1, n));
    cards.forEach((c, i) => {
      tl.add(c, { opacity: [0, 1], translateY: [70, 0], scale: [0.9, 1], duration: 640 }, 60 + i * step);
      const fr = c.querySelector(".glci-card-frame");
      if (fr) tl.add(fr, { scaleX: [0, 1], duration: 520, ease: "outQuart" }, 120 + i * step);
    });
    volleys.forEach((v, i) => tl.add(v, { opacity: [0, 1], translateX: [90, 0], duration: 640 }, 60 + (cards.length + i) * step));
    tl.add(gm, { opacity: [0, 1], duration: 400, ease: "linear" }, ROLL.deal - 400);
    return tl;
  }

  /** Rank tiles: where each slot's tile ends, laid out in rows across the middle. */
  _rankLayout(n, W, H) {
    const late = !!this.state?.late;
    const gap = 14;
    let w = Math.min(late ? 132 : 172, (W * 0.9 - gap * (n - 1)) / Math.max(1, n));
    let rows = 1;
    if (w < 104) { rows = 2; w = Math.min(172, (W * 0.9 - gap * (Math.ceil(n / 2) - 1)) / Math.ceil(n / 2)); }
    w = Math.max(72, w);
    const h = Math.round(w * 1.36);
    const per = Math.ceil(n / rows);
    const top0 = H * 0.5 - (rows * h + (rows - 1) * gap) / 2;
    return Array.from({ length: n }, (_, i) => {
      const r = Math.floor(i / per), inRow = r === rows - 1 ? n - r * per : per, c = i - r * per;
      const span = inRow * w + (inRow - 1) * gap;
      return { left: (W - span) / 2 + c * (w + gap), top: top0 + r * (h + gap), width: w, height: h };
    });
  }

  _sourceRect(slotId) {
    const el = this.refs.cards.get(slotId) ?? this.refs.minis.get(slotId);
    const r = el?.getBoundingClientRect?.();
    return r && r.width ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
  }

  _sortTimeline() {
    const st = this.state;
    const order = this._order();
    const byId = new Map(st.slots.map((s) => [s.id, s]));
    const full = st.order ?? order;
    const W = globalThis.innerWidth ?? 1600, H = globalThis.innerHeight ?? 900;
    this.timelines.deal?.seek?.(ROLL.deal);
    const srcs = order.map((id) => this._sourceRect(id));
    const dst = this._rankLayout(order.length, W, H);
    const box = this.refs.sort;
    box.innerHTML = order.map((id) => this.overlay.rank(byId.get(id), Math.max(0, full.indexOf(id)))).join("");
    const tiles = [...box.querySelectorAll(".glci-rank")];
    const tl = createTimeline({ autoplay: false, defaults: { ease: "outQuart" } });
    const move = beatStart(SORT, "move");
    const stag = Math.min(70, 360 / Math.max(1, tiles.length));
    tl.set(tiles, { opacity: 0 }, 0);
    tl.add(this.refs.table, { opacity: [1, 0], duration: 360, ease: "outQuad" }, 60);
    tiles.forEach((tile, i) => {
      const d = dst[i], s = srcs[i] ?? { left: d.left, top: H + 40, width: d.width, height: d.height };
      Object.assign(tile.style, { left: `${d.left}px`, top: `${d.top}px`, width: `${d.width}px`, height: `${d.height}px` });
      const dx = s.left + s.width / 2 - (d.left + d.width / 2), dy = s.top + s.height / 2 - (d.top + d.height / 2);
      const k = Math.max(0.3, Math.min(1.6, Math.min(s.width / d.width, s.height / d.height)));
      tl.set(tile, { translateX: dx, translateY: dy, scale: k }, 0);
      tl.add(tile, { opacity: [0, 1], duration: 240, ease: "outQuad" }, 30 + i * 22);
      tl.add(tile, { translateX: [dx, 0], translateY: [dy, 0], scale: [k, 1], duration: 860, ease: "inOutCubic" }, move + i * stag);
      const trail = box.ownerDocument.createElement("i");
      trail.className = "glci-rank-trail";
      const len = Math.hypot(dx, dy);
      trail.style.width = `${len}px`;
      trail.style.rotate = `${Math.atan2(dy, dx)}rad`;
      tile.prepend(trail);
      // The comet tail points back at the source and grows with the distance covered.
      tl.set(trail, { opacity: 0, scaleX: 0 }, 0);
      tl.add(trail, { scaleX: [0, 1], opacity: [0, 0.85], duration: 600, ease: "inOutCubic" }, move + i * stag + 40);
      tl.add(trail, { opacity: [0.85, 0], duration: 360, ease: "outQuad" }, move + i * stag + 620);
      const n = tile.querySelector(".glci-rank-n");
      tl.set(n, { opacity: 0 }, 0);
      tl.add(n, { opacity: [0, 1], scale: [1.8, 1], duration: 300, ease: "outBack(2)" }, move + i * stag + 760);
    });
    this._sortPlan = order.map((id, i) => ({ id, combatantId: byId.get(id)?.combatantId ?? id, rect: dst[i], tile: tiles[i] }));
    return tl;
  }

  /** Where each tile collapses to: the rail's slots, or a row along the top when there is no rail. */
  _planHandoff(order) {
    const W = globalThis.innerWidth ?? 1600;
    const rail = this.railRect?.() ?? null;
    const n = Math.max(1, order.length);
    const byId = new Map((this.state?.slots ?? []).map((s) => [s.id, s]));
    const tileW = this._sortPlan?.[0]?.rect.width ?? 150, tileH = this._sortPlan?.[0]?.rect.height ?? 204;
    let slots;
    if (rail && rail.width > 0 && rail.height > 0) {
      if (rail.height >= rail.width) {
        const h = Math.min(rail.height / n, rail.width * 0.9);
        slots = order.map((_, i) => ({ left: rail.left, top: rail.top + i * h, width: rail.width, height: h }));
      } else {
        const w = Math.min(rail.width / n, rail.height * 0.9);
        slots = order.map((_, i) => ({ left: rail.left + i * w, top: rail.top, width: w, height: rail.height }));
      }
    } else {
      const w = 54, h = 74, gap = 6, span = n * w + (n - 1) * gap;
      slots = order.map((_, i) => ({ left: (W - span) / 2 + i * (w + gap), top: 18, width: w, height: h }));
    }
    // A uniform scale keeps the art upright; the reported rect is what is really drawn.
    return order.map((id, i) => {
      const t = slots[i], k = Math.min(t.width / tileW, t.height / tileH);
      const w = tileW * k, h = tileH * k;
      return { id, combatantId: byId.get(id)?.combatantId ?? id, k, rect: { left: t.left + (t.width - w) / 2, top: t.top + (t.height - h) / 2, width: w, height: h } };
    });
  }

  _handoffTimeline() {
    if (!this.timelines.sort) this.timelines.sort = this._sortTimeline();
    this.timelines.sort.seek(beatStart(SORT, "settle") + SORT.at(-1)[1]);
    const plan = this._planHandoff(this._order());
    this._handoffPlan = plan;
    const tl = createTimeline({ autoplay: false, defaults: { ease: "inOutQuart" } });
    const dock = beatStart(HANDOFF, "dock");
    const stag = Math.min(40, 240 / Math.max(1, plan.length));
    plan.forEach((p, i) => {
      const src = this._sortPlan?.find((s) => s.id === p.id);
      if (!src?.tile) return;
      const d = src.rect;
      const dx = p.rect.left + p.rect.width / 2 - (d.left + d.width / 2), dy = p.rect.top + p.rect.height / 2 - (d.top + d.height / 2);
      tl.add(src.tile, { translateX: [0, dx], translateY: [0, dy], scale: [1, p.k], duration: 620, ease: "inOutQuart" }, i * stag);
      tl.add(src.tile, { opacity: [1, 0], duration: 360, ease: "inQuad" }, dock + 120 + i * 18);
    });
    return tl;
  }

  /* ── the clock → curves every renderer reads ──────────────────────── */

  _curves(phase, ms, landPulse) {
    const c = { boot: 1, roster: 0, title: 0, flash: 0, threat: 0, out: 0, deal: 1, table: 0, hold: 0, move: 0, streak: 0, collapse: 0, dock: 0, intensity: 1, sweep: -1, land: landPulse };
    const sev = this.state?.intro?.threat?.severity;
    if (phase === "intro") {
      const b = (n) => beatStart(INTRO, n);
      const len = (n) => INTRO.find(([k]) => k === n)[1];
      const tIn = (n, from = 0, to = 1) => clamp01((ms - b(n) - from * len(n)) / ((to - from) * len(n)));
      const outT = tIn("out");
      c.boot = outCubic(tIn("boot"));
      c.intensity = outCubic(clamp01(ms / (len("boot") * 0.6)));
      c.sweep = ms < b("roster") ? outCubic(tIn("boot")) : -1;
      c.roster = outCubic(tIn("roster", 0, 0.5)) * (1 - outT);
      c.title = outCubic(tIn("title", 0, 0.45)) * (1 - outT);
      c.flash = ms >= b("title") ? Math.exp(-(ms - b("title")) / 240) : 0;
      c.threat = sev ? outCubic(tIn("threat", 0, 0.5)) * (1 - outT) : 0;
      c.out = outT;
      c.deal = 0;
    } else if (phase === "rolling") {
      c.deal = clamp01(ms / ROLL.deal);
      c.table = outCubic(c.deal);
      c.sweep = c.deal < 1 ? outCubic(c.deal) : -1;
      // A reinforcement is a beat inside a fight already running: the board stays readable.
      if (this.state?.late) c.intensity = 0.6 * outCubic(c.deal);
    } else if (phase === "sorting") {
      if (this.state?.late) c.intensity = 0.6;
      const b = beatAt(SORT, ms);
      const moveStart = beatStart(SORT, "move"), moveLen = SORT.find(([k]) => k === "move")[1];
      c.hold = b.beat === "hold" ? b.t : 1;
      c.move = clamp01((ms - moveStart) / moveLen);
      c.streak = Math.sin(Math.PI * c.move);
      c.table = 1 - outCubic(clamp01(ms / 500));
    } else if (phase === "handoff") {
      const b = beatAt(HANDOFF, ms);
      c.collapse = b.beat === "collapse" ? b.t : 1;
      c.dock = b.beat === "dock" ? b.t : 0;
      c.intensity = (this.state?.late ? 0.6 : 1) * (1 - outCubic(c.dock));
      c.move = 1;
    }
    return c;
  }

  _cue(key, name, at, sNow) {
    if (this.cued.has(key) || sNow < at) return;
    this.cued.add(key);
    if (this.frozen == null && sNow - at < CUE_WINDOW_MS) this.sound?.cue?.(name);
  }

  _write(key, el, fn, value) {
    if (!el || this.written.get(key) === value) return;
    this.written.set(key, value);
    fn(el, value);
  }

  /* ── one frame ─────────────────────────────────────────────────────── */

  frame({ width, height, dpr = 1 } = {}) {
    const st = this.state;
    if (!st || !this.refs || this.destroyed || !this.mounted) return;
    const sNow = this._serverTime();
    const { phase, ms } = phaseClock(st, sNow);
    const root = this.root;
    const tl = this.timelines;
    const T = (k, v) => { if (root.dataset[k] !== v) root.dataset[k] = v; };
    T("phase", phase);

    // 1 ── seek every DOM beat (writes)
    let beat = "", beatK = 0, beatT = 0, phaseT = 0;
    if (phase === "intro") {
      const b = beatAt(INTRO, ms); beat = b.beat; beatK = b.k; beatT = b.t; phaseT = clamp01(ms / INTRO_MS);
      tl.intro?.seek(ms);
      tl.deal?.seek(0);
    } else {
      tl.intro?.seek(INTRO_MS);
      if (phase === "rolling") { tl.deal?.seek(Math.min(ms, ROLL.deal)); beat = ms < ROLL.deal ? "deal" : "table"; beatK = ms < ROLL.deal ? 0 : 1; beatT = clamp01(ms / ROLL.deal); }
      else tl.deal?.seek(ROLL.deal);
      if (phase === "sorting") {
        if (!tl.sort) tl.sort = this._sortTimeline();
        const b = beatAt(SORT, ms); beat = b.beat; beatK = b.k; beatT = b.t; phaseT = clamp01(ms / (beatStart(SORT, "settle") + SORT.at(-1)[1]));
        tl.sort.seek(ms);
      } else if (phase === "handoff") {
        if (!tl.handoff) tl.handoff = this._handoffTimeline();
        const b = beatAt(HANDOFF, ms); beat = b.beat; beatK = b.k; beatT = b.t; phaseT = clamp01(ms / (beatStart(HANDOFF, "dock") + HANDOFF.at(-1)[1]));
        tl.handoff.seek(ms);
      }
    }
    T("beat", beat);

    // 2 ── read every anchor (one layout)
    const shown = this._shown();
    const anchors = shown.map((s) => {
      const el = s.kind === "pc" ? this.refs.cards.get(s.id)?.querySelector(".glci-card-die") : this.refs.minis.get(s.id);
      const r = el?.getBoundingClientRect?.();
      return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(1, Math.min(r.width, r.height)) } : { x: -999, y: -999, size: 1 };
    });

    // 3 ── dice, states, totals (writes)
    const { t, f } = this.i18n;
    const idleT = idleSec(sNow);
    const U = new Float32Array(MAX_ANCHORS * 4);
    const FX = new Float32Array(MAX_ANCHORS * 4).fill(-1);
    let landPulse = 0, anyCharge = false;
    const dealT = phase === "rolling" ? clamp01(ms / ROLL.deal) : phase === "intro" ? 0 : 1;
    const sortHide = phase === "sorting" ? 1 - outCubic(clamp01((ms - 120) / 320)) : phase === "handoff" ? 0 : 1;
    const volleyStates = new Map();

    shown.forEach((s, i) => {
      const l = this.local.get(s.id);
      const a = anchors[i];
      const res = this.results.get(s.id) ?? null;
      const full = res && !res.sealed ? res : null;
      const at = this._throwAt(s);
      const el = at == null ? null : sNow - at;
      const state = el == null || el < 0 ? "waiting" : el < ROLL.tumble ? "thrown" : "landed";
      const sealed = !full;
      const seed = s.throw?.seed ?? res?.seed ?? 1;
      const sealedFace = 1 + (Math.abs(Math.floor(seed)) % 20);
      const face = full?.natural ?? sealedFace;

      // the die
      let pose, lift = 0, scale = 1;
      if (state === "waiting") {
        const p = idlePose(idleT, 1307 + i * 3);
        const crouch = l?.chargeAt == null ? 0 : outCubic(clamp01((this.now() - l.chargeAt) / 260));
        if (crouch > 0) anyCharge = true;
        pose = p.q; lift = p.lift - crouch * 0.06; scale = 1 - crouch * 0.08;
      } else {
        const key = `${at}|${face}`;
        if (l && l.die && (!l.tumble || l.at !== at)) {
          const from = idlePose(idleSec(at), 1307 + i * 3).q;
          l.tumble = createTumble({ target: l.die.targetFor(face), from, seed: seed * 104729 + i * 7919, params: TUMBLE_PARAMS });
          l.key = key; l.at = at; l.face = face; l.label = null;
        }
        const p = l?.tumble?.at(el / 1000) ?? { q: [0, 0, 0, 1], lift: 0, scale: 1 };
        pose = p.q; lift = p.lift; scale = p.scale;
        if (state === "landed" && l?.die) {
          // A sealed die lands on a face nobody can read into; a full result that
          // arrived after the throw began relabels the face the die is showing.
          const want = sealed ? "?" : l.face === full.natural && !l.label ? null : String(full.natural ?? "?");
          if (want != null && l.label !== want) { l.die.relabel?.(l.face, want, false); l.label = want; }
        }
        if (l) l.chargeAt = null;
      }
      const stagger = s.kind === "pc" ? i * 0.07 : 0.2 + i * 0.03;
      const appear = phase === "rolling" ? clamp01((dealT - 0.25 - stagger) / 0.45) : dealT;
      const vis = (appear >= 1 ? 1 : Math.max(0, outBack(appear))) * sortHide;
      if (l?.die) {
        l.die.setPose?.(pose);
        this.dice.place(l.die, { x: a.x, y: a.y, size: a.size * (s.kind === "pc" ? 0.84 : 1.0) }, lift, Math.max(0.0001, scale * vis));
      }

      // the anchor the backdrop lights
      if (i < MAX_ANCHORS) {
        U.set([a.x * dpr, a.y * dpr, a.size * dpr * (vis > 0.01 ? 1 : 0), state === "waiting" ? 0 : state === "thrown" ? 1 : 2], i * 4);
        const landS = el == null ? -1 : (el - ROLL.tumble) / 1000;
        FX.set([el == null || el < 0 ? -1 : el / 1000, landS >= 0 ? landS : -1, sealed ? 1 : 0, 0], i * 4);
        if (landS >= 0) landPulse = Math.max(landPulse, Math.exp(-landS * 4));
      }

      // cues
      if (at != null && phase === "rolling") {
        this._cue(`${st.id}:throw:${s.id}:${at}`, "throw", at, sNow);
        this._cue(`${st.id}:land:${s.id}:${at}`, sealed ? "seal" : "dieLand", at + ROLL.tumble, sNow);
      }

      // the card
      const revealT = state === "landed" ? clamp01((el - ROLL.tumble) / ROLL.reveal) : 0;
      if (s.kind === "pc") {
        const card = this.refs.cards.get(s.id);
        this._write(`st:${s.id}`, card, (e, v) => { e.dataset.state = v; }, state);
        const nat = full?.natural ?? null;
        this._write(`nat:${s.id}`, card, (e, v) => { if (v) e.dataset.nat = v; else delete e.dataset.nat; }, state === "landed" && (nat === 20 || nat === 1) ? String(nat) : "");
        const total = full?.total ?? this.totals.get(s.id) ?? null;
        const text = state !== "landed" ? "—" : total == null ? "?" : String(Math.round(total * outCubic(revealT)));
        this._write(`tv:${s.id}`, card?.querySelector(".glci-card-total-v"), (e, v) => { e.textContent = v; }, text);
        const k = state === "waiting" ? t("GLCI.card.waiting") : state === "thrown" ? t("GLCI.card.rolling") : t("GLCI.card.total");
        this._write(`tk:${s.id}`, card?.querySelector(".glci-card-total-k"), (e, v) => { e.textContent = v; }, k);
        this._write(`tn:${s.id}`, card?.querySelector(".glci-card-nat"), (e, v) => { e.textContent = v; }, state === "landed" && nat ? f("GLCI.card.natural", { n: nat }) : "");
      } else {
        const mini = this.refs.minis.get(s.id);
        this._write(`st:${s.id}`, mini, (e, v) => { e.dataset.state = v; }, state);
        const total = full?.total ?? null;
        this._write(`mt:${s.id}`, mini?.querySelector(".glci-mini-total"), (e, v) => { e.textContent = v; }, state === "landed" && total != null && revealT > 0.2 ? String(total) : "");
        const g = volleyStates.get(s.group) ?? [];
        g.push(state);
        volleyStates.set(s.group, g);
      }
    });
    for (const [group, states] of volleyStates) {
      const v = states.every((x) => x === "landed") ? "landed" : states.some((x) => x !== "waiting") ? "thrown" : "waiting";
      this._write(`vs:${group}`, this.refs.volleys.get(group), (e, val) => { e.dataset.state = val; }, v);
    }

    // sort tiles: totals read at the hold beat (NPC seals break here)
    if ((phase === "sorting" || phase === "handoff") && this._sortPlan) {
      const reveal = phase === "handoff" ? 1 : clamp01((ms - 150) / 300);
      for (const p of this._sortPlan) {
        const r = this.results.get(p.id);
        const total = r && !r.sealed ? r.total : this.totals.get(p.id);
        const v = total == null ? "—" : reveal <= 0 ? "—" : String(Math.round(total * outCubic(reveal)));
        this._write(`rk:${p.id}`, p.tile?.querySelector(".glci-rank-total"), (e, val) => { e.textContent = val; }, v);
      }
    }

    // GM bar: each control only in the phase it means anything
    if (this.refs.gm) for (const b of this.refs.gm.querySelectorAll("[data-gm]")) {
      const a = b.dataset.gm;
      const show = a === "cancel" || (a === "skip" && phase === "intro") || (a === "rest" && phase === "rolling");
      if (b.hidden === show) b.hidden = !show;
    }

    // cues for the timed phases
    const beatsOf = phase === "intro" ? INTRO : phase === "sorting" ? SORT : phase === "handoff" ? HANDOFF : null;
    const CUE_AT = { intro: { boot: "introHit", roster: "rosterTick", title: "titleSlam", threat: st.intro?.threat ? "rosterTick" : null },
      sorting: { hold: shown.some((s) => s.kind === "npc") ? "seal" : null, move: "sortTick" }, handoff: { dock: "dockIn" } }[phase];
    if (beatsOf && CUE_AT) for (const [name] of beatsOf) if (CUE_AT[name]) this._cue(`${st.id}:${phase}:${name}`, CUE_AT[name], st.at + beatStart(beatsOf, name), sNow);

    // curves → CSS (the fallback reads these) and the backdrop
    const c = this._curves(phase, ms, landPulse);
    for (const k of ["boot", "roster", "title", "flash", "threat", "table", "collapse", "intensity", "land", "move"]) {
      const v = Math.round(c[k] * 1000) / 1000;
      this._write(`css:${k}`, root, (e, val) => e.style.setProperty(`--glci-${k}`, String(val)), v);
    }
    this._write("css:sweep", root, (e, val) => e.style.setProperty("--glci-sweep", String(val)), c.sweep < 0 ? -1 : Math.round(c.sweep * 1000) / 1000);
    const lite = OWN_SHED.filter((n) => !this._allows(n)).join(" ");
    if ((root.dataset.lite ?? "") !== lite) { if (lite) root.dataset.lite = lite; else delete root.dataset.lite; }

    const gl = !!this.backdrop?.ok && this._allows("backdrop") && !this.cssOnly;
    T("render", gl ? "webgl" : "css");
    if (gl) {
      const P = this.pal ?? {};
      this.backdrop.resize(width, height, dpr);
      const sevI = SEVERITIES.indexOf(st.intro?.threat?.severity);
      const u = {
        uRes: [this.backdrop.canvas.width, this.backdrop.canvas.height],
        uTime: (sNow / 1000) % 64,
        uPhase: PHASE_INDEX[phase] ?? 0, uBeat: beatK, uBeatT: beatT, uPhaseT: phaseT,
        uAnchors: U, uAnchorN: Math.min(MAX_ANCHORS, shown.length),
        uAccent: P.accent ?? [0.42, 0.6, 1], uHot: P.hot ?? [0.85, 0.92, 1], uInk: P.ink ?? [0.02, 0.03, 0.05], uWarn: P.warn ?? [1, 0.7, 0.2],
        uShed: this.ladder?.level ?? 0, uIntensity: c.intensity,
      };
      this.skinModule?.write?.(u, {
        phase, beat: beatK, beatT, phaseT, time: u.uTime, anchors: U, allows: (n) => this._allows(n), palette: P,
        dpr, width: u.uRes[0], height: u.uRes[1], beatName: phase === "rolling" ? "" : beat, severity: sevI, curves: c, anchorFx: FX,
      });
      this.backdrop.frame(u);
    }

    this.dice.resize?.(width, height);
    this.dice.setLights?.({ rim: toHex(this.pal?.accent), rimI: 6 + landPulse * 10, fillI: 0.6 + (anyCharge ? 0.5 : 0), keyI: 1.6 });
    this.dice.render?.();
  }
}
