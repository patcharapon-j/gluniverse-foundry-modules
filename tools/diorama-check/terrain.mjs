/**
 * Terrain core: codec round trip, model queries, cliff edges, the 3D ray and
 * cover. These are the facts the sight backend, movement and the renderer all
 * build on.
 */

export default async function check(ctx) {
  const { Terrain } = await import(ctx.url("scripts/features/diorama/terrain/model.mjs"));
  const { encodeI16, decodeI16, encodeU8, decodeU8 } = await import(ctx.url("scripts/features/diorama/terrain/codec.mjs"));
  const { cliffEdges, rayBlocked, rayPoint, coverBetween } = await import(ctx.url("scripts/features/diorama/terrain/occlusion.mjs"));
  const { KIND, SUB } = await import(ctx.url("scripts/features/diorama/constants.mjs"));

  // Codec: long runs split, odd lengths, negatives, garbage input.
  const i16 = new Int16Array(70000);
  for (let k = 0; k < i16.length; k++) i16[k] = k % 9000 < 4000 ? -8 : (k % 7);
  const back16 = decodeI16(encodeI16(i16), i16.length);
  ctx.ok("i16 round trip", back16.every((v, k) => v === i16[k]));
  const u8 = new Uint8Array(1000).map((_, k) => (k * 31) % 5);
  ctx.ok("u8 round trip", decodeU8(encodeU8(u8), u8.length).every((v, k) => v === u8[k]));
  ctx.ok("garbage decodes to fill", decodeU8("@@not base64@@", 4, 7).every((v) => v === 7));

  // Model.
  const t = Terrain.blank(10, 8, (i, j) => j < 9);
  ctx.ok("blank: padding column is void", t.isVoid(0, 9 * SUB) && !t.isVoid(0, 0));
  ctx.ok("blank is flat", t.isFlat);
  const ledge = t.palette.findIndex((p) => p.h === 8 && p.kind === KIND.FLOOR);
  for (let si = 0; si < 6; si++) for (let sj = 10; sj < 16; sj++) t.paint(si, sj, ledge);
  ctx.ok("painted is not flat", !t.isFlat);
  ctx.ok("cellTop reads the max sub-cell", t.cellTop(0, 5) === 8 && t.cellTop(0, 4) === 0);
  const up = t.step(1, 4, 1, 5);
  ctx.ok("a 10 ft rise is a climb", up.climb && up.rise === 8, JSON.stringify(up));
  const down = t.step(1, 5, 1, 4);
  ctx.ok("a 10 ft drop is a fall", down.fall && down.drop === 8);
  // A flight painted at the ledge's height, going down west to the floor (the editor's flow).
  for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) t.set(1 * SUB + a, 4 * SUB + b, { h: 8, kind: KIND.STAIRS, dir: 3 });
  ctx.ok("stairs make the rise walkable", !t.step(1, 3, 1, 4).climb && !t.step(1, 4, 1, 3).fall && !t.step(1, 4, 1, 5).climb);
  // A cliff beside the flight is still a cliff (Sol r1 S3).
  for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) t.set(2 * SUB + a, 4 * SUB + b, { h: 48, kind: KIND.FLOOR });
  ctx.ok("a cliff beside stairs is still a climb", t.step(1, 4, 2, 4).climb, JSON.stringify(t.step(1, 4, 2, 4)));
  ctx.ok("and still a fall coming down", t.step(2, 4, 1, 4).fall);
  for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) t.set(2 * SUB + a, 4 * SUB + b, { h: 0, kind: KIND.FLOOR });
  // One stair sub-cell does not make a tower in the same square walkable (Sol r2 S3).
  const mixed = Terrain.blank(4, 2);
  for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) mixed.set(a, 1 * SUB + b, { h: 48, kind: KIND.FLOOR });
  mixed.set(0, 1 * SUB, { h: 8, kind: KIND.STAIRS, dir: 3 });
  ctx.ok("a stair sub-cell beside a tower is no way up it", mixed.step(0, 0, 0, 1).climb && mixed.step(0, 1, 0, 0).fall,
    JSON.stringify([mixed.step(0, 0, 0, 1), mixed.step(0, 1, 0, 0)]));
  const stairs = t.palette.findIndex((p) => p.kind === KIND.STAIRS);
  for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) t.paint(1 * SUB + a, 4 * SUB + b, stairs);
  const json = JSON.parse(JSON.stringify(t.toJSON()));
  const r = Terrain.fromJSON(json);
  ctx.ok("flag round trip", r.h.every((v, k) => v === t.h[k]) && r.kind.every((v, k) => v === t.kind[k])
    && r.layer.every((v, k) => v === t.layer[k]));
  const grown = Terrain.fromJSON(json, { cols: 12, rows: 9 });
  ctx.ok("resize keeps the top-left", grown.cols === 12 && grown.topAt(0, 10) === 8);
  ctx.ok("fromJSON is total", Terrain.fromJSON(null, { cols: 3, rows: 2 }).cols === 3);

  // Cliff edges.
  const flat = Terrain.blank(6, 6);
  for (let si = 4; si < 8; si++) for (let sj = 4; sj < 8; sj++) flat.set(si, sj, { h: 8 });
  const e = cliffEdges(flat, 4, 100);
  ctx.ok("one raised square has four merged edges", e.length === 4, JSON.stringify(e));
  ctx.ok("edges are in px", e.every((s) => s.every((n) => n % 50 === 0)) && e.some((s) => s[0] === 200 && s[2] === 400));
  ctx.ok("no edges above the eye", cliffEdges(flat, 8, 100).length === 0);

  // Ray.
  const g = 100;
  ctx.ok("low ray is blocked", rayBlocked(flat, rayPoint(50, 250, 4, g), rayPoint(550, 250, 4, g)) !== null);
  ctx.ok("high ray is clear", rayBlocked(flat, rayPoint(50, 250, 12, g), rayPoint(550, 250, 12, g)) === null);
  ctx.ok("ray past the block is clear", rayBlocked(flat, rayPoint(50, 50, 4, g), rayPoint(550, 50, 4, g)) === null);
  ctx.ok("endpoint cells never block", rayBlocked(flat, rayPoint(225, 225, 8, g), rayPoint(275, 225, 8, g)) === null);
  ctx.ok("a ray along the plateau top is clear", rayBlocked(flat, rayPoint(225, 225, 8.5, g), rayPoint(375, 375, 8.5, g)) === null);
  ctx.ok("diagonal ray through the block", rayBlocked(flat, rayPoint(50, 50, 2, g), rayPoint(550, 550, 2, g)) !== null);

  // Cover.
  const c0 = coverBetween(flat, { x: 50, y: 50, eyeQ: 4 }, { x: 550, y: 50, footQ: 0, heightQ: 5, radiusPx: 50 }, g);
  ctx.ok("clear line: no cover", c0.cover === "none" && c0.lineOfSight);
  const c1 = coverBetween(flat, { x: 50, y: 300, eyeQ: 4 }, { x: 550, y: 300, footQ: 0, heightQ: 5, radiusPx: 50 }, g);
  ctx.ok("behind the block: no line of sight", !c1.lineOfSight);
  const lip = Terrain.blank(6, 6);
  for (let si = 0; si < 12; si++) lip.set(si, 6, { h: 3 });
  const c2 = coverBetween(lip, { x: 50, y: 300, eyeQ: 4 }, { x: 550, y: 300, footQ: 0, heightQ: 5, radiusPx: 50 }, g);
  ctx.ok("a low wall gives partial cover", c2.lineOfSight && c2.cover !== "none", JSON.stringify(c2));
}
