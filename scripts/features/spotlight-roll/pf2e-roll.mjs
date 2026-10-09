/**
 * Rolling a spotlit check through PF2e itself — on the GM's client.
 *
 * Every number here is PF2e's: the modifier list, the stacking, the DC, the
 * fortune/misfortune keep, and the FINAL degree (after Juggernaut-style degree
 * adjustments, which nothing outside PF2e can see). We only steer the roll and
 * hold its chat card:
 *
 *   • `createMessage: false` + the callback hands us the exact message data
 *     (`msg.toObject()`), which is posted, unchanged but for audience and
 *     timestamp, when the degree lands on screen. PF2e's apply and reroll
 *     buttons work on it because they read `flags.pf2e.context` and the
 *     CheckRoll class, both of which survive.
 *   • Modifier toggles cannot be set before the roll: `Modifier#test()` resets
 *     `ignored` on predicated modifiers and the stacking rules re-pick the
 *     attribute. So `Check.roll` is wrapped and, for OUR identifier only, the
 *     check's `calculateTotal` is shadowed: after PF2e's own pass with the full
 *     roll options, the user's choices are applied and stacking re-run — the
 *     same thing PF2e's check dialog does when you tick a box.
 *   • A probe (the pre-roll chip list) goes down the same path and returns null
 *     from inside the wrapper, before anything is evaluated, so no rule
 *     element's afterRoll runs.
 *
 * There is no `rollMode` in PF2e 8.4 (it is dropped silently); the message mode
 * we want is applied to the held data instead, which is also what lets an
 * author-GM card be whispered to the player who threw it.
 */
import { registerWrapper, MIXED } from "../../core/wrapper.mjs";
import { SUITE_ID } from "../../core/const.mjs";
import { IDENT } from "./constants.mjs";
import { degreeOf } from "../../core/pf2e-degree.mjs";
import { splitD100 } from "./request-model.mjs";

const PENDING = new Map();
let wrapped = false;

/**
 * Register a steered or probed check under its identifier. combat-intro rolls
 * initiative through this same wrapper: libWrapper allows one wrapper per
 * package per target, so a second feature wrapping `Check.roll` would collide.
 * @param {string} identifier  the `identifier` the roll will carry
 * @param {{probe: boolean, toggles?: object, rollTwice?: string|false}} job
 */
export function pendCheck(identifier, job) {
  PENDING.set(identifier, job);
  return job;
}

export function unpendCheck(identifier) {
  PENDING.delete(identifier);
}

/** The chip list a steered check would carry, exactly as PF2e stacks it. */
export { modsOf as checkMods };

/** Install the Check.roll wrapper once (any client may roll for us). */
export function installCheckWrapper() {
  if (wrapped || !game.pf2e?.Check?.roll) return !!wrapped;
  registerWrapper("game.pf2e.Check.roll", function (next, check, context = {}, ...rest) {
    const job = typeof context?.identifier === "string" ? PENDING.get(context.identifier) : null;
    if (!job) return next(check, context, ...rest);
    try {
      steer(check, context, job);
    } catch (e) {
      console.error("GLUniverse Suite | spotlight-roll: could not apply modifier choices", e);
    }
    if (job.probe) {
      try {
        check.calculateTotal(new Set(context.options ?? []));
        job.result = {
          mods: modsOf(check),
          totalModifier: check.totalModifier,
          dc: Number.isFinite(context.dc?.value) ? context.dc.value : null,
          rollTwice: context.rollTwice ?? false,
        };
      } catch (e) {
        job.error = e;
      }
      return Promise.resolve(null);
    }
    return next(check, context, ...rest);
  }, MIXED);
  wrapped = true;
  return true;
}

function steer(check, context, job) {
  if (job.rollTwice) context.rollTwice = job.rollTwice;
  const choices = job.toggles ?? {};
  if (!Object.keys(choices).length) return;
  const original = check.calculateTotal.bind(check);
  let applied = false;
  check.calculateTotal = function (options) {
    const out = original(options);
    if (!applied && options) {
      applied = true;
      for (const m of check.modifiers ?? []) {
        if (m.slug in choices) m.ignored = !choices[m.slug];
      }
      return original();
    }
    return out;
  };
}

function modsOf(check) {
  return (check.modifiers ?? [])
    .filter((m) => !(m.hideIfDisabled && !m.enabled && m.ignored))
    .map((m) => ({ slug: m.slug, label: m.label, value: m.modifier, kind: m.type ?? "untyped", enabled: !!m.enabled && !m.ignored }));
}

/** The PF2e statistic a request names, or null. */
export function statisticFor(actor, check) {
  if (!actor) return null;
  switch (check.kind) {
    case "skill":
    case "lore": return actor.skills?.[check.slug] ?? actor.getStatistic?.(check.slug) ?? null;
    case "save": return actor.saves?.[check.slug] ?? null;
    case "perception": return actor.perception ?? null;
    case "flat": {
      const Statistic = actor.saves?.fortitude?.constructor;
      if (!Statistic) return null;
      return new Statistic(actor, { slug: "flat", label: game.i18n.localize("GLSR.kind.flat"), modifiers: [], check: { type: "flat-check" } });
    }
    default: return null;
  }
}

/** A defender's statistic DC (opposed checks): "fortitude" → saves, else any statistic. */
export function defenderDc(actor, slug) {
  const stat = actor?.saves?.[slug] ?? (slug === "perception" ? actor?.perception : null) ?? actor?.skills?.[slug] ?? actor?.getStatistic?.(slug);
  return Number.isFinite(stat?.dc?.value) ? stat.dc.value : null;
}

const rollTwiceOf = (fortune) => (fortune === "fortune" ? "keep-higher" : fortune === "misfortune" ? "keep-lower" : false);

function dcArg(req, defender) {
  if (req.dcValue == null) return undefined;
  return { value: req.dcValue, visible: false, ...(defender ? { label: defender.name } : {}) };
}

/**
 * The chip list for one slot, exactly as PF2e would stack it, without rolling.
 * @returns {Promise<{mods, dc, rollTwice}|null>}
 */
export async function probeSlot(actor, req, { toggles = {}, defender = null } = {}) {
  if (req.check.kind === "formula") return { mods: [], dc: req.dcValue ?? null, rollTwice: false };
  const stat = statisticFor(actor, req.check);
  if (!stat) return null;
  if (req.check.kind === "flat") return { mods: [], dc: req.dcValue ?? null, rollTwice: rollTwiceOf(req.fortune) };
  const id = `${IDENT}:probe:${foundry.utils.randomID()}`;
  const job = { probe: true, toggles, rollTwice: rollTwiceOf(req.fortune) };
  PENDING.set(id, job);
  try {
    await stat.roll({ skipDialog: true, createMessage: false, identifier: id, dc: dcArg(req, defender), extraRollOptions: ["spotlight"], ...(req.bonus ? { modifiers: [situational(req.bonus)] } : {}) });
  } finally {
    PENDING.delete(id);
  }
  return job.result ?? null;
}

function situational(value) {
  const Modifier = game.pf2e?.Modifier;
  return Modifier ? new Modifier({ slug: "spotlight-situational", label: game.i18n.localize("GLSR.mod.situational"), modifier: value, type: "circumstance" }) : null;
}

/**
 * Roll one slot. Resolves to the result the GM sends out, plus the held
 * message data (posted later by `postHeld`).
 */
export async function rollSlot(actor, req, { toggles = {}, defender = null, speaker = null } = {}) {
  if (req.check.kind === "formula") return rollFormula(actor, req, speaker);
  const stat = statisticFor(actor, req.check);
  if (!stat) throw new Error(`no statistic "${req.check.slug}" on ${actor?.name}`);
  const id = `${IDENT}:roll:${foundry.utils.randomID()}`;
  const job = { probe: false, toggles, rollTwice: rollTwiceOf(req.fortune) };
  PENDING.set(id, job);
  let held = null, outcome = null;
  let roll;
  try {
    const extra = req.bonus && req.check.kind !== "flat" ? [situational(req.bonus)].filter(Boolean) : [];
    roll = await stat.roll({
      skipDialog: true, createMessage: false, identifier: id,
      dc: dcArg(req, defender), extraRollOptions: ["spotlight"],
      ...(req.check.kind === "flat" ? {} : { modifiers: extra, traits: req.check.traits }),
      rollTwice: job.rollTwice,
      callback: (_roll, out, msg) => { outcome = out; held = msg?.toObject?.() ?? null; },
    });
  } finally {
    PENDING.delete(id);
  }
  if (!roll) throw new Error("PF2e returned no roll");
  const die = roll.dice?.find((d) => d.faces === 20);
  const kept = die?.results?.find((r) => r.active !== false && !r.discarded)?.result ?? null;
  const dropped = die?.results?.find((r) => r.discarded)?.result ?? null;
  const degree = Number.isInteger(roll.options?.degreeOfSuccess) ? roll.options.degreeOfSuccess : null;
  const context = held?.flags?.pf2e?.context;
  const mods = (held?.flags?.pf2e?.modifiers ?? []).map((m) => ({ slug: m.slug, label: m.label, value: m.modifier, kind: m.type ?? "untyped", enabled: !!m.enabled && !m.ignored }));
  return {
    held,
    result: {
      roll: {
        natural: kept,
        total: roll.total,
        dropped,
        dice: [{ faces: 20, value: kept ?? 1 }, ...(dropped != null ? [{ faces: 20, value: dropped }] : [])],
      },
      dc: Number.isFinite(context?.dc?.value) ? context.dc.value : req.dcValue ?? null,
      degree: outcome != null ? ["criticalFailure", "failure", "success", "criticalSuccess"].indexOf(outcome) : degree,
      mods,
    },
    rerollable: !!roll.isRerollable && dropped == null,
  };
}

async function rollFormula(actor, req, speaker) {
  const roll = await new Roll(req.check.formula, actor?.getRollData?.() ?? {}).evaluate();
  const dice = [];
  for (const term of roll.dice) {
    for (const r of term.results) {
      if (r.active === false || r.discarded) continue;
      if (term.faces === 100) dice.push(...splitD100(r.result));
      else dice.push({ faces: term.faces, value: r.result });
    }
  }
  const diceSum = roll.dice.reduce((a, t) => a + (t.total ?? 0), 0);
  const flat = roll.total - diceSum;
  const single20 = roll.dice.length === 1 && roll.dice[0].faces === 20 && roll.dice[0].results.filter((r) => r.active !== false).length === 1;
  const natural = single20 ? roll.dice[0].total : null;
  const held = await roll.toMessage({ speaker: speaker ?? ChatMessage.getSpeaker({ actor }), flavor: req.title || req.check.formula }, { create: false });
  return {
    held,
    result: {
      roll: { natural, total: roll.total, dropped: null, dice },
      dc: req.dcValue ?? null,
      degree: degreeOf(roll.total, req.dcValue ?? null, natural),
      mods: flat ? [{ slug: "formula", label: req.check.formula.replace(/\d*d\d+/gi, "").replace(/^\s*[+]\s*/, "").trim() || String(flat), value: flat, kind: "untyped", enabled: true }] : [],
    },
    rerollable: false,
  };
}

/**
 * Post a held card now. `whisper`/`blind` follow the request's audience; the
 * DSN flag keeps Dice So Nice from rolling the die a second time on the board.
 */
export async function postHeld(held, { whisper = [], blind = false, reqId, slot } = {}) {
  if (!held) return null;
  const data = foundry.utils.deepClone(held);
  delete data._id;
  data.timestamp = Date.now();
  data.whisper = whisper;
  data.blind = blind;
  foundry.utils.setProperty(data, "flags.dice-so-nice.skip", true);
  foundry.utils.setProperty(data, `flags.${SUITE_ID}.spotlight`, { reqId, slot });
  return getDocumentClass("ChatMessage").create(data);
}

/**
 * Spend a Hero Point and reroll a posted check, PF2e's own way (keep the new
 * result). PF2e deletes the old card and creates the reroll card at once; we
 * catch that creation, hold it, and post it when the reroll's degree lands.
 */
export async function heroReroll(message) {
  const roll = message?.rolls?.[0];
  if (!roll || !game.pf2e?.Check?.rerollFromMessage) return null;
  let captured = null, newRoll = null;
  // PF2e names the new roll in its own hook; the card it builds carries both.
  const rerollHook = Hooks.on("pf2e.reroll", (_old, fresh) => { newRoll ??= fresh; });
  const hook = Hooks.on("preCreateChatMessage", (doc, data) => {
    if (captured || !data?.flags?.pf2e?.context?.isReroll) return true;
    captured = foundry.utils.deepClone(data);
    return false;
  });
  try {
    await game.pf2e.Check.rerollFromMessage(message, { resource: "hero-points", keep: "new" });
  } finally {
    Hooks.off("preCreateChatMessage", hook);
    Hooks.off("pf2e.reroll", rerollHook);
  }
  if (!captured) return null;
  const die = newRoll?.dice?.find((d) => d.faces === 20);
  const kept = die?.results?.find((r) => r.active !== false && !r.discarded)?.result ?? null;
  const ctx = captured.flags?.pf2e?.context;
  return {
    held: captured,
    result: {
      roll: { natural: kept, total: newRoll?.total ?? null, dropped: null, dice: [{ faces: 20, value: kept ?? 1 }] },
      dc: Number.isFinite(ctx?.dc?.value) ? ctx.dc.value : null,
      degree: ["criticalFailure", "failure", "success", "criticalSuccess"].indexOf(ctx?.outcome),
      mods: (captured.flags?.pf2e?.modifiers ?? []).map((m) => ({ slug: m.slug, label: m.label, value: m.modifier, kind: m.type ?? "untyped", enabled: !!m.enabled && !m.ignored })),
    },
  };
}

/** Hero Points this actor can spend right now (characters only). */
export function heroPoints(actor) {
  return Number(actor?.system?.resources?.heroPoints?.value) || 0;
}
