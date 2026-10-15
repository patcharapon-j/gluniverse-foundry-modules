/**
 * Asking PF2e for a check's numbers without rolling it.
 *
 * Every modifier, every stacking rule, the DC, fortune and misfortune, and the
 * degree-of-success adjustments are PF2e's own. A check is started down its
 * real path — a Strike variant's `roll`, a statistic's `roll`, a spell's
 * `rollAttack` — tagged with a roll option, and the `Check.roll` handler below
 * catches the tagged call *before* PF2e's own body runs: no dialog, no dice, no
 * message, no rule element's afterRoll. That is the same probe Spotlight Roll
 * uses for its pre-roll chips (spotlight-roll/pf2e-roll.mjs), on the suite's
 * shared wrapper dispatcher, which composes handlers per target — so this
 * feature and Spotlight each own one handler and neither has to know.
 *
 * A Strike's identifier is PF2e's, not ours, so the tag rides the roll options
 * (`options` on a Strike variant, `extraRollOptions` on a statistic), which
 * both paths carry into `context.options`.
 *
 * ## Bare and situational
 *
 * Knowledge is stored about the BARE stat: the number with the status and
 * circumstance modifiers the table can see taken off. `bare` is that
 * subtraction, and it is applied the same way when an observation is folded in
 * (on the GM's client) and when a known range is turned back into today's DC
 * (on everyone's). See ledger-model.mjs.
 */

import { registerWrapper, MIXED } from "../../core/wrapper.mjs";
import { warn } from "../../core/const.mjs";
import { PROBE_TAG, SKILL_ACTIONS, TIMING, isPublicModifier } from "./constants.mjs";

const PENDING = new Map();
let installed = false;

const tagOf = (id) => `${PROBE_TAG}:${id}`;

function jobFor(context) {
  const opts = context?.options;
  if (!opts) return null;
  for (const o of opts instanceof Set ? opts : Array.isArray(opts) ? opts : []) {
    if (typeof o === "string" && o.startsWith(`${PROBE_TAG}:`)) return PENDING.get(o.slice(PROBE_TAG.length + 1)) ?? null;
  }
  return null;
}

/** Wrap PF2e's `Check.roll` once. Safe to call repeatedly. */
export function installProbe() {
  if (installed || !game.pf2e?.Check?.roll) return installed;
  registerWrapper(
    "game.pf2e.Check.roll",
    function (next, check, context = {}, ...rest) {
      const job = jobFor(context);
      if (!job) {
        stampDcDelta(context);
        return next(check, context, ...rest);
      }
      try {
        const options = context.options instanceof Set ? context.options : new Set(context.options ?? []);
        check.calculateTotal(options);
        job.result = {
          mod: check.totalModifier,
          mods: modsOf(check),
          dc: Number.isFinite(context.dc?.value) ? { value: context.dc.value, slug: context.dc.slug ?? null } : null,
          dcStatistic: context.dc?.statistic ?? null,
          rollTwice: rollModeOf(context.rollTwice, context.substitutions),
          dos: (context.dosAdjustments ?? []).map((d) => ({
            adjustments: d.adjustments,
            test: (o) => (d.predicate?.test ? d.predicate.test(o) : true),
          })),
          options: [...options].filter((o) => !o.startsWith(PROBE_TAG)),
          type: context.type ?? null,
          traits: [...(context.traits ?? [])].map((t) => (typeof t === "string" ? t : t?.name)).filter(Boolean),
        };
      } catch (error) {
        job.error = error;
      }
      return Promise.resolve(null);
    },
    MIXED
  );
  installed = true;
  return true;
}

/**
 * How the d20 is rolled, as the engine's `rollTwice`.
 *
 * A selected substitution ("treat the roll as 18") is not a second die: it
 * FIXES the face, so it comes back as `{fixed}` and the engine weights that one
 * face. Fortune and misfortune together cancel — the substitution with them,
 * since a substitution carries its own fortune or misfortune type (PF2e's
 * own rule) — and the check is a single flat d20.
 */
export function rollModeOf(rollTwice, substitutions = []) {
  const chosen = (substitutions ?? []).filter?.((s) => s?.selected) ?? [];
  const fortune = rollTwice === "keep-higher" || chosen.some((s) => s.effectType === "fortune");
  const misfortune = rollTwice === "keep-lower" || chosen.some((s) => s.effectType === "misfortune");
  if (fortune && misfortune) return false;
  const fixed = chosen.find((s) => Number.isFinite(Number(s.value)));
  if (fixed) return { fixed: Math.max(1, Math.min(20, Number(fixed.value))) };
  return fortune ? "keep-higher" : misfortune ? "keep-lower" : false;
}

export function modsOf(check) {
  return (check?.modifiers ?? [])
    .filter((m) => !(m.hideIfDisabled && !m.enabled && m.ignored))
    .map((m) => ({ slug: m.slug, label: m.label, value: m.modifier, kind: m.type ?? "untyped", enabled: !!m.enabled && !m.ignored }));
}

/**
 * The part of a creature's modifier list the table can see happening: status
 * and circumstance modifiers from a public source (constants.mjs). A private
 * one stays inside the bare number — honest, since nobody saw it; when it ends
 * the next roll may contradict, and the ledger resets.
 */
export const situational = (mods) =>
  (mods ?? []).filter(
    (m) => m.enabled && (m.kind === "status" || m.kind === "circumstance") && m.slug !== "multiple-attack-penalty" && isPublicModifier(m)
  );

const sum = (mods) => mods.reduce((a, m) => a + (Number(m.value) || 0), 0);

/** A check's bare modifier: no MAP, no status or circumstance. */
export function bareMod(result) {
  const map = (result?.mods ?? []).filter((m) => m.enabled && m.slug === "multiple-attack-penalty");
  return result.mod - sum(map) - sum(situational(result.mods));
}

/** A statistic DC's bare value: the same subtraction on the DC's own modifiers. */
export function bareDc(dcStatistic, value) {
  const mods = (dcStatistic?.modifiers ?? []).map((m) => ({
    slug: m.slug,
    value: m.modifier,
    kind: m.type ?? "untyped",
    enabled: !!m.enabled && !m.ignored,
  }));
  return value - sum(situational(mods));
}

/**
 * A real roll: write today's situational DC delta onto the context, measured
 * on the CONTEXTUAL DC statistic (flanking's off-guard lives on a clone of the
 * target made for this one roll, and nowhere else). PF2e copies the context
 * into the message's flags, which is how the GM's observer reads it.
 */
function stampDcDelta(context) {
  try {
    const dc = context?.dc;
    if (dc?.statistic && Number.isFinite(dc.value)) context.glodDcDelta = dc.value - bareDc(dc.statistic, dc.value);
  } catch {
    /* never in the way of a real roll */
  }
}

/* ── the probes ──────────────────────────────────────────────────────────── */

async function run(start) {
  if (!installProbe()) return null;
  const id = foundry.utils.randomID();
  const job = {};
  PENDING.set(id, job);
  try {
    await start(tagOf(id));
  } catch (error) {
    warn("pf2e-odds | probe failed", error);
    return null;
  } finally {
    PENDING.delete(id);
  }
  if (job.error) warn("pf2e-odds | probe could not total the check", job.error);
  return job.result ?? null;
}

/** An actor's Strike by slug (or the first), from PF2e's prepared actions. */
export function strikeOf(actor, slug = null) {
  const strikes = (actor?.system?.actions ?? []).filter((a) => a?.type === "strike" || a?.variants);
  if (!strikes.length) return null;
  if (!slug) return primaryStrike(actor);
  return strikes.find((s) => (s.slug ?? s.item?.slug) === slug) ?? null;
}

/**
 * The Strike a line shows when nothing is armed: a ready, wielded weapon with
 * the best attack bonus; for an NPC, its best attack.
 */
export function primaryStrike(actor) {
  const strikes = (actor?.system?.actions ?? []).filter((a) => a?.variants && (a.ready ?? true));
  if (!strikes.length) return null;
  return strikes.reduce((best, s) => ((s.totalModifier ?? -99) > (best.totalModifier ?? -99) ? s : best));
}

const tokenObject = (token) => token?.object ?? token ?? null;

/** Probe a Strike variant (0 = first attack, 1 and 2 = MAP) against a target token. */
export function probeStrike(actor, { slug = null, map = 0, target = null } = {}) {
  const strike = strikeOf(actor, slug);
  const variant = strike?.variants?.[Math.max(0, Math.min(2, map | 0))] ?? strike?.variants?.[0];
  if (!variant?.roll) return Promise.resolve(null);
  // consumeAmmo: false — PF2e checks (and toasts about) ammunition before the
  // check is ever built, and a probe must never warn a player about anything.
  return run((tag) => variant.roll({ target: tokenObject(target), options: [tag], createMessage: false, consumeAmmo: false, skipDialog: true })).then((r) =>
    r ? { ...r, strike: { slug: strike.slug ?? strike.item?.slug ?? null, label: strike.label ?? strike.item?.name ?? "", agile: !!strike.item?.traits?.has?.("agile") } } : null
  );
}

/**
 * Probe a skill action (Demoralize, Grapple…) against a target actor's defence.
 * Attack-trait actions take the MAP through PF2e's own `attackNumber`, except
 * that PF2e only computes it when an item is involved, so for a bare skill
 * action it is passed as a modifier of PF2e's own slug.
 */
export function probeSkillAction(actor, action, { target = null, map = 0 } = {}) {
  const def = SKILL_ACTIONS[action];
  const stat = def ? actor?.skills?.[def.skill] : null;
  if (!stat?.roll) return Promise.resolve(null);
  const targetActor = target?.actor ?? null;
  const modifiers = [];
  if (def.attack && map > 0 && game.pf2e?.Modifier) {
    modifiers.push(
      new game.pf2e.Modifier({ slug: "multiple-attack-penalty", label: "PF2E.MultipleAttackPenalty", modifier: map === 1 ? -5 : -10, type: "untyped" })
    );
  }
  // PF2e's own action first: its checkContext adds what the action brings —
  // a trip weapon's potency on Trip, ranged-trip's −2, a grapple weapon on
  // Grapple — none of which a bare skill roll carries. The MAP rides as our
  // own slugged modifier (the action's `multipleAttackPenalty` slugs it from
  // its label), so bareMod can still find it.
  const pf2eAction = game.pf2e?.actions?.get?.(action);
  if (typeof pf2eAction?.use === "function") {
    return run((tag) =>
      pf2eAction.use({
        actors: [actor],
        target: tokenObject(target) ?? targetActor ?? undefined,
        modifiers,
        rollOptions: [tag],
        message: { create: false },
      })
    );
  }
  return run((tag) =>
    stat.roll({
      target: targetActor,
      dc: { slug: def.against },
      extraRollOptions: [tag, `action:${action}`],
      traits: def.attack ? ["attack"] : [],
      modifiers,
      skipDialog: true,
      createMessage: false,
    })
  );
}

/** Probe a spell attack roll against a target actor. */
export function probeSpellAttack(spell, { target = null, map = 0 } = {}) {
  if (!spell?.rollAttack) return Promise.resolve(null);
  return run((tag) => spell.rollAttack(null, Math.max(1, map + 1), { extraRollOptions: [tag], target: target?.actor ?? null, createMessage: false, skipDialog: true }));
}

/**
 * Probe a creature's save against a DC (the target's side of the caster's
 * spell). PF2e's incapacitation and the target's own Evasion-likes arrive in
 * `dos`.
 */
export function probeSave(saver, save, { dc, origin = null, item = null } = {}) {
  const stat = saver?.saves?.[save];
  if (!stat?.roll || !Number.isFinite(dc)) return Promise.resolve(null);
  return run((tag) =>
    stat.roll({ dc: { value: dc }, origin, item, extraRollOptions: [tag], skipDialog: true, createMessage: false })
  );
}

/* ── a small cache, so a hovering cursor does not re-run PF2e every frame ── */

const CACHE = new Map();

/**
 * Memoise a probe by key for `TIMING.probeTtl`. The key must carry everything
 * the answer depends on; `invalidate()` drops the lot when a document moves.
 */
export function cached(key, start) {
  const hit = CACHE.get(key);
  const now = Date.now();
  if (hit && now - hit.at < TIMING.probeTtl) return hit.promise;
  const promise = start();
  CACHE.set(key, { at: now, promise });
  return promise;
}

/**
 * Drop cached probes. With `uuids`, only answers that mention one of them
 * (keys carry the roller's actor uuid and the target's token uuid), so an
 * HP change on one creature does not re-probe every open sheet.
 */
export function invalidate(uuids = null) {
  if (!uuids) return CACHE.clear();
  const list = [...uuids].filter(Boolean);
  for (const key of CACHE.keys()) if (list.some((u) => key.includes(u))) CACHE.delete(key);
}
