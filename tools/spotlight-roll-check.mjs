#!/usr/bin/env node
/**
 * Spotlight Roll consistency check.
 *
 * Everything below fails *silently* in a live session:
 *
 *   • The tumble must land EXACTLY on the target face, from any idle pose,
 *     for any seed, and move continuously through the throw and the landing.
 *     A die that ends a hair off its face reads a different number to every
 *     player squinting at it, and a discontinuity is a visible pop once per
 *     roll — both render without an error.
 *   • The DC unveils BEFORE the tally, and the degree lands after the last
 *     modifier. Reordered, the one dramatic thing a check does (the total
 *     crossing the line) silently stops happening.
 *   • The world setting reaches every client, so it must never carry a hidden
 *     DC or a result. Results ride the server-filtered socket only; a result
 *     emitted without `recipients` would hand a blind roll to every player's
 *     console while every screen looks correct.
 *   • GM-side intents (throw, toggle, reroll) are honoured only on the
 *     SERVER-attested sender id, never a payload field.
 *   • The held PF2e card is posted with Dice So Nice's skip flag (or the die
 *     rolls a second time on the board) and the suite tag Critical stands down
 *     on (or a crit plays two cut-ins).
 *   • Every i18n key exists, including the families built at runtime.
 *   • The overlay, director, backdrop and models stay pure: the preview page
 *     and this tool import them with no Foundry behind them.
 *   • Every uniform the director writes is declared in the prelude, and the
 *     overlay fragment does not redeclare one (a duplicate declaration fails
 *     to compile, and a failed program degrades to the CSS path silently).
 *
 * Usage: node tools/spotlight-roll-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEAT = join(ROOT, "scripts/features/spotlight-roll");
const problems = [];
const fail = (m) => problems.push(m);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);

/* ── 1. tumble ───────────────────────────────────────────────────────── */
const { createTumble, faceQuaternion, idlePose, qrotate, qnorm, TUMBLE } = await imp("scripts/features/spotlight-roll/tumble.mjs");
const ang = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
let worstLand = 0, worstEnd = 0, worstStart = 0, worstStep = 0, worstJerk = 0;
for (let seed = 1; seed <= 60; seed++) {
  const n = norm([Math.sin(seed), Math.cos(seed * 1.7), Math.sin(seed * 0.3) + 0.2]);
  const up = norm([Math.cos(seed * 2.1), Math.sin(seed * 0.9), 0.4]);
  const target = faceQuaternion(n, up);
  const shown = qrotate(target, n);
  if (Math.abs(shown[2] - 1) > 1e-6) fail(`tumble: faceQuaternion does not turn the face to the camera (seed ${seed})`);
  const from = idlePose(seed * 0.37, seed).q;
  for (const scale of [0.75, 1, 1.3]) {
    const tb = createTumble({ target, from, seed: seed * 7919, scale });
    worstStart = Math.max(worstStart, ang(tb.at(0).q, from));
    worstLand = Math.max(worstLand, ang(tb.at(tb.duration).q, target));
    worstEnd = Math.max(worstEnd, ang(tb.at(tb.total).q, target));
    let prev = tb.at(0).q, prevStep = 0;
    for (let t = 1 / 120; t <= tb.total + 0.2; t += 1 / 120) {
      const q = tb.at(t).q;
      if (q.some((x) => !Number.isFinite(x))) { fail(`tumble: NaN at t=${t.toFixed(3)} seed ${seed}`); break; }
      const s = ang(prev, q);
      worstStep = Math.max(worstStep, s);
      if (t > 1 / 60) worstJerk = Math.max(worstJerk, Math.abs(s - prevStep));
      prev = q; prevStep = s;
    }
  }
}
if (worstStart > 1e-6) fail(`tumble: the throw does not start from the idle pose (off by ${worstStart.toFixed(6)} rad)`);
if (worstLand > 1e-6) fail(`tumble: the die does not reach its face at landing (off by ${worstLand.toFixed(6)} rad)`);
if (worstEnd > 1e-6) fail(`tumble: the die does not come to rest exactly on its face (off by ${worstEnd.toExponential(2)} rad)`);
// 120 Hz sampling: past ~0.4 rad/frame (≈7.5 rev/s) the faces smear into a
// blur and the throw reads as a glitch; a step-to-step change over 0.06 rad is a pop.
if (worstStep > 0.4) fail(`tumble: spins faster than 0.4 rad per 120Hz frame (${worstStep.toFixed(3)})`);
if (worstJerk > 0.06) fail(`tumble: discontinuous rate — a frame-to-frame jump of ${worstJerk.toFixed(3)} rad`);
if (!(TUMBLE.duration > 2.5 && TUMBLE.duration < 5)) fail("tumble: duration outside the 2.5–5 s a cinematic throw needs (shorter reads as a flick)");

/* ── 2. beats and degree ─────────────────────────────────────────────── */
const { scheduleBeats } = await imp("scripts/features/spotlight-roll/timeline.mjs");
const { degreeOf, DEGREE_KEYS } = await imp("scripts/core/pf2e-degree.mjs");
for (const mods of [0, 1, 6]) for (const natural of [20, 1, 11]) for (const dcHidden of [true, false]) for (const fortune of [true, false]) {
  const b = scheduleBeats({ mods, natural, dcHidden, fortune, crit: natural === 20 });
  const seq = [b.throw, b.land, b.settle, b.fortune, b.natural, b.dcReveal, ...b.tally, b.degree, b.hold, b.out, b.end].filter((x) => x != null);
  if (seq.some((x, i) => i && x < seq[i - 1])) fail(`beats: out of order for ${JSON.stringify({ mods, natural, dcHidden, fortune })}`);
  if (dcHidden && b.tally.length && b.dcReveal >= b.tally[0]) fail("beats: the DC must unveil BEFORE the tally");
  if (b.tally.length && b.degree <= b.tally.at(-1)) fail("beats: the degree must land after the last modifier");
}
const cases = [[37, 32, 20, 3], [32, 32, 15, 2], [31, 32, 14, 1], [18, 24, 1, 0], [20, 31, 3, 0], [35, 25, 18, 3], [22, 32, 20, 1], [42, 32, 1, 2], [12, null, 12, null]];
for (const [total, dc, nat, want] of cases) {
  const got = degreeOf(total, dc, nat);
  if (got !== want) fail(`degree: ${total} vs DC ${dc} (nat ${nat}) should be ${want}, got ${got}`);
}
if (DEGREE_KEYS.join() !== "criticalFailure,failure,success,criticalSuccess") fail("degree: DEGREE_KEYS order must match PF2e's 0..3");
const dd = read("scripts/features/destiny-dice/fate-result.mjs");
if (/function baseDegree|function adjustDegreeForNatural/.test(dd)) fail("degree: Destiny Dice re-declares the degree rule instead of importing core/pf2e-degree.mjs");

/* ── 3. request model: the world setting never leaks ─────────────────── */
const RM = await imp("scripts/features/spotlight-roll/request-model.mjs");
const base = { id: "r1", layout: "single", check: { kind: "skill", slug: "athletics", label: "Athletics" }, audience: "gm", fortune: "none", slots: [{ actorUuid: "Actor.x", name: "Seri", diceSpec: [20], mods: [{ slug: "a", label: "A", value: 4 }] }] };
for (const mode of ["hidden", "never"]) {
  const r = RM.normalizeRequest({ ...base, dc: { mode, value: 27 } });
  if (r.dc.value !== null) fail(`model: a ${mode} DC is stored in the world setting every client receives`);
  if (!r.dc.has) fail(`model: a ${mode} DC must still say that a DC exists`);
}
if (RM.normalizeRequest({ ...base, dc: { mode: "shown", value: 27 } }).dc.value !== 27) fail("model: a shown DC must be stored");
{
  const r = RM.normalizeRequest({ ...base, dc: { mode: "hidden", value: 27 }, slots: [{ ...base.slots[0], throw: { at: 5, seed: 1, seq: 1 }, result: { total: 30 } }] });
  if ("result" in r.slots[0] || JSON.stringify(r).includes('"total"')) fail("model: normalizeRequest lets a result field through into the world setting");
  const i18n = { t: (k) => k };
  const sealed = RM.viewModel(r, 0, null, i18n);
  if (!sealed.sealed) fail("model: a thrown slot with no result must play SEALED");
  if (sealed.degree != null || sealed.roll.total != null || sealed.dc.value != null) fail("model: a sealed slot exposes a total, a degree or a DC");
  const res = RM.normalizeResult({ reqId: "r1", slot: 0, seq: 1, at: 5, seed: 3, sealed: false, roll: { natural: 20, total: 37, dice: [{ faces: 20, value: 20 }] }, dc: 27, degree: 3, canReroll: true });
  const open = RM.viewModel(r, 0, res, i18n);
  if (open.sealed || open.degree !== 3 || open.dc.value !== 27) fail("model: an entitled result does not reach the view");
  if (open.canReroll) fail("model: canReroll must also need the viewer's own right to act on the slot");
  const sres = RM.normalizeResult({ reqId: "r1", slot: 0, seq: 1, sealed: true, roll: { total: 37 }, degree: 3, dc: 27 });
  if (sres.roll || sres.degree != null || sres.dc != null) fail("model: normalizeResult keeps result fields on a sealed payload");
}
const fd = [["2d6+3", "6,6"], ["1d20+7", "20"], ["d100", "100,10"], ["1d7", null], ["7d6", null], ["4", null]];
for (const [f, want] of fd) {
  const got = RM.formulaDice(f);
  if ((got?.join() ?? null) !== want) fail(`model: formulaDice("${f}") should be ${want}, got ${got}`);
}
for (const [r, tens, units] of [[37, 30, 7], [40, 40, 10], [100, 100, 10], [7, 100, 7], [1, 100, 1]]) {
  const [a, b] = RM.splitD100(r);
  if (a.value !== tens || b.value !== units) fail(`model: splitD100(${r}) should show ${tens}+${units}, got ${a.value}+${b.value}`);
}

/* ── 4. the channel ──────────────────────────────────────────────────── */
const main = read("scripts/features/spotlight-roll/main.mjs");
for (const m of main.matchAll(/emitSocket\(FEATURE_ID,\s*\{\s*type:\s*MSG\.(\w+)[\s\S]*?\);/g)) {
  if (!/recipients/.test(m[0])) fail(`channel: a ${m[1]} message is emitted to everyone — results and intents must name their recipients`);
}
if (!/meta\?\.attested/.test(main) || /onIntent\(payload,\s*_claimed\b/.test(main)) fail("channel: GM intents must be resolved on meta.attested (server-attested), never the claimed sender");
if (!/onIntent\(payload,\s*meta\.attested\)/.test(main)) fail("channel: intents must be handed the attested sender id");
if (!/mayActOnSlot\(user,\s*slot\)/.test(main)) fail("channel: an intent must check the sender may act on that slot");
const sock = read("scripts/core/socket.mjs");
if (!/\(msg,\s*attestedUserId\)/.test(sock) || !/recipients/.test(sock)) fail("channel: core/socket.mjs lost the attested sender or recipients support");
const roll = read("scripts/features/spotlight-roll/pf2e-roll.mjs");
if (!/flags\.dice-so-nice\.skip/.test(roll)) fail("record: the held card must carry flags.dice-so-nice.skip, or DSN rolls the die again on the board");
if (!/\.spotlight`/.test(roll) && !/spotlight"/.test(roll)) fail("record: the held card must carry the suite's spotlight flag");
if (!/createMessage:\s*false/.test(roll)) fail("record: rolls must be made with createMessage:false and posted when the degree lands");
if (/rollMode\s*:/.test(roll)) fail("record: PF2e 8.4 has no rollMode argument (it is dropped silently); set the audience on the held data");
const crit = read("scripts/features/critical/module.js");
if (!/\.spotlight\) return/.test(crit)) fail("record: Critical must stand down for Spotlight Roll cards");

/* ── 5. purity ───────────────────────────────────────────────────────── */
const PURE = ["tumble.mjs", "timeline.mjs", "director.mjs", "backdrop.mjs", "request-model.mjs", "constants.mjs"];
const overlayDir = join(FEAT, "overlay");
const overlayFiles = existsSync(overlayDir) ? readdirSync(overlayDir).filter((f) => f.endsWith(".mjs")).map((f) => `overlay/${f}`) : [];
if (!overlayFiles.includes("overlay/monolith.mjs")) fail("overlay: scripts/features/spotlight-roll/overlay/monolith.mjs is missing");
for (const f of [...PURE, ...overlayFiles]) {
  const src = read(`scripts/features/spotlight-roll/${f}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  const hit = src.match(/(?<![.\w$])(game|canvas|ui|Hooks|foundry|fromUuid|CONFIG)\s*[.(\[]/);
  if (hit) fail(`purity: ${f} reaches for \`${hit[1]}\` — the preview and this tool load it with no Foundry`);
}
let overlay = null;
try { overlay = (await imp("scripts/features/spotlight-roll/overlay/monolith.mjs")).default; } catch (e) { fail(`overlay: does not import under Node (${e.message})`); }

/* ── 6. shader contract ──────────────────────────────────────────────── */
const BD = await imp("scripts/features/spotlight-roll/backdrop.mjs");
for (const u of BD.UNIFORMS) if (!new RegExp(`uniform\\s+\\w+\\s+${u}\\b`).test(BD.PRELUDE)) fail(`shader: ${u} is written by the director but not declared in the prelude`);
const dir = read("scripts/features/spotlight-roll/director.mjs");
for (const m of dir.matchAll(/\b(u[A-Z]\w+):/g)) if (!BD.UNIFORMS.includes(m[1])) fail(`shader: the director writes ${m[1]}, which is not in UNIFORMS`);
if (overlay?.fragment) {
  for (const u of BD.UNIFORMS) if (new RegExp(`uniform\\s+\\w+\\s+${u}\\b`).test(overlay.fragment)) fail(`shader: the overlay fragment redeclares ${u} (the prelude declares it) — the program will not compile`);
  if (!/void\s+main\s*\(/.test(overlay.fragment)) fail("shader: the overlay fragment has no main()");
}
const { SHED_ORDER } = await imp("scripts/features/spotlight-roll/director.mjs");
if (!SHED_ORDER.includes("backdrop")) fail("perf: SHED_ORDER must be able to shed the WebGL backdrop to the CSS one");

/* ── 7. i18n ─────────────────────────────────────────────────────────── */
let lang = {};
try { lang = JSON.parse(read("lang/spotlight-roll.en.json")); } catch (e) { fail(`i18n: lang/spotlight-roll.en.json missing or invalid (${e.message})`); }
const has = (k) => k.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), lang) !== undefined;
const want = new Set();
for (const f of ["main.mjs", "pf2e-roll.mjs", "request-app.mjs", "request-model.mjs", "index.mjs", ...overlayFiles]) {
  for (const m of read(`scripts/features/spotlight-roll/${f}`).matchAll(/["'`](GLSR\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) want.add(m[1]);
}
for (const m of read("templates/spotlight-roll/request.hbs").matchAll(/localize "(GLSR\.[\w.]+)"/g)) want.add(m[1]);
const C = await imp("scripts/features/spotlight-roll/constants.mjs");
for (const k of C.CHECK_KINDS) want.add(`GLSR.app.kind.${k}`);
for (const k of C.DC_MODES) want.add(`GLSR.app.dcMode.${k}`);
for (const k of C.AUDIENCES) want.add(`GLSR.app.audience.${k}`);
for (const k of C.FORTUNE) want.add(`GLSR.app.fortune.${k}`);
for (const k of C.SAVES) want.add(`GLSR.app.save.${k}`);
for (const k of DEGREE_KEYS) want.add(`GLSR.degree.${k}`);
const overlayMod = overlay ? await imp("scripts/features/spotlight-roll/overlay/monolith.mjs") : null;
if (overlayMod && !Array.isArray(overlayMod.I18N_DYNAMIC)) fail("i18n: overlay/monolith.mjs must export I18N_DYNAMIC (its runtime-built keys)");
for (const k of overlayMod?.I18N_DYNAMIC ?? []) want.add(k);
for (const k of want) if (!has(k)) fail(`i18n: missing key ${k}`);

/* ── 8. registration, CSS ────────────────────────────────────────────── */
const idx = read("scripts/features/spotlight-roll/index.mjs");
if (!/system:\s*"pf2e"/.test(idx)) fail("adapter: system must be pf2e");
if (!/requires:\s*\[DSN_ID\]/.test(idx)) fail("adapter: must require dice-so-nice");
if (!/minimumGeneration:\s*14/.test(idx)) fail("adapter: Dice So Nice 6.x needs Foundry v14 — gate the generation");
if (C.PREFIX !== "dr.") fail("adapter: setting prefix changed — world settings would be orphaned");
for (const k of Object.values(C.SETTINGS)) if (!k.startsWith(C.PREFIX)) fail(`adapter: setting ${k} is outside the dr. prefix and lands in no Control Center group`);
const otherPrefixes = [...read("docs/FEATURE_CONTRACT.md").matchAll(/^\|\s*[\w-]+\s*\|\s*([\w.]+)/gm)].map((m) => m[1]);
if (otherPrefixes.filter((p) => p === "dr.").length > 1) fail("adapter: the dr. prefix is claimed twice in the contract matrix");
if (!read("scripts/features/index.mjs").includes("./spotlight-roll/index.mjs")) fail("adapter: not imported from features/index.mjs");
const mj = JSON.parse(read("module.json"));
for (const p of ["styles/spotlight-roll.css", "styles/spotlight-roll-app.css"]) if (!mj.styles.includes(p)) fail(`module.json: ${p} not loaded`);
if (!mj.languages.some((l) => l.path === "lang/spotlight-roll.en.json")) fail("module.json: lang/spotlight-roll.en.json not loaded");
for (const css of ["styles/spotlight-roll.css", "styles/spotlight-roll-app.css"]) {
  if (!existsSync(join(ROOT, css))) { fail(`css: ${css} missing`); continue; }
  const src = read(css).replace(/\/\*[\s\S]*?\*\//g, "");
  if (/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(src)) fail(`css: ${css} uses a raw white veil — use rgb(var(--gl-tint-light) / a)`);
  if (/@font-face|@import\s+url\(['"]?http/.test(src)) fail(`css: ${css} declares a font or a network import`);
  for (const m of src.matchAll(/@keyframes\s+([\w-]+)/g)) if (!m[1].startsWith("glsr-")) fail(`css: @keyframes ${m[1]} must carry the glsr- prefix (names are global)`);
  if (/@media[^{]*prefers-reduced-motion/.test(src)) fail(`css: ${css} honours prefers-reduced-motion — the suite does not`);
}
const appCss = read("styles/spotlight-roll-app.css");
for (const cls of [...read("templates/spotlight-roll/request.hbs").matchAll(/class="gl-btn ([\w-]+)/g)].map((m) => m[1])) {
  if (!new RegExp(`\\.${cls}\\s*\\{[^}]*font-size`).test(appCss)) fail(`css: .gl-btn.${cls} has no font-size of its own (.gl-btn takes the host's)`);
}

/* ── report ─────────────────────────────────────────────────────────── */
if (problems.length) {
  console.log(`spotlight-roll-check: ${problems.length} problem(s)`);
  for (const p of problems) console.log("  ✗ " + p);
  process.exit(1);
}
console.log("spotlight-roll-check: OK");
