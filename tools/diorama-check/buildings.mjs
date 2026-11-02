/**
 * Buildings: Foundry tiles as decals and roofs, roofs fading over the viewer's
 * figures, and the walk rules of bridges and arches (integrations/tiles.mjs,
 * render/tiles.mjs, render/roofs.mjs, view/roofs.mjs). docs/DIORAMA_BUILDINGS.md.
 *
 * Everything here fails silently: a decal placed off its anchor sits a square
 * away from the 2D tile; a mirrored tile drawn unmirrored reads as correct to
 * anyone who never saw the map; a hidden tile handed to a player is a secret
 * room drawn on their screen; a roof that opens for a goblin shows the room the
 * goblin is in; a roof the GM's cut-away opens on a player's screen gives away
 * every interior; a uniform nobody writes holds its first value forever; a
 * fade with no shed rung never degrades.
 */

import { readFileSync } from "node:fs";

const DIO = "scripts/features/diorama";
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const nearPt = (p, q, e = 1e-6) => near(p[0], q[0], e) && near(p[1], q[1], e);
const WORLD = /(?<![\w.$])(game|canvas|foundry|ui|Hooks|CONFIG)\s*\./;

export default async function check(ctx) {
  const read = (rel) => readFileSync(new URL(ctx.url(rel)), "utf8");
  const I = await import(ctx.url(`${DIO}/integrations/tiles.mjs`));
  const V = await import(ctx.url(`${DIO}/view/roofs.mjs`));
  const RF = await import(ctx.url(`${DIO}/render/roofs.mjs`));
  const RT = await import(ctx.url(`${DIO}/render/tiles.mjs`));
  const C = await import(ctx.url(`${DIO}/constants.mjs`));
  const O = await import(ctx.url(`${DIO}/options.mjs`));
  const G = await import(ctx.url(`${DIO}/render/glsl.mjs`));
  const { createShared } = await import(ctx.url(`${DIO}/render/materials.mjs`));
  const { Terrain } = await import(ctx.url(`${DIO}/terrain/model.mjs`));
  const P = await import(ctx.url(`${DIO}/terrain/props.mjs`));
  const THREE = await import(ctx.url(`${DIO}/render/three.mjs`));

  // ── Foundry's own numbers ──
  ctx.ok("OCC mirrors CONST.OCCLUSION_MODES (v14)", I.OCC.NONE === 0 && I.OCC.FADE === 1 && I.OCC.SURFACE === 2 && I.OCC.RADIAL === 4 && I.OCC.VISION === 8);
  ctx.ok("occlusionMask reads a Set, an array and an old number", I.occlusionMask(new Set([1, 4])) === 5 && I.occlusionMask([8]) === 8 && I.occlusionMask(2) === 2 && I.occlusionMask(null) === 0);
  ctx.ok("the tile mode is stored data: all, roofs, ground, off", I.TILE_MODES.join() === "all,roofs,ground,off" && I.normalizeTileMode("nonsense") === "all" && C.FLAG_TILES === "dio.tiles");

  // ── placement: the box (anchor, rotation) ──
  const box = I.tileBox({ x: 100, y: 100, width: 200, height: 100 });
  ctx.ok("tileBox: (x, y) is the anchor, centred by default", nearPt(box[0], [0, 50]) && nearPt(box[2], [200, 150]));
  const tl = I.tileBox({ x: 100, y: 100, width: 200, height: 100, anchorX: 0, anchorY: 0 });
  ctx.ok("tileBox: anchor 0,0 puts (x, y) at the top left", nearPt(tl[0], [100, 100]) && nearPt(tl[2], [300, 200]));
  const rot = I.tileBox({ x: 100, y: 100, width: 200, height: 100, rotation: 90 });
  ctx.ok("tileBox: rotation turns clockwise about the anchor", nearPt(rot[0], [150, 0], 1e-6) && nearPt(rot[2], [50, 200], 1e-6), JSON.stringify(rot));

  // ── placement: the art (fit, scale, mirroring) ──
  const base = { x: 100, y: 100, width: 100, height: 100, anchorX: 0.5, anchorY: 0.5, rotation: 0, scaleX: 1, scaleY: 1 };
  const fill = RT.tileQuad({ ...base, fit: "fill" }, 200, 100);
  ctx.ok("tileQuad fill: the art covers the box", nearPt(fill[0], [50, 50]) && nearPt(fill[2], [150, 150]));
  const contain = RT.tileQuad({ ...base, fit: "contain" }, 200, 100);
  ctx.ok("tileQuad contain: 2:1 art in a square keeps its shape inside", nearPt(contain[0], [50, 75]) && nearPt(contain[2], [150, 125]));
  const cover = RT.tileQuad({ ...base, fit: "cover" }, 200, 100);
  ctx.ok("tileQuad cover: 2:1 art in a square overflows its width", nearPt(cover[0], [0, 50]) && nearPt(cover[2], [200, 150]));
  const mir = RT.tileQuad({ ...base, fit: "fill", scaleX: -1 }, 100, 100);
  ctx.ok("tileQuad: a negative scaleX mirrors (u = 0 lands on the right)", nearPt(mir[0], [150, 50]) && nearPt(mir[1], [50, 50]));
  const flipV = RT.tileQuad({ ...base, fit: "fill", scaleY: -1 }, 100, 100);
  ctx.ok("tileQuad: a negative scaleY flips (v = 0 lands at the bottom)", nearPt(flipV[0], [50, 150]));
  const anch = RT.tileQuad({ ...base, anchorX: 0, anchorY: 0, rotation: 90, fit: "fill" }, 100, 100);
  ctx.ok("tileQuad turns about the anchor like tileBox", anch.every((p, i) => nearPt(p, I.tileBox({ ...base, anchorX: 0, anchorY: 0, rotation: 90 })[i])));

  // ── kind and mode ──
  ctx.ok("tileKind: no occlusion and below the Level top is ground", I.tileKind({ elevation: 0, mask: 0, levelTop: null }) === "ground" && I.tileKind({ elevation: 19, mask: 0, levelTop: 20 }) === "ground");
  ctx.ok("tileKind: any occlusion mode makes a roof", [I.OCC.FADE, I.OCC.RADIAL, I.OCC.VISION, I.OCC.SURFACE].every((m) => I.tileKind({ elevation: 0, mask: m }) === "roof"));
  ctx.ok("tileKind: at or above the Level top is a roof", I.tileKind({ elevation: 20, mask: 0, levelTop: 20 }) === "roof");
  const modeTable = [["all", "roof", true], ["all", "ground", true], ["roofs", "roof", true], ["roofs", "ground", false], ["ground", "ground", true], ["ground", "roof", false], ["off", "roof", false], ["off", "ground", false]];
  ctx.ok("modeAllows: the scene's tile mode table", modeTable.every(([m, k, want]) => I.modeAllows(m, k) === want));

  // ── roof height ──
  const house = [[1000, 200], [1400, 200], [1400, 600], [1000, 600]];
  const walls = [{ a: [1000, 200], b: [1400, 200], type: "wall", topQ: 18 }, { a: [0, 0], b: [100, 0], type: "wall", topQ: 40 }, { a: [1000, 400], b: [1000, 600], type: "invisible", topQ: 60 }];
  ctx.ok("wallTopUnder: the walls on the outline hold the roof, invisible ones do not", I.wallTopUnder(house, walls, 0) === 18);
  ctx.ok("roofHeightQ: on its walls when there are any", I.roofHeightQ({ elevationQ: 4, wallTopQ: 18, groundTopQ: 8 }) === 18);
  ctx.ok("roofHeightQ: else at its elevation, never below the ground plus a square", I.roofHeightQ({ elevationQ: 0, groundTopQ: 8 }) === 12 && I.roofHeightQ({ elevationQ: 20, groundTopQ: 0 }) === 20);

  // ── who gets a tile ──
  const doc = (o = {}) => ({ id: "t1", x: 1200, y: 400, width: 400, height: 400, rotation: 0, elevation: 0, alpha: 1, hidden: false, sort: 0, texture: { src: "a.webp", anchorX: 0.5, anchorY: 0.5, fit: "fill", scaleX: 1, scaleY: 1, tint: "#ffffff" }, occlusion: { modes: new Set([1]), alpha: 0.2 }, ...o });
  const st = (o, g) => I.tileStateOf(doc(o), { gmView: g, distance: 5, walls });
  ctx.ok("a hidden tile never reaches a player", st({ hidden: true }, false) === null);
  const ghost = st({ hidden: true }, true);
  ctx.ok("a hidden tile reaches the GM's own view as a ghost", !!ghost && ghost.ghost === true);
  ctx.ok("a tile with no art, no alpha or no size is dropped", st({ texture: { src: "" } }, true) === null && st({ alpha: 0 }, true) === null && st({ width: 0 }, true) === null);
  const roof = st({}, false);
  ctx.ok("a FADE tile is a roof on its walls, with its occluded alpha", roof?.kind === "roof" && roof.roofQ === 18 && near(roof.occludedAlpha, 0.2) && roof.mask === 1);
  ctx.ok("the scene's mode filters a kind out", I.tileStateOf(doc(), { gmView: true, distance: 5, mode: "ground" }) === null);

  // readTiles end to end, with a fake scene: hidden tiles and view-as-players
  const scene = {
    tiles: [doc({ id: "a" }), doc({ id: "b", hidden: true }), doc({ id: "c", occlusion: { modes: new Set(), alpha: 0 }, elevation: 0 })],
    getFlag: () => undefined, levels: null,
  };
  const grid = { size: 100, distance: 5 };
  const ids = (o) => I.readTiles({ scene, grid, walls, ...o }).map((s) => s.id).sort().join();
  ctx.ok("readTiles: a player gets no hidden tile", ids({ isGM: false, asPlayers: false }) === "a,c");
  ctx.ok("readTiles: the GM viewing as players gets no hidden tile", ids({ isGM: true, asPlayers: true }) === "a,c");
  ctx.ok("readTiles: the GM's own view gets it, ghosted", ids({ isGM: true, asPlayers: false }) === "a,b,c"
    && I.readTiles({ scene, grid, walls, isGM: true }).find((s) => s.id === "b")?.ghost === true);
  ctx.ok("readTiles: a scene with tiles off draws none", I.readTiles({ scene: { ...scene, getFlag: () => "off" }, grid, isGM: true }).length === 0);

  // ── the roof-fade table ──
  const tile = (mask, occludedAlpha = 0.2) => ({ source: "tile", mask, occludedAlpha });
  const T = V.roofTarget;
  ctx.ok("GM cut-away: every roof thins in the GM's own view", T(tile(0), { gmView: true, cutaway: true }).alpha === V.ROOF_CUTAWAY_ALPHA && T({ source: "prop" }, { gmView: true, cutaway: true }).alpha === V.ROOF_CUTAWAY_ALPHA);
  ctx.ok("GM cut-away never opens a roof outside the GM's own view (players, view-as-players)", T(tile(0), { gmView: false, cutaway: true }).alpha === 1);
  ctx.ok("FADE: the whole roof to its occluded alpha while a viewer's figure is inside", near(T(tile(1), { inside: true }).alpha, 0.2) && T(tile(1), { inside: false }).alpha === 1);
  ctx.ok("RADIAL: a hole per figure under it, at most four, the roof itself shut", (() => {
    const r = T(tile(4), { holes: Array.from({ length: 6 }, (_, i) => ({ x: i, z: 0, r: 0.5 })) });
    return r.alpha === 1 && r.holes.length === V.MAX_HOLES && V.MAX_HOLES === RT.ROOF_HOLES;
  })());
  ctx.ok("VISION with a sight bake: opens where the viewer sees", T(tile(8), { visionMap: true, below: true, inside: true }).vision === true && T(tile(8), { visionMap: true, below: true, inside: true }).alpha === 1);
  ctx.ok("VISION without one (the GM): fades like FADE", near(T(tile(8), { visionMap: false, inside: true }).alpha, 0.2) && T(tile(8), { visionMap: false, inside: true }).vision === false);
  ctx.ok("no occlusion mode: never opens for a figure", T(tile(0), { inside: true, below: true, holes: [{ x: 0, z: 0, r: 1 }] }).alpha === 1);
  ctx.ok("a prop roof: open over a viewer's figure inside, shut otherwise", T({ source: "prop" }, { inside: true }).alpha === V.PROP_ROOF_OPEN && T({ source: "prop" }, { inside: false }).alpha === 1);
  ctx.ok("underRoof: inside the outline and below the top", V.underRoof({ x: 1, z: 1, footY: 0 }, [[0, 0], [2, 0], [2, 2], [0, 2]], 3) && !V.underRoof({ x: 1, z: 1, footY: 3 }, [[0, 0], [2, 0], [2, 2], [0, 2]], 3) && !V.underRoof({ x: 3, z: 1, footY: 0 }, [[0, 0], [2, 0], [2, 2], [0, 2]], 3));
  const pr = V.propOutline({ x: 5, y: 5, w: 2, d: 1, rot: 90 });
  ctx.ok("propOutline turns like terrain/props.mjs localOf", nearPt(pr[0], [5.5, 4], 1e-9) && nearPt(pr[2], [4.5, 6], 1e-9), JSON.stringify(pr));

  // ── whose figures open a roof (viewerTokens, against a fake canvas) ──
  const tok = (id, o) => ({ id, center: { x: 150, y: 150 }, document: { elevation: 0, hidden: false, isOwner: false, ...o.doc }, actor: { hasPlayerOwner: !!o.pc }, controlled: !!o.controlled, externalRadius: 50 });
  const placeables = [tok("gmSel", { controlled: true }), tok("pc", { pc: true, doc: { isOwner: true } }), tok("pcHidden", { pc: true, doc: { isOwner: true, hidden: true } }), tok("goblin", {})];
  const had = Object.prototype.hasOwnProperty.call(globalThis, "canvas"), was = globalThis.canvas;
  globalThis.canvas = { tokens: { placeables } };
  try {
    const who = (o) => V.viewerTokens({ grid, ...o }).map((v) => v.token.id).sort().join();
    ctx.ok("viewer figures, GM: the selected token only", who({ isGM: true, asPlayers: false }) === "gmSel");
    ctx.ok("viewer figures, view as players: player-owned and not hidden", who({ isGM: true, asPlayers: true }) === "pc");
    placeables[0].controlled = false;
    ctx.ok("viewer figures, a player: owned and not hidden (never a goblin)", who({ isGM: false, asPlayers: false }) === "pc");
  } finally {
    if (had) globalThis.canvas = was; else delete globalThis.canvas;
  }

  // ── what a player has seen of a roof ──
  const img = (w, h, px) => { const data = new Uint8ClampedArray(w * h * 4); for (const [x, y, r, g] of px) { const k = (y * w + x) * 4; data[k] = r; data[k + 1] = g; } return { data, width: w, height: h, x0: 0, y0: 0 }; };
  const sq = [[2, 2], [6, 2], [6, 6], [2, 6]];
  ctx.ok("roofSeen: never seen is 0", V.roofSeen(img(10, 10, []), sq, 1) === 0);
  ctx.ok("roofSeen: explored ground on its outline is 0.5", V.roofSeen(img(10, 10, [[3, 3, 0, 255]]), sq, 1) === 0.5);
  ctx.ok("roofSeen: seen now just outside its walls is 1", V.roofSeen(img(10, 10, [[6, 3, 255, 255]]), sq, 1) === 1);
  ctx.ok("roofSeen: seen ground far from it does not count", V.roofSeen(img(10, 10, [[9, 9, 255, 255]]), sq, 1) === 0);

  // ── the fader ──
  const C_DIR = { x: 0, y: 1, z: 0 };
  const f = new RF.RoofFader();
  const poly = [[0, 0], [2, 0], [2, 2], [0, 2]];
  f.set([{ id: "r", source: "tile", poly, baseY: 3, topY: 3, alpha: 0, holes: [], vision: false, open: 0, seen: 1 }], []);
  ctx.ok("a roof first seen starts at its target (opening the view plays no fade)", f.shown("r").alpha === 0);
  f.set([{ id: "r", source: "tile", poly, baseY: 3, topY: 3, alpha: 1, holes: [], vision: false, open: 0, seen: 1 }], []);
  f.frame(C.TIMING.roofFade / 1000, C_DIR, false);
  const a1 = f.shown("r").alpha;
  ctx.ok("the fade lands about 95% of the way in TIMING.roofFade", a1 > 0.9 && a1 < 1, String(a1));
  let moving = true, n = 0;
  while (moving && n++ < 200) moving = f.frame(1 / 60, C_DIR, false);
  ctx.ok("the fade settles exactly and stops asking for frames", f.shown("r").alpha === 1 && !moving && f.shown("r").opaque);
  f.set([{ id: "r", source: "tile", poly, baseY: 3, topY: 3, alpha: 0, holes: [], vision: false, open: 0, seen: 1 }], []);
  f.frame(1 / 60, C_DIR, true);
  ctx.ok("with roofFade shed, a roof snaps", f.shown("r").alpha === 0);
  const g = new RF.RoofFader();
  const dir = { x: -Math.SQRT1_2, y: Math.SQRT1_2, z: 0 };
  const shut = { id: "n", source: "tile", poly, baseY: 3, topY: 3, alpha: 1, holes: [], vision: false, open: 0, seen: 1 };
  g.set([shut], [{ x: 2.6, z: 1, footY: 0, headY: 1.5 }]);
  g.frame(1, dir, true);
  ctx.ok("a roof between the camera and a viewer's figure thins to ROOF_CAMERA_ALPHA", near(g.shown("n").alpha, RF.ROOF_CAMERA_ALPHA));
  g.set([shut], [{ x: 2.6, z: 1, footY: 3.5, headY: 5 }]);
  g.frame(1, dir, true);
  ctx.ok("a figure standing above the roof is not hidden by it", g.shown("n").alpha === 1);
  g.set([shut, { ...shut, id: "p", source: "prop", alpha: 0.4 }], []);
  ctx.ok("propAlphas carries the prop roofs only", [...g.propAlphas().keys()].join() === "p");
  ctx.ok("render/roofs.mjs allocates nothing per frame in its ray test", !/frame\([^)]*\)\s*\{[^}]*\bnew\s+[A-Z]/.test(read(`${DIO}/render/roofs.mjs`)));

  // ── the drape ──
  const flat = new Terrain({ cols: 4, rows: 4 });
  const q = RT.tileQuad({ ...base, x: 200, y: 200, width: 200, height: 200, fit: "fill" }, 1, 1);
  const g0 = RT.drapeGrid(q, { size: 100, elevY: 0, terrain: flat });
  ctx.ok("a decal on flat ground is two triangles", g0.nu === 1 && g0.nv === 1 && g0.idx.length === 6);
  const step = new Terrain({ cols: 4, rows: 4 });
  for (let si = 0; si < step.sh; si++) for (let sj = 4; sj < step.sw; sj++) step.h[step.idx(si, sj)] = 8;
  const g1 = RT.drapeGrid(q, { size: 100, elevY: 0, terrain: step });
  let ok1 = true;
  for (let k = 0; k < g1.pos.length / 3; k++) {
    const x = g1.pos[k * 3], y = g1.pos[k * 3 + 1];
    const want = (x > 2 + 1e-6 ? 2 : 0) + RT.DECAL_LIFT;
    if (!near(y, want, 1e-4)) ok1 = false;
  }
  ctx.ok("a decal across a step lies on each side, and takes the lower side on the edge", g1.nu > 1 && ok1);
  const g2 = RT.drapeGrid(q, { size: 100, elevY: 3, terrain: step });
  ctx.ok("a decal never sinks below its own elevation", [...Array(g2.pos.length / 3).keys()].every((k) => g2.pos[k * 3 + 1] >= 3));

  // ── the layer: programs and casting ──
  const shared = createShared();
  for (const roofFlag of [false, true]) {
    const m = RT.tileMaterial(shared, { roof: roofFlag });
    const declared = G.declaredUniforms(RT.TILE_VERT + RT.TILE_FRAG);
    const missing = declared.filter((u) => !m.uniforms[u] || !("value" in m.uniforms[u]));
    ctx.ok(`tile material ${roofFlag ? "roof" : "ground"}: every declared uniform has a value`, !missing.length, missing.join(", "));
    m.dispose();
  }
  const own = G.declaredUniforms(RT.TILE_FRAG).filter((u) => /^u(Tile|Roof)/.test(u));
  const tilesSrc = read(`${DIO}/render/tiles.mjs`);
  const unwritten = own.filter((u) => u !== "uTileRoof" && u !== "uTileTex" && !new RegExp(`u\\.${u}\\.value`).test(tilesSrc));
  ctx.ok("every tile uniform is written by the layer", !unwritten.length, unwritten.join(", "));
  ctx.ok("the tile shader goes through dioFinish and reads sight", /dioFinish\(/.test(RT.TILE_FRAG) && /visionAt\(/.test(RT.TILE_FRAG) && /if \(vis <= 0\.0\) discard/.test(RT.TILE_FRAG));
  ctx.ok("a ghost is hatched like every other GM-only thing", /mod\(floor\(gl_FragCoord\.x\) \+ floor\(gl_FragCoord\.y\), 4\.0\) > 1\.5/.test(RT.TILE_FRAG));

  const L = new RT.TilesLayer(shared);
  const roofState = { ...st({}, false), id: "roofA" };
  const ghostState = { ...st({ hidden: true }, true), id: "roofB" };
  L.set([roofState, ghostState]);
  for (const e of L.entries.values()) { e.w = e.h = 64; L.useTexture(e, new THREE.Texture()); L.place(e, true); }
  const fade = new RF.RoofFader();
  fade.set([
    { id: "roofA", source: "tile", poly, baseY: 4.5, topY: 4.5, alpha: 1, holes: [], vision: false, open: 0.2, seen: 1 },
    { id: "roofB", source: "tile", poly, baseY: 4.5, topY: 4.5, alpha: 1, holes: [], vision: false, open: 0.2, seen: 1 },
  ], []);
  L.applyRoofs(fade);
  const ca = L.entries.get("roofA"), cb = L.entries.get("roofB");
  ctx.ok("a shut roof casts; a GM-only ghost never does", ca.casting && !cb.casting && L.casters.children.length === 1);
  fade.set([{ id: "roofA", source: "tile", poly, baseY: 4.5, topY: 4.5, alpha: 0.2, holes: [], vision: false, open: 0.2, seen: 1 }], []);
  fade.frame(1, C_DIR, false);
  L.applyRoofs(fade);
  ctx.ok("an open roof stops casting and writing depth", !ca.casting && ca.material.depthWrite === false);
  L.updateMaxY();
  ctx.ok("the layer reports its highest tile for the shadow bounds", near(L.maxY, 4.5 + RT.ROOF_LIFT, 1e-4), String(L.maxY));
  L.dispose();

  // ── purity, shedding, timing ──
  for (const f2 of ["render/tiles.mjs", "render/roofs.mjs"]) {
    const src = read(`${DIO}/${f2}`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    ctx.ok(`${f2} is pure (no world, no timers)`, !WORLD.test(src) && !/\bset(Timeout|Interval)\s*\(/.test(src));
  }
  ctx.ok("tileVideo and roofFade are in SHED_ORDER", C.SHED_ORDER.includes("tileVideo") && C.SHED_ORDER.includes("roofFade"));
  ctx.ok("TIMING.roofFade is a duration", Number(C.TIMING.roofFade) > 0);
  const R = await import(ctx.url(`${DIO}/render/renderer.mjs`));
  const proto = R.DioramaRenderer.prototype;
  const fxWith = (off) => {
    const self = { graphics: { ...O.DEFAULT_GRAPHICS }, options: { tiltShift: false }, shed: { allows: (n) => n !== off } };
    return proto.effectiveFx.call(self, proto.shedFlags.call(self));
  };
  ctx.ok("shedding tileVideo stops video tiles asking for frames", fxWith("tileVideo").tileVideo === false && fxWith(null).tileVideo === true);
  ctx.ok("shedding roofFade snaps roofs", fxWith("roofFade").roofFade === false && fxWith(null).roofFade === true);
  const rSrc = read(`${DIO}/render/renderer.mjs`);
  ctx.ok("the renderer wires tiles and roofs (setTiles, setRoofs, casters, fades)",
    /setTiles\(/.test(rSrc) && /setRoofs\(/.test(rSrc) && /this\.tiles\.casters/.test(rSrc) && /this\.roofs\.frame\(dt, dir, !fx\.roofFade\)/.test(rSrc) && /setRoofFade\?\.\(/.test(rSrc));

  // ── the view's wiring ──
  const oSrc = read(`${DIO}/view/overlay.mjs`);
  ctx.ok("the view re-reads tiles on create, update and delete", /\["createTile", "updateTile", "deleteTile"\]/.test(oSrc));
  ctx.ok("the GM's cut-away reaches readRoofs only as the GM", /cutaway: gm && S\.roofCut/.test(oSrc));
  ctx.ok("the view reads tiles for the viewer it is drawing (view as players included)", /readTiles\(\{ scene: S\.scene, isGM: gm, asPlayers: S\.asPlayers/.test(oSrc));

  // ── bridges and arches (the walk rules terrain/props.mjs gives them) ──
  ctx.ok("an arch's opening is ground (walked through), its legs are solid", P.profileAt("arch", 0, 0) === -1 && P.profileAt("arch", 0.4, 0) === 1);
  ctx.ok("roof shapes are scenery by default (a solid roof would lift whoever is inside)", P.ROOF_SHAPES.every((s) => P.SHAPE_DEFAULTS[s]?.solid === false));
  const ground = new Terrain({ cols: 6, rows: 3 });
  const deck = P.normalizeProp({ id: "deck", shape: "platform", x: 4, y: 1.5, w: 2, d: 1, h: 0.25, elev: 2 });
  const gate = P.normalizeProp({ id: "gate", shape: "arch", x: 1.5, y: 1.5, w: 2, d: 0.5, h: 2 });
  const rules = P.resolveProps(ground, [deck, gate]).terrain;
  ctx.ok("a bridge deck (a floating platform) stamps floor at deck height", rules.topAt(3, 6) === 9, String(rules.topAt(3, 6)));
  ctx.ok("an arch's opening stays ground and its legs stand to its height", rules.topAt(3, 2) === 0 && rules.topAt(3, 1) === 8, `${rules.topAt(3, 2)} / ${rules.topAt(3, 1)}`);

  // ── strings ──
  const lang = {};
  for (const fl of ["lang/diorama.en.json", "lang/diorama-env.en.json", "lang/diorama-buildings.en.json"]) Object.assign(lang, JSON.parse(read(fl)));
  const keys = [...I.TILE_MODES.map((k) => `GLDIO.env.tiles.${k}`), "GLDIO.env.section.tiles", "GLDIO.env.field.tiles", "GLDIO.env.note.tiles", "GLDIO.view.roofs", "GLDIO.keys.roofs", "GLDIO.keys.roofsHint"];
  const miss = keys.filter((k) => typeof lang[k] !== "string");
  ctx.ok("every buildings string resolves (the GLDIO.env.tiles.* family included)", !miss.length, miss.join(", "));
  const mod = JSON.parse(read("module.json"));
  ctx.ok("module.json loads lang/diorama-buildings.en.json", mod.languages.some((l) => l.path === "lang/diorama-buildings.en.json"));
}
