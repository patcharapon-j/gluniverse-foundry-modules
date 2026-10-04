#!/usr/bin/env node
/**
 * GLUniverse Suite — Theatre consistency check.
 *
 *   node tools/theatre-check.mjs
 *
 * Nearly everything Theatre can get wrong fails SILENTLY. A normaliser that is
 * not total lets a key a shot lacked survive Foundry's flag merge; a timeline
 * whose relight beat slips out from behind the black relights the cast in full
 * view of the table; a dynamic i18n key that is missing prints the raw key on a
 * player's screen; a face whose family is not declared in gl-fonts.css falls
 * back to the browser's serif mid-title; a renderer or overlay that reads the
 * world works in Foundry and breaks the preview, which then flatters a copy
 * nobody ships; an app that writes the scene directly bypasses the forced
 * replacement and keeps a deleted field forever; a drift that is not first to
 * shed never degrades under load; and the stream's auto-camera, left alone,
 * pans a broadcast off the frame the players are locked to.
 *
 * This drives the pure modules and reads the rest. Zero problems required;
 * exits non-zero otherwise.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEAT = "scripts/features/theatre";
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

let problems = 0;
let passed = 0;
let section = "";
const ok = (name, cond, extra = "") => {
  if (cond) { passed++; return true; }
  console.log(`FAIL [${section}] ${name}${extra ? ` — ${extra}` : ""}`);
  problems++;
  return false;
};

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const C = await imp(`${FEAT}/constants.mjs`);
const M = await imp(`${FEAT}/model.mjs`);
const T = await imp(`${FEAT}/timeline.mjs`);

/* ── Model: every normaliser is total ─────────────────────────────────── */
section = "model";
{
  const junk = [undefined, null, 0, "x", [], { style: "nope", face: "nope", hold: "x", focus: 3, drift: 7, treatment: "t", grade: 4 }];
  const shotKeys = Object.keys(M.normalizeShot({}));
  const treatKeys = Object.keys(M.DEFAULT_TREATMENT);
  for (const j of junk) {
    const s = M.normalizeShot(j, 3);
    ok(`normalizeShot(${JSON.stringify(j)}) has every key`, shotKeys.every((k) => k in s));
    ok(`normalizeShot(${JSON.stringify(j)}) treatment has every key`, treatKeys.every((k) => k in s.treatment));
    ok(`normalizeShot(${JSON.stringify(j)}) id is a non-empty string`, typeof s.id === "string" && s.id.length > 0);
    ok("normalizeConfig is total", Object.keys(M.DEFAULT_CONFIG).every((k) => k in M.normalizeConfig(j)));
    const st = M.normalizeState(j);
    ok("normalizeState is total", "shotId" in st && "cue" in st);
  }
  ok("a junk style falls back to null (scene default)", M.normalizeShot({ style: "nope" }).style === null);
  ok("a junk face falls back to null (scene default)", M.normalizeShot({ face: "nope" }).face === null);
  ok("hold is clamped", M.normalizeShot({ hold: 999999 }).hold === C.TIMING.holdMax);
  ok("letterbox null survives (scene default)", M.normalizeShot({ treatment: { letterbox: null } }).treatment.letterbox === null);
  ok("NEUTRAL_TREATMENT is neutral", M.isNeutralTreatment(M.NEUTRAL_TREATMENT));
  ok("DEFAULT_TREATMENT is not neutral (it vignettes)", !M.isNeutralTreatment(M.DEFAULT_TREATMENT));

  // Ids: a shot without one mints the same id on every client, and duplicates are re-minted.
  const a = M.normalizeShots([{ src: "a.webp" }, { src: "b.webp" }]);
  const b = M.normalizeShots([{ src: "a.webp" }, { src: "b.webp" }]);
  ok("minted ids are deterministic", a.map((s) => s.id).join() === b.map((s) => s.id).join());
  const dup = M.normalizeShots([{ id: "x" }, { id: "x" }, { id: "x" }]);
  ok("duplicate ids are re-minted unique", new Set(dup.map((s) => s.id)).size === dup.length, dup.map((s) => s.id).join());
  ok("an object map normalises as a list", M.normalizeShots({ 0: { id: "q" } })[0]?.id === "q");

  const cue = M.normalizeCue({ seq: 2, at: 10, kind: "bogus", style: "bogus" });
  ok("a junk cue kind falls back to shot", cue?.kind === "shot");
  ok("a junk cue style falls back to the default", cue?.style === C.DEFAULT_STYLE);
  ok("a cue without seq/at is dropped", M.normalizeCue({ kind: "shot" }) === null);

  ok("titleFromFilename de-slugs", M.titleFromFilename("maps/the-drowned_chapel_02.webp") === "The Drowned Chapel");
  for (const [iw, ih] of [[1000, 1000], [4000, 1000], [1000, 4000], [3840, 2160]]) {
    for (const f of [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]) {
      const r = M.coverRect(iw, ih, 1600, 900, f);
      ok(`coverRect ${iw}x${ih} @${f.x},${f.y} covers the frame`,
        r.x <= 1e-6 && r.y <= 1e-6 && r.x + r.width >= 1600 - 1e-6 && r.y + r.height >= 900 - 1e-6);
    }
  }
}

/* ── Timeline: the relight is always hidden, every beat is in range ──── */
section = "timeline";
{
  const ease = (x) => x;
  for (const style of C.STYLES) {
    for (const letterbox of [0, 0.1, 0.2]) {
      const t = T.timelineFor(style, { letterbox, letters: 18 });
      const beats = [t.image, t.relight, t.title, t.card].filter(Boolean);
      ok(`${style}: no negative time`, beats.every((b) => Object.entries(b).every(([k, v]) => k === "mode" || v >= 0))
        && [...t.black, ...t.bars].every((s) => s.at >= 0 && s.dur >= 0));
      ok(`${style}: total covers every beat`, t.total >= t.relight.at + t.relight.dur && (!t.title || t.total >= t.title.outAt + t.title.outDur));
      if (t.title) ok(`${style}: the title leaves after it arrives`, t.title.outAt >= t.title.at + t.title.arrive);
      ok(`${style}: bars end at the resting letterbox`, Math.abs(t.bars.at(-1).to - letterbox) < 1e-9, `${t.bars.at(-1).to}`);

      // The relight must happen where the cast cannot be seen relighting.
      const r0 = t.relight.at, r1 = t.relight.at + t.relight.dur;
      if (style === "centre" || style === "interlude") {
        ok(`${style}: the relight is behind full black`,
          T.segmentValue(t.black, r0, ease) >= 0.999 && T.segmentValue(t.black, r1, ease) >= 0.999,
          `black ${T.segmentValue(t.black, r0)}→${T.segmentValue(t.black, r1)}`);
      }
      if (style === "credits") {
        ok("credits: the relight is behind closed bars",
          T.segmentValue(t.bars, r0, ease) >= 0.5 && T.segmentValue(t.bars, r1, ease) >= 0.5);
        ok("credits: the swap is behind closed bars", T.segmentValue(t.bars, t.image.at, ease) >= 0.5);
      }
      if (style === "centre") ok("centre: the swap is behind full black", T.segmentValue(t.black, t.image.at, ease) >= 0.999);
      if (style === "wipe" || style === "chapter") {
        ok(`${style}: the relight lands inside the image transition`, r0 >= t.image.at && r1 <= t.image.at + t.image.dur);
      }
    }
    const t1 = T.timelineFor(style), t2 = T.scaleTimeline(t1, 2);
    ok(`${style}: scaleTimeline scales the total`, Math.abs(t2.total - t1.total * 2) < 1e-9);
    ok(`${style}: scaleTimeline keeps the image mode`, t2.image.mode === t1.image.mode);
    ok(`${style}: no title beats for a shot with no title`, T.timelineFor(style, { title: false }).title === null);
  }
}

/* ── i18n: every literal key and every dynamic family resolves ───────── */
section = "i18n";
{
  const lang = {};
  const flat = (o, p = "") => { for (const [k, v] of Object.entries(o)) v && typeof v === "object" ? flat(v, `${p}${k}.`) : (lang[`${p}${k}`] = v); };
  for (const f of ["lang/theatre.en.json", "lang/theatre-apps.en.json"]) {
    if (!ok(`${f} exists`, existsSync(join(ROOT, f)))) continue;
    try { flat(JSON.parse(read(f))); } catch (e) { ok(`${f} parses`, false, e.message); }
  }
  for (const k of C.STYLES) { ok(`GLTH.style.${k}.name`, `GLTH.style.${k}.name` in lang); ok(`GLTH.style.${k}.hint`, `GLTH.style.${k}.hint` in lang); }
  for (const k of C.FACE_KEYS) ok(`GLTH.face.${k}`, `GLTH.face.${k}` in lang);
  for (const k of C.DRIFT_MODES) ok(`GLTH.drift.${k}`, `GLTH.drift.${k}` in lang);
  for (const k of C.CUE_KINDS) ok(`GLTH.cue.${k}`, `GLTH.cue.${k}` in lang);
  ok("GLS.feature.theatre.title", "GLS.feature.theatre.title" in lang);
  ok("GLS.feature.theatre.hint", "GLS.feature.theatre.hint" in lang);

  const sources = [...walk(FEAT), ...walk("templates/theatre")].filter((f) => /\.(mjs|hbs)$/.test(f));
  const missing = new Set();
  for (const f of sources) {
    for (const m of read(f).matchAll(/["'`](GLTH\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) if (!(m[1] in lang)) missing.add(`${m[1]} (${f})`);
    for (const m of read(f).matchAll(/localize\s+"(GLTH\.[A-Za-z0-9_.]+)"/g)) if (!(m[1] in lang)) missing.add(`${m[1]} (${f})`);
  }
  ok("every literal GLTH key resolves", missing.size === 0, [...missing].slice(0, 12).join(", "));
}

/* ── Type: every face's families are declared and bundled ────────────── */
section = "fonts";
{
  const css = read("styles/gl-fonts.css");
  const declared = new Set([...css.matchAll(/font-family:\s*"([^"]+)"/g)].map((m) => m[1]));
  const families = new Set();
  for (const f of Object.values(C.FACES)) for (const v of [f, f.secondary]) families.add(v.family.match(/"([^"]+)"/)?.[1]);
  for (const fam of families) ok(`"${fam}" is declared in gl-fonts.css`, declared.has(fam));
  for (const m of css.matchAll(/url\("\.\.\/([^"]+)"\)/g)) ok(`${m[1]} exists`, existsSync(join(ROOT, m[1])));
  for (const dir of ["google-sans-flex", "archivo", "cinzel", "cormorant-garamond"]) {
    ok(`assets/fonts/${dir}/OFL.txt`, existsSync(join(ROOT, "assets/fonts", dir, "OFL.txt")));
  }
  ok("italic Cormorant is declared (the card and the serif secondaries use it)",
    /font-family:\s*"Cormorant Garamond";[^}]*font-style:\s*italic/.test(css));
  const other = walk("styles").filter((f) => f.endsWith(".css") && !f.endsWith("gl-fonts.css"));
  const faceOutside = other.filter((f) => /@font-face/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, "")));
  ok("no @font-face outside gl-fonts.css", faceOutside.length === 0, faceOutside.join(", "));
}

/* ── Wiring ───────────────────────────────────────────────────────────── */
section = "wiring";
{
  const mod = JSON.parse(read("module.json"));
  for (const p of ["styles/theatre.css", "styles/theatre-apps.css"]) ok(`module.json lists ${p}`, mod.styles.includes(p));
  for (const p of ["lang/theatre.en.json", "lang/theatre-apps.en.json"]) ok(`module.json lists ${p}`, mod.languages.some((l) => l.path === p));
  for (const p of [...mod.styles, ...mod.languages.map((l) => l.path)]) if (p.includes("theatre")) ok(`${p} exists`, existsSync(join(ROOT, p)));
  ok("the roster imports theatre", /import "\.\/theatre\/index\.mjs";/.test(read("scripts/features/index.mjs")));
  const adapter = read(`${FEAT}/index.mjs`);
  ok("the adapter claims the th. prefix", /settingPrefix:\s*PREFIX/.test(adapter) && C.PREFIX === "th.");
  ok("the adapter ships off", /defaultEnabled:\s*false/.test(adapter));
  for (const k of Object.values(C.SETTINGS)) ok(`setting ${k} carries the prefix`, k.startsWith(C.PREFIX));
  for (const k of Object.values(C.FLAGS)) ok(`flag ${k} carries the prefix`, k.startsWith(C.PREFIX));
}

/* ── Purity: the renderer and the overlay never read the world ───────── */
section = "purity";
{
  const pure = [...walk(`${FEAT}/render`), ...walk(`${FEAT}/overlay`), `${FEAT}/constants.mjs`, `${FEAT}/model.mjs`, `${FEAT}/timeline.mjs`];
  for (const f of pure) {
    const src = stripComments(read(f));
    const hit = src.match(/\b(game|canvas|foundry|ui|Hooks)\s*[.?[]/);
    ok(`${f} reads nothing from the world`, !hit, hit?.[0]);
    try { await imp(f); passed++; } catch (e) { ok(`${f} imports under plain Node`, false, e.message); }
  }
  try { await imp(`${FEAT}/apps/index.mjs`); passed++; } catch (e) { ok("the apps import under plain Node", false, e.message); }
}

/* ── Writes: one path, forced replacement ────────────────────────────── */
section = "writes";
{
  const files = walk(FEAT).filter((f) => f.endsWith(".mjs"));
  for (const f of files) {
    const src = stripComments(read(f));
    ok(`${f} never calls setFlag/unsetFlag`, !/\.(setFlag|unsetFlag)\(/.test(src));
    if (f.includes("/apps/")) ok(`${f} never updates the scene directly`, !/scene\.update\(/.test(src));
  }
  const store = stripComments(read(`${FEAT}/store.mjs`));
  ok("the store writes shots by forced replacement", /forceSet\(upd, PATHS\.shots/.test(store));
  ok("the store writes config by forced replacement", /forceSet\(upd, PATHS\.config/.test(store));
  ok("the store writes state by forced replacement", /forceSet\(upd, PATHS\.state/.test(store));
  ok("cues are stamped in server time with the lead", /game\.time\.serverTime \+ TIMING\.cueLead/.test(store));
  ok("store writes are serialised", /_write\(/.test(store) && /this\._queue/.test(store));
}

/* ── Performance: drift sheds first and is bound to the budget ───────── */
section = "perf";
{
  const R = await imp(`${FEAT}/render/shot-renderer.mjs`);
  ok("SHED_ORDER sheds drift first", R.SHED_ORDER?.[0] === "drift", JSON.stringify(R.SHED_ORDER));
  const host = stripComments(read(`${FEAT}/host.mjs`));
  ok("the host binds SHED_ORDER to Budget.ladder", /Budget\.ladder\(/.test(host) && /SHED_ORDER/.test(host));
  ok("the host claims motion while it moves", /Budget\.claimMotion\(/.test(host));
  ok("the host mounts in canvas.primary beneath tiles", /canvas\??\.primary/.test(host) && /TILES/.test(host));
}

/* ── Seams: Stage, stream, motion, CSS ───────────────────────────────── */
section = "seams";
{
  const store = read("scripts/features/stage/postfx/grade-store.mjs");
  for (const name of ["gradeUpdateData", "tweenUpdateOptions", "gradeFromSrc", "readSceneGrade"]) {
    ok(`stage grade-store exports ${name}`, new RegExp(`export (async )?function ${name}\\b`).test(store));
  }
  ok("stage exposes TWEEN_OPTION", /export \{ TWEEN_OPTION \}|export const TWEEN_OPTION/.test(store));
  const stageApi = read("scripts/features/stage/module.js");
  for (const name of ["gradeUpdateData", "tweenUpdateOptions", "gradeFromSrc", "readSceneGrade"]) ok(`the stage api carries ${name}`, stageApi.includes(name));
  const bridge = stripComments(read(`${FEAT}/stage-bridge.mjs`));
  ok("the bridge is gated on stage being enabled",
    /Suite\.enabled\(\s*["']stage["']\s*\)/.test(bridge)
      || (/Suite\.enabled\(\s*STAGE_ID\s*\)/.test(bridge) && /STAGE_ID\s*=\s*["']stage["']/.test(bridge)));
  ok("theatre never imports the stage feature statically", walk(FEAT).every((f) => !/from\s+["'][^"']*features\/stage\//.test(read(f)) && !/from\s+["']\.\.\/stage\//.test(read(f))));

  const ctrl = stripComments(read("scripts/features/stream/camera/controller.js"));
  ok("the stream camera stands down on a Theatre scene", /Suite\.enabled\(/.test(ctrl) && /th\.enabled|THEATRE_FLAG/.test(ctrl));
  ok("stream never imports theatre", walk("scripts/features/stream").every((f) => !/features\/theatre|\.\.\/theatre\//.test(read(f))));

  const all = [...walk(FEAT), "styles/theatre.css", "styles/theatre-apps.css"];
  ok("no prefers-reduced-motion anywhere in Theatre", all.every((f) => !/prefers-reduced-motion/.test(read(f))));

  for (const f of ["styles/theatre.css", "styles/theatre-apps.css"]) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    ok(`${f}: no raw white rgba veil`, !/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(css));
    ok(`${f}: no network @import`, !/@import\s+url\(\s*['"]?http/.test(css));
    const bad = [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]).filter((n) => !n.startsWith("glth-"));
    ok(`${f}: every keyframe is glth- prefixed`, bad.length === 0, bad.join(", "));
    const vars = [...css.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*var\(\s*\1\s*[,)]/g)].map((m) => m[1]);
    ok(`${f}: no self-referential custom property`, vars.length === 0, vars.join(", "));
    const redeclared = [...css.matchAll(/(^|[;{\s])(--gl-[A-Za-z0-9-]+)\s*:/g)].map((m) => m[2]).filter((v) => v !== "--gl-accent");
    ok(`${f}: redeclares no foundation token`, redeclared.length === 0, [...new Set(redeclared)].join(", "));
  }
  const apps = read("styles/theatre-apps.css");
  ok("theatre-apps.css sizes the buttons it ships (.gl-btn declares no font-size)",
    /\.gl-btn[^{]*\{[^}]*font-size/.test(apps));
  const ov = read("styles/theatre.css");
  ok("the overlay sits above Stage's overlay (z-index 1)", /z-index:\s*calc\(var\(--gl-z-base\)\s*\+\s*[1-9]/.test(ov) || /z-index:\s*([2-9]|[1-9]\d)\b/.test(ov));
  ok("the overlay never takes the pointer", /pointer-events:\s*none/.test(ov));
}

console.log(problems ? `\ntheatre-check: ${problems} problem(s), ${passed} assertion(s) passed.` : `\ntheatre-check: 0 problems, ${passed} assertion(s) passed.`);
process.exit(problems ? 1 : 0);
