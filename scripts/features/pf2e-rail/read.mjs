/**
 * PF2e HUD — the readers: a PF2e actor (and what surrounds it) → the rail
 * model, in exactly the shape tools/pf2e-rail-fixtures.mjs draws.
 *
 * Pure. Nothing here reaches `game`, `canvas`, `ui` or `CONFIG`: the host
 * gathers what only a live session has (the viewer, the combat, the target
 * as the party knows it, damage formulas, the spellcasting sheet data, the
 * kineticist's blasts) into one `ctx` and hands it over, so the check tool
 * drives these with fake actors exactly as Foundry does with real ones.
 *
 * The readers decide what is DRAWN, never who may see it: every field a
 * viewer may not have arrives from the host already absent. Two rules live
 * here because the view cannot know them: a party seat the viewer may not
 * OBSERVE carries no numbers, and a target's defence is what `ctx.know`
 * returns, which for a player is the party's knowledge (core/pf2e-odds
 * through PF2e Odds) and never the actor.
 */
import { readPf2eDead, readPf2eDying } from "../../core/pf2e-dying.mjs";
import { SAVES } from "./const.mjs";
import { finderModel, suggested } from "./skill-actions.mjs";

/** PF2e's sixteen skills, in the sheet's order. */
export const SKILLS = Object.freeze([
  "acrobatics", "arcana", "athletics", "crafting", "deception", "diplomacy", "intimidation", "medicine",
  "nature", "occultism", "performance", "religion", "society", "stealth", "survival", "thievery",
]);

/** Conditions read as good news (green edge) or as neither (no edge). */
const GOOD = new Set(["quickened"]);
const PLAIN = new Set(["prone", "hidden", "concealed", "undetected", "unnoticed", "invisible", "observed", "encumbered"]);
/** Dying draws its own plate; the chips never repeat it. */
const NOT_CHIPS = new Set(["dying"]);

const num = (v, d = null) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? d : +v);
const sign = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "+0");
const list = (v) => (Array.isArray(v) ? v : v ? Array.from(v) : []);
const traitsOf = (item) => new Set(list(item?.system?.traits?.value));
const nameOf = (item) => (item?.isIdentified === false ? item.system?.identification?.unidentified?.name ?? item.name : item?.name ?? "");
const imgOf = (item) => (item?.isIdentified === false ? item.system?.identification?.unidentified?.img ?? item.img : item?.img ?? null);

/** The leading signed number of a PF2e label ("+9 (MAP −5)" → 9). */
export function modOfLabel(label) {
  const m = /^\s*([+\-−]?)\s*(\d+)/.exec(String(label ?? ""));
  return m ? (m[1] === "-" || m[1] === "−" ? -m[2] : +m[2]) : null;
}

/** An action item's cost as the view spells it: 1–3, "r", "f" or null. */
export function costOf(item) {
  const type = item?.system?.actionType?.value;
  if (type === "reaction") return "r";
  if (type === "free") return "f";
  if (type === "action") return num(item.system?.actions?.value, 1);
  return null;
}

/** A spell's casting time as a cost: "2", "reaction", "1 to 3" → 2, "r", "1-3". */
export function spellCost(spell) {
  const v = String(spell?.system?.time?.value ?? "").trim().toLowerCase();
  if (/^[123]$/.test(v)) return +v;
  if (v === "reaction") return "r";
  if (v === "free") return "f";
  const r = /^([123])\s*(?:to|-|–)\s*([123])$/.exec(v);
  return r ? `${r[1]}-${r[2]}` : null;
}

/** A frequency as the view's pips: what is left of it, per what. */
export function freqOf(item, loc = (k) => k, frequencies = {}) {
  const f = item?.system?.frequency;
  const max = num(f?.max);
  if (!max) return undefined;
  const left = Math.max(0, Math.min(max, num(f.value, max)));
  return { used: max - left, max, per: loc(frequencies[f.per] ?? f.per ?? "") };
}

/* ── the plinth ─────────────────────────────────────────────────── */

/** The conditions as chips: valued ones print their value. */
export function condsOf(actor) {
  return list(actor?.itemTypes?.condition)
    .filter((c) => !NOT_CHIPS.has(c.slug) && c.isActive !== false)
    .map((c) => {
      const value = num(c.system?.value?.value ?? c.value);
      const tone = GOOD.has(c.slug) ? "good" : PLAIN.has(c.slug) ? undefined : "danger";
      return { slug: c.slug, name: c.name, ...(value ? { value } : {}), icon: c.img ?? null, ...(tone ? { tone } : {}) };
    });
}

/** The art the plinth stands: the token ring's subject (a cut-out) where the
 *  token wears one, else the actor's painting. */
export function artOf(actor, token) {
  const ring = token?.ring;
  const subject = ring?.enabled ? ring.subject?.texture : null;
  return subject ? { cutout: subject } : { img: actor?.img ?? null };
}

const speedOf = (actor, t) => {
  const land = num(actor?.system?.movement?.speeds?.land?.value ?? actor?.system?.attributes?.speed?.value);
  return land ? t("GLRAIL.speed", { n: land }) : undefined;
};

export function plinthOf(actor, ctx) {
  const { t } = ctx;
  const hp = actor.system?.attributes?.hp;
  const dying = readPf2eDying(actor);
  const dead = readPf2eDead(actor, dying);
  const p = {
    kind: actor.type === "character" ? "character" : actor.type === "hazard" ? "hazard" : "npc",
    name: ctx.name ?? actor.name,
    sub: ctx.sub ?? subOf(actor, ctx),
    ...artOf(actor, ctx.token),
  };
  if (ctx.role === "player") {
    p.speed = speedOf(actor, t);
    p.frameable = !ctx.readonly;
    const hero = actor.system?.resources?.heroPoints;
    if (actor.type === "character" && hero) p.hero = [num(hero.value, 0), num(hero.max, 3)];
    if (ctx.turn?.mine) p.turn = true;
  } else p.fold = true;
  if (hp && num(hp.max)) p.hp = [num(hp.value, 0), num(hp.max)];
  const conds = condsOf(actor);
  if (conds.length) p.conds = conds;
  if (dead) p.dead = true;
  else if (dying) p.dying = { value: dying.value, max: dying.max };
  if (ctx.frame) p.frame = ctx.frame;
  return p;
}

/** The sub line: class and level for a character; what a creature is. */
export function subOf(actor, { t, loc = (k) => k, config = {} }) {
  const level = num(actor.system?.details?.level?.value ?? actor.level, 0);
  if (actor.type === "character") return `${actor.class?.name ?? ""} ${level}`.trim();
  if (actor.type === "familiar") return t("GLRAIL.sub.familiar", { master: actor.master?.name ?? "" });
  if (actor.type === "hazard") {
    const kind = traitsOf(actor).has("haunt") ? t("GLRAIL.sub.haunt") : traitsOf(actor).has("trap") ? t("GLRAIL.sub.trap") : t("GLRAIL.sub.hazard");
    return `${t("GLRAIL.gm.level", { n: level })} · ${kind}`;
  }
  const size = actor.system?.traits?.size?.value;
  const sizeName = size ? loc(config.actorSizes?.[size] ?? size) : "";
  const trait = list(actor.system?.traits?.value).find((x) => config.creatureTraits?.[x]);
  const what = [sizeName, trait ? loc(config.creatureTraits[trait]) : ""].filter(Boolean).join(" ");
  /* The level first: it is the token a GM decides on, so the ellipsis
     takes the size and the trait instead. */
  return [t("GLRAIL.gm.level", { n: level }), what].filter(Boolean).join(" · ");
}

/* ── vitals ─────────────────────────────────────────────────────── */

const checkMods = (actor) => ({
  perception: num(actor.perception?.mod ?? actor.system?.perception?.mod, 0),
  saves: Object.fromEntries(SAVES.map((s) => [s, num(actor.saves?.[s]?.mod ?? actor.system?.saves?.[s]?.value, 0)])),
});

export function shieldOf(actor) {
  const s = actor.system?.attributes?.shield;
  if (!s?.itemId) return undefined;
  return {
    name: s.name, hp: num(s.hp?.value, 0), max: num(s.hp?.max, 0), hardness: num(s.hardness, 0), bt: num(s.brokenThreshold, 0),
    ac: num(s.ac, 0), raised: !!s.raised, ...(s.broken ? { broken: true } : {}), ...(s.destroyed ? { destroyed: true } : {}),
  };
}

export function vitalsOf(actor, ctx) {
  const hp = actor.system?.attributes?.hp ?? {};
  const v = {
    ac: num(actor.armorClass?.value ?? actor.system?.attributes?.ac?.value, 10),
    hp: { value: num(hp.value, 0), max: num(hp.max, 0), temp: num(hp.temp, 0) },
    ...checkMods(actor),
  };
  if (ctx.stamina && hp.sp && num(hp.sp.max)) v.sp = { value: num(hp.sp.value, 0), max: num(hp.sp.max) };
  const classDC = num(actor.classDC?.dc?.value ?? actor.system?.attributes?.classDC?.value);
  if (actor.type === "character" && classDC != null) v.classDC = classDC;
  const shield = shieldOf(actor);
  if (shield) v.shield = shield;
  return { ac: v.ac, hp: v.hp, ...(v.sp ? { sp: v.sp } : {}), ...(v.classDC != null ? { classDC: v.classDC } : {}), perception: v.perception, saves: v.saves, ...(v.shield ? { shield: v.shield } : {}) };
}

/* ── strikes ────────────────────────────────────────────────────── */

/* PF2e Ranged Combat (`pf2e-ranged-combat`) marks a loaded weapon with an
   effect copied from its compendium and aimed at the weapon; under PF2e's
   own ammunition (the module's sub-item mode) the rounds are the weapon's
   sub-items. */
const RC_LOADED = "Compendium.pf2e-ranged-combat.effects.Item.nEqdxZMAHlYVXI0Z";

/** A weapon that must be reloaded, where PF2e Ranged Combat is running
 *  (`ctx.ranged`): its Reload cost (1–3 actions, else null) and whether it
 *  is loaded now. Reload 0 and "–" weapons draw as they fire, and get none. */
export function reloadOf(actor, item, ctx) {
  if (!ctx.ranged || item?.type !== "weapon") return null;
  const v = String(item.system?.reload?.value ?? "").trim();
  if (!v || v === "-" || v === "0") return null;
  const n = Number(v);
  const effects = list(actor.itemTypes?.effect ?? (actor.items?.filter?.((i) => i.type === "effect")));
  const aimed = (e) => (e.flags?.["pf2e-ranged-combat"]?.targetId ?? e.flags?.pf2e?.rulesSelections?.weapon) === item.id;
  const loaded = effects.some((e) => (e.sourceId ?? e.flags?.core?.sourceId) === RC_LOADED && aimed(e) && !e.isExpired)
    || list(item.subitems?.contents ?? item.subitems).some((s) => s?.isAmmoFor?.(item) && num(s.quantity ?? s.system?.quantity, 0) > 0);
  return { cost: Number.isInteger(n) && n >= 1 && n <= 3 ? n : null, loaded };
}

/** The strikes PF2e prepared, as presses. A strike's id is its index in
 *  `actor.system.actions`, which is how PF2e's own sheet addresses it. */
export function strikeRows(actor, ctx) {
  const out = [];
  list(actor.system?.actions).forEach((a, i) => {
    if (a?.type !== "strike" || a.visible === false || a.canAttack === false) return;
    const f = ctx.formulas?.get?.(String(i)) ?? {};
    const base = a.item?.system?.baseItem;
    const baseName = base && ctx.config?.baseWeaponTypes?.[base] ? ctx.loc(ctx.config.baseWeaponTypes[base]) : null;
    const variants = list(a.variants).slice(0, 3).map((v) => {
      const n = num(a.totalModifier) != null && num(v.penalty) != null ? a.totalModifier + v.penalty : modOfLabel(v.label);
      return n == null ? String(v.label ?? "") : sign(n);
    });
    out.push({
      id: String(i), name: a.label ?? a.item?.name ?? "", ...(baseName && baseName !== a.label ? { short: baseName } : {}),
      img: a.item?.img ?? a.imageUrl ?? null, variants, damage: f.damage ?? "", critical: f.critical ?? "",
      ...(a.ready === false ? { ready: false } : {}),
      ...(() => { const r = reloadOf(actor, a.item, ctx); return r ? { reload: r } : {}; })(),
    });
  });
  return out;
}

/** A kineticist's blasts: each element as a melee and a ranged row, through
 *  PF2e's own ElementalBlast configs (the host built them). */
export function blastRows(configs, ctx) {
  const out = [];
  for (const c of list(configs)) {
    const dmg = list(c.damageTypes).find((d) => d.selected) ?? list(c.damageTypes)[0];
    for (const melee of [true, false]) {
      const maps = c.maps?.[melee ? "melee" : "ranged"] ?? {};
      const range = num(c.range?.max);
      const f = ctx.formulas?.get?.(`blast:${c.element}:${melee ? "m" : "r"}`) ?? {};
      out.push({
        id: `blast:${c.element}:${melee ? "m" : "r"}`, kind: "blast",
        name: `${c.label} · ${ctx.t(melee ? "GLRAIL.blast.melee" : "GLRAIL.blast.ranged")}`,
        short: melee || !range ? ctx.loc(c.elementLabel ?? c.element) : `${ctx.loc(c.elementLabel ?? c.element)} ${ctx.t("GLRAIL.speed", { n: range })}`,
        img: c.img ?? null,
        /* PF2e prints the three steps; where it hands back its unconfigured
           fallback (empty labels), the steps are the blast statistic's own
           modifier at 0, −5, −10 — a blast is never agile. */
        variants: ["map0", "map1", "map2"].map((k, i) => {
          const n = modOfLabel(maps[k]) ?? (num(c.statistic?.check?.mod) != null ? c.statistic.check.mod - 5 * i : null);
          return n == null ? "" : sign(n);
        }),
        damage: f.damage ?? (dmg?.label ?? ""), critical: f.critical ?? "",
      });
    }
  }
  return out;
}

/* ── spells ─────────────────────────────────────────────────────── */

const RANK_ORDER = (k) => (k === "c" ? -1 : k === "f" ? 99 : k);

/**
 * The hand: every spellcasting entry's sheet data merged by rank.
 * `entries` is `[{ id, isPrepared, isSpontaneous, isFlexible, isInnate,
 * isFocusPool, isRitual, dc, atk, groups }]` where `groups` is PF2e's
 * `getSheetData().groups`. A card's id carries
 * where it came from — `<entry>.<spell>.<rank>.<slot>` — so a press can be
 * cast without a lookup table that could drift from what is drawn.
 *
 * A card leaves the hand (`spent`) only when it was its own resource: a
 * prepared slot cast, or an innate spell out of uses. A cantrip, a focus
 * spell and a spontaneous or flexible caster's spell stay in the hand
 * however often they are cast: the focus pool and the rank's slots run out,
 * and those are counted on the pennant. (PF2e marks every spell of a
 * spontaneous rank `expended` once its slots are gone; that is the rank's
 * count, not the card's.)
 */
export function spellsOf(entries, { rank = null, focus = null } = {}) {
  const usable = list(entries).filter((e) => !e.isRitual);
  if (!usable.length) return null;
  const ranks = new Map();
  const cards = [];
  let pool = null;
  for (const e of usable) {
    for (const g of list(e.groups)) {
      const cantrips = g.id === "cantrips";
      const key = cantrips ? "c" : e.isFocusPool ? "f" : num(g.id);
      const perCard = !cantrips && !e.isFocusPool && !e.isSpontaneous && !e.isFlexible && (e.isPrepared || e.isInnate);
      const slotted = e.isPrepared && !e.isFlexible;
      if (key == null) continue;
      const r = ranks.get(key) ?? { key, cards: 0 };
      if (!cantrips && !e.isFocusPool) {
        const active = list(g.active);
        const [left, max] = slotted ? [active.filter((a) => a && !a.expended).length, num(g.uses?.max, active.length)] : [num(g.uses?.value, 0), num(g.uses?.max, 0)];
        if (max > 0) r.slots = r.slots ? [r.slots[0] + left, r.slots[1] + max] : [left, max];
      }
      if (e.isFocusPool && !cantrips && g.uses) pool = [num(g.uses.value, 0), num(g.uses.max, 0)];
      list(g.active).forEach((a, i) => {
        if (!a?.spell) {
          if (slotted) { cards.push({ socket: true, rank: key, id: `${e.id}.-.${key}.${i}` }); r.cards++; }
          return;
        }
        const sp = a.spell;
        const cast = num(a.castRank, num(sp.rank));
        cards.push({
          id: `${e.id}.${sp.id}.${key}.${slotted ? i : ""}`, name: sp.name, rank: key, cost: spellCost(sp), img: sp.img ?? null,
          entry: e.id, ...(slotted ? { slot: i } : {}), ...(a.expended && perCard && !sp.atWill ? { spent: true } : {}),
          ...(typeof key === "number" && cast > num(sp.baseRank ?? sp.rank, cast) ? { heightened: cast } : {}),
        });
        r.cards++;
      });
      ranks.set(key, r);
    }
  }
  if (!ranks.size) return null;
  const order = [...ranks.values()].sort((a, b) => RANK_ORDER(a.key) - RANK_ORDER(b.key));
  const primary = [...usable].sort((a, b) => num(b.dc, 0) - num(a.dc, 0))[0];
  const keys = order.map((r) => r.key);
  const pick = keys.includes(rank) ? rank
    : [...order].reverse().find((r) => typeof r.key === "number" && (r.slots?.[0] ?? 0) > 0)?.key ?? keys[0];
  return { rank: pick, dc: num(primary.dc), atk: num(primary.atk), ...(pool ?? focus ? { focus: pool ?? focus } : {}), ranks: order, cards };
}

/* ── the actions tab ────────────────────────────────────────────── */

/** PF2e's toggles (`actor.synthetics.toggles`, domain → option → toggle). */
export function togglesOf(actor) {
  const out = [];
  for (const [domain, opts] of Object.entries(actor.synthetics?.toggles ?? {})) {
    for (const [option, g] of Object.entries(opts ?? {})) {
      if (!g || g.enabled === false || g.alwaysActive) continue;
      out.push({ id: `${domain}|${option}|${g.itemId ?? ""}`, label: g.label ?? option, on: !!g.checked });
    }
  }
  return out;
}

const ACTIVE_TYPES = new Set(["action", "reaction", "free"]);

/** Everything the actor owns with an action cost: actions and feats, the
 *  stances last; exploration and downtime belong to the exploration bar. */
export function actionRows(actor, ctx) {
  const effects = new Set(list(actor.itemTypes?.effect).map((e) => e.slug));
  const items = [...list(actor.itemTypes?.action), ...list(actor.itemTypes?.feat)]
    .filter((i) => ACTIVE_TYPES.has(i.system?.actionType?.value) && i.slug !== "elemental-blast")
    .filter((i) => { const tr = traitsOf(i); return !tr.has("exploration") && !tr.has("downtime"); })
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const rows = items.map((i) => {
    const stance = traitsOf(i).has("stance");
    const freq = freqOf(i, ctx.loc, ctx.config?.frequencies);
    return {
      id: i.id, name: i.name, cost: costOf(i), ...(freq ? { freq } : {}),
      ...(stance ? { stance: true, active: effects.has(`stance-${i.slug}`) } : {}),
    };
  });
  return [...rows.filter((r) => !r.stance), ...rows.filter((r) => r.stance)];
}

/** The consumables, what is left of each. Unidentified ones by their
 *  unidentified name. Only what carries PF2e's `consumable` trait: chalk and
 *  rations are consumable items in the data model and nobody reaches for them
 *  mid-fight. PF2e records no action cost on a consumable, so none is drawn
 *  and none is spent. */
export function itemTiles(actor) {
  return list(actor.itemTypes?.consumable)
    .filter((i) => i.system?.category !== "ammo" && traitsOf(i).has("consumable") && num(i.system?.quantity, 1) > 0)
    .map((i) => ({ id: i.id, name: nameOf(i), img: imgOf(i), cost: null, qty: num(i.system?.quantity, 1) }));
}

/* ── skills, for the finder ─────────────────────────────────────── */

export function skillsOf(actor) {
  const skills = {};
  for (const slug of SKILLS) {
    const s = actor.skills?.[slug];
    if (s) skills[slug] = { slug, name: s.label ?? slug, rank: num(s.rank, s.proficient ? 1 : 0), mod: num(s.mod, 0), kind: "skill" };
  }
  const per = actor.perception;
  if (per) skills.perception = { slug: "perception", name: per.label ?? "Perception", rank: num(per.rank, 1), mod: num(per.mod, 0) };
  for (const k of SAVES) {
    const s = actor.saves?.[k];
    if (s) skills[k] = { slug: k, name: s.label ?? k, rank: num(s.rank, 1), mod: num(s.mod, 0) };
  }
  /* Escape takes the unarmed attack modifier: the best unarmed Strike. */
  const unarmed = list(actor.system?.actions).filter((a) => a?.type === "strike" && traitsOf(a.item).has("unarmed")).map((a) => num(a.totalModifier)).filter((n) => n != null);
  if (unarmed.length) skills.unarmed = { slug: "unarmed", name: "Unarmed", rank: 1, mod: Math.max(...unarmed) };
  const lores = Object.values(actor.skills ?? {}).filter((s) => s?.lore).map((s) => ({ slug: s.slug, name: s.label ?? s.slug, rank: num(s.rank, 1), mod: num(s.mod, 0) }));
  return { skills, lores };
}

const DEFENCES = ["fortitude", "reflex", "will", "perception", "stealth", "deception"];
const rangeText = (v) => (typeof v === "number" ? String(v) : v ? `${v.lo}–${v.hi}` : null);

/** The target as the reader knows it. `know(stat)` is the host's: the truth
 *  for a GM, the party's knowledge for anyone else (null = never learned). */
export function targetOf(target, { know, t, truth = false }) {
  if (!target) return null;
  const defences = Object.fromEntries(DEFENCES.map((k) => [k, know(k) ?? null]));
  const ac = know("ac");
  const known = [
    ac != null ? `${t("GLRAIL.vitals.ac")} ${rangeText(ac)}` : "",
    ...SAVES.map((s) => (defences[s] != null ? `${t(`GLRAIL.check.${s}Short`)} ${rangeText(defences[s])}` : "")),
  ].filter(Boolean).join(" · ");
  return {
    name: target.name, img: target.img ?? null, known: known || null, defences,
    recallSkill: target.recallSkill ?? null, ...(truth && target.recallDC != null ? { recallDC: target.recallDC } : {}),
  };
}

/* ── the turn bar ───────────────────────────────────────────────── */

/** Exploration activities: what the actor owns with the exploration trait,
 *  lit where PF2e records it as what the character is doing. */
export function activitiesOf(actor) {
  const on = new Set(list(actor.system?.exploration));
  return [...list(actor.itemTypes?.action), ...list(actor.itemTypes?.feat)]
    .filter((i) => traitsOf(i).has("exploration"))
    .map((i) => ({ id: i.id, name: i.name, on: on.has(i.id) }));
}

export function turnbarOf(actor, ctx) {
  if (ctx.mode !== "encounter") return { mode: "exploration", activities: activitiesOf(actor) };
  const tb = { mode: "encounter", mine: !!ctx.turn?.mine, round: num(ctx.turn?.round, 1), economy: { ...ctx.econ }, map: ctx.map ?? 0 };
  if (!tb.mine) tb.current = ctx.turn?.current ?? "";
  if (!tb.mine && ctx.turn?.next) tb.next = true;
  /* Somebody else's character: the bar names them, never "you". */
  if (ctx.readonly) tb.observer = ctx.token?.name ?? actor?.name ?? "";
  return tb;
}

/* ── the party ──────────────────────────────────────────────────── */

/** What is visibly wrong, said in a word: dying first, then the worst condition. */
export function noteOf(actor, t) {
  const dying = readPf2eDying(actor);
  if (readPf2eDead(actor, dying)) return t("GLRAIL.dead");
  if (dying) return `${t("GLRAIL.dying.label")} ${dying.value}`;
  const c = condsOf(actor).find((x) => x.tone === "danger");
  return c ? (c.value ? `${c.name} ${c.value}` : c.name) : undefined;
}

/** A party seat. Without OBSERVER the seat is the portrait, the name and the
 *  note, and nothing that is a number. */
export function seatOf(actor, { t, observe = true, turn = false, self = false }) {
  const s = { id: actor.id, name: actor.name, img: actor.img ?? null };
  const note = noteOf(actor, t);
  if (observe) {
    const hp = actor.system?.attributes?.hp;
    if (hp && num(hp.max)) s.hp = [num(hp.value, 0), num(hp.max)];
    if (num(hp?.temp)) s.temp = num(hp.temp);
    const ac = num(actor.armorClass?.value ?? actor.system?.attributes?.ac?.value);
    if (ac != null) s.ac = ac;
    const hero = actor.system?.resources?.heroPoints;
    if (actor.type === "character" && hero) s.hero = [num(hero.value, 0), num(hero.max, 3)];
  }
  if (note) s.note = note;
  if (turn) s.turn = true;
  if (self) s.self = true;
  return s;
}

/* ── the deck's tabs ────────────────────────────────────────────── */

export const tabsOf = (o) => [
  ...(o.spells ? [{ key: "spells", count: o.spells.cards.filter((c) => !c.socket && !c.spent).length }] : []),
  { key: "actions", count: o.actions?.list?.length ?? 0 },
  { key: "skills" },
  { key: "items", count: o.items?.list?.length ?? 0 },
];

/** The deck with its Skills tab built through the finder, exactly as the
 *  preview composes it. The HOST calls this when it draws, not the reader:
 *  the keys print the MAP step, and the MAP step is a driven value, so a
 *  model that carried them would redraw the rail on every attack. */
export function withSkills(deck, sk, { mode, map, t }) {
  const all = finderModel({ ...sk, query: "", group: "all", mode, map, t });
  return {
    ...deck,
    skills: { ...deck.skills, target: all.target, suggested: suggested(all, { mode }) },
    tabs: deck.tabs.map((x) => (x.key === "skills" ? { ...x, count: all.actions.length } : x)),
  };
}

/* ── the player's rail ──────────────────────────────────────────── */

/**
 * @param {object} ctx
 *   actor, token (TokenDocument|null), t, loc, config,
 *   readonly, stamina, mode ("encounter"|"exploration"),
 *   turn { mine, current, round } | null, econ { max, spent, reaction, note?, tone? }, map,
 *   formulas Map<id, {damage, critical}>, blasts (ElementalBlast configs) | null,
 *   spells (entries for spellsOf) | null, rank, tab,
 *   target { name, img, recallSkill, recallDC } | null, know (stat) → number|{lo,hi}|null, truth,
 *   party [{ actor, observe, turn }], pins, frame, folded
 */
export function readPlayer(ctx) {
  const { actor, t } = ctx;
  const slim = actor.type !== "character";
  const spells = spellsOf(ctx.spells, { rank: ctx.rank });
  const strikes = [...blastRows(ctx.blasts, ctx), ...strikeRows(actor, ctx)];
  const parts = {
    ...(spells ? { spells } : {}),
    actions: { toggles: togglesOf(actor), list: actionRows(actor, ctx) },
    skills: { query: "" },
    items: { list: itemTiles(actor) },
  };
  const tab = ctx.tab && (ctx.tab !== "spells" || spells) ? ctx.tab : spells ? "spells" : "actions";
  const { skills, lores } = skillsOf(actor);
  const sk = { skills, ...(lores.length ? { lores } : {}), target: targetOf(ctx.target, ctx), pins: [...(ctx.pins ?? [])] };
  const model = {
    role: "player", mode: ctx.mode,
    ...(slim ? { slim: true } : {}),
    turnbar: turnbarOf(actor, ctx),
    plinth: plinthOf(actor, { ...ctx, role: "player" }),
    vitals: vitalsOf(actor, ctx),
    strikes: { list: strikes },
    deck: null,
    sk,
    ...(slim ? {} : { util: {} }),
    stack: list(ctx.party).map((p) => seatOf(p.actor, { t, observe: p.observe, turn: p.turn })),
    ...(ctx.folded ? { folded: true } : {}),
    ...(ctx.readonly ? { readonly: true } : {}),
  };
  model.deck = { tab, ...parts, tabs: tabsOf(parts) };
  return model;
}

/* ── the GM's rail ──────────────────────────────────────────────── */

const DISP = { "-2": "secret", "-1": "hostile", 0: "neutral", 1: "friendly" };

/** The GM's hand: every non-PC token, hostile first, scene order within. */
export function foesOf(tokens, { selected = null, turnTokenId = null } = {}) {
  const foes = list(tokens).filter((tk) => tk?.actor && !tk.actor.hasPlayerOwner && ["npc", "hazard"].includes(tk.actor.type)).map((tk) => {
    const a = tk.actor, hp = a.system?.attributes?.hp;
    const dying = readPf2eDying(a);
    const state = readPf2eDead(a, dying) ? "dead" : dying ? "dying" : undefined;
    return {
      id: tk.id, name: tk.name ?? a.name, level: num(a.system?.details?.level?.value ?? a.level, 0), img: a.img ?? null,
      ...(hp && num(hp.max) ? { hp: [num(hp.value, 0), num(hp.max)] } : {}),
      disp: DISP[String(tk.document?.disposition ?? tk.disposition ?? 0)] ?? "neutral", ...(state ? { state } : {}), ...(tk.id === turnTokenId ? { turn: true } : {}),
    };
  });
  foes.sort((a, b) => (a.disp !== "hostile") - (b.disp !== "hostile"));
  return { foes, selected };
}

const stripHTML = (s) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

/** PF2e's inline syntax read as the words a GM would say. A hazard's Disable
 *  line is authored as `@Check[thievery|dc:18|name:…]`, which PF2e's enricher
 *  turns into a button on the sheet and which prints raw anywhere else. A
 *  label in braces always wins; otherwise a check is its skill and DC, a link
 *  is dropped, a roll is its formula. */
export function inlineText(s, { loc = (k) => k, config = {} } = {}) {
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
  const skill = (slug) => { const k = config.skills?.[slug]; return k ? loc(k.label ?? k) : cap(String(slug).replace(/-/g, " ")); };
  return String(s ?? "")
    .replace(/@Check\[([^\]]*)\](?:\{([^}]*)\})?/g, (_, body, label) => {
      if (label) return label;
      const parts = body.split("|"), opt = Object.fromEntries(parts.filter((p) => p.includes(":")).map((p) => { const i = p.indexOf(":"); return [p.slice(0, i), p.slice(i + 1)]; }));
      const type = opt.type ?? parts.find((p) => !p.includes(":")) ?? "";
      const dc = /^\d+$/.test(opt.dc ?? "") ? ` DC ${opt.dc}` : "";
      return (type ? skill(type) : "") + dc;
    })
    .replace(/@(?:UUID|Compendium|Item|Actor|JournalEntry|Template|Localize)\[[^\]]*\](?:\{([^}]*)\})?/g, (_, label) => label ?? "")
    .replace(/@Damage\[((?:[^\[\]]|\[[^\]]*\])*)\](?:\{([^}]*)\})?/g, (_, f, label) => label ?? f.replace(/\[[^\]]*\]/g, ""))
    .replace(/\[\[\/(?:b?r|gmr|pr)\s+([^\]]*?)\]\](?:\{([^}]*)\})?/g, (_, f, label) => label ?? f.replace(/#.*$/, "").trim())
    .replace(/\s+([,.;:])/g, "$1").replace(/\s+/g, " ").trim();
}

export function creatureOf(actor, ctx) {
  const hp = actor.system?.attributes?.hp ?? {};
  const npcStrikes = strikeRows(actor, ctx).map((s) => ({ id: s.id, name: s.name, variants: s.variants, damage: s.damage }));
  const abilities = list(actor.itemTypes?.action).filter((i) => ACTIVE_TYPES.has(i.system?.actionType?.value)).map((i) => ({ id: i.id, name: i.name, cost: costOf(i) }));
  const adjust = actor.isElite ? ctx.t("GLRAIL.gm.elite") : actor.isWeak ? ctx.t("GLRAIL.gm.weak") : null;
  return {
    name: ctx.name ?? actor.name, level: num(actor.system?.details?.level?.value ?? actor.level, 0),
    ac: num(actor.armorClass?.value ?? actor.system?.attributes?.ac?.value, 10),
    hp: { value: num(hp.value, 0), max: num(hp.max, 0) }, ...checkMods(actor),
    recallDC: num(actor.identificationDCs?.standard?.dc),
    strikes: npcStrikes, abilities, ...(adjust ? { adjust } : {}),
  };
}

export function hazardOf(actor, ctx) {
  const a = actor.system?.attributes ?? {};
  const hp = a.hp;
  return {
    name: ctx.name ?? actor.name, level: num(actor.system?.details?.level?.value ?? actor.level, 0),
    stealthDC: num(a.stealth?.dc ?? (num(a.stealth?.value) != null ? a.stealth.value + 10 : null), 10),
    ...(num(a.ac?.value) != null ? { ac: num(a.ac.value) } : {}), ...(num(a.hardness) ? { hardness: num(a.hardness) } : {}),
    ...(hp && num(hp.max) ? { hp: { value: num(hp.value, 0), max: num(hp.max) } } : {}),
    disable: inlineText(stripHTML(actor.system?.details?.disable), ctx), ...(actor.system?.details?.isComplex ? { complex: true } : {}),
    abilities: list(actor.itemTypes?.action).filter((i) => ACTIVE_TYPES.has(i.system?.actionType?.value)).map((i) => ({ id: i.id, name: i.name, cost: costOf(i) })),
  };
}

/**
 * @param {object} ctx
 *   actor (the selected npc/hazard) | null, token, t, loc, config,
 *   tokens (scene tokens in scene order), selected (token id), turnTokenId,
 *   target, know (the truth), party [{ actor, observe, turn }], pins, frame
 */
export function readGM(ctx) {
  const { actor, t } = ctx;
  const stack = list(ctx.party).map((p) => seatOf(p.actor, { t, observe: true, turn: p.turn }));
  const foes = foesOf(ctx.tokens, { selected: ctx.selected, turnTokenId: ctx.turnTokenId });
  if (!actor) {
    return { role: "gm", plinth: { kind: "npc", name: t("GLRAIL.gm.title"), sub: t(foes.foes.length ? "GLRAIL.gm.none" : "GLRAIL.empty.title"), fold: true }, ...(foes.foes.length ? { foes } : {}), stack };
  }
  const plinth = plinthOf(actor, { ...ctx, role: "gm" });
  const m = { role: "gm", plinth, foes, stack };
  if (actor.type === "hazard") { m.hazard = hazardOf(actor, ctx); m.creature = null; }
  else {
    m.creature = creatureOf(actor, ctx);
    const { skills, lores } = skillsOf(actor);
    m.sk = { skills, ...(lores.length ? { lores } : {}), target: targetOf(ctx.target, { ...ctx, truth: true }), pins: [...(ctx.pins ?? [])] };
  }
  return m;
}
