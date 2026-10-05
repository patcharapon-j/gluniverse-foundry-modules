/**
 * The director: one spotlight request, on one screen, on one clock.
 *
 * Pure — no game/canvas/foundry. The feature hands it a request and tells it
 * when each roll was thrown (already converted from server time to this
 * client's clock); the preview page does the same with a three.js stand-in for
 * the dice. Everything on screen is then a function of (now − throwAt), which
 * is what lets a late client settle, a seek land anywhere, and two screens
 * agree on the frame.
 *
 * Collaborators (all injected):
 *   overlay   the stele overlay (overlay/monolith.mjs) — DOM + timelines
 *   dice      a dice host: createDice(specs) / place / setLights / render / clear
 *   backdrop  Backdrop (backdrop.mjs), or null for the CSS path only
 *   ladder    a Budget ladder over SHED_ORDER, or null
 */
import { createTumble, idlePose, TUMBLE } from "./tumble.mjs";
import { scheduleBeats } from "./timeline.mjs";
import { MAX_DICE } from "./backdrop.mjs";
import { eases } from "../../core/motion.mjs";

export const ARRIVE_MS = 1400;
/** Cheapest first. "rays" is read by the fragment through uShed; losing
 *  "backdrop" swaps the WebGL backdrop for the CSS one. */
export const SHED_ORDER = Object.freeze(["rays", "backdrop"]);
const SEED = 1307;

const PHASE_ORDER = ["request", "armed", "tumble", "landed", "tally", "degree", "hold", "out"];
const sinceS = (ms, at) => (at == null || ms < at ? -1 : (ms - at) / 1000);
const lin = (c) => c.map((x) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
const rgbHex = (c) => "#" + c.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, "0")).join("");

function phaseAt(ms, b) {
  if (ms < 0) return "armed";
  if (ms < b.land) return "tumble";
  if (ms >= b.out) return "out";
  if (ms >= b.hold) return "hold";
  if (ms >= b.degree) return "degree";
  if (b.tally.length && ms >= b.tally[0]) return "tally";
  return "landed";
}

/**
 * The dice a roll shows before its result is known: a d20 (two for fortune or
 * misfortune), or the dice of a free formula. d100 is a tens d10 + a units d10.
 */
export function diceSpecOf(model) {
  if (Array.isArray(model.diceSpec) && model.diceSpec.length) return model.diceSpec.slice(0, MAX_DICE);
  return model.roll?.fortune ? [20, 20] : [20];
}

/** Where each die of a roll sits inside the overlay's anchor box. */
export function diceLayout(anchor, count, { pair = false } = {}) {
  if (count <= 1) return [anchor];
  if (pair) {
    return [-1, 1].map((s) => ({ x: anchor.x + s * 0.62 * anchor.size, y: anchor.y, size: anchor.size * 0.78 }));
  }
  const cols = count <= 3 ? count : Math.ceil(count / 2);
  const rows = Math.ceil(count / cols);
  const size = anchor.size * Math.min(0.78, 1.7 / cols);
  const gap = size * 1.08;
  return Array.from({ length: count }, (_, k) => {
    const r = Math.floor(k / cols), c = k % cols, inRow = r === rows - 1 ? count - r * cols : cols;
    return { x: anchor.x + (c - (inRow - 1) / 2) * gap, y: anchor.y + (r - (rows - 1) / 2) * gap, size };
  });
}

export class Director {
  /**
   * @param {object} o
   * @param {HTMLElement} o.root   the .glsr element
   * @param {{bg, cssbg, back, dice, front}} o.layers
   * @param {object} o.overlay     overlay module (default export of overlay/monolith.mjs)
   * @param {object} o.dice        dice host
   * @param {object|null} o.backdrop
   * @param {object|null} o.ladder
   * @param {{t, f}} o.i18n
   * @param {object} o.palette     { accent, gold, success, fail, crimson } as sRGB 0..1 triples
   * @param {number} [o.motion]    motion scale (1 = default)
   * @param {() => number} [o.now]
   * @param {(dir: Director) => void} [o.onEnd]
   * @param {(i: number) => boolean} [o.mayAct]  may this screen throw / toggle / reroll roll i?
   */
  constructor(o) {
    Object.assign(this, { motion: 1, now: () => performance.now(), onEnd: null, ladder: null, backdrop: null, mayAct: () => true }, o);
    this.rolls = [];
    this.frozen = null;
    this.ended = false;
    this.releaseAt = null;
  }

  get anime() { return this._anime; }

  /**
   * Mount a request. `request` = { layout, rolls: [model], defender, sharedDc }.
   * Resolves once the dice exist, so the entrance never shows an empty stele.
   */
  async mount(request, { anime, requestAt = this.now(), diceSpecs = null } = {}) {
    this.request = request;
    this._anime = anime;
    for (const k of ["back", "front", "cssbg"]) this.layers[k].replaceChildren();
    this.root.dataset.layout = request.layout === "group" ? (request.rolls.length > 3 ? "group6" : "group3") : request.layout;
    this.root.dataset.degree = "none";
    this.root.dataset.phase = "request";
    delete this.root.dataset.natural;
    this.root.style.setProperty("--glsr-motion", String(this.motion));
    this._setRender();
    // One entry per die: { faces } here, plus whose appearance it wears when the host is DSN.
    const specs = diceSpecs ?? request.rolls.map((m) => diceSpecOf(m).map((faces) => ({ faces })));
    const dice = await this.dice.createDice(specs);
    const ctx = {
      root: this.root, back: this.layers.back, front: this.layers.front, cssbg: this.layers.cssbg,
      request, model: request.rolls[0], motion: this.motion, palette: this.palette, ARRIVE_MS, anime, i18n: this.i18n,
    };
    this.instance = this.overlay.mount(ctx);
    this.rolls = request.rolls.map((model, i) => ({ i, model, dice: dice[i] ?? [], throwAt: null, beats: null, tumbles: null, steps: null, throwTl: null }));
    this.requestAt = requestAt;
    this.armedAt = null;
    this.focus = 0;
    // Stamp once now, so controls this screen may not use are hidden from the
    // first paint rather than from the first frame.
    for (const r of this.rolls) this._stamp(r.i, "request", null, null);
    return this;
  }

  _setRender() {
    const gl = !!this.backdrop?.ok && (this.ladder ? this.ladder.allows("backdrop") : true) && !this.cssOnly;
    const want = gl ? "webgl" : "css";
    if (this.root.dataset.render !== want) this.root.dataset.render = want;
    return gl;
  }

  /** Replace a roll's model before its throw (a chip toggled, a peer's choice arrived). */
  update(i, model) {
    const r = this.rolls[i];
    if (!r || r.throwAt != null) return;
    r.model = model;
    this.instance?.update?.(model, i);
  }

  /**
   * Start roll `i`'s throw.
   * @param {number} i
   * @param {object} model   the resolved model (roll.dice values, degree, …)
   * @param {{ seed?: number, at?: number }} [o]  `at` is this client's clock
   */
  throw(i, model, { seed = SEED, at = this.now() } = {}) {
    const r = this.rolls[i];
    if (!r) return;
    const fromPoses = r.dice.map((d, k) => (r.throwAt == null ? idlePose(Math.max(0, (at - (this.armedAt ?? this.requestAt)) / 1000), SEED + i * 3 + k).q : d.pose ?? [0, 0, 0, 1]));
    r.throwTl?.revert?.();
    r.model = model;
    r.steps = (model.mods ?? []).filter((x) => x.enabled && x.value !== 0);
    const single = this._kept(r) != null;
    r.beats = scheduleBeats({
      mods: model.sealed ? 0 : r.steps.length,
      natural: model.sealed ? null : model.roll?.natural,
      dcHidden: !model.sealed && model.dc?.mode === "hidden" && model.dc?.value != null,
      fortune: !!model.roll?.fortune,
      crit: !!model.crit,
      scale: this.motion,
    });
    r.single = single;
    const values = this._faceValues(r, seed);
    r.tumbles = r.dice.map((d, k) => createTumble({ target: d.targetFor(values[k]), from: fromPoses[k], seed: seed + i * 104729 + k * 7919, scale: this.motion }));
    r.faceValues = values;
    this.instance?.arrive?.seek?.(ARRIVE_MS);
    r.throwTl = this.instance.throwTimeline(r.beats, model, i);
    r.throwAt = at;
    r.done = false;
    this.focus = i;
    this.releaseAt = null;
  }

  /** Index of the one die whose face counts the total up, or null. */
  _kept(r) {
    const n = r.dice.length;
    if (n === 1) return 0;
    if (n === 2 && r.model?.roll?.fortune) return 0;
    return null;
  }

  /** The face each die lands on. A sealed roll lands on a face nobody can read into. */
  _faceValues(r, seed) {
    const dice = r.model?.roll?.dice ?? [];
    return r.dice.map((d, k) => {
      if (r.model.sealed) return 1 + ((seed + k * 7) % Math.max(2, d.faceCount ?? 20));
      return dice[k]?.value ?? 1;
    });
  }

  /**
   * The throw was asked for and the GM is resolving it: the die gathers itself
   * (a slight crouch) so the click answers at once, before the cue arrives.
   */
  charge(i) {
    const r = this.rolls[i];
    if (r && r.throwAt == null) r.chargeAt = this.now();
  }

  /** Every roll still waiting. */
  pending() { return this.rolls.filter((r) => r.throwAt == null).map((r) => r.i); }

  /** Close on this screen: anything holding goes straight to its exit. */
  dismiss() {
    const now = this.now();
    if (this.rolls.every((r) => r.throwAt == null)) { this.destroy(); this.onEnd?.(this); return; }
    this.releaseAt = now;
    this.dismissed = true;
  }

  /** The effective time of roll r: rolls hold at `out` until the whole request is done. */
  _ms(r, now) {
    if (this.frozen) return this.frozen.ms - (this.frozen.offsets?.[r.i] ?? 0);
    const raw = now - r.throwAt;
    const b = r.beats;
    if (raw < b.out) {
      if (this.dismissed && raw >= b.land) return b.out + (now - this.releaseAt);
      return raw;
    }
    // Everybody leaves together: a group's early finishers wait in their hold.
    if (this.releaseAt == null) {
      const waiting = this.rolls.some((x) => x.throwAt == null);
      const lastOut = Math.max(...this.rolls.filter((x) => x.throwAt != null).map((x) => x.throwAt + x.beats.out));
      if (waiting || now < lastOut) return b.out - 1;
      this.releaseAt = lastOut;
    }
    return b.out + (now - this.releaseAt);
  }

  /** Freeze at `ms` after each roll's throw (preview / headless frames). */
  seek(ms, offsets = null) { this.frozen = { ms, offsets }; }
  play() { this.frozen = null; }

  _stamp(i, phase, degree, natural) {
    const may = this.mayAct(i) ? "1" : "0";
    for (const el of this.root.querySelectorAll(`[data-roll="${i}"]`)) {
      if (el.dataset.phase !== phase) el.dataset.phase = phase;
      // A control this screen may not use is not drawn (styles/spotlight-roll-app.css).
      if (el.dataset.mayAct !== may) el.dataset.mayAct = may;
      const d = degree == null ? "none" : String(degree);
      if (el.dataset.degree !== d) el.dataset.degree = d;
      if (natural) el.dataset.natural = String(natural); else delete el.dataset.natural;
    }
  }

  /** One frame. `viewport` = { width, height, dpr } in CSS px. */
  frame(viewport) {
    if (!this.instance || this.ended) return;
    const now = this.now();
    const { width, height, dpr } = viewport;
    const time = now / 1000;
    this.dice.resize?.(width, height);
    const aMs = this.frozen?.arrive != null ? this.frozen.arrive : now - this.requestAt;
    if (this.rolls.every((r) => r.throwAt == null)) this.instance.arrive?.seek?.(Math.max(0, Math.min(aMs, ARRIVE_MS)));
    if (aMs >= ARRIVE_MS && this.armedAt == null) this.armedAt = this.requestAt + ARRIVE_MS;
    const sec = Math.max(0, (now - (this.armedAt ?? this.requestAt)) / 1000);
    if (this.armedAt != null) this.instance.armed?.(sec);
    const appear = Math.min(1, Math.max(0, (aMs - ARRIVE_MS * 0.35) / (ARRIVE_MS * 0.5)));

    const diceA = new Float32Array(MAX_DICE * 4), diceB = new Float32Array(MAX_DICE * 4);
    const states = [];
    let lights = null, focusU = null, allEnded = this.rolls.length > 0;
    const idlePhase = this.armedAt == null ? "request" : "armed";
    const P = this.palette;

    for (const r of this.rolls) {
      const anchor = this.instance.dieAnchor(r.i);
      const pair = r.dice.length === 2 && !!r.model.roll?.fortune;
      const slots = diceLayout(anchor, r.dice.length, { pair });
      const slot = r.i < MAX_DICE ? r.i * 4 : -1;
      let st;
      if (r.throwAt == null) {
        // A dismissed request does not wait for rolls nobody threw.
        if (!this.dismissed) allEnded = false;
        const crouch = r.chargeAt == null ? 0 : eases.outCubic(Math.min(1, (now - r.chargeAt) / (260 * this.motion)));
        const gone = this.dismissed ? Math.max(0, 1 - (now - this.releaseAt) / (500 * this.motion)) : 1;
        r.dice.forEach((d, k) => {
          const p = idlePose(sec, SEED + r.i * 3 + k);
          d.setPose(p.q); d.pose = p.q; d.shatter?.(0);
          this.dice.place(d, slots[k], p.lift - crouch * 0.06, (eases.outBack(1.4)(appear) || 0.0001) * (1 - crouch * 0.08) * gone || 0.0001);
        });
        st = { index: r.i, phase: idlePhase, degree: null, ms: null };
        this._stamp(r.i, idlePhase, null, null);
        if (slot >= 0) { diceA.set([anchor.x * dpr, (height - anchor.y) * dpr, anchor.size * 0.5 * dpr, -1], slot); diceB.set([-1, -1, -1, 0], slot); }
      } else {
        const m = r.model, b = r.beats;
        const ms = this._ms(r, now);
        if (ms < b.end) allEnded = false;
        const phase = phaseAt(ms, b);
        let step = 0;
        while (step < b.tally.length && ms >= b.tally[step]) step++;
        const kept = this._kept(r);
        const base = m.sealed ? null : kept != null ? (m.roll?.dice?.[kept]?.value ?? 0) : (m.roll?.dice ?? []).reduce((a, d) => a + (d.value ?? 0), 0);
        const running = base == null ? null : base + r.steps.slice(0, step).reduce((a, x) => a + x.value, 0);
        const hot = step > 0 && ms - b.tally[step - 1] < 260;
        const poses = r.tumbles.map((tb) => tb.at(Math.max(0, ms) / 1000));
        const rate = poses[0]?.rate ?? 0;
        const degree = ms >= b.degree ? m.degree : null;
        const natural = ms >= (b.natural ?? Infinity) ? m.roll?.natural : null;
        const info = { index: r.i, phase, beats: b, running, step, rate, natural: m.roll?.natural ?? null, degree: m.degree, model: m, pose: poses[0] };
        r.throwTl?.seek?.(Math.max(0, ms));
        this.instance.frame?.(ms, info);
        this._stamp(r.i, phase, degree, natural);

        const fortP = b.fortune != null ? Math.min(1, Math.max(0, (ms - b.fortune) / (520 * this.motion))) : 0;
        // The dice leave with the stele: over the exit they sink and shrink to
        // nothing, or they hang alone over the board after everything else has gone.
        const exitP = ms > b.out ? Math.min(1, (ms - b.out) / Math.max(1, b.end - b.out)) : 0;
        const exitK = 1 - eases.outCubic(Math.min(1, exitP / 0.6));
        r.dice.forEach((d, k) => {
          const p = { ...poses[k], scale: poses[k].scale * exitK || 0.0001, lift: poses[k].lift - exitP * 0.2 };
          d.setPose(p.q); d.pose = p.q;
          if (pair) {
            const glide = eases.inOutCubic(fortP);
            const off = (k ? 0.62 : -0.62) * anchor.size * (k === 0 ? 1 - glide : 1);
            const size = anchor.size * (0.78 + (k === 0 ? 0.22 * glide : 0));
            this.dice.place(d, { x: anchor.x + off, y: anchor.y, size }, p.lift, p.scale);
            if (k === 1) d.shatter?.(fortP);
          } else this.dice.place(d, slots[k], p.lift, p.scale);
        });
        if (kept != null) {
          const die = r.dice[kept], face = r.faceValues[kept];
          if (m.sealed) die.relabel?.(face, ms >= b.land ? "?" : String(face), false);
          // Hot only on the beat a modifier lands. A crit's light is the rim's
          // job: a glyph held hot under DSN's bloom smears into a white face
          // nobody can read — on the one roll everybody is reading.
          else die.relabel?.(face, String(running), hot);
        }

        const degColor = m.degree == null ? P.accent : [P.crimson, P.fail, P.success, P.gold][m.degree];
        const degT = sinceS(ms, b.degree);
        if (slot >= 0) {
          diceA.set([anchor.x * dpr, (height - anchor.y) * dpr, anchor.size * 0.5 * dpr, m.degree == null ? -1 : degT], slot);
          diceB.set([m.degree == null || degT < 0 ? -1 : m.degree, sinceS(ms, b.natural), sinceS(ms, b.land), rate / TUMBLE.spinPeak], slot);
        }
        st = { index: r.i, phase, degree, ms };
        if (r.i === this.focus) {
          const natHot = b.natural != null && ms >= b.natural ? Math.exp(-(ms - b.natural) / 500) : 0;
          lights = {
            rim: rgbHex(degT >= 0 ? degColor : P.accent),
            rimI: 6 + (degT >= 0 ? 14 * Math.exp(-degT * 1.6) + 6 : 0) + natHot * 20, fillI: 0.6 + (hot ? 1.2 : 0), keyI: 1.6,
            ...(this.instance.lights?.(ms, info) ?? {}),
          };
          focusU = {
            uT: ms, uRate: rate / TUMBLE.spinPeak, uArrive: 1,
            uThrowT: Math.max(0, ms) / 1000, uLandT: sinceS(ms, b.land), uNatT: sinceS(ms, b.natural), uDcT: sinceS(ms, b.dcReveal),
            uTallyT: step ? (ms - b.tally[step - 1]) / 1000 : -1, uTallyN: b.tally.length ? step / b.tally.length : 1,
            uDegT: m.degree == null ? -1 : degT, uOutT: sinceS(ms, b.out), uFortT: sinceS(ms, b.fortune),
            uDegree: m.degree ?? -1, uNatural: m.roll?.natural === 20 ? 20 : m.roll?.natural === 1 ? 1 : 0, uCrit: m.crit ? 1 : 0,
            uDegColor: lin(degColor),
            ...(this.instance.uniforms?.(ms, info) ?? {}),
          };
        }
      }
      states.push(st);
    }

    const lead = states.reduce((a, s) => (PHASE_ORDER.indexOf(s.phase) > PHASE_ORDER.indexOf(a.phase) ? s : a), states[0]);
    if (lead && this.root.dataset.phase !== lead.phase) this.root.dataset.phase = lead.phase;
    if (this.rolls.length === 1 && lead) {
      this.root.dataset.degree = lead.degree == null ? "none" : String(lead.degree);
      const r0 = this.rolls[0];
      const nat = lead.ms != null && lead.ms >= (r0.beats?.natural ?? Infinity) ? r0.model.roll?.natural : null;
      if (nat) this.root.dataset.natural = String(nat); else delete this.root.dataset.natural;
    }
    this.instance.after?.(states);

    const gl = this._setRender();
    if (gl) {
      const fa = this.instance.dieAnchor(this.focus);
      this.backdrop.resize(width, height, dpr);
      this.backdrop.frame({
        uRes: [this.backdrop.canvas.width, this.backdrop.canvas.height], uDpr: dpr, uTime: time, uAccent: lin(P.accent), uSeed: 0.37,
        uDie: [fa.x * dpr, (height - fa.y) * dpr], uDieR: fa.size * 0.5 * dpr,
        uThrowT: -1, uLandT: -1, uNatT: -1, uDcT: -1, uTallyT: -1, uTallyN: 0, uDegT: -1, uOutT: -1, uFortT: -1,
        uDegree: -1, uNatural: 0, uCrit: 0, uRate: 0, uArrive: Math.min(1, aMs / ARRIVE_MS), uT: -1, uDegColor: lin(P.accent),
        uDiceA: diceA, uDiceB: diceB, uDiceN: Math.min(MAX_DICE, this.rolls.length), uShed: this.ladder?.level ?? 0,
        ...(focusU ?? {}),
      });
    }
    this.dice.setLights(lights ?? { rim: rgbHex(P.accent), rimI: 6 * appear, fillI: 0.6, keyI: 1.6 * appear });
    this.dice.render();

    if (allEnded && !this.frozen) {
      this.ended = true;
      this.onEnd?.(this);
    }
  }

  destroy() {
    this.ended = true;
    for (const r of this.rolls) r.throwTl?.revert?.();
    this.instance?.arrive?.revert?.();
    this.instance?.destroy?.();
    this.instance = null;
    for (const k of ["back", "front", "cssbg"]) this.layers[k]?.replaceChildren();
    this.dice.clear();
  }
}
