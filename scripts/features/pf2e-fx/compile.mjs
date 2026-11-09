/**
 * Spellsprite — the compiler: an FxSpec to a running Sim. Pure.
 *
 * FxSpec (what semantics.mjs produces and the looks layer patches):
 *
 *   id, seed             stable id and seed (the chat message's)
 *   kind                 "attack" | "save" | "area" | "strike" | "auto" | "self" | "condition" | "tick"
 *   func                 a Spellglass function: "harm" | "restore" | "support" | ...
 *   material, accent     Spellglass materials (accent may be null)
 *   outcome              the primary outcome: "crit" | "hit" | "miss" | "neutral"
 *   rank                 1..10
 *   tradition            "arcane" | "divine" | "occult" | "primal" | null
 *   weapon               { style, ranged, heavy, power } | null   (constants.mjs WEAPON_STYLES;
 *                        heavy: two-handed, power: Vicious Swing toggled; strikes.mjs weightOf)
 *   caster               { id, x, y, size, h } | null   squares; size = footprint, h = height
 *   targets              [{ id, x, y, size, h, outcome }]
 *   area                 { shape, x, y, r, dir, len, width } | null   squares, radians
 *   condition            { slug, value } | null
 *   look                 { hue, flourish, layout } | null
 *   craft                "medicine" | null   a mundane skill drawn as itself (forms.mjs CRAFTS)
 *
 * Outcomes are from the effect's side: "crit" is a critical hit or a critically
 * failed save, "miss" a miss or a successful save (a critical success too),
 * "neutral" a degree this viewer may not see.
 */

import { TAU, clamp } from "./core/rand.mjs";
import { RAMP, rotateRamp, S } from "./core/palette.mjs";
import { Sim } from "./core/sim.mjs";
import { charge, projectile, sd, still } from "./core/motifs.mjs";
import { ART_PER_SQUARE, DELIVERY_GROUPS, FAMILY_OF } from "./constants.mjs";
import { familyModule } from "./families/index.mjs";
import { CRAFTS, FORMS } from "./forms.mjs";
import { ARCH_DRAW } from "./archetypes/index.mjs";
import { STRIKES } from "./strikes.mjs";
import { RANGED } from "./ranged.mjs";
import { HARM, trackWake, wakeFx } from "./deliveries.mjs";
import { MOTIFS } from "./motif-art.mjs";
import { FLAVORS } from "./flavors.mjs";
import { CONDITIONS } from "./conditions.mjs";
import { areaFX, areaMetric, extentOf } from "./area.mjs";

const POW = Object.freeze({ crit: 1.6, hit: 1, miss: 0.3, neutral: 0.85 });
const SAVE_POW = Object.freeze({ crit: 1.6, hit: 1.15, miss: 0.7, neutral: 0.9 });

/** The material an effect draws as: its look's ramp and its family's personality. */
export function resolveMaterial(spec) {
  const material = FAMILY_OF[spec.material] ? spec.material : "neutral";
  const family = FAMILY_OF[material];
  const mod = familyModule(family);
  const bleed = /bleed/.test(spec.condition?.slug ?? "") || spec.condition?.damageType === "bleed";
  let R = (spec.kind === "condition" || spec.kind === "tick") && material === "kinetic" && bleed ? RAMP.bleed : RAMP[material];
  if (Number.isFinite(spec.look?.hue)) R = rotateRamp(R, spec.look.hue);
  return { id: material, material, family, mod, R, dark: !!mod.dark, flicker: family === "arc" };
}

const norm = (x, y) => { const l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
const bodyOf = (T) => ({ size: 1, h: 1, ...T });

/** Where the spell leaves the caster's hand, leaning toward the aim. */
function handOf(caster, aim) {
  const [dx, dy] = aim ? norm(aim.x - caster.x, aim.y - caster.y) : [1, 0];
  return [caster.x + dx * 0.3 * caster.size, caster.y + dy * 0.3 * caster.size, 0.85 * caster.h];
}

/** The linger emitter shared by every family. */
function linger(s, M, x, y, rad, from, to, spotFn = null) {
  if (!M.mod.linger) return;
  const sc = Math.max(rad, 0.45) * s.m;
  const spot = spotFn ?? (() => { const a = s.rand(0, TAU), d = Math.sqrt(s.R()) * rad; return [x + Math.cos(a) * d, y + Math.sin(a) * d]; });
  s.emit(from, to, (s2, u, dt) => {
    const k = 1 - u;
    const at = (rate, mk) => {
      for (let i = s2.count(rate * k * sc, dt); i > 0; i--) { const [px, py] = spot(); s2.add({ x: px, y: py, z: 0.02, R: M.R, ...mk() }); }
    };
    M.mod.linger(s2, M, { at, spot, k, dt, rad, x, y });
  });
}

function release(s, M, x, y, z, pow, rad) {
  M.mod.burst(s, M, { x, y, z, pow, rad });
  if (s.m * pow > 1.25 && pow <= 1.2) s.shake = Math.max(s.shake, 1);
}

/** A flinch and the light on every creature an effect lands on. */
function strikeTargets(s, M, targets, at, from, outcomeOf) {
  targets.forEach((T, i) => s.at(at + i * 0.04, (s2) => {
    const o = outcomeOf(T);
    if (o === "miss" && s2.spec.kind !== "area") return;
    s2.hit(T.id, POW[o] ?? 1, from, M.R);
  }));
}

/** Projectiles: one per target, staggered. Returns the time the last one lands. */
/**
 * A spell with no delivery of its own still flies as deliveries.mjs's comet:
 * a head of 10+ px with a lit wake (spellsprite-craft §1), never the old orb.
 */
function comet(M, r, hero) {
  return {
    r, head: "dlComet",
    props: (s) => ({ hero, wake: r * Math.min(1.5, s.m) * 5 + 18, seed: sd(s) }),
    step: (p, s, dt) => { trackWake(p, dt); wakeFx(s, M, p, dt); },
  };
}

function fire(s, M, hand, targets, start, outcomeOf) {
  let last = start;
  targets.forEach((T, i) => {
    const o = outcomeOf(T), t0 = start + i * 0.12, aim = [T.x - 0.1, T.y, 0.62 * T.h];
    const [ux, uy] = norm(T.x - hand[0], T.y - hand[1]);
    const end = o === "miss" ? [T.x + ux * 1.2 - uy * 1.4, T.y + uy * 1.2 + ux * 1.4, 0.8] : aim;
    const dist = Math.hypot(end[0] - hand[0], end[1] - hand[1]), dur = clamp(0.25 + dist * 0.035, 0.3, 0.7);
    projectile(s, M, hand, end, t0, dur, Math.min(0.6, dist * 0.04), (s2, x, y, z, dt) => M.mod.trail?.(s2, M, { x, y, z, dt }), { bolt: M.mod.projectileBolt, ...comet(M, 6, o === "crit") });
    s.at(t0 + dur, (s2) => {
      if (o === "miss") release(s2, M, ...end, 0.3, 0.25);
      else { release(s2, M, ...aim, POW[o] ?? 1, 0.45); s2.hit(T.id, POW[o] ?? 1, { x: hand[0], y: hand[1] }, M.R); }
    });
    linger(s, M, end[0], end[1], o === "miss" ? 0.25 : 0.45, t0 + dur, t0 + dur + 2);
    last = Math.max(last, t0 + dur);
  });
  return last;
}

/** A lobbed area's projectile radius, art px before rank scaling: a 20-ft burst is about half a square across. */
const lobSize = (rad) => clamp(4.5 + rad * 1.8, 4.5, 12);

/** The cone or line spray: particles poured from the hand along the area. */
function spray(s, M, hand, area, from, to) {
  const half = area.shape === "line" ? Math.atan2(area.width / 2, area.len) * 0.6 : Math.PI / 4;
  const dir = area.dir ?? 0, len = area.len ?? 6;
  s.emit(from, to, (s2, _u, dt) => {
    const emit = (k, rate, mk) => {
      for (let i = s2.count(rate * s2.m, dt); i > 0; i--) {
        const q = dir + s2.rand(-half * 0.9, half * 0.9), sp = s2.rand(7, 10) * (len / 6);
        s2.add({ k, x: hand[0], y: hand[1], z: hand[2] - 0.2, vx: Math.cos(q) * sp, vy: Math.sin(q) * sp, vz: s2.rand(-0.3, 0.5), R: M.R, ...mk() });
      }
    };
    M.mod.spray?.(s2, M, { emit, hand, dir, half, len, dt });
  });
}

/** The radius of a disc with the area's area: how hard the linger pours. */
function equivRadius(G) {
  const a = G.shape === "cone" ? G.half * G.len * G.len : G.shape === "line" ? G.len * G.width : Math.PI * G.r * G.r;
  return Math.min(3, Math.sqrt(a / Math.PI));
}

/** A uniform random ground point inside the area (rejection sampling in its box). */
function spotIn(s, G) {
  const ext = extentOf(G);
  return () => {
    for (let i = 0; i < 12; i++) {
      const x = G.x + s.rand(-ext, ext), y = G.y + s.rand(-ext, ext);
      if (areaMetric(G, x, y)) return [x, y];
    }
    return [G.x, G.y];
  };
}

function areaCentroid(area) {
  if (area.shape === "cone" || area.shape === "line") {
    const L = (area.len ?? 6) * (area.shape === "cone" ? 0.6 : 0.5);
    return [area.x + Math.cos(area.dir ?? 0) * L, area.y + Math.sin(area.dir ?? 0) * L];
  }
  return [area.x, area.y];
}

/* ── the look axes (docs/SPELLSPRITE_LOOK.md) ──────────────────────────── */

/** The spec's motif hooks, or null: a delivery calls the hooks that exist. */
const motifOf = (s) => MOTIFS[s.spec.motif] ?? null;

/**
 * The caster's wind-up: the spec's flavor when it has one, else `fallback`
 * (the generic charge for a spell, nothing for a Strike). True when a flavor drew it.
 */
function windUp(s, M, caster, hand, at, dur, fallback = null) {
  const fl = caster ? FLAVORS[s.spec.flavor] : null;
  if (fl) { fl(s, M, { caster, hand, at, dur }); s.phases.push(`wind-up: ${s.spec.flavor}`); return true; }
  fallback?.();
  return false;
}

/** Everything a strike-shaped timeline needs (strikes.mjs, ranged.mjs). */
function strikeCtx(s, outcomeOf) {
  const sp = s.spec;
  return {
    caster: sp.caster ? bodyOf(sp.caster) : null, targets: sp.targets.map(bodyOf), outcome: outcomeOf,
    release, linger, fire, handOf, POW, motif: motifOf(s),
    windUp: (M, caster, hand, at, dur) => windUp(s, M, caster, hand, at, dur),
  };
}

/** Everything a harm delivery needs (deliveries.mjs). */
function harmCtx(s, M) {
  const sp = s.spec, caster = sp.caster ? bodyOf(sp.caster) : null, targets = sp.targets.map(bodyOf);
  const aim = sp.area ?? targets[0] ?? null;
  return {
    caster, targets, area: sp.area, hand: caster ? handOf(caster, aim) : null,
    outcomeOf: (T) => T.outcome ?? sp.outcome ?? "neutral",
    release, linger, fire, spray, areaFX, areaMetric, areaCentroid, equivRadius, spotIn, lobSize, charge, projectile, handOf,
    POW, SAVE_POW, motif: motifOf(s),
    windUp: (caster2, hand2, at, dur, opts) => windUp(s, M, caster2, hand2, at, dur, () => charge(s, M, hand2, caster2, at, at + dur, opts)),
  };
}

/** A strike-shaped delivery's timeline (a Strike, or a Rend or a Trample that is not one). */
const strikeTimeline = (d) => (DELIVERY_GROUPS.ranged.includes(d) ? RANGED[d] ?? STRIKES[d] : STRIKES[d] ?? RANGED[d]) ?? null;

/* ── the timelines ───────────────────────────────────────────────────── */

function buildHarm(s, M) {
  const sp = s.spec, P = s.phases;
  const delivery = HARM[sp.delivery];
  if (delivery) { delivery(s, M, harmCtx(s, M)); return; }
  const asStrike = sp.targets.length && !sp.area ? strikeTimeline(sp.delivery) : null;
  if (asStrike) { asStrike(s, M, strikeCtx(s, sp.kind === "auto" ? () => "hit" : (T) => T.outcome ?? sp.outcome ?? "neutral")); return; }
  const caster = sp.caster ? bodyOf(sp.caster) : null, targets = sp.targets.map(bodyOf);
  const outcomeOf = (T) => T.outcome ?? sp.outcome ?? "neutral";
  const aim = sp.area ?? targets[0] ?? null;
  const hand = caster ? handOf(caster, aim) : null;
  const lobbed = sp.area && !["cone", "line", "emanation", "aura"].includes(sp.area.shape);
  const chargeEnd = caster ? (lobbed ? 0.5 : 0.4) : 0;
  if (caster) { windUp(s, M, caster, hand, 0, chargeEnd, () => charge(s, M, hand, caster, 0, chargeEnd, { size: lobbed ? lobSize(Math.max(0.5, sp.area.r ?? 1)) : null })); P.push("charge"); }

  if (sp.area) {
    const A = sp.area, rad = Math.max(0.5, A.r ?? 1);
    const primary = targets.reduce((best, T) => (POW[outcomeOf(T)] > POW[best] ? outcomeOf(T) : best), sp.outcome ?? "neutral");
    const pow = SAVE_POW[primary] ?? 1;
    if (A.shape === "cone" || A.shape === "line") {
      const origin = hand ?? [A.x, A.y, 0.6];
      const { G, shockDur } = areaFX(s, M, A, { tele0: 0, hitAt: chargeEnd, pow });
      spray(s, M, origin, A, chargeEnd, chargeEnd + 0.45);
      targets.forEach((T) => {
        const m = areaMetric(G, T.x, T.y), d = m ? m.d : 1, o = outcomeOf(T);
        const t = chargeEnd + d * shockDur * 0.95 + 0.02;
        s.at(t, (s2) => { M.mod.burst(s2, M, { x: T.x, y: T.y, z: 0.6 * T.h, pow: Math.min(SAVE_POW[o] ?? 1, o === "crit" ? 1.3 : 0.8), rad: 0.35 }); s2.hit(T.id, SAVE_POW[o] ?? 1, { x: origin[0], y: origin[1] }, M.R); });
      });
      const [cx, cy] = areaCentroid(A);
      linger(s, M, cx, cy, equivRadius(G), chargeEnd + shockDur, chargeEnd + 2.6, spotIn(s, G));
      P.push(`${A.shape} spray`, "hits by distance", "linger");
      s.period = chargeEnd + 3.2;
      return;
    }
    const emanation = A.shape === "emanation" || A.shape === "aura";
    const c = [A.x, A.y, 0.35];
    let landAt = chargeEnd;
    if (hand && !emanation) {
      const dist = Math.hypot(c[0] - hand[0], c[1] - hand[1]), dur = clamp(0.35 + dist * 0.04, 0.45, 0.9);
      // a lob carries the whole area: it is drawn at a size that promises it (a fireball, not a spark)
      const size = lobSize(rad);
      projectile(s, M, hand, c, chargeEnd, dur, Math.min(2, 0.6 + dist * 0.12), (s2, x, y, z, dt) => M.mod.trail?.(s2, M, { x, y, z, dt, scale: size / 3 }), { bolt: M.mod.projectileBolt, r: size, big: true, ...comet(M, size, false) });
      landAt = chargeEnd + dur;
      P.push("lob");
    }
    const { G, shockDur } = areaFX(s, M, A, { tele0: Math.min(0.12, chargeEnd), hitAt: landAt, pow });
    if (!emanation) s.at(landAt, (s2) => release(s2, M, ...c, pow * 1.1, Math.min(rad, 1.4)));
    targets.forEach((T, i) => {
      const m = areaMetric(G, T.x, T.y), d = m ? m.d : 1;
      s.at(landAt + d * shockDur * 0.95 + 0.02 * i, (s2) => s2.hit(T.id, SAVE_POW[outcomeOf(T)] ?? 1, { x: c[0], y: c[1] - 0.01 }, M.R));
    });
    linger(s, M, c[0], c[1], equivRadius(G), landAt + shockDur, landAt + 2.8, spotIn(s, G));
    P.push(`${A.shape} ${Math.round(rad * 5)} ft`, "linger");
    s.period = landAt + 3.6;
    return;
  }

  if (!targets.length) {
    // a harmful effect with no target and no area: release at the hand
    const at = hand ?? [caster?.x ?? 0, caster?.y ?? 0, 0.6];
    s.at(chargeEnd, (s2) => release(s2, M, ...at, 0.6, 0.3));
    s.period = chargeEnd + 2;
    return;
  }

  const from = hand ?? [targets[0].x - 1, targets[0].y, 0.8];
  const land = fire(s, M, from, targets, chargeEnd, sp.kind === "auto" ? () => "hit" : outcomeOf);
  P.push("travel", "impact");
  s.period = land + 2.6;
}

function buildStrike(s, M) {
  const sp = s.spec;
  const style = strikeTimeline(sp.delivery) ?? STRIKES[sp.weapon?.style] ?? STRIKES.slash;
  style(s, M, strikeCtx(s, (T) => T.outcome ?? sp.outcome ?? "neutral"));
}

function buildForm(s, M, drawer = null) {
  const sp = s.spec, caster = sp.caster ? bodyOf(sp.caster) : null, targets = sp.targets.map(bodyOf);
  const aim = sp.area ?? targets[0] ?? null;
  const hand = caster ? handOf(caster, aim) : null;
  const self = sp.kind === "self" || (!targets.length && !sp.area);
  // a craft (medicine) is a skill, not a spell: no charge, no circle, no material light
  const craft = CRAFTS[sp.craft];
  if (craft) { craft(s, M, { caster, targets: targets.length ? targets : caster ? [caster] : [], area: null, hand, t0: 0, release, linger, fire, self }); return; }
  // a maneuver (archetypes/body.mjs) is a body moving, not a spell: no glyph circle, no orb at
  // the hand, only a beat for the drawer's own anticipation. A spell that grabs still charges.
  const maneuver = !!drawer?.noCharge && !sp.cast;
  const chargeEnd = maneuver ? (caster ? 0.1 : 0) : caster && !self ? 0.4 : caster ? 0.3 : 0;
  if (caster && !maneuver) { windUp(s, M, caster, hand, 0, chargeEnd, () => charge(s, M, hand, caster, 0, chargeEnd)); s.phases.push("charge"); }
  /* A helpful or controlling area still reads as its whole footprint: the
     indicator, a soft flash and the wave, without the scar or the eruptions. */
  if (sp.area) areaFX(s, M, sp.area, { tele0: 0, hitAt: Math.max(chargeEnd, 0.3), pow: 1, gentle: sp.func !== "hinder" && sp.func !== "control", erupt: false, linger: 1.4 });
  const form = drawer ?? FORMS[sp.func] ?? FORMS.neutral;
  if (drawer) s.phases.push(`arch: ${sp.arch}`);
  const on = self && caster ? [caster] : targets;
  form(s, M, { caster, targets: on, area: sp.area, hand, t0: chargeEnd, release, linger, fire, self });
  // the named object appears where the form lands: a Spiritual Armament's weapon, a Shield's shield
  const conjure = motifOf(s)?.conjure;
  if (conjure) {
    const spots = on.length ? on : sp.area ? [{ x: sp.area.x, y: sp.area.y, h: 1 }] : [];
    for (const T of spots) conjure(s, M, { x: T.x, y: T.y, z: 0, h: T.h ?? 1, at: chargeEnd, life: Math.max(1, (s.period ?? 2) - chargeEnd) });
    s.phases.push(`motif: ${sp.motif}`);
  }
}

function buildCondition(s, M) {
  const sp = s.spec, T = bodyOf(sp.targets[0] ?? sp.caster ?? { x: 0, y: 0 });
  const overlay = CONDITIONS[sp.condition?.slug] ?? null;
  const usesFamily = !overlay || overlay.family !== false;
  const R = M.R;
  const body = (onBody) => { const a = s.rand(0, TAU), d = s.rand(0.15, 0.36) * T.size; return { x: T.x + Math.cos(a) * d, y: T.y + Math.sin(a) * d * 0.6, z: onBody ? s.rand(0, 0.75) * T.h : 0.02 }; };
  if (usesFamily) {
    M.mod.auraStart?.(s, M, T);
    if (!M.dark && M.family !== "physical" && M.family !== "corrode") s.light(T.x, T.y, 0.5 * T.h, 1.4 * T.size, S(R, 0.85), 0.45, 1e9);
    if (M.dark) s.light(T.x, T.y, 0.5 * T.h, 1.4 * T.size, S(R, 0.85), 0.25, 1e9);
  }
  overlay?.start?.(s, M, T);
  let tick = -1;
  s.emit(0, 1e9, (s2, _u, dt) => {
    const at = (rate, mk, onBody = true) => { for (let i = s2.count(rate * s2.m, dt); i > 0; i--) s2.add({ ...body(onBody), R, ...mk() }); };
    // a condition with its own wrap thins the family aura under it, or the two bury the token's face
    if (usesFamily) {
      const k = overlay?.familyScale ?? 1;
      M.mod.aura?.(s2, M, k === 1 ? { at, body, T, dt } : { at: (rate, mk, onBody) => at(rate * k, mk, onBody), body, T, dt: dt * k });
    }
    overlay?.loop?.(s2, M, { at, body, T, dt });
    const k = Math.floor(s2.t / 1.4);
    if (k !== tick) {
      tick = k;
      if (!usesFamily && !overlay?.tickRing) return;
      s2.add({ k: "ring", x: T.x, y: T.y, r: 0.65 * T.size, life: 0.5, R, broken: true, seed: k + 1, update: still });
      if (sp.look?.flourish === "runes") s2.add({ k: "glyph", x: T.x, y: T.y, r: 0.55 * T.size, life: 1.3, R, star: true, update: still });
      s2.light(T.x, T.y, 0.6 * T.h, 1.8 * T.size, S(R, 0.85), 0.9, 0.6);
      M.mod.tick?.(s2, M, T);
      if (!M.mod.gentle && !overlay?.gentle) s2.hit(T.id, 0.6, { x: T.x - 1, y: T.y }, R);
    }
  });
  s.phases.push(`loop: ${sp.condition?.slug ?? M.material}`);
  s.period = Infinity;
}

function buildTick(s, M) {
  const T = bodyOf(s.spec.targets[0] ?? { x: 0, y: 0 });
  s.add({ k: "ring", x: T.x, y: T.y, r: 0.65 * T.size, life: 0.5, R: M.R, broken: true, seed: sd(s), update: still });
  M.mod.burst(s, M, { x: T.x, y: T.y, z: 0.6 * T.h, pow: 0.55, rad: 0.3 * T.size });
  if (!M.mod.gentle) s.hit(T.id, 0.6, { x: T.x - 1, y: T.y }, M.R);
  s.phases.push("tick");
  s.period = 2;
}

/**
 * Compile a spec into a fresh Sim.
 * @param {object} spec
 * @returns {Sim}
 */
export function compile(spec) {
  const full = {
    targets: [], caster: null, area: null, outcome: "neutral", rank: 1, func: "harm", kind: "attack",
    ...spec,
    aps: ART_PER_SQUARE,
  };
  full.targets = (full.targets ?? []).filter((T) => Number.isFinite(T?.x) && Number.isFinite(T?.y));
  const s = new Sim(full, full.seed ?? 1);
  s.props = new Set(full.props ?? []);
  if (Number.isInteger(full.look?.layout)) s.take = full.look.layout % 3;
  s.m = 0.55 + 0.09 * clamp(full.rank ?? 1, 1, 10);
  const M = resolveMaterial(full);
  s.M = M;
  // named for the caster's token, so a 3D host can hide its billboard from a viewer who cannot see it
  if (full.caster) s.site(full.caster.id ?? "caster", full.caster.x, full.caster.y);
  for (const T of full.targets) s.site(T.id ?? `t${s.sites.length}`, T.x, T.y);
  if (full.area) { const [cx, cy] = areaCentroid(full.area); s.site("area", cx, cy); }
  if (!s.sites.length) s.site("origin", 0, 0);

  if (full.kind === "condition") buildCondition(s, M);
  else if (full.kind === "tick") buildTick(s, M);
  else if (full.kind === "strike") buildStrike(s, M);
  // an archetype (archetypes/rules.mjs) is one animation shared by every document that means the same thing
  else if (ARCH_DRAW[full.arch]) buildForm(s, M, ARCH_DRAW[full.arch]);
  else if (full.func === "harm" || full.func === "hazard") buildHarm(s, M);
  else buildForm(s, M);
  return s;
}
