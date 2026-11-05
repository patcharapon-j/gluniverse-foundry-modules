/**
 * tools/timer-check.mjs — consistency check for the Timer feature.
 *
 *   node tools/timer-check.mjs
 *
 * Everything here fails silently in a live world: a tier one second off is a
 * plausible clock, a tone with no rule draws the plate untoned, a key that is
 * missing prints itself on every screen, a class the HUD reaches for that the
 * markup lost throws inside the frame loop (and the loop schedules first, so
 * it keeps throwing sixty times a second), and a skin that drifts back to
 * Etched Glass or onto :root repaints somebody else's feature. The view
 * (`view.mjs`) is pure, so it is driven here as shipped.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  formatParts, tierOf, toneOf, tagKeyOf, tagIconOf, drainOf, knockSecondOf,
  hudHTML, stripHTML, STRIP, VIEW_KEYS, TIMER_MOTION, KNOCK_MS, FINE_TICK_MS,
} from "../scripts/features/timer/view.mjs";
import { URGENT_MS, CRITICAL_MS, remainingOf } from "../scripts/features/timer/state.mjs";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (p) => readFileSync(ROOT + p, "utf8");
const problems = [];
let passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else problems.push(msg); };
const eq = (a, b, msg) => ok(Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

/** Every style rule's selectors, split on top-level commas; at-rule preludes
 *  are not selectors, and a keyframes block holds none. */
function ruleSelectors(text) {
  const out = [];
  let prelude = "";
  const stack = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      const head = prelude.trim();
      prelude = "";
      if (stack.includes("keyframes")) { stack.push("keyframes"); continue; }
      if (head.startsWith("@keyframes")) { stack.push("keyframes"); continue; }
      if (head.startsWith("@")) { stack.push("at"); continue; }
      stack.push("rule");
      let depth = 0, cur = "";
      for (const c of head) {
        if (c === "(") depth++;
        if (c === ")") depth--;
        if (c === "," && depth === 0) { out.push(cur.trim()); cur = ""; } else cur += c;
      }
      if (cur.trim()) out.push(cur.trim());
    } else if (ch === "}") { stack.pop(); prelude = ""; }
    else if (ch === ";") prelude = "";
    else prelude += ch;
  }
  return out;
}

const FEATURE = "scripts/features/timer/";
const sources = Object.fromEntries(["view.mjs", "hud.mjs", "motion.mjs", "panel.mjs", "index.mjs", "state.mjs", "audio.mjs"].map((f) => [f, read(FEATURE + f)]));
const css = read("styles/timer.css");
const hbs = read("templates/timer/panel.hbs");
const lang = JSON.parse(read("lang/timer.en.json"));
const L = (k) => lang[k] ?? `‹${k}›`;

/* ── the view is pure ─────────────────────────────────────────────────────── */
{
  const code = sources["view.mjs"].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  for (const g of ["game", "document", "window", "canvas", "foundry", "ui", "Hooks", "Date.now", "performance", "requestAnimationFrame"]) {
    ok(!new RegExp(`\\b${g.replace(".", "\\.")}\\b`).test(code), `view.mjs reaches ${g}; the preview and this check drive it as shipped`);
  }
  // The HUD must stay importable without Foundry: the panel builds on
  // foundry.applications at module scope, so the HUD reaches it lazily.
  ok(!/^\s*import[^;]*from\s+["']\.\/panel\.mjs["']/m.test(sources["hud.mjs"]), "hud.mjs imports panel.mjs statically; it touches foundry at module scope, so the preview cannot load the HUD");
}

/* ── the digits ───────────────────────────────────────────────────────────── */
eq(formatParts(5 * 60_000), { main: "5:00", frac: "" }, "five minutes");
eq(formatParts(60_000), { main: "1:00", frac: "" }, "exactly a minute stays M:SS");
eq(formatParts(60_001), { main: "1:01", frac: "" }, "M:SS lingers on the round value");
eq(formatParts(59_999), { main: "59", frac: ".99" }, "the last minute flips to SS.cc");
eq(formatParts(7_420), { main: "07", frac: ".42" }, "seconds pad to two");
eq(formatParts(0), { main: "00", frac: ".00" }, "zero");
eq(formatParts(-500), { main: "00", frac: ".00" }, "negative clamps");
eq(formatParts(NaN), { main: "00", frac: ".00" }, "NaN reads as zero");
eq(formatParts(100 * 60_000), { main: "100:00", frac: "" }, "past 99 minutes");

/* ── tiers, tones and tags ────────────────────────────────────────────────── */
eq(tierOf(URGENT_MS, false), "calm", "a minute left is calm");
eq(tierOf(URGENT_MS - 1, false), "urgent", "under a minute is urgent");
eq(tierOf(CRITICAL_MS + 1, false), "urgent", "just over ten is urgent");
eq(tierOf(CRITICAL_MS, false), "critical", "ten seconds is critical");
eq(tierOf(1, false), "critical", "one ms is critical");
eq(tierOf(0, false), "expired", "zero is expired");
eq(tierOf(30_000, true), "expired", "expired flag wins");
const TIERS = ["calm", "urgent", "critical", "expired"];
const TONES = new Set();
for (const tier of TIERS) for (const paused of [false, true]) {
  const tone = toneOf(tier, paused);
  TONES.add(tone);
  ok(["paper", "amber", "red", "steel"].includes(tone), `toneOf(${tier}, ${paused}) = ${tone} is not an Ink and Signal tone`);
  ok(typeof lang[tagKeyOf(tier, paused)] === "string", `tag key ${tagKeyOf(tier, paused)} missing`);
  ok(/^fa-solid fa-[a-z-]+$/.test(tagIconOf(tier, paused)), `tag icon for ${tier}/${paused}`);
}
eq(toneOf("calm", false), "paper", "calm reads paper");
eq(toneOf("urgent", false), "amber", "the last minute reads amber");
eq(toneOf("critical", false), "red", "the last ten read red");
eq(toneOf("expired", true), "red", "time up is red even while held");
eq(toneOf("urgent", true), "steel", "a held timer is steel");
eq(tagKeyOf("critical", true), "GLTIMER.hud.paused", "a held timer says so");
eq(tagKeyOf("expired", false), "GLTIMER.hud.up", "time up says so");
// A tag word that changes must not change the tag's size: the three words
// differ in length, so the tag has a floor wide enough for the longest.
ok(/\.gltimer-tag-text\s*\{[^}]*min-width/.test(css), "the tag text has no min-width; Timer / Paused / Time up would resize the plate as the state changes");

/* ── the drain ────────────────────────────────────────────────────────────── */
// One fixed keyframe (full to empty) over the whole length, entered part-way
// by a negative delay: a keyframe that reads a custom property cannot run on
// the compositor, and drains on the main thread every frame.
eq(drainOf(30_000, 60_000), { total: 60_000, elapsed: 30_000 }, "half drained");
eq(drainOf(90_000, 60_000), { total: 90_000, elapsed: 0 }, "time added past the length fills the bar, never overflows");
eq(drainOf(0, 60_000), { total: 0, elapsed: 0 }, "empty at zero");
eq(drainOf(10_000, 0), { total: 10_000, elapsed: 0 }, "a state with no total still drains");

/* ── the knock ────────────────────────────────────────────────────────────── */
eq(KNOCK_MS, CRITICAL_MS, "the knock and the red tier start together");
eq(knockSecondOf(10_000), 10, "knocks from ten");
eq(knockSecondOf(10_001), null, "no knock above ten");
eq(knockSecondOf(9_001), 10, "the second turns on the ceiling");
eq(knockSecondOf(0), null, "no knock at zero (that is the hit)");
for (const [k, v] of Object.entries(TIMER_MOTION)) ok(Number.isInteger(v) && v > 0 && v <= 1200, `TIMER_MOTION.${k} = ${v}`);

/* ── remaining time stays authoritative ───────────────────────────────────── */
eq(remainingOf({ active: true, running: true, remainingMs: 10_000, anchor: 1_000 }, 6_500), 4_500, "running follows the anchor");
eq(remainingOf({ active: true, running: false, remainingMs: 10_000, anchor: 1_000 }, 6_500), 10_000, "paused holds");

/* ── i18n ─────────────────────────────────────────────────────────────────── */
{
  const used = new Set(VIEW_KEYS);
  for (const src of [...Object.values(sources), hbs]) for (const m of src.matchAll(/["'`](GLTIMER\.[A-Za-z0-9_.]+)["'`]/g)) used.add(m[1]);
  for (const m of hbs.matchAll(/localize "(GLTIMER\.[^"]+)"/g)) used.add(m[1]);
  for (const k of used) ok(typeof lang[k] === "string" && lang[k].length, `i18n key ${k} does not resolve`);
  for (const b of STRIP) ok(typeof lang[b.key] === "string", `strip key ${b.key}`);
  ok(!hudHTML(L, { gm: true }).includes("‹"), "the GM HUD draws an unresolved key");
}

/* ── markup ↔ code ↔ CSS ──────────────────────────────────────────────────── */
const markup = hudHTML(L, { gm: true }) + hbs;
const markupClasses = new Set([...markup.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
{
  const player = hudHTML(L, { gm: false });
  ok(!player.includes("gltimer-strip"), "a player's HUD carries the GM strip");
  ok(hudHTML(L, { gm: true }).includes(stripHTML(L)), "the GM HUD carries the strip");
  for (const f of ["hud.mjs", "motion.mjs"]) {
    for (const m of sources[f].matchAll(/querySelector(?:All)?\(\s*["'`]\.([a-z0-9-]+)/g)) {
      ok(markupClasses.has(m[1]), `${f} reaches for .${m[1]}, which the HUD markup does not draw`);
    }
  }
  for (const b of STRIP) ok(markup.includes(`data-act="${b.act}"`), `strip button ${b.act}`);
  ok(STRIP.every((b) => b.icon || b.label), "every strip button shows an icon or a time");
  // Etched Glass utilities must not come back through the markup.
  for (const legacy of ["gl-glass", "gl-btn", "gls-input", "gl-btn-accent", "gl-well"]) {
    ok(!markupClasses.has(legacy), `markup still uses the Etched Glass utility .${legacy}`);
  }
  const cssClasses = new Set([...css.matchAll(/\.(gltimer-[a-z0-9-]+)/g)].map((m) => m[1]));
  const jsClasses = new Set([...Object.values(sources).join("\n").matchAll(/["'`. ](gltimer-[a-z0-9-]+)/g)].map((m) => m[1]));
  for (const c of cssClasses) ok(markupClasses.has(c) || jsClasses.has(c), `CSS styles .${c}, which nothing draws`);
  // Per-button hooks (`gltimer-<act>`) and the tag icon are handles for the
  // code, not styled surfaces; every other class the markup draws has a rule.
  const hooks = new Set([...STRIP.map((b) => `gltimer-${b.act}`), "gltimer-tag-icon"]);
  for (const c of markupClasses) if (c.startsWith("gltimer-") && !hooks.has(c)) ok(cssClasses.has(c), `markup draws .${c} with no rule`);
}

/* ── the skin (docs/adr/0012) ─────────────────────────────────────────────── */
{
  const body = css.replace(/\/\*[\s\S]*?\*\//g, "");
  ok(!/:root\b/.test(body), "timer.css writes on :root");
  ok(!/@media[^{]*prefers-reduced-motion/.test(body), "timer.css honours prefers-reduced-motion; the suite does not");
  ok(!/@import|@font-face/.test(body), "timer.css imports or declares a font");
  ok(!/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(body), "a raw white veil; use a tint channel");
  ok(!/#[0-9a-fA-F]{3,8}\b/.test(body), "a hex literal in the skin; alias --gl-is-* instead (The Alias Rule)");
  ok(!/cubic-bezier\(/.test(body), "a raw easing; use --gl-ease*");
  for (const m of body.matchAll(/(?:transition|animation)(?:-duration|-delay)?\s*:([^;]+);/g)) {
    ok(!/(?<![\w-])\d+(?:\.\d+)?m?s\b/.test(m[1]), `a raw duration: ${m[0].trim()}`);
  }
  for (const m of body.matchAll(/@keyframes\s+([\w-]+)/g)) ok(m[1].startsWith("gltimer-"), `keyframes ${m[1]} is not prefixed gltimer-`);
  // A skin declares only its own prefix; foundation tokens are read, never set.
  for (const m of body.matchAll(/(?:^|[;{\s])(--[\w-]+)\s*:/g)) ok(m[1].startsWith("--gltimer-"), `timer.css declares ${m[1]}; a feature declares only --gltimer-*`);
  // Every --gltimer-* read is declared, or it falls back to nothing.
  const declared = new Set([...body.matchAll(/(--gltimer-[\w-]+)\s*:/g)].map((m) => m[1]));
  const setFromJs = new Set([...Object.values(sources).join("\n").matchAll(/["'`](--gltimer-[\w-]+)["'`]/g)].map((m) => m[1]));
  for (const m of body.matchAll(/var\((--gltimer-[\w-]+)/g)) ok(declared.has(m[1]) || setFromJs.has(m[1]), `${m[1]} is read and never declared`);
  // No Etched Glass: its accent, glows, ramp and faces.
  for (const t of ["--gl-accent", "--gl-cyan", "--gl-glow", "--gl-bloom", "--gl-signal", "--gl-hazard", "--gl-ink-", "--gl-text", "--gl-line", "--gl-edge", "--gl-tech", "--gl-display", "--gl-holo", "--gl-violet", "--gl-surface", "--gl-weight-"]) {
    const re = new RegExp(`var\\(${t}${t.endsWith("-") ? "" : "(?![\\w-])"}`);
    ok(!re.test(body), `timer.css still reads the Etched Glass token ${t}`);
  }
  // The Floor Rule: nothing under 11px (icon glyphs excepted, none here).
  for (const m of body.matchAll(/font-size\s*:\s*([\d.]+)px/g)) ok(Number(m[1]) >= 11, `font-size ${m[1]}px is under the 11px floor`);
  // Every rule sits under one of the feature's roots.
  const ROOTS = /^(:is\()?(#gltimer-hud|\.gltimer-hud|\.application\.gltimer-panel|#gltimer-panel|\.gltimer-panel-body)\b/;
  for (const sel of ruleSelectors(body)) ok(ROOTS.test(sel), `selector "${sel}" is outside the Timer's roots`);
  // Every tone the view can return has a rule.
  for (const tone of TONES) ok(new RegExp(`\\[data-tone="${tone}"\\]`).test(body), `tone ${tone} has no rule`);
  // The Size-It-Yourself Rule: every control the feature ships declares its size.
  for (const sel of ["\\.gltimer-ctl", "\\.gltimer-preset", "\\.gltimer-action"]) {
    ok(new RegExp(`${sel}[^{]*\\{[^}]*font-size`).test(body), `${sel.replace(/\\/g, "")} inherits its font size from the host`);
  }
}

/* ── a ticking timer does not re-lay the page every frame ─────────────────── */
{
  const hud = sources["hud.mjs"];
  const start = hud.search(/^\s*_render\(/m);
  const render = hud.slice(start, hud.indexOf("\n  }\n", start));
  ok(start > 0 && render.length > 100, "hud.mjs has no _render method to inspect");
  ok(!/style\.setProperty|style\.removeProperty|innerHTML/.test(render), "the per-frame render writes a style or markup; only text and attributes may change per frame");
  ok(/\.data\s*=|textContent\s*=/.test(render), "the render writes the digits");
  ok(/\.gltimer-face\s*\{[^}]*contain\s*:/.test(css), "the face has no containment; every digit change re-lays the plate");
  ok(/@keyframes\s+gltimer-drain[^{]*\{[^}]*transform/.test(css), "the drain is not a transform keyframe on the compositor");
  const keyframes = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^}]*\})*)[^}]*\}/g)].map((m) => m[1]).join("\n");
  ok(!/var\(/.test(keyframes), "a keyframe reads a custom property; Chrome then runs it on the main thread every frame");
  ok(/\.gltimer-face\s*\{[^}]*contain\s*:\s*strict/.test(css), "the face is not a relayout boundary (contain: strict with its own size); a digit re-lays the plate");
  // The loop sleeps when nothing moves and wakes once a second above the last
  // minute; only the hundredths need every frame.
  ok(/_nextWake\(/.test(hud) && /setTimeout\(/.test(hud), "the HUD loop has no slower wake above the last minute");
  ok(/FINE_TICK_MS/.test(hud.slice(hud.indexOf("_nextWake(rem"))), "the last minute redraws on every frame rather than at FINE_TICK_MS");
  ok(FINE_TICK_MS >= 16 && FINE_TICK_MS <= 50, `FINE_TICK_MS ${FINE_TICK_MS} is outside 20 to 60 redraws a second`);
  ok(/wake\(\)/.test(sources["index.mjs"]), "nothing wakes the HUD on a local pause, so a sleeping loop would not freeze the clock");
}

if (problems.length) {
  console.error(`timer-check: ${problems.length} problem(s), ${passed} passed`);
  for (const p of problems) console.error("  ✗ " + p);
  process.exit(1);
}
console.log(`timer-check: OK (${passed} assertions)`);
