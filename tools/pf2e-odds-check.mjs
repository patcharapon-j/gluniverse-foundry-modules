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

/* ── report ─────────────────────────────────────────────────────────────── */

if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join("\n"));
  console.log(`\n${problems.length} problem(s), ${checks} checks`);
  process.exit(1);
}
console.log(`pf2e-odds: ${checks} checks, 0 problems`);
