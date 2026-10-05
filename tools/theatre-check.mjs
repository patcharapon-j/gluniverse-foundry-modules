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
 * replacement and keeps a deleted field forever; and the stream's auto-camera, left alone,
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
  const junk = [undefined, null, 0, "x", [], { style: "nope", face: "nope", hold: "x", focus: 3, treatment: "t", grade: 4 }];
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
  ok("a shot's shake is clamped", M.normalizeShot({ shake: 5 }).shake === 1);
  ok("a shot's shake null survives (the GM's default)", M.normalizeShot({ shake: null }).shake === null && M.normalizeShot({}).shake === null);
  ok("a face key off the prototype is refused", M.normalizeShot({ face: "toString" }).face === null && M.normalizeConfig({ face: "toString", v: M.CONFIG_VERSION }).face === null);

  // The GM's default typeface reaches every scene that has not picked its own,
  // including scenes made before a scene's face could be left empty.
  ok("a new scene config follows the GM's face", M.normalizeConfig({}).face === null);
  ok("a pre-v2 scene on the old written default follows the GM's face", M.normalizeConfig({ face: C.DEFAULT_FACE }).face === null);
  ok("a pre-v2 scene that chose another face keeps it", M.normalizeConfig({ face: "cinzel" }).face === "cinzel");
  ok("a v2 scene that chose the default face keeps it", M.normalizeConfig({ face: C.DEFAULT_FACE, v: M.CONFIG_VERSION }).face === C.DEFAULT_FACE);
  ok("a written config is stamped with its version", M.normalizeConfig({}).v === M.CONFIG_VERSION);
  ok("resolveFace: shot, then scene, then the GM's default",
    M.resolveFace({ face: "oxanium" }, { face: "cinzel" }, "archivo") === "oxanium"
      && M.resolveFace({ face: null }, { face: "cinzel" }, "archivo") === "cinzel"
      && M.resolveFace(null, { face: null }, "archivo") === "archivo");
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

/* ── Folders: play order is folder order, every road agrees ──────────── */
section = "folders";
{
  for (const j of [undefined, null, 0, "x", [], { id: 4, name: 7, color: "red" }]) {
    const fo = M.normalizeFolder(j, 2);
    ok(`normalizeFolder(${JSON.stringify(j)}) is total`, ["id", "name", "color"].every((k) => k in fo) && typeof fo.id === "string" && fo.id.length > 0);
    ok(`normalizeShot(${JSON.stringify(j)}) carries a folder key`, "folder" in M.normalizeShot(j));
  }
  ok("a junk folder colour is null (the accent)", M.normalizeFolder({ color: "red" }).color === null);
  ok("a folder colour is kept, lower-cased", M.normalizeFolder({ color: "#AABBCC" }).color === "#aabbcc");
  ok("an unfiled shot reads folder null", M.normalizeShot({}).folder === null && M.normalizeShot({ folder: "  " }).folder === null);
  const fdup = M.normalizeFolders([{ id: "a" }, { id: "a" }]);
  ok("duplicate folder ids are re-minted unique", new Set(fdup.map((x) => x.id)).size === 2);
  ok("minted folder ids are deterministic", M.normalizeFolders([{ name: "Act I" }])[0].id === M.normalizeFolders([{ name: "Act I" }])[0].id);

  const folders = M.normalizeFolders([{ id: "fA", name: "Act I" }, { id: "fB", name: "Act II" }, { id: "fE", name: "Empty" }]);
  const shots = M.normalizeShots([
    { id: "u1" }, { id: "b1", folder: "fB" }, { id: "a1", folder: "fA" }, { id: "x1", folder: "gone" }, { id: "b2", folder: "fB" }, { id: "a2", folder: "fA" },
  ]);
  const ordered = M.orderShots(shots, folders);
  ok("play order is folder order, unfiled last, stored order within", ordered.map((x) => x.id).join() === "a1,a2,b1,b2,u1,x1", ordered.map((x) => x.id).join());
  ok("a shot filed in a deleted folder reads unfiled", ordered.find((x) => x.id === "x1").folder === null);
  ok("orderShots is idempotent", M.orderShots(ordered, folders).map((x) => x.id).join() === ordered.map((x) => x.id).join());
  ok("orderShots never mutates its input", shots.find((x) => x.id === "x1").folder === "gone");
  ok("no folders: order is untouched", M.orderShots(shots, []).map((x) => x.id).join() === shots.map((x) => x.id).join());
  const groups = M.groupShots(shots, folders);
  ok("every folder has a group, empty ones included, then unfiled", groups.map((g) => g.folder?.id ?? "-").join() === "fA,fB,fE,-");
  ok("group indices are play-order indices", groups.flatMap((g) => g.shots).every(({ shot, index }) => ordered[index].id === shot.id));
  ok("no unfiled group when every shot is filed", M.groupShots([{ id: "a", folder: "fA" }], folders).every((g) => g.folder));
  ok("no folders: one unfiled group", M.groupShots(shots, []).length === 1 && M.groupShots([], []).length === 1);

  const hay = M.searchText({ title: "The Drowned Chapel", notes: "Bell rings at midnight", src: "maps/sunken%20nave.webp" }, "Act Ⅰ Café");
  ok("search matches title words in any order", M.matchesQuery(hay, "chapel drowned"));
  ok("search matches notes", M.matchesQuery(hay, "midnight"));
  ok("search matches the decoded file name", M.matchesQuery(hay, "sunken nave"));
  ok("search matches the folder, accents folded", M.matchesQuery(hay, "cafe"));
  ok("search needs every word", !M.matchesQuery(hay, "chapel tavern"));
  ok("an empty query matches everything", M.matchesQuery(hay, "  ") && M.matchesQuery("", ""));
}

/* ── Folders: the store drives them through one forced write each ────── */
section = "folder-store";
{
  const SUITE = "gluniverse-foundry-modules";
  globalThis.game = { user: { isGM: true } };
  const S = await imp(`${FEAT}/store.mjs`);
  // A fake Scene that applies `==` replacements the way Foundry does and counts writes.
  const scene = {
    flags: { [SUITE]: { th: { enabled: true, shots: [{ id: "s1", src: "a.webp" }, { id: "s2", src: "b.webp" }, { id: "s3", src: "c.webp" }] } } },
    writes: 0,
    getFlag(scope, key) { return key.split(".").reduce((o, k) => o?.[k], this.flags[scope]); },
    async update(upd) {
      this.writes++;
      for (const [path, v] of Object.entries(upd)) {
        const parts = path.replace(/\.==/g, ".").split(".").slice(1);
        let o = this.flags;
        for (const k of parts.slice(0, -1)) o = o[k] ??= {};
        o[parts.at(-1)] = structuredClone(v);
      }
    },
  };
  const store = S.TheatreStore.for(scene);
  const ids = () => store.shots.map((x) => x.id).join();
  try {
    const fA = await store.addFolder({ name: "Act I" }, { shotIds: ["s3"] });
    ok("addFolder files shots in the same single write", scene.writes === 1 && store.shot("s3").folder === fA);
    ok("a filed shot moves to its folder's place in play order", ids() === "s3,s1,s2", ids());
    ok("next/prev walk the folder order (indexOf speaks play order)", store.indexOf("s3") === 0);
    const fB = await store.addFolder({ name: "Act II", color: "#123456" });
    await store.moveShot("s1", null, { folder: fB });
    ok("moveShot into a folder with no index lands at its end", ids() === "s3,s1,s2" && store.shot("s1").folder === fB, ids());
    await store.moveShot("s2", 0, { folder: fA });
    ok("moveShot to an index inside a folder keeps that slot", ids() === "s2,s3,s1", ids());
    await store.moveFolder(fB, 0);
    ok("moveFolder reorders the play order with it", ids() === "s1,s2,s3", ids());
    const before = scene.writes;
    await store.removeFolder(fB);
    ok("removeFolder is one write and keeps its shots, unfiled", scene.writes === before + 1 && store.shot("s1")?.folder === null && store.shots.length === 3);
    ok("unfiled shots play after the folders", ids() === "s2,s3,s1", ids());
    ok("the stored list is already in play order", S.readShots(scene).map((x) => x.id).join() === ids());
    await store.updateFolder(fA, { name: "Prologue", color: "nope" });
    ok("updateFolder renames and validates the colour", store.folder(fA)?.name === "Prologue" && store.folder(fA)?.color === null);
    const added = await store.addShots([{ src: "d.webp" }], { folder: fA });
    ok("addShots files new shots in the folder given", store.shot(added?.[0])?.folder === fA && store.indexOf(added?.[0]) === 2, ids());
    await store.addShots([{ src: "e.webp" }], { folder: "nope" });
    ok("a shot filed in a folder that does not exist is unfiled", store.shots.at(-1).folder === null);
    ok("touchedKeys sees a folder write", S.touchedKeys({ flags: { [SUITE]: { th: { folders: [] } } } }).folders === true);
  } catch (e) {
    ok("the store's folder operations run", false, e.stack);
  } finally {
    delete globalThis.game;
  }
  const src = stripComments(read(`${FEAT}/store.mjs`));
  ok("the store writes folders by forced replacement", /forceSet\(upd, PATHS\.folders/.test(src));
  ok("the store reads shots in play order", /get shots\(\)\s*\{\s*return orderShots\(/.test(src));
  // Filing is organisation, not a draft edit: a draft saved later must never file the shot back.
  const ed = stripComments(read(`${FEAT}/apps/editor.mjs`));
  const patch = ed.slice(ed.indexOf("function patchFromForm"), ed.indexOf("function readForm"));
  ok("a shot's folder is not part of the editor draft", !/folder/.test(patch));
  ok("the folder picker writes at once and skips the draft", /data-folder-select/.test(ed) && /store\.moveShot\(id, null, \{ folder:/.test(ed));
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
  for (const k of C.CUE_KINDS) ok(`GLTH.cue.${k}`, `GLTH.cue.${k}` in lang);
  for (const k of C.FRAMING_CHOICES) ok(`GLTH.framing.${k}`, `GLTH.framing.${k}` in lang);
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
  // A cancelled cue commits its values inline on the persistent title node — the
  // exit blur among them — and nothing later animates that node's filter.
  const overlay = stripComments(read(`${FEAT}/overlay/title-overlay.mjs`));
  const clear = /_clearTitleDom\(\)\s*\{([\s\S]*?)\n  \}/.exec(overlay)?.[1] ?? "";
  ok("a new cue wipes the title node's committed inline styles (else every later title stays blurred)", /\$\.title\.style\.cssText\s*=\s*""/.test(clear));
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

/* ── Performance: shedding is bound to the budget ────────────────────── */
section = "perf";
{
  const R = await imp(`${FEAT}/render/shot-renderer.mjs`);
  const host = stripComments(read(`${FEAT}/host.mjs`));
  ok("the host binds SHED_ORDER to Budget.ladder", /Budget\.ladder\(/.test(host) && /SHED_ORDER/.test(host));
  ok("the host claims motion while it moves", /Budget\.claimMotion\(/.test(host));
  ok("the host mounts in canvas.primary beneath tiles", /canvas\??\.primary/.test(host) && /TILES/.test(host));
  ok("the camera shake sheds first", R.SHED_ORDER[0] === "shake");
  ok("the camera shake holds still while ambient motion is paused", /setShakeEnabled\(Budget\.ambientAllowed\)/.test(host));
  ok("the host hands the renderer the GM's shake default on attach", /this\.renderer\.setShakeDefault\(/.test(host));

  // Shake: neutral is exact, the sway is bounded, and a shaken picture still covers the frame.
  ok("shake strength 0 is no camera at all", R.shakeCamera(0, { x: 1, y: 1 }, 3840, 2160) === null);
  let maxN = 0;
  for (let t = 0; t < 600; t += 0.37) { const n = R.shakeOffset(t); maxN = Math.max(maxN, Math.abs(n.x), Math.abs(n.y)); }
  ok("the sway stays inside -1..1", maxN <= 1 + 1e-9, String(maxN));
  ok("the sway speed rises with strength", R.SHAKE.fast > R.SHAKE.slow && R.SHAKE.slow > 0);
  let covered = true, worst = "";
  for (const [iw, ih] of [[3840, 2160], [1000, 1000], [4000, 1000], [1000, 4000]]) {
    for (const k of [0.1, 0.3, 1]) {
      for (const n of [{ x: 1, y: 1 }, { x: -1, y: -1 }, { x: 1, y: -1 }, { x: -1, y: 1 }]) {
        for (const f of [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]) {
          const r = R.placeRect(iw, ih, 3840, 2160, f, 1, R.shakeCamera(k, n, 3840, 2160));
          if (!(r.x <= 1e-6 && r.y <= 1e-6 && r.x + r.width >= 3840 - 1e-6 && r.y + r.height >= 2160 - 1e-6)) { covered = false; worst = `${iw}x${ih} k${k}`; }
        }
      }
    }
  }
  ok("a shaken picture still covers the frame at the sway's extremes", covered, worst);
  const still = R.placeRect(1920, 1080, 3840, 2160, { x: 0.5, y: 0.5 }, 1, null);
  ok("no shake places the picture exactly as before", still.x === 0 && still.y === 0 && still.width === 3840 && still.height === 2160);
  const rsrc = stripComments(read(`${FEAT}/render/shot-renderer.mjs`));
  const bd = rsrc.slice(rsrc.indexOf("_updateBackdrop() {"), rsrc.indexOf("_devicePerFrame() {"));
  ok("the backdrop around a fitted frame never shakes", !/_cam|shake/i.test(bd));
  ok("the shake's ease is a TIMING constant", /TIMING\.shakeEase/.test(rsrc));
}

/* ── Framing: fill covers, fit contains, the backdrop fills the rest ──── */
section = "framing";
{
  const { frameView } = await imp(`${FEAT}/camera.mjs`);
  const R = await imp(`${FEAT}/render/shot-renderer.mjs`);
  const rect = { x: 100, y: 50, width: C.FRAME.width, height: C.FRAME.height };
  const shown = (v, sw, sh) => ({ x: v.x - sw / 2 / v.scale - rect.x, y: v.y - sh / 2 / v.scale - rect.y, width: sw / v.scale, height: sh / v.scale });
  for (const [sw, sh] of [[1920, 1080], [1440, 1080], [2560, 1080], [1080, 1920], [3440, 1440]]) {
    const fill = frameView(rect, sw, sh, { mode: "fill" });
    const vFill = shown(fill, sw, sh);
    ok(`fill ${sw}×${sh}: the frame covers the screen (no backdrop)`, !R.viewOverhangs(vFill, rect.width, rect.height));
    for (const padding of [0, 5, C.PADDING_MAX]) {
      const fit = frameView(rect, sw, sh, { mode: "fit", padding });
      const pad = (padding / 100) * Math.min(sw, sh);
      const fw = rect.width * fit.scale, fh = rect.height * fit.scale;
      ok(`fit ${sw}×${sh} pad ${padding}: the whole frame is on screen inside the padding`, fw <= sw - 2 * pad + 1e-6 && fh <= sh - 2 * pad + 1e-6);
      ok(`fit ${sw}×${sh} pad ${padding}: the frame touches the padded box`, Math.abs(fw - (sw - 2 * pad)) < 1e-6 || Math.abs(fh - (sh - 2 * pad)) < 1e-6);
      const v = shown(fit, sw, sh);
      const overhang = padding > 0 || Math.abs(sw / sh - rect.width / rect.height) > 1e-3;
      ok(`fit ${sw}×${sh} pad ${padding}: the backdrop draws exactly when the screen shows past the frame`, R.viewOverhangs(v, rect.width, rect.height) === overhang);
    }
  }
  ok("padding is clamped to PADDING_MAX", frameView(rect, 1920, 1080, { mode: "fit", padding: 999 }).scale === frameView(rect, 1920, 1080, { mode: "fit", padding: C.PADDING_MAX }).scale);
  const v = { x: -500, y: -300, width: 4840, height: 2760 };
  const b = R.backdropRect(1000, 1000, v, { x: 0.5, y: 0.5 });
  ok("the backdrop image covers the whole view", b.x <= v.x && b.y <= v.y && b.x + b.width >= v.x + v.width && b.y + b.height >= v.y + v.height);
  ok("the backdrop is darker than the frame", R.BACKDROP.gain > 0 && R.BACKDROP.gain < 1);
  ok("the backdrop sheds last", R.SHED_ORDER.at(-1) === "backdrop");
  const src = stripComments(read(`${FEAT}/render/shot-renderer.mjs`));
  // A uniform declared and never written holds its initial value forever, silently.
  const init = src.slice(src.indexOf("this.backShader = PIXI.Shader.from("), src.indexOf("this.backMesh = new PIXI.Mesh("));
  const upd = src.slice(src.indexOf("_updateBackdrop() {"));
  for (const name of R.BACK_UNIFORMS) {
    const base = name.replace(/[AB]$/, "");
    ok(`backdrop uniform ${name} is declared`, new RegExp(`uniform\\s+\\w+\\s+${name}\\b`).test(R.BACK_FRAG));
    ok(`backdrop uniform ${name} is initialised`, new RegExp(`\\b${name}\\s*:`).test(init));
    ok(`backdrop uniform ${name} is written`, upd.includes(`u.${name}`) || upd.includes(`\`${base}\${k}\``) || src.includes(`backShader.uniforms.${name}`));
  }
  const host = stripComments(read(`${FEAT}/host.mjs`));
  ok("the backdrop mounts on canvas.stage, outside primary's scene-rect mask", /canvas\.stage\.addChildAt\(this\.renderer\.backdrop,\s*0\)/.test(host));
  ok("the host feeds the live view every frame", /r\.setView\(/.test(host));
  const idx = read(`${FEAT}/index.mjs`);
  for (const [k, scope] of [["defaultFraming", "world"], ["defaultPadding", "world"], ["framing", "client"], ["padding", "client"]]) {
    const at = idx.indexOf(`SETTINGS.${k},`);
    if (!ok(`th.${k} is registered`, at >= 0)) continue;
    const block = idx.slice(at);
    const reg = block.slice(0, block.indexOf("});"));
    ok(`th.${k} is ${scope} scope (the GM's default vs the viewer's own)`, new RegExp(`scope:\\s*"${scope}"`).test(reg));
    ok(`th.${k} re-fits on change`, /onChange:\s*\(\)\s*=>\s*applyFraming\(\)/.test(reg));
  }
  for (const [k, fn] of [["defaultShake", "applyShake"], ["defaultFace", "applyFace"]]) {
    const at = idx.indexOf(`SETTINGS.${k},`);
    if (!ok(`th.${k} is registered`, at >= 0)) continue;
    const block = idx.slice(at);
    const reg = block.slice(0, block.indexOf("});"));
    ok(`th.${k} is the GM's (world scope)`, /scope:\s*"world"/.test(reg));
    ok(`th.${k} applies on change`, new RegExp(`onChange:\\s*\\(\\)\\s*=>\\s*${fn}\\(\\)`).test(reg));
  }
  ok("a viewer's framing defaults to following the GM", /SETTINGS\.framing,[\s\S]*?default:\s*"default"/.test(idx) && C.FRAMING_CHOICES[0] === "default");
  const main = stripComments(read(`${FEAT}/main.mjs`));
  const rf = main.slice(main.indexOf("export function readFraming"), main.indexOf("export function applyFraming"));
  ok("following the GM takes the GM's padding too", /SETTINGS\.defaultFraming/.test(rf) && /SETTINGS\.defaultPadding/.test(rf));
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
  const O = await imp(`${FEAT}/overlay/title-overlay.mjs`);
  const live = ov.replace(/\/\*[\s\S]*?\*\//g, "").match(new RegExp(`\\.${O.LIVE_CLASS}\\s*\\{([^}]*)\\}`));
  ok("a playing cue raises the overlay over Foundry's UI (the class the overlay sets is styled)", !!live && /z-index:\s*calc\(var\(--gl-z-splash\)/.test(live[1]));
  ok("the overlay drops back under the UI when a cue settles", /if \(settle\) \{ this\._live\(false\)/.test(stripComments(read(`${FEAT}/overlay/title-overlay.mjs`))));
}

console.log(problems ? `\ntheatre-check: ${problems} problem(s), ${passed} assertion(s) passed.` : `\ntheatre-check: 0 problems, ${passed} assertion(s) passed.`);
process.exit(problems ? 1 : 0);
