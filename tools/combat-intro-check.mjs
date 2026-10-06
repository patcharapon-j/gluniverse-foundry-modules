#!/usr/bin/env node
/**
 * Combat Intro consistency check.
 *
 * Everything below fails *silently* in a live session:
 *
 *   • The flag reaches every client, so it must never carry a total, a natural,
 *     an NPC's modifiers or a hidden combatant. `normalizeState` is the only
 *     reader; a field it lets through is on every player's console.
 *   • Results ride the socket with `recipients`, sealed for anyone `entitled`
 *     says no to. One emit without recipients hands an NPC's initiative to
 *     every player before the sort, while every screen looks right.
 *   • Intents are honoured only on the SERVER-attested sender id.
 *   • Initiative is rolled through PF2e's ActorInitiative statistic (the
 *     `initiative` domain carries Scout, Incredible Initiative…), never
 *     `ActorInitiative#roll`, which writes the tracker at once, and committed
 *     through `setMultipleInitiatives` in ONE batch.
 *   • One timeline: the beats are positive and ordered, and the sort is ready
 *     only once every slot has landed.
 *   • Every uniform a skin declares is written by its `write`, and every one it
 *     writes is declared. A uniform nobody writes holds its first value forever.
 *   • Every sound cue resolves to a file for every skin.
 *   • The skins are scoped (docs/adr/0001-scoped-skins.md): no `:root` write,
 *     every rule under the feature's own skinned root, and Aegis danger stays
 *     distinct from its red accent.
 *   • Every i18n key exists, including the families built at runtime.
 *   • The pure modules stay pure: the preview and this tool import them.
 *
 * Usage: node tools/combat-intro-check.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEAT = "scripts/features/combat-intro";
const problems = [];
const fail = (m) => problems.push(m);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const C = await imp(`${FEAT}/constants.mjs`);
const TL = await imp(`${FEAT}/timeline.mjs`);
const SM = await imp(`${FEAT}/state-model.mjs`);

/* ── 1. timeline ─────────────────────────────────────────────────────── */
for (const [name, beats] of Object.entries({ INTRO: TL.INTRO, SORT: TL.SORT, HANDOFF: TL.HANDOFF })) {
  if (!beats.length) fail(`timeline: ${name} has no beats`);
  for (const [beat, ms] of beats) if (!(ms > 0)) fail(`timeline: ${name}.${beat} must be longer than 0 ms`);
  const names = beats.map(([b]) => b);
  if (new Set(names).size !== names.length) fail(`timeline: ${name} repeats a beat name`);
  let prev = -1;
  for (let ms = 0; ms <= beats.reduce((a, [, l]) => a + l, 0); ms += 25) {
    const at = TL.beatAt(beats, ms);
    if (at.k < prev) fail(`timeline: ${name} goes backwards at ${ms} ms`);
    prev = at.k;
  }
}
if (!(TL.INTRO_MS >= 4000 && TL.INTRO_MS <= 6500)) fail(`timeline: intro is ${TL.INTRO_MS} ms — the agreed window is 4–6 s`);
if (!(TL.SORT_MS + TL.HANDOFF_MS >= 2500 && TL.SORT_MS + TL.HANDOFF_MS <= 4000)) fail("timeline: sort + handoff left the agreed 2.5–4 s window");
if (TL.sortReadyAt([{ throw: { at: 1 } }, { throw: null }]) !== null) fail("timeline: the sort may not be ready while a slot is unthrown");
if (TL.sortReadyAt([{ throw: { at: 1000 } }, { throw: { at: 3000 } }]) !== 3000 + TL.THROW_MS + TL.ROLL.settle) fail("timeline: the sort must wait for the LAST throw to land and read");
if (TL.phaseLength("rolling") !== null) fail("timeline: the roll phase waits for people — it has no fixed length");
for (const p of ["intro", "sorting", "handoff"]) if (!(TL.phaseLength(p) > 0)) fail(`timeline: ${p} has no length`);

/* ── 2. secrecy in the state model ───────────────────────────────────── */
const npc = SM.publicSlot({ combatantId: "npc1", isPC: false, name: "Hobgoblin Sniper", maskedName: "Unknown", img: "a.webp", maskedImg: "", kind: { name: "Hobgoblin", level: 3 }, mods: [{ slug: "x", value: 2 }], stats: [{ slug: "perception", mod: 9 }] });
const pc = SM.publicSlot({ combatantId: "pc1", isPC: true, ownerId: "u1", name: "Seri", img: "s.webp", stats: [{ slug: "perception", label: "Perception", mod: 12 }], mods: [{ slug: "scout", label: "Scout", value: 1, enabled: true }] });
if (npc.mods.length || npc.stats.length) fail("secrecy: an NPC slot carries its modifiers or statistics — they give its total away");
if (npc.name !== "Unknown" || npc.img !== "") fail("secrecy: a mystified NPC slot carries its real name or art");
if (SM.publicSlot({ combatantId: "h1", hidden: true, isPC: false })) fail("secrecy: a hidden combatant became a slot");
if (SM.publicSlot({ combatantId: "h2", tokenHidden: true, isPC: true })) fail("secrecy: a combatant on a hidden token became a slot");
const dirty = SM.normalizeState({ id: "seq1", combatId: "cb1", phase: "rolling", at: 5, total: 20, slots: [{ ...npc, total: 17, natural: 12, degree: 3, mods: [{ slug: "x", value: 2 }] }, { ...pc, total: 22 }] });
const leaks = (o) => JSON.stringify(o).match(/"(total|natural|degree|secret)"/g);
if (leaks(dirty)) fail(`secrecy: normalizeState lets ${leaks(dirty).join(", ")} through`);
if (dirty.slots[0].mods.length) fail("secrecy: normalizeState keeps an NPC's modifiers");
const player = { id: "u2", isGM: false }, gm = { id: "g", isGM: true };
if (SM.entitled(player, npc)) fail("secrecy: a player is entitled to an NPC's total before the sort");
if (!SM.entitled(gm, npc) || !SM.entitled(player, pc)) fail("secrecy: the GM must see every total, and the table every PC's");
const full = { seqId: "seq1", slotId: "npc1", seq: 1, at: 10, seed: 5, sealed: false, total: 19, natural: 11, mods: [] };
if (leaks(SM.sealResult(full))) fail("secrecy: a sealed result carries a number");
if (leaks(SM.normalizeResult({ ...full, sealed: true }))) fail("secrecy: normalizeResult keeps a sealed result's total");
if (SM.mayAct(player, npc) || SM.mayAct(player, { ...pc, ownerId: "other" })) fail("authority: a player may act on a slot that is not theirs");
if (!SM.mayAct({ id: "u1", isGM: false }, pc)) fail("authority: the owner cannot act on their own PC");
if (SM.canAdvance("intro", "sorting") || SM.canAdvance("sorting", "rolling") || !SM.canAdvance("rolling", "sorting")) fail("state: canAdvance must allow exactly one step forward");
if (SM.normalizeIntent({ op: "commit", seqId: "s", slotId: "x" })) fail("state: an unknown intent op was accepted");
if (SM.kindKey({ sourceId: "Compendium.a.b.Actor.x", name: "A" }) !== SM.kindKey({ sourceId: "Compendium.a.b.Actor.x", name: "B" })) fail("groups: one compendium entry must be one kind");
if (SM.kindKey({ name: "Goblin", level: 1 }) === SM.kindKey({ name: "Goblin", level: 3 })) fail("groups: a hand-built elite must not share the ordinary creature's card");
const order = SM.orderFrom([{ id: "extra" }, { id: "pc1" }, { id: "npc1" }, { id: "pc1" }], [npc, pc]);
if (order.join() !== "pc1,npc1") fail(`sort: orderFrom must follow combat.turns, skip extra turns and repeats (got ${order})`);
const entries = SM.commitEntries(new Map([["pc1", { total: 20, statistic: "stealth" }]]), [pc, npc], [{ combatantId: "hid", total: 7 }]);
if (entries.length !== 2 || !entries.some((e) => e.id === "hid")) fail("sort: commitEntries must include rolled slots and silently rolled hidden combatants");

/* ── 3. the glue ─────────────────────────────────────────────────────── */
const main = strip(read(`${FEAT}/main.mjs`));
const init = strip(read(`${FEAT}/pf2e-init.mjs`));
for (const m of main.matchAll(/emitSocket\(FEATURE_ID,\s*\{\s*type:\s*MSG\.throw[^;]*;/g)) {
  if (!/recipients/.test(m[0])) fail(`socket: a result is emitted without recipients — ${m[0].slice(0, 80)}`);
}
if (!/onIntent\(payload,\s*meta\.attested\)/.test(main) || !/sync\(meta\.attested\)/.test(main)) fail("socket: intents and syncs must be honoured on meta.attested");
if (/if \(!game\.user\.isGM \|\| !meta\?\.attested\) return;/.test(main) === false) fail("socket: the GM branch must refuse an unattested message");
if (/\.initiative\.roll\(|initiative\?\.roll\(/.test(main + init)) fail("pf2e: ActorInitiative#roll writes the tracker at once — roll its statistic instead");
if (!/statistic\.roll\(/.test(init) || !/createMessage:\s*false/.test(init)) fail("pf2e: initiative must roll through the ActorInitiative statistic with createMessage: false");
if (!/setMultipleInitiatives/.test(init)) fail("pf2e: values must be committed through setMultipleInitiatives (PF2e's tie-break flags)");
if ((main.match(/commitInitiatives\(/g) ?? []).length !== 1) fail("pf2e: commitInitiatives must be called exactly once (one batch)");
if (!/pendCheck/.test(init) || /registerWrapper/.test(init + main)) fail("pf2e: reuse Spotlight Roll's Check.roll wrapper (pendCheck) — libWrapper allows one wrapper per package per target");
const writes = main.match(/flags\.\$\{SUITE_ID\}\.\$\{FLAG\}/g) ?? [];
if (writes.length !== 3) fail(`state: the flag is written outside start/startLate/mutate (${writes.length} write sites)`);
if (!/readState\(combat\)/.test(main.match(/mutate\(combat, fn\) \{[\s\S]*?\n  \},/)?.[0] ?? "")) fail("state: mutate must re-read the flag before writing");
if (!/game\.time\.serverTime \+ CUE_LEAD_MS/.test(main)) fail("timing: cues must be stamped in server time");
if (!/HANDOFF_HOOK/.test(main) || !read("scripts/features/initiative/gluniverse-initiative.mjs").includes("gluniverse.combatIntro.handoff")) fail("handoff: the rail does not listen for the handoff hook");
if (C.HANDOFF_HOOK !== "gluniverse.combatIntro.handoff") fail("handoff: hook name drifted from the rail's");
const rail = read("scripts/features/initiative/gluniverse-initiative.mjs");
if (/from\s+["'][^"']*combat-intro/.test(rail)) fail("rail: the initiative tracker must not import combat-intro (it reaches it through the suite API)");
if (!/canStart\?\.\(/.test(rail) || !/cinematicStart/.test(rail)) fail("rail: the Start button must ask api.canStart and dispatch cinematicStart");
if (!rail.includes("gluniverse.combatIntro.ready")) fail("rail: it must re-render on gluniverse.combatIntro.ready, or the Start button never appears");

// The failure modes a live session found the hard way, each one silent.
if (!/inFlight\.has\(slotId\)/.test(main) || !/inFlight\.add\(slotId\)/.test(main)) fail("rolls: resolve must guard in-flight slots — a double-click or a racing volley rolls twice");
if (!/Hooks\.on\("deleteCombatant"/.test(main) || !/dropCombatant/.test(main)) fail("rolls: a combatant deleted mid-sequence must drop its slot, or the sort never becomes ready");
if (!/MSG\.throw\) return game\.users\.get\(meta\?\.attested\)\?\.isGM/.test(main)) fail("socket: a result must come from a GM's client (attested), or a forged high seq locks the real one out");
if (!/state\.phase !== "handoff"\) return;/.test(main)) fail("finish: startCombat may run only from the handoff phase");
if (!/initiative == null\);\s*\n?\s*if \(fresh\.length\)/.test(main)) fail("late: re-check initiative when the batch fires — PF2e rolls a fromActor combatant right after creating it");
if (!/vis\.mystery \? \{ name: `mystery-/.test(main)) fail("secrecy: a mystified creature's kind key must not carry its name or compendium source");

/* ── 4. purity ───────────────────────────────────────────────────────── */
const PURE = ["constants.mjs", "timeline.mjs", "state-model.mjs", "director.mjs", "overlay.mjs", "backdrop.mjs", "sound.mjs", "skins/index.mjs", "skins/etched.mjs", "skins/aegis.mjs", "skins/aegis-glsl.mjs", "skins/aegis-scramble.mjs"];
for (const f of PURE) {
  const src = strip(read(`${FEAT}/${f}`));
  // `canvas` alone is a fine local name for an HTMLCanvasElement; Foundry's is reached through its members.
  const hit = src.match(/\b(game|foundry|ui|Hooks|CONFIG|fromUuid|fromUuidSync)\s*[.?(]/) ?? src.match(/\b(canvas)\.(scene|tokens|stage|app|ready|grid|dimensions|primary|interface)\b/);
  if (hit) fail(`purity: ${f} reaches ${hit[1]} — the preview and this tool import it with no Foundry behind it`);
  try { await imp(`${FEAT}/${f}`); } catch (e) { fail(`purity: ${f} does not import under Node (${e.message})`); }
}

/* ── 5. skins, uniforms, sounds ──────────────────────────────────────── */
const { SKIN_MODULES, skinFor } = await imp(`${FEAT}/skins/index.mjs`);
const BD = await imp(`${FEAT}/backdrop.mjs`);
const DR = await imp(`${FEAT}/director.mjs`);
if (Object.keys(SKIN_MODULES).sort().join() !== [...C.SKINS].sort().join()) fail("skins: SKIN_MODULES and SKINS disagree");
if (skinFor("nonsense")?.id !== C.DEFAULT_SKIN) fail("skins: an unknown skin must fall back to the default");
const declared = (src) => new Set([...src.matchAll(/\buniform\s+\w+\s+(\w+)/g)].map((m) => m[1]));
const preludeNames = declared(BD.PRELUDE);
for (const n of BD.PRELUDE_UNIFORMS) if (!preludeNames.has(n)) fail(`backdrop: PRELUDE_UNIFORMS lists ${n} but the prelude does not declare it`);
const dirSrc = strip(read(`${FEAT}/director.mjs`));
for (const n of BD.PRELUDE_UNIFORMS) if (!dirSrc.includes(n)) fail(`director: prelude uniform ${n} is never written`);
for (const [id, skin] of Object.entries(SKIN_MODULES)) {
  for (const k of ["id", "fragment", "uniforms", "write", "SHED_ORDER", "sounds"]) if (skin[k] == null) fail(`skins: ${id} has no ${k}`);
  if (skin.id !== id) fail(`skins: ${id} reports id ${skin.id}`);
  const names = new Set(skin.uniforms.map((u) => u.name));
  for (const n of names) if (preludeNames.has(n)) fail(`skins: ${id} redeclares prelude uniform ${n} (a duplicate declaration fails to compile)`);
  for (const n of declared(skin.fragment)) if (!names.has(n) && !preludeNames.has(n)) fail(`skins: ${id}'s fragment declares ${n}, which is not in its uniforms list`);
  const frag = strip(skin.fragment);
  for (const n of names) if (!new RegExp(`\\b${n}\\b`).test(frag.replace(/\buniform\s+\w+\s+\w+(\[\d+\])?\s*;/g, ""))) fail(`skins: ${id} declares ${n} but its fragment never reads it`);
  const allNames = [...C.PHASES];
  for (let pi = 0; pi < allNames.length; pi++) {
    for (const allow of [true, false]) {
      const u = {};
      const f = {
        phase: pi, beat: 1, beatT: 0.5, phaseT: 0.5, time: 12.5, dpr: 2, width: 1920, height: 1080, beatName: "roster", severity: 3,
        anchors: new Float32Array(48), anchorFx: new Float32Array(48), curves: {}, allows: () => allow,
        palette: { accent: [1, 0, 0], hot: [1, 1, 1], ink: [0, 0, 0], warn: [1, 0.8, 0] },
      };
      try { skin.write(u, f); } catch (e) { fail(`skins: ${id}.write threw (${e.message})`); break; }
      const wrote = new Set(Object.keys(u));
      for (const n of names) if (!wrote.has(n)) fail(`skins: ${id} never writes ${n} (phase ${allNames[pi]}) — it would hold its first value forever`);
      for (const n of wrote) if (!names.has(n)) fail(`skins: ${id} writes ${n}, which it never declares`);
      for (const [n, v] of Object.entries(u)) {
        const flat = typeof v === "number" ? [v] : [...v];
        if (flat.some((x) => !Number.isFinite(x))) fail(`skins: ${id} writes a non-finite ${n}`);
      }
    }
  }
  const order = DR.shedOrderFor(skin);
  if (order.at(-1) !== "backdrop") fail(`shed: ${id}'s ladder must shed the whole backdrop last`);
  for (const s of skin.SHED_ORDER) if (!order.includes(s)) fail(`shed: ${id}'s ${s} is missing from its ladder`);
  if (!skin.SHED_ORDER.length) fail(`shed: ${id} has nothing to shed before the whole backdrop`);
  for (const cue of C.CUES) {
    const p = skin.sounds?.[cue];
    if (!p) fail(`sound: ${id} has no file for cue ${cue} (a silent beat)`);
    else if (!existsSync(join(ROOT, p))) fail(`sound: ${id}'s ${cue} points at a missing file ${p}`);
  }
}
for (const s of DR.SHED_ORDER) if (!/\.allows\(/.test(dirSrc)) { fail("shed: the director never asks the ladder"); break; }

/* ── 6. CSS: skins scoped, tokens respected ──────────────────────────── */
const SHEETS = { "styles/combat-intro.css": null, "styles/combat-intro-aegis.css": /\.glci\[data-skin="aegis"\]/, "styles/initiative-aegis.css": /\[data-gl-skin="aegis"\]/ };
for (const [css, scope] of Object.entries(SHEETS)) {
  if (!existsSync(join(ROOT, css))) { fail(`css: ${css} missing`); continue; }
  const src = read(css).replace(/\/\*[\s\S]*?\*\//g, "");
  if (/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(src)) fail(`css: ${css} uses a raw white veil — use rgb(var(--gl-tint-light) / a)`);
  if (/@font-face|@import\s+url\(['"]?http/.test(src)) fail(`css: ${css} declares a font or a network import`);
  if (/@media[^{]*prefers-reduced-motion/.test(src)) fail(`css: ${css} honours prefers-reduced-motion — the suite does not`);
  for (const m of src.matchAll(/@keyframes\s+([\w-]+)/g)) if (!/^(glci-|gluni-)/.test(m[1])) fail(`css: @keyframes ${m[1]} in ${css} needs a feature prefix (names are global)`);
  for (const m of src.matchAll(/(--[\w-]+)\s*:\s*var\(\1\)/g)) fail(`css: ${css} has a self-referential ${m[1]}`);
  if (/(^|[\s,}]):root\b/.test(src)) fail(`css: ${css} writes on :root — a skin stays on its feature's root (ADR 0001)`);
  if (scope) {
    /** Split a selector list on its TOP-LEVEL commas (not those inside :is()/:where()/:not()). */
    const splitSel = (list) => { const out = []; let depth = 0, cur = ""; for (const ch of list) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
    const flat = src.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    for (const m of flat.matchAll(/(^|})\s*([^{}@]+)\{/g)) {
      for (const sel of splitSel(m[2])) {
        if (!scope.test(sel)) fail(`css: ${css} rule "${sel.slice(0, 70)}" is not under the skinned feature root`);
      }
    }
    for (const m of flat.matchAll(/@(media|supports|container)[^{]*\{([\s\S]*?\})\s*\}/g)) {
      for (const r of m[2].matchAll(/([^{}]+)\{/g)) for (const sel of splitSel(r[1])) if (!scope.test(sel)) fail(`css: ${css} rule "${sel.slice(0, 70)}" inside @${m[1]} is not scoped`);
    }
  }
}
// The four :root-resolved derivations do not follow a scoped accent.
for (const css of ["styles/combat-intro-aegis.css", "styles/initiative-aegis.css"]) {
  const src = read(css).replace(/\/\*[\s\S]*?\*\//g, "");
  const hit = src.match(/var\(--gl-(glow|bloom|accent-soft|accent-faint)\)/);
  if (hit) fail(`css: ${css} reads --gl-${hit[1]}, which resolves at :root and paints the suite blue under Aegis — strike it with color-mix()`);
}
// Aegis danger must not share the skin's red.
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((x) => x / 255); };
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
/** Perceptual (OKLCH) hue in degrees — HSV hue badly understates how far red is from amber. */
const hue = (rgb) => {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * q, B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * q;
  return (Math.atan2(B, A) * 180 / Math.PI + 360) % 360;
};
const lum = (rgb) => { const [r, g, b] = rgb.map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ia = read("styles/initiative-aegis.css");
const accent = ia.match(/--gl-accent:\s*(#[0-9a-f]{6})/i)?.[1], amber = ia.match(/--gluni-aegis-amber:\s*(#[0-9a-f]{6})/i)?.[1];
if (!accent || !amber) fail("css: initiative-aegis.css must state its accent and its amber danger colour");
else {
  const dh = Math.abs(hue(hex(accent)) - hue(hex(amber))), dl = Math.abs(lum(hex(accent)) - lum(hex(amber)));
  if (Math.min(dh, 360 - dh) < 45 && dl < 0.35) fail(`css: Aegis danger ${amber} is too close to its accent ${accent} (need ≥45° hue or ≥0.35 luminance)`);
}
for (const v of ["--gluni-break:", "--gluni-dying:"]) if (!new RegExp(`${v}\\s*var\\(--gluni-aegis-amber\\)`).test(ia)) fail(`css: under Aegis ${v} must move to the amber danger colour`);
const ca = read("styles/combat-intro-aegis.css");
for (const v of ["--glci-accent", "--glci-hot", "--glci-ink", "--glci-warn"]) if (!new RegExp(`${v}\\s*:`).test(ca)) fail(`css: combat-intro-aegis.css does not remap ${v}, which the GL palette reads`);
for (const v of ["--glci-accent", "--glci-hot", "--glci-ink", "--glci-warn"]) if (!new RegExp(`${v}\\s*:`).test(read("styles/combat-intro.css"))) fail(`css: combat-intro.css does not define ${v}`);
// The DOM skeleton in docs/COMBAT_INTRO.md is a contract: every class there is
// emitted by the overlay and styled by the base sheet. A rename on either side
// deletes a piece of the sequence with nothing reported.
const ov = read(`${FEAT}/overlay.mjs`) + read(`${FEAT}/director.mjs`);
const baseCss = read("styles/combat-intro.css");
const skeleton = read("docs/COMBAT_INTRO.md").match(/### DOM skeleton[\s\S]*?```([\s\S]*?)```/)?.[1] ?? "";
if (!skeleton) fail("docs: the DOM skeleton block is missing from docs/COMBAT_INTRO.md");
for (const cls of new Set([...skeleton.matchAll(/\.(glci-[a-z0-9-]+)/g)].map((m) => m[1]))) {
  if (!ov.includes(cls)) fail(`dom: .${cls} is in the contract but the overlay never emits it`);
  if (!baseCss.includes(`.${cls}`)) fail(`css: .${cls} is in the contract but combat-intro.css never styles it`);
}
for (const m of baseCss.matchAll(/\.gl-btn[^{]*\{/g)) void m;
if (!/\.glci-(gm-btn|chip|roll)[^{]*\{[^}]*font-size/.test(baseCss)) fail("css: the overlay's buttons need their own font-size (.gl-btn takes the host's)");

/* ── 7. i18n ─────────────────────────────────────────────────────────── */
const lang = JSON.parse(read("lang/combat-intro.en.json"));
const initLang = JSON.parse(read("lang/initiative.en.json"));
const flatten = (o, p = "", out = new Set()) => { for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (v && typeof v === "object") flatten(v, key, out); else out.add(key); } return out; };
const have = new Set([...flatten(lang), ...flatten(initLang)]);
const want = new Set();
for (const f of ["main.mjs", "index.mjs", "overlay.mjs", "director.mjs", "pf2e-init.mjs"]) {
  for (const m of read(`${FEAT}/${f}`).matchAll(/["'`](GLCI\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) want.add(m[1]);
}
const OV = (await imp(`${FEAT}/overlay.mjs`)).default;
for (const [prefix, list] of Object.entries(OV.I18N_DYNAMIC)) for (const k of list) want.add(`${prefix}.${k}`);
for (const s of C.SEVERITIES) want.add(`GLCI.threat.${s}`);
for (const skin of C.SKINS) for (const line of C.INTRO_LINES[skin]) want.add(`GLCI.intro.${skin}.${line}`);
for (const cue of C.CUES) { want.add(`GLCI.settings.sound.${cue}.name`); want.add(`GLCI.settings.sound.${cue}.hint`); want.add(`GLCI.cue.${cue}`); }
want.add("GLUNI.Unknown");
for (const prefix of Object.keys(OV.I18N_DYNAMIC)) want.delete(prefix);   // a family's name, not a key
for (const k of want) if (!have.has(k)) fail(`i18n: missing key ${k}`);
if (lang.GLCI?.intro?.aegis?.eyebrow !== "BLEED EVENT" && !have.has("GLCI.intro.aegis.eyebrow")) fail("i18n: the Aegis eyebrow was agreed as BLEED EVENT");

/* ── 8. registration ─────────────────────────────────────────────────── */
const idx = read(`${FEAT}/index.mjs`);
if (!/system:\s*"pf2e"/.test(idx)) fail("adapter: system must be pf2e");
if (!/requires:\s*\[DSN_ID\]/.test(idx)) fail("adapter: must require dice-so-nice");
if (!/requiresFeature:\s*"initiative"/.test(idx)) fail("adapter: must require the initiative feature (its rail carries the Start button and the skin)");
if (C.PREFIX !== "ci.") fail("adapter: setting prefix changed — world settings would be orphaned");
for (const k of Object.values(C.SETTINGS)) if (!k.startsWith(C.PREFIX)) fail(`adapter: setting ${k} is outside the ci. prefix`);
if (!C.SOUND_PREFIX.startsWith(C.PREFIX)) fail("adapter: the sound settings are outside the ci. prefix");
if (C.SKIN_SETTING !== "init.skin") fail("skins: the skin is the initiative feature's setting — never register a second one");
if (/SKIN_SETTING\s*,\s*\{/.test(main) || /register\([^)]*init\.skin/.test(main)) fail("skins: combat-intro registers the skin setting itself");
const roster = read("scripts/features/index.mjs");
if (roster.indexOf("./combat-intro/index.mjs") < roster.indexOf("./initiative/index.mjs")) fail("adapter: combat-intro must be imported after initiative (requiresFeature)");
if (!read("docs/FEATURE_CONTRACT.md").includes("| combat-intro")) fail("adapter: combat-intro is missing from the FEATURE_CONTRACT prefix matrix");
const mj = JSON.parse(read("module.json"));
for (const p of ["styles/combat-intro.css", "styles/combat-intro-aegis.css", "styles/initiative-aegis.css"]) if (!mj.styles.includes(p)) fail(`module.json: ${p} not loaded`);
if (mj.styles.indexOf("styles/combat-intro-aegis.css") < mj.styles.indexOf("styles/combat-intro.css")) fail("module.json: the Aegis sheet must load after the base sheet");
if (mj.styles.indexOf("styles/initiative-aegis.css") < mj.styles.indexOf("styles/initiative.css")) fail("module.json: initiative-aegis.css must load after initiative.css");
if (!mj.languages.some((l) => l.path === "lang/combat-intro.en.json")) fail("module.json: lang/combat-intro.en.json not loaded");
if (!existsSync(join(ROOT, "docs/adr/0001-scoped-skins.md"))) fail("docs: the scoped-skin ADR is missing");

/* ── report ─────────────────────────────────────────────────────────── */
if (problems.length) {
  console.log(`combat-intro-check: ${problems.length} problem(s)`);
  for (const p of problems) console.log("  ✗ " + p);
  process.exit(1);
}
console.log("combat-intro-check: OK");
