/**
 * Resource bars — consistency check.
 *
 *   node tools/resource-bar-check.mjs
 *   node tools/resource-bar-check.mjs --sheet=/tmp/bars.html
 *
 * Everything below fails *silently* in a running world, which is the bar this
 * repo sets for writing one of these. A shader that will not compile degrades
 * to a static fallback rather than erroring; a uniform that is declared and
 * never set is a no-op; a duration written as a literal ignores the user's
 * motion tier forever; and a numeric readout drawn outside the displayBars gate
 * leaks a hostile's hit points while looking completely correct.
 *
 * The browser-backed pass needs Playwright and skips cleanly without it, as
 * `tools/stage-lighting-preview.mjs` does.
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);
const rel = (p) => fileURLToPath(new URL(p, ROOT));

let problems = 0;
const fail = (msg) => { console.log("FAIL  " + msg); problems++; };
const ok = (msg) => console.log("ok    " + msg);

const src = async (p) => readFile(rel(p), "utf8");
/* Comments are prose and routinely contain the words we grep for. */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const shader = await import(new URL("scripts/features/resource-bars/shader.mjs", ROOT).href);
const anim = await import(new URL("scripts/features/resource-bars/anim.mjs", ROOT).href);
const ramp = await import(new URL("scripts/features/resource-bars/ramp.mjs", ROOT).href);

const shaderSrc = await src("scripts/features/resource-bars/shader.mjs");
const hostSrc = await src("scripts/features/resource-bars/host.mjs");
const animSrc = await src("scripts/features/resource-bars/anim.mjs");
const tokensCss = await src("styles/gl-tokens.css");

/* ── 1. The uniform table, the GLSL and the JS all agree ────────────────── */
{
  const glsl = strip(shader.FRAGMENT_SHADER);
  const declared = new Set([...glsl.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]));
  const listed = new Set(Object.keys(shader.UNIFORMS));

  for (const u of listed) if (!declared.has(u)) fail(`UNIFORMS lists ${u}, which the GLSL never declares.`);
  for (const u of declared) if (!listed.has(u)) fail(`GLSL declares ${u}, which UNIFORMS does not list.`);

  /* A uniform nothing writes is a silent no-op, not an error. */
  const written = strip(hostSrc);
  for (const u of listed) {
    if (u === "uTexel") continue;                       // written through texelFor()
    if (!new RegExp(`\\b${u}\\b`).test(written) && !new RegExp(`\\b${u}\\b`).test(strip(shaderSrc.split("FRAGMENT_SHADER")[0])))
      fail(`${u} is declared but never written from host.mjs — it will always hold its initial value.`);
  }
  if (!problems) ok(`${listed.size} uniforms: declared, listed and written`);
}

/* ── 2. uTexel = 0 must be inert ────────────────────────────────────────── */
{
  const glsl = strip(shader.FRAGMENT_SHADER);
  /* Every clamp against px must be a max()/smoothstep that degrades to the
     unfiltered form at px = 0 — never a divide by it. */
  const divides = [...glsl.matchAll(/\/\s*uTexel\b/g)];
  if (divides.length) fail(`The shader divides by uTexel directly in ${divides.length} place(s). Divide by px, which is floored to an epsilon — uTexel itself is 0 whenever the uniform is missing.`);
  if (!/px = max\(uTexel \* uAspect, [0-9.]+\)/.test(glsl))
    fail("px is not derived as max(uTexel * uAspect, epsilon); the epsilon is what keeps uTexel 0 inert.");
  else ok("uTexel 0 is inert (px floors to epsilon, no divisions by px)");
}

/* ── 3. The ramp still mirrors gl-tokens.css ────────────────────────────── */
{
  const cssHex = (name) => tokensCss.match(new RegExp(`--gl-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1]?.toLowerCase();
  const pairs = [["hazard", 0], ["warn-deep", 1], ["signal", 2], ["good", 3]];
  let drift = 0;
  for (const [css, i] of pairs) {
    const want = cssHex(css);
    const have = String(ramp.RAMPS.default[i]).toLowerCase();
    if (!want) { fail(`gl-tokens.css has no --gl-${css}; the ramp mirrors a token that no longer exists.`); drift++; }
    else if (want !== have) { fail(`Ramp stop ${i} is ${have} but --gl-${css} is ${want}. The JS mirror has drifted from the stylesheet.`); drift++; }
  }
  if (!drift) ok("health ramp mirrors --gl-hazard / --gl-warn-deep / --gl-signal / --gl-good");
}

/* ── 4. No raw durations in the animation path ──────────────────────────── */
{
  const body = strip(animSrc).split("export const TIMING")[1]?.split("});")[1] ?? "";
  const literals = [...body.matchAll(/(?<![.\d])(\d{2,5})(?![.\d])/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n >= 40 && n <= 5000);
  if (literals.length)
    fail(`anim.mjs has millisecond-looking literals outside TIMING: ${[...new Set(literals)].join(", ")}. Every duration must route through TIMING so the motion tier can scale it.`);
  else ok("every duration lives in TIMING and is scaled by the motion tier");

  for (const key of ["stopMs", "holdMs", "drainMs", "chipMs", "bloomMs", "flashMs",
                     "fillMs", "countMs", "waveMs", "hitMs", "punchMs",
                     "popupMs", "hotMs"])
    if (!(key in anim.TIMING)) fail(`TIMING is missing ${key}.`);
}

/* ── 4b. The hitstop actually stops ─────────────────────────────────────── */
{
  /* The whole impact sequence is built on a beat of held frames. If the freeze
     ever stops holding — a channel added below it, an early return removed —
     nothing errors and nothing looks broken; the hit just goes back to reading
     as a transition, which is a regression nobody can point at. */
  const a = new anim.BarAnim(1, { motionScale: 1 });
  a.step(16);
  a.set(0.5);
  const before = { frac: a.frac, ghost: a.ghost, num: a.num };
  a.step(16);
  const frozen = a.frac === before.frac && a.ghost === before.ghost && a.num === before.num;
  if (!frozen) fail("The hitstop does not hold: a value moved on the first frame after a change.");
  else if (a.flash !== 1 || a.wave !== 1)
    fail("The hitstop holds the values but not the reaction channels; flash and the sweep must be at peak during the freeze.");
  else ok(`hitstop holds every channel for ${anim.TIMING.stopMs}ms`);

  /* And releases. A freeze that never ends is a bar that never animates.
     Measured on `flash`, not on `frac`: on damage the fill is already at its
     new value and — now that nothing springs — never moves again, so a value
     that stays put is the correct behaviour rather than evidence of a freeze. */
  let guard = 0;
  while (a.flash >= 1 && guard++ < 40) a.step(16);
  if (guard >= 40) fail("The hitstop never releases; every channel is still held after 640ms.");

  /* The readout counts rather than snapping — the reason `num` exists at all
     as a channel separate from `frac`. */
  const b = new anim.BarAnim(1, { motionScale: 1 });
  b.step(16);
  b.set(0.2);
  for (let i = 0; i < Math.ceil(anim.TIMING.stopMs / 16) + 1; i++) b.step(16);
  if (!(b.num > b.target && b.num < 1))
    fail("The readout snaps to the new value instead of counting to it (anim.num is not tweening).");
  else ok("the readout counts to the new value rather than snapping");
}

/* ── 5. The glyph atlas covers everything a run can emit ────────────────── */
{
  const atlasSrc = await src("scripts/features/resource-bars/atlas.mjs");
  const glyphs = strip(atlasSrc).match(/const GLYPHS = "([^"]+)"/)?.[1] ?? "";
  const needed = "0123456789/+-";
  const missing = [...needed].filter((c) => !glyphs.includes(c));
  if (missing.length) fail(`The atlas is missing glyph(s) ${missing.join(" ")}; a run containing one draws a gap.`);
  else ok(`atlas covers ${glyphs.length} glyphs, including the delta signs`);
}

/* ── 6. Numbers never escape the displayBars gate ───────────────────────── */
{
  const h = strip(hostSrc);
  if (!/canViewNumbers\(/.test(h))
    fail("host.mjs never calls canViewNumbers; the numeric readout is not permission-gated and will leak hidden hit points.");
  else if (!/writeNumbers[\s\S]{0,400}canViewNumbers\(/.test(h))
    fail("writeNumbers does not consult canViewNumbers before drawing.");
  else ok("the numeric readout is inside the displayBars gate");

  const vis = strip(await src("scripts/features/resource-bars/visibility.mjs"));
  if (!/token\.bars[\s\S]{0,120}visible/.test(vis))
    fail("visibility.mjs no longer defers to Foundry's own token.bars.visible; recomputing the rule invites drift from core.");
}

/* ── 7. Every animated behaviour can be shed ────────────────────────────── */
{
  const h = strip(hostSrc);
  const gated = new Set([...h.matchAll(/allows\("(\w+)"\)/g)].map((m) => m[1]));
  for (const e of gated)
    if (!anim.SHED_ORDER.includes(e)) fail(`host.mjs gates "${e}" but SHED_ORDER does not list it, so it never actually degrades.`);
  const animated = ["sweep", "ghost", "bloom", "numbers", "popups", "ring", "punch",
                    "sparks", "wave"];
  for (const e of animated)
    if (!gated.has(e)) fail(`"${e}" is animated but is not behind an allows() gate; under load it can never be shed.`);
  for (const e of anim.SHED_ORDER)
    if (!gated.has(e)) fail(`SHED_ORDER lists "${e}" but nothing gates on it, so the entry is dead and the order it implies is a lie.`);
  if (!problems) ok(`shed table covers all ${gated.size} animated behaviours`);
}

/* ── 7b. The bars sort above the token furniture ────────────────────────── */
{
  /* `canvas.interface` sorts its children by zIndex and every Foundry layer
     declares one. A container left at the default 0 renders *under* the tokens
     layer — which is where a Token's hover box, target reticle and nameplate
     live — so the bars come out correct in every respect except that the hover
     border is drawn straight over them. Nothing errors; it just looks wrong
     only while a token is hovered, which is when a GM is least likely to be
     inspecting the HUD. */
  const h = strip(hostSrc);
  const z = h.match(/const CONTAINER_Z\s*=\s*(\d+)/)?.[1];
  if (!z) fail("host.mjs no longer declares CONTAINER_Z; the bar container will sort under the tokens layer and the hover box will draw over it.");
  else if (!/container\.zIndex\s*=\s*CONTAINER_Z/.test(h))
    fail("CONTAINER_Z is declared but never assigned to the container's zIndex.");
  else if (Number(z) <= 800 || Number(z) >= 1000)
    fail(`CONTAINER_Z is ${z}; it must clear the notes layer (800) and stay under the controls layer (1000), which owns rulers and door controls.`);
  else ok(`bar container sorts at zIndex ${z}, above the token furniture and below the controls layer`);
}

/* ── 7c. An unset per-token offset means "inherit", not "zero" ──────────── */
{
  /* The Token Config field is empty when a token has no override. Foundry turns
     an empty Number field into null only when the input declares
     data-dtype="Number"; without it the empty field submits "" which coerces to
     0, and every token silently pins its bars at the origin while the world
     default stops applying. The sheet looks completely normal. */
  const tc = strip(await src("scripts/features/resource-bars/token-config.mjs"));
  if (!/dataset\.dtype\s*=\s*"Number"/.test(tc))
    fail('The Token Config offset inputs do not declare data-dtype="Number"; an emptied field will read as a deliberate 0 rather than as "inherit the world default".');
  else ok("an emptied per-token offset falls back to the world default");

  if (!/Number\.isFinite\(v\)\s*\?\s*v\s*:\s*fallback/.test(strip(hostSrc)))
    fail("host.mjs's offsetFor no longer tests the flag for finiteness; a null or empty-string flag will coerce to 0 and override the world default.");

  if (!/name:\s*`flags\.\$\{SUITE_ID\}/.test(await src("scripts/features/resource-bars/token-config.mjs")))
    fail("The Token Config inputs are not named for the flag path; they will not be saved by the sheet's own submit.");
}

/* ── 7d. The maximum steps back by one step, not into furniture ─────────── */
{
  /* The maximum is the scale the reading is measured against, so it ranks below
     the value — by one step. Both failure modes render perfectly. At full
     strength a small numeral is still high-contrast against the plate and
     competes with the number that actually changes; down at the 0.22/0.30 this
     once used, the denominator becomes furniture you have to go looking for.
     So the weight is pinned to a band, not merely to existing, and the
     mechanism carrying it is pinned end to end: drop either half of aDim and
     the run still draws, at full strength, silently flattening the hierarchy. */
  const atlasSrc = strip(await src("scripts/features/resource-bars/atlas.mjs"));
  const h = strip(hostSrc);
  const declared = /attribute float aDim/.test(atlasSrc);
  const supplied = /addAttribute\("aDim"/.test(atlasSrc);
  const used = /vDim/.test(atlasSrc);
  const weights = [...h.matchAll(/\bdim:\s*(\d*\.?\d+)/g)].map((m) => Number(m[1]));
  const faint = weights.filter((w) => w < 0.5);
  if (!declared || !supplied || !used)
    fail("The readout's per-glyph weight is incomplete (aDim must be declared, supplied by runGeometry and read as vDim); the maximum will draw at full strength and compete with the value.");
  else if (!weights.length)
    fail("Nothing in host.mjs passes a dim weight, so the maximum draws at exactly the value's strength and the two compete.");
  else if (faint.length)
    fail(`The readout carries a weight of ${Math.min(...faint)}; below 0.5 the maximum stops being a quieter number and becomes furniture the reader has to go looking for.`);
  else if (!weights.some((w) => w < 1))
    fail("Every readout weight is 1, so there is no step between the value and the maximum at all.");
  else ok(`the maximum steps back by one step (weights ${weights.join(", ")}), through the run's own attribute`);
}

/* ── 7d2. The readout's size setting actually takes effect ──────────────── */
{
  /* The run's geometry is cached, and the cache key is what decides whether a
     setting does anything. Key it on the label alone and the size slider moves,
     nothing happens, and the new size appears minutes later when the creature
     next takes damage — which reads as the setting being broken rather than as
     a stale cache. The same key is what re-sizes a resized token's readout. */
  const h = strip(hostSrc);
  if (!/numberScale/.test(h))
    fail("host.mjs never reads numberScale, so the readout size setting does nothing.");
  else if (!/lastNumber\s*=\s*stamp/.test(h) || !/stamp\s*=[^;]*numScale/.test(h))
    fail("The readout's geometry cache is not keyed on its size, so changing the size setting leaves the old geometry until the value next changes.");
  else if (!/popupText\s*=\s*popStamp/.test(h) || !/popStamp\s*=[^;]*numScale/.test(h))
    fail("The floating delta's cache is not keyed on its size, so it keeps whatever size it was first drawn at.");
  else ok("the readout and the delta cache on their size, not only on their text");
}

/* ── 7d3. The GM override cannot widen what a player may see ────────────── */
{
  /* This is the one addition to this feature that could leak hit points. The
     override picks *when* the readout is drawn; canViewNumbers decides whether
     this client may see the bar at all, and it has to keep doing that first. An
     override applied inside visibility.mjs, or a canViewNumbers that consulted
     the mode before the permission, would let a forced "always" print a
     hostile's hit points on every player's screen and look entirely correct. */
  const mainSrc = strip(await src("scripts/features/resource-bars/main.mjs"));
  const vis = strip(await src("scripts/features/resource-bars/visibility.mjs"));

  const body = vis.slice(vis.indexOf("export function canViewNumbers"));

  if (!/numbersForce/.test(mainSrc))
    fail("Nothing resolves the numbersForce override, so the GM's setting is registered and then ignored.");
  else if (/numbersForce/.test(vis) || /isGM/.test(body))
    fail("The readout override has leaked into canViewNumbers; the permission gate must not know about it, or the two rules can drift apart.");
  else {
    const bars = body.indexOf("canViewBars");
    const always = body.indexOf('"always"');
    if (bars < 0 || always < 0 || bars > always)
      fail('canViewNumbers reads the mode before it calls canViewBars, so a forced readout escapes the displayBars gate.');
    else ok("a forced readout is still refused by displayBars before the mode is read");
  }
}

/* ── 7e. The readout's scale sits on the reading's baseline ─────────────── */
{
  /* Bottom alignment is measured against the *ink*, not the glyph cell. The
     atlas bakes with textBaseline "middle", so aligning cell bottoms lines the
     cells up and leaves the ink a couple of pixels out — which at this size
     reads as a mistake rather than as a style, and reads as correct in any
     screenshot taken at 1x. */
  const atlasSrc = strip(await src("scripts/features/resource-bars/atlas.mjs"));
  if (!/actualBoundingBoxDescent/.test(atlasSrc))
    fail("The atlas does not measure the ink offset, so bottom-aligned parts of a run line up by cell instead of by baseline.");
  else if (!/inkDrop/.test(atlasSrc) || !/part\.bottom/.test(atlasSrc))
    fail("runGeometry has no bottom-alignment path; every part of a run is centred on the mid-line.");
  else if (!/bottom:\s*true/.test(strip(hostSrc)))
    fail("Nothing in host.mjs asks for bottom alignment, so the maximum still floats on the mid-line.");
  else ok("the maximum sits on the reading's baseline, measured from the baked ink");
}

/* ── 7f. The bloom renders at the display's resolution ──────────────────── */
{
  /* PIXI.Filter defaults its resolution to 1, not to the renderer's. On a
     HiDPI display that halves the resolution of everything inside the filtered
     container and scales it back up: no error, no warning, just soft bars that
     get softer the further you zoom in. */
  if (!/syncFilterResolution/.test(hostSrc))
    fail("The bloom filter's resolution is never synced from the renderer; on a HiDPI display the whole bar container renders at half resolution and is upscaled.");
  else if (!/bloom\.resolution\s*=\s*res/.test(strip(hostSrc)))
    fail("syncFilterResolution does not actually assign the renderer's resolution to the filter.");
  else ok("the bloom renders at the renderer's own resolution, not at PIXI's default 1");
}

/* ── 7g. Off-screen bars are not measured ───────────────────────────────── */
{
  /* A filtered container measures itself from its children every frame and
     sizes the filter's textures from that measurement, so one token in the far
     corner of a scene costs the bloom the whole distance to it — animating or
     not. PIXI skips non-renderable children in calculateBounds as well as in
     the render, so the flag fixes the measurement and the draw together. */
  const h = strip(hostSrc);
  if (!/group\.renderable\s*=/.test(h))
    fail("Nothing clears renderable on an off-screen entry, so every bar in the scene is drawn and measured every frame.");
  else if (!/canvasPan/.test(strip(await src("scripts/features/resource-bars/main.mjs"))))
    fail("Culling is never re-run on pan or zoom, so it holds whatever the view was when the canvas was drawn.");
  else if (!/CULL_PAD/.test(h))
    fail("Culling has no margin, so the bloom a bar just off the edge would spill inward pops as you pan.");
  else ok("off-screen bars are neither drawn nor measured, with a margin so the cull is invisible");
}

/* ── 7h. The Token Config fields land in the tab body ───────────────────── */
{
  /* `data-tab` is on the navigation link as well as on the body it switches
     to, and the link comes first in document order — so the obvious selector
     appends the fields inside the header's Resources button. The fieldset
     renders, the inputs work, they save. It just sits in the header. */
  const cfg = strip(await src("scripts/features/resource-bars/token-config.mjs"));
  if (!/bar1\.attribute/.test(cfg))
    fail("findHost does not anchor on the bar attribute pickers, so it is resolving the Resources tab by id and can land on the nav link in the header.");
  else if (/querySelector\('\[data-tab="resources"\]'\)/.test(cfg))
    fail("findHost still selects [data-tab=\"resources\"] without requiring .tab, which matches the header's tab button first.");
  else if (!/closest\("nav"\)/.test(cfg))
    fail("findHost has no guard against landing inside the tab strip.");
  else ok("the per-token offsets are anchored to the Resources tab body, not to its nav link");
}

/* ── 7i. Divisions agree on one source ──────────────────────────────────── */
{
  /* uSeg is written from three places — mesh creation, configure, and the
     per-frame write — and the per-HP mode makes the value depend on the
     creature rather than on the setting. Any one of them still reading
     opts.segments directly produces a bar that is divided one way when it is
     created and another way on its next frame, which reads as a flicker on
     first draw and as nothing at all on a bar that never animates. */
  const h = strip(hostSrc);
  if (!/segmentsFor\(/.test(h))
    fail("host.mjs has no segmentsFor helper, so the per-HP division mode cannot be resolved per creature.");
  else if (/uSeg\s*=\s*[^;]*opts\.segments/.test(h))
    fail("Something still writes uSeg straight from opts.segments; that path ignores the per-HP mode.");
  else if (!/Math\.ceil\(max \/ per\)/.test(h))
    fail("The per-HP division count does not round up, so the remainder lands in the first plate — the one at the full-health end.");
  else if (!/per > 0/.test(h) || !/Number\.isFinite\(max\)/.test(h))
    fail("segmentsFor does not guard its divisor and its maximum; a creature with no maximum divides by zero and asks for an infinite plate count.");
  else ok("divisions resolve through one helper, round up, and fall back to a continuous fill");
}

/* ── 7j. Every registered setting has its strings ───────────────────────── */
{
  /* A missing key does not throw. Foundry renders the key itself, so the
     Control Center shows "GLRB.Settings.SegmentMode.Name" as a label and the
     setting still works — which is exactly the kind of thing that ships. */
  const idx = await src("scripts/features/resource-bars/index.mjs");
  const lang = JSON.parse(await src("lang/resource-bars.en.json"));
  const missing = [...idx.matchAll(/"(GLRB\.[A-Za-z0-9.]+)"/g)]
    .map((m) => m[1])
    .filter((k) => !(k in lang));
  if (missing.length)
    fail(`${missing.length} i18n key(s) referenced by the settings do not exist: ${missing.join(", ")}`);
  else ok("every GLRB string the settings reference resolves");
}

/* ── 8. The readout clears the corner the bar cuts off itself ───────────── */
{
  /* The bar takes a corner out of its own top-right, and the numerals are laid
     out in JS against a bar drawn in GLSL. If the two disagree the digits sit on
     the diagonal — which does not read as a small error, it reads as two people
     having drawn the same bar. So the geometry is exported and the clearance is
     recomputed here rather than trusted.

     Reading right-to-left from the quad's right edge: the body is inset by
     BODY_INSET; the cut reaches CUT half-heights back from the corner, of which
     everything past one half-height is outside the body already; and the digits
     stand half their cap height above the mid-line, which is where they first
     meet the diagonal. */
  const glsl = shader.FRAGMENT_SHADER;
  const { CUT, BODY_INSET, READOUT_INSET } = shader;

  const padY = Number(/float padY = mix\(([\d.]+), ([\d.]+), hero\)/.exec(glsl)?.[2]);
  const capH = Number(/size:\s*h\s*\*\s*(0\.\d+)/.exec(strip(hostSrc))?.[1]);

  if (/\bSKEW\b/.test(glsl) || /\bskew\b/.test(strip(await src('scripts/features/resource-bars/atlas.mjs'))))
    fail("A shear is back. The bar is meant to be axis-aligned; a lean in the GLSL or in runGeometry that the other one does not share is the exact drift this pin replaced.");
  else if (!glsl.includes(`const float CUT = ${CUT.toFixed(4)};`) ||
           !glsl.includes(`const float BODY_INSET = ${BODY_INSET.toFixed(4)};`))
    fail("The GLSL no longer takes CUT and BODY_INSET from the exported constants, so the readout is positioned against geometry the shader may not be drawing.");
  else if (!/READOUT_INSET/.test(strip(hostSrc)))
    fail("host.mjs anchors the readout with something other than the exported READOUT_INSET.");
  else if (!Number.isFinite(padY) || !Number.isFinite(capH))
    fail("Could not read padY out of the GLSL or the readout cap height out of host.mjs; the clearance below cannot be checked and is now unpinned.");
  else {
    const heroHalf = 0.5 - padY;
    const needed = BODY_INSET + heroHalf * (CUT - 1) + capH / 2;
    if (READOUT_INSET < needed)
      fail(`READOUT_INSET is ${READOUT_INSET} but the cut corner reaches ${needed.toFixed(3)} bar-heights in; the numerals will overlap the diagonal.`);
    else ok(`the readout clears the cut corner by ${(READOUT_INSET - needed).toFixed(3)} bar-heights, and nothing is sheared`);
  }
}

/* ── 9. Detail survives the reference token size ────────────────────────── */
{
  /* The lesson the previews taught, twice. A feature can be mathematically
     correct and practically invisible: rbDetail deletes anything that no longer
     spans GL_FADE_LO device pixels, which is the right behaviour and the reason
     a detail specified in geometry units disappears at the size the thing is
     actually played at — or, worse, disappears only for players without a
     HiDPI display, which is invisible from any preview you run yourself.

     The reference is a hero bar under a 128px token on a dpr-1 monitor: 19
     device pixels tall, the smallest size this is expected to stay readable at. */
  const REF_BAR_PX = 19;
  const px = 1 / REF_BAR_PX;
  const GL_FADE_LO = 0.8, GL_FADE_HI = 2.2;
  const glsl = strip(shader.FRAGMENT_SHADER);

  /* The segment gap is deliberately *not* a fixed magnitude: pinned to px it is
     the same hairline on every display. Check that it still is — a literal
     creeping back in here is the retina-only-divisions bug returning. */
  if (!/float gapP = min\(max\(px \* [0-9.]+,/.test(glsl))
    fail("The segment gap is not derived from px. A fixed value is ~2px on a HiDPI display and sub-pixel on an ordinary one, so the divisions vanish for players without a retina monitor.");
  else ok("segment gap is pinned to device pixels, not geometry units");

  const gated = [...glsl.matchAll(/rbDetail\(([0-9.]+)\s*(?:\*\s*([0-9.]+))?\)/g)]
    .map((m) => ({ raw: m[0], value: Number(m[1]) * (m[2] ? Number(m[2]) : 1) }));

  if (!gated.length) fail("No literal rbDetail() gates found; the size-check has nothing to verify.");
  const faint = [];
  for (const g of gated) {
    const spans = g.value / px;
    if (spans < GL_FADE_LO)
      fail(`${g.raw} spans ${spans.toFixed(2)}px on a ${REF_BAR_PX}px bar — fully deleted there, so that detail does not exist at the size this is played at.`);
    else if (spans < GL_FADE_HI) faint.push(`${g.raw} → ${spans.toFixed(1)}px`);
  }
  if (gated.length) ok(`${gated.length} detail gate(s) still resolve on a ${REF_BAR_PX}px bar`);
  if (faint.length) console.log("      partial at the reference size (by design, but worth knowing): " + faint.join(", "));
}

/* ── 10. The shader compiles ────────────────────────────────────────────── */
{
  const { createRequire } = await import("node:module");
  const require_ = createRequire(import.meta.url);
  const GLOBAL_ROOTS = ["/usr/local/lib/node_modules", "/opt/homebrew/lib/node_modules"];
  let pwPath;
  try {
    pwPath = require_.resolve("playwright", { paths: [rel("."), ...GLOBAL_ROOTS] });
  } catch {
    console.log("SKIP  playwright is not installed — cannot compile the shader without a browser");
    console.log("      npm i -g playwright");
    console.log(problems ? `\n${problems} problem(s)` : "\nno problems");
    process.exit(problems ? 1 : 0);
  }

  const pw = await import(pwPath);
  const browser = await pw.chromium.launch();
  const page = await browser.newPage();
  const result = await page.evaluate(({ vert, frag }) => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2") || c.getContext("webgl");
    if (!gl) return { error: "no WebGL context" };
    const build = (type, srcText, label) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, srcText);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return label + ": " + gl.getShaderInfoLog(sh);
      return sh;
    };
    const vs = build(gl.VERTEX_SHADER, vert, "vertex");
    if (typeof vs === "string") return { error: vs };
    const fs = build(gl.FRAGMENT_SHADER, frag, "fragment");
    if (typeof fs === "string") return { error: fs };
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: "link: " + gl.getProgramInfoLog(prog) };
    /* A uniform the compiler optimised away is a uniform nothing reads. */
    const dead = [];
    for (const name of Object.keys(UNIFORM_NAMES))
      if (gl.getUniformLocation(prog, name === "uRamp" ? "uRamp[0]" : name) === null) dead.push(name);
    return { dead };
  }, { vert: shader.PREVIEW_VERTEX_SHADER, frag: shader.FRAGMENT_SHADER });

  await browser.close();
  if (result.error) fail("The shader does not compile: " + result.error);
  else if (result.dead?.length) fail("Uniforms optimised away (nothing in the shader reads them): " + result.dead.join(", "));
  else ok("the fragment shader compiles and links, and every uniform survives");
}

console.log(problems ? `\n${problems} problem(s)` : "\nno problems");
process.exit(problems ? 1 : 0);
