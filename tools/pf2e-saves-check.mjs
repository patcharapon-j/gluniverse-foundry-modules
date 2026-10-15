#!/usr/bin/env node
/**
 * Save Resolution — consistency check.
 *
 * Everything here fails SILENTLY in a session: a basic save on the wrong
 * multiplier deals plausible damage; a creature dropped from the area by an
 * off-by-one cell simply is not on the list; a degree that slips into the
 * session flag prints a hidden NPC's result on every player's console while
 * every screen looks right; a Revert that forgets one condition leaves the
 * creature frightened forever; a player's forged save files against someone
 * else's row. So the rules are driven, not read, wherever they can be.
 *
 *   node tools/pf2e-saves-check.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const problems = [];
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) problems.push(msg);
};
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const C = await imp("scripts/features/pf2e-saves/constants.mjs");
const M = await imp("scripts/features/pf2e-saves/model.mjs");
const R = await imp("scripts/features/pf2e-saves/render.mjs");

/* ── 1. Degree × basic save ─────────────────────────────────────────────── */

{
  // The book: a basic save is double on a critical failure, full on a failure,
  // half on a success, nothing on a critical success.
  const book = [2, 1, 0.5, 0];
  for (let d = 0; d < 4; d++) ok(M.multiplierFor(d, null, true) === book[d], `basic ${C.DEGREES[d]} is ×${M.multiplierFor(d, null, true)}, the book says ×${book[d]}`);
  for (let d = 0; d < 4; d++) ok(M.multiplierFor(C.DEGREES[d], null, true) === book[d], `basic multiplier by key ${C.DEGREES[d]}`);
  ok(eq([0, 1, 2, 3].map((d) => M.multiplierFor(d, null, false)), [1, 1, 0, 0]), "a non-basic save defaults to full on a failure, nothing on a success");
  ok(M.multiplierFor(null, null, true) === null && M.multiplierFor(4, null, true) === null, "an unknown degree carries no multiplier");
  const cfg = M.normalizeConfig({ mult: { failure: 0.5, success: 7 } }, true);
  ok(M.multiplierFor(1, cfg, true) === 0.5, "the GM's multiplier wins");
  ok(M.multiplierFor(2, cfg, true) === 0.5, "an invalid multiplier falls back to the basic one");
  ok(C.MULTS.every((m) => [0, 0.5, 1, 2].includes(m)) && C.MULTS.length === 4, "the panel offers exactly ×0, ×½, ×1, ×2");
}

/* ── 2. The apply preview ───────────────────────────────────────────────── */

{
  const p = (insts, m) => M.previewDamage(insts, m);
  ok(p([{ type: "fire", total: 15 }], 0.5).final === 7, "half of 15 rounds down to 7");
  ok(p([{ type: "fire", total: 15 }], 2).final === 30, "double damage doubles");
  ok(p([{ type: "fire", total: 15 }], 0).final === 0 && p([{ type: "fire", total: 15 }], 0).notes.length === 0, "×0 is nothing and says nothing");
  ok(p([{ type: "fire", total: 15, immune: "fire" }], 1).final === 0, "an immunity zeroes the instance");
  ok(p([{ type: "fire", total: 10, resistance: { label: "fire", value: 5 } }], 1).final === 5, "resistance subtracts");
  const capped = p([{ type: "fire", total: 3, resistance: { label: "fire", value: 5 } }], 1);
  ok(capped.final === 0, "resistance never takes damage below zero");
  ok(capped.notes.find((n) => n.kind === "resist")?.amount === 3, "and says it resisted only what there was (3, not 5)");
  ok(p([{ type: "cold", total: 10, weakness: { label: "cold", value: 3 } }], 1).final === 13, "weakness adds");
  ok(p([{ type: "cold", total: 1, weakness: { label: "cold", value: 3 } }], 0).final === 0, "weakness needs damage to land on");
  ok(p([{ type: "cold", total: 10, weakness: { label: "cold", value: 3 }, resistance: { label: "cold", value: 5 } }], 1).final === 8, "weakness then resistance");
  const mixed = p([{ type: "fire", total: 12 }, { type: "bleed", total: 2, persistent: true }], 1);
  ok(mixed.final === 12 && mixed.persistent === 1, "persistent damage is counted, not previewed");
  ok(p([{ type: "fire", total: 10, resistance: { label: "fire", value: 5 } }], 1).notes.some((n) => n.kind === "resist" && n.amount === 5), "the preview says why: resist fire 5");
}

/* ── 3. Effects by degree, read from the spell's own text ───────────────── */

{
  const labels = {
    criticalFailure: ["Critical Failure"], failure: ["Failure"], success: ["Success"], criticalSuccess: ["Critical Success"],
  };
  const fear = `<p>You plant fear in the target.</p><hr />
<p><strong>Critical Success</strong> The target is unaffected.</p>
<p><strong>Success</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 1}.</p>
<p><strong>Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 2}.</p>
<p><strong>Critical Failure</strong> The target is @UUID[Compendium.pf2e.conditionitems.Item.TBSHQspnbcqxsmjL]{Frightened 3} and @UUID[Compendium.pf2e.conditionitems.Item.sDPxOjQ9kx2RZE8D]{Fleeing} for 1 round. See @UUID[Compendium.pf2e.journals.JournalEntry.x]{Fear}.</p>
<hr /><p><strong>Heightened (3rd)</strong> You can target up to five creatures, who are @UUID[Compendium.pf2e.conditionitems.Item.AJh5ex99aV6VTggg]{Stunned 1}.</p>`;
  const e = M.parseDegreeEffects(fear, labels);
  ok(e.criticalSuccess.length === 0, "an unaffected critical success applies nothing");
  ok(eq(e.success.map((x) => [x.label, x.value]), [["Frightened 1", 1]]), `"Success" reads frightened 1 (got ${JSON.stringify(e.success)})`);
  ok(eq(e.failure.map((x) => x.value), [2]), "\"Failure\" reads frightened 2, not Critical Failure's");
  ok(eq(e.criticalFailure.map((x) => [x.label, x.value]), [["Frightened 3", 3], ["Fleeing", null]]), "a critical failure carries both conditions, an unvalued one at null");
  ok(!Object.values(e).flat().some((x) => /Stunned/.test(x.label)), "a heightening's links are never read as an outcome");
  ok(!Object.values(e).flat().some((x) => /journals/.test(x.uuid)), "only condition and effect links are taken");
  const ruled = M.parseDegreeEffects(`<p><strong>Failure</strong> @UUID[Compendium.pf2e.conditionitems.Item.a]{Clumsy 1}</p><hr /><p>At 5th rank the target is also @UUID[Compendium.pf2e.conditionitems.Item.b]{Stunned 1}.</p>`, labels);
  ok(ruled.failure.length === 1, "a rule ends the last degree's text, labelled paragraph or not");
  const fr = M.parseDegreeEffects(`<p><strong>Échec</strong> @UUID[Compendium.pf2e.conditionitems.Item.a]{Effrayé 2}</p>`, { failure: ["Failure", "Échec"] });
  ok(fr.failure.length === 1 && fr.failure[0].value === 2, "a translated degree label is read too");
  const effect = M.parseDegreeEffects(`<p><strong>Failure</strong> @UUID[Compendium.pf2e.spell-effects.Item.abc]{Spell Effect: Slow}</p>`, labels);
  ok(effect.failure[0]?.uuid === "Compendium.pf2e.spell-effects.Item.abc", "spell effects are taken");
  const twice = M.parseDegreeEffects(`<p><strong>Failure</strong> @UUID[Compendium.pf2e.conditionitems.Item.a]{Clumsy 1} and again @UUID[Compendium.pf2e.conditionitems.Item.a]{Clumsy 1}</p>`, labels);
  ok(twice.failure.length === 1, "one link twice in a line is one effect");
  ok(M.normalizeConfig({ effects: { failure: [{ uuid: "x y", label: "bad" }] } }).effects.failure.length === 0, "a malformed uuid is dropped from a config");
}

/* ── 4. Area membership against pf2eCoverage's offsets ──────────────────── */

{
  const cov = { covered: [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 1, j: 0 }], blocked: [{ i: 5, j: 5 }] };
  const tokens = [
    { id: "inA", cells: [{ i: 0, j: 0 }] },
    { id: "edge", cells: [{ i: 1, j: 1 }, { i: 1, j: 0 }] },   // a large creature with one square inside
    { id: "out", cells: [{ i: 9, j: 9 }] },
    { id: "cut", cells: [{ i: 5, j: 5 }] },
    { id: "both", cells: [{ i: 5, j: 5 }, { i: 0, j: 1 }] },   // inside wins over blocked
    { id: "none", cells: [] },
  ];
  const m = M.membersOf(tokens, cov);
  ok(eq(m.inside, ["inA", "edge", "both"]), `inside = ${JSON.stringify(m.inside)}`);
  ok(eq(m.blocked, ["cut"]), `blocked = ${JSON.stringify(m.blocked)}`);
  ok(eq(M.membersOf(tokens, null), { inside: [], blocked: [] }), "no coverage, nobody inside");
  // pf2eCoverage returns the offsets Foundry's grid returns; tokens' cells are the same shape.
  const aoe = read("scripts/features/pf2e-aoe/data.mjs");
  ok(/export function pf2eCoverage\(/.test(aoe) && /covered\.push|\(blockedByWall \? blocked : covered\)\.push\(offset\)/.test(aoe), "pf2eCoverage still returns {covered, blocked} offsets");
  ok(/getOccupiedGridSpaceOffsets/.test(read("scripts/features/pf2e-saves/main.mjs")), "token cells come from Foundry's own occupied offsets");
}

/* ── 5. The session flag carries nothing a player may not read ──────────── */

const ROW = (o = {}) => ({ id: "t1", tokenUuid: "Scene.s.Token.t1", actorUuid: "Actor.a1", kind: "npc", name: "", img: "", hidden: false, rollId: null, applied: null, ...o });
const SESSION = (o = {}) => ({
  id: "s1", castId: "c1", spellUuid: "Actor.c.Item.fireball", casterUuid: "Actor.c", spellName: "Fireball", spellImg: "f.webp",
  save: "reflex", dc: 22, basic: true, rank: 3, rows: [ROW()], blocked: [], damageId: null,
  config: { mult: {}, effects: {} }, combatId: null, at: 1000, closed: false, ...o,
});

{
  const leaky = SESSION({
    degree: 3, total: 31, natural: 20,
    rows: [ROW({ degree: 0, total: 4, natural: 1, mult: 2, hp: 30, outcome: "criticalFailure", applied: { at: 5, takenId: "m9", created: ["i1"], changed: [{ id: "i2", from: 1, to: 2, degree: 0 }], degree: 0, hpBefore: 40 } })],
    blocked: [ROW({ id: "b1", degree: 2 })],
  });
  const s = M.normalizeSession(leaky);
  const BANNED = /^(degree|total|natural|mult|hp|hpBefore|outcome|to|modifiers|mods)$/;
  const keys = [];
  const walk = (o, path = "") => {
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (!Array.isArray(o)) keys.push(`${path}${k}`); walk(v, `${path}${k}.`); }
  };
  walk(s);
  // `config.mult` is the per-degree table, the same for every creature; a result is per row.
  const leaked = keys.filter((k) => !k.startsWith("config.") && BANNED.test(k.split(".").pop()));
  ok(!leaked.length, `the session carries a result: ${leaked.join(", ")}`);
  ok(eq(s.rows[0].applied, { at: 5, combatId: null, takenId: "m9", created: ["i1"], changed: [{ id: "i2", from: 1 }] }), "the undo record is ids and condition values only");
  ok(M.normalizeSession({ ...SESSION(), save: "perception" }) === null, "only the three saves");
  ok(M.normalizeSession(SESSION({ rows: [ROW(), ROW()] })).rows.length === 1, "a creature is on the list once");
  ok(M.normalizeSession(SESSION({ blocked: [ROW()] })).blocked.length === 0, "a creature on the list is not also Blocked");
  ok(M.normalizeSession(SESSION({ rows: Array.from({ length: 99 }, (_, i) => ROW({ id: `t${i}` })) })).rows.length === C.MAX_ROWS, "rows are capped");
  ok(M.normalizeSession(SESSION({ dc: 1e9 })).dc === null, "a nonsense DC is dropped");
  ok(M.normalizeSession(SESSION({ rows: [ROW({ kind: "boss" })] })).rows.length === 0, "an unknown row kind is dropped");
  // Nothing in the glue writes a result into the flag.
  const main = read("scripts/features/pf2e-saves/main.mjs");
  ok(!/\.(degree|total|natural|outcome)\s*=/.test(main.replace(/live\.\w+\s*=/g, "")), "main.mjs assigns no result field onto anything it writes");
  ok(/r\.rollId = message\.id/.test(main) && (main.match(/\.rollId = /g) ?? []).length === 2, "a row's save is filed in one place (and unfiled in one)");
}

/* ── 6. Matching what lands in chat ─────────────────────────────────────── */

{
  const s = M.normalizeSession(SESSION({ rows: [ROW({ id: "t1" }), ROW({ id: "t2", actorUuid: "Actor.a2" }), ROW({ id: "t3", actorUuid: "Actor.a3" }), ROW({ id: "t4", actorUuid: "Actor.a3" })] }));
  const actorIdOf = (r) => r.actorUuid.split(".").pop();
  const save = (o) => ({ type: "saving-throw", statistic: "reflex", identifier: null, originUuid: null, tokenId: null, actorId: null, ...o });
  ok(M.rowForSave(s, save({ identifier: M.identFor("s1", "t2") }), actorIdOf)?.id === "t2", "our own identifier files to its row");
  ok(M.rowForSave(s, save({ identifier: M.identFor("other", "t2"), originUuid: s.spellUuid, tokenId: "t2" }), actorIdOf) === null, "another session's roll is never filed here, even on the same spell");
  ok(M.rowForSave(s, save({ originUuid: s.spellUuid, tokenId: "t1" }), actorIdOf)?.id === "t1", "PF2e's own spell-card button files by token");
  ok(M.rowForSave(s, save({ originUuid: s.spellUuid, actorId: "a2" }), actorIdOf)?.id === "t2", "no token: a unique actor files");
  ok(M.rowForSave(s, save({ originUuid: s.spellUuid, actorId: "a3" }), actorIdOf) === null, "two rows of one actor: no guessing");
  ok(M.rowForSave(s, save({ originUuid: "Actor.c.Item.other", tokenId: "t1" }), actorIdOf) === null, "a save against another spell is not ours");
  ok(M.rowForSave(s, save({ statistic: "will", identifier: M.identFor("s1", "t1") }), actorIdOf) === null, "the wrong save is not ours");
  ok(M.rowForSave(s, save({ type: "skill-check", identifier: M.identFor("s1", "t1") }), actorIdOf) === null, "only saving throws");
  ok(M.rowForSave({ ...s, closed: true }, save({ identifier: M.identFor("s1", "t1") }), actorIdOf) === null, "a closed session files nothing");
  ok(M.takesDamage(s, { type: "damage-roll", originUuid: s.spellUuid }), "the spell's damage roll is the session's");
  ok(!M.takesDamage(s, { type: "damage-roll", originUuid: "x" }), "another item's damage is not");
  ok(!M.takesDamage({ ...s, rows: [{ ...s.rows[0], applied: { at: 1 } }] }, { type: "damage-roll", originUuid: s.spellUuid }), "once anything is applied, a new damage roll never replaces the one it was applied from");
  ok(eq(M.newestFirst([{ at: 1 }, { at: 3, closed: true }, { at: 2 }]).map((x) => x.at), [2, 1]), "newest open session first");
  // The author must own what they file.
  const main = read("scripts/features/pf2e-saves/main.mjs");
  ok(/if \(!author\?\.isGM && !owns\(author, row\)\) return;/.test(main), "a player's save files only against a creature they own");
}

/* ── 7. Undo: live window and the round trip ────────────────────────────── */

{
  const rec = { at: 0, combatId: null };
  ok(M.undoLive(rec, { now: C.UNDO_MS - 1 }) && !M.undoLive(rec, { now: C.UNDO_MS }), "outside combat, ten minutes");
  ok(M.undoLive({ at: 0, combatId: "c" }, { now: 1e12, combatAlive: (id) => id === "c" }), "in combat, until the encounter ends");
  ok(!M.undoLive({ at: 0, combatId: "c" }, { now: 1, combatAlive: () => false }), "an ended encounter ends it");
  ok(!M.undoLive(null, { now: 0 }), "nothing applied, nothing to revert");

  // Drive apply → revert on a fake creature and require it back exactly as it was.
  const creature = () => ({ hp: 40, items: new Map([["f", { slug: "frightened", value: 1 }], ["c", { slug: "clumsy", value: 2 }]]) });
  const snapshot = (a) => JSON.stringify({ hp: a.hp, items: [...a.items.entries()].sort() });
  let n = 0;
  const apply = (actor, effects, dmg) => {
    const record = { at: 0, combatId: null, takenId: null, created: [], changed: [] };
    if (dmg) { actor.hp -= dmg; record.takenId = "taken"; actor.taken = dmg; }
    for (const e of effects) {
      const hit = [...actor.items.entries()].find(([, it]) => it.slug === e.slug);
      const plan = M.planCondition(hit ? { id: hit[0], value: hit[1].value } : null, e);
      if (plan.op === "raise") { record.changed.push({ id: plan.id, from: plan.from }); actor.items.get(plan.id).value = plan.to; }
      if (plan.op === "create") { const id = `n${++n}`; actor.items.set(id, { slug: e.slug, value: e.value }); record.created.push(id); }
    }
    return M.normalizeSession(SESSION({ rows: [ROW({ applied: record })] })).rows[0].applied;
  };
  const revert = (actor, record) => {
    const plan = M.planRevert(record, (id) => actor.items.has(id));
    if (plan.undoDamage) actor.hp += actor.taken;
    for (const id of plan.remove) actor.items.delete(id);
    for (const r of plan.restore) actor.items.get(r.id).value = r.value;
  };
  const effects = [{ slug: "frightened", value: 3 }, { slug: "clumsy", value: 1 }, { slug: "stunned", value: 1 }, { slug: "prone", value: null }];
  const a = creature();
  const before = snapshot(a);
  const record = apply(a, effects, 14);
  ok(a.items.get("f").value === 3, "frightened 1 is raised to 3");
  ok(a.items.get("c").value === 2, "clumsy 2 is not lowered by clumsy 1");
  ok([...a.items.values()].filter((x) => x.slug === "stunned").length === 1, "stunned is created once");
  revert(a, record);
  ok(snapshot(a) === before, `the round trip leaves the creature as it was (${snapshot(a)} vs ${before})`);
  // A condition that ran out before the Revert is not brought back.
  const b = creature();
  const r2 = apply(b, [{ slug: "frightened", value: 2 }, { slug: "stunned", value: 1 }], 0);
  b.items.delete("f");
  const stunId = r2.created[0];
  b.items.delete(stunId);
  const plan = M.planRevert(r2, (id) => b.items.has(id));
  ok(plan.remove.length === 0 && plan.restore.length === 0, "an item already gone is neither deleted again nor re-created");
}

/* ── 8. Who sees what ───────────────────────────────────────────────────── */

{
  const live = { name: "Goblin Pyro", img: "gob.webp", result: { degree: 0, face: 1, total: 4 }, preview: { final: 30, notes: [] }, effects: [{ label: "x" }], mult: 2 };
  const gm = { truth: true, isGM: true };
  const player = { truth: false, isGM: false };
  const stream = { truth: false, isGM: true };
  const rolled = ROW({ rollId: "m1" });
  ok(M.rowView(ROW({ hidden: true }), { ...player, live }) === null, "a hidden creature's row is not drawn for a player");
  ok(M.rowView(ROW({ hidden: true }), { ...stream, live }) === null, "nor for the stream login, which holds GM rights");
  ok(M.rowView(ROW({ hidden: true }), { ...gm, live }) !== null, "the GM sees it");
  const pv = M.rowView(rolled, { ...player, live: { ...live, result: null } });
  ok(pv.name === "" && pv.img === "", "a player sees the stored public name, never the live one");
  ok(pv.state === "sealed" && pv.degree === null && pv.total === null, "a sealed save shows only that it was rolled");
  ok(pv.preview === null && pv.effects.length === 0 && pv.mult === null && !pv.canApply && !pv.canRemove, "no apply surface for a player");
  const sv = M.rowView(rolled, { ...stream, live });
  ok(!sv.canApply && sv.preview === null && sv.mult === null && sv.name === "", "the stream login gets the player's view");
  const gv = M.rowView(rolled, { ...gm, live });
  ok(gv.name === "Goblin Pyro" && gv.canApply && gv.preview?.final === 30 && gv.mult === 2, "the GM gets the truth and the controls");
  ok(!M.rowView(ROW(), { ...gm, live: { ...live, result: null } }).canApply, "nothing to apply before the roll");
  ok(M.rowView(ROW({ rollId: "m1", applied: { at: 1 } }), { ...gm, live, undo: true }).canRevert, "an applied row can be reverted while live");
  ok(!M.rowView(ROW({ rollId: "m1", applied: { at: 1 } }), { ...gm, live, undo: false }).canRevert, "and not after");
  ok(!M.rowView(ROW({ rollId: "m1", applied: { at: 1 } }), { ...gm, live }).canRemove, "an applied row cannot be dropped from the list");
  ok(M.mayRoll({ isGM: false, id: "u" }, ROW({ kind: "pc" }), { owns: () => true }), "a player rolls their own creature");
  ok(!M.mayRoll({ isGM: false, id: "u" }, ROW({ kind: "pc" }), { owns: () => false }), "and nobody else's");
  ok(!M.mayRoll({ isGM: false, id: "u" }, ROW({ kind: "npc" }), { owns: () => true }), "a player never rolls an NPC row");
  ok(!M.mayRoll({ isGM: true }, ROW({ rollId: "m" })), "a row is rolled once");
  ok(M.mayWrite({ isGM: true }) && !M.mayWrite({ isGM: false }), "only a GM writes");
}

/* ── 9. The GM-only write path ──────────────────────────────────────────── */

{
  const main = read("scripts/features/pf2e-saves/main.mjs");
  const body = (name) => {
    const i = main.search(new RegExp(`(?:async )?function ${name}\\(`));
    return i < 0 ? "" : main.slice(i, main.indexOf("\n}\n", i));
  };
  for (const fn of ["requestApply", "requestRevert"]) ok(/if \(!mayWrite\(game\.user\) \|\| !gmView\(\)\) return null;/.test(body(fn)), `${fn} refuses anyone but a GM who sees the truth`);
  for (const fn of ["applyRows", "revertRows"]) {
    ok(/if \(!isConductor\(\)\) return;/.test(body(fn)), `${fn} runs on the conductor only (one queue for every GM)`);
    ok(main.includes(`serially(() => ${fn}(`), `${fn} runs inside serially(): two clicks never both apply one row`);
  }
  ok(/s = readSession\(message\);\s+const row = s\?\.rows/.test(body("applyRows")), "Apply re-reads each row fresh before touching its creature");
  {
    const sock0 = main.slice(main.indexOf("onSocket(FEATURE_ID"), main.indexOf("Hooks.on(\"createChatMessage\""));
    ok(/if \(!user\.isGM \|\| !seesTruth\(user\)\) return;/.test(sock0), "a socketed Apply/Revert is honoured only from a GM who sees the truth");
    ok(/MULTS\.includes\(p\[1\]\)/.test(sock0), "a socketed multiplier override is one of the four multipliers");
    ok(/castMsg\.item\?\.actor/.test(sock0) && /castMsg\.actor\.uuid !== owner\.uuid/.test(sock0), "a player's open is authorised against the SPELL's actor, which must be the speaker");
  }
  // Review round 2: every session write is the conductor's.
  ok(/if \(!gmView\(\)\) return null;/.test(body("setConfig")) && /requestEdit\(messageId, \{ op: "config"/.test(body("setConfig")), "setConfig refuses anyone but the GM and is sent to the conductor");
  ok(/if \(!gmView\(\)\) return null;\s+return viaConductor\(MSG\.edit/.test(body("requestEdit")), "row edits go through the GM gate, to the conductor");
  ok(/if \(!isConductor\(\)/.test(body("runEdit")) && !/editRows/.test(main), "edits run on the conductor only (no local read-modify-write)");
  ok(main.includes("serially(() => runEdit(messageId, edit))") && main.includes("serially(() => runEdit(messageId, payload.edit))") && main.split("runEdit(messageId").length === 4, "edits share Apply/Revert's queue: a row is never removed mid-Apply");
  {
    const outsideMutate = main.replace(body("mutate"), "");
    const callers = [...outsideMutate.matchAll(/\bmutate\(/g)].map((m) => {
      const head = outsideMutate.lastIndexOf("\nasync function ", m.index), head2 = outsideMutate.lastIndexOf("\nfunction ", m.index);
      return outsideMutate.slice(Math.max(head, head2) + 1).match(/function (\w+)/)?.[1];
    });
    const allowed = new Set(["runEdit", "observeNow", "forgetNow", "applyRows", "revertRows"]);
    ok(callers.length >= 5 && callers.every((c) => allowed.has(c)), `mutate() is called only from conductor-side functions (got ${[...new Set(callers)].join(", ")})`);
  }
  {
    const sock1 = main.slice(main.indexOf("onSocket(FEATURE_ID"), main.indexOf("Hooks.on(\"createChatMessage\""));
    ok(/MSG\.edit\) \{\s+if \(!user\.isGM \|\| !seesTruth\(user\)\) return;/.test(sock1), "a socketed edit is honoured only from a GM who sees the truth");
  }
  ok(main.includes("const observe = (message) => serially(() => observeNow(message));") && main.includes("const forgetMessage = (message) => serially(() => forgetNow(message));"), "filing shares Apply's queue: the damage never changes under a running Apply");
  ok(/castTime\(x\) <= message\.timestamp/.test(body("observeNow")), "a roll is filed only into a session whose cast came before it");
  ok(/const cur = r\.rollId \? game\.messages\.get\(r\.rollId\)/.test(body("observeNow")), "save freshness is re-checked inside the queued write");
  ok(/opening\.then\(\(\) => openSessionNow\(/.test(body("openSession")), "opens are serialized: one cast, one session");
  // Review round 1: each of these failed silently.
  ok(/!m\.blind/.test(body("resultFor")) && !/m\.isAuthor/.test(body("resultFor")), "a blind save is not read back to its own author");
  ok(/instanceof DamageRoll/.test(body("observeNow")) && /casterOf\(s\)\?\.testUserPermission\?\.\(author, "OWNER"\)/.test(body("observeNow")), "a damage roll is filed only when real and rolled by the GM or the caster's owner");
  ok(/castMsg\.whisper/.test(body("openSessionNow")) && /castMsg\.blind/.test(body("openSessionNow")) && /spellName: priv \? ""/.test(body("openSessionNow")) && /getSpeaker\(\{ user: game\.user \}\)/.test(body("openSessionNow")), "a private cast's session card names no spell and speaks as the GM");
  ok(!/isConnected/.test(body("renderCard")) && /_glsvGen !== gen/.test(body("renderCard")), "the card renders into the detached host Foundry hands the hook");
  ok(!/Item\.\$\{cond\.id\}/.test(main) && /ConditionManager\?\.conditions\?\.get\(/.test(body("pickCondition")), "a picked condition's uuid comes from the canonical document, not a clone");
  ok(/!before\.has\(m\.id\)/.test(body("applyDamageTo")) && !/since - 1000/.test(main), "the damage-taken card is found by identity, never by time");
  ok(/getContextualClone\?\.\(originOpts, ephemeral\)/.test(body("applyDamageTo")) && /ephemeralEffects/.test(body("targetEffects")), "Apply passes the caster's damage-received target effects, as PF2e does");
  ok(!/!r\.applied/.test(body("forgetNow")), "a deleted save unfiles an applied row too (a reroll after Apply is filed on Revert)");
  ok(/reconcile\(/.test(body("openPanel")) && /reconcile\(s\._msg\)/.test(main.slice(main.indexOf("export function onReady"))), "sessions catch up when opened and when a conductor starts");
  ok(/maskRow\(row, liveOf\(row\)\)/.test(body("buildView")) && /Hooks\.on\("updateToken"/.test(main), "visibility is re-read live and refreshed on token changes");
  for (const fn of ["rollNpcs", "rollDamage"]) ok(/if \(!gmView\(\)\) return;/.test(body(fn)), `${fn} refuses anyone but the GM`);
  for (const fn of ["openSessionNow", "observeNow", "forgetNow"]) ok(/if \(!isConductor\(\)\) return/.test(body(fn)), `${fn} runs on the active GM only`);
  const calls = [...main.matchAll(/\bmutate\(/g)].length;
  ok(calls >= 1 && !/game\.messages\.get\([^)]*\)\.update\(\{\s*\[`flags\.\$\{SUITE_ID\}\.\$\{FLAG\}`/.test(main.replace(body("mutate"), "")), "the session flag is written only through mutate()");
  // The socket: one op, from the attested sender, who must be the GM or own the caster.
  const sock = main.slice(main.indexOf("onSocket(FEATURE_ID"), main.indexOf("Hooks.on(\"createChatMessage\""));
  ok(/isConductor\(\)/.test(sock) && /meta\?\.attested/.test(sock) && /game\.users\.get\(meta\.attested\)/.test(sock), "the socket trusts only the server-attested sender, on the conductor");
  ok(/testUserPermission\?\.\(user, "OWNER"\)/.test(sock), "only the GM or the caster's owner may open a session");
  ok(!/__claimedSender|claimed\b(?!,)/.test(sock.replace("_claimed", "")), "the claimed sender is never trusted");
  ok(!/game\.socket/.test(main), "sockets go through core/socket.mjs");
  // Apply goes through PF2e's IWR, never the flat path that skips it.
  ok(/skipIWR: false/.test(main) && !/applyFlatDamage|final: true/.test(main), "damage is applied through PF2e's IWR (not the flat, IWR-skipping path)");
  ok(/roll\.alter\(mult, 0\)/.test(main), "the multiplier is PF2e's own DamageRoll#alter, as its half/double buttons use");
  ok(/item: spell \?\? undefined/.test(main) && /origin: casterOf\(s\)/.test(main), "saves are rolled with the spell and its caster (incapacitation, spell roll options)");
}

/* ── 10. Markup ─────────────────────────────────────────────────────────── */

{
  const t = (k) => k;
  const row = M.rowView(ROW({ kind: "pc", name: `<img src=x onerror=alert(1)>`, rollId: "m" }), { truth: false, live: { result: { degree: 3, face: 20, total: 31 } } });
  const html = R.rowHTML(row, { t });
  ok(!/<img src=x/.test(html), "a row's name is escaped");
  ok(/data-d="c"/.test(html) && /GLSV\.degree\.criticalSuccess/.test(html), "a critical success is drawn as one");
  const sealed = R.rowHTML(M.rowView(ROW({ rollId: "m" }), { live: { result: null } }), { t });
  ok(!/glsv-degree/.test(sealed) && !/glsv-total/.test(sealed), "a sealed row prints no degree and no total");
  const view = { title: "Fireball", saveLine: "Basic Reflex · DC 22", isGM: true, rows: [M.rowView(ROW({ rollId: "m" }), { truth: true, isGM: true, live: { result: { degree: 1 }, mult: 1, preview: { final: 3, notes: [], persistent: 0 }, effects: [] } })],
    blocked: [{ id: "b", name: "", img: "" }], config: M.normalizeConfig({}, true), npcsToRoll: 1, toApply: 1, toRevert: 0, canRollDamage: true };
  const full = R.sessionHTML(view, { t });
  ok(/data-change="rowMult"/.test(full) && /data-change="configMult"/.test(full) && !/data-action="(rowMult|configMult|effectValue)"/.test(full), "value edits are data-change, never a click action");
  ok(/data-action="unblock"/.test(full), "a Blocked creature can be added in one click");
  const card = R.sessionHTML({ ...view, compact: true }, { t });
  ok(!/glsv-config|glsv-blocked|glsv-toolbar/.test(card), "the card is the compact host");
  // Every action the markup emits has a handler.
  const main = read("scripts/features/pf2e-saves/main.mjs");
  const actionsBlock = main.slice(main.indexOf("export const actions = {"), main.indexOf("export const changes"));
  const changesBlock = main.slice(main.indexOf("export const changes = {"), main.indexOf("/* ── the session card"));
  const src = read("scripts/features/pf2e-saves/render.mjs");
  for (const [, a] of src.matchAll(/data-action="([a-zA-Z]+)"/g)) ok(new RegExp(`\\b${a}:`).test(actionsBlock), `data-action="${a}" has no handler`);
  for (const [, a] of src.matchAll(/b\("([a-zA-Z]+)",/g)) ok(new RegExp(`\\b${a}:`).test(actionsBlock), `toolbar action "${a}" has no handler`);
  for (const [, a] of src.matchAll(/data-change="([a-zA-Z]+)"/g)) ok(a === "rowMult" || new RegExp(`\\b${a}:`).test(changesBlock), `data-change="${a}" has no handler`);
}

/* ── 11. i18n, static and dynamic ───────────────────────────────────────── */

{
  const lang = JSON.parse(read("lang/pf2e-saves.en.json"));
  const src = ["main.mjs", "render.mjs", "panel.mjs"].map((f) => read(`scripts/features/pf2e-saves/${f}`)).join("\n");
  for (const [, k] of src.matchAll(/["'`](GLSV\.[A-Za-z0-9_.]+)["'`]/g)) ok(k in lang, `missing lang key ${k}`);
  for (const k of C.DEGREES) ok(`GLSV.degree.${k}` in lang, `missing dynamic key GLSV.degree.${k}`);
  for (const k of ["waiting", "sealed", "rolled", "applied"]) ok(`GLSV.state.${k}` in lang, `missing dynamic key GLSV.state.${k}`);
  for (const k of ["immune", "weak", "resist", "persistent"]) ok(`GLSV.iwr.${k}` in lang, `missing dynamic key GLSV.iwr.${k}`);
  for (const k of Object.values(C.SETTINGS)) {
    const key = k.slice(C.PREFIX.length);
    ok(`GLSV.settings.${key}.name` in lang && `GLSV.settings.${key}.hint` in lang, `setting ${k} has no label`);
  }
  ok("GLS.feature.pf2e-saves.title" in lang && "GLS.feature.pf2e-saves.hint" in lang, "the feature has no title in the Control Center");
  ok(Object.values(C.SETTINGS).every((k) => k.startsWith(C.PREFIX)), "every setting key carries the sv. prefix");
}

/* ── 12. Purity, CSS, registration ──────────────────────────────────────── */

{
  for (const f of ["model.mjs", "render.mjs", "constants.mjs"]) {
    const s = read(`scripts/features/pf2e-saves/${f}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    ok(!/\b(game|canvas|foundry|ui|Hooks|document)\./.test(s), `${f} reaches into Foundry (it must stay pure)`);
  }
  const panel = read("scripts/features/pf2e-saves/panel.mjs");
  ok(/export function SavesPanel\(\)\s*\{\s*if \(_Panel\) return _Panel;\s*const \{ ApplicationV2 \} = foundry\.applications\.api;/.test(panel), "the panel class is built in a memoised factory, never at module scope");
  const idx = read("scripts/features/pf2e-saves/index.mjs");
  ok(!/Hooks\.(on|once)/.test(idx), "the adapter registers no hooks at import time");

  const css = read("styles/pf2e-saves.css");
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/:root/.test(bare), "no :root in the feature's sheet");
  ok(!/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(bare), "no raw white veil");
  ok(!/\b\d+(\.\d+)?m?s\b/.test(bare.replace(/var\([^)]*\)/g, "")), "no raw durations");
  ok(!/@keyframes\s+(?!glsv-)/.test(bare), "keyframes of our own carry the glsv- prefix");
  ok(!/@font-face|@import/.test(bare), "no fonts or imports");
  ok(/\.gl-btn[^{]*\{[^}]*font-size/.test(bare), "a .gl-btn this feature emits is sized by this feature");
  ok(/\.glsv-open-btn\s*\{[^}]*font-size/.test(bare), "the spell-card button is sized");
  ok(!/border-radius:\s*(999|50%|var\(--gl-r-pill\))/.test(bare), "no pill buttons");

  const m = JSON.parse(read("module.json"));
  ok(m.styles.includes("styles/pf2e-saves.css"), "module.json does not load the stylesheet");
  ok(m.languages.some((l) => l.path === "lang/pf2e-saves.en.json"), "module.json does not load the lang file");
  ok(/import "\.\/pf2e-saves\/index\.mjs"/.test(read("scripts/features/index.mjs")), "the adapter is not imported");
  ok(/saveOdds:/.test(read("scripts/features/pf2e-odds/index.mjs")), "pf2e-odds exposes saveOdds for the rows");
  ok(readdirSync(join(ROOT, "scripts/features/pf2e-saves")).every((f) => f.endsWith(".mjs")), "only modules in the feature folder");
}

/* ── 13. Live masking and private sessions ────────────────────────────── */

{
  const row = { ...ROW({ kind: "npc", name: "Ogre", img: "o.png" }), hidden: false };
  ok(M.maskRow(row, null) === row, "a gone token leaves the stored row standing");
  const hid = M.maskRow(row, { hidden: true, named: false, name: "Ogre", img: "o.png" });
  ok(hid.hidden && hid.name === "" && hid.img === "", "a token hidden since the session opened is hidden and unnamed");
  ok(M.rowView(hid, { truth: false }) === null, "a hidden row is absent for a player");
  const masked = M.maskRow(row, { hidden: false, named: false, name: "Ogre", img: "o.png" });
  ok(masked.name === "" && masked.img === "", "a name concealed since the session opened is masked");
  const shown = M.maskRow({ ...row, name: "", img: "" }, { hidden: false, named: true, name: "Ogre", img: "o.png" });
  ok(shown.name === "Ogre" && shown.img === "o.png", "a name revealed since is shown");
  ok(M.normalizeSession(SESSION({ private: true })).private === true && M.normalizeSession(SESSION()).private === false, "the private mark survives normalising, and defaults off");
}

/* ── report ─────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join("\n"));
  console.log(`\n${problems.length} problem(s), ${checks} checks`);
  process.exit(1);
}
console.log(`pf2e-saves: ${checks} checks, 0 problems`);
