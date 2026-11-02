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
