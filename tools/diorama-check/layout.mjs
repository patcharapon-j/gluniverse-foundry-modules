/**
 * Layouts (terrain/layout.mjs) and the terrain field (render/terrain-field.mjs).
 *
 * A layout is what an AI agent hands a GM, so every way it can be wrong has to
 * come back as a sentence naming the op, never as a half-painted terrain. The
 * worked example in the map-setup skill must compile to exactly what it
 * documents, or the agent learns the grammar from a lie.
 */

import { readFileSync } from "node:fs";

export default async function check(ctx) {
  const { compileLayout, LAYOUT_OPS } = await import(ctx.url("scripts/features/diorama/terrain/layout.mjs"));
  const { buildTerrainField, FIELD_PX_PER_CELL } = await import(ctx.url("scripts/features/diorama/render/terrain-field.mjs"));
  const { buildTerrainMesh } = await import(ctx.url("scripts/features/diorama/render/terrain-mesh.mjs"));
  const { Terrain } = await import(ctx.url("scripts/features/diorama/terrain/model.mjs"));
  const { KIND, SUB } = await import(ctx.url("scripts/features/diorama/constants.mjs"));

  // ── the worked example ──
  const lion = JSON.parse(readFileSync(new URL(ctx.url(".claude/skills/diorama-map-setup/examples/lion-garden.json")), "utf8"));
  const L = compileLayout(lion, { cols: 29, rows: 58, distance: 5 });
  ctx.ok("the Lion Garden example compiles clean", L.terrain && !L.errors.length && !L.warnings.length, JSON.stringify([L.errors, L.warnings]));
  if (L.terrain) {
    const t = L.terrain;
    ctx.ok("example heights land where the skill says", t.cellTop(5, 1) === 64 && t.cellTop(56, 5) === -3 && t.cellTop(43, 14) === 12 && t.cellTop(31, 13) === 24,
      JSON.stringify([t.cellTop(5, 1), t.cellTop(56, 5), t.cellTop(43, 14), t.cellTop(31, 13)]));
    let asym = 0;
    for (let si = 0; si < t.sh; si++) for (let sj = 0; sj < t.sw; sj++) {
      const k = t.idx(si, sj), m = t.idx(si, t.sw - 1 - sj);
      if (t.h[k] !== t.h[m] || (t.kind[k] & 0x0f) !== (t.kind[m] & 0x0f)) asym++;
    }
    ctx.ok("a mirrored layout is symmetric to the sub-cell", asym === 0, `${asym} sub-cells differ`);
    const harpy = L.tokens.find((p) => p.name === "Harpy");
    ctx.ok("a q-unit altitude comes back in feet", harpy?.altitude === 20 && harpy.elevation === null, JSON.stringify(harpy));
    // Props: every mirrored prop has its twin, and every one stands clear of a token.
    const want = lion.props.reduce((n, p) => n + (p.mirror ? 2 : 1), 0);
    ctx.ok("the example's props all come back, mirrored ones twice", L.props?.length === want, `${L.props?.length} of ${want}`);
    // The art is not perfectly symmetric (its boats are not), so only a mirrored entry owes a twin.
    const mirrored = new Set(lion.props.filter((p) => p.mirror).map((p) => p.label));
    const unpaired = (L.props ?? []).filter((p) => mirrored.has(p.label) && !L.props.some((q) => q.shape === p.shape && Math.abs(q.x - (29 - p.x)) < 1e-6 && q.y === p.y));
    ctx.ok("the example's mirrored props are symmetric", mirrored.size > 0 && unpaired.length === 0, unpaired.map((p) => p.id).join());
    const onToken = (L.props ?? []).filter((p) => L.tokens.some((t) => Math.abs(t.j + 0.5 - p.x) < (p.w + 1) / 2 && Math.abs(t.i + 0.5 - p.y) < (p.d + 1) / 2));
    ctx.ok("no example prop stands on a token's square", onToken.length === 0, onToken.map((p) => p.label).join());
    const tree = L.props?.find((p) => p.shape === "tree");
    ctx.ok("a layout prop's q heights come back in cells", tree?.h === 3 && tree.elev === null, JSON.stringify(tree));
  }
  ctx.ok("the skill documents every op", (() => {
    const skill = readFileSync(new URL(ctx.url(".claude/skills/diorama-map-setup/SKILL.md")), "utf8");
    return LAYOUT_OPS.every((op) => skill.includes(`"${op}"`));
  })());

  // ── grammar ──
  const pal = [
    { name: "Ground", h: 0, kind: "floor" },
    { name: "Ledge", h: 10, kind: "floor", material: "stone" },
    { name: "Steps", h: 10, kind: "stairs", material: "stone" },
    { name: "Pond", h: -2.5, kind: "water" },
  ];
  const grid = { cols: 12, rows: 10, distance: 5 };
  const S = compileLayout({ palette: pal, mirror: { cols: 12 }, ops: [
    { op: "stairs", rows: [2, 4], cols: [1, 3], down: "E", top: 10, bottom: 0, mirror: true },
  ] }, grid);
  if (S.terrain) {
    const t = S.terrain;
    const hs = [2, 3, 4, 5].map((sj) => t.h[t.idx(4, sj)]);
    ctx.ok("stairs step down the way they face, feet → q", hs.join() === "8,6,4,2" && t.dirAt(4, 2) === 1, JSON.stringify(hs));
    const ms = [18, 19, 20, 21].map((sj) => t.h[t.idx(4, sj)]);
    ctx.ok("a mirrored flight faces the other way", ms.join() === "2,4,6,8" && t.dirAt(4, 20) === 3, JSON.stringify([ms, t.dirAt(4, 20)]));
  } else ctx.ok("stairs layout compiles", false, JSON.stringify(S.errors));

  const G = compileLayout({ palette: pal, base: "Ground", ops: [
    { op: "grid", origin: [1, 1], rows: ["#.~", ".#"], key: { "#": "Ledge", "~": { layer: "Pond", h: -5 } } },
    { op: "grid", origin: [6, 6], res: "sub", rows: ["##"], key: { "#": "Ledge" } },
    { op: "polygon", layer: "Ledge", points: [[7, 0], [7, 4], [9, 0]] },
    { op: "ellipse", layer: "Pond", center: [5, 9], radii: [1, 2], clip: { cols: [9, 12] } },
  ] }, grid);
  if (G.terrain) {
    const t = G.terrain;
    ctx.ok("grid cells paint their key", t.cellTop(1, 1) === 8 && t.cellTop(1, 2) === 0 && t.cellTop(2, 2) === 8 && t.cellTop(1, 3) === -4 && t.kindAt(2, 6) === KIND.WATER);
    ctx.ok("a sub-res grid paints half squares", t.h[t.idx(12, 12)] === 8 && t.h[t.idx(12, 13)] === 8 && t.h[t.idx(12, 14)] === 0);
    ctx.ok("polygon and clipped ellipse", t.cellTop(7, 0) === 8 && t.cellTop(8, 3) === 0 && t.kindAt(10, 19) === KIND.WATER && t.kindAt(10, 16) !== KIND.WATER);
  } else ctx.ok("grid layout compiles", false, JSON.stringify(G.errors));

  const O = compileLayout({ palette: pal, ops: [{ op: "rect", layer: "Ledge", rows: [0, 1], cols: [0, 1] }],
    tokens: [{ name: "A", cell: [0, 0] }] }, { cols: 12, rows: 10, offset: { i: 2, j: 3 }, map: { cols: 6, rows: 5 } });
  if (O.terrain) {
    const t = O.terrain;
    ctx.ok("map coordinates sit at the scene rect, padding is void", t.cellTop(2, 3) === 8 && t.isVoid(0, 0) && t.isVoid(2 * SUB, 9 * SUB) && !t.isVoid(2 * SUB, 8 * SUB));
    ctx.ok("a void entry is added when the palette has none", t.palette.some((p) => p.kind === KIND.VOID));
    ctx.ok("token cells are offset to the canvas", O.tokens[0].i === 2 && O.tokens[0].j === 3);
  } else ctx.ok("offset layout compiles", false, JSON.stringify(O.errors));

  // ── props ──
  const PL = compileLayout({ palette: pal, mirror: { cols: 12, rows: 10 }, ops: [], props: [
    { shape: "wedge", at: [2.5, 3.5], h: 5, rot: 90, mirror: "both", id: "ramp" },
    { shape: "pillar", at: [5, 1], h: 15, elev: 10, label: "Column" },
    { shape: "box", at: [1, 6], w: 2 },
  ] }, { cols: 14, rows: 12, offset: { i: 1, j: 2 }, map: { cols: 12, rows: 10 }, distance: 5 });
  if (PL.props) {
    const by = (id) => PL.props.find((p) => p.id === id);
    const a = by("ramp"), m = by("rampm"), r = by("rampr"), b = by("rampb");
    ctx.ok("layout props sit at the scene rect, centre on [row, col]", a?.x === 5.5 && a.y === 3.5, JSON.stringify(a));
    const col = PL.props.find((p) => p.label === "Column"), box = PL.props.find((p) => p.shape === "box");
    ctx.ok("feet heights come back in cells", a?.h === 1 && col?.elev === 2 && col.h === 3, JSON.stringify(col));
    ctx.ok("a mirrored prop reflects across each axis with its turn",
      m?.x === 2 + 12 - 3.5 && m.y === a.y && m.rot === 270 && r?.y === 1 + 10 - 2.5 && r.rot === 90 && b?.x === m.x && b.y === r.y && b.rot === 270,
      JSON.stringify([m, r, b].map((p) => p && [p.x, p.y, p.rot])));
    ctx.ok("a prop's own size wins, the shape's default fills the rest", box?.w === 2 && box.d === 1 && box.solid === true, JSON.stringify(box));
    ctx.ok("a layout prop with no id gets a minted one", /^p[0-9a-z]+$/.test(box?.id ?? ""));
  } else ctx.ok("props layout compiles", false, JSON.stringify(PL.errors));
  ctx.ok("a layout without props leaves the scene's props alone (null)", compileLayout({ palette: pal, ops: [] }, grid).props === null);
  const offMap = compileLayout({ palette: pal, ops: [], props: [{ shape: "rock", at: [40, 1] }] }, grid);
  ctx.ok("a prop off the map is a warning that names it", offMap.props?.length === 0 && offMap.warnings.some((w) => /props\[0\] \(rock\) stands outside the map/.test(w)));
  const onAxis = compileLayout({ palette: pal, mirror: { cols: 12 }, ops: [], props: [{ shape: "rock", at: [2, 6], mirror: true }] }, grid);
  ctx.ok("a prop on its own mirror axis is not doubled", onAxis.props?.length === 1 && onAxis.warnings.some((w) => /own mirror axis/.test(w)));

  // ── slabs, paths, kits and models ──
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const SL = compileLayout({ palette: pal, mirror: { cols: 12 }, ops: [], props: [
    { id: "dais", shape: "slab", points: [[1, 1], [1, 4], [3.5, 4], [3.5, 1]], h: 5, cliff: "metal", mirror: true },
    { id: "duct", shape: "pipe", path: [[6, 1], [6, 4, 5]], thick: 0.3 },
    { id: "font", shape: "lathe", at: [8, 8], profile: [[0, 0], [1, 0.3], [0.4, 1]] },
  ] }, { cols: 14, rows: 12, offset: { i: 1, j: 2 }, map: { cols: 12, rows: 10 }, distance: 5 });
  if (SL.props) {
    const dais = SL.props.find((p) => p.id === "dais"), twin = SL.props.find((p) => p.id === "daism");
    const corners = (p) => p.points.map(([u, v]) => [p.y + v, p.x + u]);
    ctx.ok("a slab's [row, col] corners on the map come back as its outline on the canvas",
      dais && near(dais.x, 2 + 2.5) && near(dais.y, 1 + 2.25) && dais.h === 1 && dais.cliff === "metal" && dais.rot === 0 && dais.w === 3 && dais.d === 2.5
      && corners(dais).some(([r, c]) => near(r, 2) && near(c, 3)), JSON.stringify(dais));
    ctx.ok("a mirrored slab reflects its outline point by point, never turned",
      twin && near(twin.x, 2 + 12 - 2.5) && twin.rot === 0 && corners(twin).some(([r, c]) => near(r, 2) && near(c, 2 + 12 - 1)), JSON.stringify(twin));
    const duct = SL.props.find((p) => p.id === "duct");
    ctx.ok("a pipe's path is its centre line, heights in the layout's unit (resting on the floor when left out)",
      duct && duct.path.length === 2 && near(duct.path[0][2], 0.15) && near(duct.path[1][2], 1) && near(duct.d, 0.3), JSON.stringify(duct));
    ctx.ok("a lathe keeps its profile", SL.props.find((p) => p.id === "font")?.profile?.length === 3);
  } else ctx.ok("slab layout compiles", false, JSON.stringify(SL.errors));

  const stall = { parts: [
    { shape: "box", at: [0, -0.5], w: 1, d: 1, h: 2.5 },
    { shape: "gable", at: [0, 0], w: 2, d: 1, h: 2.5, elev: 2.5 },
  ] };
  const KL = compileLayout({ palette: pal, mirror: { cols: 12 }, kits: { stall }, ops: [], props: [
    { id: "s", shape: "kit", kit: "stall", at: [5, 3], rot: 90, mirror: true },
    { id: "big", shape: "kit", kit: "stall", at: [8, 6], scale: 2 },
  ] }, grid);
  if (KL.props) {
    const s = KL.props.find((p) => p.id === "s"), sm = KL.props.find((p) => p.id === "sm"), big = KL.props.find((p) => p.id === "big");
    ctx.ok("a kit stands its origin at \"at\" and keeps its parts inline, heights in cells",
      s && s.x === 3 && s.y === 5 && s.rot === 90 && s.parts.length === 2 && s.parts[0].h === 0.5 && s.parts[1].elev === 0.5 && s.h === 1, JSON.stringify(s));
    ctx.ok("a kit's scenery roof part stays scenery, its box stays solid", s && s.parts[0].solid === true && s.parts[1].solid === false, JSON.stringify(s?.parts));
    const boxX = (p) => p.parts.find((q) => q.shape === "box").x;
    ctx.ok("a mirrored kit reflects its parts in its own frame",
      sm && near(sm.x, 12 - s.x) && sm.rot === 270 && near(boxX(sm), -boxX(s)),
      JSON.stringify([s?.parts.map((q) => q.x), sm?.parts.map((q) => q.x), sm?.rot]));
    ctx.ok("a scaled kit scales every part with it", big && near(big.w, s.w * 2) && near(big.h, s.h * 2), JSON.stringify([big?.w, big?.h, s?.w, s?.h]));
  } else ctx.ok("kit layout compiles", false, JSON.stringify(KL.errors));
  const alias = compileLayout({ palette: pal, models: { stall }, ops: [], props: [{ shape: "kit", kit: "stall", at: [2, 2] }] }, grid);
  ctx.ok("\"models\" is read as \"kits\", with a warning to rename it", alias.props?.length === 1 && alias.warnings.some((w) => /"models" is read as "kits"/.test(w)), JSON.stringify(alias.errors));
  const mod = compileLayout({ palette: pal, ops: [], props: [{ shape: "model", at: [2, 2], src: "worlds/x/well.glb", scale: 0.5, rules: "none", h: 10 }] }, grid);
  ctx.ok("a model keeps its file, its scale and its rules", mod.props?.[0]?.src === "worlds/x/well.glb" && mod.props[0].scale === 0.5 && mod.props[0].rules === "none" && mod.props[0].h === 2,
    JSON.stringify(mod.props?.[0] ?? mod.errors));
  const roofy = compileLayout({ palette: pal, ops: [], props: [{ shape: "hip", at: [2, 2] }, { shape: "box", at: [4, 4], roof: true }] }, grid);
  ctx.ok("a roof shape is a roof unless told otherwise, and any prop can be one", roofy.props?.[0]?.roof === true && roofy.props?.[1]?.roof === true);
  const ignored = compileLayout({ palette: pal, ops: [], props: [{ shape: "box", at: [2, 2], cliff: "stone", src: "a.glb", path: [[0, 0], [1, 1]] }] }, grid);
  ctx.ok("a field another shape keeps is a warning on this one, not a failure",
    ignored.props?.length === 1 && ["cliff", "src", "path"].every((k) => ignored.warnings.some((w) => w.includes(`"${k}"`))), JSON.stringify(ignored.warnings));
  if (L.props) {
    ctx.ok("the example's braziers are braziers (their fire comes from the shape, not the label)",
      L.props.filter((p) => /brazier/i.test(p.label)).every((p) => p.shape === "brazier"));
    ctx.ok("the example shows slabs, kits and the newer shapes",
      ["slab", "kit", "parapet", "lamp"].every((s) => L.props.some((p) => p.shape === s)));
  }

  // ── every mistake is a sentence, and nothing is half painted ──
  const bad = [
    [null, /not a JSON object/],
    [{ palette: [], ops: [] }, /palette/],
    [{ palette: pal, ops: [{ op: "blob", layer: "Ledge" }] }, /ops\[0\].*"op" must be/],
    [{ palette: pal, ops: [{ op: "rect", layer: "Lava", rows: [0, 1], cols: [0, 1] }] }, /no palette entry is called "Lava"/],
    [{ palette: pal, ops: [{ op: "rect", layer: "Ledge", rows: [3, 1], cols: [0, 1] }] }, /end > start/],
    [{ palette: pal, ops: [{ op: "stairs", rows: [0, 2], cols: [0, 1], down: "up", top: 5, bottom: 0 }] }, /"down" must be N, E, S or W/],
    [{ palette: pal, ops: [{ op: "stairs", layer: "Ledge", rows: [0, 2], cols: [0, 1], down: "S", top: 5, bottom: 0 }] }, /is not a stairs entry/],
    [{ palette: pal, ops: [{ op: "rect", layer: "Ledge", rows: [0, 1], cols: [0, 1], mirror: true }] }, /mirror/],
    [{ palette: pal, ops: [{ op: "grid", origin: [0, 0], rows: ["#?"], key: { "#": "Ledge" } }] }, /"\?", which is not in "key"/],
    [{ palette: [...pal, { name: "ledge", kind: "floor" }], ops: [] }, /used twice/],
    [{ palette: pal, ops: [], tokens: [{ name: "A" }] }, /"cell" must be/],
    [{ format: "something-else", palette: pal, ops: [] }, /"format"/],
    [{ palette: pal, ops: [], props: {} }, /"props" must be an array/],
    [{ palette: pal, ops: [], props: [{ shape: "statue", at: [1, 1] }] }, /props\[0\] \(statue\): "shape" must be one of/],
    [{ palette: pal, ops: [], props: [{ shape: "box", label: "Altar" }] }, /props\[0\] \(box "Altar"\): "at" must be/],
    [{ palette: pal, ops: [], props: [{ shape: "box", at: [1, 1], mat: "gold" }] }, /"mat" must be one of/],
    [{ palette: pal, ops: [], props: [{ shape: "box", at: [1, 1], tint: "red" }] }, /"tint" must be "#rrggbb"/],
    [{ palette: pal, ops: [], props: [{ shape: "box", at: [1, 1], w: 0 }] }, /"w" must be/],
    [{ palette: pal, ops: [], props: [{ shape: "box", at: [1, 1], solid: "yes" }] }, /"solid" must be true or false/],
    [{ palette: pal, ops: [], props: [{ shape: "box", at: [1, 1], mirror: true }] }, /props\[0\] \(box\): "mirror" needs/],
    [{ palette: pal, ops: [], props: [{ shape: "box", at: [1, 1], id: "a" }, { shape: "box", at: [2, 2], id: "a" }] }, /props\[1\].*used twice/],
    [{ palette: pal, ops: [], props: [{ shape: "slab" }] }, /a slab needs "at" .* or "points"/],
    [{ palette: pal, ops: [], props: [{ shape: "slab", points: [[1, 1], [2, 2]] }] }, /"points" must be 3 to/],
    [{ palette: pal, ops: [], props: [{ shape: "slab", at: [1, 1], cliff: "gold" }] }, /"cliff" must be one of/],
    [{ palette: pal, ops: [], props: [{ shape: "pipe" }] }, /a pipe needs "at" .* or "path"/],
    [{ palette: pal, ops: [], props: [{ shape: "lathe", at: [1, 1], profile: [[0, 0], [2, 1]] }] }, /"profile" must be/],
    [{ palette: pal, ops: [], props: [{ shape: "extrude", at: [1, 1], bevel: 3 }] }, /"bevel" must be/],
    [{ palette: pal, ops: [], props: [{ shape: "gable", at: [1, 1], roof: "yes" }] }, /"roof" must be true or false/],
    [{ palette: pal, ops: [], props: [{ shape: "model", at: [1, 1] }] }, /a model needs "src"/],
    [{ palette: pal, ops: [], props: [{ shape: "model", at: [1, 1], src: "a.png" }] }, /a model needs "src"/],
    [{ palette: pal, ops: [], props: [{ shape: "model", at: [1, 1], src: "a.glb", rules: "all" }] }, /"rules" must be one of/],
    [{ palette: pal, ops: [], props: [{ shape: "kit", at: [1, 1] }] }, /a kit placement needs "kit"/],
    [{ palette: pal, kits: { a: { parts: [{ shape: "box", at: [0, 0] }] } }, ops: [], props: [{ shape: "kit", kit: "b", at: [1, 1] }] }, /no kit called "b".*"a"/],
    [{ palette: pal, kits: { a: { parts: [{ shape: "slab", at: [0, 0] }] } }, ops: [] }, /kits\["a"\]\.parts\[0\] \(slab\): "shape" must be one of/],
    [{ palette: pal, kits: { a: { parts: [] } }, ops: [] }, /kits\["a"\] needs "parts"/],
    [{ palette: pal, kits: [], ops: [] }, /"kits" must be an object/],
  ];
  for (const [layout, re] of bad) {
    const r = compileLayout(layout, grid);
    ctx.ok(`refused with a reason: ${re}`, r.terrain === null && r.errors.some((e) => re.test(e)), JSON.stringify(r.errors));
  }
  const empty = compileLayout({ palette: pal, ops: [{ op: "rect", layer: "Ledge", rows: [40, 41], cols: [0, 1] }] }, grid);
  ctx.ok("a shape off the map is a warning, not a failure", empty.terrain && empty.warnings.some((w) => /covers no square/.test(w)));

  // ── the terrain field ──
  const tf = Terrain.blank(6, 6, (i, j) => j < 5);
  for (let si = 4; si < 8; si++) for (let sj = 4; sj < 8; sj++) tf.set(si, sj, { h: 8 });     // a 2×2-square block
  for (let si = 0; si < 12; si++) for (let sj = 0; sj < 3; sj++) tf.set(si, sj, { h: -1, kind: KIND.WATER }); // a channel
  const f = buildTerrainField(tf);
  const P = FIELD_PX_PER_CELL;
  const px = (x, z, ch) => f.data[(Math.floor(z * P) * f.width + Math.floor(x * P)) * 4 + ch];
  ctx.ok("field size follows the grid", f.width === 6 * P && f.height === 6 * P && f.pxPerCell === P);
  ctx.ok("void reads neutral in the field", px(5.5, 3, 0) === 255 && px(5.5, 3, 1) === 128 && px(5.5, 3, 2) === 0);
  ctx.ok("AO darkens the foot of a cliff, not open ground", px(3.6, 1.8, 0) < px(3.6, 0.5, 0) - 20, `${px(3.6, 1.8, 0)} vs ${px(3.6, 0.5, 0)}`);
  ctx.ok("lip distance is signed: high side above 128, low side below", px(2.06, 3, 1) > 128 && px(1.94, 3, 1) < 128 && px(2.5, 3, 1) === 255,
    JSON.stringify([px(2.06, 3, 1), px(1.94, 3, 1), px(2.5, 3, 1)]));
  // The channel's bank is its east side (x = 1.5); its west side is the map edge, which is open sea.
  ctx.ok("shore distance grows away from the bank", px(0.6, 3, 2) > px(1.1, 3, 2) && px(1.1, 3, 2) > px(1.4, 3, 2) && px(2.5, 3, 2) === 0,
    JSON.stringify([px(0.6, 3, 2), px(1.1, 3, 2), px(1.4, 3, 2)]));

  // ── the wet flag on bank faces ──
  const m = buildTerrainMesh(tf);
  const flags = new Set(m.sides.flag);
  ctx.ok("a bank over water is flagged wet (+4)", [...flags].some((x) => x >= 4 && x < 8), JSON.stringify([...flags]));
}
