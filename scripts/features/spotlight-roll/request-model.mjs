/**
 * The shape of a spotlight request, and what one screen is allowed to see of it.
 *
 * Pure. Two documents carry a spotlight, deliberately apart:
 *
 *   the REQUEST  (`dr.active`, a world setting the GM writes) — who rolls what,
 *                each slot's modifier chips, when each slot was thrown. Every
 *                client receives it, so it carries NOTHING a player may not see:
 *                no hidden DC, no result.
 *   a RESULT     (a socket message from the GM to exactly the users entitled
 *                to it, server-filtered) — the dice, the total, the degree.
 *
 * A screen with no result for a thrown slot plays it SEALED: the die tumbles
 * and lands on a face that means nothing. `viewModel()` is the only place the
 * two are joined into what the overlay draws.
 */
import { CHECK_KINDS, LAYOUTS, AUDIENCES, DC_MODES, FORTUNE, MAX_ROLLERS, MAX_FORMULA_DICE, FORMULA_FACES } from "./constants.mjs";
import { DEGREE_KEYS } from "../../core/pf2e-degree.mjs";

const str = (v, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
const int = (v, d = 0) => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);
const numOrNull = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Math.trunc(Number(v)));

function normalizeMod(m) {
  return { slug: str(m?.slug, 80), label: str(m?.label, 80), value: int(m?.value), kind: str(m?.kind, 40) || "untyped", enabled: m?.enabled !== false };
}

function normalizeSlot(s) {
  const diceSpec = (Array.isArray(s?.diceSpec) ? s.diceSpec : [20]).map((f) => int(f, 20)).filter((f) => FORMULA_FACES.includes(f)).slice(0, MAX_FORMULA_DICE * 2);
  return {
    actorUuid: str(s?.actorUuid, 200),
    tokenUuid: str(s?.tokenUuid, 200) || null,
    name: str(s?.name, 120),
    title: str(s?.title, 120),
    img: str(s?.img, 500),
    userId: str(s?.userId, 40) || null,
    appearanceUserId: str(s?.appearanceUserId, 40) || null,
    mods: (Array.isArray(s?.mods) ? s.mods : []).slice(0, 24).map(normalizeMod),
    diceSpec: diceSpec.length ? diceSpec : [20],
    throw: s?.throw && Number.isFinite(Number(s.throw.at)) ? { at: Number(s.throw.at), seed: int(s.throw.seed, 1), seq: int(s.throw.seq, 0) } : null,
  };
}

/** Total: whatever is stored, a well-formed request or null. */
export function normalizeRequest(raw) {
  if (!raw || typeof raw !== "object" || !raw.id) return null;
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).slice(0, MAX_ROLLERS).map(normalizeSlot);
  if (!slots.length) return null;
  const dcMode = oneOf(raw.dc?.mode, DC_MODES, "shown");
  return {
    id: str(raw.id, 40),
    createdAt: Number(raw.createdAt) || 0,
    layout: oneOf(raw.layout, LAYOUTS, "single"),
    title: str(raw.title, 120),
    check: {
      kind: oneOf(raw.check?.kind, CHECK_KINDS, "skill"),
      slug: str(raw.check?.slug, 80),
      label: str(raw.check?.label, 80),
      formula: str(raw.check?.formula, 120) || null,
      traits: (Array.isArray(raw.check?.traits) ? raw.check.traits : []).map((t) => str(t, 40)).filter(Boolean).slice(0, 8),
    },
    // The value is stored only when players may see it.
    dc: { mode: dcMode, value: dcMode === "shown" ? numOrNull(raw.dc?.value) : null, has: !!raw.dc?.has || numOrNull(raw.dc?.value) != null },
    audience: oneOf(raw.audience, AUDIENCES, "all"),
    fortune: oneOf(raw.fortune, FORTUNE, "none"),
    bonus: int(raw.bonus),
    defender: raw.defender && raw.layout === "opposed" ? {
      name: str(raw.defender.name, 120), title: str(raw.defender.title, 120), img: str(raw.defender.img, 500),
      statistic: str(raw.defender.statistic, 80),
    } : null,
    slots,
    closed: !!raw.closed,
  };
}

/** Total: a result payload, or null. */
export function normalizeResult(raw) {
  if (!raw || typeof raw !== "object" || !raw.reqId) return null;
  const sealed = !!raw.sealed;
  const dice = (Array.isArray(raw.roll?.dice) ? raw.roll.dice : []).slice(0, MAX_FORMULA_DICE * 2).map((d) => ({ faces: int(d?.faces, 20), value: int(d?.value, 1) }));
  return {
    reqId: str(raw.reqId, 40),
    slot: int(raw.slot),
    seq: int(raw.seq),
    at: Number(raw.at) || 0,
    seed: int(raw.seed, 1),
    sealed,
    canReroll: !sealed && !!raw.canReroll,
    roll: sealed ? null : {
      natural: numOrNull(raw.roll?.natural),
      total: numOrNull(raw.roll?.total),
      dropped: numOrNull(raw.roll?.dropped),
      dice,
    },
    dc: sealed ? null : numOrNull(raw.dc),
    degree: sealed || raw.degree == null ? null : Math.max(0, Math.min(3, int(raw.degree))),
    mods: sealed ? null : (Array.isArray(raw.mods) ? raw.mods.slice(0, 24).map(normalizeMod) : null),
  };
}

const KIND_KEY = { skill: "GLSR.kind.skill", lore: "GLSR.kind.skill", save: "GLSR.kind.save", perception: "GLSR.kind.perception", flat: "GLSR.kind.flat", formula: "GLSR.kind.formula" };

/**
 * What the overlay draws for one slot on THIS screen.
 * @param {object} req      normalized request
 * @param {number} i        slot index
 * @param {object|null} res normalized result this client received for the slot's current throw, if any
 * @param {{ t: (k: string) => string }} i18n
 * @param {{ dcValue?: number|null, mayReroll?: (i: number) => boolean }} [gm]
 *        the GM's own copy of a DC players may not see; who may press reroll here
 */
export function viewModel(req, i, res, i18n, gm = {}) {
  const s = req.slots[i];
  const mods = (res?.mods ?? s.mods).map((m) => ({ ...m, optional: true }));
  const modTotal = mods.filter((m) => m.enabled).reduce((a, m) => a + m.value, 0);
  const thrown = !!s.throw;
  const sealed = thrown && !res;
  const dcVal = res?.dc ?? (req.dc.mode === "shown" ? req.dc.value : gm.dcValue ?? null);
  const degree = res?.degree ?? null;
  const fortune = req.fortune === "none" ? null : req.fortune;
  return {
    actor: { name: s.name, title: s.title, img: s.img },
    request: { title: req.title, check: req.check.label, kind: i18n.t(KIND_KEY[req.check.kind]), traits: req.check.traits },
    dc: { value: thrown || req.dc.mode === "shown" || gm.dcValue != null ? dcVal : null, mode: req.dc.has ? req.dc.mode : "none" },
    mods,
    modTotal,
    formula: req.check.kind === "formula" ? req.check.formula : null,
    diceSpec: s.diceSpec,
    sealed,
    roll: {
      fortune,
      natural: res?.roll?.natural ?? null,
      total: res?.roll?.total ?? null,
      dropped: res?.roll?.dropped ?? null,
      dice: res?.roll?.dice ?? [],
    },
    degree,
    degreeKey: degree == null ? null : DEGREE_KEYS[degree],
    crit: degree === 0 || degree === 3,
    canReroll: !!res?.canReroll && degree != null && !!gm.mayReroll?.(i),
  };
}

/** The whole request as the overlay's ctx.request. */
export function viewRequest(req, results, i18n, gm = {}) {
  const rolls = req.slots.map((_, i) => viewModel(req, i, results[i] ?? null, i18n, gm));
  return {
    layout: req.layout,
    rolls,
    defender: req.defender ? {
      actor: { name: req.defender.name, title: req.defender.title, img: req.defender.img },
      statistic: req.defender.statistic,
      dc: rolls[0].dc.value,
    } : null,
    sharedDc: req.layout === "group" && req.dc.has ? { value: rolls[0].dc.value, mode: req.dc.mode } : null,
  };
}

/**
 * Split a d100 result into the tens and units dice it shows: 37 → 30 + 7,
 * 40 → 40 + 10 ("0"), 100 → 100 ("00") + 10 ("0"), 7 → 100 ("00") + 7.
 */
export function splitD100(r) {
  const tens = r === 100 ? 100 : Math.floor(r / 10) * 10 || 100;
  return [{ faces: 100, value: tens }, { faces: 10, value: r % 10 || 10 }];
}

/**
 * The dice a free formula throws, as faces, from its source text. Only the
 * standard polyhedra are thrown; anything else in the formula (flat terms,
 * modifiers) is tallied, not thrown. Returns null if it throws nothing or too much.
 */
export function formulaDice(formula) {
  const faces = [];
  for (const m of String(formula ?? "").matchAll(/(\d*)d(\d+)/gi)) {
    const n = m[1] === "" ? 1 : Number(m[1]), f = Number(m[2]);
    if (!FORMULA_FACES.includes(f)) return null;
    // A d100 is thrown as DSN throws it: a tens d10 (faces 100) and a units d10.
    for (let k = 0; k < n; k++) faces.push(...(f === 100 ? [100, 10] : [f]));
    if (faces.length > MAX_FORMULA_DICE) return null;
  }
  return faces.length ? faces : null;
}
