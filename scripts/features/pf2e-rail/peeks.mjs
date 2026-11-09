/**
 * PF2e HUD — peek and drawer models built from PF2e documents.
 *
 * Pure: plain reads of the documents the host hands over, so the check tool
 * builds them from fakes. Two fields are markup: a peek's `from` line and its
 * `text` are printed unescaped by view.mjs, so `from` is escaped HERE and
 * `text` must be PF2e's own enriched description (the host enriches it with
 * TextEditor, exactly as the sheet prints it).
 *
 * `PEEK_PRESSES` is every `data-pa` a peek here can carry, and `ROW_KEYS`
 * every `data-row` prefix a drawer here can carry: the host handles each and
 * the check tool holds the two to each other.
 */
import { escapeHTML as esc } from "../../core/util.mjs";
import { costOf, spellCost } from "./read.mjs";

export const PEEK_PRESSES = Object.freeze(["cast", "use", "post"]);
export const ROW_KEYS = Object.freeze(["rest", "macro", "i", "foe", "rank", "explore", "strike"]);

const list = (v) => (Array.isArray(v) ? v : v ? Array.from(v) : []);
const traitLabels = (traits, labels = {}, loc = (k) => k) => list(traits).map((x) => (typeof x === "string" ? loc(labels[x] ?? x) : x?.label ?? x?.name ?? "")).filter(Boolean);

/** A strike: what it is, its traits, damage and critical, and Post. */
export function strikePeek(strike, { t, mod, damage, critical, loc, labels }) {
  const range = strike.item?.range?.increment ? t("GLRAIL.peek.rangeN", { n: strike.item.range.increment }) : strike.item?.isRanged ? "" : t("GLRAIL.peek.melee");
  return {
    name: strike.label ?? strike.item?.name ?? "",
    from: `${esc(t("GLRAIL.peek.strike"))}${mod ? ` · <b>${esc(mod)}</b>` : ""}`,
    traits: traitLabels(strike.traits?.length ? strike.traits : strike.item?.system?.traits?.value, labels?.weapon, loc),
    lines: [[t("GLRAIL.peek.damage"), damage ?? ""], [t("GLRAIL.peek.critical"), critical ?? ""], ...(range ? [[t("GLRAIL.peek.range"), range]] : [])].filter(([, v]) => v),
    actions: [{ id: "post", label: t("GLRAIL.peek.post") }],
  };
}

/** A spell: its rank and where it is cast from, the stat lines, its text,
 *  and Cast (the card's own press) and Post. */
export function spellPeek(spell, { t, rank, entryName, dc, text = "" }) {
  const s = spell.system ?? {};
  const area = s.area?.value ? t("GLRAIL.peek.areaN", { n: s.area.value, type: s.area.type ?? "" }) : "";
  const defense = s.defense?.save?.statistic ? t(`GLRAIL.check.${s.defense.save.statistic}`) + (s.defense.save.basic ? ` (${t("GLRAIL.peek.basic")})` : "") : "";
  const rankLabel = rank === "c" ? t("GLRAIL.rank.cantrips") : rank === "f" ? t("GLRAIL.rank.focus") : t("GLRAIL.rank.n", { n: rank });
  return {
    name: spell.name,
    from: [esc(rankLabel), entryName ? esc(entryName) : "", dc != null ? `<b>${esc(t("GLRAIL.skill.dcShort", { dc }))}</b>` : ""].filter(Boolean).join(" · "),
    traits: list(s.traits?.value).map((x) => String(x)),
    lines: [[t("GLRAIL.peek.range"), s.range?.value ?? ""], [t("GLRAIL.peek.area"), area], [t("GLRAIL.peek.defense"), defense]].filter(([, v]) => v),
    text,
    actions: [{ id: "cast", label: t("GLRAIL.peek.cast"), cost: spellCost(spell), primary: true }, { id: "post", label: t("GLRAIL.peek.post") }],
  };
}

/** An action or a feat: Use is PF2e's own (frequency, self-effect), Post the card. */
export function actionPeek(item, { t, text = "" }) {
  const cat = item.type === "feat" ? t("GLRAIL.peek.feat", { n: item.system?.level?.value ?? "" }) : t("GLRAIL.peek.action");
  return {
    name: item.name,
    from: esc(cat),
    traits: list(item.system?.traits?.value).map((x) => String(x)),
    text,
    actions: [{ id: "use", label: t("GLRAIL.peek.use"), cost: costOf(item), primary: true }, { id: "post", label: t("GLRAIL.peek.post") }],
  };
}

/* ── drawer bodies (row models for V.DLIST) ─────────────────────── */

const num = (v, d = null) => (v === null || v === undefined || v === "" || !Number.isFinite(+v) ? d : +v);
const nameOf = (item) => (item?.isIdentified === false ? item.system?.identification?.unidentified?.name ?? item.name : item?.name ?? "");

/** The inventory: consumables to use, then what is worn and held. */
export function inventoryRows(actor, t) {
  const cons = list(actor.itemTypes?.consumable).filter((i) => num(i.system?.quantity, 1) > 0);
  const kept = ["weapon", "shield", "armor", "equipment"].flatMap((k) => list(actor.itemTypes?.[k])).filter((i) => i.system?.equipped?.carryType && i.system.equipped.carryType !== "stowed" && i.system.equipped.carryType !== "dropped");
  const rows = [];
  if (cons.length) rows.push({ head: t("GLRAIL.inv.consumables") }, ...cons.map((i) => ({ key: `i:${i.id}`, act: true, name: nameOf(i), icon: i.img ?? null, n: `×${num(i.system?.quantity, 1)}`, meta: t("GLRAIL.peek.use") })));
  if (kept.length) rows.push({ head: t("GLRAIL.inv.held") }, ...kept.map((i) => ({ key: `i:${i.id}`, act: true, name: nameOf(i), icon: i.img ?? null, n: String(num(i.system?.quantity, 1)), meta: t(i.system.equipped.carryType === "worn" ? "GLRAIL.inv.worn" : "GLRAIL.inv.heldIn", { n: i.system.equipped.handsHeld ?? 1 }) })));
  return rows;
}

/** Conditions and effects, read-only: the sheet is where they are edited. */
export function effectRows(actor) {
  const conds = list(actor.itemTypes?.condition).map((c) => ({ key: `e:${c.id}`, name: c.name, icon: c.img ?? null, ...(num(c.system?.value?.value) ? { tag: String(c.system.value.value) } : {}) }));
  const effs = list(actor.itemTypes?.effect).map((e) => {
    const d = e.remainingDuration;
    const tag = d && Number.isFinite(d.remaining) && d.remaining > 0 && d.label ? d.label : null;
    return { key: `e:${e.id}`, name: e.name, icon: e.img ?? null, ...(tag ? { tag } : {}) };
  });
  return [...conds, ...effs];
}

/** The hotbar page as the Macros drawer draws it. `slots` is Foundry's
 *  `user.getHotbarMacros(page)`: ten `{ slot, macro }`. */
export function macroSlots(slots) {
  return list(slots).slice(0, 10).map((s) => (s?.macro ? { id: s.macro.id, name: s.macro.name, img: s.macro.img ?? null } : null));
}
