/**
 * tools/insight-preview.mjs — write a live preview page for the Insight arrival.
 *
 * The whole point of this feature is what a full viewport does when a message
 * lands, and none of it is visible in a diff: the four edge bands rushing in,
 * the vignette, the frame strike, the corner registration, the scan, and the
 * way the card unfolds out of the cut. So the page loads the REAL stylesheets
 * (gl-fonts / gl-tokens / gl-motion / insight.css) and the REAL template markup
 * — never a hand-copied lookalike, which would drift the moment either changes
 * and then quietly stop proving anything.
 *
 *   node tools/insight-preview.mjs --out=.preview/insight.html
 *   node tools/preview-server.mjs        # then open the URL it prints
 *
 * SERVE it. A file:// page loads the CSS but not the module script that drives
 * the stages, so you get a card frozen at its pre-entry values and conclude,
 * wrongly, that the reveal is broken.
 *
 * ── Why the page draws its own "screens" ────────────────────────────────
 * A real arrival is 1600×900 of screen. A preview pane is whatever it is, and
 * the shot has to show the whole frame at once or the edge is not what is being
 * judged. So each row renders the stage into a fixed-size box (1200×675, a real
 * 16:9 desktop) and scales the box to fit. `position: fixed` resolves against a
 * transformed ancestor, so the stage fills that box exactly as it fills a
 * viewport — no changes to the shipped CSS, and one harness override
 * (`.insight-notification` width, whose `84vw` guard would otherwise read the
 * real pane rather than the box).
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const outArg = process.argv.find((a) => a.startsWith("--out="));
const OUT = resolve(ROOT, outArg ? outArg.slice(6) : ".preview/insight.html");

/**
 * Render the shipped Handlebars template with the small subset of the syntax it
 * actually uses ({{#if}}, {{localize}}, {{{triple}}}, {{plain}}).
 */
function renderTemplate(src, ctx, i18n) {
  let out = src.replace(/\{\{!--[\s\S]*?--\}\}/g, "");

  const ifRe = /\{\{#if (\w+)\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g;
  for (let pass = 0; pass < 4; pass++) {
    if (!ifRe.test(out)) break;
    ifRe.lastIndex = 0;
    out = out.replace(ifRe, (_m, key, yes, no) => (ctx[key] ? yes : no ?? ""));
  }

  out = out.replace(/\{\{localize "([^"]+)"\}\}/g, (_m, k) => i18n[k] ?? k);
  out = out.replace(/\{\{\{(\w+)\}\}\}/g, (_m, k) => ctx[k] ?? "");
  out = out.replace(/\{\{(\w+)\}\}/g, (_m, k) => String(ctx[k] ?? ""));
  return out;
}

const I18N = {
  "INSIGHT.Dismiss": "Acknowledge",
  "INSIGHT.SenseDefault": "Insight",
};

/* The real preset table, straight out of the feature. themes.mjs touches no
   Foundry global at module scope, so it imports cleanly here — which is the
   point: a mirror of it in this file would drift on the next retune and the
   preview would go on showing a look nobody ships. */
const { getPresets } = await import("../scripts/features/insight/module/themes.mjs");
const PRESETS = Object.fromEntries(
  Object.entries(getPresets()).map(([id, cfg]) => [id, cfg.vars])
);

const SAMPLES = {
  whisper: {
    id: "insight-1730000000-a4f2",
    serial: "A4F2",
    title: "",
    sense: "",
    body:
      "The hairs on the back of your neck rise. Something behind the shrine " +
      "has been <b>watching you</b> since you crossed the threshold, and it " +
      "has just decided you are worth the trouble.",
  },
  titled: {
    id: "insight-1730000001-9c1d",
    serial: "9C1D",
    title: "You Recognise the Sigil",
    sense: "Perception · DC 22",
    body:
      "It is the same mark that was burned into the cellar door in Vethkar — " +
      "the one your sister told you never to open. <i>Whoever is here has " +
      "been here before you.</i>",
  },
  divine: {
    id: "insight-1730000002-77b0",
    serial: "77B0",
    title: "A Warmth Behind the Ribs",
    sense: "Divine Sense",
    body:
      "Your god is paying attention. Not approving — <b>attending</b>. The " +
      "difference will matter before this room is finished with you.",
  },
};

/** Each row of the sheet: one simulated screen. */
const ROWS = [
  { key: "a", note: "Full edge · Dreadlight · titled", sample: "titled", preset: "dreadlight", intensity: "full" },
  { key: "b", note: "Full edge · Fantasy accent · the amber preset", sample: "divine", preset: "fantasy", intensity: "full" },
  { key: "c", note: "Subtle edge · no vignette, half burn", sample: "whisper", preset: "dreadlight", intensity: "subtle" },
  { key: "d", note: "Edge off · the card carries it alone", sample: "whisper", preset: "dreadlight", intensity: "off" },
];

const template = await readFile(resolve(ROOT, "templates/insight/notification.hbs"), "utf8");

const rows = ROWS.map((r) => ({
  ...r,
  html: renderTemplate(template, SAMPLES[r.sample], I18N),
}));

/** The card row, shown at 1:1 so the typography can be judged. */
const detail = renderTemplate(template, SAMPLES.titled, I18N);

const page = `<!doctype html>
<meta charset="utf-8">
<title>Insight — arrival preview</title>
<link rel="stylesheet" href="/styles/gl-fonts.css">
<link rel="stylesheet" href="/styles/gl-tokens.css">
<link rel="stylesheet" href="/styles/gl-motion.css">
<link rel="stylesheet" href="/styles/insight.css">
<style>
  :root { --screen-w: 1200px; --screen-h: 675px; }
  html { background: #05070a; }
  body {
    margin: 0; padding: 0 0 60px;
    font-family: var(--gl-display); color: var(--gl-text);
    background: #05070a;
  }

  header {
    position: sticky; top: 0; z-index: 500;
    display: flex; gap: 10px; align-items: center; flex-wrap: wrap;
    padding: 12px 16px;
    background: rgb(5 7 10 / .94);
    border-bottom: 1px solid rgb(255 255 255 / .14);
    font: 700 11px/1 var(--gl-tech, monospace);
    letter-spacing: .12em; text-transform: uppercase;
  }
  header button, header select {
    font: inherit; color: #eef1f7; padding: 8px 10px; cursor: pointer;
    background: rgb(255 255 255 / .08);
    border: 1px solid rgb(255 255 255 / .22); border-radius: 4px;
  }
  header button:hover { background: rgb(255 255 255 / .18); }
  header .muted { opacity: .5; }

  .caption {
    padding: 22px 16px 8px;
    font: 700 10px/1.5 var(--gl-tech, monospace);
    letter-spacing: .2em; text-transform: uppercase; color: #8b97ac;
  }
  .caption b { color: #eef1f7; font-weight: 700; }

  /* A simulated desktop. Fixed pixel metrics inside, scaled to fit outside;
     the transform is also what makes the stage's position:fixed resolve here
     instead of against the real viewport. */
  .fit { width: 100%; overflow: hidden; }
  .screen {
    position: relative;
    width: var(--screen-w); height: var(--screen-h);
    transform-origin: top left;
    overflow: hidden;
    isolation: isolate;
    /* stand-in for a lit Foundry canvas — over pure black every glow is a
       triumph, which is exactly the judgement this page must not flatter. */
    background:
      radial-gradient(70% 55% at 30% 28%, #2a3a4d, transparent 70%),
      radial-gradient(60% 50% at 78% 74%, #3a2c3d, transparent 72%),
      repeating-linear-gradient(0deg, rgb(255 255 255 / .04) 0 1px, transparent 1px 74px),
      repeating-linear-gradient(90deg, rgb(255 255 255 / .04) 0 1px, transparent 1px 74px),
      #131a22;
  }

  /* HARNESS OVERRIDE — the only one. The shipped width guard is min(640px,
     84vw), and 84vw here reads the real pane, not the simulated screen. */
  .screen .insight-notification { width: 640px; }

  /* mock Foundry furniture, so the card is judged against real neighbours */
  .mock-sidebar {
    position: absolute; right: 0; top: 0; bottom: 0; width: 300px;
    background: rgb(0 0 0 / .42); border-left: 1px solid rgb(255 255 255 / .09);
  }
  .mock-hotbar { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 5px; }
  .mock-hotbar i { width: 50px; height: 50px; border: 1px solid rgb(255 255 255 / .13); background: rgb(0 0 0 / .45); border-radius: 4px; }
  .mock-token {
    position: absolute; width: 104px; height: 104px; border-radius: 50%;
    border: 2px solid rgb(255 255 255 / .3);
    background: radial-gradient(circle at 36% 30%, #7d6a55, #35281c);
  }

  /* 1:1 card row — no scaling, no canvas, just the panel */
  .detail {
    /* a transform, like .screen, so the stage's position:fixed resolves here
       rather than escaping to the real viewport and covering the whole sheet */
    transform: translateZ(0);
    position: relative; height: 470px; overflow: hidden;
    background: #0c1017;
    border-top: 1px solid rgb(255 255 255 / .1);
    border-bottom: 1px solid rgb(255 255 255 / .1);
  }
  .detail .insight-notification { width: 640px; }
  .detail .insight-edge { display: none; }
</style>

<header>
  <span class="muted">insight</span>
  <button id="replay">Replay all ⏎</button>
  <button id="freeze">Freeze at flare</button>
  <select id="speed">
    <option value="normal">Normal</option>
    <option value="fast">Fast</option>
    <option value="instant">Instant</option>
  </select>
  <span class="muted" id="fit"></span>
</header>

${rows
  .map(
    (r) => `<div class="caption"><b>${r.key.toUpperCase()}</b> · ${r.note}</div>
<div class="fit"><div class="screen" data-screen="${r.key}" data-preset="${r.preset}" data-intensity="${r.intensity}">
  <div class="mock-sidebar"></div>
  <div class="mock-hotbar"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="mock-token" style="left: 20%; top: 30%"></div>
  <div class="mock-token" style="left: 31%; top: 56%"></div>
  <template>${r.html}</template>
</div></div>`
  )
  .join("\n")}

<div class="caption"><b>E</b> · The card at 1:1 — type, spacing, the commit control</div>
<div class="detail" data-screen="e" data-preset="dreadlight" data-intensity="off">
  <template>${detail}</template>
</div>

<script type="module">
/* The runtime's own stage clock, restated so the preview cannot drift silently
   from notification.mjs. Keep the two in step. */
const TIMINGS = {
  normal:  { edge: 0, line: 280, card: 760, contentStart: 1060, contentStagger: 110 },
  fast:    { edge: 0, line: 140, card: 380, contentStart: 530,  contentStagger: 60 },
  instant: { edge: 0, line: 0,   card: 0,   contentStart: 0,    contentStagger: 0 },
};
const INTENSITY_CLASS = { full: null, subtle: "insight-intensity-subtle", off: "insight-intensity-off" };
const PRESETS = ${JSON.stringify(PRESETS)};

const boxes = [...document.querySelectorAll("[data-screen]")];
let timers = [];

/* Scale each simulated desktop to the page width and reserve its scaled
   height, so the whole 16:9 frame is in one shot however wide the pane is. */
function fitScreens() {
  const width = document.querySelector(".fit").clientWidth;
  const z = Math.min(1, width / 1200);
  for (const s of document.querySelectorAll(".screen")) {
    s.style.transform = "scale(" + z + ")";
    s.parentElement.style.height = Math.round(675 * z) + "px";
  }
  document.getElementById("fit").textContent = "screen 1200×675 @ " + z.toFixed(2) + "×";
}

function play() {
  timers.forEach(clearTimeout);
  timers = [];
  const speed = document.getElementById("speed").value;
  const t = TIMINGS[speed];

  for (const box of boxes) {
    box.querySelector(".insight-stage")?.remove();
    const el = box.querySelector("template").content.firstElementChild.cloneNode(true);

    if (speed !== "normal") el.classList.add("insight-speed-" + speed);
    const ic = INTENSITY_CLASS[box.dataset.intensity];
    if (ic) el.classList.add(ic);
    for (const [k, v] of Object.entries(PRESETS[box.dataset.preset])) el.style.setProperty(k, v);
    box.appendChild(el);

    const at = (d, fn) => timers.push(setTimeout(fn, d));
    const q = (s) => el.querySelector(s);
    const content = [
      ".insight-icon", ".insight-sense", ".insight-serial", ".insight-title",
      ".insight-divider", ".insight-image", ".insight-body", ".insight-datastrip",
      ".insight-dismiss",
    ].map(q).filter(Boolean);

    at(t.edge, () => q(".insight-edge").classList.add("insight-visible"));
    at(t.line, () => {
      q(".insight-notification").classList.add("insight-visible");
      q(".insight-fracture-line").classList.add("insight-visible");
    });
    at(t.card, () => {
      q(".insight-fracture-card").classList.add("insight-visible");
      q(".insight-fracture-bg-back").classList.add("insight-glitch");
    });
    content.forEach((c, i) => at(t.contentStart + i * t.contentStagger, () => c.classList.add("insight-fade-in")));

    q(".insight-dismiss").addEventListener("click", () => {
      el.classList.add("insight-dismissing");
      setTimeout(() => el.remove(), 900);
    });
  }
}

/* Hold every animation at its brightest frame, so a still shows the flare
   rather than whichever moment the shutter happened to land on. */
function freeze() {
  play();
  setTimeout(() => {
    for (const a of document.getAnimations()) {
      const target = a.effect?.target;
      if (!target || !target.closest?.(".insight-stage")) continue;
      a.pause();
      const active = a.effect.getComputedTiming().activeDuration;
      a.currentTime = (Number.isFinite(active) ? active : 600) * 0.34;
    }
  }, 60);
}

document.getElementById("replay").addEventListener("click", play);
document.getElementById("freeze").addEventListener("click", freeze);
document.getElementById("speed").addEventListener("change", play);
addEventListener("keydown", (e) => { if (e.key === "Enter") play(); });
addEventListener("resize", fitScreens);

fitScreens();
play();
</script>
`;

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, page, "utf8");
const rel = OUT.slice(ROOT.length).replace(/\\/g, "/");
console.log("wrote " + OUT);
console.log("serve it:  node tools/preview-server.mjs");
console.log("then open: http://localhost:8931/" + rel);

/* ────────────────────────────────────────────────────────────────────────
   --artifact=<path> — the same page, self-contained.
   The served preview links the stylesheets off the repo, which only works
   behind preview-server. For a page that has to open anywhere (a review link,
   a phone), inline the very same three files and swap the bundled font layer
   for the one web host that will serve those two faces. Derived from the page
   above rather than written a second time, so the two cannot drift into
   showing different designs.
   ──────────────────────────────────────────────────────────────────────── */
const artifactArg = process.argv.find((a) => a.startsWith("--artifact="));
if (artifactArg) {
  const ART = resolve(ROOT, artifactArg.slice(11));

  const sheets = [];
  for (const f of ["styles/gl-tokens.css", "styles/gl-motion.css", "styles/insight.css"]) {
    sheets.push("/* ==== " + f + " ==== */\n" + (await readFile(resolve(ROOT, f), "utf8")));
  }

  // The artifact host supplies the document skeleton, and the bundled faces
  // are not reachable from a published page.
  const body = page
    .replace(/^<!doctype html>\n<meta charset="utf-8">\n<title>[^<]*<\/title>\n/, "")
    .replace(/<link rel="stylesheet" href="\/styles\/[^"]*">\n/g, "");

  const head = [
    // The artifact host wraps this in its own head, which declares utf-8 —
    // but the same file also has to open straight off disk and from
    // preview-server, neither of which sends a charset. Without this the
    // em dashes and middots in the copy (and in the card body) come out as
    // mojibake, which is exactly the kind of thing a review page must not
    // teach the reviewer to ignore.
    '<meta charset="utf-8">',
    '<title>Insight Arrival</title>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Oxanium:wght@200..800&family=JetBrains+Mono:wght@100..800&display=swap">',
    "<style>",
    sheets.join("\n\n"),
    "</style>",
    "<style>",
    "  /* The suite bundles both faces locally; a published page has to reach",
    "     them by the same two custom properties, so that nothing else in the",
    "     design system has to know the difference. */",
    "  :root {",
    '    --gl-display: "Oxanium", "Segoe UI", system-ui, sans-serif;',
    '    --gl-tech: "Bahnschrift", "JetBrains Mono", Consolas, monospace;',
    "  }",
    "  .intro {",
    "    max-width: 62ch;",
    "    padding: 36px 16px 4px;",
    "    font-family: var(--gl-display);",
    "    color: var(--gl-text);",
    "  }",
    "  .intro .eyebrow {",
    "    font-family: var(--gl-tech);",
    "    font-size: var(--gl-fs-2xs);",
    "    font-weight: var(--gl-weight-bold);",
    "    letter-spacing: var(--gl-track-xwide);",
    "    text-transform: uppercase;",
    "    color: var(--gl-violet);",
    "    margin-bottom: 10px;",
    "  }",
    "  .intro h1 {",
    "    margin: 0 0 14px;",
    "    font-size: var(--gl-fs-3xl);",
    "    font-weight: var(--gl-weight-heavy);",
    "    letter-spacing: var(--gl-track-tight);",
    "    line-height: var(--gl-lh-tight);",
    "    text-wrap: balance;",
    "  }",
    "  .intro p { line-height: var(--gl-lh-loose); color: #b3bece; margin: 0 0 14px; }",
    "  .intro em { color: var(--gl-text-bright); font-style: normal; font-weight: var(--gl-weight-medium); }",
    "  .beats {",
    "    display: grid; margin: 24px 0 0; padding: 0; list-style: none;",
    "    border-top: 1px solid rgb(var(--gl-tint-light) / .1);",
    "  }",
    "  .beats li {",
    "    display: grid; grid-template-columns: 76px 1fr; gap: 14px;",
    "    padding: 11px 0; border-bottom: 1px solid rgb(var(--gl-tint-light) / .1);",
    "    line-height: var(--gl-lh-normal); color: #b3bece;",
    "  }",
    "  .beats b {",
    "    font-family: var(--gl-tech); font-size: var(--gl-fs-3xs);",
    "    font-weight: var(--gl-weight-bold); letter-spacing: var(--gl-track-wide);",
    "    text-transform: uppercase; color: var(--gl-text-faint);",
    "    font-variant-numeric: tabular-nums; padding-top: 3px;",
    "  }",
    "</style>",
  ].join("\n");

  const intro = [
    '<div class="intro">',
    '  <div class="eyebrow">GLUniverse Suite &middot; Insight &middot; rework</div>',
    "  <h1>Insight Arrival</h1>",
    "  <p>A private whisper used to slide in at 348&nbsp;px against the right",
    "  margin and wait to be noticed. It now arrives in two layers. The",
    "  <em>screen edge</em> takes the accent first &mdash; four bands rushing in,",
    "  a hairline frame striking, the corner marks registering, one scan crossing",
    "  &mdash; and only then does the cut open and the card unfold at centre",
    "  stage, 640&nbsp;px wide with the body set at 17&nbsp;px. The edge keeps",
    "  breathing until the message is acknowledged.</p>",
    "  <p>Nothing on the stage takes the pointer except the card, so the canvas",
    "  stays playable underneath. The frames below are live, not screenshots",
    "  &mdash; press <em>Replay all</em> to watch the arrival, or drop the speed",
    "  to Fast to see how it plays for someone who has read a hundred of",
    "  these.</p>",
    '  <ul class="beats">',
    "    <li><b>0 ms</b><span>Impact. The edge flares, the four bands rush in, the sub thump lands.</span></li>",
    "    <li><b>120 ms</b><span>The frame strikes, the corner marks register in sequence, one scan crosses the view.</span></li>",
    "    <li><b>280 ms</b><span>The cut draws from the centre outwards, wider than the card it opens.</span></li>",
    "    <li><b>760 ms</b><span>The panel unfolds out of the cut and the sheen sweeps across it.</span></li>",
    "    <li><b>1060 ms</b><span>Content cascades in behind the sheen &mdash; mark, kicker, title, rule, body, strip, control.</span></li>",
    "    <li><b>then</b><span>The edge settles into a slow breath and holds there until Acknowledge.</span></li>",
    "  </ul>",
    "</div>",
    "",
  ].join("\n");

  await mkdir(dirname(ART), { recursive: true });
  await writeFile(ART, head + "\n" + intro + body, "utf8");
  console.log("wrote " + ART + "  (self-contained)");
}
