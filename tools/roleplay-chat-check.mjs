#!/usr/bin/env node
/**
 * Roleplay Chat — consistency check.
 *
 * Nearly everything in this feature fails silently. A mode posted under the wrong chat style files under
 * the wrong stream filter row on any reader that cannot see the flag; a slash command matched one
 * character too loosely eats `/icy`; a Do line whose name is cut twice drops a word of the writer's;
 * a bubble drawn for a line the viewer was not sent is a whisper read over somebody's token; a runtime
 * key that is missing prints itself on every screen; a class the renderer emits with no rule behind it
 * is a balloon drawn as bare text. This tool drives the pure model and renderers under plain Node and
 * reads the glue for the few shapes that cannot be driven.
 *
 * It cannot prove what a session renders: only a live session can.
 *
 *   node tools/roleplay-chat-check.mjs
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const FEATURE = "scripts/features/roleplay-chat";
const problems = [];
let checks = 0;
const fail = (msg) => problems.push(msg);
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/([^:"'`])\/\/.*$/gm, "$1");
const eq = (actual, expected, what) => {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${what}: expected ${e}, got ${a}`);
};
const ok = (cond, what) => {
  checks++;
  if (!cond) fail(what);
};

const M = await import(new URL(`../${FEATURE}/model.mjs`, import.meta.url));
const R = await import(new URL(`../${FEATURE}/render.mjs`, import.meta.url));
const { RP_MODES, RP_IC_MODES, rpModeFlags, rpModeOf } = await import(new URL("../scripts/core/rp-mode.mjs", import.meta.url));
const { CHAT_FILTER_ROWS, DEFAULT_CHAT_FILTER, RP_MODE_ROWS, classifyMessage } = await import(new URL("../scripts/features/stream/chat-filter.mjs", import.meta.url));
const { RP_TEXT, TEXT_STYLES, textRowOf } = await import(new URL("../scripts/features/stream-cards/text/read-text.js", import.meta.url));

const featureFiles = readdirSync(join(ROOT, FEATURE)).filter((f) => /\.mjs$/.test(f));
const sources = Object.fromEntries(featureFiles.map((f) => [f, strip(read(`${FEATURE}/${f}`))]));
const lang = JSON.parse(read("lang/roleplay-chat.en.json"));
const streamLang = JSON.parse(read("lang/stream.en.json"));
const css = read("styles/roleplay-chat.css");
const cssBare = css.replace(/\/\*[\s\S]*?\*\//g, "");

/* ── purity ──────────────────────────────────────────────────────────────── */
// The model and the renderers are what the check tool and the preview page drive. The moment either
// reads the world, the preview has to reimplement it and flatters whichever copy was touched last.
for (const file of ["model.mjs", "render.mjs", "constants.mjs"]) {
  ok(!/\b(game|canvas|ui|foundry|Hooks|document|window|CONFIG|CONST)\s*[.?[]/.test(sources[file]), `${file}: reads the world or the DOM — it must stay pure`);
}

/* ── nothing at import ───────────────────────────────────────────────────── */
// A disabled feature must leave Foundry's chat exactly as it was, so nothing may run at module scope.
for (const [file, src] of Object.entries(sources)) {
  ok(!/^(Hooks|document|game|canvas|ui|CONFIG)\b/m.test(src), `${file}: a statement at module scope touches Foundry — wire it in onInit/onReady`);
}
{
  const index = sources["index.mjs"];
  const init = index.indexOf("onInit()");
  const first = index.indexOf("Hooks.on(");
  ok(init > 0 && first > init, "index.mjs: registers a hook outside onInit/onReady");
}

/* ── modes, styles and flags ─────────────────────────────────────────────── */
eq(Object.fromEntries(RP_MODES.map((m) => [m, M.styleFor(m)])), { say: 2, do: 3, think: 2, narrator: 2, ooc: 1 }, "styleFor");
for (const mode of RP_MODES) eq(rpModeOf(rpModeFlags(mode)), mode, `rp-mode round trip for ${mode}`);
eq(rpModeOf({ "gluniverse-foundry-modules": { "rp.mode": "say" } }), "say", "rpModeOf reads the dotted flag shape setFlag sends");
eq(rpModeOf({ "gluniverse-foundry-modules": { rp: { mode: "shout" } } }), null, "rpModeOf refuses an unknown mode");

// The stream files a line by its flag; a reader that cannot see the flag files it by its style. They
// must agree for every mode the style can carry — Think is the one that cannot, and lands under speech.
for (const mode of RP_MODES) {
  const row = RP_TEXT[mode].row;
  eq(RP_MODE_ROWS[mode], row, `chat-filter RP_MODE_ROWS.${mode} agrees with read-text RP_TEXT`);
  eq(textRowOf({ style: M.styleFor(mode), flags: rpModeFlags(mode), content: "x" }), row, `read-text files ${mode} by its flag`);
  eq(classifyMessage({ style: M.styleFor(mode), rpMode: mode }), row, `classifyMessage files ${mode} by its flag`);
  if (mode !== "think") eq(TEXT_STYLES[M.styleFor(mode)].row, row, `${mode}'s chat style alone files it under the same row`);
  ok(CHAT_FILTER_ROWS.some((r) => r.id === row), `${mode}: row "${row}" is not a chat filter row`);
}
eq(DEFAULT_CHAT_FILTER.rows.ooc, { player: false, gm: false }, "the ooc row ships off in both columns");
eq(DEFAULT_CHAT_FILTER.rows.thought, { player: true, gm: true }, "the thought row ships on");
for (const row of CHAT_FILTER_ROWS) {
  for (const part of ["name", "hint"]) {
    const key = `GLUNIVERSE_STREAM.chatFilter.row.${row.id}.${part}`;
    ok(key in streamLang, `lang/stream.en.json: ${key} is missing — the Chat Filter page builds it at runtime`);
  }
}

{
  const say = M.buildMessage({ mode: "say", body: "Hello", speaker: { scene: "s", actor: "a", token: "t", alias: "Bram" }, authorId: "u", messageMode: "public" });
  eq(say.options, { messageMode: "public", chatBubble: false }, "buildMessage: core bubbles stand down and the mode is passed");
  eq(say.data.style, 2, "buildMessage: say is IC");
  eq(rpModeOf(say.data.flags), "say", "buildMessage: the flag is written");
  const ooc = M.buildMessage({ mode: "ooc", body: "brb", speaker: { alias: "Bram" }, authorId: "u", messageMode: "public" });
  ok(!("speaker" in ooc.data), "buildMessage: OOC carries no speaker, as Foundry's own /ooc does");
  const doLine = M.buildMessage({ mode: "do", body: "Bram Holt draws", speaker: { alias: "Bram Holt" }, authorId: "u", messageMode: "public" });
  eq(doLine.data.content, "draws", "buildMessage: a Do line is stored without its speaker's name");
  eq(doLine.data.style, 3, "buildMessage: Do is EMOTE");
  const narr = M.buildMessage({ mode: "narrator", body: "Night falls.", speaker: M.narratorSpeaker("s", "Narrator"), authorId: "u", messageMode: "public" });
  eq(narr.data.speaker, { scene: "s", actor: null, token: null, alias: "Narrator" }, "buildMessage: a narrator line is nobody");
}
eq(M.visibilityMode("gm", false), "gm", "a typed line follows the user's message mode");
eq(M.visibilityMode("ic", false), "public", "Foundry's IC message mode posts publicly");
eq(M.visibilityMode("blind", true), "public", "a slash command posts publicly");
ok(!/messageMode:\s*"ic"/.test(sources["send.mjs"]), "send.mjs: posts with Foundry's IC message mode — that draws a core bubble beside ours");

/* ── slash commands ──────────────────────────────────────────────────────── */
const parse = (html, mode = "say") => {
  const r = M.parseInput(html, mode);
  return r.pass ? "pass" : [r.mode, r.body, r.override];
};
eq(parse("<p>/ooc brb</p>"), ["ooc", "brb", true], "/ooc");
eq(parse("/ic Hold the line"), ["say", "Hold the line", true], "/ic");
eq(parse("/em waves"), ["do", "waves", true], "/em");
eq(parse("/emote waves"), ["do", "waves", true], "/emote");
eq(parse("/me waves"), ["do", "waves", true], "/me");
eq(parse("/think hmm"), ["think", "hmm", true], "/think");
eq(parse("/THINK hmm"), ["think", "hmm", true], "/THINK is case-insensitive");
eq(parse("<p>/em&nbsp;waves</p>"), ["do", "waves", true], "/em with a non-breaking space");
eq(parse("/ic"), ["say", "", true], "/ic alone");
eq(parse("/icy road"), "pass", "/icy is not /ic");
eq(parse("/r 1d20+5"), "pass", "/r is Foundry's");
eq(parse("/w Bob psst"), "pass", "/w is Foundry's");
eq(parse("/gm psst"), "pass", "/gm is Foundry's");
eq(parse("/m macro"), "pass", "/m is Foundry's");
eq(parse("/thinking"), "pass", "/thinking is not /think");
eq(parse("<p>Hello</p>", "do"), ["do", "Hello", false], "plain text takes the composer's mode");
eq(parse("<p>Hello</p>", "ooc"), ["ooc", "Hello", false], "plain text in OOC");
eq(parse("line one\nline two", "say"), ["say", "line one<br>line two", false], "a newline is a <br>, as Foundry's commands do it");
eq(M.hasText("<p>&nbsp;</p>"), false, "an empty paragraph has no text");

/* ── the composer ────────────────────────────────────────────────────────── */
eq(M.effectiveMode(M.DEFAULT_COMPOSER, true), "say", "default with a speaker is IC/Say");
eq(M.effectiveMode(M.DEFAULT_COMPOSER, false), "ooc", "default with no speaker is OOC");
eq(M.effectiveMode({ ic: true, sub: "think" }, false), "ooc", "no speaker is always OOC");
{
  let s = M.DEFAULT_COMPOSER;
  s = M.toggleIc(s, true);
  eq(M.effectiveMode(s, true), "ooc", "Alt+Q from the default goes OOC");
  s = M.toggleIc(s, true);
  eq(M.effectiveMode(s, true), "say", "Alt+Q again comes back to Say");
  s = M.cycleSub(s, true);
  eq(M.effectiveMode(s, true), "do", "Alt+W: Say → Do");
  s = M.cycleSub(s, true);
  eq(M.effectiveMode(s, true), "think", "Alt+W: Do → Think");
  s = M.cycleSub(s, true);
  eq(M.effectiveMode(s, true), "say", "Alt+W: Think → Say");
  s = M.chooseSub(M.toggleIc(M.chooseSub(s, "think"), true), "do");
  eq(M.effectiveMode(s, true), "do", "picking Do from OOC goes in character");
  s = M.cycleSub(M.toggleIc(s, true), true);
  eq(M.effectiveMode(s, true), "do", "Alt+W from OOC returns to the last mode");
  eq(M.chooseIc(s, true, false).ic, false, "IC cannot be chosen without a speaker");
}
eq(M.composerMode({ ic: true, sub: "think" }, "narrator"), "narrator", "the Narrator's lines are narration");
eq(M.composerMode({ ic: false, sub: "think" }, "narrator"), "ooc", "the Narrator can still talk OOC");
eq(M.lineMode("do", "narrator"), "narrator", "/em as the Narrator is narration");
eq(M.lineMode("narrator", "token"), "say", "a narrator mode with a token speaker is speech");
eq(M.sanitizeComposer({ ic: "yes", sub: "shout" }), { ic: null, sub: "say" }, "sanitizeComposer");

/* ── who speaks ──────────────────────────────────────────────────────────── */
const owned = [{ id: "a" }, { id: "b" }];
eq(M.resolvePlayerSpeaker({ choice: "b", character: { id: "a" }, owned }), { id: "b", source: "chosen" }, "a player's pick wins");
eq(M.resolvePlayerSpeaker({ choice: "z", character: { id: "a" }, owned }), { id: "a", source: "assigned" }, "a pick they no longer own falls back to the assigned character");
eq(M.resolvePlayerSpeaker({ choice: null, character: null, owned }), { id: "a", source: "owned" }, "no assigned character: the first owned actor");
eq(M.resolvePlayerSpeaker({ choice: null, character: null, owned: [] }), null, "owns nothing: no speaker");
eq(M.resolveGmSpeaker({ pin: { kind: "narrator" }, controlled: { tokenId: "t", sceneId: "s" } }), { kind: "narrator", source: "pinned" }, "a narrator pin beats selection");
eq(M.resolveGmSpeaker({ pin: { kind: "token", sceneId: "s", tokenId: "p" }, pinExists: true, controlled: { tokenId: "t", sceneId: "s" } }), { kind: "token", source: "pinned", sceneId: "s", tokenId: "p" }, "a token pin beats selection");
eq(M.resolveGmSpeaker({ pin: { kind: "token", sceneId: "s", tokenId: "gone" }, pinExists: false, controlled: { tokenId: "t", sceneId: "s" } }), { kind: "token", source: "auto", sceneId: "s", tokenId: "t" }, "a pin to a deleted token falls back to selection");
eq(M.resolveGmSpeaker({}), { kind: "narrator", source: "auto" }, "nothing selected: the Narrator");
eq(M.sanitizePin({ kind: "token" }), null, "a token pin with no token is no pin");

/* ── Do lines and the name ───────────────────────────────────────────────── */
const lead = (name, html) => M.stripLeadName(name, html).body;
eq(lead("Seri Valen", "Seri Valen draws her blade"), "draws her blade", "full name cut");
eq(lead("Seri Valen", "Seri draws her blade"), "draws her blade", "first name cut");
eq(lead("Seri Valen", "draws her blade"), "draws her blade", "no name: left alone");
eq(lead("Seri Valen", "Seri's eyes narrow"), "'s eyes narrow", "a possessive keeps its 's");
eq(lead("Seri Valen", "Serious trouble"), "Serious trouble", "a word that starts with the name is not the name");
eq(lead("Bram", "bram nods"), "nods", "case-insensitive");
eq(lead("Bram", "Bram"), "", "the name alone");
eq(lead("Ogre Warlord", "<b>Ogre</b> roars"), "<b>Ogre</b> roars", "a name inside a tag is left as typed");
eq(lead("Kyra & Co", "Kyra &amp; Co bows"), "bows", "a name with an entity in the markup");
eq(lead("", "Bram nods"), "Bram nods", "no speaker name: nothing cut");
eq(lead("Bram", lead("Bram", "Bram Bram nods")), "nods", "cutting twice is the writer's own doing, never ours: buildMessage cuts once");
eq(M.leadJoint("'s eyes"), "", "no space before a possessive");
eq(M.leadJoint("draws"), " ", "a space before a word");
// Thai runs words together, so a Thai name typed onto the front of a Thai line is still the name.
eq(lead("น้ำฝน", "น้ำฝนหยิบแผนที่ขึ้นมาดู"), "หยิบแผนที่ขึ้นมาดู", "a Thai name glued to a Thai line is cut");
eq(lead("น้ำฝน", "น้ำฝน พยักหน้า"), "พยักหน้า", "a Thai name with a space is cut");
eq(lead("Seri", "Seriหยิบดาบ"), "Seriหยิบดาบ", "a Latin name glued to Thai is not cut: only Thai joins Thai");
eq(lead("ก", "กา"), "กา", "a consonant whose vowel follows is not a name boundary");

/* ── asides in a Say line ────────────────────────────────────────────────── */
const parts = (t) => M.splitAsides(t).map((p) => (p.aside ? `[${p.text}]` : p.text)).join("|");
eq(parts("Hold the line! *draws her blade* Run!"), "Hold the line! |[draws her blade]| Run!", "an aside in the middle");
eq(parts("*smiles*"), "[smiles]", "a line that is all aside");
eq(parts("ถอย*ชักดาบ*ไป"), "ถอย|[ชักดาบ]|ไป", "Thai beside the stars still makes an aside");
eq(parts("2*3*4"), "2*3*4", "arithmetic is not an aside");
eq(parts("**bold**"), "**bold**", "a double star is not an aside");
eq(parts("a ** b"), "a ** b", "an empty pair is not an aside");
eq(parts("*  *"), "*  *", "a blank pair is not an aside");
eq(parts("*one\ntwo*"), "*one\ntwo*", "an aside never crosses a line");
eq(M.hasAsides("no stars"), false, "hasAsides on plain words");
{
  const runs = M.asideRuns("Hold the line! *draws her blade* Run!");
  eq(runs.map((r) => r.text), ["Hold the line!", "draws her blade", "Run!"], "asideRuns trims the spaces around an aside");
  eq([runs[1].closes, runs[1].opens], [true, true], "an aside between words closes and reopens the quote");
  eq(M.quoteEdges(runs), { opens: true, closes: true }, "a line of words opens and closes on words");
  const lead2 = M.asideRuns("*sighs* Fine.");
  eq([lead2[0].closes, lead2[0].opens], [false, true], "a leading aside only reopens");
  eq(M.quoteEdges(lead2), { opens: false, closes: true }, "a line starting on an aside has no opening mark");
  eq(M.quoteEdges(M.asideRuns("*smiles*")), { opens: false, closes: false }, "a line of one aside has no marks at all");
}
ok(R.bubbleLineHTML({ mode: "say", name: "S", text: "Go! *runs*" }).includes(`<span class="glrp-aside" data-closes>runs</span>`), "bubbleLineHTML: a Say aside is not set apart");
ok(!R.bubbleLineHTML({ mode: "think", name: "S", text: "*why*" }).includes("glrp-aside"), "bubbleLineHTML: stars in a thought are the writer's emphasis, not an aside");
ok(/data-glrp-close="aside"/.test(R.laneLineHTML({ mode: "say", name: "S", img: null, text: "Go! *runs*" })), "laneLineHTML: a Say line ending on an aside still draws its closing mark");
ok(/markAsides\(/.test(sources["log.mjs"]) && !/\b(content|el)\.innerHTML\s*=\s*lineHTML/.test(sources["log.mjs"]) && /createTreeWalker\(/.test(sources["log.mjs"]), "log.mjs: asides are not marked, or the body is re-parsed rather than its text nodes rewritten");
{
  const { readText } = await import(new URL("../scripts/features/stream-cards/text/read-text.js", import.meta.url));
  const say = readText({ style: 2, content: "Hold! *draws* Run!", flags: rpModeFlags("say"), whisper: [] }, { actor: { name: "Seri" } });
  eq(say?.text?.runs?.map((r) => r.aside), [false, true, false], "readText: a spoken line carries its asides to the stream card");
  const thought = readText({ style: 2, content: "*why*", flags: rpModeFlags("think"), whisper: [] }, { actor: { name: "Seri" } });
  eq("runs" in (thought?.text ?? {}), false, "readText: a thought carries no asides");
}

/* ── the composer's head ─────────────────────────────────────────────────── */
eq(M.composerHead({ mode: "say", name: "Seri Valen", label: "Says" }), "Seri Valen · Says", "the head names who and how");
eq(M.composerHead({ mode: "narrator", name: "Narrator", label: "Narrator" }), "Narrator", "the Narrator's head is one word");
eq(M.composerHead({ mode: "ooc", name: "Seri", label: "OOC" }), "", "OOC has no head");
ok(/--glrp-head/.test(sources["composer.mjs"]) && /--glrp-head/.test(cssBare), "composer: the box's head is not wired to the stylesheet");
ok(/--glrp-speaker/.test(sources["composer.mjs"]) && /var\(--glrp-speaker/.test(cssBare), "composer: the Do line's name prefix is not wired to the stylesheet");
// The in-box preview must not draw beside Foundry's placeholder: it is shown only on a non-empty box.
for (const m of cssBare.matchAll(/([^{}]+)\{[^}]*content:\s*(?:"\\201[CD]"|var\(--glrp-speaker)/g)) {
  if (!/#chat-message/.test(m[1])) continue;
  ok(/:not\(:has\(\.editor-content > p:only-child > br:only-child\)\)/.test(m[1]), `roleplay-chat.css: an in-box mark draws on an empty box: ${m[1].trim().slice(0, 80)}`);
}
{
  const L0 = { sub: { say: "Say", do: "Do", think: "Think" }, source: {} };
  for (const sub of M.SUB_MODES) ok(new RegExp(`data-glrp-sub="${sub}"[^>]*>\\s*<i class="glrp-ico fa-solid ${R.SUB_ICONS[sub]}"`).test(R.barHTML({ mode: sub, canIc: true, sub, speaker: { name: "S" } }, L0)), `barHTML: ${sub} has no icon`);
}
ok(new Set(Object.values(R.MODE_ICONS)).size === Object.keys(R.MODE_ICONS).length, "MODE_ICONS: two tabs share a glyph");
for (const id of ["ooc", ...M.SUB_MODES, "narrator"]) ok(R.MODE_ICONS[id], `MODE_ICONS: tab ${id} has no glyph`);

/* ── the mode strip ──────────────────────────────────────────────────────── */
// One tab per thing a line can be, the pressed one under the tone slab. A tab missing from the strip is
// a mode nobody can reach by mouse; two pressed tabs are a slab drawn under one and a label lit on both.
eq(M.modeTabs({ mode: "say", canIc: true }).map((t) => t.id), ["ooc", "say", "do", "think"], "modeTabs: a character's strip");
eq(M.modeTabs({ mode: "narrator", canIc: true, narrator: true }).map((t) => t.id), ["ooc", "narrator"], "modeTabs: the Narrator's strip");
eq(M.modeTabs({ mode: "ooc", canIc: false }).map((t) => t.disabled), [false, true, true, true], "modeTabs: nobody to speak as disables the in-character tabs, never OOC");
for (const mode of RP_MODES) {
  const tabs = M.modeTabs({ mode, canIc: true, narrator: mode === "narrator" });
  eq(tabs.filter((t) => t.pressed).length, 1, `modeTabs: exactly one tab pressed in ${mode}`);
  const html = R.barHTML({ mode, canIc: true, sub: "say", speaker: { name: "S", narrator: mode === "narrator" }, keys: { toggle: "Alt+Q", cycle: "Alt+W" } }, L0strip());
  const at = Number(html.match(/data-at="(-?\d+)"/)?.[1]);
  eq(Number(html.match(/class="glrp-ink" style="--glrp-at: (\d+)"/)?.[1]), at, `barHTML: the slab sits under the pressed tab in ${mode}`);
  eq(Number(html.match(/--glrp-tabs: (\d+)/)?.[1]), tabs.length, `barHTML: the strip is laid out for its own tab count in ${mode}`);
  ok(/data-tooltip="Alt\+Q · /.test(html), `barHTML: the OOC tab does not name its key in ${mode}`);
}
function L0strip() {
  return { sub: { say: "Say", do: "Do", think: "Think" }, source: {}, ooc: "OOC", narrate: "Narrate", toggleHint: "OOC / IC", cycleHint: "Say, Do, Think", noSpeaker: "n" };
}
ok(/data-glrp-action="ic"/.test(R.barHTML({ mode: "ooc", canIc: true, sub: "say", speaker: { name: "N", narrator: true } }, L0strip())), "barHTML: the Narrator's tab does not go in character");
{
  const c = sources["composer.mjs"];
  // The bar is repainted only when its markup changes: hook storms otherwise reset the picker's scroll
  // and the hover, and replay the slide for a mode that never moved.
  ok(/html !== lastHTML/.test(c), "composer.mjs: the bar is rebuilt on every render, not only when its markup changes");
  ok(/--glrp-from"/.test(c) && /glrp-ink-slide/.test(c), "composer.mjs: the slab no longer slides from the old tab");
  ok(/@keyframes glrp-ink-slide\s*\{[^}]*--glrp-from/.test(cssBare), "roleplay-chat.css: glrp-ink-slide does not start from --glrp-from");
  ok(/glrp-ink-slide\s*~\s*\.glrp-mode\[aria-pressed="true"\]\s*\{[^}]*glrp-tab-on/.test(cssBare), "roleplay-chat.css: the pressed label is ink on black until the slab reaches it");
  // The glass is on ::before: a clip-path on the bar itself clips the picker that opens above it.
  ok(!/\.glrp-bar\s*\{[^}]*clip-path/.test(cssBare), "roleplay-chat.css: the bar is clipped, and so is its picker");
  ok(/pickerStep\(/.test(c), "composer.mjs: the picker has no arrow keys");
}
eq([M.pickerStep(-1, 3, "ArrowDown"), M.pickerStep(2, 3, "ArrowDown"), M.pickerStep(0, 3, "ArrowUp"), M.pickerStep(1, 3, "End"), M.pickerStep(1, 3, "a"), M.pickerStep(0, 0, "ArrowDown")], [0, 0, 2, 2, null, null], "pickerStep");

/* ── the caption lane ────────────────────────────────────────────────────── */
{
  // Centred over the hotbar and never under an open sidebar, however narrow the window.
  const box = M.laneBox({ width: 1440, height: 900, hotbar: { left: 420, right: 920, top: 840 }, sidebarLeft: 1140 });
  eq(box.center, 670, "laneBox: centred on the hotbar");
  ok(box.center + box.width / 2 <= 1140 - M.LANE.gutter, "laneBox: the lane runs under the sidebar");
  eq(box.bottom, 900 - 840 + M.LANE.gap, "laneBox: clear above the hotbar");
  eq(M.laneBox({ width: 1000, height: 700, hotbar: null, sidebarLeft: null }), { center: 500, width: 760, bottom: M.LANE.fallbackBottom }, "laneBox: no hotbar, centred in the window");
  ok(/laneBox\(/.test(sources["overlay.mjs"]) && /getElementById\("sidebar"\)|rect\("sidebar"\)/.test(sources["overlay.mjs"]), "overlay.mjs: the lane is placed without laneBox and the sidebar");
}

/* ── bugs that once shipped ──────────────────────────────────────────────── */
{
  const o = sources["overlay.mjs"];
  // A Say stack replaced by a Think stack over the same token stayed in the layer forever.
  const leave = o.match(/this\.#leave\(line\.el, \(\) => \{([\s\S]*?)\}\);/)?.[1] ?? "";
  ok(leave.indexOf("stack.el.remove()") >= 0 && leave.indexOf("stack.el.remove()") < leave.indexOf("this.stacks.get(stack.key) !== stack"), "overlay.mjs: a replaced stack's element is never removed");
  // A caption stayed off centre, or under the sidebar, until another line arrived.
  ok(/new ResizeObserver\(place\)/.test(o) && /addEventListener\("resize", place\)/.test(o) && /removeEventListener\("resize"/.test(o), "overlay.mjs: the lane is not re-placed when the window or the sidebar changes size");
  // A whisper chosen mid-sentence left the public "…" up until the next key.
  ok(/clientSettingChanged/.test(sources["index.mjs"]) && /core\.messageMode/.test(sources["index.mjs"]) && /refreshTyping/.test(sources["index.mjs"]), "index.mjs: a message-mode change does not re-decide the typing indicator");
  // A Do line re-parsed the body (losing what an enricher bound) and put the name above a paragraph.
  const l = sources["log.mjs"];
  ok(!/content\.innerHTML\s*=/.test(l) && /addLead\(/.test(l), "log.mjs: a Do line's lead re-parses the body");
}
// A hue set under a selector list holding #chat-message outweighs `[data-glrp-mode]`: the box goes grey.
for (const m of cssBare.matchAll(/([^{}]+)\{[^}]*--glrp-hue\s*:/g)) {
  if (/:is\([^)]*#chat-message/.test(m[1])) fail(`roleplay-chat.css: --glrp-hue is set under ${m[1].trim().slice(0, 60)}…, whose ID weight beats every mode hue`);
}

/* ── typing indicator ────────────────────────────────────────────────────── */
const typing = (o) => M.shouldAnnounceTyping({ mode: "say", visibility: "public", token: { hidden: false }, text: "Hold", ...o });
eq(typing({}), true, "a public Say line over a visible token announces");
eq(typing({ mode: "do" }), true, "so does Do");
eq(typing({ mode: "ooc" }), false, "OOC never announces");
eq(typing({ mode: "narrator" }), false, "the Narrator has no token to type over");
eq(typing({ visibility: "gm" }), false, "a whisper to the GM never announces");
eq(typing({ visibility: "blind" }), false, "nor a blind line");
eq(typing({ token: { hidden: true } }), false, "a hidden token never announces");
eq(typing({ token: null }), false, "no token, nothing to type over");
eq(typing({ text: "   " }), false, "an empty box announces nothing");
eq(typing({ text: "/roll 1d20" }), false, "a slash command is not a line");
const accept = (o) => M.acceptTyping({ attested: true, senderIsGM: false, senderOwns: true, tokenVisible: true, ...o });
eq(accept({}), true, "an owner's attested ping over a visible token");
eq(accept({ attested: false }), false, "an unattested ping is refused");
eq(accept({ senderOwns: false }), false, "a ping over somebody else's token is refused");
eq(accept({ senderOwns: false, senderIsGM: true }), true, "a GM may type over any token");
eq(accept({ tokenVisible: false }), false, "a token this viewer cannot see shows no pill");
ok(M.TYPING.expire > M.TYPING.ping * 2, "TYPING: a pill expires before two pings are missed");
{
  const t = strip(read(`${FEATURE}/typing.mjs`));
  ok(/meta\?\.attested/.test(t) && /acceptTyping\(/.test(t), "typing.mjs: a ping is honoured without the server's attested sender");
  ok(/shouldAnnounceTyping\(/.test(t), "typing.mjs: announces without shouldAnnounceTyping");
  ok(!/\b(text|body|name|content)\s*:/.test(t.match(/emitSocket\([^)]*\)/g)?.join("") ?? ""), "typing.mjs: a ping carries text or a name — it carries a scene and a token only");
  ok(/validate:/.test(t), "typing.mjs: the socket handler takes payloads unvalidated");
  ok(/typing\(.*false\)/.test(sources["overlay.mjs"]) && /speaker\?\.token/.test(sources["overlay.mjs"]), "overlay.mjs: a line's arrival does not take its token's pill down");
  ok(/typers\.size/.test(sources["overlay.mjs"]), "overlay.mjs: the ticker stops while a pill is still up, so it never follows its token");
}
ok(/\.glrp-typing\.glrp-enter\s*\{[^}]*gl-fade-in/.test(cssBare), "roleplay-chat.css: the pill's entrance would overwrite the transform that places it");

/* ── privacy and routing ─────────────────────────────────────────────────── */
// canView mirrors Foundry's ChatMessage#isContentVisible for a message with no rolls.
const view = (o) => M.canView({ authorId: "author", viewerId: "viewer", viewerIsGM: false, whisper: [], blind: false, ...o });
eq(view({}), true, "a public line is read by everyone");
eq(view({ whisper: ["gm"] }), false, "a whisper to somebody else");
eq(view({ whisper: ["viewer"] }), true, "a whisper to the viewer");
eq(view({ whisper: ["gm"], viewerId: "author" }), true, "the author reads their own whisper");
eq(view({ blind: true, viewerId: "author" }), false, "a blind line hides from its own author");
eq(view({ blind: true, viewerId: "author", viewerIsGM: true }), true, "unless the author is a GM");
// The stream login draws for the whole audience, so it reads public lines only, whatever its rights.
const stream = { audience: true, viewerIsGM: true };
eq(view({ ...stream }), true, "the stream login reads a public line");
eq(view({ ...stream, whisper: ["viewer"] }), false, "the stream login never draws a whisper sent to it");
eq(view({ ...stream, whisper: ["viewer"], viewerId: "author" }), false, "nor its own whisper");
eq(view({ ...stream, blind: true, viewerId: "author" }), false, "nor a blind line it wrote as a GM");
eq(M.nameFor({ name: "Ogre", hidden: true, viewerIsGM: false }).unknown, true, "a hidden name reads Unknown to the audience");
const visible = { onScene: true, visible: true, onScreen: true };
const route = (o) => M.routeLine({ mode: "say", canRead: true, overlaysOn: true, suppressed: false, token: visible, ...o });
eq(route({}), "balloon", "Say over a visible token");
eq(route({ mode: "think" }), "balloon", "Think over a visible token");
eq(route({ mode: "do" }), "under", "Do under a visible token");
eq(route({ mode: "narrator" }), "caption", "Narrator in the lane");
eq(route({ token: null }), "caption", "no token: the lane");
eq(route({ token: { ...visible, visible: false } }), "caption", "a token the viewer cannot see: the lane, never over it");
eq(route({ token: { ...visible, onScene: false } }), "caption", "off scene: the lane");
eq(route({ token: { ...visible, onScreen: false } }), "caption", "off screen: the lane");
eq(route({ mode: "ooc" }), null, "OOC is never drawn");
eq(route({ canRead: false }), null, "a line the viewer may not read is never drawn");
eq(route({ canRead: false, mode: "narrator" }), null, "nor in the lane");
eq(route({ overlaysOn: false }), null, "overlays off on this client");
eq(route({ suppressed: true }), null, "the stream login, bubbles suppressed");
eq(M.nameFor({ name: "Ogre", hidden: true, viewerIsGM: false }), { name: null, unknown: true, hiddenFromPlayers: true }, "a hidden name to a player");
eq(M.nameFor({ name: "Ogre", hidden: true, viewerIsGM: true }), { name: "Ogre", unknown: false, hiddenFromPlayers: true }, "a hidden name to the GM, marked");
ok(/canView\(/.test(sources["overlay.mjs"]) && /canRead/.test(sources["overlay.mjs"]), "overlay.mjs: draws without asking canView");
ok(/isContentVisible/.test(sources["log.mjs"]), "log.mjs: restyles an entry without asking isContentVisible — a head over hidden content names the speaker of a line the viewer was not sent");
for (const file of ["overlay.mjs", "log.mjs"]) ok(/identityOf\(/.test(sources[file]), `${file}: names a speaker without identityOf — a hidden name would show on one surface and not another`);
ok(/speakerNameHidden\(/.test(sources["identity.mjs"]), "identity.mjs: the hidden-name rule is not the stream cards' speakerNameHidden");
ok(/viewerIsGM:.*&&\s*!viewsAsAudience\(\)/.test(sources["identity.mjs"]), "identity.mjs: the stream login reads hidden names as a GM, and its log is what the stream clones");
ok(/audience:\s*viewsAsAudience\(\)/.test(sources["overlay.mjs"]), "overlay.mjs: canView is not told the stream login is the audience, so its whispers and blind lines reach the stream");
{
  const overlay = strip(read("scripts/features/stream/chat-overlay.js"));
  ok(/rpModeOf\(/.test(overlay), "stream/chat-overlay.js: does not read the roleplay flag — a whispered line would reach the stream on non-PF2e worlds");
}

/* ── timing and stacking ─────────────────────────────────────────────────── */
eq(M.lifetimeMs(""), 4000, "lifetime of an empty line");
eq(M.lifetimeMs("x".repeat(50)), 7000, "4s + 60ms a character");
eq(M.lifetimeMs("x".repeat(500)), 12000, "capped at 12s");
{
  let list = [];
  const evicted = [];
  for (const id of [1, 2, 3]) {
    const r = M.pushStack(list, id, M.STACK.token);
    list = r.list;
    evicted.push(...r.evicted);
  }
  eq(list, [2, 3], "a token holds two lines");
  eq(evicted, [1], "the oldest leaves first");
}
eq(M.STACK.lane, 3, "the lane holds three lines");
ok(M.overlayScale(0.1) === M.ZOOM_CLAMP.min && M.overlayScale(10) === M.ZOOM_CLAMP.max && M.overlayScale(1) === 1, "overlayScale clamps");
{
  const leave = sources["overlay.mjs"].match(/LEAVE_MS = (\d+)/);
  const glide = read("styles/gl-tokens.css").match(/--gl-d-glide: calc\((\d+)ms/);
  ok(leave && glide && leave[1] === glide[1], "overlay.mjs: LEAVE_MS no longer matches --gl-d-glide, which .glrp-leaving animates on");
  ok(/\.glrp-leaving\s*\{[^}]*--gl-d-glide/.test(cssBare), "roleplay-chat.css: .glrp-leaving no longer animates on --gl-d-glide");
}

/* ── keyboard ────────────────────────────────────────────────────────────── */
const altQ = { key: "KeyQ", modifiers: ["Alt"] };
eq(M.bindingMatches({ code: "KeyQ", altKey: true }, altQ), true, "Alt+Q");
eq(M.bindingMatches({ code: "KeyQ", altKey: true, ctrlKey: true }, altQ), false, "Ctrl+Alt+Q is not Alt+Q");
eq(M.bindingMatches({ code: "KeyQ" }, altQ), false, "Q is not Alt+Q");
eq(M.bindingMatches({ code: "KeyW", ctrlKey: false, metaKey: true }, { key: "KeyW", modifiers: ["Control"] }), true, "Meta counts as Control");
eq(M.humanizeBinding(altQ), "Alt+Q", "humanizeBinding");
eq(M.cssString('say "hi"\\'), '"say \\"hi\\"\\\\"', "cssString escapes quotes and backslashes");

/* ── markup ──────────────────────────────────────────────────────────────── */
const L = {
  switchLabel: "s", ooc: "OOC", narrate: "Narrate", as: "As", sub: { say: "Say", do: "Do", think: "Think" },
  source: { auto: "AUTO", pinned: "PINNED" }, chipTitle: "t", pickerLabel: "p", toggleHint: "t", cycleHint: "c", noSpeaker: "n"
};
const evil = `<img src=x onerror=alert(1)>`;
const markup = [
  R.barHTML({ mode: "say", canIc: true, sub: "say", speaker: { name: evil, img: null, source: "auto" }, pickerOpen: true,
    picker: { groups: [{ heading: evil, rows: [{ key: "k", name: evil, img: null, selected: true, tag: evil }] }] } }, L),
  R.bubbleLineHTML({ mode: "say", name: evil, text: evil }),
  R.bubbleLineHTML({ mode: "do", name: evil, text: evil }),
  R.laneLineHTML({ mode: "think", name: evil, img: null, text: evil }),
  R.laneLineHTML({ mode: "narrator", name: evil, img: null, text: evil }),
  R.logHeadHTML({ mode: "say", name: evil, img: null, label: evil, hiddenFromPlayers: true, hiddenHint: evil })
];
for (const html of markup) ok(!/<img src=x/.test(html), "render.mjs: a name or a line reaches markup unescaped");
ok(!/data-glrp-action="sub"[^>]*disabled/.test(R.barHTML({ mode: "say", canIc: true, sub: "say", speaker: { name: "S" } }, L)), "barHTML: Say/Do/Think are disabled with a speaker");
ok(/data-glrp-action="sub"[^>]*disabled/.test(R.barHTML({ mode: "ooc", canIc: false, sub: "say", speaker: null }, L)), "barHTML: Say/Do/Think are live with no speaker");
ok(/glrp-locked/.test(R.barHTML({ mode: "ooc", canIc: false, sub: "say", speaker: null }, L)), "barHTML: a locked strip does not say why");
ok(!/data-glrp-sub=/.test(R.barHTML({ mode: "narrator", canIc: true, sub: "say", speaker: { name: "Narrator", narrator: true } }, L)), "barHTML: the Narrator is offered Say/Do/Think");
ok(/data-glrp-sub="think"/.test(R.barHTML({ mode: "do", canIc: true, sub: "do", speaker: { name: "Seri" } }, L)), "barHTML: a character is not offered Say/Do/Think");

// Every class the renderers emit has a rule. A class with none is a balloon drawn as bare text.
{
  const allMarkup = [
    ...markup,
    R.bubbleTailHTML("say"),
    R.bubbleTailHTML("think"),
    R.logHeadHTML({ mode: "narrator", name: "N", label: "Narrator" }),
    R.oocTagHTML("OOC"),
    R.barHTML({ mode: "ooc", canIc: false, sub: "say", speaker: null }, L),
    R.barHTML({ mode: "narrator", canIc: true, sub: "say", speaker: { name: "N", narrator: true, source: "pinned" } }, L),
    R.avatarHTML({ img: "a.webp", name: "A" }),
    R.typingHTML(),
    R.lineHTML("say", "a *b* c"),
    R.barHTML({ mode: "say", canIc: true, sub: "say", speaker: { name: "S" } }, L)
  ].join("");
  const emitted = new Set([...allMarkup.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)).filter((c) => c.startsWith("glrp-")));
  const glue = Object.values(sources).join("\n");
  for (const m of glue.matchAll(/["'`](glrp-[a-z0-9-]+)/g)) emitted.add(m[1]);
  for (const m of glue.matchAll(/`glrp-bub glrp-bub--\$\{place\}`/g)) { emitted.add("glrp-bub--above"); emitted.add("glrp-bub--below"); }
  // Classes that are states or roots rather than styled pieces, styled through their children.
  const exempt = new Set(["glrp-on", "glrp-ooc", "glrp-head-wrap", "glrp-", "glrp-bub--"]);
  for (const cls of emitted) {
    if (exempt.has(cls)) continue;
    ok(new RegExp(`\\.${cls}(?![a-z0-9-])`).test(cssBare), `roleplay-chat.css: .${cls} is emitted and has no rule`);
  }
}

/* ── stylesheet rules ────────────────────────────────────────────────────── */
for (const mode of RP_MODES) ok(new RegExp(`\\[data-glrp-mode="${mode}"\\]\\s*\\{\\s*--glrp-hue`).test(cssBare), `roleplay-chat.css: mode ${mode} has no hue`);
for (const [mode, entry] of Object.entries(RP_TEXT)) {
  if (!entry.tone) continue;
  ok(new RegExp(`\\.glus-rc\\[data-tone="${entry.tone}"\\]\\s*\\{\\s*--glus-rc-tone`).test(cssBare), `roleplay-chat.css: the ${mode} card tone "${entry.tone}" has no colour`);
}
ok(!/:root\b/.test(cssBare), "roleplay-chat.css: declares on :root — every value here is feature-local");
ok(!/(^|[;{\s])--gl-[a-z0-9-]+\s*:/m.test(cssBare), "roleplay-chat.css: redeclares a foundation --gl-* token");
ok(!/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(cssBare), "roleplay-chat.css: a raw white veil — strike it from --gl-tint-light");
ok(!/#[0-9a-f]{3,8}\b/i.test(cssBare), "roleplay-chat.css: a raw hex colour — use a token");
ok(!/@font-face|@import/.test(cssBare), "roleplay-chat.css: @font-face or @import");
ok(!/prefers-reduced-motion/.test(cssBare), "roleplay-chat.css: honours prefers-reduced-motion — the suite does not");
for (const m of cssBare.matchAll(/(?:transition|animation)\s*:[^;]*;/g)) {
  ok(!/\b\d+(\.\d+)?m?s\b/.test(m[0]), `roleplay-chat.css: a raw duration in "${m[0].trim()}"`);
  ok(!/cubic-bezier|\b(ease|ease-in|ease-out|ease-in-out|linear)\b/.test(m[0].replace(/--gl-ease[a-z-]*/g, "")), `roleplay-chat.css: a raw easing in "${m[0].trim()}"`);
}
for (const m of cssBare.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) ok(m[1].startsWith("glrp-"), `roleplay-chat.css: @keyframes ${m[1]} is not prefixed glrp-`);
ok(/backdrop-filter:\s*blur\(calc\([^)]*--gl-glass-k/.test(cssBare) && !/backdrop-filter:\s*blur\(\d/.test(cssBare), "roleplay-chat.css: a backdrop blur not written against --gl-glass-k");

/* ── i18n ────────────────────────────────────────────────────────────────── */
for (const [family, values] of Object.entries(M.I18N_FAMILIES)) {
  for (const v of values) {
    const key = M.I18N[family](v);
    ok(key in lang, `lang/roleplay-chat.en.json: ${key} is missing — built at runtime, so it would print itself`);
  }
}
{
  const used = new Set();
  const texts = [...Object.values(sources), read("templates/roleplay-chat/section.hbs")];
  for (const t of texts) for (const m of t.matchAll(/["'`](GLRP\.[A-Za-z0-9.]+[A-Za-z0-9])["'`]/g)) used.add(m[1]);
  for (const m of read("templates/roleplay-chat/section.hbs").matchAll(/localize "(GLRP\.[^"]+)"/g)) used.add(m[1]);
  for (const key of used) ok(key in lang, `lang/roleplay-chat.en.json: ${key} is used and not defined`);
  for (const key of ["GLS.feature.roleplay-chat.title", "GLS.feature.roleplay-chat.hint"]) ok(key in lang, `lang/roleplay-chat.en.json: ${key}`);
}
for (const m of sources["settings.mjs"].matchAll(/(?:name|hint):\s*"([^"]+)"/g)) ok(m[1] in lang, `lang/roleplay-chat.en.json: ${m[1]} (a setting or keybinding label)`);
for (const value of Object.values(lang)) ok(!/[—–]/.test(value), `lang/roleplay-chat.en.json: an em or en dash in "${value.slice(0, 40)}…"`);

/* ── wiring ──────────────────────────────────────────────────────────────── */
{
  const module = JSON.parse(read("module.json"));
  ok(module.styles.includes("styles/roleplay-chat.css"), "module.json: styles/roleplay-chat.css is not loaded");
  ok(module.styles.indexOf("styles/roleplay-chat.css") > module.styles.indexOf("styles/stream-cards.css"), "module.json: roleplay-chat.css loads before stream-cards.css, so the card sheet's tones would win");
  ok(module.languages.some((l) => l.path === "lang/roleplay-chat.en.json"), "module.json: lang/roleplay-chat.en.json is not loaded");
  ok(/import "\.\/roleplay-chat\/index\.mjs";/.test(read("scripts/features/index.mjs")), "features/index.mjs: the adapter is never imported");
  ok(existsSync(join(ROOT, "templates/roleplay-chat/section.hbs")), "templates/roleplay-chat/section.hbs is missing");
  const index = sources["index.mjs"];
  ok(/settingPrefix:\s*PREFIX/.test(index) && /PREFIX = RP_PREFIX/.test(sources["constants.mjs"]), "index.mjs: settingPrefix is not rp.");
  ok(/defaultEnabled:\s*false/.test(index), "index.mjs: ships enabled");
  ok(!/requiresFeature/.test(index), "index.mjs: requires another feature — Roleplay Chat runs alone");
  ok(/gmOnly:\s*true/.test(index), "index.mjs: the Control Room section is not gmOnly — a director would get a switch that discards their edit");
  ok(/chatBubble:\s*false/.test(sources["model.mjs"]), "model.mjs: messages no longer opt out of Foundry's own bubble");
  for (const s of Object.values(sources)) ok(!/game\.socket/.test(s), "a roleplay-chat module calls game.socket");
}

/* ── report ──────────────────────────────────────────────────────────────── */
ok(RP_IC_MODES.every((m) => M.isInCharacter(m)) && !M.isInCharacter("ooc"), "isInCharacter");
if (problems.length) {
  console.error(`roleplay-chat-check: ${problems.length} problem${problems.length === 1 ? "" : "s"}\n`);
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(`roleplay-chat-check: OK (${checks} checks, ${featureFiles.length} modules)`);
