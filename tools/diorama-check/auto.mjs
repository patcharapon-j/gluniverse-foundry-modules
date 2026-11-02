/**
 * Auto setup's height draft (editor/auto-setup.mjs), on synthetic maps painted
 * here: a raised block with a soft cast shadow, a pond, a black border, a stair
 * flight, and pure texture. What it pins fails silently in the editor — a draft
 * that reads the shadow on the wrong side, water standing above its bank, a
 * cliff invented from noise all render perfectly and are wrong.
 */

export default async function check(ctx) {
  const { SUB, KIND, DIR } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const A = await import(ctx.url("scripts/features/diorama/editor/auto-setup.mjs"));
  const { blockAverage } = await import(ctx.url("scripts/features/diorama/editor/sample.mjs"));

  const PX = 8;                                       // fine px per sub-cell, as the editor samples
  const CELL = PX * SUB;

  /** A painted map: `paint(x, y)` → [r, g, b] in fine px (16 per square). */
  function mapOf(cols, rows, paint) {
    const w = cols * CELL, h = rows * CELL;
    const data = new Uint8Array(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const [r, g, b] = paint(x, y);
      const o = (y * w + x) * 3;
      data[o] = Math.max(0, Math.min(255, r)); data[o + 1] = Math.max(0, Math.min(255, g)); data[o + 2] = Math.max(0, Math.min(255, b));
    }
    const colours = blockAverage(data, w, h, 3, cols * SUB, rows * SUB, PX);
    return { colours, fine: { data, w, h, px: PX }, cols, rows, gridSize: 100, distance: 5 };
  }
  /** Deterministic texture, ±a. */
  const grain = (x, y, a = 4) => (((x * 73856093) ^ (y * 19349663)) >>> 0) % (2 * a + 1) - a;
  const inRect = (x, y, [c0, r0, c1, r1]) => x >= c0 * CELL && x < c1 * CELL && y >= r0 * CELL && y < r1 * CELL;
  /**
   * Soft cast shadow of `rects` with the light from `from` (unit vector towards
   * the light, x east / y south): dark at the edge, fading over `len` squares.
   */
  const shadowOf = (rects, [lx, ly], len) => (x, y) => {
    if (rects.some((r) => inRect(x, y, r))) return 1;
    const L = len * CELL;
    for (let t = 1; t <= L; t++) {
      const sx = x + lx * t, sy = y + ly * t;
      if (rects.some((r) => inRect(sx, sy, r))) return 0.5 + 0.5 * (t / L) ** 1.5;
    }
    return 1;
  };
  const cellTop = (t, i, j) => t.cellTop(i, j);
  const kindAt = (t, i, j) => t.kindAt(i * SUB, j * SUB);

  /* ── a raised block with its shadow falling SE (light from NW) ─────── */
  const blocks = [[6, 6, 12, 12], [16, 14, 21, 19]];
  const NW = [-Math.SQRT1_2, -Math.SQRT1_2];
  const shade = shadowOf(blocks, NW, 2);
  const floorRGB = [148, 138, 116], topRGB = [176, 168, 146];
  const scene = mapOf(26, 26, (x, y) => {
    const top = blocks.some((r) => inRect(x, y, r));
    const base = top ? topRGB : floorRGB;
    const f = shade(x, y);
    const g = grain(x, y);
    return [base[0] * f + g, base[1] * f + g, base[2] * f + g];
  });
  const r1 = A.autoSetupDetailed(scene), r2 = A.autoSetupDetailed(scene);
  const t1 = r1.terrain;
  ctx.ok("auto: deterministic, heights included", t1.h.every((v, k) => v === r2.terrain.h[k]) && t1.kind.every((v, k) => v === r2.terrain.kind[k])
    && t1.layer.every((v, k) => v === r2.terrain.layer[k]) && JSON.stringify(t1.palette) === JSON.stringify(r2.terrain.palette));
  ctx.ok("auto: finds the light from the shadows", r1.stats.light === "NW", `light ${r1.stats.light}, confidence ${r1.stats.confidence}`);
  ctx.ok("auto: the block casting the shadow is raised", cellTop(t1, 9, 9) >= 2 && cellTop(t1, 17, 18) >= 2,
    `tops ${cellTop(t1, 9, 9)}, ${cellTop(t1, 17, 18)}`);
  ctx.ok("auto: the ground the shadow falls on stays at 0", cellTop(t1, 13, 13) === 0 && cellTop(t1, 2, 2) === 0 && cellTop(t1, 23, 3) === 0,
    `tops ${cellTop(t1, 13, 13)}, ${cellTop(t1, 2, 2)}, ${cellTop(t1, 23, 3)}`);
  ctx.ok("auto: the shadow side is the low side", cellTop(t1, 12, 12) < cellTop(t1, 10, 10), `${cellTop(t1, 12, 12)} vs ${cellTop(t1, 10, 10)}`);
  const flat = A.autoSetupDetailed({ ...scene, options: { heights: false } });
  ctx.ok("auto: heights off leaves the draft flat", flat.terrain.distinctTops().every((q) => q <= 0) && flat.stats.light === null);
  const forced = A.autoSetupDetailed({ ...scene, options: { light: "SE" } });
  ctx.ok("auto: a light set by the GM is used, not detected", forced.stats.light === "SE" && forced.stats.confidence === 1);
  ctx.ok("auto: a light from the wrong side does not raise the block", cellTop(forced.terrain, 9, 9) <= cellTop(t1, 9, 9) - 2,
    `${cellTop(forced.terrain, 9, 9)} vs ${cellTop(t1, 9, 9)}`);
  const tall = A.autoSetupDetailed({ ...scene, options: { heightScale: 2 } });
  ctx.ok("auto: the height scale makes a shadow read taller", cellTop(tall.terrain, 9, 9) > cellTop(t1, 9, 9),
    `${cellTop(tall.terrain, 9, 9)} vs ${cellTop(t1, 9, 9)}`);
  const coarse = A.autoSetupDetailed({ ...scene, options: { step: 5 } });
  ctx.ok("auto: heights land on the level step", coarse.terrain.distinctTops().every((q) => q % 4 === 0) && t1.distinctTops().every((q) => q % 2 === 0),
    `${coarse.terrain.distinctTops()} / ${t1.distinctTops()}`);
  ctx.ok("auto: options are sanitised", JSON.stringify(A.autoOptions({ light: "UP", step: -3, heightScale: "x", faces: 7 }))
    === JSON.stringify({ ...A.AUTO_DEFAULTS, step: 0.5 }), JSON.stringify(A.autoOptions({ light: "UP", step: -3, heightScale: "x", faces: 7 })));

  /* ── a pond below its bank, inside a black border ───────────────────── */
  const pondMap = mapOf(20, 16, (x, y) => {
    const g = grain(x, y, 3);
    if (!inRect(x, y, [2, 2, 18, 14])) return [10 + g, 10 + g, 12 + g];          // the black outside
    if (inRect(x, y, [7, 6, 13, 10])) return [40 + g, 100 + g, 170 + g];         // water
    return [150 + g, 132 + g, 104 + g];
  });
  const pond = A.autoSetupDetailed(pondMap).terrain;
  ctx.ok("auto: the pond is water", kindAt(pond, 8, 9) === KIND.WATER && kindAt(pond, 7, 7) === KIND.WATER);
  ctx.ok("auto: water sits below its bank", pond.topAt(8 * SUB, 9 * SUB) < cellTop(pond, 4, 4) && pond.topAt(8 * SUB, 9 * SUB) >= cellTop(pond, 4, 4) - 3,
    `${pond.topAt(8 * SUB, 9 * SUB)} vs bank ${cellTop(pond, 4, 4)}`);
  ctx.ok("auto: the black border stays void", kindAt(pond, 0, 0) === KIND.VOID && kindAt(pond, 15, 19) === KIND.VOID && kindAt(pond, 1, 10) === KIND.VOID);

  /* ── a stair flight between a raised terrace and the ground ─────────── */
  // A terrace across the north, its shadow falling south; a flight of treads
  // (stripes every 5 fine px) cut through the shadow down to the ground.
  const terrace = [[0, 0, 24, 8]];
  const flight = [9, 8, 14, 12];                       // c0 r0 c1 r1
  const tShade = shadowOf(terrace, [0, -1], 2);
  const stairMap = mapOf(24, 20, (x, y) => {
    const g = grain(x, y, 3);
    if (inRect(x, y, flight)) {
      const tread = (y % 5) < 3 ? 1 : 0.62;
      return [170 * tread + g, 160 * tread + g, 140 * tread + g];
    }
    const top = inRect(x, y, terrace[0]);
    const f = tShade(x, y);
    const base = top ? topRGB : floorRGB;
    return [base[0] * f + g, base[1] * f + g, base[2] * f + g];
  });
  const sr = A.autoSetupDetailed({ ...stairMap, options: { light: "N" } });
  const st = sr.terrain;
  ctx.ok("auto: the terrace reads higher than the ground below it", cellTop(st, 3, 3) > cellTop(st, 16, 3), `${cellTop(st, 3, 3)} vs ${cellTop(st, 16, 3)}`);
  const stairCells = [[9, 11], [10, 11], [10, 12], [11, 11]];
  ctx.ok("auto: the striped flight becomes stairs", stairCells.every(([i, j]) => st.cellIsStair(i, j)), `${sr.stats.stairs} stair sub-cells`);
  ctx.ok("auto: the stairs descend towards the lower ground", st.dirAt(10 * SUB, 11 * SUB) === DIR.S, `dir ${st.dirAt(10 * SUB, 11 * SUB)}`);
  const walk = st.step(8, 11, 9, 11), walk2 = st.step(11, 11, 12, 11);
  ctx.ok("auto: the flight is walkable at both ends", !walk.climb && !walk.fall && !walk2.climb && !walk2.fall, JSON.stringify([walk, walk2]));
  const planks = mapOf(24, 20, (x, y) => {
    const g = grain(x, y, 3);
    if (inRect(x, y, flight)) { const tread = (y % 5) < 3 ? 1 : 0.62; return [170 * tread + g, 160 * tread + g, 140 * tread + g]; }
    return [floorRGB[0] + g, floorRGB[1] + g, floorRGB[2] + g];
  });
  const pl = A.autoSetupDetailed(planks);
  ctx.ok("auto: stripes between two equal levels (a boardwalk) stay floor", !pl.terrain.cellIsStair(10, 11) && pl.stats.stairs === 0);

  /* ── pure texture: nothing to read ──────────────────────────────────── */
  let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const blotches = Array.from({ length: 60 }, () => [rnd() * 30 * CELL, rnd() * 30 * CELL, (0.3 + rnd()) * CELL, rnd() * 50 - 25]);
  const noise = mapOf(30, 30, (x, y) => {
    let v = 140 + grain(x, y, 12);
    for (const [bx, by, rad, dv] of blotches) if ((x - bx) ** 2 + (y - by) ** 2 < rad * rad) v += dv;
    return [v, v * 0.93, v * 0.8];
  });
  const nz = A.autoSetupDetailed(noise);
  const nt = nz.terrain;
  const maxStep = 12;                                 // q: 15 ft, the most one border may claim
  let worst = 0;
  for (let si = 0; si < nt.sh; si++) for (let sj = 0; sj < nt.sw; sj++) {
    if (sj + 1 < nt.sw && !nt.isVoid(si, sj) && !nt.isVoid(si, sj + 1)) worst = Math.max(worst, Math.abs(nt.topAt(si, sj) - nt.topAt(si, sj + 1)));
    if (si + 1 < nt.sh && !nt.isVoid(si, sj) && !nt.isVoid(si + 1, sj)) worst = Math.max(worst, Math.abs(nt.topAt(si, sj) - nt.topAt(si + 1, sj)));
  }
  ctx.ok("auto: texture alone invents no light", nz.stats.light === null, `light ${nz.stats.light}, confidence ${nz.stats.confidence}`);
  ctx.ok("auto: texture alone invents no cliff", worst <= 2 && nz.stats.stairs === 0, `largest step ${worst} q, ${nz.stats.stairs} stair sub-cells`);
  const nzLit = A.autoSetupDetailed({ ...noise, options: { light: "NW" } }).terrain;
  let worstLit = 0;
  for (let si = 0; si < nzLit.sh; si++) for (let sj = 0; sj + 1 < nzLit.sw; sj++) worstLit = Math.max(worstLit, Math.abs(nzLit.topAt(si, sj) - nzLit.topAt(si, sj + 1)));
  ctx.ok("auto: a GM's light over texture still never steps past the most one border may claim", worstLit <= maxStep, `largest step ${worstLit} q`);

  /* ── speed ──────────────────────────────────────────────────────────── */
  const big = mapOf(60, 60, (x, y) => {
    const g = grain(x, y, 6);
    const top = ((x / CELL | 0) % 12 < 5) && ((y / CELL | 0) % 9 < 4);
    return top ? [176 + g, 168 + g, 146 + g] : [148 + g, 138 + g, 116 + g];
  });
  const t0 = performance.now();
  A.autoSetupDetailed(big);
  const ms = performance.now() - t0;
  ctx.ok("auto: a 60×60 map drafts in well under the 1.5 s budget", ms < 1500, `${ms.toFixed(0)} ms`);
}
