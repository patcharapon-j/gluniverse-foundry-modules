/**
 * tools/insight-check.mjs — consistency checks for the Insight arrival.
 *
 *   node tools/insight-check.mjs
 *
 * Everything here fails SILENTLY, which is the only reason any of it is worth
 * a tool. The arrival is a sequence of classes applied to elements by a clock,
 * over CSS that is mostly one-shot keyframes — so a name that stops matching
 * does not error, it just makes a beat of the reveal never happen, on somebody
 * else's screen, once.
 *
 * What it pins, and why each one is invisible:
 *
 *  1. Every element the renderer reaches for exists in the template. A renamed
 *     node makes `querySelector` return null; the optional-chained ones drop a
 *     beat with no trace, and the two that are not optional throw halfway
 *     through an arrival the player has already been alerted to.
 *
 *  2. The stage clock in tools/insight-preview.mjs equals the one in
 *     notification.mjs. The preview is where this feature is judged, and a
 *     preview running its own timings flatters a reveal nobody ships.
 *
 *  3. Every setting the renderer reads is registered. `game.settings.get` on an
 *     unregistered key throws, and it throws inside the render — so the whole
 *     notification is lost rather than degrading.
 *
 *  4. Every intensity tier names a class that insight.css defines. A tier whose
 *     class does not exist silently renders as "full", which is the one outcome
 *     a player who turned the edge down did not consent to.
 *
 *  5. Every sound profile carries all three stages. A missing stage is a no-op
 *     by design (`if (!fn) return`), so a profile that lost its `impact` is a
 *     silent alert on exactly the beat the alert exists for.
 *
 *  6. A preset only touches the accent channel and this feature's own tokens.
 *     Presets are NOT themes — Etched Glass is the suite's one theme — and a
 *     preset that repaints a surface forks it while looking fine in its own
 *     file.
 *
 *  7. insight.css never reads --gl-glow / --gl-bloom / --gl-accent-soft /
 *     --gl-accent-faint. Those are declared at :root against the :root accent,
 *     so they do NOT follow this feature's scoped `--gl-accent` remap: using
 *     one renders the suite's default blue inside a violet card, and only on
 *     the elements that happen to use it.
 *
 *  8. Every `animation:` in insight.css names a @keyframes that exists
 *     somewhere in styles/, and every @keyframes insight.css declares is
 *     prefixed. Keyframe names are global across the suite, so an unprefixed
 *     one silently overrides another feature's animation, and a typo'd
 *     reference silently animates nothing.
 */
import { readFile } from "node:fs/promises";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel) => readFile(resolve(ROOT, rel), "utf8");

const problems = [];
const fail = (what) => problems.push(what);

const notification = await read("scripts/features/insight/module/notification.mjs");
const settings = await read("scripts/features/insight/module/settings.mjs");
const sound = await read("scripts/features/insight/module/sound.mjs");
const themes = await read("scripts/features/insight/module/themes.mjs");
const preview = await read("tools/insight-preview.mjs");
const template = await read("templates/insight/notification.hbs");
const css = await read("styles/insight.css");

/* ── 1. every queried element exists in the template ───────────────────── */
{
  // Compare CLASS TOKENS, not substrings. The {{#if}} guards are irrelevant
  // here — the question is whether the node is spelled the same in both files,
  // not whether every optional one is always rendered. Substring matching
  // would let ".insight-edge-scan" go on finding itself inside a renamed
  // "insight-edge-scanline", which is the exact rename this exists to catch.
  const rendered = new Set();
  for (const m of template.matchAll(/class="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token && !token.includes("{{")) rendered.add(token);
    }
  }
  const queried = [...notification.matchAll(/querySelector\("\.([a-z0-9-]+)"\)/g)].map((m) => m[1]);
  for (const cls of new Set(queried)) {
    if (!rendered.has(cls)) fail(`notification.mjs queries .${cls}, which notification.hbs does not render`);
  }
  if (!queried.length) fail("no querySelector calls found in notification.mjs — the scan is broken, not the code");
  if (rendered.size < 10) fail(`only ${rendered.size} class tokens parsed out of notification.hbs — the scan is broken, not the template`);
}

/* ── 2. the preview's stage clock is the runtime's stage clock ─────────── */
{
  const TIERS = ["normal", "fast", "instant"];
  const KEYS = ["edge", "line", "card", "contentStart", "contentStagger"];
  const clocks = (src) => {
    const out = {};
    for (const tier of TIERS) {
      const m = src.match(new RegExp(`${tier}\\s*:\\s*\\{([^}]*)\\}`));
      if (!m) continue;
      out[tier] = Object.fromEntries(
        KEYS.map((k) => [k, Number((m[1].match(new RegExp(`\\b${k}\\s*:\\s*(-?\\d+)`)) ?? [])[1])])
      );
    }
    return out;
  };
  const rt = clocks(notification);
  const pv = clocks(preview);
  for (const tier of TIERS) {
    if (!rt[tier]) { fail(`notification.mjs has no "${tier}" timing tier`); continue; }
    if (!pv[tier]) { fail(`insight-preview.mjs has no "${tier}" timing tier`); continue; }
    for (const k of KEYS) {
      if (rt[tier][k] !== pv[tier][k]) {
        fail(`stage clock drift — ${tier}.${k} is ${rt[tier][k]} in notification.mjs, ${pv[tier][k]} in insight-preview.mjs`);
      }
    }
  }
}

/* ── 3. every setting the renderer reads is registered ─────────────────── */
{
  const readKeys = new Set([...notification.matchAll(/setting\("(insight\.[A-Za-z]+)"/g)].map((m) => m[1]));
  for (const key of readKeys) {
    if (!settings.includes(`"${key}"`)) fail(`notification.mjs reads ${key}, which settings.mjs does not register`);
  }
  if (!readKeys.size) fail("no settings reads found in notification.mjs — the scan is broken, not the code");
}

/* ── 4. every intensity tier names a class insight.css defines ─────────── */
{
  const block = notification.match(/INTENSITY_CLASS\s*=\s*\{([^}]*)\}/);
  if (!block) fail("INTENSITY_CLASS not found in notification.mjs");
  else {
    const tiers = [...block[1].matchAll(/(\w+)\s*:\s*(null|"([^"]+)")/g)];
    if (!tiers.length) fail("INTENSITY_CLASS is empty");
    for (const [, tier, raw, cls] of tiers) {
      if (raw === "null") continue;
      if (!css.includes(`.${cls}`)) fail(`intensity "${tier}" applies .${cls}, which insight.css does not define`);
    }
    // The setting's own choices and the class table must be the same set, or a
    // choice the GM can pick resolves to no class at all.
    const choices = [...(settings.match(/insight\.edgeIntensity[\s\S]*?choices:\s*\{([^}]*)\}/) ?? [, ""])[1]
      .matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
    for (const c of choices) {
      if (!tiers.some(([, t]) => t === c)) fail(`edgeIntensity offers "${c}", which INTENSITY_CLASS does not map`);
    }
  }
}

/* ── 5. every sound profile carries every stage ────────────────────────── */
{
  const STAGES = ["impact", "line", "reveal"];
  const profiles = [...sound.matchAll(/^ {2}(\w+):\s*\{$/gm)].map((m) => m[1]);
  if (profiles.length < 2) fail(`expected at least two sound profiles, found ${profiles.length}`);
  for (const p of profiles) {
    const body = sound.slice(sound.indexOf(`  ${p}: {`));
    const end = body.indexOf("\n  },");
    const scoped = body.slice(0, end < 0 ? body.length : end);
    for (const stage of STAGES) {
      if (!new RegExp(`\\b${stage}\\(ctx, gain\\)`).test(scoped)) {
        fail(`sound profile "${p}" has no ${stage}() — that beat plays silently`);
      }
    }
  }
  // And every stage the renderer asks for must be one the profiles define.
  for (const m of notification.matchAll(/playSound\("(\w+)"/g)) {
    if (!STAGES.includes(m[1])) fail(`notification.mjs plays sound stage "${m[1]}", which no profile defines`);
  }
}

/* ── 6. a preset only remaps the accent channel + feature-local tokens ─── */
{
  const vars = [...themes.matchAll(/"(--[a-z0-9-]+)"\s*:/g)].map((m) => m[1]);
  const allowed = (v) => v === "--gl-accent" || v.startsWith("--insight-");
  for (const v of [...new Set(vars)]) {
    if (!allowed(v)) {
      fail(`themes.mjs preset sets ${v} — a preset may only remap --gl-accent and this feature's own --insight-* tokens, or it forks the theme`);
    }
  }
  if (!vars.includes("--gl-accent")) fail("no preset sets --gl-accent — presets exist to route identity through that one channel");
}

/* ── 7. no :root accent derivative, which would not follow the remap ───── */
{
  const trap = ["--gl-glow", "--gl-bloom", "--gl-accent-soft", "--gl-accent-faint"];
  for (const t of trap) {
    if (new RegExp(`var\\(${t}\\)`).test(css)) {
      fail(`insight.css reads var(${t}) — that is computed at :root against the :root accent and does NOT follow this feature's scoped --gl-accent remap; strike the value inline with color-mix() instead`);
    }
  }
}

/* ── 8. keyframes: every reference resolves, every declaration is scoped ─ */
{
  const styleDir = resolve(ROOT, "styles");
  const declared = new Set();
  for (const f of await readdir(styleDir)) {
    if (!f.endsWith(".css")) continue;
    for (const m of (await read(`styles/${f}`)).matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) declared.add(m[1]);
  }

  const referenced = new Set();
  for (const m of css.matchAll(/animation:\s*([A-Za-z][A-Za-z0-9_-]*)/g)) {
    if (m[1] !== "none") referenced.add(m[1]);
  }
  for (const name of referenced) {
    if (!declared.has(name)) fail(`insight.css animates "${name}", which no @keyframes in styles/ declares`);
  }

  for (const m of css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)) {
    if (!m[1].startsWith("insight-")) {
      fail(`insight.css declares @keyframes ${m[1]} — keyframe names are global across the suite, so it must carry the feature prefix`);
    }
  }
}

/* ── 9. the template and the stylesheet describe the same thing ────────── */
{
  // Checks 1–8 only reach the nodes JS touches. Most of the arrival is nodes
  // it never touches — the flash, the scan, the four corner marks, the frame —
  // which exist purely so CSS can animate them. Rename one of those in either
  // file and that beat simply stops happening, with nothing to notice it.
  //
  // So: every `insight-*` class the stylesheet targets must be either rendered
  // by the template or applied at runtime, and every one the template renders
  // must be styled. A class on exactly one side of that is dead on the other.
  // insight.css dresses two surfaces, so both markup sources count: the
  // arrival template and the GM's compose dialog.
  const markup = template + (await read("templates/insight/compose-dialog.hbs"));
  const script = notification + (await read("scripts/features/insight/module/compose-dialog.mjs"));

  const rendered = new Set();
  for (const m of markup.matchAll(/class="([^"]*)"/g)) {
    for (const t of m[1].split(/\s+/)) if (t.startsWith("insight-")) rendered.add(t);
  }

  // State and tier classes are applied at runtime, never written in markup.
  const runtime = new Set(["insight-dismissing"]);
  for (const m of script.matchAll(/classList\.add\("([a-z0-9-]+)"\)/g)) runtime.add(m[1]);
  // ApplicationV2 puts its `classes:` array on the window frame.
  for (const m of script.matchAll(/classes:\s*\[([^\]]*)\]/g)) {
    for (const c of m[1].matchAll(/"(insight-[a-z0-9-]+)"/g)) runtime.add(c[1]);
  }
  // The intensity table, and the speed tiers, which are built by interpolation.
  for (const m of script.matchAll(/"(insight-intensity-[a-z]+)"/g)) runtime.add(m[1]);
  if (/`insight-speed-\$\{/.test(script)) {
    for (const m of css.matchAll(/\.(insight-speed-[a-z]+)/g)) runtime.add(m[1]);
  }

  const styled = new Set([...css.matchAll(/\.(insight-[a-z0-9-]+)/g)].map((m) => m[1]));

  for (const cls of styled) {
    if (!rendered.has(cls) && !runtime.has(cls)) {
      fail(`insight.css styles .${cls}, which notification.hbs never renders and notification.mjs never applies — that rule is dead`);
    }
  }
  for (const cls of rendered) {
    if (!styled.has(cls)) {
      fail(`notification.hbs renders .${cls}, which insight.css never styles — that node draws nothing`);
    }
  }
  if (!styled.size || !rendered.size) fail("the template/stylesheet scan found nothing — the scan is broken, not the files");
}

/* ── report ───────────────────────────────────────────────────────────── */
if (problems.length) {
  console.error(`insight-check: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error("  • " + p);
  process.exit(1);
}
console.log("insight-check: no problems");
