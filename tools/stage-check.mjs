#!/usr/bin/env node
/**
 * GLUniverse Suite — Stage consistency check.
 *
 *   node tools/stage-check.mjs
 *
 * Almost everything Stage can get wrong fails SILENTLY:
 *
 *   - A normalizer that is not total lets a key the stored value lacked survive
 *     Foundry's merge, or puts `undefined` into the director.
 *   - A uniform that is declared and never written holds whatever the driver
 *     started it at, every frame. A shader that does not compile leaves the
 *     cast unlit and reports it only to the console.
 *   - A frame field the renderer reads and the director never writes draws
 *     every figure at 0.
 *   - A shed name the director asks for that is not in SHED_ORDER never
 *     degrades under load.
 *   - A renderer, director or comms overlay that reads the world works in
 *     Foundry and breaks the preview, which then flatters a copy nobody ships.
 *   - A dynamic i18n key prints its raw key on the GM's panel.
 *   - Light written as a plain merge keeps a dial the GM deleted.
 *
 * This drives the pure modules and reads the rest. It cannot compile GLSL or
 * show you a frame — for that, `node tools/stage-preview.mjs` and serve it.
 * Zero problems required; exits non-zero otherwise.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FEAT = "scripts/features/stage";
const imp = (rel) => import(pathToFileURL(join(ROOT, rel)).href);
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

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
  if (!existsSync(join(ROOT, dir))) return out;
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const finiteDeep = (v) => {
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(finiteDeep);
  if (v && typeof v === "object") return Object.values(v).every(finiteDeep);
  return true;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const M = await imp(`${FEAT}/model.mjs`);
const R = await imp(`${FEAT}/light/rig.mjs`);
const P = await imp(`${FEAT}/light/probe.mjs`);
const B = await imp(`${FEAT}/light/backdrop.mjs`);
const S = await imp(`${FEAT}/light/shape.mjs`);
const SH = await imp(`${FEAT}/render/shaders.mjs`);
const D = await imp(`${FEAT}/director.mjs`);
const T = await imp(`${FEAT}/timing.mjs`);

/* ── Model: every normalizer is total and idempotent ──────────────────── */
section = "model";
{
  const junk = [undefined, null, 0, "x", [], {}, { on: "x", calls: 3, shot: "close", focus: 9, name: 4, image: [], height: "big" }];
  const cases = [
    ["normalizeCast", (x) => M.normalizeCast(x)],
    ["normalizeState", (x) => M.normalizeState(x, null)],
    ["normalizeLayout", (x) => M.normalizeLayout(x)],
    ["normalizeComms", (x) => M.normalizeComms(x, null)],
    ["normalizeCommsLayout", (x) => M.normalizeCommsLayout(x)],
    ["normalizeLight", (x) => R.normalizeLight(x)],
  ];
  for (const [name, fn] of cases) {
    const shape = Object.keys(fn({}) ?? {}).sort();
    for (const j of junk) {
      let out;
      try { out = fn(j); } catch (e) { ok(`${name} does not throw on ${JSON.stringify(j)}`, false, e.message); continue; }
      ok(`${name}(${JSON.stringify(j)}) is finite`, finiteDeep(out));
      if (!Array.isArray(out)) ok(`${name}(${JSON.stringify(j)}) is complete`, same(Object.keys(out).sort(), shape));
      ok(`${name} is idempotent on ${JSON.stringify(j)}`, same(fn(out), out));
    }
  }

  const cast = M.normalizeCast([{ id: "a", name: "A" }, { id: "a", name: "dup" }, { name: "B" }, null, 5]);
  ok("cast ids are unique", new Set(cast.map((m) => m.id)).size === cast.length && cast.length === 3);
  ok("cast ids are deterministic", same(cast.map((m) => m.id), M.normalizeCast([{ id: "a", name: "A" }, { id: "a", name: "dup" }, { name: "B" }]).map((m) => m.id)));

  const st = M.normalizeState({ visible: true, shot: "close", close: "ghost", focus: "a", on: [{ id: "a", x: 2 }, { id: "a" }, { id: "gone" }] }, ["a"]);
  ok("a mark for a missing character is dropped, and duplicates", st.on.length === 1 && st.on[0].x === 1);
  ok("a close-up of nobody is the wide shot", st.shot === "wide" && st.close === null);
  ok("focus survives only on someone on stage", st.focus === "a");
  const many = M.normalizeState({ on: Array.from({ length: 20 }, (_, i) => ({ id: `c${i}` })) });
  ok("no more than MAX_ON_STAGE marks", many.on.length === M.MAX_ON_STAGE);

  const comms = M.normalizeComms({ visible: true, calls: [{ actorId: "a" }, { castId: "a" }, { castId: "b" }], speakingCall: "zzz" }, ["a"]);
  ok("comms drop unknown callers and duplicates", comms.calls.length === 1 && comms.calls[0].castId === "a");
  ok("a speaker who is not on a call is nobody", comms.speaking === null);
  ok("comms with no calls are hidden", M.normalizeComms({ visible: true, calls: [] }).visible === false);

  ok("openMark lands inside the stage", [[], [{ x: 0.5 }], [{ x: 0 }, { x: 1 }], [{ x: 0.2 }, { x: 0.3 }]].every((on) => { const x = M.openMark(on); return x >= 0 && x <= 1; }));
  const spread = M.spreadMarks([{ id: "b", x: 0.9 }, { id: "a", x: 0.1 }, { id: "c", x: 0.5 }]);
  ok("spreadMarks keeps left-to-right order", spread.map((m) => m.id).join() === "a,c,b" && spread[0].x < spread[1].x && spread[1].x < spread[2].x);
}

/* ── Migration from the old Stage ─────────────────────────────────────── */
section = "migration";
{
  const lib = [
    { id: "hero", name: "Hero", image: "a.webp", scale: 1.2, offsetX: 10, offsetY: 20, commsTint: "#ff0000" },
    { id: "hero", name: "Clone", image: "b.webp" },
    { name: "Nameless" },
  ];
  const cast = M.migrateLegacyCast(lib);
  ok("every old library entry becomes a character", cast.length === 3);
  ok("ids are kept, so old calls still resolve", cast[0].id === "hero");
  ok("a duplicated old id gets a fresh one", cast[1].id !== "hero");
  ok("scale becomes height", cast[0].height === 1.2);
  ok("old CSS offsets become figure fractions (y up)", cast[0].offsetX === 0.1 && cast[0].offsetY === -0.2);
  ok("the comms tint is carried", cast[0].tint === "#ff0000");
  const comms = M.migrateLegacyComms({ visible: true, calls: [{ callId: "c1", actorId: "hero" }], speakingCall: "c1" }, ["hero"]);
  ok("old calls (actorId, speakingCall) carry across", comms.calls[0]?.castId === "hero" && comms.speaking === "c1" && comms.visible);
  for (const [theme, style] of [["scifi", "holo"], ["ethereal", "radio"], ["minimal", "clean"]]) {
    ok(`old theme ${theme} → ${style}`, M.migrateLegacyCommsLayout({ theme }).style === style);
  }
  ok("old 'centered' alignment → center", M.migrateLegacyCommsLayout({ valign: "centered" }).align === "center");
  const store = stripComments(read(`${FEAT}/store.mjs`));
  ok("migration never overwrites a cast the new Stage already has", /if \(!cast\.length && Array\.isArray\(legacy\)/.test(store));
  ok("migration is versioned and GM-only", /MIGRATION_VERSION/.test(store) && /if \(!isGM\(\)\) return;/.test(store));
}

/* ── Light: rig is total, deterministic and neutral where it says ──────── */
section = "light";
{
  const keys = Object.keys(R.identityRig()).sort();
  const lightKeys = Object.keys(R.DEFAULT_LIGHT).sort();
  ok("normalizeLight returns every DEFAULT_LIGHT key", same(Object.keys(R.normalizeLight(null)).sort(), lightKeys));
  for (const [dial, [lo, hi]] of Object.entries(R.LIGHT_DIALS)) {
    ok(`dial ${dial} is a DEFAULT_LIGHT key`, dial in R.DEFAULT_LIGHT);
    const l = R.normalizeLight({ [dial]: 99 });
    ok(`dial ${dial} clamps high`, l[dial] === hi);
    ok(`dial ${dial} clamps low`, R.normalizeLight({ [dial]: -99 })[dial] === lo);
  }
  ok("an unknown mood falls back", R.normalizeLight({ mood: "disco" }).mood === R.DEFAULT_LIGHT.mood);

  // A synthetic room: warm, mid-dark.
  const W = 64, H = 36;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const t = x / W;
    data[i] = 40 + 160 * t; data[i + 1] = 30 + 60 * t; data[i + 2] = 20; data[i + 3] = 255;
    if (y < 6 && x > 28 && x < 36) { data[i] = data[i + 1] = data[i + 2] = 250; } // a lamp
  }
  const probe = P.probeImage({ data, width: W, height: H });
  ok("the probe reads a room", probe?.ok === true && finiteDeep(probe));
  ok("the probe's hue is unit-luma", Math.abs(P.lum(probe.hue) - 1) < 0.02);
  ok("normalizeProbe is idempotent", same(P.normalizeProbe(P.normalizeProbe(probe)), P.normalizeProbe(probe)));

  for (const mood of R.MOODS) {
    for (const darkness of [0, 0.5, 1]) {
      for (const pr of [null, P.neutralProbe(), probe]) {
        const light = R.normalizeLight({ mood });
        const a = R.resolveRig(light, pr, { darkness });
        const b = R.resolveRig(light, pr, { darkness });
        const tag = `${mood}/d${darkness}/${pr ? (pr === probe ? "room" : "neutral") : "none"}`;
        ok(`rig ${tag} has every field`, same(Object.keys(a).sort(), keys), keys.filter((k) => !(k in a)).join(","));
        ok(`rig ${tag} is finite`, finiteDeep(a));
        ok(`rig ${tag} is deterministic`, same(a, b));
      }
    }
  }
  ok("mood off is the identity rig", same(R.resolveRig(R.normalizeLight({ mood: "off" }), probe), R.identityRig()));
  ok("strength 0 is the identity rig", same(R.resolveRig(R.normalizeLight({ strength: 0 }), probe), R.identityRig()));
  const lit = R.resolveRig(R.normalizeLight({}), probe);
  const half = R.lerpRig(R.identityRig(), lit, 0.5);
  ok("lerpRig keeps every field", same(Object.keys(half).sort(), keys) && finiteDeep(half));
  ok("lerpRig at 0 and 1 is its ends", same(R.lerpRig(R.identityRig(), lit, 0), R.identityRig()) && same(R.lerpRig(R.identityRig(), lit, 1), lit));
  ok("darkness never brightens the cast", R.resolveRig(R.normalizeLight({}), probe, { darkness: 1 }).level <= lit.level);
  // Strength is the whole look: a faint strength is faint outside the figures
  // too, so the dial is continuous into its identity at 0.
  for (const mood of R.MOODS ?? ["auto", "night"]) {
    if (mood === "off") continue;
    const faint = R.resolveRig(R.normalizeLight({ mood, strength: 0.001 }), probe, { darkness: 1 });
    ok(`strength 0.001 is a breath of ${mood} outside the figures`, ["blur", "bloom", "glow", "grain", "shadow", "bgHaze", "flicker"].every((k) => faint[k] < 0.01) && Math.abs(faint.bgLevel - 1) < 0.01 && faint.bgTint.every((v) => Math.abs(v - 1) < 0.01));
  }

  // Tints are hue only: unit luminance, so a tint never changes how bright the art is.
  for (const k of [0, 0.5, 1, 2]) ok(`tintOf(·, ${k}) is unit-luma`, Math.abs(P.lum(R.tintOf([0.6, 0.3, 0.1], k)) - 1) < 0.02);

  // The backdrop pipeline, end to end on a synthetic picture.
  const size = B.backdropReadSize(16 / 9);
  const big = new Uint8Array(size.width * size.height * 4);
  for (let i = 0; i < big.length; i += 4) { big[i] = (i / 4) % size.width; big[i + 1] = 80; big[i + 2] = 140; big[i + 3] = 255; }
  const maps = B.buildBackdrop({ data: big, width: size.width, height: size.height });
  ok("buildBackdrop yields every map", ["probe", "env", "mid", "soft", "glow"].every((k) => maps[k]));
  ok("every map is byte RGBA of its size", ["env", "mid", "soft", "glow"].every((k) => maps[k].data.length === maps[k].width * maps[k].height * 4));
  const room = B.roomOf(maps);
  ok("roomOf is finite", finiteDeep(room) && room.aspect > 0);
  const map = B.coverMap({ w: 1920, h: 1080 }, 4 / 3, { unit: true });
  const c = B.pictureToScreen(map, [0.5, 0.5]);
  ok("cover centres the picture", Math.abs(c[0] - 0.5) < 1e-6 && Math.abs(c[1] - 0.5) < 1e-6);
}

/* ── Shaders: every uniform declared, listed, and written ──────────────── */
section = "shaders";
{
  const gl = stripComments(read(`${FEAT}/render/gl.mjs`));
  for (const [name, prog] of Object.entries(SH.PROGRAMS)) {
    const src = prog.vs + prog.fs;
    const decl = new Set([...src.matchAll(/uniform\s+\w+\s+(\w+)/g)].map((m) => m[1]));
    const listed = SH.UNIFORMS[name] ?? [];
    for (const u of listed) ok(`${name}: ${u} is declared`, decl.has(u));
    for (const d of decl) ok(`${name}: ${d} is listed`, listed.includes(d));
    for (const u of listed) ok(`${name}: ${u} is written by gl.mjs`, new RegExp(`u\\.${u}\\b`).test(gl));
    ok(`${name}: precision is stated`, /precision\s+highp\s+float/.test(prog.fs));
    // Implicit derivatives in divergent flow are undefined; every art read is explicit.
    if (name === "figure") ok("figure: art is sampled with textureLod only", !/\btexture\(\s*uArt\b/.test(prog.fs));
  }
}

/* ── Director: the frame carries what the renderer reads ───────────────── */
section = "director";
{
  const aspect = 0.6;
  const grid = S.shapeGrid(aspect);
  const px = new Uint8Array(grid.w * grid.h * 4);
  for (let y = grid.padY + 10; y < grid.padY + grid.artH; y++) {
    for (let x = grid.padX + Math.round(grid.artW * 0.25); x < grid.padX + Math.round(grid.artW * 0.75); x++) px[(y * grid.w + x) * 4 + 3] = 255;
  }
  const shape = S.buildShape({ data: px, width: grid.w, height: grid.h }, grid);
  const info = {
    aspect, width: 600, height: 1000,
    padU: grid.padX / grid.w, padV: grid.padY / grid.h,
    shapeTexel: [1 / grid.w, 1 / grid.h],
    bounds: shape.bounds, head: shape.head, face: null,
  };
  ok("buildShape finds bounds and a head", !!shape.bounds && !!shape.head && finiteDeep(shape.bounds) && finiteDeep(shape.head));

  const shed = new Set();
  const asked = new Set();
  const d = new D.Director({ allows: (n) => { asked.add(n); return !shed.has(n); } });
  d.setView(1920, 1080);
  const cast = M.normalizeCast([{ id: "a", name: "A", image: "a.webp" }, { id: "b", name: "B", title: "The Second", image: "b.webp" }]);
  d.setCast(cast);
  d.setArt("a.webp", info);
  d.setArt("b.webp", info);
  d.setBackdrop("room", B.roomOf((() => { const s = B.backdropReadSize(16 / 9); const b = new Uint8Array(s.width * s.height * 4).fill(90); return B.buildBackdrop({ data: b, width: s.width, height: s.height }); })()), 0, { immediate: true });
  d.setRig(R.resolveRig(R.normalizeLight({}), null), 0, { immediate: true });
  let t = 0;
  const settle = () => { for (let i = 0; i < 2000 && d.busy(t); i++) { t += 16; d.step(t); } return !d.busy(t); };

  d.setState(M.normalizeState({ visible: true, on: [{ id: "a", x: 0.3 }, { id: "b", x: 0.7 }] }), t);
  ok("an entrance settles", settle());
  let f = d.step(t);
  ok("both characters are drawn, fully in", f.figures.length === 2 && f.figures.every((g) => g.alpha > 0.99));
  ok("the frame is finite", finiteDeep({ ...f, figures: f.figures.map(({ key, id, ...rest }) => rest), nameplate: null }));

  // Every frame and figure field the renderer reads exists.
  const glSrc = stripComments(read(`${FEAT}/render/gl.mjs`));
  const draw = glSrc.slice(glSrc.indexOf("draw(frame)"));
  const frameFields = new Set([...draw.matchAll(/\bframe\.(\w+)/g)].map((m) => m[1]));
  for (const k of frameFields) ok(`frame.${k} is produced by the director`, k in f || k === "debug");
  const figFields = new Set([...draw.matchAll(/\bf\.(\w+)/g)].map((m) => m[1]));
  for (const k of figFields) ok(`figure.${k} is produced by the director`, k in f.figures[0]);
  const rigFields = new Set([...draw.matchAll(/\br\.(\w+)/g)].map((m) => m[1]));
  for (const k of rigFields) ok(`rig.${k} exists`, k in f.rig);
  const dom = stripComments(read(`${FEAT}/stage-dom.mjs`));
  for (const k of new Set([...dom.matchAll(/\bp\.(\w+)/g)].map((m) => m[1]))) ok(`nameplate.${k} is a nameplate field`, k === "anchor" || k === "close" || k === "amount" || k === "id" || k === "name" || k === "title");

  // Rapid changes settle on the last one.
  d.setState(M.normalizeState({ visible: true, on: [{ id: "a", x: 0.3 }] }), t);
  t += 30;
  d.setState(M.normalizeState({ visible: true, on: [{ id: "a", x: 0.3 }, { id: "b", x: 0.8 }] }), t);
  t += 30;
  d.setState(M.normalizeState({ visible: true, on: [{ id: "b", x: 0.5 }] }), t);
  ok("rapid restaging settles", settle());
  f = d.step(t);
  ok("rapid restaging settles on the last state", f.figures.length === 1 && f.figures[0].id === "b");

  // A silhouette: masked on its mark, no name card, revealed by the GM.
  {
    ok("a mark keeps its silhouette flag", M.normalizeMark({ id: "a", masked: true }).masked === true && M.normalizeMark({ id: "a" }).masked === false);
    const d4 = new D.Director();
    d4.setView(1920, 1080);
    d4.setCast(cast);
    d4.setArt("b.webp", info);
    d4.setLayout({ nameplates: "close" });
    d4.setState(M.normalizeState({ visible: true, shot: "close", close: "b", on: [{ id: "b", x: 0.5, masked: true }] }), 0, { immediate: true });
    let g = d4.step(5000);
    ok("a masked character stands as a silhouette", g.figures[0].mask === 1);
    ok("a silhouette has no name card, even in a close-up", g.nameplate === null);
    d4.setState(M.normalizeState({ visible: true, shot: "close", close: "b", on: [{ id: "b", x: 0.5, masked: false }] }), 5000);
    const mid = d4.step(5000 + D.TIMING.reveal / 2).figures[0].mask;
    ok("the reveal takes its time", mid > 0.05 && mid < 0.95 && d4.busy(5000 + D.TIMING.reveal / 2));
    g = d4.step(5000 + D.TIMING.reveal + 1);
    ok("the reveal lands exactly on the art, with its name card", g.figures[0].mask === 0 && g.nameplate?.name === "B" && g.nameplate.amount > 0.99);
  }

  // The idle breath is the world's switch, off unless it says otherwise.
  {
    const still = d.step(t + 1234).figures.every((g) => g.motion[3] === 0);
    ok("characters do not breathe unless the world turns it on", still);
    const d3 = new D.Director({ breathe: () => true });
    d3.setView(1920, 1080);
    d3.setCast(cast);
    d3.setArt("a.webp", info);
    d3.setState(M.normalizeState({ visible: true, on: [{ id: "a", x: 0.5 }] }), 0, { immediate: true });
    const sway = [500, 1500, 2500].map((ms) => d3.step(ms).figures[0].motion[3]);
    ok("with breathing on, a character breathes", sway.some((v) => Math.abs(v) > 1e-4));
  }

  // Mirrored art whose figure is off-centre in its file stays on its mark.
  {
    const d2 = new D.Director();
    d2.setView(1920, 1080);
    d2.setCast(M.normalizeCast([{ id: "m", name: "M", image: "m.webp", faces: "left" }]));
    d2.setArt("m.webp", { ...info, bounds: { x0: 0.08, y0: 0.05, x1: 0.42, y1: 0.95 } });
    d2.setState(M.normalizeState({ visible: true, on: [{ id: "m", x: 0.3 }] }), 0, { immediate: true });
    const g = d2.step(10000).figures[0];
    const om = 0.25;
    const w = g.rect[2] * (1 - 2 * g.pad[0]);
    const body = g.rect[0] + g.rect[2] / 2 + g.flip * (om - 0.5) * w;
    ok("mirrored off-centre art is drawn on its mark and its shadow", g.flip === -1 && Math.abs(body - g.foot[0]) < 0.5);
  }

  // Close-up.
  d.setState(M.normalizeState({ visible: true, shot: "close", close: "b", focus: "b", on: [{ id: "b", x: 0.5 }] }), t);
  ok("a push-in settles", settle());
  f = d.step(t);
  ok("the close-up pushes the camera in", f.camera.zoom > 1.2);
  ok("the close-up shows the name card", f.nameplate && f.nameplate.amount > 0.9 && f.nameplate.name === "B" && f.nameplate.title === "The Second");
  ok("the close-up softens the room", f.bg.blur >= 0.85);
  d.setState(M.normalizeState({ visible: true, on: [{ id: "b", x: 0.5 }] }), t);
  settle();
  ok("back to wide", Math.abs(d.step(t).camera.zoom - 1) < 0.01);
  // A resize lands the camera where the current shot puts it. The store's
  // "back to wide" keeps `close` set, so the shot, not `close`, decides.
  d.setState(M.normalizeState({ visible: true, shot: "close", close: "b", on: [{ id: "b", x: 0.5 }] }), t);
  settle();
  d.setView(1280, 720);
  f = d.step(t);
  const want = d.closeCamera("b");
  ok("a resize mid close-up re-aims the push-in", Math.abs(f.camera.x - want.x) < 0.5 && Math.abs(f.camera.y - want.y) < 0.5 && Math.abs(f.camera.zoom - want.zoom) < 1e-3);
  d.setState(M.normalizeState({ visible: true, shot: "wide", close: "b", on: [{ id: "b", x: 0.5 }] }), t);
  settle();
  d.setView(1600, 900);
  f = d.step(t);
  ok("a resize after a close-up re-centres the wide shot", Math.abs(f.camera.x - 800) < 0.5 && Math.abs(f.camera.y - 450) < 0.5 && Math.abs(f.camera.zoom - 1) < 1e-3);
  d.setView(1920, 1080);
  settle();

  // Gestures.
  for (const kind of M.REACTIONS) ok(`reaction ${kind} plays`, d.react("b", kind, t) === true);
  ok("a reaction on someone off stage is refused", d.react("a", "nod", t) === false);
  settle();

  // Shedding: every name asked for is in SHED_ORDER, and vice versa.
  shed.clear();
  for (let i = 0; i < 30; i++) { t += 16; d.step(t); }
  d.ambient();
  const src = stripComments(read(`${FEAT}/director.mjs`));
  const named = new Set([...src.matchAll(/allows\("(\w+)"\)/g)].map((m) => m[1]));
  for (const n of named) ok(`shed name ${n} is in SHED_ORDER`, D.SHED_ORDER.includes(n));
  for (const n of D.SHED_ORDER) ok(`SHED_ORDER ${n} is asked for`, named.has(n));
  for (const n of D.SHED_ORDER) shed.add(n);
  f = d.step(t);
  ok("fully shed, grain stops", f.grain === 0);
  ok("fully shed, nothing ambient keeps the loop alive", d.ambient() === false);

  // Hidden: the loop stops.
  d.setState(M.normalizeState({ visible: false, on: [{ id: "b", x: 0.5 }] }), t);
  shed.clear();
  settle();
  ok("a hidden stage is not ambient", d.ambient() === false);

  // Backdrop cross-fade frees the old picture.
  d.setState(M.normalizeState({ visible: true }), t);
  settle();
  d.setBackdrop("room2", null, t);
  ok("mid-fade both pictures are in use", same(d.backdropsInUse().sort(), ["room", "room2"]));
  settle();
  d.step(t);
  ok("after the fade only the new one is", same(d.backdropsInUse(), ["room2"]));

  // A timed change (Theatre's cut) relights the cast with the picture, not on receipt.
  d.setBackdrop("dimA", { lum: 0.1, floorColor: [0.1, 0.1, 0.1], aspect: 16 / 9 }, t, { immediate: true });
  d.step(t);
  d.setBackdrop("dimB", { lum: 0.5, floorColor: [0.5, 0.5, 0.5], aspect: 4 / 3 }, t, { delayMs: 700, durationMs: 240 });
  const before = d.step(t + 300);
  ok("before the cue's beat the cast is still lit by the room being left", before.envFrom?.key === "dimA" && before.envFrom.mix === 1 && Math.abs(before.roomLum - 0.1) < 1e-9 && Math.abs(before.floor.color[0] - 0.1) < 1e-9);
  const mid = d.step(t + 820);
  ok("during the beat the two rooms cross-fade", mid.envFrom && mid.envFrom.mix > 0 && mid.envFrom.mix < 1 && mid.roomLum > 0.1 && mid.roomLum < 0.5 && finiteDeep(mid.envFrom.map));
  const after = d.step(t + 1000);
  ok("after the beat only the new room lights the cast", after.envFrom === null && Math.abs(after.roomLum - 0.5) < 1e-9);
  const gl = stripComments(read(`${FEAT}/render/gl.mjs`));
  ok("the renderer reads the room being left", /frame\.envFrom/.test(gl));
}

/* ── Timing: a cue lands together on every client ──────────────────────── */
section = "timing";
{
  ok("no option, no timing", T.resolveTweenTiming(null, 1000) === null);
  ok("on time: the remaining delay", same(T.resolveTweenTiming({ at: 1000, delayMs: 500, durationMs: 900 }, 1200), { delayMs: 300, durationMs: 900 }));
  ok("late within the tween: finish in what is left", same(T.resolveTweenTiming({ at: 1000, delayMs: 0, durationMs: 900 }, 1400), { delayMs: 0, durationMs: 500 }));
  ok("past the end: snap", same(T.resolveTweenTiming({ at: 1000, delayMs: 0, durationMs: 900 }, 3000), { delayMs: 0, immediate: true }));
  ok("a broken clock is clamped", T.resolveTweenTiming({ at: 0, delayMs: 1e9 }, 0).delayMs === T.MAX_DELAY_MS);
}

/* ── Store: the light is a forced replacement ──────────────────────────── */
section = "store";
{
  const store = await imp(`${FEAT}/store.mjs`);
  const frag = store.lightUpdateData({ mood: "night", rim: 1.5 });
  const keys = Object.keys(frag);
  ok("v13 form: the light is written with the == replace operator", keys.length === 1 && /\.==light$/.test(keys[0]) && keys[0].startsWith("flags."));
  ok("the written light is complete", same(Object.keys(Object.values(frag)[0]).sort(), Object.keys(R.DEFAULT_LIGHT).sort()));
  ok("tween options carry the stamp under TWEEN_OPTION", T.TWEEN_OPTION in store.tweenUpdateOptions({ at: 5, delayMs: 10 }));
  const all = walk(FEAT).filter((f) => /\.m?js$/.test(f));
  const writers = all.filter((f) => f !== `${FEAT}/store.mjs` && f !== `${FEAT}/settings.mjs`).filter((f) => /game\.settings\.set\(|\bset\(KEY\.|scene\.update\(|\.setFlag\(/.test(stripComments(read(f))));
  ok("nothing but the store writes Stage's values", writers.length === 0, writers.join(", "));
  const channel = stripComments(read(`${FEAT}/channel.mjs`));
  ok("gestures are honoured only from an attested GM", /meta\?\.attested/.test(channel) && /isGM/.test(channel));
  ok("gestures ride the suite socket", /from "\.\.\/\.\.\/core\/socket\.mjs"/.test(channel) && !/game\.socket/.test(channel));
}

/* ── Host: the frame clock and the surface registry ────────────────────── */
section = "host";
{
  const host = stripComments(read(`${FEAT}/overlay.mjs`));
  ok("sheds on the suite's frame clock", /Budget\.ladder\(\s*FEATURE_ID\s*,\s*SHED_ORDER/.test(host));
  ok("registers its WebGL context with Surfaces", /Surfaces\.register\(/.test(host));
  ok("asks the surface before every GL draw", /this\.surface\.use\(\)/.test(host));
  ok("claims motion while it animates", /Budget\.claimMotion\(FEATURE_ID/.test(host));
  ok("a released context is rebuilt on a fresh canvas", /cloneNode\(\)/.test(host));
  // Releasing blanks the canvas, and a still stage draws no frame to rebuild it.
  ok("the surface holds while the stage shows a picture", /holds:\s*\(\)\s*=>\s*!!this\.gl\?\.showing/.test(host));
  const { Budget } = await imp("scripts/core/budget.mjs");
  const { Surfaces } = await imp("scripts/core/gl-surfaces.mjs");
  Budget.setPolicy({ glRelease: 1 });
  const released = [];
  const make = (id, holds) => {
    const s = Surfaces.register({ id, element: () => null, release: () => released.push(id), restore() {}, holds });
    s.use();
    s._lastUse -= 5000;
    return s;
  };
  let showing = true;
  const still = make("still", () => showing);
  make("empty", () => false);
  make("legacy");
  Surfaces._sweep();
  ok("the idle sweep keeps a surface that holds a picture", !released.includes("still") && !still.released);
  ok("the idle sweep releases a surface that holds nothing", released.includes("empty"));
  ok("a surface without holds() is released as before", released.includes("legacy"));
  showing = false;
  Surfaces._sweep();
  ok("the stage is released once it shows nothing", released.includes("still") && still.released);
  Surfaces._reset();
  Budget.setPolicy(null);
  ok("relight timing is read from the update options", /resolveTweenTiming\(options\?\.\[TWEEN_OPTION\]/.test(host));
  const adapter = stripComments(read(`${FEAT}/index.mjs`));
  ok("the adapter registers no hooks at import", !/Hooks\.on/.test(adapter));
  const main = stripComments(read(`${FEAT}/main.mjs`));
  for (const name of ["gradeUpdateData", "tweenUpdateOptions", "gradeFromSrc", "readSceneGrade", "TWEEN_OPTION"]) ok(`the api carries ${name} (Theatre's bridge)`, main.includes(name));
  ok("main.mjs registers hooks only inside onInit/onReady", !/^Hooks\.on/m.test(main));
}

/* ── Purity: what the preview drives must not read the world ───────────── */
section = "purity";
{
  const pure = [
    ...walk(`${FEAT}/render`), ...walk(`${FEAT}/light`), ...walk(`${FEAT}/comms`),
    `${FEAT}/director.mjs`, `${FEAT}/model.mjs`, `${FEAT}/stage-dom.mjs`, `${FEAT}/timing.mjs`,
  ].filter((f) => /\.m?js$/.test(f) && existsSync(join(ROOT, f)));
  for (const f of pure) {
    const src = stripComments(read(f)).replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, "''");
    // A name the file declares itself (a `canvas` parameter) is not the global.
    const local = (g) => new RegExp(`\\b(?:const|let|var)\\s+${g}\\b|[(,]\\s*${g}\\s*[,)=]`).test(src);
    const bad = ["game", "canvas", "Hooks", "foundry", "ui"].filter((g) => !local(g) && new RegExp(`(^|[^.\\w$])${g}\\s*[.?\\[]`).test(src));
    ok(`${f} reads no Foundry global`, bad.length === 0, bad.join(", "));
  }
  for (const f of walk(FEAT).filter((x) => /\.m?js$/.test(x))) {
    ok(`${f}: no prefers-reduced-motion`, !/prefers-reduced-motion/.test(read(f)));
    ok(`${f}: never touches game.socket`, !/game\.socket/.test(stripComments(read(f))));
  }
}

/* ── CSS: the design system's non-negotiables ──────────────────────────── */
section = "css";
{
  const sheets = ["styles/stage.css", "styles/stage-comms.css", "styles/stage-director.css"].filter((f) => existsSync(join(ROOT, f)));
  const manifest = JSON.parse(read("module.json"));
  for (const f of sheets) ok(`${f} is loaded by module.json`, manifest.styles.includes(f));
  ok("no old Stage stylesheet is still listed", !manifest.styles.some((s) => /stage-(main|animations|postfx)\.css/.test(s)));
  for (const f of sheets) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, "");
    ok(`${f}: no raw white rgba veil`, !/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(css));
    ok(`${f}: no network @import`, !/@import\s+url\(\s*['"]?http/.test(css));
    ok(`${f}: no @font-face`, !/@font-face/.test(css));
    ok(`${f}: no prefers-reduced-motion`, !/prefers-reduced-motion/.test(css));
    const bad = [...css.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/g)].map((m) => m[1]).filter((n) => !n.startsWith("glstage-"));
    ok(`${f}: every keyframe is glstage- prefixed`, bad.length === 0, bad.join(", "));
    const self = [...css.matchAll(/(--[A-Za-z0-9-]+)\s*:\s*var\(\s*\1\s*[,)]/g)].map((m) => m[1]);
    ok(`${f}: no self-referential custom property`, self.length === 0, self.join(", "));
    const redeclared = [...css.matchAll(/(^|[;{\s])(--gl-[A-Za-z0-9-]+)\s*:/g)].map((m) => m[2]).filter((v) => v !== "--gl-accent");
    ok(`${f}: redeclares no foundation token`, redeclared.length === 0, [...new Set(redeclared)].join(", "));
    const blurs = [...css.matchAll(/backdrop-filter\s*:\s*([^;]+);/g)].map((m) => m[1]).filter((v) => /blur\(/.test(v) && !/var\(--gl-blur/.test(v) && !/--gl-glass-k/.test(v));
    ok(`${f}: backdrop blurs follow the player's glass tier`, blurs.length === 0, blurs.join(" | "));
    // Split selector lists on top-level commas only (`:is(a, b)` is one selector).
    const splitTop = (s) => { const out = []; let depth = 0, cur = ""; for (const ch of s) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { out.push(cur); cur = ""; } else cur += ch; } out.push(cur); return out; };
    const sel = [...css.matchAll(/(^|[{}])\s*([^{}@;]+)\{/g)].map((m) => m[2].trim()).filter((s) => s && !/^(from|to|[\d.]+%)(\s*,\s*[\d.]+%)*$/.test(s));
    const stray = sel.flatMap(splitTop).map((s) => s.trim()).filter((s) => s && !/glstage/.test(s));
    ok(`${f}: every rule is under a glstage- class`, stray.length === 0, stray.slice(0, 5).join(" | "));
  }
}

/* ── i18n: every key, literal and built at runtime, resolves ───────────── */
section = "i18n";
{
  const lang = JSON.parse(read("lang/stage.en.json"));
  const en = JSON.parse(read("lang/en.json"));
  const resolve = (key) => {
    if (key in en) return en[key];
    return key.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), lang);
  };
  const files = [...walk(FEAT), ...walk("templates/stage")].filter((f) => /\.(m?js|hbs)$/.test(f));
  const literal = new Set();
  const dynamic = new Set();
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/["'`](GLSTAGE\.[A-Za-z0-9_.]+[A-Za-z0-9_])["'`]/g)) literal.add(m[1]);
    for (const m of src.matchAll(/`(GLSTAGE\.[A-Za-z0-9_.]*)\$\{/g)) dynamic.add(m[1]);
    for (const m of src.matchAll(/\{\{\s*localize\s+"(GLSTAGE\.[A-Za-z0-9_.]+)"/g)) literal.add(m[1]);
  }
  for (const k of literal) ok(`${k} resolves`, typeof resolve(k) === "string");
  // A runtime-built family must cover the whole set it is built from.
  const families = {
    mood: R.MOODS, moods: R.MOODS, reaction: M.REACTIONS, reactions: M.REACTIONS, react: M.REACTIONS,
    dial: Object.keys(R.LIGHT_DIALS), dials: Object.keys(R.LIGHT_DIALS),
    shot: M.SHOTS, cut: M.CUTS, nameplates: M.NAMEPLATES, nameplate: M.NAMEPLATES,
    edge: M.COMMS_EDGES, align: M.COMMS_ALIGN, style: M.COMMS_STYLES,
  };
  for (const prefix of dynamic) {
    const obj = resolve(prefix.replace(/\.$/, ""));
    ok(`${prefix}* exists`, obj && typeof obj === "object");
    const leaf = prefix.replace(/\.$/, "").split(".").pop();
    const list = families[leaf];
    if (list && obj) for (const v of list) ok(`${prefix}${v} resolves`, typeof obj[v] === "string" || typeof obj[v]?.label === "string" || typeof obj[v]?.name === "string");
  }
  ok("the feature's title and hint resolve", typeof en["GLS.feature.stage.title"] === "string" && typeof en["GLS.feature.stage.hint"] === "string");
}

console.log(`\nstage-check: ${problems} problem(s), ${passed} assertion(s) passed.`);
process.exit(problems ? 1 : 0);
