#!/usr/bin/env node
/**
 * GLUniverse Suite — Hexcrawl consistency check.
 *
 *   node tools/hexcrawl-check.mjs
 *
 * Almost everything in this feature fails SILENTLY: a viewFor() that lets one
 * withheld field through prints a masked hex's name on every player's tooltip
 * while the GM's screen looks correct; an auto-reveal that lowers a state
 * re-hides a hex the GM revealed by hand; a scene update that MERGES instead of
 * replacing keeps a deleted field forever; a dynamic i18n key that is missing
 * renders the raw key; a renderer that reads `canvas` works in Foundry and
 * breaks the preview page, which then flatters a copy nobody ships.
 *
 * This drives the pure modules (hex-math, model, glyphs, import), the runtime
 * store against a fake Scene, and reads the renderer/apps sources and the lang
 * files. Zero problems required; exits non-zero otherwise.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEAT = join(ROOT, "scripts", "features", "hexcrawl");
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

let problems = 0;
let section = "";
const ok = (name, cond, extra = "") => {
  if (cond) return true;
  console.log(`FAIL [${section}] ${name}${extra ? ` — ${extra}` : ""}`);
  problems++;
  return false;
};
/** Key-order-independent JSON (undo re-inserts keys; order is not meaning). */
const canon = (v) => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : x));
const diffStr = (a, b, p = "") => {
  if (JSON.stringify(a) === JSON.stringify(b)) return "";
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return `${p}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].map((k) => diffStr(a[k], b[k], p ? `${p}.${k}` : k)).filter(Boolean).slice(0, 4).join("; ");
};
const head = (s) => { section = s; console.log(`· ${s}`); };

const C = await imp("scripts/features/hexcrawl/constants.mjs");
const H = await imp("scripts/features/hexcrawl/hex-math.mjs");
const M = await imp("scripts/features/hexcrawl/model.mjs");
const G = await imp("scripts/features/hexcrawl/glyphs.mjs");

/* ── hex-math ───────────────────────────────────────────────────────────── */
head("hex-math");
for (const [name, type] of Object.entries(H.HEX_TYPES)) {
  const a = H.pureAdapter({ type, size: 100, bounds: { rows: 12, cols: 12 } });
  let rt = true, px = true, nb = true;
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12; j++) {
    const k = H.key(i, j);
    if (a.fromCube(a.toCube(k)) !== k) rt = false;
    if (a.keyAt(a.center(k)) !== k) px = false;
    const ns = H.neighbors(a, k);
    if (new Set(ns).size !== 6 || ns.some((n) => H.distance(a, k, n) !== 1)) nb = false;
    // Neighbour centres sit exactly one grid size away (Foundry's size = centre spacing).
    for (const n of ns) {
      const c0 = a.center(k), c1 = a.center(n);
      if (Math.abs(Math.hypot(c1.x - c0.x, c1.y - c0.y) - 100) > 1e-6) nb = false;
    }
  }
  ok(`${name}: offset→cube→offset round-trips`, rt);
  ok(`${name}: keyAt(center(k)) === k`, px);
  ok(`${name}: 6 distinct neighbours at distance 1 and spacing = size`, nb);
  const ua = H.pureAdapter({ type, size: 100 });
  ok(`${name}: range sizes 1/7/19`, [0, 1, 2].map((n) => H.range(ua, "5,5", n).length).join() === "1,7,19");
  ok(`${name}: one hex has 6 boundary edges`, H.boundaryEdges(ua, ["5,5"]).length === 6);
  ok(`${name}: two neighbours have 10 boundary edges`, H.boundaryEdges(ua, ["5,5", H.neighbors(ua, "5,5")[0]]).length === 10);
  ok(`${name}: a radius-1 flower has 18 boundary edges`, H.boundaryEdges(ua, H.range(ua, "5,5", 1)).length === 18);
  const L = H.line(ua, "2,2", "8,9");
  const steps = L.slice(1).every((k, i) => H.distance(ua, L[i], k) === 1);
  ok(`${name}: line endpoints, length and unit steps`, L[0] === "2,2" && L.at(-1) === "8,9" && L.length === H.distance(ua, "2,2", "8,9") + 1 && steps);
}

/* ── grid origin ─────────────────────────────────────────────────────────
   pureAdapter must lay hexes out exactly as Foundry's HexagonalGrid#getCenterPoint
   (common/grid/hexagonal.mjs, restated here formula for formula), because scene
   sizing and the import origin are computed from it before the canvas exists. */
head("grid origin");
for (const type of [2, 3, 4, 5]) {
  const a = H.pureAdapter({ type, size: 100 });
  const cols = type >= 4, even = type === 3 || type === 5;
  let off = 0;
  for (let i = -2; i < 6; i++) for (let j = -2; j < 6; j++) {
    const c = a.center(H.key(i, j));
    let x, y;
    if (cols) { x = 2 * Math.SQRT1_3 * ((0.75 * j + 0.5) * 100); const e = (j + 1) % 2 === 0; y = (i + (even === e ? 0 : 0.5)) * 100; }
    else { y = 2 * Math.SQRT1_3 * ((0.75 * i + 0.5) * 100); const e = (i + 1) % 2 === 0; x = (j + (even === e ? 0 : 0.5)) * 100; }
    if (Math.abs(c.x - x) > 1e-6 || Math.abs(c.y - y) > 1e-6) off++;
  }
  ok(`type ${type}: centres match Foundry's getCenterPoint`, off === 0, `${off} off`);
  for (const [nc, nr] of [[14, 8], [15, 15], [1, 1], [7, 3]]) {
    const d = H.hexSceneDims({ type, size: 100, cols: nc, rows: nr });
    const rect = { x: 0, y: 0, width: d.width, height: d.height };
    let miss = 0;
    for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) if (!H.fullyInside(a, H.key(r + d.origin.i, c + d.origin.j), rect)) miss++;
    ok(`type ${type} ${nc}×${nr}: every import hex lands whole inside the scene`, miss === 0, `${miss} cut`);
    const shifted = cols ? d.origin.j : d.origin.i;
    ok(`type ${type}: origin moves the shifted axis by an even amount (parity survives)`, shifted % 2 === 0, JSON.stringify(d.origin));
    // A padded scene: the origin must still preserve parity and sit inside.
    const pad = { x: 3 * a.width * 0.75 + 7, y: 2 * a.height + 11, width: d.width + 3 * a.width, height: d.height + 3 * a.height };
    const o = H.gridOrigin(a, pad);
    ok(`type ${type}: padded origin parity`, (cols ? o.j : o.i) % 2 === 0, JSON.stringify(o));
    ok(`type ${type}: padded origin hex is whole`, H.fullyInside(a, H.key(o.i, o.j), pad));
  }
  const shift = M.shiftKeys({ hexes: { "0,0": { st: "revealed" } } }, 1, 2);
  ok("shiftKeys re-addresses", !!shift.hexes["1,2"] && !shift.hexes["0,0"]);
}

/* ── mask fields ─────────────────────────────────────────────────────────
   Each field independent: the region's SHAPE without its name, the difficulty
   without the terrain, and so on. A region label must need the NAME, not just a
   region id, or a "shape only" hex prints the region's name over itself. */
head("mask fields");
{
  const map = M.normalizeMap({
    regions: { r: { name: "Secret Wood", t: "forest", rt: 3, rumor: { text: "x", known: true } } },
    hexes: { "0,0": { rg: "r", st: "masked", mk: { p: "silhouette" } }, "0,1": { rg: "r", st: "masked", mk: { p: "silhouette", f: { rating: true } } } },
  });
  const v0 = M.viewFor(map, "0,0"), v1 = M.viewFor(map, "0,1");
  ok("silhouette: region shape shown", v0.regionId === "r");
  ok("silhouette: no name, terrain, rating or rumour", v0.name == null && v0.terrain == null && v0.rating == null && v0.rumor == null);
  ok("silhouette + rating: difficulty without terrain or name", v1.rating === 3 && v1.terrain == null && v1.name == null);
  const lab = readFileSync(join(FEAT, "render", "labels.mjs"), "utf8");
  ok("region labels require the viewer to see the name (or to be owed a ???)", /!v\.regionId\s*\|\|\s*!\(v\.name\s*\|\|\s*v\.nameUnknown\)/.test(lab));
  ok("a label prints the region's name only when a member shows it, else ???", /members\.some\(\(\[, v\]\) => v\.name\)/.test(lab) && lab.includes('UNKNOWN_NAME = "???"'));
  ok("MASK_FIELDS carries the region shape", C.MASK_FIELDS.includes("region"));
}

/* ── token position ──────────────────────────────────────────────────────
   Under v14's movement API the prepared doc.x/doc.y is the ANIMATED position:
   inside the updateToken hook that moved the party it still names the hex being
   left. Positions must come from _source (found only in a live session). */
head("token position");
{
  const P = await imp("scripts/features/hexcrawl/party.mjs");
  const fake = { x: 0, y: 0, width: 1, height: 1, _source: { x: 400, y: 300 }, parent: { grid: { sizeX: 100, sizeY: 100 } } };
  const c = P.tokenCenter(fake);
  ok("tokenCenter reads _source, not the animated doc.x/doc.y", c.x === 450 && c.y === 350, JSON.stringify(c));
  const src = readFileSync(join(FEAT, "movement.mjs"), "utf8");
  ok("movement never reads a prepared position (doc.x / doc.y)", !/\bdoc\.(x|y)\b/.test(src));
}

/* ── scene controls ──────────────────────────────────────────────────────
   The palette button exists only while HexStore.current does. SceneControls
   re-runs getSceneControlButtons ONLY on render({reset:true}); a bare render()
   redraws the old list, so enabling on the viewed scene showed no palette until
   a reload (found only in a live session). */
head("scene controls");
{
  // v14 moved a scene's background onto its Levels and silently drops the legacy
  // backgroundColor: a new hexcrawl came out Foundry grey, showing in every channel
  // between regions, and Foundry's grid lines cut the fused regions back into hexes.
  const setup = readFileSync(join(FEAT, "scene-setup.mjs"), "utf8");
  ok("a new scene restates its background on the initial Level (v14)", /levels\?\.contents\?\.\[0\][\s\S]{0,200}"background\.color"/.test(setup));
  ok("a new scene hides Foundry's grid lines (the map draws its own edges)", /grid:\s*\{[^}]*alpha:\s*0/.test(setup));
  const src = readFileSync(join(FEAT, "main.mjs"), "utf8");
  ok("store changes rebuild the controls with reset: true", /ui\.controls\?*\.render\(\{\s*reset:\s*true\s*\}\)/.test(src));
  ok("no bare ui.controls.render() in the feature", !/ui\.controls\?*\.render\(\s*\)/.test(src));
}

/* ── model ──────────────────────────────────────────────────────────────── */
head("model");
const sample = () => M.normalizeMap({
  hexes: {
    "1,1": { t: "forest", rg: "r1", st: "revealed", vs: true, lm: [
      { id: "a", label: "Tower", vis: "follow", journal: "JournalEntry.x" },
      { id: "b", label: "Secret", vis: "hidden" },
      { id: "c", label: "Beacon", vis: "visible" }] },
    "1,2": { rg: "r1", st: "masked", mk: { p: "silhouette" }, rt: 3, nm: "The Hollow", nt: "gm note" },
    "1,3": { rg: "r1", st: "hidden", cost: 5, lm: [{ id: "d", label: "Hidden", vis: "hidden" }, { id: "e", label: "Far", vis: "visible" }] },
    "2,2": { t: "custom1", st: "revealed", bl: true },
  },
  regions: { r1: { name: "Greenmere", t: "wetland", rt: 2, enc: { text: "Wolves" }, rumor: { text: "A witch", truth: "partial", known: false }, notes: "secret" } },
  terrains: { custom1: { name: "Glass Fields", color: "#abcdef", glyph: "crystal" } },
  config: { sight: 2, cost: { unit: "watches", table: [1, 2, 3, 4], watchHours: 4 } },
});
const m0 = sample();
ok("normalizeMap is idempotent", JSON.stringify(M.normalizeMap(m0)) === JSON.stringify(m0));
ok("normalizeMap accepts garbage", !!M.normalizeMap(null).config && !!M.normalizeMap("x").hexes);

// viewFor never leaks to players — every state × every mask preset × region rumour known/unknown.
const withheld = ["terrain", "name", "rating", "rumor"];
for (const known of [false, true]) {
  for (const nk of [false, true]) {
  for (const st of C.STATES) {
    for (const preset of [C.SIGHT_PRESET, ...Object.keys(C.MASK_PRESETS)]) {
      const map = M.normalizeMap({ ...m0, regions: { r1: { ...m0.regions.r1, nk, rumor: { ...m0.regions.r1.rumor, known } } },
        hexes: { k: { ...m0.hexes["1,1"], rt: 3, nm: "Named", st, mk: { p: preset, f: {} } } } });
      const v = M.viewFor(map, "k", { asGM: false });
      const f = st === "masked" ? M.maskFields(map, map.hexes.k) : null;
      const tag = `${st}/${preset}/known=${known}/nk=${nk}`;
      // A region's name reaches players only once the GM marks it known; until then "???".
      const nameOk = (shown) => (shown ? (nk ? v.name != null && !v.nameUnknown : v.name == null && v.nameUnknown) : v.name == null && !v.nameUnknown);
      ok(`${tag}: GM-hidden landmarks never reach players`, !v.landmarks.some((l) => l.vis === "hidden"));
      // The GM's badge says whether the party can see it (drawn hatched when not).
      // That hint is only worth anything while it agrees, landmark for landmark,
      // with what viewFor actually hands a player — a hint that drifts is worse
      // than none, because the GM stops checking.
      {
        const gv = M.viewFor(map, "k", { asGM: true });
        const seenByPlayer = new Set(v.landmarks.map((l) => l.id));
        ok(`${tag}: the GM view carries every landmark`, gv.landmarks.length === map.hexes.k.lm.length);
        ok(`${tag}: each GM \`seen\` is exactly what the player view holds`,
          gv.landmarks.every((l) => l.seen === seenByPlayer.has(l.id)));
        ok(`${tag}: players are never handed a landmark marked unseen`, v.landmarks.every((l) => l.seen !== false));
        ok(`${tag}: landmarksShown answers for the hex`,
          M.landmarksShown(map, map.hexes.k) === (st === "revealed" || (st === "masked" && !!f.landmarks)));
      }
      if (st === "hidden") {
        ok(`${tag}: hidden hex withholds everything`, withheld.every((x) => v[x] == null) && v.landmarks.every((l) => l.vis === "visible") && !v.blight && !v.visited && v.regionId == null);
      } else if (st === "masked") {
        ok(`${tag}: terrain follows the mask`, f.terrain ? v.terrain != null : v.terrain == null && !v.blight);
        ok(`${tag}: name follows the mask and the region's name-known`, nameOk(!!f.name));
        ok(`${tag}: region shape follows the mask (the name implies it)`, f.region || f.name ? v.regionId != null : v.regionId == null);
        ok(`${tag}: rating follows the mask`, f.rating ? v.rating != null : v.rating == null);
        ok(`${tag}: rumour needs the field AND known`, (f.rumor && known) ? v.rumor != null : v.rumor == null);
        ok(`${tag}: landmarks follow the mask`, f.landmarks ? true : v.landmarks.every((l) => l.vis === "visible"));
      } else {
        ok(`${tag}: rumour only when known`, known ? v.rumor != null : v.rumor == null);
        ok(`${tag}: revealed name still needs name-known`, nameOk(true));
      }
    }
  }
  }
}
ok("a hex outside any region shows its own name", M.viewFor(M.normalizeMap({ hexes: { k: { st: "revealed", nm: "Lone" } } }), "k").name === "Lone");

/* A landmark's own colour and size. Both are DATA a GM set on their map, so a
   value that fails to normalise must fall back to the shipped badge — never to
   black (a colour nobody can see against the tile) or to 0 (a badge nobody can
   hit), both of which render perfectly happily. */
{
  const lm = (o) => M.normalizeLandmark(o);
  ok("a landmark colour is #rrggbb, lower-cased, else the default badge (null)",
    lm({ color: "#AABBCC" }).color === "#aabbcc" && lm({ color: "red" }).color === null
    && lm({ color: "" }).color === null && lm({}).color === null);
  ok("a landmark size defaults to 1 and clamps into its range",
    lm({}).size === C.LANDMARK_SIZE_DEFAULT && lm({ size: "" }).size === C.LANDMARK_SIZE_DEFAULT
    && lm({ size: "nope" }).size === C.LANDMARK_SIZE_DEFAULT
    && lm({ size: 99 }).size === C.LANDMARK_SIZE_MAX && lm({ size: 0 }).size === C.LANDMARK_SIZE_MIN);
  ok("every size the editor offers survives normalisation unchanged",
    C.LANDMARK_SIZE_STEPS.every((s) => M.landmarkSize(s) === s && lm({ size: s }).size === s));
  ok("colour and size survive a map round trip",
    M.normalizeMap({ hexes: { k: { st: "revealed", lm: [{ id: "a", color: "#112233", size: 1.5 }] } } }).hexes.k.lm[0].color === "#112233");
}

/* ── Border: the hexes that are not map ──────────────────────────────────
   A border hex is flat black for everyone and out of play. Everything here is
   silent when it breaks: a viewFor that answers for the GM alone makes the one
   thing the mark means invisible to the one person who set it; an extent that
   does not travel with the hexes blacks out the map itself; an auto-reveal that
   writes into the frame turns the padding back into ground the party can walk. */
head("border");
{
  const withBounds = (extra = {}) => M.normalizeMap({
    bounds: { i: 0, j: 0, rows: 3, cols: 3 },
    regions: { r: { name: "Wood", t: "forest", rt: 2, nk: true, rumor: { text: "x", known: true } } },
    hexes: {
      "1,1": { rg: "r", st: "revealed", vs: true, bl: true, lm: [{ id: "a", label: "Tower", vis: "visible" }] },
      ...extra,
    },
  });
  const map = withBounds();
  ok("a hex inside the extent is map", !M.isBorder(map, "1,1") && M.inExtent(map, "1,1"));
  ok("a hex outside the extent is border with nothing written", M.isBorder(map, "5,5") && !M.inExtent(map, "5,5"));
  ok("no extent means every hex is in play", !M.isBorder(M.normalizeMap({}), "99,99"));
  // The record wins BOTH ways, or a GM can carve a border out of the map but
  // never bring one padding hex back in — and the brush would look broken.
  const carved = withBounds({ "1,1": { st: "revealed", bd: 1 }, "5,5": { bd: 0 } });
  ok("a hex record borders a hex inside the extent", M.isBorder(carved, "1,1"));
  ok("a hex record brings one outside the extent back into play", !M.isBorder(carved, "5,5"));
  ok("the flag is stored as 1/0 and survives normalisation",
    carved.hexes["1,1"].bd === 1 && carved.hexes["5,5"].bd === 0
    && M.normalizeHex({ bd: true }).bd === 1 && M.normalizeHex({ bd: false }).bd === 0
    && M.normalizeHex({}).bd === undefined);
  // borderFlagFor writes only a disagreement, so the map carries no flag saying
  // what its own extent says — and erase (a blank hex) always means "follow it".
  ok("a flag is stored only where it disagrees with the extent",
    M.borderFlagFor(map, "1,1", false) === null && M.borderFlagFor(map, "1,1", true) === 1
    && M.borderFlagFor(map, "5,5", true) === null && M.borderFlagFor(map, "5,5", false) === 0);
  const painted = M.brushPatch(map, ["1,1", "5,5"], { tool: "border", value: true });
  ok("the border brush borders a hex and leaves the extent's own alone",
    painted["1,1"]?.bd === 1 && (painted["5,5"] == null || painted["5,5"].bd === undefined));
  ok("the border brush keeps everything else on the hex",
    painted["1,1"].rg === "r" && painted["1,1"].st === "revealed");
  ok("erase clears the flag back to the extent", M.brushPatch(carved, ["1,1"], { tool: "erase" })["1,1"] == null
    || M.brushPatch(carved, ["1,1"], { tool: "erase" })["1,1"].bd === undefined);

  // The view: nothing, for anybody. The GM included — a border hex drawn as
  // ordinary ground on the GM's screen hides the one fact the mark states.
  for (const asGM of [false, true]) {
    const v = M.viewFor(carved, "1,1", { asGM });
    const tag = asGM ? "GM" : "player";
    ok(`${tag}: a border hex says so`, v.border === true);
    ok(`${tag}: a border hex shows nothing`, v.terrain == null && v.name == null && v.rating == null
      && v.regionId == null && v.rumor == null && !v.landmarks.length && !v.visited && !v.blight);
    ok(`${tag}: a border hex is not drawn`, v.drawn === false);
  }
  ok("every other hex carries border: false", M.viewFor(map, "1,1", { asGM: true }).border === false);

  // Travel: the party neither enters the black nor sees into it.
  const walked = M.autoRevealPatch(carved, { entered: ["1,1"], seen: new Set(["1,1", "0,0"]) });
  ok("auto-reveal never enters a hex the GM bordered", !("1,1" in walked));
  const seenOut = M.autoRevealPatch(map, { entered: ["1,1"], seen: new Set(["5,5", "0,0"]) });
  ok("auto-reveal never raises a hex outside the extent", !("5,5" in seenOut));
  ok("auto-reveal still writes the map beside it", !!walked["0,0"] && !!seenOut["0,0"]);
  ok("a hex brought back into play is revealed normally",
    !!M.autoRevealPatch(carved, { entered: ["5,5"], seen: new Set() })["5,5"]);

  // The extent is addressed in offsets, so it moves with them.
  const moved = M.shiftKeys(withBounds(), 2, 3);
  ok("shiftKeys carries the extent with the hexes",
    canon(moved.bounds) === canon({ i: 2, j: 3, rows: 3, cols: 3 })
    && !M.isBorder(moved, "3,4") && M.isBorder(moved, "1,1"));
  ok("a degenerate extent is no extent (a 0-row rect would black out the map)",
    M.normalizeMap({ bounds: { i: 0, j: 0, rows: 0, cols: 5 } }).bounds === null
    && M.normalizeMap({ bounds: "nope" }).bounds === null);
}

/* Mask presets are the map's own: seeded, editable, deletable; "sight" is live. */
{
  const seed = M.normalizeMap({});
  ok("an absent preset set is the seed", canon(Object.keys(seed.presets)) === canon(Object.keys(C.MASK_PRESETS)));
  ok("an EMPTY preset set stays empty (a GM may delete them all)", Object.keys(M.normalizeMap({ presets: {} }).presets).length === 0);
  const odd = M.normalizePresets({ hidden: { f: {} }, sight: { f: {} }, "bad id!": { f: {} }, scouted: { name: " Scouted ", f: { terrain: true } } });
  ok("reserved and malformed preset ids are dropped", canon(Object.keys(odd)) === canon(["scouted"]));
  ok("a preset's fields are all booleans and its name trimmed", odd.scouted.name === "Scouted" && C.MASK_FIELDS.every((k) => typeof odd.scouted.f[k] === "boolean") && odd.scouted.f.terrain && !odd.scouted.f.name);
  const base = { regions: { r: { name: "Wood", t: "forest", rt: 2 } }, presets: { scouted: { name: "", f: { terrain: true } } } };
  const own = M.normalizeMap({ ...base, hexes: { k: { rg: "r", st: "masked", mk: { p: "scouted" } } } });
  ok("a GM preset masks with its own ticks", M.viewFor(own, "k").terrain != null && M.viewFor(own, "k").rating == null);
  const gone = M.normalizeMap({ ...base, presets: {}, config: { sightFields: { region: true, terrain: false, rating: true, name: false, landmarks: false, rumor: false } }, hexes: { k: { rg: "r", st: "masked", mk: { p: "scouted" } } } });
  ok("a deleted preset's hexes fall back to the sight checklist", M.viewFor(gone, "k").rating === 2 && M.viewFor(gone, "k").terrain == null);
  const live = (fields) => M.viewFor(M.normalizeMap({ ...base, config: { sightFields: fields }, hexes: { k: { rg: "r", st: "masked", mk: { p: C.SIGHT_PRESET } } } }), "k");
  ok("the sight preset is resolved LIVE from config.sightFields", live({ rating: true }).rating === 2 && live({ rating: false }).rating == null);
  ok("brushPatch accepts a map preset and the sight preset", M.brushPatch(own, ["9,9"], { tool: "state", value: "scouted" })["9,9"]?.mk?.p === "scouted"
    && M.brushPatch(own, ["9,9"], { tool: "state", value: C.SIGHT_PRESET })["9,9"]?.mk?.p === C.SIGHT_PRESET);
  ok("brushPatch ignores a preset the map does not have", !M.brushPatch(own, ["9,9"], { tool: "state", value: "nope" })["9,9"]);
  const legacy = M.normalizeConfig({ autoPreset: "rumoured" });
  ok("an old autoPreset reads as its checklist", legacy.sightState === "masked" && canon(legacy.sightFields) === canon(C.MASK_PRESETS.rumoured));
  ok("an old autoPreset 'revealed' reads as sightState revealed", M.normalizeConfig({ autoPreset: "revealed" }).sightState === "revealed");
  ok("default sight shows shape, terrain, difficulty and name", canon(M.normalizeConfig({}).sightFields) === canon(C.DEFAULT_SIGHT_FIELDS)
    && C.DEFAULT_SIGHT_FIELDS.region && C.DEFAULT_SIGHT_FIELDS.terrain && C.DEFAULT_SIGHT_FIELDS.rating && C.DEFAULT_SIGHT_FIELDS.name);
  const wr = M.normalizeMap({ regions: { r: { name: "W", t: "forest" } }, presets: { blind: { f: { terrain: true } } }, hexes: { k: { rg: "r", st: "masked", mk: { p: "blind" } } } });
  ok("a masked hex hiding its region says so (renderer: an island, not fused)", M.viewFor(wr, "k").regionWithheld === true && M.viewFor(wr, "k").regionId == null);
}
ok("GM view draws everything", M.viewFor(m0, "1,3", { asGM: true }).drawn === true);

// autoRevealPatch never lowers a state.
let lowered = 0;
const a0 = H.pureAdapter({ type: 4, size: 100, bounds: { rows: 10, cols: 10 } });
const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
for (let n = 0; n < 60; n++) {
  const hexes = {};
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) {
    const st = C.STATES[Math.floor(rnd() * 3)];
    hexes[H.key(i, j)] = st === "masked" ? { st, mk: { p: "rumoured" } } : { st };
  }
  for (const sightState of C.SIGHT_STATES) {
    const map = M.normalizeMap({ hexes, config: { sightState } });
    const at = H.key(Math.floor(rnd() * 10), Math.floor(rnd() * 10));
    const patch = M.autoRevealPatch(map, { entered: [at], seen: H.unionRange(a0, [{ key: at, sight: 2 }]) });
    for (const [k, h] of Object.entries(patch)) {
      if (h && C.STATE_RANK[h.st] < C.STATE_RANK[map.hexes[k]?.st ?? "hidden"]) lowered++;
    }
    if (!patch[at] && !(map.hexes[at]?.st === "revealed" && map.hexes[at]?.vs)) lowered++;
  }
}
ok("autoRevealPatch never lowers a state (and always enters)", lowered === 0, `${lowered} bad`);
{
  const map = M.normalizeMap({ config: { sightState: "masked" } });
  const patch = M.autoRevealPatch(map, { entered: ["0,0"], seen: new Set(["0,0", "0,1"]) });
  ok("seen hexes are masked with the live sight preset", patch["0,1"]?.st === "masked" && patch["0,1"]?.mk?.p === C.SIGHT_PRESET);
}
{
  // A hex the GM masked with a thinner preset (a silhouette) still gains what sight shows,
  // and keeps anything its own mask showed that sight does not: the field-wise union.
  const map = M.normalizeMap({ config: { sightState: "masked", sightFields: C.MASK_PRESETS.glimpsed }, hexes: { "0,1": { st: "masked", mk: { p: "silhouette" } }, "0,2": { st: "masked", mk: { p: "rumoured" } }, "0,3": { st: "masked", mk: { p: "glimpsed" } } } });
  const patch = M.autoRevealPatch(map, { entered: ["0,0"], seen: new Set(["0,0", "0,1", "0,2", "0,3"]) });
  const f1 = patch["0,1"] && M.maskFields(map, patch["0,1"]), f2 = patch["0,2"] && M.maskFields(map, patch["0,2"]);
  const sight = map.config.sightFields, had2 = M.maskFields(map, map.hexes["0,2"]);
  ok("sight raises an already-masked silhouette to the sight fields", !!f1 && C.MASK_FIELDS.every((k) => f1[k] === sight[k]));
  ok("raising a mask is a union: nothing the old mask showed is lost", !!f2 && C.MASK_FIELDS.every((k) => f2[k] === (sight[k] || had2[k])));
  ok("a mask already showing everything sight shows is left alone", !("0,3" in patch));
}

ok("brushPatch erase → null", M.brushPatch(m0, ["1,1"], { tool: "erase" })["1,1"] === null);
ok("brushPatch state:hidden on a blank hex → null", M.brushPatch(m0, ["9,9"], { tool: "state", value: "hidden" })["9,9"] === null);
ok("brushPatch preset masks", M.brushPatch(m0, ["9,9"], { tool: "state", value: "rumoured" })["9,9"]?.mk?.p === "rumoured");

ok("travelCost uses the per-hex override", M.travelCost(m0, "1,3") === 5);
ok("travelCost uses the table at the effective rating", M.travelCost(m0, "1,2") === 3 && M.travelCost(m0, "1,1") === 2);
ok("travelCost of an unrated hex is 0", M.travelCost(m0, "2,2") === 0);
ok("costSeconds: watches use watchHours", M.costSeconds(m0.config, 2) === 2 * 4 * 3600);
ok("costSeconds: days", M.costSeconds(M.normalizeConfig({}), 3) === 3 * 86400);
ok("costSeconds: hours/minutes", M.costSeconds(M.normalizeConfig({ cost: { unit: "hours" } }), 1) === 3600
  && M.costSeconds(M.normalizeConfig({ cost: { unit: "minutes" } }), 1) === 60);
ok("a blank cost override clears", !("cost" in M.normalizeHex({ st: "revealed", cost: "" })) && !("cost" in M.normalizeHex({ st: "revealed", cost: null })));
ok("cost 0 is a real override", M.normalizeHex({ st: "revealed", cost: 0 }).cost === 0);
const dice = M.encounterDice(m0, "1,2");
ok("encounterDice follows the scene config", dice.formula === "3d6" && dice.trigger === 1);

/* ── art: icons and region textures ─────────────────────────────────────
   Art DEPICTS terrain, so it must follow the same visibility as the terrain:
   a silhouette that showed its region's texture would name the place. Paths
   resolve through one function; a texture must stay put as more is revealed. */
head("art");
{
  ok("resolveAsset: absolute URLs stay", M.resolveAsset("https://x/y.webp", { assetBase: "https://b/" }) === "https://x/y.webp");
  ok("resolveAsset: relative joins assetBase (one slash)", M.resolveAsset("./dz/a.webp", { assetBase: "https://b/p/" }) === "https://b/p/dz/a.webp");
  ok("resolveAsset: no assetBase leaves a Foundry Data path", M.resolveAsset("worlds/w/a.webp") === "worlds/w/a.webp");
  ok("resolveAsset: glhex: is the module's own assets", M.resolveAsset("glhex:icons/forest.webp", { builtinRoot: "modules/m/assets/hexcrawl/" }) === "modules/m/assets/hexcrawl/icons/forest.webp");
  ok("normalizeTex: a bare string is a fit texture", JSON.stringify(M.normalizeTex("t.webp")) === JSON.stringify({ src: "t.webp", mode: "fit", scale: 4 }));
  ok("normalizeTex: no src → null", M.normalizeTex({ mode: "tile" }) === null);
  ok("normalizeIcons: capped, blanks dropped", M.normalizeIcons(["a", "", "b", "c", "d", "e"]).length === C.MAX_ICON_VARIANTS && !M.normalizeIcons(["a", ""]).includes(""));
  ok("a built-in terrain carries its shipped icon", M.terrainDef(M.emptyMap(), "forest").icon === C.BUILTIN_ICON("forest"));
  ok("a custom terrain shadowing a built-in keeps the shipped icon unless it names one",
    M.terrainDef(M.normalizeMap({ terrains: { forest: { name: "F", color: "#123456" } } }), "forest").icon === C.BUILTIN_ICON("forest")
    && M.terrainDef(M.normalizeMap({ terrains: { forest: { name: "F", icon: "my.webp" } } }), "forest").icon === "my.webp");
  const art = M.normalizeMap({
    regions: { r: { name: "W", t: "forest", icon: ["a.webp", "b.webp", "c.webp"], tex: "t.webp" } },
    presets: { shape: { f: { region: true } }, terr: { f: { terrain: true } } },
    hexes: {
      rev: { rg: "r", st: "revealed" }, sil: { rg: "r", st: "masked", mk: { p: "shape" } },
      ter: { rg: "r", st: "masked", mk: { p: "terr" } }, hid: { rg: "r", st: "hidden" },
    },
  });
  const vis = (k) => M.visualFor(art, k, M.viewFor(art, k));
  ok("revealed hex: a region icon variant and the region texture", art.regions.r.icon.includes(vis("rev").icon) && vis("rev").tex?.src === "t.webp");
  ok("silhouette: no art at all (it would name the place)", vis("sil").icon === null && vis("sil").tex === null);
  ok("terrain shown, region withheld: the plain terrain icon, no region texture", vis("ter").icon === C.BUILTIN_ICON("forest") && vis("ter").tex === null);
  ok("hidden hex: no art", vis("hid").icon === null && vis("hid").tex === null);
  const picks = new Set(); for (let i = 0; i < 40; i++) picks.add(M.visualFor(art, `${i},${i * 3}`, { terrain: { icon: null }, regionId: "r" }).icon);
  ok("variants are spread across hexes (stable hash, all used)", picks.size === 3);
  ok("variant choice is stable per hex", M.keyHash("3,4") === M.keyHash("3,4"));
  ok("config.texStrength clamps to 0–1 with a default", M.normalizeConfig({ texStrength: 3 }).texStrength === 1 && M.normalizeConfig({}).texStrength === C.DEFAULT_CONFIG.texStrength);

  const rs = readFileSync(join(FEAT, "render", "renderer.mjs"), "utf8");
  const ts = readFileSync(join(FEAT, "render", "tiles.mjs"), "utf8");
  const order = [...rs.matchAll(/(\w+): layer\("(\w+)"\)/g)].map((m) => m[2]);
  ok("texture layer draws beneath the tiles", order.indexOf("tex") >= 0 && order.indexOf("tex") < order.indexOf("tiles"));
  ok("a fit texture is laid over the region's WHOLE bounding box (stable as hexes reveal)", /_regionBox\(id\)[\s\S]{0,400}Object\.entries\(this\._map\.hexes\)/.test(rs));
  ok("the tile fill thins by the scene's texture strength", /1 - texShown/.test(ts));
  ok("an image icon replaces the vector glyph", /!art\?\.icon\)/.test(ts));
  ok("art state is part of the hex signature (async loads redraw)", /\|\$\{artSig\}`/.test(rs) && /\|\$\{tex\}\|\$\{art\?\.icon \? 1 : 0\}`/.test(ts));
  ok("art paths resolve through resolveAsset only", /resolveAsset\(a\.icon, opts\)/.test(rs) && /resolveAsset\(a\.tex\.src, opts\)/.test(rs));
  // Blight: a Mesh + shader layer over the ground (a filter would bring back the
  // filter-resolution trap), every uniform declared in GLSL is written from JS, and the
  // layer sits above the texture and tiles but beneath the icons.
  const bs = readFileSync(join(FEAT, "render", "blight.mjs"), "utf8");
  const declared = [...bs.matchAll(/uniform\s+\w+\s+(u\w+)/g)].map((m) => m[1]);
  const written = new Set([...bs.matchAll(/\b(u[A-Z]\w*):/g)].map((m) => m[1]));
  ok("blight: every shader uniform is written from JS", declared.length > 0 && declared.every((u) => written.has(u)), declared.filter((u) => !written.has(u)).join(","));
  ok("blight: a Mesh with a Shader, not a filter", /new PIXI\.Mesh\(blightGeometry/.test(rs) && !/\.filters\s*=/.test(rs));
  ok("blight layer: above tex and tiles, beneath icons", order.indexOf("blight") > order.indexOf("tiles") && order.indexOf("blight") < order.indexOf("icons"));
  ok("blight: time wraps on the loop (whole turns, no jump)", /uTime = \(this\._time % BLIGHT_LOOP\) \/ BLIGHT_LOOP/.test(rs) && /sin\(t \* 4\.0\)/.test(bs));
  ok("blight: snapped to a pixel grid, world-anchored", /floor\(vPos \/ uR \* uPixel\)/.test(bs));
  ok("icons sit on SOFT baked shadows (contact + ambient), never hard offset copies", /_iconShadow\(a\.icon, img\.tex, GEO\.iconAmbientBlur\)/.test(rs) && /_iconShadow\(a\.icon, img\.tex, GEO\.iconContactBlur\)/.test(rs) && /filter = .blur/.test(rs) && !/iconHalo|iconLift/.test(rs));
  for (const id of C.BUILTIN_TERRAIN_IDS) {
    const f = join(ROOT, "assets", "hexcrawl", "icons", `${id}.webp`);
    ok(`shipped icon exists: ${id}`, existsSync(f));
  }
}

/* ── glyphs ─────────────────────────────────────────────────────────────── */
head("glyphs");
ok("every GLYPH_ID has a path", G.glyphIdsCovered());
for (const id of C.GLYPH_IDS) {
  let cmds = null;
  try { cmds = G.glyphCommands(id); } catch (e) { ok(`${id} parses`, false, e.message); continue; }
  ok(`${id} parses to commands`, id === "none" ? cmds.length === 0 : cmds.length > 0);
}
for (const [id, t] of Object.entries(C.BUILTIN_TERRAINS)) ok(`terrain ${id} glyph exists`, C.GLYPH_IDS.includes(t.glyph));

/* ── store (runtime, against a fake Scene) ──────────────────────────────── */
head("store");
globalThis.Hooks = { on: () => 1, off() {}, callAll() {} };
globalThis.game = { user: { isGM: true } };
const S = await imp("scripts/features/hexcrawl/store.mjs");
const { SUITE_ID } = await imp("scripts/core/const.mjs");

/** A Scene whose update() applies v13 legacy operator keys (==, -=) like Foundry's mergeObject. */
function fakeScene(map) {
  const data = { flags: { [SUITE_ID]: { hex: { enabled: true, map: structuredClone(map) } } } };
  const scene = {
    id: "fake", data, updates: 0,
    getFlag: (scope, k) => k.split(".").reduce((o, p) => o?.[p], data.flags[scope]),
    async update(upd) {
      scene.updates++;
      for (const [path, v] of Object.entries(upd)) {
        const parts = path.split(".");
        let o = data;
        for (const p of parts.slice(0, -1)) o = (o[p] ??= {});
        const last = parts.at(-1);
        if (last.startsWith("-=")) delete o[last.slice(2)];
        else if (last.startsWith("==")) o[last.slice(2)] = structuredClone(v);
        else if (v && typeof v === "object" && !Array.isArray(v) && o[last] && typeof o[last] === "object") Object.assign(o[last], structuredClone(v)); // merge (the trap)
        else o[last] = structuredClone(v);
      }
      store._onUpdateScene(scene, upd);
    },
  };
  return scene;
}
const scene = fakeScene(m0);
const store = new S.HexStore(scene, a0);
let changes = 0;
store.on("change", () => changes++);
const before = JSON.stringify(store.map);

await store.applyPatch(M.brushPatch(store.baseMap, ["1,1"], { tool: "blight", value: false }), { label: "t" });
ok("a patch that REMOVES a field removes it (forced replacement, not merge)", !store.map.hexes["1,1"].bl);
await store.applyPatch(M.brushPatch(store.baseMap, ["2,2"], { tool: "blight", value: false }), { label: "t" });
ok("…including on a hex that had it", !store.map.hexes["2,2"].bl);
ok("one write per applyPatch", scene.updates === 2);
ok("change events fire after scene updates", changes >= 2);
await store.applyPatch(M.brushPatch(store.baseMap, ["1,1", "1,2"], { tool: "erase" }));
ok("erase deletes the hex keys", !store.map.hexes["1,1"] && !store.map.hexes["1,2"]);
await store.setRegion(null, { name: "New", rt: 4 });
const rid = Object.keys(store.map.regions).find((k) => k !== "r1");
ok("setRegion(null) mints an id", !!rid && store.map.regions[rid].name === "New");
await store.setRegion("r1", { ...store.map.regions.r1, color: null });
await store.deleteRegion("r1");
ok("deleteRegion strips rg from its hexes", !Object.values(store.map.hexes).some((h) => h.rg === "r1"));
await store.setConfig({ sight: 4, dice: { die: 8 } });
ok("setConfig merges and normalizes", store.map.config.sight === 4 && store.map.config.dice.die === 8 && store.map.config.cost.unit === "watches");
await store.setConfig({ sightFields: { name: false } }, { presets: { scouted: { name: "Scouted", f: { terrain: true } } } });
ok("setConfig with presets REPLACES them (a deleted preset stays deleted)", canon(Object.keys(store.map.presets)) === canon(["scouted"]), Object.keys(store.map.presets).join(","));
ok("…in the same write as the config", !store.map.config.sightFields.name);
await store.setTerrain("custom1", { name: "Renamed", color: "#123456", glyph: "star" });
await store.deleteTerrain("custom1");
ok("deleteTerrain clears hexes that used it", !Object.values(store.map.hexes).some((h) => h.t === "custom1"));
store.stage(["5,5", "5,6"]);
await store.commitStaged();
ok("commitStaged reveals every staged hex in one patch", store.map.hexes["5,5"]?.st === "revealed" && store.map.hexes["5,6"]?.st === "revealed" && store.staged.size === 0);
let undone = 0;
while (await store.undo()) undone++;
ok("undo unwinds every edit back to the original map", canon(store.map) === canon(JSON.parse(before)), `after ${undone} undos: ${diffStr(JSON.parse(before), store.map)}`);
store.previewPatch({ "7,7": { st: "revealed", t: "forest" } });
ok("previewPatch shows locally without writing", store.map.hexes["7,7"]?.t === "forest" && !store.baseMap.hexes["7,7"]);
store.previewPatch(null);
ok("hook name is namespaced and matches the apps", S.HOOK_STORE_CHANGED === "glhex.storeChanged"
  && readFileSync(join(FEAT, "apps", "shared.mjs"), "utf8").includes('"glhex.storeChanged"'));
store._destroy();

/* ── import (lead's parser) ─────────────────────────────────────────────── */
head("import");
if (existsSync(join(FEAT, "import.mjs"))) {
  const I = await imp("scripts/features/hexcrawl/import.mjs");
  try {
    const ex = I.exampleImport();
    const p = I.parseImport(JSON.stringify(ex));
    ok("the example import parses", !!p.map && !!p.scene);
    ok("the parsed map is already normalized", JSON.stringify(M.normalizeMap(p.map)) === JSON.stringify(p.map));
    const back = I.parseImport(I.exportMap(p.map, p.scene));
    ok("export → import round-trips the map", canon(back.map.hexes) === canon(p.map.hexes) && canon(back.map.regions) === canon(p.map.regions),
      diffStr({ hexes: p.map.hexes, regions: p.map.regions }, { hexes: back.map.hexes, regions: back.map.regions }));
    ok("the example marks a region's name known", Object.values(p.map.regions).some((r) => r.nk) && Object.values(p.map.regions).some((r) => !r.nk));
    const custom = I.parseImport(JSON.stringify({ ...ex, presets: [{ id: "scouted", name: "Scouted", fields: { terrain: true } }, { id: "sight" }],
      hexes: [{ col: 5, row: 5, state: "scouted" }, { col: 6, row: 5, state: "masked", mask: { preset: "sight" } }] }));
    ok("imported presets replace the seed; reserved ids are refused with a warning", canon(Object.keys(custom.map.presets)) === canon(["scouted"]) && custom.warnings.some((w) => w.includes("reserved")));

    /* The frame of blank hexes a scene carries around an imported map is BORDER,
       with nothing written per hex: the map's extent says so. This is the whole
       point of the mark — without it that frame is ordinary uncharted ground a
       party can walk into, and it looks exactly like map. Driven through the
       real sizing, the real placement and the real key set. */
    const D = await imp("scripts/features/hexcrawl/import-dialog.mjs");
    ok("a parsed map declares its own extent", canon(p.map.bounds) === canon({ i: 0, j: 0, rows: ex.scene.rows, cols: ex.scene.cols }));
    for (const type of [2, 4]) {
      const sc = { ...p.scene, gridType: type };
      const { origin, width, height } = H.hexSceneDims({ type, size: sc.size, cols: sc.cols, rows: sc.rows, pad: D.IMPORT_PAD });
      const placed = M.normalizeMap(D.placeOnGrid({ ...p, scene: sc }, origin));
      const ad = H.pureAdapter({ type, size: sc.size });
      const keys = H.keysInRect(ad, { x: 0, y: 0, width, height });
      let pad = 0, padMap = 0, inside = 0, insideBorder = 0;
      for (const k of keys) {
        const { i, j } = H.parseKey(k);
        const isMap = i >= origin.i && j >= origin.j && i < origin.i + sc.rows && j < origin.j + sc.cols;
        if (isMap) { inside++; if (M.isBorder(placed, k)) insideBorder++; }
        else { pad++; if (!M.isBorder(placed, k)) padMap++; }
      }
      ok(`type ${type}: the imported map is padded with hexes`, pad > 0 && inside === sc.rows * sc.cols, `${pad} pad, ${inside} map`);
      ok(`type ${type}: every padding hex is border`, padMap === 0, `${padMap} of ${pad} still in play`);
      ok(`type ${type}: no hex of the map is`, insideBorder === 0, `${insideBorder} of ${inside} blacked out`);
      ok(`type ${type}: the frame costs no hex records`, !Object.keys(placed.hexes).some((k) => placed.hexes[k].bd != null));
    }
    const bordered = I.parseImport(JSON.stringify({ ...ex, hexes: [{ col: 0, row: 0, border: true }, { col: 1, row: 0, border: false }] }));
    ok("a document can border a hex and un-border one",
      bordered.map.hexes["0,0"].bd === 1 && bordered.map.hexes["0,1"].bd === 0);
    const bback = I.parseImport(I.exportMap(bordered.map, bordered.scene));
    ok("border round-trips through export", canon(bback.map.hexes) === canon(bordered.map.hexes),
      diffStr(bordered.map.hexes, bback.map.hexes));
    ok("the extent round-trips through export (scene cols/rows)", canon(bback.map.bounds) === canon(bordered.map.bounds),
      diffStr(bordered.map.bounds, bback.map.bounds));
    ok("a hex state may name an imported preset or the sight preset", Object.values(custom.map.hexes).some((h) => h.mk?.p === "scouted") && Object.values(custom.map.hexes).some((h) => h.mk?.p === C.SIGHT_PRESET));
    const again = I.parseImport(I.exportMap(custom.map, custom.scene));
    ok("export → import round-trips the presets", canon(again.map.presets) === canon(custom.map.presets), diffStr(custom.map.presets, again.map.presets));
  } catch (e) { ok("import round trip runs", false, e.message); }
} else console.log("  (import.mjs not present — skipped)");

/* ── i18n ───────────────────────────────────────────────────────────────── */
head("i18n");
const flatten = (o, p = "", out = {}) => {
  for (const [k, v] of Object.entries(o)) {
    const key = p ? `${p}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out); else out[key] = v;
  }
  return out;
};
const lang = {};
for (const f of readdirSync(join(ROOT, "lang")).filter((f) => /^hexcrawl.*\.en\.json$/.test(f))) {
  Object.assign(lang, flatten(JSON.parse(readFileSync(join(ROOT, "lang", f), "utf8"))));
}
const need = [];
for (const id of C.BUILTIN_TERRAIN_IDS) need.push(`GLHEX.terrain.${id}`);
for (const n of Object.keys(C.RATING_NAMES)) need.push(`GLHEX.rating.${n}`);
for (const s of C.STATES) need.push(`GLHEX.state.${s}`);
for (const s of [...Object.keys(C.MASK_PRESETS), C.SIGHT_PRESET]) need.push(`GLHEX.mask.${s}`);
for (const s of C.SIGHT_STATES) need.push(`GLHEX.sightState.${s}`);
for (const s of C.MASK_FIELDS) need.push(`GLHEX.field.${s}`);
for (const s of Object.keys(C.COST_UNITS)) need.push(`GLHEX.unit.${s}`);
for (const s of Object.keys(C.COST_UNITS)) for (const n of ["one", "other"]) need.push(`GLHEX.unitCount.${s}.${n}`);
for (const s of C.RUMOR_TRUTH) need.push(`GLHEX.truth.${s}`);
for (const s of C.BRUSH_TOOLS) need.push(`GLHEX.tool.${s}`);
for (const s of C.RENDER_MODES) need.push(`GLHEX.render.${s}`);
for (const s of C.GLYPH_IDS) need.push(`GLHEX.glyph.${s}`);
for (const s of C.LANDMARK_VIS) need.push(`GLHEX.landmarkVis.${s}`);
// Every literal key the runtime, the GM apps and their templates pass to
// localize/format. A key only a template names resolves to the raw key on
// screen, which no other check here would catch.
const langSources = [
  ...readdirSync(FEAT).filter((f) => f.endsWith(".mjs")).map((f) => join(FEAT, f)),
  ...readdirSync(join(FEAT, "apps")).filter((f) => f.endsWith(".mjs")).map((f) => join(FEAT, "apps", f)),
  ...readdirSync(join(ROOT, "templates", "hexcrawl")).filter((f) => f.endsWith(".hbs")).map((f) => join(ROOT, "templates", "hexcrawl", f)),
];
for (const f of langSources) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/["'`](GLHEX\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) need.push(m[1]);
  for (const m of src.matchAll(/["'`](GLS\.feature\.hexcrawl\.[a-z]+)["'`]/g)) need.push(m[1]);
}
const missing = [...new Set(need)].filter((k) => typeof lang[k] !== "string" || !lang[k]);
ok("every dynamic family and literal key resolves", missing.length === 0, missing.join(", "));

/* ── settings, timing, assets, manifest ─────────────────────────────────── */
head("settings");
ok("every setting key starts with hex.", Object.values(C.SETTINGS).every((k) => k.startsWith(C.PREFIX)));
const idx = readFileSync(join(FEAT, "index.mjs"), "utf8");
ok("adapter declares settingPrefix PREFIX", /settingPrefix:\s*PREFIX/.test(idx) && C.PREFIX === "hex.");
for (const k of Object.keys(C.SETTINGS)) ok(`setting ${k} is registered`, idx.includes(`SETTINGS.${k}`));
ok("TIMING values are all finite numbers", Object.values(C.TIMING).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0));
for (const f of ["reveal.wav", "step.wav"]) {
  const p = join(ROOT, "assets", "hexcrawl", f);
  ok(`assets/hexcrawl/${f} exists (node tools/gen-hexcrawl-sounds.mjs)`, existsSync(p) && readFileSync(p).toString("ascii", 0, 4) === "RIFF");
}
const manifest = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
for (const s of ["styles/hexcrawl.css", "styles/hexcrawl-play.css"]) ok(`module.json lists ${s}`, manifest.styles.includes(s));
for (const l of ["lang/hexcrawl.en.json", "lang/hexcrawl-apps.en.json"]) ok(`module.json lists ${l}`, manifest.languages.some((x) => x.path === l));
ok("features/index.mjs imports the adapter", readFileSync(join(ROOT, "scripts", "features", "index.mjs"), "utf8").includes("./hexcrawl/index.mjs"));

head("css");
const play = readFileSync(join(ROOT, "styles", "hexcrawl-play.css"), "utf8");
ok("the chat card sizes its .gl-btn (it declares no font-size)", /\.glhex-card \.gl-btn[\s\S]*?font-size/.test(play));
ok("no raw white veils", !/rgba\(\s*255\s*,\s*255\s*,\s*255/.test(play));
ok("no @font-face / network @import", !/@font-face|@import\s+url\(['"]?http/.test(play));
ok("no raw ms/s durations", !/\b\d+(\.\d+)?m?s\b(?![-\w])/.test(play.replace(/\/\*[\s\S]*?\*\//g, "")));

/* ── renderer & apps purity ─────────────────────────────────────────────── */
const walk = (dir) => existsSync(dir) ? readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".mjs") ? [p] : [];
}) : [];
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

head("renderer");
const renderFiles = walk(join(FEAT, "render"));
ok("render/ exists", renderFiles.length > 0);
for (const f of renderFiles) {
  const src = stripComments(readFileSync(f, "utf8"));
  const hit = src.match(/\b(game|canvas|foundry|ui|Hooks)\./);
  ok(`${relative(ROOT, f)} never reads the world`, !hit, hit?.[0]);
}
if (renderFiles.length) {
  try {
    const R = await imp("scripts/features/hexcrawl/render/renderer.mjs");
    ok("renderer exports HexRenderer", typeof R.HexRenderer === "function");
    for (const m of ["setMap", "setParty", "setTrail", "setStaged", "setHover", "setZoom", "setMotionScale", "update", "destroy"]) {
      ok(`HexRenderer#${m}`, typeof R.HexRenderer.prototype[m] === "function");
    }
  } catch (e) { ok("renderer imports under plain Node", false, e.message); }

  /* Fused regions: a rim that leaves one hex must arrive in the next exactly, or
     the region outline is a row of broken dashes. Walk every mask pair that two
     neighbours in one region can have and compare the shared end points. */
  try {
    const T = await imp("scripts/features/hexcrawl/render/template.mjs");
    for (const type of [2, 4]) {
      const ad = H.pureAdapter({ type, size: 100, bounds: { rows: 6, cols: 6 } });
      const R = ad.radius ?? ad.size / Math.sqrt(3);
      const tpl = T.makeTemplate(ad, R, "2,2");
      ok(`type ${type}: all-interior hex has no rim and three seams`, tpl.fused(0).rims.length === 0 && tpl.fused(0).seams.length === 3);
      ok(`type ${type}: an island is one closed rim`, tpl.fused(63).rims.length === 1 && tpl.fused(63).rims[0].closed);
      // Hex A and the neighbour B across A's edge e share A's vertices e and e+1.
      // Put the third hex at A's vertex e+1 (across A's edge e+1 = B's edge e+2... ) in another region.
      let bad = 0;
      for (let e = 0; e < 6; e++) {
        const maskA = 1 << ((e + 1) % 6);          // A borders the other region across edge e+1 only
        const eB = (e + 3) % 6;                      // B's edge back to A
        const maskB = 1 << ((eB + 5) % 6);           // …and B borders it across the edge before that
        const a = tpl.fused(maskA), b = tpl.fused(maskB);
        const off = tpl.across[e];                  // B's centre relative to A's
        const endA = a.rims[0]?.pts[0];             // A's rim starts on the shared edge
        const endB = b.rims[0]?.pts.at(-1);         // B's rim ends on it
        if (!endA || !endB || Math.hypot(endA.x - (endB.x + off.x), endA.y - (endB.y + off.y)) > 1e-6) bad++;
      }
      ok(`type ${type}: region rims meet across neighbouring hexes`, bad === 0, `${bad} of 6 corners`);
    }
  } catch (e) { ok("fused geometry runs", false, e.message); }
  const tilesSrc = stripComments(readFileSync(join(FEAT, "render", "tiles.mjs"), "utf8"));
  const rendSrc = stripComments(readFileSync(join(FEAT, "render", "renderer.mjs"), "utf8"));
  ok("the fog look draws no vector \"?\" (it is text in the label face)", !/look === "fog"[\s\S]{0,900}?drawQuestion\(/.test(tilesSrc));
  ok("the fog \"?\" rasterises once in the label face and is shared", /new this\.PIXI\.Text\("\?"[\s\S]{0,160}fontFamily: this\.fontFamily/.test(rendSrc) && /new this\.PIXI\.Sprite\(tex\)/.test(rendSrc));
  ok("a hex's signature carries its boundary mask (a neighbour's region change redraws it)", /_boundary\(k\)[\s\S]{0,700}\|\$\{edge\}/.test(rendSrc));

  /* Landmark badges: colour, size, and the GM's "can the party see this?".
     All three are DRAWN, so all three have to reach the signature the chunked
     static layer and the icon layer key on — a badge recoloured or resized and
     not signed keeps the old look on every hex that shares its stamp, forever,
     with nothing reported. */
  try {
    const T = await imp("scripts/features/hexcrawl/render/tiles.mjs");
    const G2 = await imp("scripts/features/hexcrawl/render/geom.mjs");
    const { GEO } = await imp("scripts/features/hexcrawl/render/style.mjs");
    const GEOBASE = (n) => GEO.lmBadge * (n >= 3 ? 0.82 : 1);
    const base = { id: "a", icon: "fa-solid fa-x", img: null, label: "A", vis: "follow", color: null, size: 1 };
    const sig = (o) => T.badgeSig({ ...base, ...o });
    ok("a badge's signature separates colour, size and seen",
      new Set([sig({}), sig({ color: "#ff0000" }), sig({ size: 1.5 }), sig({ seen: false })]).size === 4);
    ok("the signature is stable for the same badge", sig({ color: "#ff0000" }) === sig({ color: "#ff0000" }));
    ok("the renderer and the static layer sign with that one function",
      rendSrc.includes("badgeSig") && !/l\.id\}:\$\{l\.icon\}/.test(rendSrc)
      && /badgeSig/.test(tilesSrc) && /\$\{lm\}/.test(tilesSrc));
    ok("the icon layer places with the badges' own layout (a mark cannot leave its diamond)",
      stripComments(readFileSync(join(FEAT, "render", "labels.mjs"), "utf8")).includes("badgeLayout("));

    // The row is laid out from the radii, so badges of ANY sizes sit side by
    // side: two overlapping diamonds read as one broken mark, and a cluster
    // wider than its hex stops saying which hex it is on.
    ok("one shipped badge sits at the hex centre",
      Math.abs(G2.landmarkLayout([GEO.lmBadge])[0].x) < 1e-9 && G2.landmarkLayout([GEO.lmBadge])[0].s === GEO.lmBadge);
    const two = G2.landmarkLayout([GEO.lmBadge, GEO.lmBadge]);
    ok("two shipped badges keep the slots they always had (±0.25)",
      Math.abs(two[0].x + 0.25) < 1e-9 && Math.abs(two[1].x - 0.25) < 1e-9);
    let overlap = 0, spill = 0;
    const steps = [...C.LANDMARK_SIZE_STEPS];
    for (const a of steps) for (const b of steps) for (const c of steps) {
      for (const sizes of [[a], [a, b], [a, b, c]]) {
        const n = sizes.length;
        const R = GEOBASE(n);
        const row = G2.landmarkLayout(sizes.map((s) => R * s));
        for (let i = 1; i < row.length; i++) {
          if (row[i].x - row[i - 1].x < row[i].s + row[i - 1].s - 1e-9) overlap++;
        }
        if (row.some((p) => Math.abs(p.x) + p.s > 0.75 + 1e-9)) spill++;
      }
    }
    ok("badges of any sizes never overlap", overlap === 0, `${overlap} pairs`);
    ok("a cluster never grows past its hex", spill === 0, `${spill} rows`);
    const big = T.badgeLayout([{ size: 2 }], 100), small = T.badgeLayout([{ size: 0.6 }], 100);
    ok("a landmark's size reaches the badge it draws", big[0].s > small[0].s * 3 - 1e-9);

    /* Border is the one look that is the same on every screen in the world, so
       it is answered before `asGMFull` — behind it, a GM sees the ground under
       the black and cannot tell a bordered hex from an ordinary one. */
    const border = { border: true, state: "revealed", landmarks: [] };
    ok("border outranks every state, the GM view included",
      T.lookFor(border, true) === "border" && T.lookFor(border, false) === "border"
      && T.lookFor({ ...border, border: false }, true) === "tile");
    ok("every border hex shares one stamp",
      T.stampKey({}, "0,0", border, "border") === T.stampKey({}, "9,9", { ...border, state: "hidden" }, "border"));
    ok("a border hex draws flat black and nothing else (its own colour, not the fog's ink)",
      /look === "border"[\s\S]{0,400}?colors\.border/.test(tilesSrc)
      && /look === "border"[\s\S]{0,400}?return;/.test(tilesSrc)
      && /border:\s*0x000000/.test(stripComments(readFileSync(join(FEAT, "render", "style.mjs"), "utf8"))));
    ok("nothing else is drawn on a border hex: no \"?\", no hatch, no sight ring",
      /border\)?\s*continue|\?\.border\) continue/.test(rendSrc) && /skip\)/.test(stripComments(readFileSync(join(FEAT, "render", "overlays.mjs"), "utf8"))));
  } catch (e) { ok("landmark badges run", false, e.message); }
}

head("durations");
const durationFiles = [...renderFiles, ...walk(join(FEAT, "apps"))];
for (const f of durationFiles) {
  const src = stripComments(readFileSync(f, "utf8"));
  const lit = src.match(/\b(duration|delay|ms)\s*[:=]\s*\d{2,}/i) || src.match(/set(Timeout|Interval)\([^;]*?,\s*\d{2,}\s*\)/);
  ok(`${relative(ROOT, f)} writes no literal duration (use TIMING)`, !lit, lit?.[0]);
}

head("apps");
const appFiles = walk(join(FEAT, "apps"));
ok("apps/ exists", appFiles.length > 0);
{
  // The GM is told what the party sees of a landmark in three places — the map,
  // the tooltip and the hex editor. All three must take that answer from the
  // model; one re-deriving it from `vis` alone stops agreeing the moment a hex's
  // mask changes, and the GM's own screen looks perfectly correct either way.
  const tip = stripComments(readFileSync(join(FEAT, "tooltip.mjs"), "utf8"));
  ok("the tooltip's landmark tag reads viewFor's `seen`", /lm\.seen/.test(tip));
  const ed = stripComments(readFileSync(join(FEAT, "apps", "hex-editor.mjs"), "utf8"));
  ok("the hex editor's chip asks the model, from the draft", /landmarkSeen\(/.test(ed) && /landmarksShown\(/.test(ed));
  const hbs = readFileSync(join(ROOT, "templates", "hexcrawl", "hex-editor.hbs"), "utf8");
  for (const [what, re] of [["colour", /name="lm\.\{\{i\}\}\.color"/], ["size", /name="lm\.\{\{i\}\}\.size"/], ["seen chip", /glhex-lm-seen/]]) {
    ok(`the landmark row carries its ${what}`, re.test(hbs));
  }
  // Border: a GM needs both roads to it, and the editor's tick has to be the
  // RESOLVED answer — a checkbox reading the raw flag opens unticked on every
  // padding hex, which says that black frame is ordinary ground.
  ok("the hex editor offers border, resolved and written through borderFlagFor",
    /name="bd"/.test(hbs) && /isBorder\(map, key\)/.test(ed) && /borderFlagFor\(/.test(ed));
  ok("the palette carries a border brush", C.BRUSH_TOOLS.includes("border")
    && /border:/.test(stripComments(readFileSync(join(FEAT, "apps", "palette.mjs"), "utf8"))));
  // The party must not walk into the black, and a move that lands there must
  // reveal, cost and record nothing — both guards, in both clients.
  const mv = stripComments(readFileSync(join(FEAT, "movement.mjs"), "utf8"));
  ok("movement refuses a border hex on the moving client and writes nothing on the GM's",
    (mv.match(/isBorder\(map, to\)/g) ?? []).length >= 2);
  const tipSrc = stripComments(readFileSync(join(FEAT, "tooltip.mjs"), "utf8"));
  ok("the tooltip tells a player nothing about a border hex", /v\.border[\s\S]{0,200}?if \(!gm\) return null;/.test(tipSrc));
}
delete globalThis.game; delete globalThis.Hooks;
for (const f of appFiles) {
  try { await import(pathToFileURL(f).href); } catch (e) { ok(`${relative(ROOT, f)} imports without foundry at module scope`, false, e.message); }
}
try {
  const A = await imp("scripts/features/hexcrawl/apps/index.mjs");
  for (const fn of ["openPalette", "closePalette", "togglePalette", "openHexEditor", "openRegionEditor", "openSceneSettings", "openTerrainManager", "pickIcon", "terrainLabel"]) {
    ok(`apps export ${fn}`, typeof A[fn] === "function");
  }
} catch (e) { ok("apps/index.mjs imports under plain Node", false, e.message); }

head("runtime imports");
// Every runtime module must import under Node too: nothing at module scope may touch the world.
for (const f of readdirSync(FEAT).filter((f) => f.endsWith(".mjs") && f !== "index.mjs")) {
  try { await import(pathToFileURL(join(FEAT, f)).href); } catch (e) { ok(`${f} has no module-scope side effects`, false, e.message); }
}

console.log(problems ? `\n${problems} problem(s).` : "\nhexcrawl-check: all good.");
process.exit(problems ? 1 : 0);
