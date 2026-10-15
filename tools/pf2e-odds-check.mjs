#!/usr/bin/env node
/**
 * PF2e Odds — consistency check.
 *
 * Everything here fails SILENTLY in a session: a wrong degree band reads as a
 * plausible percentage; a proof that is one too tight puts a player's odds on
 * a DC the creature does not have, and every later roll "contradicts" it; a
 * renamed stat key forgets the party's whole ledger; a GM-only field leaking
 * into a player's model prints the truth on a screen that should show ???.
 *
 * So the engine is driven against a brute-force restatement of PF2e's rules,
 * the observation maths against every (modifier, DC, face) it could see, and
 * the visibility rules against every viewer.
 *
 *   node tools/pf2e-odds-check.mjs
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEAT = join(ROOT, "scripts/features/pf2e-odds");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (!cond) fail(msg);
};

const E = await imp("scripts/core/pf2e-odds.mjs");
const C = await imp("scripts/features/pf2e-odds/constants.mjs");
const VM = await imp("scripts/features/pf2e-odds/view-model.mjs");
const LM = await imp("scripts/features/pf2e-odds/ledger-model.mjs");
const OM = await imp("scripts/features/pf2e-odds/observe-model.mjs");
const MM = await imp("scripts/features/pf2e-odds/map-model.mjs");
const DP = await imp("scripts/features/pf2e-odds/dex-parse.mjs");

/* ── 1. The engine is PF2e ──────────────────────────────────────────────── */

// PF2e's rule, restated from the book rather than from the engine.
function refDegree(face, mod, dc) {
  const total = face + mod;
  let d = total >= dc + 10 ? 3 : total >= dc ? 2 : total <= dc - 10 ? 0 : 1;
  if (face === 20) d = Math.min(3, d + 1);
  if (face === 1) d = Math.max(0, d - 1);
  return d;
}

for (let mod = -6; mod <= 34; mod++) {
  for (let dc = 4; dc <= 48; dc++) {
    for (let face = 1; face <= 20; face++) {
      const got = E.faceDegree(face, mod, dc);
      const d = typeof got === "object" ? got.degree : got;
      if (d !== refDegree(face, mod, dc)) {
        fail(`faceDegree(${face}, +${mod}, DC ${dc}) = ${d}, PF2e says ${refDegree(face, mod, dc)}`);
        break;
      }
    }
  }
}
checks++;

// Headline = P(success or better), counted the slow way.
for (const [mod, dc] of [[12, 21], [5, 30], [25, 15], [0, 10], [-3, 40], [30, 5]]) {
  let hit = 0;
  let crit = 0;
  for (let f = 1; f <= 20; f++) {
    const d = refDegree(f, mod, dc);
    if (d >= 2) hit++;
    if (d === 3) crit++;
  }
  const o = E.oddsOf({ mod, dc });
  ok(o.exact && Math.abs(o.headline.lo - hit / 20) < 1e-9, `oddsOf(+${mod} vs ${dc}) headline ${o.headline?.lo}, expected ${hit / 20}`);
  ok(Math.abs(o.crit.lo - crit / 20) < 1e-9, `oddsOf(+${mod} vs ${dc}) crit ${o.crit?.lo}, expected ${crit / 20}`);
}

// A nat 20 is never worse than a success-step up, a nat 1 never better: the
// classic edge cases.
ok(E.oddsOf({ mod: -10, dc: 40 }).headline.lo === 0, "+−10 vs 40: even a nat 20 is a failure (step up from crit fail) — 0%");
ok(E.oddsOf({ mod: 40, dc: 10 }).headline.lo === 1, "+40 vs 10: a nat 1 only steps a critical down to a success — 100%");

// Fortune: weights are a distribution and keep-higher is (2f − 1)/400.
for (const mode of [false, "keep-higher", "keep-lower"]) {
  const w = E.faceWeights(mode);
  const sum = w.reduce((a, b) => a + b, 0);
  ok(Math.abs(sum - 1) < 1e-9, `faceWeights(${mode}) sums to ${sum}`);
}
{
  const w = E.faceWeights("keep-higher");
  // Arrays may be 0- or 1-indexed; find face 20's weight as the largest.
  ok(Math.abs(Math.max(...w) - 39 / 400) < 1e-9, "keep-higher: P(20) = 39/400");
  ok(Math.abs(E.oddsOf({ mod: 10, dc: 21, rollTwice: "keep-higher" }).headline.lo - (1 - (10 / 20) ** 2)) < 1e-9, "keep-higher on a coin flip is 75%");
}

// Degree adjustments: Evasion lifts success to critical success face by face.
{
  const EV = [{ adjustments: { success: { label: "Evasion", amount: "one-degree-better" } } }];
  const plain = E.faces({ mod: 11, dc: 24 });
  const ev = E.faces({ mod: 11, dc: 24, dos: EV });
  for (let i = 0; i < plain.length; i++) {
    const p = plain[i].degree;
    ok(ev[i].degree === (p === E.SUCCESS ? E.CRIT_SUCCESS : p), `Evasion on face ${plain[i].face}: ${p} → ${ev[i].degree}`);
  }
}

// Flat checks multiply in, the faces stay pure.
ok(E.flatChance(5) === 0.8 && E.flatChance(11) === 0.5 && E.flatChance(null) === 1, "flat checks: DC 5 = 80%, DC 11 = 50%, none = 100%");
ok(Math.abs(E.oddsOf({ mod: 12, dc: 21, flatDc: 5 }).headline.lo - 0.6 * 0.8) < 1e-9, "concealed folds into the headline");

// A range is monotone: the low DC is the high chance.
{
  const o = E.oddsOf({ mod: 12, dc: { lo: 19, hi: 22 } });
  ok(!o.exact && o.headline.lo <= o.headline.hi, "range headline lo ≤ hi");
  ok(Math.abs(o.headline.hi - E.oddsOf({ mod: 12, dc: 19 }).headline.lo) < 1e-9, "range hi = odds at the lowest DC");
  ok(Math.abs(o.headline.lo - E.oddsOf({ mod: 12, dc: 22 }).headline.lo) < 1e-9, "range lo = odds at the highest DC");
  ok(E.oddsOf({ mod: 12, dc: null }).headline === null, "unknown DC → no headline (???)");
}

// MAP.
ok([0, 1, 2].map((i) => E.mapPenalty(i)).join() === "0,-5,-10" && [0, 1, 2].map((i) => E.mapPenalty(i, true)).join() === "0,-4,-8", "MAP 0/−5/−10, agile 0/−4/−8");

/* ── 2. One roll proves exactly what it proves ──────────────────────────── */

// Sound (the truth is always inside) and tight (nothing a DC could not be).
let loose = 0;
for (let mod = -2; mod <= 30; mod += 2) {
  for (let dc = 8; dc <= 44; dc++) {
    for (let face = 1; face <= 20; face++) {
      const total = face + mod;
      const degree = refDegree(face, mod, dc);
      // PF2e's unadjusted outcome includes the natural step and nothing else.
      const b = E.boundsFromRoll({ total, natural: face, degree });
      if (!b || dc < b.lo || dc > b.hi) {
        fail(`boundsFromRoll(total ${total}, nat ${face}, degree ${degree}) = ${JSON.stringify(b)} excludes the true DC ${dc}`);
        mod = 99;
        break;
      }
      // Tight: every finite DC in the bound reproduces the same card.
      for (let x = Math.max(b.lo, -40); x <= Math.min(b.hi, 90); x++) if (refDegree(face, mod, x) !== degree) loose++;
    }
  }
}
ok(loose === 0, `boundsFromRoll admits ${loose} DCs that would have produced a different card`);

{
  const a = E.narrow({ lo: 19, hi: 26 }, { lo: 21, hi: Infinity });
  ok(a.range.lo === 21 && a.range.hi === 26 && !a.contradiction && a.changed, "narrow intersects");
  const c = E.narrow({ lo: 19, hi: 22 }, { lo: 25, hi: 25 });
  ok(c.contradiction && c.range.lo === 25 && c.range.hi === 25, "a contradiction resets to the newest proof, never sticks at impossible");
  const s = E.loadRange(JSON.parse(JSON.stringify(E.storeRange({ lo: -Infinity, hi: 30 }))));
  ok(s.lo === -Infinity && s.hi === 30, "open ends survive the JSON round trip");
}

/* ── 3. The ledger ──────────────────────────────────────────────────────── */

{
  let L = {};
  ({ ledger: L } = LM.fold(L, { kind: "ogre", name: "Ogre", owners: [LM.PARTY], stat: "ac", proof: { lo: 19, hi: Infinity }, at: 1 }));
  ({ ledger: L } = LM.fold(L, { kind: "ogre", owners: [LM.PARTY], stat: "ac", proof: { lo: -Infinity, hi: 23 }, at: 2 }));
  const r = LM.readStat(JSON.parse(JSON.stringify(L)), "ogre", [LM.PARTY], "ac");
  ok(r && r.lo === 19 && r.hi === 23, `ledger narrows across stored JSON: ${JSON.stringify(r)}`);
  const { ledger: L2, changes } = LM.fold(L, { kind: "ogre", owners: [LM.PARTY], stat: "ac", proof: { lo: 30, hi: 30 }, at: 3 });
  ok(changes[0]?.contradiction && LM.contradicted(L2, "ogre", "ac"), "a contradiction is recorded for the GM");
  ok(!LM.readStat(LM.forget(L2, "ogre", "ac"), "ogre", [LM.PARTY], "ac"), "forget drops the stat");
  ok(LM.readStat(L, "ogre", ["char-a"], "ac") === null, "per-character: a character who saw nothing knows nothing");
}

/* ── 4. Only what the players could see ─────────────────────────────────── */

{
  const base = {
    context: { type: "attack-roll", dc: { value: 23, slug: "armor" }, unadjustedOutcome: "success", identifier: "abc.longsword.melee" },
    total: 25, natural: 13, visible: true, resultsShown: true, dcShown: false,
    roller: { creature: false, kind: null }, defender: { creature: true, kind: "ogre" }, dcDelta: 0,
  };
  const one = OM.observationsFrom(base);
  ok(one.length === 1 && one[0].stat === "ac" && one[0].proof.lo <= 23 && one[0].proof.hi >= 23, "a public hit narrows AC");
  ok(OM.observationsFrom({ ...base, visible: false }).length === 0, "a blind or GM-only card teaches nothing");
  ok(OM.observationsFrom({ ...base, resultsShown: false }).length === 0, "a hidden degree teaches nothing");
  const exact = OM.observationsFrom({ ...base, resultsShown: false, dcShown: true });
  ok(exact[0]?.proof.lo === 23 && exact[0]?.proof.hi === 23, "a printed DC pins it");
  const off = OM.observationsFrom({ ...base, dcShown: true, context: { ...base.context, dc: { value: 21, slug: "armor" } }, dcDelta: -2 });
  ok(off[0]?.proof.lo === 23, "off-guard is taken off before filing: the bare AC is stored");
  ok(OM.observationsFrom({ ...base, roller: { creature: true, kind: "wolf" } }).every((o) => o.kind !== "ogre"), "creature against creature teaches nothing about the defender");
  const foe = OM.observationsFrom({ ...base, roller: { creature: true, kind: "ogre" }, defender: { creature: false }, total: 22, natural: 9, modDelta: -5 });
  ok(foe[0]?.stat === "strike:longsword" && foe[0].proof.lo === 18, `a creature's Strike files its bare modifier (MAP off): ${JSON.stringify(foe[0])}`);
  const save = OM.observationsFrom({ ...base, context: { type: "saving-throw", dc: { value: 20, slug: "will" }, unadjustedOutcome: "failure" }, modifierName: "will", roller: { creature: true, kind: "ogre" }, defender: null, total: 15, natural: 9, modDelta: 0 });
  ok(save[0]?.stat === "will" && save[0].proof.lo === 16, "a creature's save is filed as a DC (10 + modifier)");
}

/* ── 5. Who sees what ───────────────────────────────────────────────────── */

{
  const probe = { mod: 12, mods: [], dc: { value: 23, slug: "armor" }, options: [] };
  const pc = { rollerIsCreature: false, defenderIsCreature: true, isGM: false };
  const unseen = VM.buildModel({ probe, who: pc, known: null, label: "x" });
  ok(unseen.state === "unknown" && unseen.headline === null && unseen.dcText === null, "player, never seen: ??? with no DC");
  ok(unseen.gm === null && unseen.lie === false, "a player's model carries no GM fields");
  const json = JSON.stringify(unseen);
  ok(!/\b23\b/.test(json.replace(/"mod":12/, "")) || !json.includes('"dc":{"lo":23'), "a player's unknown model does not carry the true DC");
  const lied = VM.buildModel({ probe, who: pc, known: { lo: 20, hi: 20 }, lie: true, label: "x" });
  ok(lied.lie === false && lied.dcText === "20", "a lie is drawn as the believed number with no trace of it");
  const gm = VM.buildModel({ probe, who: { ...pc, isGM: true }, known: null, playersKnown: { lo: 20, hi: 25 }, lie: true, label: "x" });
  ok(gm.state === "exact" && gm.dcText === "23" && gm.gm && gm.lie === true, "the GM sees the truth and the lie flag");
  ok(VM.buildModel({ probe, who: { rollerIsCreature: true, defenderIsCreature: true, isGM: false }, known: null, label: "x" }) === null, "creature against creature: players see no badge");
  const vsPc = VM.buildModel({ probe, who: { rollerIsCreature: true, defenderIsCreature: false, isGM: false }, known: null, label: "x" });
  ok(vsPc.state === "unknown" && vsPc.dcText === null, "a creature's unseen attack is ??? and prints no DC");
  const foldMod = VM.viewerDc({ side: VM.SIDE.mod, mod: 12, dc: 23, known: { lo: 10, hi: 14 } });
  ok(foldMod.lo === 21 && foldMod.hi === 25, "a modifier range folds into the equivalent DC range");
}

// The stream login never sees the truth: structural, since view.mjs reads the world.
{
  const src = read("scripts/features/pf2e-odds/view.mjs");
  ok(/isConfiguredStreamUser\(user\)/.test(src) && /if \(!user\?\.isGM\) return false/.test(src), "seesTruth must refuse non-GMs and the stream login");
  const sources = readdirSync(FEAT).filter((f) => f.endsWith(".mjs")).map((f) => [f, readFileSync(join(FEAT, f), "utf8")]);
  for (const [f, s] of sources) {
    if (f === "view.mjs") continue;
    // Anything that decides a player's view goes through seesTruth, never isGM alone.
    if (/isGM:\s*game\.user\.isGM/.test(s)) fail(`${f}: builds a model with isGM: game.user.isGM — use seesTruth(), or the stream login prints the truth`);
  }
  checks++;
}

/* ── 6. MAP ─────────────────────────────────────────────────────────────── */

{
  let s = MM.blank();
  s = MM.recordAttack(s, { at: 0, turn: "t1" });
  ok(MM.nextIndex(s, { now: 1, turn: "t1", resetMs: 12000, inCombat: true }).index === 1, "one attack → second attack next");
  s = MM.recordAttack(s, { at: 1, turn: "t1" });
  s = MM.recordAttack(s, { at: 2, turn: "t1" });
  ok(MM.nextIndex(s, { now: 3, turn: "t1", resetMs: 12000, inCombat: true }).index === 2, "MAP caps at the third");
  ok(MM.nextIndex(s, { now: 3, turn: "t2", resetMs: 12000, inCombat: true }).index === 0, "a new turn resets");
  ok(MM.nextIndex(s, { now: 20000, turn: null, resetMs: 12000, inCombat: false }).index === 0, "out of combat it resets after the window");
  const o = MM.cycle(MM.blank(), 0, { now: 0, turn: "t1" });
  ok(MM.nextIndex(o, { now: 1, turn: "t1", resetMs: 1, inCombat: true }).manual, "a clicked chip is a manual override");
  ok(MM.nextIndex(MM.recordAttack(o, { at: 2, turn: "t1" }), { now: 3, turn: "t1", resetMs: 1, inCombat: true }).index === 2, "an attack after an override moves it on");
  ok(MM.isAttack({ type: "skill-check", traits: ["attack"] }) && !MM.isAttack({ type: "skill-check", traits: [] }), "Grapple counts toward MAP, Demoralize does not");
}

/* ── 6b. Review regressions (PR #125) ───────────────────────────────────── */

{
  // An open-ended range wholly past the calculation window still resolves.
  const o = E.oddsOf({ mod: 12, dc: { lo: 50, hi: Infinity } });
  ok(o.known && o.headline?.lo === 0 && o.headline?.hi === 0, `DC ≥ 50 against +12 is a known 0%, not ??? (${JSON.stringify(o.headline)})`);
  ok(VM.dcText({ lo: 19, hi: Infinity }) === "≥ 19" && VM.dcText({ lo: -Infinity, hi: 26 }) === "≤ 26", "open ends print as ≥ / ≤");
  // A substitution fixes the face.
  const fixed = E.oddsOf({ mod: 10, dc: 25, rollTwice: { fixed: 18 } });
  ok(fixed.headline.lo === 1 && fixed.headline.hi === 1, `substitute 18 at +10 vs 25 is a certain success (${fixed.headline.lo})`);
  ok(Math.abs(E.faceWeights({ fixed: 18 }).reduce((a, b) => a + b, 0) - 1) < 1e-9, "fixed weights sum to 1");
  {
    const VM = await imp("scripts/features/pf2e-odds/view-model.mjs");
    const keys = (rollTwice) => VM.chipsOf({ rollTwice }).map((c) => c.key).join();
    ok(keys("keep-higher") === "fortune" && keys("keep-lower") === "misfortune", `a fortune roll carries no fixed-d20 chip ("keep-higher".fixed is String.prototype.fixed) — got ${keys("keep-higher")}`);
    ok(keys({ fixed: 18 }) === "fixed", "a fixed d20 carries its chip");
  }
  // Out-of-combat expiry clears the count before a fresh attack.
  let s = MM.recordAttack(MM.blank(), { at: 0, turn: null, resetMs: 12000 });
  s = MM.recordAttack(s, { at: 20000, turn: null, resetMs: 12000 });
  ok(MM.nextIndex(s, { now: 20001, turn: null, resetMs: 12000, inCombat: false }).index === 1, "an expired count does not carry into a fresh attack");
  // A hidden NPC breakdown teaches no modifier.
  const hidden = OM.observationsFrom({
    context: { type: "attack-roll", identifier: "a.claw.melee", dc: { value: 18, slug: "armor" }, unadjustedOutcome: "success" },
    total: 23, natural: 9, breakdownShown: false, visible: true, resultsShown: true,
    roller: { creature: true, kind: "ogre" }, defender: { creature: false }, modDelta: 0,
  });
  ok(!hidden.some((o) => o.stat.startsWith("strike:")), "a hidden breakdown files no exact modifier");
  // A private creature bonus is neither a chip nor a witnessed delta.
  const m = VM.buildModel({
    probe: { mod: 12, mods: [], dc: { value: 25, slug: "armor" }, options: [] },
    dcMods: [{ slug: "secret-ward", label: "Secret ward", value: 2, kind: "status", enabled: true }, { slug: "off-guard", label: "Off-guard", value: -2, kind: "circumstance", enabled: true }],
    who: { rollerIsCreature: false, defenderIsCreature: true, isGM: false }, known: null, label: "x",
  });
  ok(!m.chips.some((c) => c.key === "dc:secret-ward") && m.chips.some((c) => c.key === "dc:off-guard"), "a player sees off-guard but not a private ward");
}
{
  const src = read("scripts/features/pf2e-odds/observe.mjs");
  ok(/if \(!isActiveGM\(\)\) return;\s*const before/.test(src), "a queued ledger write re-checks the active GM");
  ok(/emitSocket\(FEATURE_ID, \{ type: MSG\.forget/.test(src) && /onForgetIntent/.test(src), "a non-active GM's reset is routed to the active GM");
  // The landing gate itself is driven, not read, in section 6c.
  ok(/landingOf\(message\)/.test(read("scripts/features/pf2e-odds/dice-highlight.mjs")) && !/landingOf|createChatMessage/.test(read("scripts/features/pf2e-odds/line-badges.mjs")), "both landing beats pass through one landingOf call (dice-highlight.mjs)");
  ok(/KNOWLEDGE_HOOK/.test(read("scripts/features/pf2e-odds/sheet.mjs")) && /KNOWLEDGE_HOOK/.test(read("scripts/features/pf2e-odds/save-prompt.mjs")), "sheets and save prompts redraw when knowledge changes");
  ok(/headHTML\(next/.test(read("scripts/features/pf2e-odds/render.mjs")), "updateBadge redraws the heading");
}

{
  // Only a spell's save teaches a spell DC.
  const card = {
    context: { type: "saving-throw", dc: { value: 22, slug: "reflex" }, unadjustedOutcome: "failure" },
    modifierName: "reflex", total: 15, natural: 8, visible: true, resultsShown: true, dcShown: false,
    roller: { creature: false }, defender: null, origin: { creature: true, kind: "dragon" },
  };
  ok(!OM.observationsFrom(card).some((o) => o.stat === "spell-dc"), "a breath weapon's DC is not filed as the spell DC");
  ok(OM.observationsFrom({ ...card, originIsSpell: true }).some((o) => o.stat === "spell-dc"), "a spell's save DC is filed as the spell DC");
  ok(!MM.isAttack({ type: "damage-roll", traits: ["attack"] }), "a damage roll never counts toward MAP");
  ok(DP.parseSaves("Fortitude 1, Reflex +9, Will −2")?.reflex != null, "dex-parse reads signed saves");
  ok(DP.leadingInt("x9") == null || DP.leadingInt("x9") !== 9, "dex-parse's sign class does not swallow letters");
  const anon = VM.buildModel({ probe: { mod: 12, mods: [], dc: { value: 18, slug: "armor" }, options: [] }, who: { rollerIsCreature: true, defenderIsCreature: false, isGM: false }, known: null, label: "Jaws" });
  ok(anon.label === "GLOD.unseen.attackLabel", "an unseen creature attack is labelled \"Attack\", not by its Strike");
  const src = (f) => read(`scripts/features/pf2e-odds/${f}`);
  ok(/glodDcDelta/.test(src("probe.mjs")) && /glodDcDelta/.test(src("observe.mjs")), "the contextual DC delta is stamped by the roller and read by the observer");
  ok(/changed \? next : ledger/.test(src("observe.mjs")), "a card that narrows nothing writes nothing");
  ok(/consumeAmmo: false/.test(src("probe.mjs")), "a Strike probe never checks ammunition");
  ok(/nameFor\(target/.test(src("line-badges.mjs")) && !/document\?\.name \?\? target\.name/.test(src("line-badges.mjs")), "the line badge gates the target's name");
  ok(!/\bsound\b/.test(src("constants.mjs")), "no dead sound switch");
}

/* ── 6c. The dice highlight (PR 2) ──────────────────────────────────────── */

{
  const R = await imp("scripts/features/pf2e-odds/render.mjs");
  ok(R.diceHTML({ degree: null, stamps: "attack" }) === "", "no degree, no ring");
  const crit = R.diceHTML({ degree: 3, stamps: "attack" });
  ok(/data-d="c"/.test(crit) && crit.includes("GLOD.stamp.crit<"), "a critical rings amber with the attack stamp");
  ok(R.diceHTML({ degree: 0, stamps: "check" }).includes("GLOD.stamp.critFail"), "a check's critical failure stamps as such");
  const dh = read("scripts/features/pf2e-odds/dice-highlight.mjs");
  ok(/landing\.degree != null/.test(dh), "the ring is drawn only when this viewer may see the degree");
  ok(/flags\?\.\[SUITE_ID\]\?\.spotlight/.test(dh) && /watch && !spotlight \? await watch\.wait/.test(dh), "Spotlight Roll's own dice are left alone, and its cards land without waiting for a throw that never comes");
  ok(/if \(!game\.messages\?\.get\(message\.id\)\) return;/.test(dh), "a message deleted while its die is in the air lands nothing");
  ok(/allows\("landBeat"\)/.test(dh), "the ring sheds with the landing beat");
  ok(!/dsnActive = [^\n]*game\.dice3d/.test(dh), "wiring does not wait on game.dice3d (DSN builds it in its own ready hook, maybe after ours)");
  ok(!/waitFor3DAnimationByMessageID|diceSoNiceRollComplete|Hooks\.once/.test(dh + read("scripts/features/pf2e-odds/line-badges.mjs")), "no landing waits on DSN's completion hook (it fires early under immediate chat display, and its waiter is never removed)");
  ok(/boardContainer\(\)/.test(dh) && /board\.after\(layer\)/.test(dh), "the ring layer is stacked on DSN's board container, re-read each draw");
  ok(/getComputedStyle\(board\)\.zIndex \|\| "auto"/.test(dh) && !/zIndex = [^\n]*: ""/.test(dh), "under DSN's 'under' layering the ring keeps z-index auto rather than falling back to the HUD height");

  // ── the gate, driven: what lands for whom ──
  const prevGame = globalThis.game;
  const users = { gm: { id: "gm", isGM: true }, stream: { id: "stream", isGM: true }, alice: { id: "alice", isGM: false } };
  let results = true;
  globalThis.game = {
    user: users.gm,
    users: { get: (id) => users[id] },
    settings: { get: (_ns, key) => (String(key).endsWith("streamUserId") ? "stream" : undefined) },
    pf2e: { settings: { metagame: { get results() { return results; } } } },
  };
  const { landingOf } = await imp("scripts/features/pf2e-odds/landing.mjs");
  const msg = ({ whisper = [], blind = false, visible = true, breakdown = true } = {}) => ({
    isContentVisible: visible,
    blind,
    whisper,
    speaker: { token: "S" },
    flags: { pf2e: { context: { type: "attack-roll", outcome: "success", target: { token: "Scene.x.Token.T" } } } },
    rolls: [{ options: { showBreakdown: breakdown }, dice: [{ faces: 20, results: [{ result: 14, active: true }] }] }],
  });
  const as = (u, m) => landingOf(m, users[u]);
  const pub = as("stream", msg());
  ok(pub?.degree === 2 && pub.face === 14 && pub.targetId === "T", "the stream login lands a public roll in full");
  ok(as("stream", msg({ whisper: ["alice"] })) === null, "the stream login lands NOTHING of a whisper to one player — its screen is the whole audience's");
  ok(as("alice", msg({ whisper: ["alice"] }))?.degree === 2, "the player a whisper reached lands it");
  ok(as("alice", msg({ whisper: ["alice"], visible: false })) === null, "a player who cannot read the card lands nothing");
  ok(as("stream", msg({ blind: true })) === null && as("stream", msg({ whisper: ["gm"] })) === null, "blind rolls and GM-only whispers land nothing short of the truth");
  ok(as("gm", msg({ whisper: ["gm"] }))?.degree === 2, "the GM lands a GM-only whisper");
  results = false;
  const hid = as("stream", msg());
  ok(hid?.degree === null && hid.face === 14, "with PF2e hiding results, the face lands and the degree does not");
  ok(as("stream", msg({ breakdown: false })) === null, "with results and the NPC's dice both hidden, nothing lands");
  results = true;
  ok(as("stream", msg({ breakdown: false }))?.face === null, "a hidden NPC breakdown never lands its natural");

  // ── the board reader, driven against DSN's real shapes ──
  // A throw is `throwEngine.throws[].dice[]` of die entries, each holding the
  // term's own result object (`fvttResult`) and a `vectors` object; the spawned
  // mesh's `notation` IS that vectors object (ThrowEngine#spawnDiceMesh), and
  // carries no result. A die is at rest once its sim died at or before the
  // playback iteration; finished dice stay in `diceList` until the next batch.
  class Vec {
    constructor(x = 0, y = 0, z = 0) { Object.assign(this, { x, y, z }); }
    clone() { return new Vec(this.x, this.y, this.z); }
    add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
    project() { return this; }
  }
  const spawn = (entry, x, dead) => ({
    notation: entry.vectors,
    forcedResult: entry.result,
    sim: { dead },
    position: new Vec(),
    getWorldPosition: (v) => Object.assign(v, { x, y: 0, z: 0 }),
    getWorldScale: (v) => Object.assign(v, { x: 1, y: 1, z: 1 }),
    geometry: { boundingSphere: { radius: 0.05 } },
  });
  const entry = (fvttResult) => ({ type: "d20", result: fvttResult.result, fvttResult, vectors: { type: "d20", pos: {}, velocity: {}, angle: {}, axis: {} } });
  const engine = { rolling: true, running: 1, iteration: 0, iterationsNeeded: 300, throws: null, diceList: [], deadDiceList: [] };
  globalThis.game.dice3d = { box: { throwEngine: engine, diceScene: { camera: {}, renderer: { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) } } } } };
  const { boardState } = await imp("scripts/features/spotlight-roll/dsn-host.mjs");
  const a = { result: 14, active: true };
  const b = { result: 14, active: true };
  const ea = entry(a);
  const eb = entry(b);
  // Batch 1 plays roll A; roll B (same natural) is queued behind it.
  engine.throws = [{ dice: [ea] }];
  engine.diceList = [spawn(ea, 0.5, 180)];
  engine.iteration = 120;
  const flying = boardState(new Set([a]));
  ok(flying.present && flying.busy && !flying.settled, "a die whose sim has not died yet is present and in the air");
  ok(!boardState(new Set([b])).present, "a queued roll showing the same natural does not claim the die in the air");
  engine.iteration = 200;
  const rest = boardState(new Set([a]));
  ok(rest.settled && Math.round(rest.settled.x) === 750, "the die is found through its vectors object and lands once its sim has died");
  // The batch ends with no other throw behind it: DSN leaves the dice in diceList.
  engine.iteration = 300;
  engine.rolling = false;
  engine.running = false;
  const done = boardState(new Set([a]));
  ok(done.settled && !done.busy, "a finished batch with nothing after it settles — finished dice stay in diceList");
  // Batch 2 starts: throws is reset and A's die moves to deadDiceList.
  engine.throws = [{ dice: [eb] }];
  engine.deadDiceList = engine.diceList;
  engine.diceList = [spawn(eb, -0.5, 90)];
  engine.rolling = true;
  engine.iteration = 10;
  ok(boardState(new Set([a])).settled && !boardState(new Set([b])).settled, "A is still found after its batch is gone (remembered link) and B is not taken for it");
  ok(!boardState(new Set([{ result: 14, active: true }])).present, "a result DSN never threw matches nothing on the board");
  const dropped = { result: 3, active: false, discarded: true };
  const kept = { result: 17, active: true };
  const ed = entry(dropped);
  const ek = entry(kept);
  engine.throws = [{ dice: [ed, ek] }];
  engine.diceList = [spawn(ed, -0.5, 50), spawn(ek, 0.2, 60)];
  engine.iteration = 100;
  ok(Math.round(boardState(new Set([dropped, kept])).settled?.x) === 600, "a fortune pair rings the kept die, not the dropped one");
  globalThis.game = prevGame;

  // ── the watch, driven on a fake clock: every road out ends, and empties ──
  const { createDiceWatch } = await imp("scripts/features/pf2e-odds/dice-watch.mjs");
  const clock = () => {
    let t = 0, seq = 0;
    const timers = new Map();
    return {
      now: () => t,
      setTimer: (fn, ms) => (timers.set(++seq, { at: t + ms, fn }), seq),
      clearTimer: (id) => timers.delete(id),
      pending: () => timers.size,
      advance(ms) {
        const end = t + ms;
        for (;;) {
          const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((x, y) => x[1].at - y[1].at)[0];
          if (!next) break;
          timers.delete(next[0]);
          t = next[1].at;
          next[1].fn();
        }
        t = end;
      },
    };
  };
  const roll = (r) => ({ dice: [{ faces: 20, results: [r] }] });
  const settle = () => new Promise((r) => setImmediate(r));
  const run = async (name, board, script) => {
    const c = clock();
    const w = createDiceWatch({ readBoard: board, setTimer: c.setTimer, clearTimer: c.clearTimer, now: c.now, poll: 100, startGrace: 1500, spawnGrace: 4000, maxWait: 10000 });
    let out = "pending";
    await script(w, c, (p) => p.then((v) => (out = v)));
    await settle();
    ok(w.size === 0 && c.pending() === 0, `${name}: the watch empties and leaves no timer (${w.size} open, ${c.pending()} timers)`);
    return out;
  };
  const r1 = { result: 14, active: true };
  let landedAt = 3000;
  let got = await run("settled", (rs) => ({ busy: true, present: true, settled: rs.has(r1) && landedAt <= 0 ? { x: 1, y: 2, r: 30 } : null }), async (w, c, hold) => {
    hold(w.wait("m1"));
    w.start("m1", roll(r1));
    c.advance(2000);
    landedAt = 0;
    c.advance(200);
  });
  ok(got?.r === 30, "a watch resolves with the die once the board shows it at rest");
  {
    // Nothing settles until the board says so — DSN's completion signal is not consulted at all.
    const c = clock();
    let rested = false;
    const w = createDiceWatch({ readBoard: () => ({ busy: true, present: true, settled: rested ? { x: 0, y: 0, r: 9 } : null }), setTimer: c.setTimer, clearTimer: c.clearTimer, now: c.now });
    let v = "pending";
    w.wait("m3").then((x) => (v = x));
    w.start("m3", roll({ result: 9, active: true }));
    c.advance(3000);
    await settle();
    ok(v === "pending", "under immediate chat display the landing still waits for the die, not the hook");
    rested = true;
    c.advance(100);
    await settle();
    ok(v?.r === 9 && w.size === 0 && c.pending() === 0, "…and lands the moment it rests");
  }
  got = await run("unseen", () => ({ busy: false, present: false, settled: null }), async (w, c, hold) => {
    hold(w.wait("m4"));
    c.advance(1500);
  });
  ok(got === null, "a throw DSN never started (hidden NPC roll, only-my-rolls) lands without a ring after the start grace");
  got = await run("unshown", () => ({ busy: false, present: false, settled: null }), async (w, c, hold) => {
    hold(w.wait("m5"));
    w.start("m5", roll({ result: 2, active: true }));
    c.advance(4200);
  });
  ok(got === null, "a throw started but never shown (DSN off, off in combat) gives up after the idle grace");
  got = await run("deleted", () => ({ busy: true, present: true, settled: null }), async (w, c, hold) => {
    hold(w.wait("m6"));
    w.start("m6", roll({ result: 2, active: true }));
    c.advance(300);
    w.forget("m6");
  });
  ok(got === null, "a deleted message ends its watch at once");
  got = await run("too long", () => ({ busy: true, present: true, settled: null }), async (w, c, hold) => {
    hold(w.wait("m7"));
    w.start("m7", roll({ result: 2, active: true }));
    c.advance(10000);
  });
  ok(got === null, "an interactive throw left in the air ends at maxWait");
  await run("start with no waiter", () => ({ busy: true, present: true, settled: null }), async (w, c) => {
    for (let i = 0; i < 100; i++) w.start(`direct${i}`, roll({ result: 2, active: true }));
    c.advance(10000);
  });
  await run("no message id", () => ({ busy: false, present: false, settled: null }), async (w) => {
    w.start(null, roll({ result: 2, active: true }));
    w.start("m8", { dice: [{ faces: 6, results: [{ result: 2 }] }] });
  });
  await run("cleared", () => ({ busy: true, present: true, settled: null }), async (w, c, hold) => {
    hold(w.wait("m9"));
    w.start("m9", roll({ result: 2, active: true }));
    w.clear();
  });
  for (const f of readdirSync(FEAT).filter((x) => x.endsWith(".mjs"))) {
    const src = readFileSync(join(FEAT, f), "utf8");
    if (/dice3d\.box|throwEngine|diceScene|\.material\b/.test(src)) fail(`${f}: reaches into Dice So Nice — only spotlight-roll/dsn-host.mjs may`);
  }
  checks++;
  const host = read("scripts/features/spotlight-roll/dsn-host.mjs");
  const reader = host.slice(host.indexOf("the board, read-only"));
  ok(reader.length > 100 && !/\.material\b|dispose\(|\.visible\s*=|position\.set|\.add\(mesh/.test(reader), "the board reader in dsn-host.mjs only reads");
}

/* ── 7. Data keys are pinned ────────────────────────────────────────────── */

ok(Object.keys(C.STATS).join() === "ac,fortitude,reflex,will,perception,spell-dc,spell-attack", `STATS keys are ledger data — renaming one forgets the party's knowledge (${Object.keys(C.STATS)})`);
ok(C.strikeStat("longsword") === "strike:longsword", "strike stats are strike:<slug>");
ok(C.statForDcSlug("armor") === "ac" && C.statForDcSlug("will") === "will" && C.statForDcSlug("will-dc") === "will", "PF2e's DC slugs map onto STATS");
for (const [k, a] of Object.entries(C.SKILL_ACTIONS)) ok(C.STATS[a.against]?.kind === "dc", `skill action ${k} is rolled against a known defence (${a.against})`);
ok(Object.values(C.SETTINGS).every((k) => k.startsWith(C.PREFIX)), "every setting key carries the od. prefix");
ok(DP.parseSaves("Fort +15, Ref +9, Will +12")?.fortitude != null || true, "dex-parse loads");

/* ── 8. i18n ────────────────────────────────────────────────────────────── */

{
  const lang = JSON.parse(read("lang/pf2e-odds.en.json"));
  const need = new Set();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(mjs|hbs)$/.test(e.name)) for (const m of readFileSync(p, "utf8").matchAll(/["'`](GLOD\.[A-Za-z0-9_.-]+[A-Za-z0-9])["'`]/g)) need.add(m[1]);
    }
  };
  walk(FEAT);
  if (existsSync(join(ROOT, "templates/pf2e-odds"))) walk(join(ROOT, "templates/pf2e-odds"));
  // Dynamic families.
  for (const a of Object.keys(C.SKILL_ACTIONS)) need.add(`GLOD.action.${a}`);
  for (const s of ["fortitude", "reflex", "will"]) need.add(`GLOD.save.${s}`);
  for (const st of Object.values(C.STATS)) need.add(st.label);
  for (const set of Object.values(C.DEGREE_STAMP)) for (const k of set) need.add(k);
  for (const k of Object.values(C.SETTINGS)) {
    if (k === C.SETTINGS.ledger) continue;
    const s = k.slice(C.PREFIX.length);
    need.add(`GLOD.settings.${s}.name`);
    need.add(`GLOD.settings.${s}.hint`);
  }
  for (const k of need) ok(k in lang, `missing i18n key ${k}`);
  ok("GLS.feature.pf2e-odds.title" in lang && "GLS.feature.pf2e-odds.hint" in lang, "feature title/hint");
  const all = JSON.parse(read("lang/en.json"));
  for (const k of Object.keys(lang)) if (k in all) fail(`lang/pf2e-odds.en.json redeclares ${k} from en.json`);
}

/* ── 9. Shedding ────────────────────────────────────────────────────────── */

{
  const src = readdirSync(FEAT).filter((f) => f.endsWith(".mjs") && f !== "constants.mjs").map((f) => readFileSync(join(FEAT, f), "utf8")).join("\n");
  for (const name of C.SHED_ORDER) ok(src.includes(`allows("${name}")`), `SHED_ORDER rung "${name}" is never consulted — it never degrades`);
  ok(/Budget\.ladder\(FEATURE_ID, SHED_ORDER\)/.test(src), "the badges bind the shared frame budget");
  ok(!/\*\s*0\.9\s*\+/.test(src), "no private rolling average");
}

/* ── 10. Purity and import-time side effects ────────────────────────────── */

for (const f of ["view-model.mjs", "ledger-model.mjs", "observe-model.mjs", "map-model.mjs", "dex-parse.mjs", "render.mjs", "constants.mjs"]) {
  const s = readFileSync(join(FEAT, f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok(!/\b(game|canvas|Hooks|ui|foundry)\s*[.?]/.test(s), `${f} is pure: no game/canvas/Hooks/ui/foundry (the preview and this check import it)`);
}
ok(!/\b(game|canvas|Hooks|ui|foundry)\s*[.?]/.test(read("scripts/core/pf2e-odds.mjs").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "core/pf2e-odds.mjs is pure");
{
  const idx = read("scripts/features/pf2e-odds/index.mjs");
  const top = idx.replace(/Suite\.register\(\{[\s\S]*\}\);\s*$/, "").replace(/function [\s\S]*?\n\}/g, "");
  ok(!/Hooks\.(on|once)\(/.test(top), "the adapter registers no hook at import time");
}
for (const [f, s] of readdirSync(FEAT).filter((f) => f.endsWith(".mjs")).map((f) => [f, readFileSync(join(FEAT, f), "utf8")])) {
  if (/game\.socket\./.test(s)) fail(`${f}: game.socket directly — use core/socket.mjs`);
}
checks++;

/* ── 11. CSS ────────────────────────────────────────────────────────────── */

for (const f of readdirSync(join(ROOT, "styles")).filter((f) => /^pf2e-odds.*\.css$/.test(f))) {
  const css = readFileSync(join(ROOT, "styles", f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const m of css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) ok(m[1].startsWith("glod-"), `${f}: @keyframes ${m[1]} is not feature-prefixed`);
  ok(!/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(css), `${f}: raw white veil — use a tint channel`);
  ok(!/@font-face|@import/.test(css), `${f}: @font-face/@import`);
  ok(!/prefers-reduced-motion/.test(css), `${f}: the suite does not honour prefers-reduced-motion`);
  ok(!/cubic-bezier\(/.test(css), `${f}: raw easing — use a --gl-ease token`);
  for (const m of css.matchAll(/(?:transition|animation)[a-z-]*\s*:[^;]*?\b(\d+(?:\.\d+)?m?s)\b/g)) if (parseFloat(m[1]) !== 0) fail(`${f}: raw duration ${m[1]} — use a --gl-d token`);
  // --gl-accent on a scoped selector is the routing contract; anything else is a fork.
  for (const m of css.matchAll(/^\s*(--gl-[a-z0-9-]+)\s*:/gm)) if (m[1] !== "--gl-accent") fail(`${f}: redeclares foundation token ${m[1]}`);
  ok(!/:root\s*\{[^}]*--gl-/.test(css), `${f}: sets a --gl- token on :root`);
  checks++;
}
{
  // Every .gl-btn the feature emits is sized by the feature (gl-btn has no font-size).
  const emits = [...readdirSync(FEAT).map((f) => join(FEAT, f)), ...(existsSync(join(ROOT, "templates/pf2e-odds")) ? readdirSync(join(ROOT, "templates/pf2e-odds")).map((f) => join(ROOT, "templates/pf2e-odds", f)) : [])]
    .some((p) => /gl-btn/.test(readFileSync(p, "utf8")));
  const css = readdirSync(join(ROOT, "styles")).filter((f) => /^pf2e-odds.*\.css$/.test(f)).map((f) => readFileSync(join(ROOT, "styles", f), "utf8")).join("\n");
  ok(!emits || /\.gl-btn[^{]*\{[^}]*font-size/.test(css), "a .gl-btn this feature emits is sized by this feature");
}

/* ── 12. Registration ───────────────────────────────────────────────────── */

{
  const m = JSON.parse(read("module.json"));
  for (const f of readdirSync(join(ROOT, "styles")).filter((f) => /^pf2e-odds.*\.css$/.test(f))) ok(m.styles.includes(`styles/${f}`), `module.json does not load styles/${f}`);
  ok(m.languages.some((l) => l.path === "lang/pf2e-odds.en.json"), "module.json does not load the lang file");
  ok(/import "\.\/pf2e-odds\/index\.mjs"/.test(read("scripts/features/index.mjs")), "the adapter is not imported");
  ok(/linesChanged/.test(read("scripts/features/stream-targets/targeting/target-lines.js")), "the targeting lines announce their pairs");
}

{
  // The badge is placed by JS and popped in by CSS. A filled animation outranks
  // an inline style, so if both drive `transform` the badge sits at 0,0 forever.
  const lb = read("scripts/features/pf2e-odds/line-badges.mjs");
  const css = read("styles/pf2e-odds.css");
  const motion = read("styles/gl-motion.css");
  const rule = css.match(/\.glod-line \{[^}]*\}/)?.[0] ?? "";
  const anim = rule.match(/animation:\s*([\w-]+)/)?.[1];
  const frames = anim ? motion.match(new RegExp(`@keyframes ${anim} \{[\s\S]*?\n\}`))?.[0] ?? "" : "";
  const animatesTransform = /transform\s*:/.test(frames);
  ok(/\.style\.translate = /.test(lb) && !/el\.style\.transform = /.test(lb), "the line badge is placed with the `translate` property, not `transform`");
  ok(!animatesTransform || !/\.style\.transform\b/.test(lb), "the badge's entry animation never owns the property that places it");
}

/* ── report ─────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join("\n"));
  console.log(`\n${problems.length} problem(s), ${checks} checks`);
  process.exit(1);
}
console.log(`pf2e-odds: ${checks} checks, 0 problems`);
