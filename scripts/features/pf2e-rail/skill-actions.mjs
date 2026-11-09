/**
 * The skill finder's catalogue and model. Pure: the host hands it the
 * character's skills, the target's defences as the party knows them, the
 * pins and what is typed, and gets back the `FINDER` model view.mjs draws.
 *
 * The catalogue is PF2e's own skill actions (`game.pf2e.actions`, whose
 * slugs these are: the press calls `game.pf2e.actions.get(slug).use()`),
 * grouped by what the player is trying to do rather than by the skill they
 * live under, which is the whole difference from pf2e-hud's menu. Each row
 * states what the view needs and PF2e's action object does not say in one
 * place: the situation group, every skill it can be rolled with (Recall
 * Knowledge and Treat Wounds pick by the subject; Escape takes the best of
 * three), the defence it targets, and whether it is trained-only, secret or
 * takes the multiple attack penalty (the `attack` trait).
 *
 * The odds come from core/pf2e-odds.mjs, the engine PF2e Odds and Recall
 * Knowledge share, so the finder can never disagree with the line on the
 * canvas. A DC the party does not know arrives as `null` (the host asks
 * pf2e-odds' knowledge, never the actor) and the card prints ?? — the view
 * has no way to show a number it was not handed.
 */
import { oddsOf, chanceExactly, dcRange, CRIT_FAIL, FAILURE, SUCCESS, CRIT_SUCCESS } from "../../core/pf2e-odds.mjs";

const A = (slug, name, group, stats, o = {}) => Object.freeze({ slug, name, group, stats, cost: 1, ...o });

/* name is the English fallback; the host passes PF2e's localised name. */
export const SKILL_ACTIONS = Object.freeze([
  /* Maneuvers: the attack-trait actions, rolled at the MAP step like a strike */
  A("grapple", "Grapple", "maneuvers", ["athletics"], { vs: "fortitude", attack: true, keys: "grab hold restrain" }),
  A("trip", "Trip", "maneuvers", ["athletics"], { vs: "reflex", attack: true, keys: "prone knock down" }),
  A("shove", "Shove", "maneuvers", ["athletics"], { vs: "fortitude", attack: true, keys: "push" }),
  A("disarm", "Disarm", "maneuvers", ["athletics"], { vs: "reflex", attack: true, trained: true, keys: "weapon drop" }),
  A("reposition", "Reposition", "maneuvers", ["athletics"], { vs: "fortitude", attack: true, keys: "move enemy" }),
  A("escape", "Escape", "maneuvers", ["athletics", "acrobatics", "unarmed"], { vs: "dc", attack: true, keys: "grabbed restrained free" }),
  A("feint", "Feint", "maneuvers", ["deception"], { vs: "perception", trained: true, keys: "off-guard" }),
  A("tumble-through", "Tumble Through", "maneuvers", ["acrobatics"], { vs: "reflex", keys: "move through" }),
  A("force-open", "Force Open", "maneuvers", ["athletics"], { attack: true, note: "vs the door or lock", keys: "door break" }),
  /* Social */
  A("demoralize", "Demoralize", "social", ["intimidation"], { vs: "will", keys: "frighten scare fear" }),
  A("create-a-diversion", "Create a Diversion", "social", ["deception"], { vs: "perception", keys: "distract" }),
  A("lie", "Lie", "social", ["deception"], { vs: "perception", secret: true, cost: null, keys: "bluff" }),
  A("request", "Request", "social", ["diplomacy"], { cost: 1, note: "vs their attitude", keys: "ask favour" }),
  A("coerce", "Coerce", "social", ["intimidation"], { vs: "will", cost: null, exploration: true, keys: "threaten" }),
  A("make-an-impression", "Make an Impression", "social", ["diplomacy"], { vs: "will", cost: null, exploration: true, keys: "attitude befriend" }),
  A("gather-information", "Gather Information", "social", ["diplomacy"], { cost: null, exploration: true, note: "2 hours", keys: "rumours" }),
  A("impersonate", "Impersonate", "social", ["deception"], { vs: "perception", cost: null, exploration: true, secret: true, keys: "disguise" }),
  A("perform", "Perform", "social", ["performance"], { keys: "music dance" }),
  A("command-an-animal", "Command an Animal", "social", ["nature"], { vs: "will", keys: "beast mount" }),
  /* Stealth */
  A("hide", "Hide", "stealth", ["stealth"], { vs: "perception", secret: true, keys: "hidden" }),
  A("sneak", "Sneak", "stealth", ["stealth"], { vs: "perception", secret: true, keys: "undetected move" }),
  A("conceal-an-object", "Conceal an Object", "stealth", ["stealth"], { vs: "perception", secret: true }),
  A("palm-an-object", "Palm an Object", "stealth", ["thievery"], { vs: "perception" }),
  A("steal", "Steal", "stealth", ["thievery"], { vs: "perception", keys: "pickpocket" }),
  A("avoid-notice", "Avoid Notice", "exploration", ["stealth"], { vs: "perception", cost: null, exploration: true, secret: true }),
  /* Movement */
  A("balance", "Balance", "movement", ["acrobatics"], { note: "vs the surface", keys: "narrow" }),
  A("climb", "Climb", "movement", ["athletics"], { note: "vs the surface" }),
  A("swim", "Swim", "movement", ["athletics"], { note: "vs the water" }),
  A("high-jump", "High Jump", "movement", ["athletics"], { cost: 2, note: "DC 30", dc: 30, keys: "leap" }),
  A("long-jump", "Long Jump", "movement", ["athletics"], { cost: 2, note: "DC 15", dc: 15, keys: "leap" }),
  A("squeeze", "Squeeze", "movement", ["acrobatics"], { cost: null, exploration: true, trained: true }),
  A("maneuver-in-flight", "Maneuver in Flight", "movement", ["acrobatics"], { trained: true, keys: "fly" }),
  A("arrest-a-fall", "Arrest a Fall", "movement", ["acrobatics"], { cost: "r", note: "DC 15", dc: 15 }),
  A("grab-an-edge", "Grab an Edge", "movement", ["athletics", "reflex"], { cost: "r", keys: "fall" }),
  /* Knowledge */
  A("recall-knowledge", "Recall Knowledge", "knowledge", ["arcana", "nature", "occultism", "religion", "society", "crafting"], { secret: true, recall: true, keys: "identify lore" }),
  A("seek", "Seek", "knowledge", ["perception"], { vs: "stealth", secret: true, keys: "search find" }),
  A("sense-motive", "Sense Motive", "knowledge", ["perception"], { vs: "deception", secret: true, keys: "insight lie" }),
  A("sense-direction", "Sense Direction", "exploration", ["survival"], { cost: null, exploration: true, secret: true, keys: "navigate" }),
  A("track", "Track", "exploration", ["survival"], { cost: null, exploration: true, trained: true, keys: "follow trail" }),
  /* Medicine */
  A("administer-first-aid", "Administer First Aid", "medicine", ["medicine"], { cost: 2, note: "stabilise or stop bleeding", keys: "dying bleed" }),
  A("treat-wounds", "Treat Wounds", "medicine", ["medicine"], { cost: null, exploration: true, trained: true, note: "10 minutes", keys: "heal" }),
  A("treat-poison", "Treat Poison", "medicine", ["medicine"], { trained: true }),
  A("treat-disease", "Treat Disease", "medicine", ["medicine"], { cost: null, downtime: true, trained: true }),
  /* Exploration and downtime */
  A("disable-device", "Disable a Device", "exploration", ["thievery"], { cost: 2, trained: true, note: "vs the device", keys: "trap" }),
  A("pick-a-lock", "Pick a Lock", "exploration", ["thievery"], { cost: 2, trained: true, note: "vs the lock" }),
  A("craft", "Craft", "downtime", ["crafting"], { cost: null, downtime: true, trained: true }),
  A("earn-income", "Earn Income", "downtime", ["crafting", "performance", "lore"], { cost: null, downtime: true, trained: true, keys: "job work" }),
  A("subsist", "Subsist", "downtime", ["survival", "society"], { cost: null, downtime: true }),
]);

/* The four degrees of success as fractions, for the bar. A DC known only as
   a range is read at its middle; the chance printed beside it is the range. */
function degrees(mod, dc) {
  const r = dcRange(dc);
  if (!r) return null;
  const mid = Number.isFinite(r.lo) && Number.isFinite(r.hi) ? Math.round((r.lo + r.hi) / 2) : null;
  if (mid == null) return null;
  const list = oddsOf({ mod, dc: mid }).faces;
  return [CRIT_FAIL, FAILURE, SUCCESS, CRIT_SUCCESS].map((d) => +chanceExactly(list, d).lo.toFixed(3));
}

const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "+0");

/** Which of the character's skills an action is rolled with: the best of
 *  those it allows, or — for Recall Knowledge — the one the target's traits
 *  name, which the host passes as `recallSkill`. */
function pickSkill(a, skills, { recallSkill, lores = [] }) {
  if (a.recall && recallSkill) return skills[recallSkill] ?? null;
  const pool = a.stats.flatMap((s) => (s === "lore" ? lores : skills[s] ? [skills[s]] : []));
  return pool.reduce((best, s) => (!best || s.mod > best.mod ? s : best), null);
}

const norm = (s) => String(s ?? "").toLocaleLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Does `q` find this action? Every word typed must start a word of the
 *  name, a skill's name or the action's keywords ("tri", "ath tr", "fear"). */
export function matches(a, q, skillName) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = norm(`${a.name} ${a.slugName ?? ""} ${skillName ?? ""} ${a.keys ?? ""}`).split(/[\s-]+/);
  return words.every((w) => hay.some((h) => h.startsWith(w)));
}

/**
 * The finder model.
 *
 * @param {{
 *   skills: Record<string, {slug, name, mod, rank}>,    // skills, perception, the saves
 *   lores?: Array<{slug, name, mod, rank}>,
 *   names?: Record<string, string>,                       // PF2e's localised action names
 *   target?: {name, img, known?, defences: Record<string, number|{lo,hi}|null>, recallSkill?, recallDC?} | null,
 *   pins?: string[], query?: string, group?: string, sel?: number,
 *   mode?: "encounter"|"exploration", map?: 0|1|2, mapStep?: number,
 *   t: (key, data) => string,
 * }} o
 */
export function finderModel(o) {
  const { skills, lores = [], names = {}, target = null, pins = [], query = "", group = "all", mode = "encounter", map = 0, mapStep = 5, t } = o;
  const pinned = new Set(pins);
  const actions = [];
  for (const a of SKILL_ACTIONS) {
    if (mode === "encounter" && (a.exploration || a.downtime) && !pinned.has(a.slug)) continue;
    if (mode === "exploration" && a.downtime && group !== "downtime" && !query) continue;
    const skill = pickSkill(a, skills, { recallSkill: target?.recallSkill, lores });
    if (!skill) continue;
    const name = names[a.slug] ?? a.name;
    if (!matches({ ...a, name, slugName: a.name }, query, skill.name)) continue;
    const locked = a.trained && !(skill.rank > 0) ? t("GLRAIL.prof.1") : null;
    /* the defence: the target's, as the party knows it, or the action's own */
    let vs = null;
    if (a.vs && a.vs !== "dc") {
      const known = target ? target.defences?.[a.vs] ?? null : undefined;
      if (known !== undefined) {
        const mod = skill.mod - (a.attack ? map * mapStep : 0);
        const odds = known == null ? null : oddsOf({ mod, dc: known });
        const chance = odds?.headline ? (odds.headline.lo === odds.headline.hi ? odds.headline.lo : [odds.headline.lo, odds.headline.hi]) : null;
        vs = { stat: a.vs, label: t(`GLRAIL.check.${a.vs}`, {}), dc: typeof known === "number" ? known : known ? `${known.lo}–${known.hi}` : null, chance, degrees: known == null ? null : degrees(mod, known) };
      }
    } else if (a.recall && target) {
      const dc = target.recallDC ?? null;
      vs = { stat: "recall", label: t("GLRAIL.gm.recall"), dc, chance: dc == null ? null : oddsOf({ mod: skill.mod, dc }).headline?.lo ?? null, degrees: dc == null ? null : degrees(skill.mod, dc) };
    } else if (a.dc != null) {
      vs = { stat: "dc", label: t("GLRAIL.spell.dc"), dc: a.dc, chance: oddsOf({ mod: skill.mod, dc: a.dc }).headline?.lo ?? null, degrees: degrees(skill.mod, a.dc) };
    }
    actions.push({
      id: a.slug, slug: a.slug, name, cost: a.cost, group: a.group, pinned: pinned.has(a.slug),
      skill: { slug: skill.slug, name: skill.name, mod: skill.mod, rank: skill.rank },
      attack: !!a.attack, variants: a.attack ? [0, 1, 2].map((i) => sign(skill.mod - i * mapStep)) : null,
      mapMod: a.attack ? skill.mod - map * mapStep : null,
      vs, locked, secret: !!a.secret, note: a.note ?? null,
    });
  }
  /* Pinned first (the sort is stable, so the book's order otherwise). */
  actions.sort((x, y) => Number(y.pinned) - Number(x.pinned));
  /* The columns: one per skill an action is rolled with, best modifier
     first; a trained-only action under an untrained skill cannot be taken,
     so it is not drawn; the untrained skills' remaining actions share one
     column, last. The column's head is that skill's plain check. */
  const CHECK_OF = { perception: "perception", fortitude: "fortitude", reflex: "reflex", will: "will" };
  const byKey = new Map();
  for (const a of actions) {
    if (a.locked) continue;
    const untrained = a.skill.rank === 0 && skills[a.skill.slug]?.kind === "skill";
    const key = untrained ? "untrained" : a.skill.slug;
    if (!byKey.has(key)) byKey.set(key, untrained
      ? { key, name: t("GLRAIL.skill.untrained"), mod: null, rank: null, actions: [] }
      : { key, name: a.skill.name, mod: a.skill.mod, rank: a.skill.rank ?? null, check: CHECK_OF[key] ?? (skills[key]?.kind === "skill" || lores.some((l) => l.slug === key) ? `skill:${key}` : null), actions: [] });
    byKey.get(key).actions.push(a);
  }
  const columns = [...byKey.values()].sort((x, y) => (x.key === "untrained") - (y.key === "untrained") || (y.mod ?? 0) - (x.mod ?? 0));
  /* Skills with no column here, and the Lores, are plain checks along the foot. */
  const checks = Object.values(skills).filter((sk) => sk.kind === "skill" && !byKey.has(sk.slug)).concat(lores.filter((l) => !byKey.has(l.slug)))
    .filter((sk) => matches({ name: sk.name }, query, "")).sort((x, y) => y.mod - x.mod);
  return { target: target ? { name: target.name, img: target.img, known: target.known ?? null } : null, query, group, sel: o.sel ?? 0, map, actions, columns, checks };
}

/** The Skills tab's keys: what is worth reaching for right now. Pins first,
 *  then — with a target — the actions against it with the best odds, then
 *  the mode's staples. */
export function suggested(model, { limit = 8, mode = "encounter" } = {}) {
  const staple = mode === "encounter" ? ["demoralize", "recall-knowledge", "grapple", "trip", "feint", "hide", "seek", "administer-first-aid"]
    : ["seek", "recall-knowledge", "avoid-notice", "sense-direction", "treat-wounds", "track", "gather-information", "climb"];
  const by = new Map(model.actions.map((a) => [a.slug, a]));
  const out = [];
  const push = (a) => { if (a && !out.includes(a) && !a.locked && out.length < limit) out.push(a); };
  model.actions.filter((a) => a.pinned).forEach(push);
  if (model.target) [...model.actions].filter((a) => typeof a.vs?.chance === "number" && a.vs.stat !== "dc" && a.cost !== "r").sort((x, y) => y.vs.chance - x.vs.chance).slice(0, 3).forEach(push);
  staple.forEach((s) => push(by.get(s)));
  return out;
}
