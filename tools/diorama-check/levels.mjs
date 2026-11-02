/**
 * v14 Levels (terrain/levels.mjs, view/levels.mjs, the per-Level store, live
 * cache, rules contexts and the stacked view).
 *
 * Everything here fails silently: a token read against the wrong floor's
 * ground floats or sinks by a storey, an eye that keeps its Level's base sees
 * over every wall, a floor above the viewed one covers the board, a token on a
 * cut-away floor leaks to a player, and a single-Level world that picked up a
 * base offset moves every figure it has. The single-Level regression below is
 * the one that has to hold for every old world.
 */

import { readFileSync } from "node:fs";

const DIO = "scripts/features/diorama";

/** A v14-shaped Level collection (get + values + contents). */
function collection(docs) {
  const m = new Map(docs.map((d) => [d.id, d]));
  return { get: (id) => m.get(id), values: () => m.values(), contents: [...m.values()], get size() { return m.size; } };
}

export default async function check(ctx) {
  const read = (rel) => readFileSync(new URL(ctx.url(rel)), "utf8");
  const { SUITE_ID } = await import(ctx.url("scripts/core/const.mjs"));
  const C = await import(ctx.url(`${DIO}/constants.mjs`));
  const { Terrain } = await import(ctx.url(`${DIO}/terrain/model.mjs`));
  const L = await import(ctx.url(`${DIO}/terrain/levels.mjs`));
  const V = await import(ctx.url(`${DIO}/view/levels.mjs`));
  const Store = await import(ctx.url(`${DIO}/terrain/store.mjs`));
  const { propsUpdate } = await import(ctx.url(`${DIO}/terrain/props-store.mjs`));
  const Live = await import(ctx.url(`${DIO}/terrain/live.mjs`));
  const Mv = await import(ctx.url(`${DIO}/foundry/movement.mjs`));
  const Inst = await import(ctx.url(`${DIO}/foundry/install.mjs`));
  const Cov = await import(ctx.url(`${DIO}/foundry/cover.mjs`));
  const Sb = await import(ctx.url(`${DIO}/foundry/sight-backend.mjs`));
  const Cx = await import(ctx.url(`${DIO}/foundry/context.mjs`));
  const { wallsOnLevel } = await import(ctx.url(`${DIO}/view/level-view.mjs`));
  const { readDifficult } = await import(ctx.url(`${DIO}/editor/difficult.mjs`));
  const { backgroundSrc } = await import(ctx.url(`${DIO}/editor/sample.mjs`));

  const lv = (id, bottom, top, extra = {}) => ({ id, name: id, sort: 0, elevation: { bottom, top }, background: { src: `${id}.webp` }, visibility: { levels: new Set() }, ...extra });

  // ── resolving the Level in question ──
  const three = { levels: collection([lv("A", 0, 10), lv("B", 10, 20), lv("C", 20, null)]), initialLevel: { id: "A" }, _view: "B" };
  ctx.ok("an asked-for Level the scene holds wins", L.resolveLevelId(three, "C") === "C" && L.resolveLevelId(three, { id: "A" }) === "A");
  ctx.ok("an unknown asked-for Level falls back to the viewed one", L.resolveLevelId(three, "Z") === "B");
  ctx.ok("no Level asked: the viewed one", L.resolveLevelId(three) === "B");
  ctx.ok("nothing viewed: the initial Level", L.resolveLevelId({ ...three, _view: null }) === "A");
  ctx.ok("no Levels at all: the default key", L.resolveLevelId({}) === L.DEFAULT_LEVEL && L.DEFAULT_LEVEL === "default");
  ctx.ok("a scene with no Level collection takes the asked id as is", L.resolveLevelId({ initialLevel: { id: "L1" } }, "X") === "X");
  ctx.ok("a token's Level is its stored level", L.tokenLevelId({ _source: { level: "B" }, level: "A" }) === "B"
    && L.tokenLevelId({ document: { level: "C" } }) === "C" && L.tokenLevelId({}) === null);
  ctx.ok("the store's levelIdOf is that resolution", Store.levelIdOf(three) === "B" && Store.levelIdOf(three, "C") === "C");

  // ── bases ──
  ctx.ok("a Level's base is its bottom", L.baseOfLevel(lv("x", 15, 30)) === 15);
  ctx.ok("an open bottom: min(top, 0), as v14 prepares it", L.baseOfLevel(lv("x", null, 10)) === 0 && L.baseOfLevel(lv("x", null, -10)) === -10
    && L.baseOfLevel(lv("x", null, null)) === 0);
  ctx.ok("a prepared base is read as is", L.baseOfLevel({ elevation: { base: 7, bottom: 3 } }) === 7);
  ctx.ok("a multi-Level scene lifts a Level by its base", L.levelBaseDist(three, "B") === 10 && L.levelBaseDist(three, "C") === 20
    && L.levelBaseQ(three, "B", 5) === 8);
  const single = { levels: collection([lv("S", 25, null)]), initialLevel: { id: "S" } };
  ctx.ok("a one-Level scene has base 0 whatever its Level says", L.levelBaseDist(single) === 0 && L.levelBaseDist(single, "S") === 0
    && L.levelBaseDist({}) === 0);
  const order = L.levelsOf({ levels: collection([lv("hi", 20, null), lv("lo", null, 0), lv("mid2", 10, 20, { sort: 2 }), lv("mid1", 10, 20, { sort: 1 })]) }).map((l) => l.id);
  ctx.ok("levelsOf: lowest base first, then sort, then id", order.join(",") === "lo,mid1,mid2,hi", order.join(","));

  // ── frames ──
  const t = Terrain.blank(3, 3, (i, j) => !(i === 2 && j === 2));
  t.set(0, 0, { h: 6 });
  ctx.ok("shiftTerrain 0 returns the same terrain", L.shiftTerrain(t, 0) === t && L.shiftTerrain(null, 4) === null);
  const st = L.shiftTerrain(t, 8);
  const voidK = t.idx(4, 4);
  ctx.ok("shiftTerrain lifts every live sub-cell and leaves the source alone",
    st !== t && st.h[t.idx(0, 0)] === 14 && st.h[t.idx(1, 1)] === 8 && t.h[t.idx(0, 0)] === 6);
  ctx.ok("shiftTerrain leaves void as void, unlifted", (st.kind[voidK] & 0x0f) === C.KIND.VOID && st.h[voidK] === t.h[voidK]);
  const ps = [{ id: "p1", base: 1, blocks: true }];
  ctx.ok("shiftPropStates with nothing to change returns the same array", L.shiftPropStates(ps) === ps);
  const sp = L.shiftPropStates(ps, { dCells: 2, tag: "B", blocks: false });
  ctx.ok("shiftPropStates lifts, tags and stops a lower floor's props blocking",
    sp[0].id === "B:p1" && sp[0].base === 3 && sp[0].blocks === false && ps[0].base === 1 && ps[0].id === "p1");

  // ── the stack plan ──
  const vis = (ids) => ({ visibility: { levels: new Set(ids) } });
  const tower = L.levelsOf({ levels: collection([
    lv("G", null, 0), lv("F1", 0, 10), lv("F2", 10, 20), lv("F3", 20, 30, vis(["F1", "G"])), lv("F4", 30, 40), lv("F5", 40, 50), lv("F6", 50, 60), lv("F7", 60, null),
  ]) });
  const pp = V.stackPlan(tower, "F3", { gm: false });
  ctx.ok("a player sees only the floors the viewed Level lists", pp.below.map((l) => l.id).join(",") === "G,F1" && pp.below.every((l) => !l.ghost), pp.below.map((l) => l.id).join(","));
  ctx.ok("every Level above the viewed one is cut", ["F4", "F5", "F6", "F7"].every((id) => pp.cut.has(id)) && !pp.cut.has("F3") && pp.cut.size === 4);
  const gp = V.stackPlan(tower, "F3", { gm: true });
  ctx.ok("the GM also gets the unlisted floors, as ghosts", gp.below.map((l) => `${l.id}${l.ghost ? "~" : ""}`).join(",") === "G,F1,F2~", gp.below.map((l) => l.id).join(","));
  ctx.ok("the dim falls per floor down, and more for a ghost",
    Math.abs(gp.below.find((l) => l.id === "F2").dim - V.BELOW_DIM * V.GHOST_DIM) < 1e-9
    && Math.abs(gp.below.find((l) => l.id === "F1").dim - V.BELOW_DIM ** 2) < 1e-9);
  const top = V.stackPlan(tower, "F7", { gm: true });
  ctx.ok("at most MAX_BELOW floors, the nearest ones", top.below.length === V.MAX_BELOW && top.below[top.below.length - 1].id === "F6" && top.below[0].id === "F3", top.below.map((l) => l.id).join(","));
  ctx.ok("a one-Level plan draws nothing below and cuts nothing", (() => {
    const p = V.stackPlan(L.levelsOf(single), "S", { gm: true });
    return p.viewed?.id === "S" && !p.below.length && !p.cut.size;
  })());
  const same = V.stackPlan(L.levelsOf({ levels: collection([lv("a", 0, 10), lv("b", 0, 10)]) }), "a", { gm: true });
  ctx.ok("a Level at the same base is treated as above", same.cut.has("b") && !same.below.length);
  ctx.ok("planKey changes with the stack and not otherwise",
    V.planKey(pp) === V.planKey(V.stackPlan(tower, "F3", { gm: false })) && V.planKey(pp) !== V.planKey(gp) && V.planKey({ viewed: null }) === "");

  // ── tokens on cut floors ──
  const toks = [{ id: "a" }, { id: "b" }, { id: "c", ghost: true }];
  const levelOf = (id) => ({ a: "F3", b: "F5", c: "F6" })[id];
  const asPlayer = V.cutTokens(toks, levelOf, pp.cut, { gm: false });
  ctx.ok("a player's view drops a token on a cut-away floor", asPlayer.length === 1 && asPlayer[0].id === "a");
  const asGM = V.cutTokens(toks, levelOf, pp.cut, { gm: true });
  ctx.ok("the GM sees it as a ghost", asGM.length === 3 && asGM[1].ghost === true && toks[1].ghost === undefined);
  ctx.ok("nothing cut: the same array", V.cutTokens(toks, levelOf, new Set(), { gm: false }) === toks);

  // ── renderer inputs ──
  const tA = Terrain.blank(2, 2);
  const inputs = V.levelInputs(gp, (id) => (id === "F2" ? null : tA), (id) => (id === "G" ? "img" : undefined), { x: 0, y: 0, width: 1, height: 1 });
  ctx.ok("levelInputs: one entry per floor with ground, lowest first, with its dim and art",
    inputs.map((i) => i.id).join(",") === "G,F1" && inputs[0].image === "img" && inputs[1].image === null && inputs[0].dim === gp.below[0].dim && inputs[0].terrain === tA);

  // ── walls per Level ──
  const wst = [{ id: "w1" }, { id: "w2" }, { id: "w3" }];
  const wdocs = { w1: { includedInLevel: (id) => id === "F3" }, w2: { includedInLevel: () => true }, w3: null };
  ctx.ok("only the viewed Level's walls stand in the view", wallsOnLevel(wst, (id) => wdocs[id], "F3").length === 3
    && wallsOnLevel(wst, (id) => wdocs[id], "F2").map((w) => w.id).join(",") === "w2,w3");
  ctx.ok("no Level: every wall, the same array", wallsOnLevel(wst, (id) => wdocs[id], null) === wst);

  // ── the stores write one Level ──
  const tu = Store.terrainUpdate(three, Terrain.blank(2, 2), "C");
  const tk = Object.keys(tu);
  ctx.ok("a terrain write is a forced replacement of the asked Level's entry",
    tk.length === 1 && tk[0] === `flags.${SUITE_ID}.${C.FLAG_TERRAIN}.levels.==C`, tk.join(","));
  ctx.ok("a terrain write with no Level goes to the viewed one", Object.keys(Store.terrainUpdate(three, Terrain.blank(2, 2)))[0].endsWith("levels.==B"));
  const pu = Object.keys(propsUpdate(three, [], "A"));
  ctx.ok("a props write goes to the asked Level", pu.length === 1 && pu[0].endsWith(`${C.FLAG_PROPS}.levels.==A`), pu.join(","));

  // ── the live cache, per Level ──
  let sceneN = 0;
  const makeScene = (levels, flags, extra = {}) => ({
    id: `lvscene${++sceneN}`,
    grid: { type: 1, size: 100, distance: 5, units: "ft" },
    dimensions: { columns: 4, rows: 4, size: 100, distance: 5, width: 400, height: 400, sceneRect: { x: 0, y: 0, width: 400, height: 400 } },
    levels: levels ? collection(levels) : undefined,
    initialLevel: levels ? { id: levels[0].id } : null,
    getFlag: (s, k) => (s === SUITE_ID && k === C.FLAG_TERRAIN ? flags : undefined),
    walls: [], regions: [], tokens: [],
    ...extra,
  });
  const hill = Terrain.blank(4, 4);
  for (let a = 0; a < C.SUB; a++) for (let b = 0; b < C.SUB; b++) hill.set(a, b, { h: 4 });   // cell (0,0) one cell up
  const flatT = Terrain.blank(4, 4);
  const multi = makeScene([lv("down", null, 10), lv("up", 10, null)], { levels: { down: hill.toJSON(), up: hill.toJSON() } }, { _view: "down" });
  const ld = Live.liveTerrain(multi, "down"), lu = Live.liveTerrain(multi, "up");
  ctx.ok("each Level has its own live entry and base", ld && lu && ld !== lu && ld.levelId === "down" && lu.levelId === "up"
    && ld.base === 0 && lu.base === 10 && lu.baseQ === 8);
  ctx.ok("the default live entry is the viewed Level's", Live.liveTerrain(multi) === ld);
  ctx.ok("ground is absolute: the token's own Level plus its base",
    Mv.groundDistAt(multi, 0, 0, 1, 1, "down") === 5 && Mv.groundDistAt(multi, 0, 0, 1, 1, "up") === 15 && Mv.groundDistAt(multi, 200, 200, 1, 1, "up") === 10);
  ctx.ok("absolute() lifts the upper floor for the view", lu.absolute().ground.topAt(0, 0) === 12 && lu.ground.topAt(0, 0) === 4);
  ctx.ok("localQ takes the base back off", Cx.localQ(lu, 15) === 4 && Cx.localQ(ld, 5) === 4);
  Live.invalidate(multi);
  ctx.ok("invalidate drops every Level of the scene", Live.liveTerrain(multi, "up") !== lu && Live.liveTerrain(multi, "down") !== ld);

  // ── single-Level regression: an old world behaves exactly as before ──
  const old = makeScene(null, { levels: { default: hill.toJSON() } });
  const lo = Live.liveTerrain(old);
  ctx.ok("a scene with no Levels reads its 'default' terrain at base 0", lo?.levelId === "default" && lo.base === 0 && lo.baseQ === 0 && lo.saved);
  ctx.ok("its absolute() frame is the same terrain objects", lo.absolute().terrain === lo.terrain && lo.absolute().ground === lo.ground);
  ctx.ok("its ground is unchanged", Mv.groundDistAt(old, 0, 0) === 5 && Mv.groundDistAt(old, 200, 200) === 0);
  const one = makeScene([lv("only", 30, null)], { levels: { only: hill.toJSON() } });
  const l1 = Live.liveTerrain(one);
  ctx.ok("a one-Level v14 scene keys on its Level and never lifts", l1?.levelId === "only" && l1.base === 0
    && Mv.groundDistAt(one, 0, 0) === 5 && l1.absolute().ground === l1.ground);

  // ── rules per Level ──
  const tokOn = (id, level, x, y, elevation) => ({ id, _source: { level, x, y, width: 1, height: 1, elevation }, level, flags: {}, getFlag: () => undefined, movementAction: "walk" });
  const tokens = [tokOn("t1", "down", 0, 0, 0), tokOn("t2", "up", 0, 0, 10), tokOn("t3", "up", 200, 200, 10)];
  const liveOf = (id) => Live.liveTerrain(multi, id);
  const plans = Mv.planResync(tokens, liveOf, { levels: null });
  const elev = (id) => plans.find((p) => p.update._id === id)?.update.elevation;
  ctx.ok("a resync seats each token on its own Level's ground, absolute",
    elev("t1") === 5 && elev("t2") === 15 && plans.every((p) => p.update._id !== "t3"), JSON.stringify(plans.map((p) => p.update)));
  const onlyUp = Mv.planResync(tokens, liveOf, { levels: new Set(["up"]) });
  ctx.ok("a repaint of one Level re-seats only that Level's tokens", onlyUp.length === 1 && onlyUp[0].update._id === "t2");
  const flat = (x) => x === flatT;
  ctx.ok("levelsToResync: a Level that was or is active, and no other",
    [...Inst.levelsToResync(["a", "b", "c"], new Map([["a", hill], ["b", flatT]]), (id) => id === "c", flat)].sort().join(",") === "a,c");

  const lightPoly = { origin: { x: 50, y: 50, elevation: 20 }, config: { type: "light" } };
  ctx.ok("a light's eye loses its Level's base", Sb.polygonEyeQ(lightPoly, { terrain: hill, grid: { size: 100, distance: 5 }, baseQ: 8 }) === 8
    && Sb.polygonEyeQ(lightPoly, { terrain: hill, grid: { size: 100, distance: 5 }, baseQ: 0 }) === 16);
  ctx.ok("a sound polygon gets no eye", Sb.polygonEyeQ({ origin: {}, config: { type: "sound" } }, { terrain: hill, grid: { size: 100, distance: 5 } }) === null);
  ctx.ok("cover is read only between tokens on one Level", Cov.sharedLevel({ level: "a" }, { level: "b" }) === undefined
    && Cov.sharedLevel({ level: "a" }, { level: "a" }) === "a" && Cov.sharedLevel({}, { level: "a" }) === "a" && Cov.sharedLevel({}, {}) === null);

  // ── editor ──
  const regions = [
    { id: "r1", getFlag: () => ({ cells: ["0.0"], difficulty: 2 }), includedInLevel: (id) => id === "up" },
    { id: "r2", getFlag: () => ({ cells: ["1.1"], difficulty: 3 }), includedInLevel: () => true },
    { id: "r3", getFlag: () => null, includedInLevel: () => true },
  ];
  ctx.ok("readDifficult keeps a Level's own regions and the all-Level ones",
    readDifficult({ regions }, "down").map((r) => r.id).join(",") === "r2" && readDifficult({ regions }, "up").length === 2
    && readDifficult({ regions }).length === 2);
  ctx.ok("the editor samples the edited Level's own art in a multi-Level scene",
    backgroundSrc(multi, "up") === "up.webp" && backgroundSrc(multi) === "down.webp");
  ctx.ok("a one-Level scene samples its art as before", backgroundSrc({ initialLevel: { background: { src: "l.webp" } }, background: { src: "s.webp" } }) === "l.webp");

  const lang = JSON.parse(read("lang/diorama-editor.en.json"));
  const get = (k) => k.split(".").reduce((o, p) => o?.[p], lang) ?? lang[k];
  const keys = ["GLDIO.editor.titleLevel", "GLDIO.editor.level.label", "GLDIO.editor.level.saved", "GLDIO.editor.level.blank", "GLDIO.editor.level.mismatch"];
  const missing = keys.filter((k) => typeof get(k) !== "string");
  ctx.ok("every Level string the editor uses resolves", missing.length === 0, missing.join(", "));
  const hbs = read("templates/diorama/editor.hbs");
  ctx.ok("the editor's Level buttons call the level action", /data-action="level"/.test(hbs) && /data-level=/.test(hbs)
    && /level:\s*DioramaEditor\.#onLevel|level: [A-Za-z]+\.#onLevel/.test(read(`${DIO}/editor/app.mjs`)));

  // ── wiring a diff would not show ──
  const ov = read(`${DIO}/view/overlay.mjs`);
  ctx.ok("the view cuts tokens and draws the floors below", /cutTokens\(/.test(ov) && /setLevels\?\.\(/.test(ov) && /stackProps\(/.test(ov) && /wallsOnLevel\(/.test(ov));
  ctx.ok("the view draws terrain in the absolute frame", /\.absolute(\?\.)?\(\)/.test(ov));
  const main = read(`${DIO}/main.mjs`);
  ctx.ok("a Level change drops the cached terrain", ["createLevel", "updateLevel", "deleteLevel"].every((h) => main.includes(`"${h}"`)));
  const mv = read(`${DIO}/foundry/movement.mjs`);
  ctx.ok("a change of Level counts as a move", /"level"\]\.some/.test(mv));
  const pv = read(`${DIO}/editor/preview.mjs`);
  ctx.ok("the editor preview stacks the floors below the edited one", /setLevels\?\.\(/.test(pv) && /shiftTerrain\(/.test(pv));
  const stack = read(`${DIO}/render/level-stack.mjs`);
  ctx.ok("the stacked floors are pure render code", !/\b(game|canvas|foundry|ui|Hooks)\s*\./.test(stack.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
}
