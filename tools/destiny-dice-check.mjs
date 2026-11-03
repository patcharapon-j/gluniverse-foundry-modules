#!/usr/bin/env node
/**
 * Destiny Dice — consistency check. Everything here fails silently in Foundry:
 *
 *   • a dynamic i18n key (`GLDDF.Preset.<id>.<kind>`, `GLDDF.Degree.<key>`,
 *     `GLDDF.Fate.Kind.<kind>`) that is missing prints the key in chat;
 *   • a setting read that was never registered reads undefined, and one
 *     registered and never read is a control that does nothing;
 *   • a preset tone with no `[data-tone]` rule, no token or no palette entry
 *     paints the strip one colour and bakes the die another;
 *   • a Dice So Nice preset whose colorset, system or type disagrees with the
 *     roll's tag draws the user's own dice; a face URL that fails DSN's
 *     extension test prints the URL on the die; a glow of 0 that still sends an
 *     emissive keeps the bloom pass on;
 *   • a bump field that leaves the transmission band makes the glass opaque;
 *   • the degree shift disagreeing with PF2e's own DegreeOfSuccess prints a
 *     result the card does not have;
 *   • a second road to a fate puts two dice on one check;
 *   • a pure module that reaches the world breaks the preview, which then
 *     flatters a copy nobody ships.
 *
 *   node tools/destiny-dice-check.mjs
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEAT = join(ROOT, "scripts/features/destiny-dice");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const problems = [];
const fail = (msg) => problems.push(msg);
let checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) fail(msg); };
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

const C = await imp("scripts/features/destiny-dice/constants.mjs");
const F = await imp("scripts/features/destiny-dice/faces.mjs");
const G = await imp("scripts/features/destiny-dice/glyphs.mjs");
const R = await imp("scripts/features/destiny-dice/raster.mjs");
const FT = await imp("scripts/features/destiny-dice/fate.mjs");
const V = await imp("scripts/features/destiny-dice/view.mjs");
const S = await imp("scripts/features/destiny-dice/settings.mjs");
const D = await imp("scripts/features/destiny-dice/dsn.mjs");
const { PALETTE } = await imp("scripts/core/theme.mjs");
const { DEGREE_KEYS } = await imp("scripts/core/pf2e-degree.mjs");

const lang = { ...JSON.parse(read("lang/en.json")), ...JSON.parse(read("lang/destiny-dice.en.json")) };
const css = read("styles/destiny-dice.css");
const tokens = read("styles/gl-tokens.css");
const sources = Object.fromEntries(readdirSync(FEAT).filter((f) => f.endsWith(".mjs")).map((f) => [f, readFileSync(join(FEAT, f), "utf8")]));

/* ── 1. i18n ─────────────────────────────────────────────────────────── */
{
  const literal = new Set();
  for (const src of Object.values(sources)) for (const m of src.matchAll(/["'`](GLDDF\.[A-Za-z0-9.-]+|GLS\.feature\.destiny-dice\.[a-z]+)["'`]/g)) literal.add(m[1]);
  for (const key of literal) ok(key in lang, `i18n: literal key ${key} is missing`);
  for (const id of C.PRESET_IDS) {
    ok(C.PRESETS[id].name in lang, `i18n: preset name ${C.PRESETS[id].name} missing`);
    for (const kind of C.FATE_KINDS) {
      const key = V.labelKeyOf(id, kind);
      ok(key === `GLDDF.Preset.${id}.${kind}`, `i18n: preset ${id} labels ${kind} as ${key}, outside the GLDDF.Preset family`);
      ok(key in lang, `i18n: dynamic key ${key} missing`);
    }
  }
  for (const k of DEGREE_KEYS) ok(V.degreeLabelKey(k) in lang, `i18n: dynamic key ${V.degreeLabelKey(k)} missing`);
  for (const kind of C.FATE_KINDS) ok(`GLDDF.Fate.Kind.${kind}` in lang, `i18n: GLDDF.Fate.Kind.${kind} missing (setting choices)`);
  // Every key the view asks for, by driving it with a recording translator.
  const asked = new Set();
  const t = (k) => { asked.add(k); return k; };
  for (const id of C.PRESET_IDS) {
    V.faceConfigModel({ faces: F.resolveFaces(() => undefined), preset: id, t });
    for (const kind of C.FATE_KINDS) V.fateModel(FT.normalizeFate({ face: 1, kind, bonus: 2, before: "failure", after: "success", accepted: false }), { preset: id, t, seesOutcome: true });
  }
  V.renderFatedToggle({ t });
  for (const k of asked) ok(k in lang, `i18n: the view asks for ${k}, which is missing`);
  // The strip's placeholders are filled.
  ok(/\{face\}/.test(lang["GLDDF.Strip.Kicker"]), "i18n: GLDDF.Strip.Kicker lost its {face}");
  ok(/\{value\}/.test(lang["GLDDF.Config.Mean"]), "i18n: GLDDF.Config.Mean lost its {value}");
}

/* ── 2. settings: read vs registered ─────────────────────────────────── */
{
  const registered = new Map();
  const menus = new Map();
  class AppV2 {}
  globalThis.foundry = { applications: { api: { ApplicationV2: AppV2 } } };
  globalThis.game = {
    settings: {
      register: (scope, key, opts) => { ok(scope === C.MODULE_ID, `settings: ${key} registered under ${scope}`); registered.set(key, opts); },
      registerMenu: (scope, key, opts) => menus.set(key, opts),
      get: () => undefined,
    },
  };
  S.registerSettings();
  const keys = new Set(S.REGISTERED_KEYS);
  for (const k of keys) ok(registered.has(k), `settings: ${k} is read but never registered`);
  for (const k of registered.keys()) {
    ok(keys.has(k), `settings: ${k} is registered but nothing reads it`);
    ok(k.startsWith("dd."), `settings: ${k} lacks the dd. prefix`);
    const o = registered.get(k);
    for (const f of ["name", "hint"]) if (o[f]) ok(o[f] in lang, `settings: ${k}.${f} ${o[f]} missing`);
    for (const label of Object.values(o.choices ?? {})) ok(label in lang, `settings: ${k} choice ${label} missing`);
  }
  const menu = menus.get(S.FACE_CONFIG_MENU);
  ok(!!menu, "settings: the face config menu is not registered (the faces would be reachable only from the console)");
  ok(menu?.type && menu.type.prototype instanceof AppV2, "settings: the face config menu type is not an ApplicationV2 subclass");
  for (const f of ["name", "label", "hint"]) ok(menu?.[f] in lang, `settings: menu ${f} missing`);
  // Every SETTINGS.x a source reads exists.
  for (const [file, src] of Object.entries(sources)) for (const m of src.matchAll(/SETTINGS\.(\w+)/g)) ok(m[1] in S.SETTINGS, `settings: ${file} reads SETTINGS.${m[1]}, which does not exist`);
  // The action handlers the window draws.
  const html = V.renderFaceConfig(V.faceConfigModel({ faces: F.resolveFaces(() => undefined), preset: "default" }));
  for (const m of html.matchAll(/data-action="(\w+)"/g)) ok(new RegExp(`${m[1]}:\\s*DestinyFaceConfig\\.#`).test(sources["settings.mjs"]), `config: data-action ${m[1]} has no handler`);
  // Every form field the window draws is one facesFromForm reads.
  const names = [...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
  const back = V.facesFromForm(Object.fromEntries(names.map((n) => [n, n.endsWith(".kind") ? "complication" : n.endsWith(".bonus") ? "3" : "x.png"])));
  ok(back.every((f) => f.kind === "complication" && f.bonus === "3" && f.image === "x.png"), "config: a field the window draws is not read back by facesFromForm");
  delete globalThis.game;
  delete globalThis.foundry;
}

/* ── 3. faces ────────────────────────────────────────────────────────── */
{
  const resolved = F.resolveFaces(() => undefined);
  for (const f of resolved) ok(f.kind === C.DEFAULT_FACES[f.face].kind && f.bonus === C.DEFAULT_FACES[f.face].bonus, `faces: unset face ${f.face} does not read as the printed die`);
  ok(F.normalizeKind("tyranny") === C.KIND_COMPLICATION && F.normalizeKind("defiance") === C.KIND_OPPORTUNITY, "faces: legacy kind aliases broken");
  ok(F.normalizeKind("nonsense") === C.KIND_BLANK, "faces: unknown kind does not read as blank");
  ok(F.bonusFor(C.KIND_OPPORTUNITY, 4) === 0, "faces: an opportunity carries a bonus");
  ok(F.normalizeBonus("") === 0 && F.normalizeBonus("x") === 0 && F.normalizeBonus(99) === F.BONUS_MAX, "faces: bonus normalizer");
  for (const p of C.LEGACY_IMAGE_PATHS) ok(F.normalizeImage(p) === "", `faces: shipped art path ${p} does not clear to "follow the preset"`);
  ok(F.normalizeImage(" worlds/x/a.png ") === "worlds/x/a.png", "faces: a real custom image is lost");
  const custom = F.resolveFace(3, (k) => ({ "dd.face3Kind": "complication", "dd.face3Bonus": 1 })[k]);
  ok(custom.kind === "complication" && custom.bonus === 1, "faces: a configured face is not read");
}

/* ── 4. tones: one statement for the die and the card ────────────────── */
const oklab = (hex) => {
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = R.rgbOf(hex).map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const dist = (a, b) => Math.hypot(...oklab(a).map((v, i) => v - oklab(b)[i]));
{
  for (const id of C.PRESET_IDS) {
    for (const kind of C.FATE_KINDS) {
      const tone = C.PRESETS[id].tones[kind];
      ok(tone in PALETTE, `tones: ${id}/${kind} names ${tone}, which is not in PALETTE (the die would bake white)`);
      const token = C.TONE_TOKENS[tone];
      ok(!!token, `tones: ${tone} has no token in TONE_TOKENS`);
      ok(token && new RegExp(`${token}:`).test(tokens), `tones: ${token} is not declared in gl-tokens.css`);
      ok(new RegExp(`\\[data-tone="${tone}"\\]\\s*\\{\\s*--glddf-tone:\\s*var\\(${token}\\)`).test(css), `tones: destiny-dice.css has no [data-tone="${tone}"] rule reading ${token}`);
    }
    const t = C.PRESETS[id].tones;
    const [o, c, b] = [PALETTE[t.opportunity], PALETTE[t.complication], PALETTE[t.blank]];
    ok(dist(o, c) > 0.15, `tones: ${id} opportunity and complication are too close to tell apart (${dist(o, c).toFixed(3)})`);
    ok(dist(o, b) > 0.1 && dist(c, b) > 0.1, `tones: ${id} a result tone sits on the blank tone`);
  }
}

/* ── 5. raster: the transmission band and the face ───────────────────── */
{
  const specs = [
    F.glyphSpec({ kind: "opportunity" }), F.glyphSpec({ kind: "blank", bonus: 0 }), F.glyphSpec({ kind: "complication", bonus: 0 }),
    ...Array.from({ length: 19 }, (_, i) => i - 9).filter((n) => n !== 0).map((n) => F.glyphSpec({ kind: "complication", bonus: n })),
  ];
  const SIZE = 96; // the geometry is resolution-free; a small bake keeps the check fast
  for (const spec of specs) {
    const shapes = G.glyphShapes(spec);
    if (spec.mark === "number") ok(shapes.strokes.length > 0 && [...spec.text].every((ch) => G.glyphShapes({ mark: "number", text: ch }).strokes.length > 0), `glyphs: ${spec.text} has a character with no strokes`);
    const maps = R.bakeFace(spec, { tone: "#ff0000", size: SIZE });
    const between = R.bandShare(maps.bump, R.SOLID_FLOOR, R.GLASS_TOP);
    ok(between < 0.12, `raster: ${spec.key} leaves ${(between * 100).toFixed(1)}% of its face half-transmissive (between ${R.SOLID_FLOOR} and ${R.GLASS_TOP})`);
    const glass = R.bandShare(maps.bump, R.GLASS_TOP, 1.01);
    ok(glass > 0.5, `raster: only ${(glass * 100).toFixed(1)}% of ${spec.key} is glass: the die would read as a solid`);
    const extent = R.markExtent(maps.label, SIZE);
    ok(extent <= G.SAFE + G.STROKE + 0.04, `raster: ${spec.key} paints out to ${extent.toFixed(2)}, past the bevel-safe ${G.SAFE}`);
    if (spec.mark === "none") ok(R.markExtent(maps.label, SIZE) === 0, "raster: a blank face paints something");
    else ok(extent > 0.2, `raster: ${spec.key} paints nothing`);
    // The glyph is solid where it is painted.
    let solid = true;
    for (let i = 0; i < maps.label.length; i += 4) if (maps.label[i + 3] > 250 && maps.bump[i] / 255 > R.SOLID_FLOOR) { solid = false; break; }
    ok(solid, `raster: ${spec.key} paints a glyph over glass instead of cutting it solid`);
    const svgPaths = (G.glyphSvg(spec).match(/<path /g) ?? []).length;
    ok(svgPaths === shapes.strokes.length + shapes.polygons.length, `glyphs: ${spec.key} draws ${svgPaths} paths in chat and ${shapes.strokes.length + shapes.polygons.length} on the die`);
  }
  const custom = R.bakeFace(F.glyphSpec({ kind: "blank" }), { custom: true, size: SIZE });
  ok(R.bandShare(custom.bump, 0, R.SOLID_FLOOR) > 0.99, "raster: a custom-image face is not solid, so the GM's art would smear into the glass");
}

/* ── 6. Dice So Nice agreement ───────────────────────────────────────── */
{
  const encode = () => "data:image/png;base64,AAAA";
  const table = F.resolveFaces(() => undefined);
  const lit = D.buildPreset({ faces: table, preset: "default", intensity: 1.2, encode });
  const dark = D.buildPreset({ faces: table, preset: "default", intensity: 0, encode });
  const cs = D.colorset();
  ok(lit.type === `d${C.FATE_DIE_DENOMINATION}`, "dsn: preset type is not the fate die's denomination");
  ok(lit.colorset === C.DSN_COLORSET && cs.name === C.DSN_COLORSET, "dsn: preset and colorset name disagree");
  ok(lit.system === C.DSN_NAMESPACE, "dsn: preset system is not ours");
  for (const f of ["name", "description", "category"]) ok(typeof cs[f] === "string" && cs[f], `dsn: colorset has no ${f} (DSN registers it under "undefined" or breaks its own settings dialog)`);
  ok(cs.material === "glass", "dsn: the body is not glass, so the bump map is not the transmission mask the faces are baked for");
  for (const p of [lit, dark]) {
    for (const list of ["labels", "bumpMaps"]) {
      ok(p[list].length === 6, `dsn: ${list} has ${p[list].length} entries, not 6`);
      for (const u of p[list]) ok(D.IMAGE_TEST.test(u), `dsn: ${list} entry fails DSN's image test and would print as text`);
    }
  }
  ok(lit.emissiveMaps?.length === 6 && lit.emissiveMaps.every((u) => D.IMAGE_TEST.test(u)) && lit.emissiveIntensity === 1.2 && lit.emissive === 0xffffff, "dsn: a lit die does not carry six emissive maps at its intensity");
  ok(!dark.emissiveMaps && dark.emissive === 0 && !("emissiveIntensity" in dark), "dsn: glow 0 still sends an emissive (DSN ignores intensity 0 and keeps the bloom pass on)");
  const customised = D.buildPreset({ faces: table.map((f) => f.face === 6 ? { ...f, image: "worlds/a/six.png" } : f), preset: "default", intensity: 1, encode });
  ok(customised.labels[5] === "worlds/a/six.png", "dsn: a custom face image is not used as that face's label");
  const dsn = stripComments(sources["dsn.mjs"]);
  ok(/addDicePreset\(\s*preset\s*,\s*"d6"\s*\)/.test(dsn), "dsn: addDicePreset is not given the d6 shape (DSN reads .shape off undefined for a custom term)");
  ok(/preloadPresets\(\s*DSN_NAMESPACE\s*\)/.test(dsn), "dsn: the preset is not warmed (sixty serial loads mid-throw)");
  ok(/ownsFateDie\(\)/.test(dsn), "dsn: registers a look for dz even when another package owns it");
  const apply = stripComments(sources["apply.mjs"]);
  ok(/colorset:\s*DSN_COLORSET/.test(apply) && /system:\s*DSN_NAMESPACE/.test(apply), "dsn: the fate roll is not tagged with our colorset and system");
}

/* ── 7. degree shift = PF2e's DegreeOfSuccess ────────────────────────── */
{
  // A restatement of PF2e 8.x's class, written from its source, not from fate.mjs.
  const pf2e = (total, dc, die, adj) => {
    const step = (v, a) => Math.max(0, Math.min(3, v + a));
    const byDie = (v) => (die === 20 ? step(v, 1) : die === 1 ? step(v, -1) : v);
    const u = total - dc >= 10 ? byDie(3) : dc - total >= 10 ? byDie(0) : total >= dc ? byDie(2) : byDie(1);
    if (!adj) return u;
    for (const n of ["all", ...DEGREE_KEYS]) {
      const { label, amount } = adj[n] ?? {};
      if (amount && label && !(u === 3 && amount === 1) && !(u === 0 && amount === -1) && (n === "all" || DEGREE_KEYS.indexOf(n) === u)) {
        return typeof amount === "string" ? DEGREE_KEYS.indexOf(amount) : step(u, amount);
      }
    }
    return u;
  };
  const adjs = [null, { success: { label: "J", amount: 1 } }, { all: { label: "I", amount: -1 } }, { failure: { label: "P", amount: "success" } }];
  let n = 0;
  for (const adj of adjs) for (let dc = 10; dc <= 30; dc += 5) for (let total = dc - 14; total <= dc + 14; total++) for (const die of [1, 10, 20]) for (const bonus of [0, 2, 4, -2]) {
    const got = FT.shiftDegree({ total, bonus, dc, natural: die, dosAdjustments: adj });
    n++;
    if (got.before !== DEGREE_KEYS[pf2e(total, dc, die, adj)] || got.after !== DEGREE_KEYS[pf2e(total + bonus, dc, die, adj)]) {
      fail(`degree: total ${total}${bonus >= 0 ? "+" : ""}${bonus} vs DC ${dc}, d20 ${die}, ${JSON.stringify(adj)} gave ${got.before}→${got.after}`);
      break;
    }
  }
  checks += n;
  ok(FT.shiftDegree({ total: 10, bonus: 4, dc: NaN, natural: 10 }) === null, "degree: a check with no DC claims a shift");
  ok(FT.naturalOf({ terms: [{ class: "Die", faces: 20, results: [{ result: 7, active: false, discarded: true }, { result: 15, active: true }] }] }) === 15, "degree: keep-higher natural is not the kept die");
}

/* ── 8. stored fates ─────────────────────────────────────────────────── */
{
  const old = FT.normalizeFate({ face: 2, kind: "tyranny", bonus: 2, accepted: null, appliedAt: 5 });
  ok(old && old.kind === "complication" && old.before === null && old.accepted === null, "fate: a standalone-era flag does not read");
  ok(FT.normalizeFate({ face: 3, kind: "blank", accepted: false }).accepted === false, "fate: a refused fate stops reading as refused");
  ok(FT.normalizeFate({ face: 9 }) === null && FT.normalizeFate(null) === null && FT.normalizeFate("x") === null, "fate: garbage reads as a fate");
  ok(FT.normalizeFate({ face: 1, kind: "complication", before: "nope", after: "success" }).before === null, "fate: an unknown degree survives normalisation");
}

/* ── 9. what one viewer sees ─────────────────────────────────────────── */
{
  const fate = FT.normalizeFate({ face: 1, kind: "complication", bonus: 4, before: "failure", after: "success" });
  const t = (k) => (k === "GLDDF.Preset.default.complication" ? "<img src=x onerror=alert(1)>" : k);
  const player = V.renderFateStrip(V.fateModel(fate, { preset: "default", t, seesOutcome: false }));
  const gm = V.renderFateStrip(V.fateModel(fate, { preset: "default", t, seesOutcome: true }));
  ok(!/glddf-fate-shift/.test(player), "view: the shift line is drawn for a viewer who may not see the outcome");
  ok(/glddf-fate-shift/.test(gm), "view: the shift line is missing for a viewer who may see the outcome");
  ok(!/<img/.test(gm), "view: a label is printed unescaped");
  ok(!/\bdc\b|DC/.test(V.renderFateStrip(V.fateModel(fate, { seesOutcome: true }))), "view: the strip names a DC");
  const result = stripComments(sources["fate-result.mjs"]);
  ok(/isContentVisible\s*===\s*false/.test(result), "view: a strip is drawn on a message this viewer may not read");
  ok(/metagame\?\.results/.test(result), "view: the shift is not gated on PF2e's show-outcomes setting");
  const apply = stripComments(sources["apply.mjs"]);
  ok(/showForRoll\([^)]*whisper[^)]*message\.blind/.test(apply), "privacy: the fate die is shown wider than the check's audience");
}

/* ── 10. one road to a fate ──────────────────────────────────────────── */
{
  const integ = stripComments(sources["pf2e-integration.mjs"]);
  ok(!/Check\.roll\s*=|rerollFromMessage\s*=/.test(integ), "roads: PF2e's Check methods are replaced again (two roads to one fate, and a clash with Spotlight Roll's libWrapper)");
  ok(!/pf2e\.reroll/.test(integ), "roads: the pf2e.reroll hook is back (a third road for hero point rerolls)");
  const calls = Object.entries(sources).flatMap(([f, s]) => [...stripComments(s).matchAll(/\bapplyFate\(/g)].map(() => f));
  ok(calls.filter((f) => f === "pf2e-integration.mjs").length === 2 && calls.every((f) => f === "pf2e-integration.mjs" || f === "apply.mjs"), `roads: applyFate is called from ${calls.join(", ")}; expected the auto hook and the menu entry only`);
  ok(/userId\s*!==\s*game\.user\.id/.test(integ), "roads: the auto road runs on every client, not only the author's");
  ok(!/context\.options\s*=\s*new Set\(context\.options\)/.test(integ), "roads: the dialog replaces PF2e's options collection (the option would be lost)");

  // Behaviour: two concurrent applies on one message write once.
  const updates = [];
  let rolled = 0;
  class FakeTerm { constructor(d) { Object.assign(this, d); } async evaluate() { this._evaluated = true; return this; } }
  class FakeRoll {
    constructor(formula) { this.formula = formula; this.dice = [{ faces: 6, results: [{ result: 1, active: true }] }]; this.terms = []; this.options = {}; }
    async evaluate() { rolled++; await new Promise((r) => setTimeout(r, 5)); return this; }
    toJSON() { return { formula: this.formula, terms: this.terms, options: this.options, total: this._total ?? this.total }; }
    static fromData(d) { const r = new FakeRoll(d.formula); r.terms = d.terms; r.options = d.options ?? {}; r.total = d.total; r._total = d.total; return r; }
  }
  globalThis.Roll = FakeRoll;
  globalThis.foundry = { dice: { terms: { OperatorTerm: FakeTerm, NumericTerm: FakeTerm } }, utils: { deepClone: (o) => JSON.parse(JSON.stringify(o)) } };
  globalThis.ui = { notifications: { error() {}, info() {} } };
  const flags = {};
  const check = {
    total: 18, options: {}, dice: [{ faces: 20 }],
    toJSON() { return { formula: "1d20+8", total: 18, options: {}, terms: [{ class: "Die", faces: 20, results: [{ result: 10, active: true }] }] }; },
  };
  const message = {
    id: "m1", isAuthor: true, timestamp: Date.now(), whisper: [], blind: false, content: "",
    flags: { pf2e: { context: { type: "skill-check", dc: { value: 20 }, options: ["glddf:fated-roll"] } } },
    actor: { isOfType: (t) => t === "character" },
    rolls: [check],
    getFlag: (_s, k) => flags[k],
    async update(u) { updates.push(u); flags[C.FLAGS.fate] = u[`flags.${C.MODULE_ID}.${C.FLAGS.fate}`]; },
  };
  globalThis.game = {
    user: { id: "u1", isGM: false },
    settings: { get: () => undefined },
    messages: { get: () => message },
  };
  const { applyFate, canAddFate } = await imp("scripts/features/destiny-dice/apply.mjs");
  const [a, b] = await Promise.all([applyFate(message, { source: "dialog" }), applyFate(message, { source: "context" })]);
  ok(updates.length === 1 && rolled === 1, `roads: two concurrent applies threw ${rolled} dice and wrote ${updates.length} times`);
  ok((a && !b) || (!a && b), "roads: both applies report a fate");
  const fate = flags[C.FLAGS.fate];
  ok(fate?.kind === "complication" && fate.bonus === 4 && fate.before === "failure" && fate.after === "success", "roads: the written fate does not carry the face and its shift");
  ok(updates[0]?.rolls?.[0]?.options?.glddfFateBonusApplied === true && updates[0]?.["flags.pf2e.context.outcome"] === "success", "roads: the bonus or the new outcome is not written with the fate");
  ok(check.options.glddfFateBonusApplied === undefined, "roads: the document's own roll was mutated before the write");
  ok(await applyFate(message, { source: "context" }) === null && updates.length === 1, "roads: a fated message takes a second fate");
  // A hero point reroll clones the fated roll: it arrives with the old fate's
  // +2 term and marker, and no fate flag. The new +4 must replace the old +2.
  delete flags[C.FLAGS.fate];
  const label = "GLDDF.Roll.FateBonusLabel";
  const rerolled = {
    total: 20, options: { glddfFateBonusApplied: true, glddfFateBonus: 2 }, dice: [{ faces: 20 }],
    toJSON() {
      return { formula: "1d20+8+2", total: 20, options: { ...this.options },
        terms: [{ class: "Die", faces: 20, results: [{ result: 10, active: true }] }, { operator: "+" }, { number: 8 }, { operator: "+" }, { number: 2, options: { flavor: label } }] };
    },
  };
  const before = updates.length;
  await applyFate({ ...message, id: "m2", rolls: [rerolled], flags: { pf2e: { context: { ...message.flags.pf2e.context, isReroll: true } } } }, { source: "dialog" });
  const re = updates[before];
  const fateTerms = re?.rolls?.[0]?.terms?.filter((term) => term.options?.flavor === label) ?? [];
  ok(re?.rolls?.[0]?.total === 22 && fateTerms.length === 1 && fateTerms[0].number === 4, `roads: a hero point reroll keeps the old fate's bonus (total ${re?.rolls?.[0]?.total}, ${fateTerms.length} fate terms)`);
  ok(flags[C.FLAGS.fate]?.bonusApplied === true && flags[C.FLAGS.fate]?.before === "failure", "roads: a reroll's fate is not recorded against the check without the old bonus");
  delete flags[C.FLAGS.fate];
  ok(!canAddFate({ ...message, isAuthor: false }, { isGM: false }), "roads: a non-author player is offered a write Foundry will refuse");
  ok(!canAddFate({ ...message, isAuthor: false, timestamp: Date.now() }, { isGM: true }), "roads: a GM is offered the menu while the author's client is throwing the auto fate");
  ok(canAddFate({ ...message, isAuthor: false, timestamp: Date.now() - 60000 }, { isGM: true }), "roads: an auto fate that never arrived blocks the GM forever");
  ok(!canAddFate({ ...message, flags: { pf2e: { context: { type: "initiative", options: [] } } } }, { isGM: true }), "roads: initiative is fateable (the tracker would not see the bonus)");
  for (const k of ["Roll", "foundry", "ui", "game"]) delete globalThis[k];
}

/* ── 11. purity and motion ───────────────────────────────────────────── */
{
  for (const f of ["constants.mjs", "faces.mjs", "glyphs.mjs", "raster.mjs", "fate.mjs", "view.mjs"]) {
    const src = stripComments(sources[f]);
    for (const word of ["game", "foundry", "canvas", "Hooks", "ui", "document", "window"]) {
      ok(!new RegExp(`\\b${word}\\s*[.?\\[]`).test(src), `purity: ${f} reaches ${word}`);
    }
  }
  const settings = stripComments(sources["settings.mjs"]);
  ok(!/^const\s*\{[^}]*\}\s*=\s*foundry/m.test(settings), "purity: settings.mjs reaches foundry at module scope");
  const result = stripComments(sources["fate-result.mjs"]);
  ok(!/applyMotionTier|--gl-motion-scale/.test(result + stripComments(sources["settings.mjs"]) + stripComments(sources["main.mjs"])), "motion: the Animation Style is written onto the suite's scale again (it retimes every feature)");
  for (const m of result.matchAll(/duration:\s*([^,}]+)/g)) ok(/^d\(/.test(m[1].trim()), `motion: a duration in fate-result.mjs is not scaled: ${m[1].trim()}`);
  for (const m of result.matchAll(/\},\s*([^)]+)\);/g)) ok(/^(0|d\(.*\))$/.test(m[1].trim()), `motion: a timeline position is not scaled: ${m[1].trim()}`);
  ok(!/prefers-reduced-motion/.test(css + result), "motion: an OS reduced-motion check (the suite does not honour it)");
}

/* ── 12. stylesheet ──────────────────────────────────────────────────── */
{
  const body = stripComments(css);
  ok(!/:root\b/.test(body), "css: a :root rule (the skin lives on the feature's roots only)");
  ok(!/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(body), "css: a raw white veil");
  ok(!/@font-face|@import/.test(body), "css: a font-face or import");
  const declared = new Set([...body.matchAll(/(--glddf-[\w-]+)\s*:/g)].map((m) => m[1]));
  for (const m of body.matchAll(/var\((--glddf-[\w-]+)/g)) ok(declared.has(m[1]), `css: ${m[1]} is read and never declared`);
  for (const m of body.matchAll(/--gl-([\w-]+)\s*:/g)) fail(`css: a foundation token --gl-${m[1]} is redeclared`);
  for (const m of body.matchAll(/@keyframes\s+([\w-]+)/g)) ok(m[1].startsWith("glddf-"), `css: keyframes ${m[1]} is not prefixed`);
  for (const m of body.matchAll(/(?:transition|animation)[^;]*?\b(\d+(?:\.\d+)?m?s)\b/g)) fail(`css: a raw duration ${m[1]}`);
  for (const cls of ["glddf-cfg-btn", "glddf-cfg-icon"]) ok(new RegExp(`\\.${cls}[^{]*\\{[^}]*font-size`).test(body), `css: .${cls} takes its type size from the host`);
  // Every class the view emits is styled.
  const html = V.renderFaceConfig(V.faceConfigModel({ faces: F.resolveFaces(() => undefined), preset: "default" }))
    + V.renderFateStrip(V.fateModel(FT.normalizeFate({ face: 1, kind: "complication", bonus: 4, before: "failure", after: "success", accepted: false }), { seesOutcome: true }))
    + V.renderFatedToggle();
  const emitted = new Set([...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith("glddf-")));
  // The kind classes on the strip are hooks for world CSS and macros written
  // against the standalone module; the look itself follows `data-tone`.
  const HOOKS = new Set(C.FATE_KINDS.map((k) => `glddf-${k}`));
  for (const c of emitted) if (!HOOKS.has(c)) ok(new RegExp(`\\.${c}\\b`).test(body), `css: .${c} is emitted and never styled`);
}

if (problems.length) {
  console.log(`destiny-dice-check: ${problems.length} problem(s) in ${checks} checks`);
  for (const p of problems) console.log("  ✗ " + p);
  process.exit(1);
}
console.log(`destiny-dice-check: 0 problems (${checks} checks)`);
