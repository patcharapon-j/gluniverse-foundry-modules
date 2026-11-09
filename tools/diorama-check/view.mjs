/**
 * The view: i18n coverage, setting prefixes, no side effects at import, the
 * stylesheet's design-system rules, and the view's pure decisions on fixtures.
 *
 * Everything here fails silently in a live session: a missing key renders as
 * the key, a hook registered at import runs in a world with the feature off,
 * a secret door drawn as a door tells the players where it is, and a standee
 * that shows the actor portrait unmasks a disguised creature.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

const DIO = "scripts/features/diorama";

/** Every .mjs / .js file under a repo-relative directory. */
function walk(root, rel) {
  const abs = join(root, rel);
  if (!existsSync(abs)) return [];
  const out = [];
  for (const f of readdirSync(abs)) {
    const r = `${rel}/${f}`;
    if (statSync(join(root, r)).isDirectory()) out.push(...walk(root, r));
    else if (/\.(mjs|js)$/.test(f)) out.push(r);
  }
  return out;
}

/**
 * Blank out comments, strings, template text and regex literals (keeping
 * `${…}` code), so brace depth can be read off what is left.
 */
export function stripCode(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  const tmpl = []; // brace depth at each open `${`
  let depth = 0;
  let prev = ""; // last significant char, for the regex heuristic
  const blank = (s) => s.replace(/[^\n]/g, " ");
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? n : e; out += blank(src.slice(i, end)); i = end; continue; }
    if (c === "/" && d === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; out += blank(src.slice(i, end)); i = end; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += " ".repeat(j + 1 - i); i = j + 1; prev = "a"; continue;
    }
    if (c === "`" || (c === "}" && tmpl.length && tmpl[tmpl.length - 1] === depth)) {
      if (c === "}") tmpl.pop();
      let j = i + 1;
      while (j < n && src[j] !== "`" && !(src[j] === "$" && src[j + 1] === "{")) j += src[j] === "\\" ? 2 : 1;
      out += blank(src.slice(i, Math.min(n, j + (src[j] === "`" ? 1 : 2))));
      if (src[j] === "$") { tmpl.push(depth); i = j + 2; } else i = j + 1;
      prev = "a";
      continue;
    }
    if (c === "/" && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(prev)) {
      let j = i + 1, cls = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "/" && !cls) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += " ".repeat(j - i); i = j; prev = "a"; continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    if (!/\s/.test(c)) prev = c;
    out += c;
    i++;
  }
  return out;
}

/** Side-effecting calls that sit at brace depth 0 (module scope). */
export function topLevelEffects(src) {
  const code = stripCode(src);
  const bad = [];
  const re = /\bHooks\.(on|once)\s*\(|\bgame\.keybindings\.register\s*\(|\bgame\.settings\.register\s*\(|\bonSocket\s*\(|\baddEventListener\s*\(|\brequestAnimationFrame\s*\(|\bsetInterval\s*\(/g;
  let depth = 0;
  let k = 0;
  const lines = code.split("\n");
  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      else if (depth === 0) {
        re.lastIndex = c;
        const m = re.exec(line);
        if (m && m.index === c) bad.push(`${ln + 1}: ${m[0]}`);
      }
      k++;
    }
  }
  return bad;
}

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

export default async function check(ctx) {
  const read = (rel) => readFileSync(join(ctx.root, rel), "utf8");
  const C = await import(ctx.url(`${DIO}/constants.mjs`));

  /* ── language files ── */
  const langFiles = readdirSync(join(ctx.root, "lang")).filter((f) => /^diorama.*\.en\.json$/.test(f));
  ctx.ok("a diorama language file exists", langFiles.includes("diorama.en.json"));
  const lang = {};
  for (const f of langFiles) {
    try { Object.assign(lang, flatten(JSON.parse(read(`lang/${f}`)))); }
    catch (e) { ctx.ok(`lang/${f} parses`, false, e.message); }
  }
  const keys = Object.keys(lang);
  const prefixOf = keys.filter((k) => keys.some((o) => o.startsWith(`${k}.`)));
  ctx.ok("no lang key is also another key's prefix", prefixOf.length === 0, prefixOf.join(", "));
  ctx.ok("no lang value is empty", keys.every((k) => typeof lang[k] === "string" && lang[k].trim()), keys.filter((k) => !String(lang[k] ?? "").trim()).join(", "));

  /* ── literal keys ── */
  const files = [`${DIO}/index.mjs`, `${DIO}/main.mjs`, ...walk(ctx.root, `${DIO}/view`), ...walk(ctx.root, `${DIO}/integrations`)]
    .filter((f) => existsSync(join(ctx.root, f)));
  ctx.ok("main.mjs exists", files.includes(`${DIO}/main.mjs`));
  const literal = /["'`](GLDIO\.[A-Za-z0-9_.]*[A-Za-z0-9_])["'`]/g;
  const missing = [];
  for (const f of files) {
    for (const m of read(f).matchAll(literal)) if (!(m[1] in lang)) missing.push(`${m[1]} (${f.split("/").pop()})`);
  }
  ctx.ok("every literal GLDIO key resolves", missing.length === 0, [...new Set(missing)].join(", "));

  /* ── dynamic families ── */
  const { COVER_KEYS } = await import(ctx.url(`${DIO}/view/input.mjs`));
  const families = {
    "GLDIO.kind": C.KIND_KEYS,
    "GLDIO.material.wall": C.WALL_MATERIALS,
    "GLDIO.material.cliff": C.CLIFF_MATERIALS,
    "GLDIO.cover": [...COVER_KEYS, "noSight"],
    "GLDIO.band": C.DH_BANDS.map((b) => b.key),
    "GLDIO.standee.size": ["tiny", "sm", "med", "lg", "huge", "grg"],
    "GLDIO.standee.marks": ["top", "bottom"],
  };
  for (const [fam, members] of Object.entries(families)) {
    const gaps = members.filter((m) => !(`${fam}.${m}` in lang));
    ctx.ok(`dynamic family ${fam}.* is complete`, gaps.length === 0, gaps.join(", "));
  }
  if (existsSync(join(ctx.root, `${DIO}/rules/systems.mjs`))) {
    const { RULE_KEYS } = await import(ctx.url(`${DIO}/rules/systems.mjs`));
    const gaps = (RULE_KEYS ?? []).filter((k) => !(k in lang));
    ctx.ok("every readout key the view prints resolves", gaps.length === 0, gaps.join(", "));
  }

  /* ── settings and keybindings ── */
  ctx.ok("every setting key starts with dio.", Object.values(C.SETTINGS).every((k) => k.startsWith(C.PREFIX)),
    Object.values(C.SETTINGS).filter((k) => !k.startsWith(C.PREFIX)).join(", "));
  const index = read(`${DIO}/index.mjs`);
  const regs = [...index.matchAll(/game\.settings\.register\(\s*SUITE_ID\s*,\s*([^,]+),/g)].map((m) => m[1].trim());
  ctx.ok("index.mjs registers settings only through SETTINGS or the OPTIONS schema",
    regs.length > 0 && regs.every((k) => /^SETTINGS\.\w+$/.test(k) || k === "o.key") && /for \(const o of OPTIONS\)/.test(index), regs.join(", "));

  /* ── the options schema (options.mjs) ── */
  const O = await import(ctx.url("scripts/features/diorama/options.mjs"));
  ctx.ok("every option key starts with dio. and is unique",
    O.OPTIONS.every((o) => o.key.startsWith(C.PREFIX)) && new Set(O.OPTIONS.map((o) => o.key)).size === O.OPTIONS.length
    && O.OPTIONS.every((o) => !Object.values(C.SETTINGS).includes(o.key)));
  const optMissing = [];
  for (const o of O.OPTIONS) {
    for (const k of [`GLDIO.settings.${o.name}.name`, `GLDIO.settings.${o.name}.hint`]) if (!(k in lang)) optMissing.push(k);
    for (const v of o.choices ?? []) if (!(`GLDIO.settings.${o.name}.${v}` in lang)) optMissing.push(`GLDIO.settings.${o.name}.${v}`);
    if (o.choices && !o.choices.includes(o.default)) optMissing.push(`${o.key} default not a choice`);
  }
  ctx.ok("every option has a name, a hint and a label per choice", optMissing.length === 0, optMissing.join(", "));
  const def = O.resolveGraphics({});
  ctx.ok("default graphics are the high preset, adaptive", def.quality === "high" && def.adaptive && def.shadows === 2 && def.weather === 2 && def.fps === 60);
  const low = O.resolveGraphics({ quality: "low", shadows: "soft", fps: 0, renderScale: 50 });
  ctx.ok("an explicit option beats its preset", low.shadows === 2 && low.ao === false && low.fps === 0 && low.renderScale === 0.5);
  ctx.ok("a bad stored value reads as the default", O.resolveGraphics({ quality: "insane", water: 7 }).quality === "high" && O.sanitizeOption("fps", 45) === -1);
  ctx.ok("the presets rise monotonically", O.QUALITY.every((q, i, a) => i === 0 || (O.resolveGraphics({ quality: q }).shadows >= O.resolveGraphics({ quality: a[i - 1] }).shadows
    && O.resolveGraphics({ quality: q }).weather >= O.resolveGraphics({ quality: a[i - 1] }).weather
    && O.resolveGraphics({ quality: q }).renderScale >= O.resolveGraphics({ quality: a[i - 1] }).renderScale)));
  const ov = read(`${DIO}/view/overlay.mjs`);
  ctx.ok("the view redraws on every client option and hands the renderer resolved graphics",
    /GRAPHICS_KEYS\.has\(s\?\.key\)/.test(ov) && /graphics: readGraphics\(\)/.test(ov));
  ctx.ok("index.mjs declares settingPrefix: PREFIX", /settingPrefix:\s*PREFIX/.test(index));
  const main = read(`${DIO}/main.mjs`);
  const binds = [...main.matchAll(/keybindings\.register\(\s*SUITE_ID\s*,\s*"([^"]+)"/g)].map((m) => m[1]);
  ctx.ok("keybindings are dio.-prefixed", binds.length >= 4 && binds.every((k) => k.startsWith(C.PREFIX)), binds.join(", "));
  ctx.ok("Shift+V toggles the view", /"dio\.toggle"[\s\S]{0,200}key:\s*"KeyV",\s*modifiers:\s*\["Shift"\]/.test(main));
  // The way in and out is ONE toggle in the Token Controls; the view's tools join it there while
  // it is open, and nothing of the view's is pinned on the board. Edit terrain stays in the suite group.
  ctx.ok("the 3D view is a toggle in the Token Controls", /controls\.tokens/.test(main) && /tools\[TOOL_VIEW\] = \{[\s\S]{0,400}toggle: true/.test(main));
  ctx.ok("the view's tools join the Token Controls only while it is open", /if \(isOpen\(\)\) \{[\s\S]{0,200}VIEW_TOOLS\.forEach/.test(main));
  ctx.ok("Edit terrain goes through the suite group", /ensureSuiteGroup\(controls\)[\s\S]{0,200}TOOL_EDIT/.test(main));
  ctx.ok("nothing of the view's is pinned on the board", !/\bel\("button"/.test(read(`${DIO}/view/hud.mjs`)) && !existsSync(join(ctx.root, `${DIO}/view/entry.mjs`)));
  ctx.ok("main.mjs imports the view lazily", !/^import[^;]*view\/overlay\.mjs/m.test(main) && /import\("\.\/view\/overlay\.mjs"\)/.test(main));
  for (const f of files) {
    if (/^import[^;]*render\/renderer\.mjs/m.test(read(f))) ctx.ok(`${f} imports the renderer lazily`, false);
  }
  ctx.ok("socket handlers trust only the attested sender", /meta\?\.attested/.test(read(`${DIO}/view/sync.mjs`)) && !/_claimed\b[^,)]/.test(read(`${DIO}/view/sync.mjs`)));

  /* ── nothing at import ── */
  for (const f of files) {
    const bad = topLevelEffects(read(f));
    ctx.ok(`${f.replace(`${DIO}/`, "")} has no module-scope side effects`, bad.length === 0, bad.join("; "));
  }
  ctx.ok("the scanner sees a module-scope hook", topLevelEffects("Hooks.on('x', () => {});\nfunction f() { Hooks.on('y'); }").length === 1);
  ctx.ok("the scanner ignores strings and templates", topLevelEffects("const s = `${a} { Hooks.on( }`; const r = /\\{/; function f(){}").length === 0);

  /* ── stylesheet ── */
  const sheets = readdirSync(join(ctx.root, "styles")).filter((f) => /^diorama.*\.css$/.test(f));
  ctx.ok("styles/diorama.css exists", sheets.includes("diorama.css"));
  for (const f of sheets) {
    const css = read(`styles/${f}`).replace(/\/\*[\s\S]*?\*\//g, "");
    ctx.ok(`${f}: no raw white veil`, !/rgba?\(\s*255\s*,\s*255\s*,\s*255/i.test(css));
    ctx.ok(`${f}: no @font-face or network @import`, !/@font-face|@import\s+url\(\s*['"]?http/i.test(css));
    const frames = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]);
    ctx.ok(`${f}: keyframes are gldio-prefixed`, frames.every((k) => k.startsWith("gldio-")), frames.join(", "));
    const noVar = css.replace(/var\([^()]*(\([^()]*\))*[^()]*\)/g, "");
    const raw = noVar.match(/(?<![\w-])\d*\.?\d+(?:ms|s)(?![\w-])/g) ?? [];
    ctx.ok(`${f}: no raw durations`, raw.length === 0, raw.join(", "));
    const hex = css.match(/#[0-9a-f]{3,8}\b/gi) ?? [];
    ctx.ok(`${f}: no raw hex colours`, hex.length === 0, hex.join(", "));
    const redeclared = [...css.matchAll(/(?:^|[;{\s])(--gl-(?!accent\b)[\w-]+)\s*:/g)].map((m) => m[1]);
    ctx.ok(`${f}: no foundation token redeclared`, redeclared.length === 0, redeclared.join(", "));
  }
  const css = read("styles/diorama.css");
  const classes = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([a-z][\w-]*)/g)].map((m) => m[1])
    .filter((c) => !c.startsWith("gl-") && !c.startsWith("gldio-"))
    // The stream feature's public body classes (stream/constants.js CLASSES), read, never styled.
    .filter((c) => c !== "gluniverse-stream-active" && c !== "gluniverse-stream-restore");
  ctx.ok("diorama.css: every class is gldio- or a suite utility", classes.length === 0, [...new Set(classes)].join(", "));
  ctx.ok("the view's buttons declare their own font-size", /\.gldio-btn\.gl-btn\s*\{[^}]*font-size:/.test(css));
  for (const tone of ["warn", "hazard", "peril"]) ctx.ok(`label tone ${tone} is styled`, css.includes(`[data-tone="${tone}"]`));
  const hudSrc = read(`${DIO}/view/hud.mjs`);
  for (const cls of [...hudSrc.matchAll(/class:\s*"([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/))) {
    if (cls.startsWith("gldio-")) ctx.ok(`.${cls} is styled`, css.includes(`.${cls}`));
  }

  /* ── pure decisions ── */
  const Snap = await import(ctx.url(`${DIO}/view/snapshot.mjs`));
  const { Terrain } = await import(ctx.url(`${DIO}/terrain/model.mjs`));
  const W = (o) => ({ id: "w1", c: [200, 0, 200, 400], door: 0, ds: 0, sight: 20, move: 20, ...o });
  const kind = (o, gm) => JSON.stringify(Snap.wallKind(W(o), gm));
  ctx.ok("a plain wall is a wall", kind({}, false) === JSON.stringify({ type: "wall", door: "none" }));
  ctx.ok("a door carries its state", kind({ door: 1, ds: 1 }, false) === JSON.stringify({ type: "door", door: "open" })
    && kind({ door: 1, ds: 2 }, false) === JSON.stringify({ type: "door", door: "locked" }));
  ctx.ok("a secret door is a secret door to the GM", kind({ door: 2, ds: 0 }, true) === JSON.stringify({ type: "secret", door: "closed" }));
  ctx.ok("a closed secret door is a plain wall to a player", kind({ door: 2, ds: 0 }, false) === JSON.stringify({ type: "wall", door: "none" })
    && kind({ door: 2, ds: 2 }, false) === JSON.stringify({ type: "wall", door: "none" }));
  ctx.ok("an open secret door is an open door to a player", kind({ door: 2, ds: 1 }, false) === JSON.stringify({ type: "door", door: "open" }));
  ctx.ok("window / terrain / invisible walls", Snap.wallKind(W({ sight: 30 }), false).type === "window"
    && Snap.wallKind(W({ sight: 10 }), false).type === "terrain" && Snap.wallKind(W({ sight: 0 }), false).type === "invisible");
  ctx.ok("a wall that blocks nothing is no wall", Snap.wallKind(W({ sight: 0, move: 0 }), false) === null);

  const t = Terrain.blank(4, 4);
  for (let si = 0; si < 8; si++) for (let sj = 4; sj < 8; sj++) t.set(si, sj, { h: 8 });
  t.walls = { w1: "hedge" };
  const ws = Snap.wallState(W(), { isGM: false, terrain: t, size: 100, distance: 5, defaultMaterial: "plaster" });
  ctx.ok("a wall on a ledge stands on its top", ws.baseQ === 8 && ws.topQ === 8 + t.wallHeight, JSON.stringify(ws));
  ctx.ok("a wall's own material beats the default", ws.material === "hedge");
  const ws2 = Snap.wallState(W({ id: "w2" }), { isGM: false, terrain: t, size: 100, distance: 5, defaultMaterial: "nonsense" });
  ctx.ok("an unknown default material falls back to stone", ws2.material === "stone");
  const ws3 = Snap.wallState(W({ flags: { "wall-height": { top: 20 } } }), { isGM: false, terrain: t, size: 100, distance: 5, defaultMaterial: "stone" });
  ctx.ok("a Wall Height top is honoured", ws3.topQ === 16, JSON.stringify(ws3));
  const ws4 = Snap.wallState(W({ flags: { "wall-height": { top: null } } }), { isGM: false, terrain: null, size: 100, distance: 5, defaultMaterial: "stone" });
  ctx.ok("no terrain: a wall stands at 0", ws4.baseQ === 0 && ws4.topQ > 0);
  ctx.ok("a malformed wall is dropped", Snap.wallState(W({ c: [0, 0, "x", 1] }), { isGM: true, terrain: null, size: 100, distance: 5 }) === null);

  const art = Snap.tokenArtFor;
  ctx.ok("the actor's standee art wins", art({ standee: "s.webp", actorImg: "a.webp", tokenImg: "t.webp" }) === "s.webp");
  ctx.ok("otherwise the portrait (a bestiary creature stands as its art)", art({ actorImg: "a.webp", tokenImg: "t.webp" }) === "a.webp"
    && art({ actorImg: "a.webp", tokenImg: null }) === "a.webp");
  ctx.ok("the mystery-man portrait falls back to the token", art({ actorImg: Snap.DEFAULT_ART, tokenImg: "t.webp" }) === "t.webp");
  // One answer for every viewer: a token image that drifted from its prototype
  // (placed before a prototype edit) once showed players the round token while
  // the GM saw the portrait. Nothing about the viewer may enter the rule.
  ctx.ok("standee art is the same for every viewer", art({ canObserve: false, actorImg: "a.webp", tokenImg: "old-token.webp", protoImg: "new-token.webp" }) === "a.webp"
    && art({ canObserve: true, actorImg: "a.webp", tokenImg: "old-token.webp", protoImg: "new-token.webp" }) === "a.webp");
  const snapSrc = read(`${DIO}/view/snapshot.mjs`);
  const readBody = snapSrc.slice(snapSrc.indexOf("export function readTokens"), snapSrc.indexOf("export function backgroundSrc"));
  ctx.ok("readTokens asks nothing about the viewer for the art", !/testUserPermission|canObserve|isGM[^\n]*art/.test(readBody.slice(readBody.indexOf("const art"), readBody.indexOf("const marks"))));
  const saSrc = read(`${DIO}/view/standee-app.mjs`);
  ctx.ok("the Standee window saves to the world actor behind a token", /export function standeeTarget/.test(saSrc) && /baseActor/.test(saSrc) && /standeeTarget\(actor\)/.test(saSrc));

  const p1 = Snap.pathCellsTo([{ i: 0, j: 0 }], { i: 2, j: 3 });
  const contiguous = p1.every((c, k) => !k || (Math.abs(c.i - p1[k - 1].i) <= 1 && Math.abs(c.j - p1[k - 1].j) <= 1));
  ctx.ok("a drag path is contiguous", contiguous && p1.length === 4 && p1.at(-1).i === 2 && p1.at(-1).j === 3, JSON.stringify(p1));
  const p2 = Snap.pathCellsTo(p1, { i: 1, j: 1 });
  ctx.ok("dragging back over the path un-draws it", p2.length === 2 && p2[1].i === 1 && p2[1].j === 1, JSON.stringify(p2));
  ctx.ok("backgroundSrc prefers the Level's art", Snap.backgroundSrc({ initialLevel: { background: { src: "l.webp" } }, background: { src: "s.webp" } }) === "l.webp"
    && Snap.backgroundSrc({ background: { src: "s.webp" } }) === "s.webp");

  const { nextCombatant } = await import(ctx.url(`${DIO}/integrations/turns.mjs`));
  const A = { id: "a" }, B = { id: "b", isDefeated: true }, Cc = { id: "c", hidden: true }, D = { id: "d" };
  ctx.ok("next skips the defeated", nextCombatant([A, B, D], 0)?.id === "d");
  ctx.ok("next wraps the round", nextCombatant([A, B, D], 2)?.id === "a");
  ctx.ok("next honours a skip rule", nextCombatant([A, Cc, D], 0, (c) => c.hidden)?.id === "d");
  ctx.ok("next is never the current one", nextCombatant([A], 0) === null && nextCombatant([A, B], 0) === null && nextCombatant([], 0) === null);

  const { canViewMode, playersSeeBars, DISPLAY } = await import(ctx.url(`${DIO}/integrations/bars.mjs`));
  ctx.ok("display modes follow Foundry", !canViewMode(DISPLAY.NONE, { isOwner: true, hovered: true, controlled: true })
    && canViewMode(DISPLAY.ALWAYS) && canViewMode(DISPLAY.CONTROL, { controlled: true }) && !canViewMode(DISPLAY.CONTROL, { hovered: true })
    && canViewMode(DISPLAY.HOVER, { hovered: true }) && !canViewMode(DISPLAY.OWNER_HOVER, { hovered: true })
    && canViewMode(DISPLAY.OWNER_HOVER, { hovered: true, isOwner: true }) && canViewMode(DISPLAY.OWNER, { isOwner: true }));
  ctx.ok("view as players shows a bar only some player could see", playersSeeBars(DISPLAY.ALWAYS, false) && playersSeeBars(DISPLAY.HOVER, false)
    && !playersSeeBars(DISPLAY.OWNER, false) && playersSeeBars(DISPLAY.OWNER, true) && !playersSeeBars(DISPLAY.NONE, true) && !playersSeeBars(DISPLAY.CONTROL, false));

  // The bars are the 2D canvas's own, never a diorama lookalike (view/bar-layer.mjs).
  const { frameOf } = await import(ctx.url(`${DIO}/view/bar-layer.mjs`));
  const fr = frameOf({ cx: 200, footY: 300, headY: 100, w: 80 }, { left: 10, top: 20 });
  ctx.ok("a bar frame is the standee's base box in the layer's px", fr?.x === 150 && fr.y === 280 && fr.w === 80 && fr.h === 0 && frameOf(null, { left: 0, top: 0 }) === null, JSON.stringify(fr));
  const layerSrc = read(`${DIO}/view/bar-layer.mjs`);
  ctx.ok("the bar layer draws no bar of its own", !/beginFill|drawRect|drawRoundedRect|fillRect|\.fill\(/.test(layerSrc)
    && /token\.bars|bars\[key\]/.test(layerSrc) && /api\?\.project/.test(layerSrc));
  ctx.ok("the 3D hover is the 2D token's", /_onHoverIn\(/.test(layerSrc) && /_onHoverOut\(/.test(layerSrc)
    && /bridgeHover\(/.test(read(`${DIO}/view/overlay.mjs`)));
  const rbHost = read("scripts/features/resource-bars/host.mjs"), rbMain = read("scripts/features/resource-bars/main.mjs");
  ctx.ok("Resource Bars draws the 3D bars through a projected host", /export function projectedHost\(/.test(rbHost) && /project:\s*\(view\)/.test(rbMain));
  ctx.ok("the snapshot carries no bar readings", !/barsFor|\bbars:/.test(read(`${DIO}/view/snapshot.mjs`)));
  const artSrc = read(`${DIO}/render/art.mjs`);
  ctx.ok("the plate draws no bar", !/barFrom|bars\b.*frac/.test(artSrc));

  // Targeting: the line lands on the head, the mark over it is the targeter's colour.
  ctx.ok("the target line ends at the head", /anchorOf\([^)]*"head"/.test(read(`${DIO}/render/links.mjs`)) && !/anchorOf\([^)]*"base"/.test(read(`${DIO}/render/links.mjs`)));
  ctx.ok("each targeter gets a mark in their own colour", /targetMark\(g, x, y, MARK, col\)/.test(artSrc) && /MARKS_MAX/.test(artSrc));

  // See-through: occluders open around figures; figures and the floor they stand on never do.
  const glsl = await import(ctx.url(`${DIO}/render/glsl.mjs`));
  const pglsl = await import(ctx.url(`${DIO}/render/props-glsl.mjs`));
  const opens = (src) => { const m = src.match(/void main\(\) \{([\s\S]*)/); return !!m && /dioSeeThrough\(vWorld\);/.test(m[1].split(/\n\s*(?:vec|float|bool)\s/)[0]); };
  const occluders = { top: glsl.PROGRAMS.top, side: glsl.PROGRAMS.side, wall: glsl.PROGRAMS.wall,
    prop: pglsl.PROPS_PROGRAMS?.prop, propModel: pglsl.PROPS_PROGRAMS?.propModel, propCard: pglsl.PROPS_PROGRAMS?.propCard,
    slabTop: pglsl.PROPS_PROGRAMS?.slabTop, slabSide: pglsl.PROPS_PROGRAMS?.slabSide };
  const shut = Object.entries(occluders).filter(([, p]) => !p || !opens(p.fragment)).map(([k]) => k);
  ctx.ok("every occluder opens around a figure", !shut.length, shut.join(", "));
  const card = glsl.PROGRAMS.card ?? glsl.PROGRAMS.standee;
  ctx.ok("a figure's own card is never cut", !card || !/dioSeeThrough\(vWorld\)/.test(card.fragment));
  const rSrc = read(`${DIO}/render/renderer.mjs`);
  ctx.ok("the cut is written every frame, and off with the cutaway", /this\.writeSeeThrough\(/.test(rSrc)
    && /!this\.options\.cutaway[^\n]*uSeeCount\.value = 0/.test(rSrc) && /uSeeSeg\.value\[n\]\.set/.test(rSrc) && /uSeeInfo\.value\[n\]\.set/.test(rSrc));
  ctx.ok("the cut keeps a ghost of the occluder", glsl.SEE_KEEP > 0 && glsl.SEE_KEEP < 0.5 && glsl.SEE_MAX >= 8);
  ctx.ok("the cut reads no texture in its loop (ANGLE)", (() => { const m = glsl.PROGRAMS.top.fragment.match(/float dioSeeCut[\s\S]*?\n\}/); return m && !/texture/.test(m[0]); })());

  const { classifyEffect } = await import(ctx.url(`${DIO}/integrations/sequencer.mjs`));
  ctx.ok("a GM override wins", classifyEffect({ file: "a/aura.webm", stretch: true }, { "a/aura.webm": "standing" }) === "standing");
  ctx.ok("stretched effects and rays are beams", classifyEffect({ file: "x.webm", stretch: true }) === "beam" && classifyEffect({ file: "jb2a/scorching_ray.webm" }) === "beam");
  ctx.ok("auras and template effects lie flat", classifyEffect({ file: "jb2a/aura_01.webm" }) === "flat" && classifyEffect({ file: "x.webm", onTemplate: true }) === "flat");
  ctx.ok("everything else stands", classifyEffect({ file: "jb2a/explosion.webm" }) === "standing" && classifyEffect() === "standing");
  ctx.ok("an invalid override is ignored", classifyEffect({ file: "a.webm" }, { "a.webm": "sideways" }) === "standing");

  const { cellsInRect, isTemplateRegion } = await import(ctx.url(`${DIO}/integrations/templates.mjs`));
  const circle = cellsInRect({ x: 100, y: 100, width: 300, height: 300 }, 100, { cols: 10, rows: 10 }, (x, y) => Math.hypot(x - 250, y - 250) <= 150);
  ctx.ok("template cells are centre-in", circle.length === 9, String(circle.length));
  ctx.ok("template cells stay on the grid", cellsInRect({ x: -500, y: -500, width: 2000, height: 2000 }, 100, { cols: 3, rows: 2 }, () => true).length === 6);
  ctx.ok("templates are recognised", isTemplateRegion({ flags: { core: { MeasuredTemplate: {} } } }) && isTemplateRegion({ flags: { pf2e: { areaShape: "burst" } } }) && !isTemplateRegion({ flags: {} }));

  const { dedupeIcons, MAX_ICONS } = await import(ctx.url(`${DIO}/integrations/conditions.mjs`));
  const icons = dedupeIcons([{ icon: "a" }, { icon: "a", value: 2 }, { icon: null }, { icon: "b", value: 2 }]);
  ctx.ok("condition icons de-duplicate", icons.length === 2 && icons[1].value === 2 && icons[0].value === null, JSON.stringify(icons));
  ctx.ok("condition icons are capped", dedupeIcons(Array.from({ length: 30 }, (_, k) => ({ icon: String(k) }))).length === MAX_ICONS);

  const { lightTint } = await import(ctx.url(`${DIO}/view/bake.mjs`));
  const white = lightTint({ alpha: 0.5, luminosity: 0.5 }, null);
  ctx.ok("an uncoloured light is white", white.every((v) => v === 255), JSON.stringify(white));
  const red = lightTint({ alpha: 0.5, luminosity: 0.5 }, [1, 0, 0]);
  ctx.ok("a coloured light takes its colour", red[0] === 255 && red[1] === 0 && red[2] === 0, JSON.stringify(red));

  const { validPayload, usersOnScene } = await import(ctx.url(`${DIO}/view/sync.mjs`));
  ctx.ok("socket payloads are shape-checked", validPayload({ type: "invite", sceneId: "s" }) && !validPayload({ type: "invite" })
    && !validPayload({ type: "summon", sceneId: "s" }) && validPayload({ type: "summon", sceneId: "s", camera: {} }) && !validPayload({ type: "evil", sceneId: "s" }));
  globalThis.game = { user: { id: "gm" }, users: [
    { id: "gm", active: true, isSelf: true, viewedScene: "s" },
    { id: "p1", active: true, viewedScene: "s" },
    { id: "p2", active: true, viewedScene: "other" },
    { id: "p3", active: false, viewedScene: "s" },
  ] };
  ctx.ok("invites go to active users on the scene only", JSON.stringify(usersOnScene("s")) === JSON.stringify(["p1"]));
  delete globalThis.game;

  const { sanitizeCamera } = await import(ctx.url(`${DIO}/view/overlay.mjs`));
  const cam = sanitizeCamera({ yawStep: -1, pitchIndex: 9, zoom: 99, target: { x: 10, y: 20 } }, 45);
  ctx.ok("a summoned camera is clamped", cam && cam.yawStep === C.CAMERA.yawSteps - 1 && cam.pitchIndex === C.CAMERA.pitches.length - 1 && cam.zoom === C.CAMERA.maxZoom, JSON.stringify(cam));
  // 90° snap (the default): only the four diagonals, every step lands on one.
  const snapped = [-3, -1, 0, 1, 3, 5, 7, 9].map((s) => sanitizeCamera({ yawStep: s, pitchIndex: 0, zoom: 1, target: { x: 0, y: 0 } }, 90).yawStep);
  ctx.ok("a 90° snap keeps the camera on the even (diagonal) steps", snapped.every((s) => s % 2 === 0 && s >= 0 && s < C.CAMERA.yawSteps), snapped.join(","));
  ctx.ok("the default snap is 90°", sanitizeCamera({ yawStep: 3, pitchIndex: 0, zoom: 1, target: { x: 0, y: 0 } }).yawStep % 2 === 0);
  const turns = [];
  let s = 0;
  for (let i = 0; i < 4; i++) { s = C.snapYawStep(s + C.yawStride(90), 90); turns.push(s); }
  ctx.ok("four 90° turns visit the four diagonals and come home", turns.join(",") === "2,4,6,0", turns.join(","));
  // The stream follow maps a 2D zoom onto the 3D one through VIEW_CELLS, which
  // the overlay restates rather than importing three.js; the two must agree.
  const camSrc = readFileSync(join(ctx.root, `${DIO}/render/camera.mjs`), "utf8");
  const ovSrc = readFileSync(join(ctx.root, `${DIO}/view/overlay.mjs`), "utf8");
  const vc = (s) => Number(/export const VIEW_CELLS = (\d+(?:\.\d+)?)/.exec(s)?.[1]);
  ctx.ok("the overlay's VIEW_CELLS matches the camera rig's", vc(camSrc) > 0 && vc(camSrc) === vc(ovSrc), `${vc(camSrc)} vs ${vc(ovSrc)}`);
  // On the stream capture the stream camera owns the shot: every road of ours
  // that moves the 3D camera stands down, and canvasPan drives it instead.
  const fnBody = (name) => { const m = new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`).exec(ovSrc); return m ? m[1] : ""; };
  ctx.ok("follow() stands down for the stream camera", /streamOwnsView\(\)/.test(fnBody("follow")));
  ctx.ok("a summon stands down for the stream camera", /streamOwnsView\(\)/.test(fnBody("applySummon")));
  ctx.ok("the 3D camera follows canvas pans on the stream capture", /on\("canvasPan"/.test(ovSrc) && /streamOwnsView\(\)/.test(fnBody("followCanvas")));
  const syncSrc = readFileSync(join(ctx.root, `${DIO}/view/sync.mjs`), "utf8");
  ctx.ok("an invite never asks the stream audience (no toast in stream mode)", /mode === "auto" \|\| streamOwnsView\(\)/.test(syncSrc));
  const viewCss = readFileSync(join(ctx.root, "styles/diorama.css"), "utf8");
  ctx.ok("the stream capture hides the view's chrome", /body\.gluniverse-stream-active:not\(\.gluniverse-stream-restore\)[^{]*\.gldio-toast[^{]*\.gldio-peek/.test(viewCss));
  ctx.ok("the view sits at the board's layer so Stage portraits draw over it", /\.gldio-view \{[^}]*z-index: var\(--gl-z-base\);/.test(viewCss));
  ctx.ok("a malformed camera is refused", sanitizeCamera({ yawStep: 0, pitchIndex: 0, zoom: 1, target: { x: "a" } }) === null && sanitizeCamera(null) === null);
}
