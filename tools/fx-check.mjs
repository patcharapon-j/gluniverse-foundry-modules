#!/usr/bin/env node
/**
 * Spellsprite (pf2e-fx) consistency check. Everything it covers fails silently:
 * an effect that throws plays nothing, a family left as a placeholder draws
 * another family's look, a loop that leaks particles slows the table down over
 * an evening, an unregistered i18n key prints itself in the GM's settings.
 *
 *   node tools/fx-check.mjs            zero problems required
 *   node tools/fx-check.mjs --verbose  also prints the cost table
 */

import { readFile, readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import {
  FAMILIES, FUNCTIONS, MATERIALS, OUTCOMES, SETTINGS, SHED_ORDER, TIMING, WEAPON_STYLES,
  DELIVERY_GROUPS, DELIVERY_VOCAB, MOTIF_VOCAB, FLAVOR_VOCAB, PROP_VOCAB,
} from "../scripts/features/pf2e-fx/constants.mjs";
import { STRIKES } from "../scripts/features/pf2e-fx/strikes.mjs";
import { RANGED } from "../scripts/features/pf2e-fx/ranged.mjs";
import { HARM } from "../scripts/features/pf2e-fx/deliveries.mjs";
import { MOTIFS } from "../scripts/features/pf2e-fx/motif-art.mjs";
import { FLAVORS } from "../scripts/features/pf2e-fx/flavors.mjs";
import { compile } from "../scripts/features/pf2e-fx/compile.mjs";
import { FAMILY_MODULES } from "../scripts/features/pf2e-fx/families/index.mjs";
import { FORMS } from "../scripts/features/pf2e-fx/forms.mjs";
import { ARCH, ARCH_VOCAB } from "../scripts/features/pf2e-fx/archetypes/rules.mjs";
import { ARCH_DRAW, missingArch } from "../scripts/features/pf2e-fx/archetypes/index.mjs";
import { CONDITIONS } from "../scripts/features/pf2e-fx/conditions.mjs";
import { applyLook, mergeLooks, normalizeLook } from "../scripts/features/pf2e-fx/looks.mjs";
import { Director } from "../scripts/features/pf2e-fx/director.mjs";
import { Riders } from "../scripts/features/pf2e-fx/handoff.mjs";
import { Layers } from "../scripts/features/pf2e-fx/core/pix.mjs";
import { paintFrame, sideView, topView } from "../scripts/features/pf2e-fx/core/frame.mjs";

const ROOT = new URL("../", import.meta.url);
const FX = "scripts/features/pf2e-fx/";
const verbose = process.argv.includes("--verbose");
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };
const text = (p) => readFile(new URL(p, ROOT), "utf8");
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

/* PF2e 8.5 conditions (packs/conditions). Every slug needs an entry: an overlay
   or an explicit `{ none: true }`, so "deliberately nothing" is told apart from
   "forgotten". */
const PF2E_CONDITIONS = [
  "blinded", "broken", "clumsy", "concealed", "confused", "controlled", "dazzled", "deafened", "doomed",
  "drained", "dying", "encumbered", "enfeebled", "fascinated", "fatigued", "fleeing", "friendly",
  "frightened", "grabbed", "helpful", "hidden", "hostile", "immobilized", "indifferent", "invisible",
  "malevolence", "observed", "off-guard", "paralyzed", "persistent-damage", "petrified", "prone",
  "quickened", "restrained", "sickened", "slowed", "stunned", "stupefied", "unconscious", "undetected",
  "unfriendly", "unnoticed", "wounded",
];

/* ── 1. purity ─────────────────────────────────────────────────────────── */

const IMPURE = new Set(["main.mjs", "index.mjs", "host-2d.mjs", "read.mjs", "looks-app.mjs"]);
async function walk(dir) {
  const out = [];
  for (const e of await readdir(new URL(dir, ROOT), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...await walk(`${dir}${e.name}/`));
    else if (e.name.endsWith(".mjs")) out.push(`${dir}${e.name}`);
  }
  return out;
}
const files = await walk(FX);
for (const f of files) {
  const name = f.slice(FX.length);
  if (IMPURE.has(name)) continue;
  const src = stripComments(await text(f));
  const hit = src.match(/(?<![.\w$])(game|canvas|foundry|ui|Hooks|PIXI)\s*[.?[]/);
  ok(!hit, `${name} is meant to be pure but reaches \`${hit?.[0]}\``);
  ok(!/Math\.random\s*\(/.test(src), `${name} uses Math.random (sims must be seeded)`);
}

/* ── 2. vocabulary ─────────────────────────────────────────────────────── */

const famOfMat = Object.values(FAMILIES).flat();
ok(MATERIALS.every((m) => famOfMat.includes(m)), "a material belongs to no family");
for (const fam of Object.keys(FAMILIES)) {
  const mod = FAMILY_MODULES[fam];
  ok(mod, `family ${fam} has no module`);
  ok(!mod?.placeholder, `family ${fam} is still a placeholder (draws physical's look)`);
  for (const fn of ["burst", "linger", "aura"]) ok(typeof mod?.[fn] === "function", `family ${fam} has no ${fn}()`);
}
for (const f of FUNCTIONS) if (f !== "harm" && f !== "hazard") ok(typeof FORMS[f] === "function", `function ${f} has no form`);
// an archetype id semantics can pick with no drawer plays nothing at all
for (const a of missingArch()) problems.push(`archetype ${a} has no drawer (archetypes/index.mjs)`);
for (const a of ARCH_VOCAB) ok(!ARCH[a].func || FUNCTIONS.includes(ARCH[a].func), `archetype ${a} rescues to an unknown function ${ARCH[a].func}`);
// every archetype has its own art: one left generic plays its function's old form for thousands of documents
for (const a of ARCH_VOCAB) ok(!ARCH_DRAW[a]?.placeholder, `archetype ${a} is still a placeholder (plays its function's generic form)`);
for (const slug of PF2E_CONDITIONS) ok(CONDITIONS[slug], `condition ${slug} has no entry (an overlay or { none: true })`);

/* ── 3. every effect compiles, steps and paints ────────────────────────── */

const caster = { id: "c", x: 2, y: 4, size: 1, h: 1.3 };
const target = (o, i = 0) => ({ id: `t${i}`, x: 6 + i * 0.8, y: 4 + (i % 2) * 0.9, size: 1, h: 1.3, outcome: o });
const base = (material, o, extra) => ({
  id: "chk", seed: 1234, rank: 5, tradition: "arcane", func: "harm", material, accent: null,
  outcome: o, caster, targets: [target(o), target(o, 1)], look: null, ...extra,
});
const DELIVERIES = (material, o) => [
  ["attack", base(material, o, { kind: "attack" })],
  ["save", base(material, o, { kind: "save" })],
  ["burst", base(material, o, { kind: "area", area: { shape: "burst", x: 6.4, y: 4.4, r: 2 } })],
  ["cone", base(material, o, { kind: "area", area: { shape: "cone", x: 2, y: 4, r: 3, len: 3, dir: 0 } })],
  ["line", base(material, o, { kind: "area", area: { shape: "line", x: 2, y: 4, len: 6, width: 1, dir: 0 } })],
  ["emanation", base(material, o, { kind: "area", area: { shape: "emanation", x: 2, y: 4, r: 2 } })],
  ["self", base(material, o, { kind: "self", targets: [] })],
  ["tick", base(material, o, { kind: "tick", targets: [target(o)] })],
];

const L = new Layers(512, 320);
const top = topView({ ox: 0, oy: 40, aps: 26 });
const side = sideView({ cx: 4, cy: 4, rx: 1, ry: 0, ax: 140, ay: 260, aps: 26 });
{
  /* The side view must not mirror the floor: with the camera's right along +x
     it looks north, so a square further north is further away and sits
     higher on the billboard. */
  const near = side.ap(4, 5, 0)[1], far = side.ap(4, 3, 0)[1];
  if (!(far < near)) problems.push("sideView: a square further from the camera does not draw higher (forward vector mirrored)");
}
let worst = { ms: 0, what: "" }, worstParts = { n: 0, what: "" };
const cost = [];

function run(what, spec, seconds = 4, paint = true) {
  let s;
  try { s = compile(spec); } catch (e) { problems.push(`${what}: compile threw ${e.message}`); return null; }
  let paintMs = 0, frames = 0;
  try {
    for (let t = 0; t < seconds; t += TIMING.step) {
      s.step(TIMING.step);
      if (s.parts.length > worstParts.n) worstParts = { n: s.parts.length, what };
      if (paint && Math.round(t / TIMING.step) % 12 === 0) {
        const t0 = performance.now();
        paintFrame([s], top, L, { bright: false });
        paintFrame([s], side, L, { bright: true });
        const ms = (performance.now() - t0) / 2;
        paintMs += ms; frames++;
        if (ms > worst.ms) worst = { ms, what };
      }
    }
  } catch (e) { problems.push(`${what}: stepping or painting threw ${e.stack?.split("\n").slice(0, 2).join(" ")}`); return null; }
  if (frames) cost.push([what, paintMs / frames]);
  return s;
}

for (const m of MATERIALS) {
  for (const o of OUTCOMES) for (const [d, spec] of DELIVERIES(m, o)) {
    const s = run(`${m}/${d}/${o}`, spec, 4, o === "hit");
    if (s && d !== "self") ok(s.parts.length || s.done || s.t > 0, `${m}/${d}/${o} drew nothing`);
  }
  for (const f of FUNCTIONS) if (f !== "harm") run(`${m}/form:${f}`, base(m, "hit", { kind: "auto", func: f }), 4, false);
}
for (const style of WEAPON_STYLES) for (const o of OUTCOMES) {
  run(`strike:${style}/${o}`, base("kinetic", o, { kind: "strike", weapon: { style, ranged: style === "ranged" || style === "thrown" }, targets: [target(o)] }));
  run(`strike:${style}+fire/${o}`, base("fire", o, { kind: "strike", accent: "fire", weapon: { style }, targets: [target(o)] }), 3, false);
}

/* The look axes (docs/SPELLSPRITE_LOOK.md). Every delivery needs a renderer in
   the table its group names, or it plays a fallback that ignores what the
   action is; every motif and every flavor needs an entry, or the name and the
   class are read and then thrown away. `--only=melee,natural` limits the
   missing-renderer check to some groups (a branch that owns only those). */
{
  const only = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
  const want = (g) => !only.length || only.includes(g);
  const TABLE = { melee: STRIKES, natural: STRIKES, ranged: RANGED, harm: HARM };
  for (const [g, list] of Object.entries(DELIVERY_GROUPS)) {
    if (g === "other") continue;
    for (const d of list) {
      if (!DELIVERY_VOCAB.includes(d)) problems.push(`delivery ${d} (group ${g}) is not in DELIVERY_VOCAB`);
      if (want(g) && typeof TABLE[g][d] !== "function") problems.push(`delivery ${d}: no renderer in ${g === "harm" ? "deliveries.mjs HARM" : g === "ranged" ? "ranged.mjs RANGED" : "strikes.mjs STRIKES"}`);
    }
  }
  for (const d of DELIVERY_VOCAB) if (!Object.values(DELIVERY_GROUPS).some((l) => l.includes(d))) problems.push(`delivery ${d} has no group in DELIVERY_GROUPS`);
  if (want("motif")) for (const m of MOTIF_VOCAB) {
    const e = MOTIFS[m];
    if (!e || !["carrier", "impact", "conjure", "residue"].some((h) => typeof e[h] === "function")) problems.push(`motif ${m}: no hook in motif-art.mjs MOTIFS`);
  }
  if (want("flavor")) for (const f of FLAVOR_VOCAB) if (typeof FLAVORS[f] !== "function") problems.push(`flavor ${f}: no wind-up in flavors.mjs FLAVORS`);

  const harmSpec = (d, o, m = "fire") => {
    const area = ["lob", "burst", "fall"].includes(d) ? { shape: "burst", x: 6.4, y: 4.4, r: 2 }
      : ["cone", "breath"].includes(d) ? { shape: "cone", x: 2, y: 4, r: 3, len: 3, dir: 0 }
      : ["line", "wall"].includes(d) ? { shape: "line", x: 2, y: 4, len: 6, width: 1, dir: 0 }
      : ["emanation", "aura"].includes(d) ? { shape: "emanation", x: 2, y: 4, r: 2 } : null;
    return base(m, o, { kind: area ? "area" : d === "ray" || d === "touch" ? "attack" : "save", delivery: d, area });
  };
  for (const o of OUTCOMES) {
    for (const g of ["melee", "natural", "ranged"]) for (const d of DELIVERY_GROUPS[g]) {
      run(`strike:${d}/${o}`, base("kinetic", o, { kind: "strike", delivery: d, weapon: { style: g === "ranged" ? "ranged" : "slash", ranged: g === "ranged" }, targets: [target(o)] }), 3, o === "hit");
    }
    for (const d of DELIVERY_GROUPS.harm) run(`harm:${d}/${o}`, harmSpec(d, o), 4, o === "hit");
  }
  for (const m of MOTIF_VOCAB) {
    run(`motif:${m}/harm`, { ...harmSpec("orb", "hit", "arcane"), motif: m }, 3, false);
    run(`motif:${m}/form`, base("arcane", "hit", { kind: "auto", func: "support", motif: m }), 3, false);
  }
  for (const f of FLAVOR_VOCAB) {
    run(`flavor:${f}/harm`, { ...harmSpec("ray", "hit"), flavor: f }, 3, false);
    run(`flavor:${f}/strike`, base("kinetic", "hit", { kind: "strike", delivery: "swing", flavor: f, weapon: { style: "slash" }, targets: [target("hit")] }), 3, false);
  }
  // every archetype, on one target and as a self effect, both outcomes that look different
  for (const a of ARCH_VOCAB) for (const o of ["hit", "crit"]) {
    const func = ARCH[a].func ?? "restore";
    run(`arch:${a}/${o}`, base("arcane", o, { kind: "attack", func, arch: a, targets: [target(o)] }), 4, o === "hit");
    run(`arch:${a}/self`, base("fire", o, { kind: "self", func, arch: a, targets: [] }), 3, false);
  }
  for (const p of PROP_VOCAB) run(`prop:${p}`, base("kinetic", "crit", { kind: "strike", delivery: "bullet", props: [p], weapon: { style: "ranged", ranged: true }, targets: [target("crit")] }), 3, false);
}

/* Something drew: a fireball burst must put pixels in both layers. */
{
  const s = compile(base("fire", "hit", { kind: "area", area: { shape: "burst", x: 6.4, y: 4.4, r: 2 } }));
  let stand = 0, flat = 0;
  for (let t = 0; t < 1.6; t += TIMING.step) {
    s.step(TIMING.step);
    paintFrame([s], top, L, { bright: false });
    stand = Math.max(stand, L.stand.box.empty ? 0 : 1); flat = Math.max(flat, L.flat.box.empty ? 0 : 1);
  }
  ok(stand && flat, "a fire burst painted nothing in the stand or flat layer");
}

/* Strike riders (catalogue §1.1) are a hand-off, never a beat on the Strike.
   Grab, Knockdown and Push are PF2e follow-ups (the creature's action or an
   Athletics check) that Spellsprite already plays with their real outcome, so a
   Strike that drew the maneuver too would grab twice when it is followed up and
   announce a grab that never happened when it is not. The follow-up takes the
   Strike's body part instead: a tongue grab closes as coils. */
{
  const riderSpec = (arch, o) => base("kinetic", o, { kind: "strike", delivery: "jaws", weapon: { style: "bite" }, rider: { arch, slug: arch }, targets: [target(o)] });
  const hitsOf = (spec) => {
    const sim = compile(spec), times = [];
    const hit = sim.hit.bind(sim);
    sim.hit = (id, ...rest) => { times.push(sim.t); return hit(id, ...rest); };
    for (let t = 0; t < 4; t += TIMING.step) sim.step(TIMING.step);
    return { sim, n: times.length };
  };
  for (const arch of ["grab", "trip", "shove", "rend"]) for (const o of OUTCOMES) {
    const s = run(`rider:${arch}/${o}`, riderSpec(arch, o), 4, o === "hit");
    if (!s) continue;
    ok(!s.phases.some((p) => /^rider|^arch:/.test(p)), `rider ${arch}/${o}: the Strike drew a maneuver beat (${s.phases.filter((p) => /^rider|^arch:/.test(p)).join(", ")}); PF2e's follow-up plays it`);
    const withRider = hitsOf(riderSpec(arch, o)).n, plain = hitsOf({ ...riderSpec(arch, o), rider: null }).n;
    ok(withRider === plain, `rider ${arch}/${o}: a rider changed the Strike's blows (${withRider} vs ${plain}); it must play only its hit`);
  }
  // the follow-up takes the body part: a grab after a tongue Strike closes as coils, after jaws as a hand
  const follow = (limb) => run(`handoff:grab/${limb?.delivery ?? "none"}`, base("kinetic", "hit", { kind: "attack", func: "control", arch: "grab", slug: "grapple", limb, targets: [target("hit")] }), 4, true);
  const tongue = follow({ delivery: "lash", motif: null, slug: "tongue", rider: "tongue-grab", style: "unarmed" });
  const jaws = follow({ delivery: "jaws", motif: null, slug: "jaws", rider: "grab", style: "bite" });
  const bare = follow(null);
  ok(tongue?.phases.includes("limb: lash") && tongue.phases.some((p) => /coils close/.test(p)), `a Grapple after a tongue Strike must draw coils and record its limb (${tongue?.phases.join(", ")})`);
  ok(jaws?.phases.includes("limb: jaws") && jaws.phases.some((p) => /a hand closes/.test(p)), `a Grapple after a jaws Strike must keep the hand and record its limb (${jaws?.phases.join(", ")})`);
  ok(bare && !bare.phases.some((p) => p.startsWith("limb:")) && bare.phases.some((p) => /a hand closes/.test(p)), "a Grapple with no Strike before it must draw exactly as it always did");
  // the memory (handoff.mjs): keyed by token, one Strike one follow-up, inside the window, bounded, cleared
  const R = new Riders({ window: TIMING.handoff, limit: 4 });
  const L = { delivery: "jaws", slug: "jaws" };
  R.note("t1", { rider: { arch: "grab" }, limb: L, outcome: "hit", target: "v", at: 100 });
  ok(R.take("t1", "trip", { at: 101 }) === null, "handoff: a Trip took a Grab Strike's body part (a different archetype)");
  ok(R.take("t2", "grab", { at: 101 }) === null, "handoff: another token took the body part (the memory is keyed by token id)");
  ok(R.take("t1", "grab", { at: 101, targets: ["w"] }) === null, "handoff: a Grapple on somebody else took the body part");
  ok(R.take("t1", "grab", { at: 100 + TIMING.handoff - 0.5, targets: ["v"] }) === L, "handoff: a Grapple inside the window did not take the body part");
  ok(R.take("t1", "grab", { at: 102 }) === null, "handoff: one Strike's body part was taken twice");
  R.note("t1", { rider: { arch: "grab" }, limb: L, outcome: "hit", at: 100 });
  ok(R.take("t1", "grab", { at: 100 + TIMING.handoff + 0.5 }) === null && R.size === 0, "handoff: a Grapple past the window took the body part (or the stale entry stayed)");
  for (const o of ["miss", "neutral"]) { R.note("t1", { rider: { arch: "grab" }, limb: L, outcome: o, at: 100 }); ok(R.take("t1", "grab", { at: 101 }) === null, `handoff: a Strike the viewer saw as ${o} handed its body part on`); }
  R.note("t1", { rider: { arch: "grab" }, limb: L, outcome: "hit", at: 100 });
  R.note("t1", { rider: null, limb: L, outcome: "hit", at: 101 });
  ok(R.take("t1", "grab", { at: 102 }) === null, "handoff: a later Strike with no rider must replace the earlier one (only the last Strike is followed up)");
  for (let i = 0; i < 10; i++) R.note(`k${i}`, { rider: { arch: "trip" }, limb: L, outcome: "hit", at: 100 });
  ok(R.size === 4 && R.take("k9", "trip", { at: 101 }) === L && R.take("k0", "trip", { at: 101 }) === null, `handoff: the memory holds ${R.size} entries over its limit of 4, or dropped the newest`);
  R.clear();
  ok(R.size === 0, "handoff: clear() left entries behind");
  const riderMs = cost.filter(([w]) => w.startsWith("rider:") || w.startsWith("handoff:")).reduce((m, [, ms]) => Math.max(m, ms), 0);
  ok(riderMs < 6, `a rider Strike or its follow-up paints ${riderMs.toFixed(2)} ms a frame on average, over the 6 ms budget`);
  if (verbose) console.log(`rider: ${riderMs.toFixed(2)} ms a frame (worst rider Strike or follow-up average)`);
  // the wiring: semantics marks the rider, the reader remembers it per token and hands it to the follow-up
  const reader = stripComments(await text(`${FX}read.mjs`)), compiler = stripComments(await text(`${FX}compile.mjs`)), body = stripComments(await text(`${FX}archetypes/body.mjs`));
  ok(/rider: desc\.rider \?\? null/.test(reader), "read.mjs finish() must copy the Strike's rider onto the spec (desc.rider)");
  ok(!/strikeRider|ARCH_DRAW\[[^\]]*rider/.test(compiler), "compile.mjs must not draw a Strike's rider: PF2e's follow-up plays it (handoff.mjs)");
  ok(/riders\.note\(casterToken\.id/.test(reader) && /riders\.take\(follow\.token/.test(reader), "read.mjs must note each Strike per attacker token (riders.note) and hand it to the follow-up (riders.take)");
  ok(/new Riders\(\{ window: TIMING\.handoff/.test(reader) && /riders\.clear\(\)/.test(reader), "read.mjs must bound the memory by TIMING.handoff and clear it on unwire");
  ok(!/actor\??\.id/.test(reader.slice(reader.indexOf("riders.note"), reader.indexOf("riders.note") + 200)), "read.mjs must key the rider memory by token id, never actor id");
  ok(/sp\.limb|spec\.limb/.test(body), "archetypes/body.mjs must read spec.limb (the follow-up draws in the Strike's style)");
  // size: a Huge creature's bite is a huge bite (catalogue §4 row 9)
  const fangs = (size) => {
    const s = compile(base("kinetic", "hit", { kind: "strike", delivery: "jaws", weapon: { style: "bite" }, caster: { ...caster, x: 6 - (size + 1) / 2 - 0.1, size, h: 1.3 * size }, targets: [target("hit")] }));
    for (let t = 0; t < 1; t += TIMING.step) { s.step(TIMING.step); const p = s.parts.find((q) => q.k === "mlFangs"); if (p) return p.sc; }
    return 0;
  };
  const med = fangs(1), huge = fangs(3);
  ok(med > 0 && huge > med * 1.6, `a Huge creature's bite is drawn ${(huge / (med || 1)).toFixed(2)}× a Medium one's (want about √3: Strikes scale with the attacker's size)`);
}

/* ── 4. determinism ────────────────────────────────────────────────────── */

const r5 = (n) => (Number.isFinite(n) ? +n.toFixed(5) : null);
const snapshot = (s) => JSON.stringify(s.parts.map((p) => [p.k, r5(p.x), r5(p.y), r5(p.z), r5(p.age)]));
for (const m of ["fire", "cold", "electricity", "earth", "water", "plant", "mental", "holy"]) {
  const spec = base(m, "crit", { kind: "area", area: { shape: "burst", x: 6.4, y: 4.4, r: 2 } });
  const a = compile(spec), b = compile(spec);
  for (let i = 0; i < 180; i++) { a.step(TIMING.step); b.step(TIMING.step); }
  ok(snapshot(a) === snapshot(b), `${m}: the same spec and seed drew differently twice (not deterministic)`);
}

/* ── 5. condition loops stay bounded and stop ──────────────────────────── */

for (const slug of Object.keys(CONDITIONS)) {
  if (CONDITIONS[slug]?.none) continue;
  const mat = CONDITIONS[slug].material ?? (slug === "persistent-damage" ? "fire" : "neutral");
  const s = compile(base(mat, "hit", { kind: "condition", condition: { slug, value: 2 }, targets: [target("hit")], caster: null }));
  let peak = 0, at30 = 0;
  for (let t = 0; t < 60; t += TIMING.step) {
    s.step(TIMING.step);
    peak = Math.max(peak, s.parts.length);
    if (Math.abs(t - 30) < TIMING.step / 2) at30 = s.parts.length;
  }
  ok(peak < 400, `condition ${slug}: ${peak} particles alive at once`);
  ok(s.parts.length <= Math.max(at30 * 1.6, at30 + 40), `condition ${slug}: particles keep growing (${at30} at 30 s, ${s.parts.length} at 60 s)`);
  s.stop();
  for (let t = 0; t < 4 && !s.done; t += TIMING.step) s.step(TIMING.step);
  ok(s.done, `condition ${slug}: does not end after stop()`);
}

/* ── 6. looks ──────────────────────────────────────────────────────────── */

{
  const merged = mergeLooks({ material: "fire", hue: 30 }, { material: "cold" }, { hue: "", off: false });
  ok(merged.material === "cold" && merged.hue === 30, "mergeLooks: a later layer must win per field and a blank must fall through");
  ok(applyLook({ material: "fire" }, normalizeLook({ off: true })) === null, "a look switched off must play nothing");
  const re = applyLook({ material: "fire", accent: "fire" }, normalizeLook({ material: "void" }));
  ok(re.material === "void" && re.accent === null, "a material reskin must replace the material and drop the accent");
}

/* ── 7. the Director ───────────────────────────────────────────────────── */

{
  let clock = 0, claimed = null;
  const announced = [];
  const ladder = { level: 0, allows(name) { return SHED_ORDER.indexOf(name) >= this.level; } };
  const d = new Director({ now: () => clock, raf: () => 0, ladder, claim: (v) => { claimed = v; }, announce: (l) => announced.push(l.length) });
  const spec = base("fire", "hit", { kind: "attack" });
  const k = d.play(spec, { sceneId: "A" });
  ok(k && d.sims("A").length === 1 && d.sims("B").length === 0, "Director: a played effect is listed for its scene only");
  ok(claimed === true, "Director: a running effect must claim motion");
  const delayed = d.play(spec, { sceneId: "A", delay: 1 });
  ok(d.sims("A").length === 1, "Director: a delayed effect must not be listed before it starts");
  for (let i = 0; i < 2000 && d.running.size; i++) { clock += 1 / 60; d.advance(1 / 60); }
  ok(!d.running.has(k) && !d.running.has(delayed), "Director: a finished effect is not dropped");
  d.sleep();
  ok(claimed === false, "Director: an idle Director must release its motion claim");

  const cond = base("fire", "hit", { kind: "condition", condition: { slug: "persistent-damage", value: 1 }, targets: [target("hit")], caster: null });
  let where = { x: cond.targets[0].x, y: cond.targets[0].y };
  d.locate = () => where;
  d.startLoop("a:persistent-damage", cond, { sceneId: "A" });
  const first = d.running.get("a:persistent-damage").sim;
  d.startLoop("a:persistent-damage", cond, { sceneId: "A" });
  ok(d.running.get("a:persistent-damage").sim === first, "Director: startLoop must be idempotent for an unchanged condition");
  where = { x: where.x + 2, y: where.y };
  clock += 0.1; d.advance(0.1);
  ok(first.offset?.x === 2, "Director: a loop must follow its creature (sim.offset)");
  d.stopLoop("a:persistent-damage");
  for (let i = 0; i < 600 && d.running.size; i++) { clock += 1 / 60; d.advance(1 / 60); }
  ok(!d.running.size, "Director: a stopped loop is never dropped");

  d.maxConcurrent = 3;
  for (let i = 0; i < 6; i++) d.play(spec, { sceneId: "A" });
  ok(d.running.size === 3, `Director: maxConcurrent not enforced (${d.running.size} running)`);
  ladder.level = SHED_ORDER.length;
  d.advance(0.02);
  const anySim = [...d.running.values()][0]?.sim;
  ok(anySim && SHED_ORDER.filter((n) => n !== "concurrency").every((n) => anySim.shed.has(n)), "Director: shed names must reach the sims");
  d.clear();
  ok(announced.length > 0, "Director: changes must be announced");
}

/* ── 8. shed names are all read somewhere ──────────────────────────────── */

{
  const all = (await Promise.all(files.map(text))).join("\n");
  for (const name of SHED_ORDER) {
    ok(new RegExp(`shed\\.has\\(\\s*["']${name}["']\\s*\\)|allows\\(\\s*["']${name}["']\\s*\\)`).test(all),
      `shed name "${name}" is never read: it would never degrade anything`);
  }
}

/* ── 9. i18n ───────────────────────────────────────────────────────────── */

{
  const lang = JSON.parse(await text("lang/pf2e-fx.en.json"));
  const has = (k) => typeof lang[k] === "string" && lang[k].length > 0;
  for (const m of MATERIALS) ok(has(`GLFX.material.${m}`), `missing i18n GLFX.material.${m}`);
  for (const f of ["sparkles", "petals", "runes", "none"]) ok(has(`GLFX.flourish.${f}`), `missing i18n GLFX.flourish.${f}`);
  ok(has("GLS.feature.pf2e-fx.title") && has("GLS.feature.pf2e-fx.hint"), "missing feature title/hint");
  for (const f of files) {
    for (const [, key] of (await text(f)).matchAll(/["'`](GLFX\.[A-Za-z0-9_.]+?)["'`]/g)) {
      if (key.endsWith(".")) continue;
      ok(has(key), `${f.slice(FX.length)} uses missing i18n key ${key}`);
    }
  }
  const adapter = await text(`${FX}index.mjs`);
  for (const [, name] of adapter.matchAll(/world\(SETTINGS\.\w+,\s*"(\w+)"/g)) {
    ok(has(`GLFX.Settings.${name}.Name`) && has(`GLFX.Settings.${name}.Hint`), `missing i18n for setting ${name}`);
  }
  for (const key of Object.values(SETTINGS)) ok(key.startsWith("fx."), `setting ${key} is not under the fx. prefix`);
}

/* ── 10. the reader keeps results private ──────────────────────────────── */

{
  let reader = "";
  try { reader = stripComments(await text(`${FX}read.mjs`)); } catch { problems.push("read.mjs is missing"); }
  if (reader) {
    /* pf2e-odds' privacy helpers, never a private copy: the stream login holds
       GM rights and is watched by the players, so "sees the truth" is never a
       bare isGM, and two copies of that rule drift. */
    ok(/import \{[^}]*\bseesTruth\b[^}]*\} from "\.\.\/pf2e-odds\/view\.mjs"/.test(reader) && !/function seesTruth/.test(reader), "read.mjs must import seesTruth from pf2e-odds/view.mjs, never restate it");
    ok(/from "\.\.\/pf2e-odds\/observe\.mjs"/.test(reader) && !/function reachedPlayers|const metagame/.test(reader), "read.mjs must import reachedPlayers and metagame from pf2e-odds/observe.mjs");
    ok(/metagame\(\s*["']results["']\s*\)/.test(reader), "read.mjs must show a degree to players only under PF2e's 'show results' metagame setting");
    ok(/isContentVisible/.test(reader) && /blind/.test(reader), "read.mjs must refuse a message this viewer cannot read (isContentVisible, blind)");
    ok(!/emitSocket|game\.socket/.test(reader), "read.mjs must not broadcast: every client reads its own chat");
    // an Elemental Blast's origin is the impulse (an action), which the weapon/melee/spell gate drops
    ok(/isBlast\(ctx\)\) void onAttack/.test(reader) && /describeBlast\(/.test(reader), "read.mjs must let an Elemental Blast attack through to onAttack and describe it with describeBlast");
    // a creature's look styles what it does, never the conditions on it
    ok(!/slug: c\.slug, actor:/.test(reader) && !/slug: "persistent-damage", actor:/.test(reader), "read.mjs must not pass the afflicted actor's look to its condition loops or persistent damage ticks");
  }
}

/* ── 11. passives: the PF2e events that show them, and who may see them ── */
/* Frightful Presence, Regeneration and auras post no card (catalogue §4 row
   21). Each plays on a real PF2e event (passives.mjs cites the system source);
   every one of these fails silently: a passive read as the wrong kind plays
   nothing or the wrong thing, a key that is not per round replays on every
   re-sort, a turn pulse that skips the audience test draws a GM-hidden
   creature's aura on the stream. */
{
  const P = await import("../scripts/features/pf2e-fx/passives.mjs");
  const item = (name, slug, system) => ({ name, type: "action", system: { slug, actionType: { value: "passive" }, description: { value: "" }, rules: [], ...system, traits: { value: system.traits ?? [] } } });
  const fp = item("Frightful Presence", "frightful-presence", { traits: ["aura", "emotion", "fear", "mental"], rules: [{ key: "Aura", radius: 90, slug: "frightful-presence", traits: ["emotion", "fear", "mental"] }], description: { value: "<p>90 feet. @Check[will|dc:30|options:area-effect,inflicts:frightened]</p>" } });
  const regen = item("Regeneration 20", "regeneration", { rules: [{ key: "FastHealing", type: "regeneration", value: 20, deactivatedBy: ["fire"] }] });
  const fast = item("Fast Healing 5", "fast-healing", { rules: [{ key: "FastHealing", value: 5 }] });
  const stench = item("Stench", "stench", { traits: ["aura", "olfactory"], rules: [{ key: "Aura", radius: 30, slug: "stench", traits: ["olfactory"] }], description: { value: "<p>30 feet. @Check[fortitude|dc:20|options:area-effect,inflicts:sickened]</p>" } });
  const heat = item("Dragon Heat", "dragon-heat", { traits: ["aura", "fire"], rules: [{ key: "Aura", radius: 10, slug: "dragon-heat" }], description: { value: "<p>10 feet, @Damage[4d6[fire]] damage</p>" } });
  const telepathy = item("Telepathy 100 feet", "telepathy", { traits: ["aura", "magical"], rules: [{ key: "Aura", radius: 100, slug: "telepathy" }] });
  const sacred = item("Sacrilegious Aura", "sacrilegious-aura", { traits: ["aura", "magical"], rules: [{ key: "Aura", radius: 30, slug: "sacrilegious-aura" }] });
  const like = (what, got, want) => { for (const [k, v] of Object.entries(want)) ok(got?.[k] === v, `passiveOf(${what}).${k} is ${JSON.stringify(got?.[k])}, want ${JSON.stringify(v)}`); };
  like("Frightful Presence", P.passiveOf(fp), { kind: "fear", feet: 90 });
  like("Regeneration", P.passiveOf(regen), { kind: "regen", regen: "regeneration", rank: 1 });
  like("Fast Healing", P.passiveOf(fast), { kind: "regen", regen: "fast-healing" });
  like("Stench", P.passiveOf(stench), { kind: "aura", material: "poison", visible: false, feet: 30 });
  like("Dragon Heat", P.passiveOf(heat), { kind: "aura", material: "fire", damage: true, visible: true });
  like("Sacrilegious Aura", P.passiveOf(sacred), { kind: "aura", visible: false });
  ok(P.passiveOf(telepathy) === null, "passiveOf: Telepathy is a sense, never an aura to draw");
  ok(P.passiveOf({ ...heat, type: "spell" }) === null, "passiveOf: a spell with the aura trait posts its own card and plays from it");
  ok(P.passiveOf({ ...heat, system: { ...heat.system, actionType: { value: "action" } } }) === null, "passiveOf: an activated aura posts its own card and plays from it");
  ok(P.turnPulse([P.passiveOf(stench), P.passiveOf(sacred), P.passiveOf(heat)])?.slug === "dragon-heat", "turnPulse: a creature's damaging aura is the one it breathes out at turn start");
  ok(P.turnPulse([P.passiveOf(stench), P.passiveOf(fp)]) === null, "turnPulse: a smell, a fear or a feeling never pulses at turn start (it plays from its save card)");
  ok(P.auraArea({ x: 0, y: 0, size: 2 }, 5280).r === P.MAX_AURA_SQUARES + 1, "auraArea: a mile-wide aura must be clamped, or it fills the screen every turn");
  // keys: one play per creature per round, forward only
  ok(P.turnAdvanced({ round: 1, turn: 2 }, { round: 1, turn: 3, combatantId: "c" }) && P.turnAdvanced({ round: 1, turn: 5 }, { round: 2, turn: 0, combatantId: "c" }), "turnAdvanced: a turn or a round moving forward is a turn start");
  ok(!P.turnAdvanced({ round: 2, turn: 1 }, { round: 2, turn: 0, combatantId: "c" }) && !P.turnAdvanced({ round: 2, turn: 1 }, { round: 2, turn: 1, combatantId: "c" }) && !P.turnAdvanced({ round: 2, turn: 0 }, { round: 1, turn: 4, combatantId: "c" }), "turnAdvanced: rewinding or a re-sort onto the same turn must not replay a pulse");
  ok(!P.turnAdvanced(null, { round: 0, turn: 0, combatantId: "c" }), "turnAdvanced: an encounter that has not started has no turns");
  const seen = new P.Seen(4);
  const k = P.passiveKey("regen", "tok", "combat:3");
  ok(seen.claim(k) && !seen.claim(k), "Seen: a second claim of one key must fail (regen and turn pulses are idempotent)");
  for (let i = 0; i < 10; i++) seen.claim(`x${i}`);
  ok(seen.keys.size === 4, "Seen: the played-key memory must stay bounded");
  // the status cards' audience rule for a trigger with no message
  ok(!P.observable({ truth: false, playerOwned: false, hidden: true, onScene: true }), "observable: a GM-hidden creature no player owns must never play for a viewer without the truth");
  ok(P.observable({ truth: false, playerOwned: false, hidden: false, onScene: true }) && P.observable({ truth: false, playerOwned: true, hidden: true, onScene: true }), "observable: a visible creature, or a player-owned one, is the table's business");
  ok(!P.observable({ truth: true, playerOwned: true, hidden: false, onScene: false }), "observable: a creature with no token on the viewed scene plays nothing");
  ok(!P.auraShown({ truth: false, party: false }) && P.auraShown({ truth: false, party: true }) && P.auraShown({ truth: true }), "auraShown: an enemy's aura is drawn only for a viewer PF2e draws it for (a GM, or the party's own)");
  // the specs compile to the archetypes and the delivery they promise
  const subject = { ...caster, x: 2, y: 4 };
  const fearSim = run("passive:fear", { ...P.fearDesc(P.passiveOf(fp)), id: "pf", seed: 7, caster: subject, targets: [target("hit"), target("neutral", 1)], outcome: "hit" });
  ok(fearSim?.phases.includes("arch: fear"), "Frightful Presence must play the fear archetype");
  const auraSim = run("passive:aura", { ...P.auraDesc(P.passiveOf(heat)), id: "pa", seed: 7, caster: subject, targets: [], area: P.auraArea(subject, 10) });
  ok(auraSim?.phases.includes("aura"), "a passive aura must play HARM.aura's pulse");
  const riseSim = run("passive:regen", { ...P.regenDesc(P.passiveOf(regen)), id: "pr", seed: 7, caster: null, targets: [{ ...subject, outcome: "neutral" }] });
  ok(riseSim?.phases.includes("arch: rise") && !riseSim.phases.includes("charge"), "Regeneration must play a small rise with no spell charge (nobody cast it)");

  const reader = stripComments(await text(`${FX}read.mjs`));
  ok(/from "\.\/passives\.mjs"/.test(reader), "read.mjs must take its passive decisions from passives.mjs");
  ok(/!castFor\(origin\) && PASSIVE_ORIGINS\.has\(origin\.type\)\) onPassiveRoll/.test(reader), "read.mjs must route a castless save from a passive to onPassiveRoll (Frightful Presence, Stench)");
  ok(/PASSIVE_ORIGINS\.has\(origin\.type\)\) onPassiveRoll\(message, ctx, origin\)/.test(reader.slice(reader.indexOf('type === "damage-roll"'))), "read.mjs must play a passive aura's damage card (Dragon Heat)");
  ok(/!ctx && !origin && message\.rolls\?\.length\) \{ void onRegenCard/.test(reader) && /type === "damage-taken"\) \{ onHealTaken/.test(reader), "read.mjs must read FastHealing's turn-start card and the healing applied from it");
  ok(/on\("combatTurnChange"/.test(reader) && !/pf2e\.startTurn/.test(reader), "read.mjs must hook combatTurnChange (every client), never pf2e.startTurn (the active GM's client only)");
  const turn = reader.slice(reader.indexOf("function onTurnChange"), reader.indexOf("function resetPassives"));
  ok(/observable\(/.test(turn) && /auraShown\(/.test(turn) && /bodyOf\(token\)/.test(turn) && /seesTruth\(\)/.test(turn), "onTurnChange must pass the status cards' audience rule, PF2e's aura visibility and this viewer's sight before it draws");
  ok(/turnAdvanced\(/.test(turn) && /passiveSeen\.claim\(/.test(turn), "onTurnChange must play forward turns only, once per creature per round");
  const fire = reader.slice(reader.indexOf("async function firePassive"), reader.indexOf("function regenRound"));
  ok(/canRead\(message\)/.test(fire) && /degreeShown\(\)/.test(fire) && /bodyOf\(/.test(fire), "firePassive must show a save's degree only to a viewer who may read it and see the result, on bodies this viewer can see");
  ok(/passiveSeen\.claim\(key\)/.test(reader.slice(reader.indexOf("function playRegen"))), "a regeneration must play once per creature per round, however many cards show it");
  ok(/resetPassives\(\)/.test(reader.slice(reader.indexOf("return () => {"))), "unwiring the reader must drop its passive joins and played keys");
}

/* ── report ────────────────────────────────────────────────────────────── */

ok(worst.ms < 12, `worst paint ${worst.ms.toFixed(2)} ms (${worst.what}) is over the 12 ms budget`);
if (verbose) {
  cost.sort((a, b) => b[1] - a[1]);
  console.log("slowest average paints:");
  for (const [what, ms] of cost.slice(0, 15)) console.log(`  ${ms.toFixed(2)} ms  ${what}`);
}
console.log(`fx-check: worst paint ${worst.ms.toFixed(2)} ms (${worst.what}); most particles ${worstParts.n} (${worstParts.what})`);
if (problems.length) {
  console.log(`${problems.length} problem(s):`);
  for (const p of [...new Set(problems)].slice(0, 80)) console.log(`  ✗ ${p}`);
  process.exit(1);
}
console.log("fx-check: zero problems");
