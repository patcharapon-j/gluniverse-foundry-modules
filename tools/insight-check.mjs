/**
 * tools/insight-check.mjs — consistency checks for Insight.
 *
 *   node tools/insight-check.mjs
 *
 * An arrival is a sequence of beats on one anime.js timeline over a stylesheet
 * that hides every node until its beat. Nothing there throws when it breaks: a
 * beat simply never happens, on a player's screen, once, while the GM's own
 * screen looks right. So each check below is something that fails silently.
 *
 *  1. Every element the renderer reaches for exists in the template.
 *  2. The preview plays the SHIPPED renderer and prints the SHIPPED clock, so
 *     its stage clock cannot drift from notification.mjs; the clock itself has
 *     all three tiers, in beat order, and "instant" is all zero.
 *  3. Every setting the renderer reads is registered.
 *  4. Every edge-intensity tier names a class insight.css defines, and every
 *     choice the setting offers is mapped.
 *  5. Every sound profile carries all three stages, and every cue the renderer
 *     plays is one of them.
 *  6. A preset only remaps --gl-accent and this feature's own --insight-* tokens.
 *  7. insight.css never reads --gl-glow / --gl-bloom / --gl-accent-soft /
 *     --gl-accent-faint (struck at :root, they ignore a scoped accent).
 *  8. Keyframes: every reference resolves, every declaration is prefixed.
 *  9. The template and the stylesheet describe the same nodes, both ways.
 * 10. The nodes CSS hides until their beat are exactly the nodes the timeline
 *     reveals: one hidden and never revealed never appears; one revealed and
 *     not hidden flashes in before its beat.
 * 11. What a card may print: the body allow-list refuses markup with
 *     attributes, keeps well-formed entities, and passes Recall Knowledge's
 *     hand-off through byte for byte.
 * 12. Who may put a card on a screen: only a server-attested GM, only to the
 *     users it names, and the send rides `recipients` so nobody else's client
 *     receives it at all.
 * 13. Every i18n key the templates and scripts use exists.
 * 14. The stylesheet keeps the suite's rules: no :root, no foundation token
 *     declared, no raw duration or easing, no white veil, blur written against
 *     --gl-glass-k; and every duration the renderer passes is tier-scaled.
 * 15. Sending one card to several people: the quick picks tick only connected
 *     players who own the tokens, a shared card names the others from the
 *     receiver's own user list (never from the payload), an unshared one still
 *     says "Only you", and every compose button has a handler.
 */
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFile(resolve(ROOT, rel), "utf8");
const load = (rel) => import(pathToFileURL(resolve(ROOT, rel)).href);

const problems = [];
let passed = 0;
const fail = (what) => problems.push(what);
const ok = (cond, what) => (cond ? passed++ : fail(what));

const FEATURE = "scripts/features/insight/module/";
const notification = await read(FEATURE + "notification.mjs");
const settings = await read(FEATURE + "settings.mjs");
const sound = await read(FEATURE + "sound.mjs");
const themes = await read(FEATURE + "themes.mjs");
const socketSrc = await read(FEATURE + "socket.mjs");
const composeSrc = await read(FEATURE + "compose-dialog.mjs");
const recipientsSrc = await read(FEATURE + "recipients.mjs");
const preview = await read("tools/insight-preview.mjs");
const template = await read("templates/insight/notification.hbs");
const composeTpl = await read("templates/insight/compose-dialog.hbs");
const css = await read("styles/insight.css");
const lang = JSON.parse(await read("lang/insight.en.json"));

const runtime = await load(FEATURE + "notification.mjs");
const body = await load(FEATURE + "body.mjs");
const socket = await load(FEATURE + "socket.mjs");
const recipients = await load(FEATURE + "recipients.mjs");

const classTokens = (markup) => {
  const out = new Set();
  for (const m of markup.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t && !t.includes("{{")) out.add(t);
  }
  return out;
};
const rendered = classTokens(template);

/* ── 1. every queried element exists in the template ───────────────────── */
{
  const queried = [
    ...[...notification.matchAll(/querySelector\(\s*"\.([a-z0-9-]+)"\s*\)/g)].map((m) => m[1]),
    ...runtime.CONTENT_ORDER.map((s) => s.replace(/^\./, "")),
  ];
  ok(queried.length > 5, "no querySelector calls found in notification.mjs (the scan is broken, not the code)");
  for (const cls of new Set(queried)) ok(rendered.has(cls), `notification.mjs reaches for .${cls}, which notification.hbs does not render`);
  ok(rendered.size >= 15, `only ${rendered.size} class tokens parsed out of notification.hbs (the scan is broken)`);
}

/* ── 2. the preview's clock is the runtime's clock ─────────────────────── */
{
  ok(/import\s*\{[^}]*renderNotification[^}]*\}\s*from\s*"\/scripts\/features\/insight\/module\/notification\.mjs"/.test(preview),
    "insight-preview.mjs no longer plays the shipped renderNotification; a preview on its own clock flatters a reveal nobody ships");
  ok(/\{[^}]*TIMINGS[^}]*\}\s*=\s*await import\("\.\.\/scripts\/features\/insight\/module\/notification\.mjs"\)/.test(preview),
    "insight-preview.mjs does not read TIMINGS from notification.mjs for its beat list");
  ok(!/\b(?:const|let|var)\s+TIMINGS\b/.test(preview) && !/\bcontentStagger\s*:\s*\d/.test(preview),
    "insight-preview.mjs declares a stage clock of its own");
  ok(!/<b>\d+\s*ms<\/b>/.test(preview), "insight-preview.mjs prints a hand-written beat time");

  const KEYS = ["edge", "line", "card", "contentStart", "contentStagger"];
  for (const tier of ["normal", "fast", "instant"]) {
    const t = runtime.TIMINGS[tier];
    if (!t) { fail(`notification.mjs has no "${tier}" timing tier`); continue; }
    for (const k of KEYS) ok(Number.isFinite(t[k]) && t[k] >= 0, `TIMINGS.${tier}.${k} is not a non-negative number`);
    ok(t.edge <= t.line && t.line <= t.card && t.card <= t.contentStart,
      `TIMINGS.${tier} is out of beat order: the edge must land first and alone, then the cut, the card, the words`);
  }
  ok(KEYS.every((k) => runtime.TIMINGS.instant?.[k] === 0), "the instant tier is not all zero");
  ok(runtime.TIMINGS.normal.edge < runtime.TIMINGS.normal.line, "the edge does not land alone before the cut");
}

/* ── 3. every setting the renderer reads is registered ─────────────────── */
{
  const keys = new Set([...notification.matchAll(/setting\("(insight\.[A-Za-z]+)"/g)].map((m) => m[1]));
  ok(keys.size >= 3, "no settings reads found in notification.mjs (the scan is broken)");
  for (const key of keys) ok(settings.includes(`"${key}"`), `notification.mjs reads ${key}, which settings.mjs does not register`);
  for (const key of new Set([...sound.matchAll(/"(insight\.[A-Za-z]+)"/g)].map((m) => m[1]))) {
    ok(settings.includes(`"${key}"`), `sound.mjs reads ${key}, which settings.mjs does not register`);
  }
}

/* ── 4. every intensity tier names a class insight.css defines ─────────── */
{
  const table = runtime.INTENSITY_CLASS;
  for (const [tier, cls] of Object.entries(table)) {
    if (cls === null) continue;
    ok(new RegExp(`\\.${cls}\\b`).test(css), `intensity "${tier}" applies .${cls}, which insight.css does not define; it would render as "full"`);
  }
  const choices = [...(settings.match(/insight\.edgeIntensity[\s\S]*?choices:\s*\{([^}]*)\}/) ?? [, ""])[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
  ok(choices.length === 3, "could not read the edgeIntensity choices (the scan is broken)");
  for (const c of choices) ok(Object.hasOwn(table, c), `edgeIntensity offers "${c}", which INTENSITY_CLASS does not map`);
}

/* ── 5. every sound profile carries every stage ────────────────────────── */
{
  const STAGES = ["impact", "line", "reveal"];
  const profiles = [...sound.matchAll(/^ {2}(\w+):\s*\{$/gm)].map((m) => m[1]);
  ok(profiles.length >= 2, `expected at least two sound profiles, found ${profiles.length}`);
  for (const p of profiles) {
    const from = sound.slice(sound.indexOf(`  ${p}: {`));
    const end = from.indexOf("\n  },");
    const scoped = from.slice(0, end < 0 ? from.length : end);
    for (const stage of STAGES) ok(new RegExp(`\\b${stage}\\(ctx, gain\\)`).test(scoped), `sound profile "${p}" has no ${stage}(): that beat plays silently`);
  }
  for (const id of Object.keys((await load(FEATURE + "themes.mjs")).getPresets())) {
    ok(profiles.includes(id), `preset "${id}" has no sound profile; it plays the default's`);
  }
  const cues = [...notification.matchAll(/cue\("(\w+)"\)/g)].map((m) => m[1]);
  ok(new Set(cues).size === 3, `the renderer plays ${new Set(cues).size} distinct sound cues, not three`);
  for (const c of cues) ok(STAGES.includes(c), `notification.mjs plays sound stage "${c}", which no profile defines`);
}

/* ── 6. a preset sets the tone and the edge correction, nothing else ───── */
{
  const themesMod = await load(FEATURE + "themes.mjs");
  const { getPresets, registerTheme, PRESET_VARS, PRESET_TONES } = themesMod;
  ok(Array.isArray(PRESET_VARS) && PRESET_VARS.includes("--insight-tone"), "themes.mjs exports no PRESET_VARS naming --insight-tone");
  ok(Array.isArray(PRESET_TONES) && PRESET_TONES.length > 0, "themes.mjs exports no PRESET_TONES");
  const presets = getPresets();
  for (const [id, cfg] of Object.entries(presets)) {
    for (const v of Object.keys(cfg.vars)) {
      ok(PRESET_VARS?.includes(v), `preset "${id}" sets ${v}; a preset may set only ${PRESET_VARS?.join(", ")}, or it forks the skin`);
    }
    // Ink and Signal: hue is a signal, read from core. No violet, no Etched Glass accent.
    ok(PRESET_TONES?.includes(cfg.vars["--insight-tone"]), `preset "${id}" tone ${cfg.vars["--insight-tone"]} is not one of the Ink and Signal tones (${PRESET_TONES?.join(", ")})`);
  }
  // A preset registered by another module against the old accent channel
  // still lands: --gl-accent is read as the tone. Anything else is refused.
  const warn = console.warn; console.warn = () => {};
  registerTheme("__check", { label: "x", vars: { "--gl-accent": "var(--gl-is-red)", "--gl-is-ink-1": "#fff", "--insight-burn": "0.5" } });
  console.warn = warn;
  const reg = presets.__check?.vars ?? {};
  ok(reg["--insight-tone"] === "var(--gl-is-red)", "registerTheme drops a legacy --gl-accent instead of reading it as the tone");
  ok(!("--gl-is-ink-1" in reg) && !("--gl-accent" in reg), "registerTheme lets a preset repaint something other than the tone");
  ok(reg["--insight-burn"] === "0.5", "registerTheme refuses the per-hue edge correction");
  delete presets.__check;
  // The edge is the one place a hue is spread over a whole screen, so the
  // per-hue correction must stay reachable: a preset sets it, the CSS reads it.
  for (const t of ["--insight-tone", "--insight-burn", "--insight-reach-y", "--insight-reach-x"]) {
    ok(css.includes(`var(${t})`), `insight.css no longer reads ${t}; a preset's setting would do nothing`);
  }
}

/* ── 7. no :root accent derivative, which would not follow the remap ───── */
for (const t of ["--gl-glow", "--gl-bloom", "--gl-accent-soft", "--gl-accent-faint"]) {
  ok(!new RegExp(`var\\(${t}\\)`).test(css), `insight.css reads var(${t}); it is struck at :root and ignores the scoped accent. Mix it inline with color-mix()`);
}

/* ── 8. keyframes: every reference resolves, every declaration is scoped ─ */
{
  const declared = new Set();
  for (const f of await readdir(resolve(ROOT, "styles"))) {
    if (!f.endsWith(".css")) continue;
    for (const m of (await read(`styles/${f}`)).matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) declared.add(m[1]);
  }
  for (const m of css.matchAll(/animation(?:-name)?:\s*([A-Za-z][A-Za-z0-9_-]*)/g)) {
    if (m[1] !== "none") ok(declared.has(m[1]), `insight.css animates "${m[1]}", which no @keyframes declares`);
  }
  for (const m of css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
    ok(m[1].startsWith("insight-"), `insight.css declares @keyframes ${m[1]} without the feature prefix`);
  }
}

/* ── 9. the template and the stylesheet describe the same thing ────────── */
{
  const markup = classTokens(template + composeTpl);
  const scripts = notification + composeSrc;
  const applied = new Set();
  for (const m of scripts.matchAll(/classList\.add\("([a-z0-9-]+)"\)/g)) applied.add(m[1]);
  for (const m of scripts.matchAll(/classes:\s*\[([^\]]*)\]/g)) for (const c of m[1].matchAll(/"(insight-[a-z0-9-]+)"/g)) applied.add(c[1]);
  for (const cls of Object.values(runtime.INTENSITY_CLASS)) if (cls) applied.add(cls);

  const styled = new Set([...css.matchAll(/\.(insight-[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const cls of styled) ok(markup.has(cls) || applied.has(cls), `insight.css styles .${cls}, which no template renders and no script applies; that rule is dead`);
  for (const cls of markup) if (cls.startsWith("insight-")) ok(styled.has(cls), `a template renders .${cls}, which insight.css never styles`);
  ok(styled.size > 20, "the template/stylesheet scan found nothing (the scan is broken)");
}

/* ── 10. hidden-until-beat == revealed-by-the-timeline ─────────────────── */
{
  const block = css.match(/\.insight-stage:not\(\.insight-settled\)\s*:is\(([^)]*)\)\s*\{\s*opacity:\s*0;?\s*\}/);
  if (!block) fail("insight.css has no `.insight-stage:not(.insight-settled) :is(...) { opacity: 0 }` rule; every node would show before its beat");
  else {
    const hidden = new Set([...block[1].matchAll(/\.([a-z0-9-]+)/g)].map((m) => m[1]));
    const vars = Object.fromEntries([...notification.matchAll(/const (\w+) = el\.querySelector\("\.([a-z0-9-]+)"\)/g)].map((m) => [m[1], m[2]]));
    const revealed = new Set();
    for (const m of notification.matchAll(/reveal\.add\((\w+),\s*\{([^}]*)/g)) {
      if (!/opacity:\s*\[\s*0\s*,\s*1\s*\]/.test(m[2])) continue;
      if (m[1] === "content") runtime.CONTENT_ORDER.forEach((s) => revealed.add(s.slice(1)));
      else if (vars[m[1]]) revealed.add(vars[m[1]]);
      else fail(`reveal.add(${m[1]}, …) animates a node the check cannot name`);
    }
    for (const cls of hidden) ok(revealed.has(cls), `insight.css hides .${cls} until its beat, and no beat reveals it: it never appears`);
    for (const cls of revealed) ok(hidden.has(cls), `the timeline reveals .${cls}, which insight.css does not hide first: it flashes in before its beat`);
  }
  ok(/\.insight-sweep\s*\{[^}]*opacity:\s*0/.test(css), ".insight-sweep is not at rest at opacity 0; the light would sit on the card");
  ok(/@property --insight-open[\s\S]*?inherits:\s*false[\s\S]*?initial-value:\s*1;/.test(css),
    "--insight-open is not registered (non-inherited, resting at 1); the card would open with no chamfer, or never");
  ok(notification.includes('"--insight-open": [0, 1]'), "the timeline no longer opens the card through --insight-open");
}

/* ── 11. what a card may print ─────────────────────────────────────────── */
{
  const { safeBody, composeBody, isBlankBody, BODY_TAGS } = body;
  const hostile = [
    ['<img src=x onerror="alert(1)">', "<img"],
    ["<script>alert(1)</script>", "<script"],
    ['<b onclick="x()">hi</b>', "onclick"],
    ['<p style="position:fixed">x</p>', "style="],
    ['<a href="javascript:alert(1)">x</a>', "<a "],
    ["<svg/onload=alert(1)>", "<svg"],
    ['<iframe src="//evil">', "<iframe"],
  ];
  // Any `<` left in the output must open a bare, allowed tag.
  const stray = new RegExp(`<(?!/?(?:${BODY_TAGS.join("|")})>)`, "i");
  for (const [input] of hostile) {
    const out = safeBody(input);
    ok(!stray.test(out), `safeBody let ${JSON.stringify(input)} through as ${JSON.stringify(out)}`);
  }
  ok(safeBody("<b>a</b> <i>b</i> <p>c</p><br/>") === "<b>a</b> <i>b</i> <p>c</p><br>", "safeBody mangles the inline tags it allows");
  ok(safeBody("Tom &amp; Jerry &#39;s &lt;") === "Tom &amp; Jerry &#39;s &lt;", "safeBody escapes an entity a second time");
  ok(safeBody("a & b < c") === "a &amp; b &lt; c", "safeBody leaves a bare & or < unescaped");
  ok(safeBody("x".repeat(9000)).length === body.BODY_MAX, "safeBody does not cap the body");
  ok(BODY_TAGS.every((t) => /^[a-z]+$/.test(t)), "BODY_TAGS holds something that is not a bare tag name");
  ok(composeBody("one\ntwo\n\nthree") === "<p>one<br>two</p><p>three</p>", "composeBody no longer keeps the GM's line breaks and paragraphs");
  ok(composeBody("<img src=x onerror=y>").includes("&lt;img"), "composeBody lets markup through");
  ok(isBlankBody("<p> </p><br>") && !isBlankBody("<p>x</p>"), "isBlankBody misjudges an empty body");

  // Recall Knowledge's hand-off must arrive exactly as it was built.
  const { buildInsightMessage } = await load("scripts/features/pf2e-recall/share.mjs");
  for (const text of ["The troll's **hide** regrows & *burns*.", 'Quotes "here" and `code` <b>x</b>', "***both*** ~~gone~~ _soft_"]) {
    const msg = buildInsightMessage({ text });
    ok(!!msg && safeBody(msg.body) === msg.body, `Recall Knowledge's body changes on the way through Insight: ${JSON.stringify(msg?.body)} became ${JSON.stringify(msg && safeBody(msg.body))}`);
  }
  // The card has no title of its own beyond the payload's; a Recall card arrives without one.
  const recall = socket.cardData({ id: "x", targets: ["p"], body: "<p>x</p>", ...buildInsightMessage({ text: "x" }) });
  ok(recall.title === null, "a Recall Knowledge card gained a title on the way through Insight");
}

/* ── 12. who may put a card on a screen ────────────────────────────────── */
{
  const { accepts, validPayload, cardData, MESSAGE_TYPE } = socket;
  const users = new Map([["gm", { isGM: true }], ["p1", { isGM: false }], ["p2", { isGM: false }]]);
  const payload = { type: MESSAGE_TYPE, id: "insight-1", targets: ["p1"], body: "<p>x</p>", title: null, sense: null, image: null, theme: null };
  ok(validPayload(payload), "a well-formed payload fails validation");
  ok(accepts(payload, "gm", users, "p1"), "a GM's card to p1 is refused on p1");
  ok(!accepts(payload, "gm", users, "p2"), "a card for p1 is shown on p2");
  ok(!accepts(payload, "p2", users, "p1"), "a PLAYER can put a card on another player's screen");
  ok(!accepts(payload, null, users, "p1"), "a card nobody the server vouched for is shown");
  ok(!accepts({ ...payload, targets: ["gm"] }, "p1", users, "gm"), "a player can put a card on the GM's screen");
  for (const bad of [
    { ...payload, type: "other" }, { ...payload, targets: [] }, { ...payload, targets: "p1" },
    { ...payload, body: 3 }, { ...payload, title: {} }, { ...payload, id: "" }, null,
  ]) ok(!validPayload(bad), `validPayload accepts ${JSON.stringify(bad)}`);
  ok(cardData({ ...payload, body: '<img src=x onerror="y">' }).body.startsWith("&lt;img"), "cardData does not reduce the body on arrival");
  ok(/emitSocket\(FEATURE_ID,\s*payload,\s*\{\s*recipients:/.test(socketSrc),
    "sendNotification no longer emits with `recipients`; every client would receive every private whisper");
  ok(!/emitSocket\(FEATURE_ID,\s*payload\s*\)/.test(socketSrc), "sendNotification broadcasts a payload without recipients");
  ok(/registerSocket[\s\S]*?accepts\(payload, meta\?\.attested/.test(socketSrc), "registerSocket does not gate on the server-attested sender");
  ok(/sendNotification[\s\S]*?if \(!game\.user\?\.isGM\) return false;/.test(socketSrc), "sendNotification can be called by a player");
}

/* ── 13. every i18n key exists ─────────────────────────────────────────── */
{
  const used = new Set();
  for (const src of [template, composeTpl]) for (const m of src.matchAll(/localize "([A-Z][\w.]+)"/g)) used.add(m[1]);
  for (const src of [notification, composeSrc, recipientsSrc, await read("scripts/features/insight/insight.mjs"), settings]) {
    for (const m of src.matchAll(/"(INSIGHT\.[A-Za-z]+)"/g)) used.add(m[1]);
  }
  ok(used.size > 20, "the i18n scan found too few keys (the scan is broken)");
  for (const k of used) ok(Object.hasOwn(lang, k), `${k} is used and missing from lang/insight.en.json`);
  ok(/\{count\}/.test(lang["INSIGHT.Queued"] ?? ""), "INSIGHT.Queued lost its {count}");
  ok(/\{count\}/.test(lang["INSIGHT.ComposeSentCount"] ?? ""), "INSIGHT.ComposeSentCount lost its {count}");
}

/* ── 14. the suite's CSS rules, and tier-scaled durations ──────────────── */
{
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/(^|\})\s*:root\b/.test(bare), "insight.css writes on :root");
  for (const m of bare.matchAll(/(--gl-[a-z0-9-]+)\s*:/g)) fail(`insight.css declares the foundation token ${m[1]}`);
  for (const m of bare.matchAll(/(?:transition|animation)[^;{]*?\b(\d+(?:\.\d+)?m?s)\b/g)) fail(`insight.css has a raw duration (${m[1]}); use a --gl-d-* token`);
  ok(!/cubic-bezier\(/.test(bare), "insight.css has a raw easing; use a --gl-ease* token");
  ok(!/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(bare), "insight.css has a raw white veil; use rgb(var(--gl-tint-light) / a)");
  for (const m of bare.matchAll(/blur\(([^;]*?)\)\s*;/g)) ok(/--gl-glass-k|--gl-blur/.test(m[1]), `a blur not written against --gl-glass-k: blur(${m[1]})`);
  for (const m of notification.matchAll(/duration:\s*([^,}]+)/g)) {
    ok(/^(?:ms\(|breathe\b)/.test(m[1].trim()), `notification.mjs passes an unscaled duration (${m[1].trim()}); it would ignore the speed setting and the motion tier`);
  }
}

/* ── 15. one card, several people ──────────────────────────────────────── */
{
  const { sharedWith, validPayload, MESSAGE_TYPE } = socket;
  const { actorsOf, playerOwners, sharedLabel, NAMED_MAX } = recipients;
  const base = { type: MESSAGE_TYPE, id: "insight-2", targets: ["p1", "p2", "p3", "p2"], body: "<p>x</p>" };

  ok(sharedWith(base, "p1").length === 0, "an unshared card tells its recipients who else got it");
  ok(sharedWith({ ...base, shared: true }, "p1").join() === "p2,p3", "a shared card names the wrong people (itself, or someone twice)");
  ok(validPayload({ ...base, shared: true }) && validPayload({ ...base, shared: false }), "validPayload refuses a boolean `shared`");
  ok(!validPayload({ ...base, shared: "yes" }), "validPayload accepts a `shared` that is not a boolean");
  ok(/shared:\s*data\.shared === true/.test(socketSrc), "sendNotification no longer carries `shared` as a strict boolean");
  ok(/sharedWith\(payload, game\.user\.id\)\.map\(\(id\) => game\.users\.get\(id\)\?\.name\)/.test(socketSrc),
    "a shared card's names no longer come from the receiver's own user list; a payload could name anyone");

  const fmt = (k, d) => (lang[k] ?? k).replace(/\{(\w+)\}/g, (_m, n) => d[n]);
  ok(sharedLabel([], fmt) === null && sharedLabel([undefined], fmt) === null, "a card with nobody else on it stops saying \"Only you\"");
  ok(sharedLabel(["Kai"], fmt, "en") === "With Kai", `one other recipient reads ${JSON.stringify(sharedLabel(["Kai"], fmt, "en"))}`);
  ok(sharedLabel(["Kai", "Mira"], fmt, "en") === "With Kai and Mira", "two other recipients are not listed by name");
  const many = Array.from({ length: NAMED_MAX + 1 }, (_, i) => `P${i}`);
  ok(sharedLabel(many, fmt, "en") === `With ${many.length} others`, "a long recipient list is named in full and overruns the card's head");
  ok(/\{names\}/.test(lang["INSIGHT.SharedWith"] ?? "") && /\{count\}/.test(lang["INSIGHT.SharedWithCount"] ?? ""),
    "INSIGHT.SharedWith / SharedWithCount lost their placeholder");
  ok(/\{\{#if shared\}\}\{\{shared\}\}\{\{else\}\}\{\{localize "INSIGHT\.Private"\}\}\{\{\/if\}\}/.test(template),
    "the card's private tag no longer falls back to \"Only you\"");

  const own = (ids) => ({ testUserPermission: (u, level) => level === "OWNER" && ids.includes(u.id) });
  const a1 = own(["p1"]); const a2 = own(["p2", "gm"]);
  const users = [
    { id: "gm", active: true, isGM: true }, { id: "p1", active: true }, { id: "p2", active: false }, { id: "p3", active: true },
  ];
  ok(actorsOf([{ actor: a1 }, { actor: a1 }, { actor: null }, null, { actor: a2 }]).length === 2, "actorsOf keeps an actor twice or a token without one");
  const owners = playerOwners([a1, a2], users);
  ok(owners.join() === "p1", `the token quick picks tick ${JSON.stringify(owners)}; only connected players who own one should be ticked`);

  const handlers = new Set([...composeSrc.matchAll(/^\s+(\w+): InsightComposeDialog\.#\w+,/gm)].map((m) => m[1]));
  for (const m of composeTpl.matchAll(/data-action="(\w+)"/g)) ok(handlers.has(m[1]), `compose button data-action="${m[1]}" has no handler; it does nothing`);
  ok(/name="shared"/.test(composeTpl) && /data\.get\("shared"\)/.test(composeSrc), "the compose window's \"who else\" switch is not read on send");
  ok(/targets\.length > 1 && data\.get\("shared"\)/.test(composeSrc), "a card to one person can be sent as shared");
}

/* ── 16. the Ink and Signal skin ───────────────────────────────────────── */
{
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Colour, type and shape come from core's --gl-is-* family; only motion,
  // layering, tint channels and glass strength are still shared with Etched Glass.
  const SHARED = /^--gl-(?:is-|d-|ease|z-|tint-|glass-k|blur|lift|stagger|motion-scale|thai)/;
  for (const m of new Set([...bare.matchAll(/var\((--gl-[a-z0-9-]+)/g)].map((x) => x[1]))) {
    ok(SHARED.test(m), `insight.css reads the Etched Glass token ${m}; alias a --gl-is-* value under --insight-*`);
  }
  // Every skin token read is declared (a read with no declaration falls back to nothing).
  const declared = new Set([...bare.matchAll(/(--insight-[a-z0-9-]+)\s*:/g)].map((x) => x[1]));
  for (const m of bare.matchAll(/@property\s+(--insight-[a-z0-9-]+)/g)) declared.add(m[1]);
  for (const m of bare.matchAll(/var\((--insight-[a-z0-9-]+)\s*([,)])/g)) {
    if (m[2] === ",") continue; // read with a fallback of its own
    ok(declared.has(m[1]), `insight.css reads ${m[1]}, which it never declares`);
  }
  // A skin aliases core; it never restates a value (DESIGN.md, The Alias Rule).
  ok(!/#[0-9a-f]{3,8}\b/i.test(bare), "insight.css states a raw hex; alias a --gl-is-* value instead");
  // Flat plates: no glass.
  ok(!/backdrop-filter/.test(bare), "insight.css blurs what is behind it; Ink and Signal plates are flat");
  // The Floor Rule: nothing under 11px.
  for (const m of bare.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) ok(Number(m[1]) >= 11, `insight.css sets text at ${m[1]}px, under the 11px floor`);
  // Every skin root is one of the feature's own; nothing on :root (14 pins that).
  ok(/\.insight-stage,\s*\n?\s*\.insight-compose\s*\{[^}]*--insight-tone:/.test(bare), "the skin tokens are not declared on the feature's two roots");
}

/* ── report ───────────────────────────────────────────────────────────── */
if (problems.length) {
  console.error(`insight-check: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error("  • " + p);
  process.exit(1);
}
console.log(`insight-check: no problems (${passed} assertions)`);
