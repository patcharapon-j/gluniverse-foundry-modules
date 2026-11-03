/**
 * Movement range and the miniature in the hand.
 *
 * The reach solver against hand-counted grids (PF2e's 5/10 diagonals,
 * difficult terrain, walls, cliffs, bounds, paths), the wall index, the band
 * readout, and the held-standee pose driven through the real StandeesLayer
 * where it can run headless. Nothing here proves Foundry's own movement, the
 * socket or the drag; those need a live session.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

export default async function check(ctx) {
  const R = await import(ctx.url("scripts/features/diorama/rules/reach.mjs"));
  const { solveReach, reachBand, reachBudgets, segmentsCross, wallIndex, DIAGONALS, diagonalStep } = R;
  const near = (a, b) => Math.abs(a - b) < 1e-6;

  /* ---------------- diagonals ---------------- */
  const a1 = diagonalStep(DIAGONALS.ALTERNATING_1, 0), a2 = diagonalStep(DIAGONALS.ALTERNATING_1, a1.parity);
  ctx.ok("reach: PF2e diagonals alternate 5 then 10", a1.len === 1 && a2.len === 2 && a2.parity === 0);
  ctx.ok("reach: no diagonals under ILLEGAL", diagonalStep(DIAGONALS.ILLEGAL, 0) === null);

  /* ---------------- open ground, PF2e Speed 25 ---------------- */
  const open = solveReach({ start: { i: 10, j: 10 }, budget: 25, gridDistance: 5 });
  ctx.ok("reach: 5 squares straight costs 25", near(open.at(10, 15), 25) && open.at(10, 16) === Infinity);
  // three diagonals: 5 + 10 + 5 = 20, a fourth adds 10 = 30 > 25
  ctx.ok("reach: three diagonals cost 20", near(open.at(13, 13), 20), String(open.at(13, 13)));
  ctx.ok("reach: a fourth diagonal is out of a 25 ft Stride", open.at(14, 14) === Infinity);
  // (2 diag + 1 straight) = 5 + 10 + 5 = 20, the cheapest route the alternation allows
  ctx.ok("reach: a knight-ish square takes the cheaper parity", near(open.at(12, 13), 20), String(open.at(12, 13)));
  ctx.ok("reach: the start is free", open.at(10, 10) === 0);
  const path = open.pathTo(13, 13);
  ctx.ok("reach: a path starts on the token and ends on the square",
    path && path[0].i === 10 && path[0].j === 10 && path.at(-1).i === 13 && path.at(-1).j === 13 && path.length === 4, JSON.stringify(path));
  ctx.ok("reach: an unreachable square has no path", open.pathTo(10, 30) === null);

  /* ---------------- difficult terrain ---------------- */
  const mud = solveReach({ start: { i: 0, j: 0 }, budget: 25, gridDistance: 5, enter: (i, j) => (j === 1 ? 2 : 1) });
  ctx.ok("reach: entering difficult terrain costs double", near(mud.at(0, 1), 10) && near(mud.at(0, 2), 15));
  const wallOfFire = solveReach({ start: { i: 0, j: 0 }, budget: 50, gridDistance: 5, enter: (i, j) => (j === 1 ? Infinity : 1), bounds: { rows: 1, cols: 10 } });
  ctx.ok("reach: an impassable square ends the row", wallOfFire.at(0, 2) === Infinity);

  /* ---------------- walls and cliffs ---------------- */
  // a wall along x = 100 from y = -1000 to y = 1000 (between columns 0 and 1)
  const idx = wallIndex([{ ax: 100, ay: -1000, bx: 100, by: 1000 }], 100);
  ctx.ok("reach: the wall index finds a crossing", idx.crosses(50, 50, 150, 50) && !idx.crosses(50, 50, 50, 150));
  const walled = solveReach({
    start: { i: 0, j: 0 }, budget: 30, gridDistance: 5, bounds: { rows: 3, cols: 3 },
    blocked: (fi, fj, ti, tj) => idx.crosses((fj + 0.5) * 100, (fi + 0.5) * 100, (tj + 0.5) * 100, (ti + 0.5) * 100),
  });
  ctx.ok("reach: nothing beyond a closed wall", walled.cells.every((c) => c.j === 0), JSON.stringify(walled.cells));
  const oneWay = wallIndex([{ ax: 100, ay: -1000, bx: 100, by: 1000, ignoresFrom: (x) => x < 100 }], 100);
  ctx.ok("reach: a one-way wall lets its own side through", !oneWay.crosses(50, 50, 150, 50) && oneWay.crosses(150, 50, 50, 50));
  ctx.ok("reach: touching a wall's end counts (no corner cutting)", segmentsCross(0, 0, 100, 100, 50, 50, 50, 200));
  const cliff = solveReach({ start: { i: 0, j: 0 }, budget: 20, gridDistance: 5, bounds: { rows: 1, cols: 6 }, blocked: (fi, fj, ti, tj) => tj === 2 && fj === 1 });
  ctx.ok("reach: a cliff stops the climb", near(cliff.at(0, 1), 5) && cliff.at(0, 2) === Infinity);
  // A ledge (0,0) → (0,1) is a drop; the way round through row 1 is the stairs.
  // The walker takes the stairs; a square below only the drop reaches still shows.
  const ledge = { start: { i: 0, j: 0 }, budget: 30, gridDistance: 5, bounds: { rows: 2, cols: 3 } };
  const drop = (fi, fj, ti, tj) => fi === 0 && fj === 0 && ti === 0 && tj === 1;
  const jumps = solveReach({ ...ledge });
  const stairs = R.preferReach(solveReach({ ...ledge, blocked: drop }), jumps);
  const viaStairs = stairs.pathTo(0, 1) ?? [];
  // (0,2) is down a drop from every side: the drop-free solve never reaches it
  const lone = R.preferReach(solveReach({ ...ledge, blocked: (fi, fj, ti, tj) => drop(fi, fj, ti, tj) || (ti === 0 && tj === 2) }), jumps);
  ctx.ok("reach: a walker takes the stairs rather than drop off the ledge",
    near(jumps.at(0, 1), 5) && near(stairs.at(0, 1), 10) && viaStairs.length === 3 && viaStairs[1].i === 1
    && stairs.cells.some((c) => c.i === 0 && c.j === 1 && near(c.cost, 10)),
    JSON.stringify(viaStairs));
  ctx.ok("reach: a square only a drop reaches still shows, by the drop",
    Number.isFinite(lone.at(0, 2)) && (lone.pathTo(0, 2) ?? []).length > 0, String(lone.at(0, 2)));
  const edge = solveReach({ start: { i: 0, j: 0 }, budget: 25, gridDistance: 5, bounds: { rows: 4, cols: 4 } });
  ctx.ok("reach: never off the scene", edge.cells.every((c) => c.i >= 0 && c.j >= 0 && c.i < 4 && c.j < 4));

  /* ---------------- other creatures ---------------- */
  const { occupancy, occupantClass, OCCUPANCY, DISPOSITION } = R;
  const F = DISPOSITION.FRIENDLY, H = DISPOSITION.HOSTILE;
  ctx.ok("occupancy: an ally passes, an enemy blocks, a bystander passes",
    occupantClass({ disposition: F }, { disposition: F }) === OCCUPANCY.PASS
    && occupantClass({ disposition: F }, { disposition: H }) === OCCUPANCY.BLOCK
    && occupantClass({ disposition: H }, { disposition: F }) === OCCUPANCY.BLOCK
    && occupantClass({ disposition: F }, { disposition: DISPOSITION.NEUTRAL }) === OCCUPANCY.PASS
    && occupantClass({ disposition: F }, { disposition: DISPOSITION.SECRET }) === OCCUPANCY.BLOCK);
  ctx.ok("occupancy: a tiny creature shares space, either way round",
    occupantClass({ disposition: F }, { disposition: H, tiny: true }) === OCCUPANCY.FREE
    && occupantClass({ disposition: F, tiny: true }, { disposition: H }) === OCCUPANCY.FREE);
  ctx.ok("occupancy: a flyer well above is not in the way, one at the mover's height is",
    occupantClass({ disposition: F, alt: 0, height: 1 }, { disposition: H, alt: 3, height: 1 }) === OCCUPANCY.FREE
    && occupantClass({ disposition: F, alt: 0, height: 1 }, { disposition: H, alt: 0.5, height: 1 }) === OCCUPANCY.BLOCK);
  ctx.ok("occupancy: nobody around is no occupancy at all", occupancy({ mover: {}, others: [] }) === null);
  const row = { start: { i: 0, j: 0 }, budget: 25, gridDistance: 5, bounds: { rows: 1, cols: 6 } };
  const allyRow = solveReach({ ...row, occupied: occupancy({ mover: { disposition: F }, others: [{ i: 0, j: 2, disposition: F }] }) });
  const allyPath = allyRow.pathTo(0, 3);
  ctx.ok("occupancy: through an ally, never ending there",
    allyRow.at(0, 2) === Infinity && allyRow.pathTo(0, 2) === null && near(allyRow.at(0, 3), 15)
    && !allyRow.cells.some((c) => c.i === 0 && c.j === 2)
    && !!allyPath && allyPath.some((p) => p.i === 0 && p.j === 2), JSON.stringify(allyPath));
  ctx.ok("occupancy: the readout says whose square it is", allyRow.occupied(0, 2) === OCCUPANCY.PASS && allyRow.occupied(0, 4) === OCCUPANCY.FREE);
  const foeRow = solveReach({ ...row, occupied: occupancy({ mover: { disposition: F }, others: [{ i: 0, j: 2, disposition: H }] }) });
  ctx.ok("occupancy: an enemy's square stops the row", foeRow.at(0, 3) === Infinity && foeRow.occupied(0, 2) === OCCUPANCY.BLOCK);
  const around = solveReach({ start: { i: 1, j: 0 }, budget: 25, gridDistance: 5, bounds: { rows: 3, cols: 6 },
    occupied: occupancy({ mover: { disposition: F }, others: [{ i: 1, j: 2, disposition: H }] }) });
  ctx.ok("occupancy: an enemy is walked around, at the longer route's cost",
    near(around.at(1, 3), 20) && !around.pathTo(1, 3).some((p) => p.i === 1 && p.j === 2), String(around.at(1, 3)));
  const tinyRow = solveReach({ ...row, occupied: occupancy({ mover: { disposition: F }, others: [{ i: 0, j: 2, disposition: H, tiny: true }] }) });
  ctx.ok("occupancy: a tiny enemy's square can be ended on", near(tinyRow.at(0, 2), 10));
  const bigFoe = solveReach({ start: { i: 0, j: 0 }, budget: 40, gridDistance: 5, bounds: { rows: 2, cols: 8 },
    occupied: occupancy({ mover: { disposition: F }, others: [{ i: 0, j: 2, w: 2, h: 2, disposition: H }] }) });
  ctx.ok("occupancy: a large enemy blocks every square it covers",
    [[0, 2], [0, 3], [1, 2], [1, 3]].every(([i, j]) => bigFoe.occupied(i, j) === OCCUPANCY.BLOCK) && bigFoe.at(0, 4) === Infinity && bigFoe.at(1, 4) === Infinity);
  const bigMover = solveReach({ start: { i: 0, j: 0 }, budget: 40, gridDistance: 5, bounds: { rows: 1, cols: 8 },
    occupied: occupancy({ mover: { w: 2, h: 2, disposition: F }, others: [{ i: 1, j: 3, disposition: F }] }) });
  ctx.ok("occupancy: a large mover cannot end with any part of it on an ally",
    bigMover.at(0, 2) === Infinity && bigMover.at(0, 3) === Infinity && near(bigMover.at(0, 4), 20));
  const onStart = solveReach({ ...row, occupied: occupancy({ mover: { disposition: F }, others: [{ i: 0, j: 0, disposition: H }] }) });
  ctx.ok("occupancy: the square the mover stands on is always its own", onStart.at(0, 0) === 0 && near(onStart.at(0, 1), 5));

  /* ---------------- bands ---------------- */
  const b = reachBudgets({ systemId: "pf2e", speed: 25, gridDistance: 5 });
  ctx.ok("reach: PF2e bands are one, two and three Strides", b.length === 3 && b[0] === 25 && b[2] === 75);
  ctx.ok("reach: band of a cost", reachBand(b, 25) === 1 && reachBand(b, 30) === 2 && reachBand(b, 75) === 3 && reachBand(b, 80) === 0);
  ctx.ok("reach: Daggerheart reads Close", reachBudgets({ systemId: "daggerheart", gridDistance: 5, daggerheart: ["daggerheart"] })[0] === 30);
  ctx.ok("reach: no Speed, no reach", reachBudgets({ systemId: "pf2e", speed: null }).length === 0
    && reachBudgets({ systemId: "dnd5e", speed: 30 }).length === 0);
  const t0 = Date.now();
  solveReach({ start: { i: 50, j: 50 }, budget: 120, gridDistance: 5 });
  const ms = Date.now() - t0;
  ctx.ok("reach: a 120 ft reach solves in well under a frame budget", ms < 80, `${ms} ms`);

  /* ---------------- wiring that fails silently ---------------- */
  const src = (rel) => readFileSync(join(ctx.root, rel), "utf8");
  const overlay = src("scripts/features/diorama/view/overlay.mjs");
  ctx.ok("reach: client settings are heard on clientSettingChanged", /on\("clientSettingChanged"/.test(overlay),
    "a client-scope setting never fires updateSetting");
  ctx.ok("reach: walls, regions and their behaviours refresh the reach",
    /RegionBehavior/.test(overlay) && /"createWall", "updateWall", "deleteWall"[\s\S]{0,80}queueReach/.test(overlay));
  const vReach = src("scripts/features/diorama/view/reach.mjs");
  ctx.ok("occupancy: only creatures this viewer can see are in the way (a hidden one would show its square)",
    /if \(!t\.isVisible \|\| \(seen && !seen\(d\.id\)\)/.test(vReach) && /others: occupantsOf\(tok, size, systemId, seen\)/.test(vReach));
  ctx.ok("occupancy: tiny is PF2e's rule, not every system's", /const isTiny = \(actor, systemId\) => systemId === PF2E/.test(vReach));
  ctx.ok("occupancy: viewing as the players, the board's own tokens decide, and the GM's hidden token has no range",
    /seen: onBoard/.test(overlay) && /if \(tok && onBoard && !onBoard\(tok\.id\)\) tok = null/.test(overlay));
  ctx.ok("occupancy: a creature arriving, leaving, moving or dying refreshes the range",
    /\["createToken", "deleteToken"\]\) on\(h, \(doc\) => \{ if \(here\(doc\) && S\.reach\) queueReach/.test(overlay)
    && /\(S\.reach \|\| doc\.object\?\.controlled\)\) queueReach/.test(overlay)
    && /\["createActiveEffect", "deleteActiveEffect"\]\) on\(h, \(\) => \{ if \(S\.reach\) queueReach/.test(overlay));
  const input = src("scripts/features/diorama/view/input.mjs");
  ctx.ok("hold: the drag sees through the token in the hand", /exclude: drag\.tok\.id/.test(input));
  ctx.ok("hold: a carried flyer reads the pointer at its altitude", /pickPlane\?\.\(ev\.clientX, ev\.clientY, drag\.elevQ\)/.test(input));
  ctx.ok("hold: a cancelled lift sets the figure back down", /clearDrag\(\{ keepHold = false \}/.test(input) && /drag\.start\.j \+ drag\.w \/ 2/.test(input));
  // Warn, never block: the drop is placed (no walk) and nothing Foundry would refuse refuses it.
  ctx.ok("drop: placed in one move, walls and cost ignored, no walk",
    /animate: false/.test(input) && /constrainOptions: \{ ignoreWalls: true, ignoreCost: true \}/.test(input));
  ctx.ok("drop: out of reach is warned in red, and still set down", /this\.drag\.tone = "peril"/.test(input)
    && /GLDIO\.move\.anyway/.test(input) && !/if \(!(drag|this\.drag)\.routed\)[^{]*return/.test(input.slice(input.indexOf("async commitDrag"))));
  const moveKeys = ["GLDIO.move.noRoute", "GLDIO.move.beyond", "GLDIO.move.anyway", "GLDIO.move.up", "GLDIO.move.down", "GLDIO.move.offBoard"];
  const moveLang = JSON.parse(src("lang/diorama.en.json"));
  ctx.ok("drop: every warning line resolves", moveKeys.every((k) => k in moveLang && input.includes(`"${k}"`)));
  ctx.ok("hold: a still hand keeps telling the table it holds (inside holdStale)",
    /setInterval\([\s\S]{0,160}sendHold[\s\S]{0,40}TIMING\.holdKeep/.test(input) && /clearInterval\(drag\.keep\)/.test(input));
  const sync = src("scripts/features/diorama/view/sync.mjs");
  ctx.ok("hold: a hidden token's pose goes to GMs only", /doc\?\.hidden \? all\.filter/.test(sync));
  ctx.ok("hold: the landing tone travels with the pose and is read back", /tone: pose\.tone/.test(sync) && /tone: typeof p\.tone === "string"/.test(overlay));
  ctx.ok("hold: a pose is drawn only for a token on this viewer's board, from its owner",
    /S\.tokenIds\.has\(doc\.id\)/.test(overlay) && /testUserPermission\(sender, "OWNER"\)/.test(overlay));
  const { validPayload } = await import(ctx.url("scripts/features/diorama/view/sync.mjs")).catch(() => ({}));
  if (validPayload) {
    ctx.ok("hold: payload shape", validPayload({ type: "hold", sceneId: "s", tokenId: "t", phase: "carry", x: 1, y: 2, footQ: 0 })
      && !validPayload({ type: "hold", sceneId: "s", tokenId: "t", phase: "fly", x: 1, y: 2, footQ: 0 })
      && !validPayload({ type: "hold", sceneId: "s", tokenId: "t", phase: "drop", x: NaN, y: 2, footQ: 0 }));
  }

  /* ---------------- options and lang ---------------- */
  const { OPTIONS } = await import(ctx.url("scripts/features/diorama/options.mjs"));
  const lang = JSON.parse(src("lang/diorama.en.json"));
  ctx.ok("options: one way to move (pick up and set down), no move style left over",
    !OPTIONS.some((x) => x.name === "moveStyle") && !Object.keys(lang).some((k) => k.startsWith("GLDIO.settings.moveStyle")));
  for (const name of ["reach"]) {
    const o = OPTIONS.find((x) => x.name === name);
    ctx.ok(`options: ${name} is a client option`, o?.scope === "client");
    const keys = [`GLDIO.settings.${name}.name`, `GLDIO.settings.${name}.hint`, ...(o?.choices ?? []).map((c) => `GLDIO.settings.${name}.${c}`)];
    const missing = keys.filter((k) => !(k in lang));
    ctx.ok(`options: ${name} labels resolve`, !missing.length, missing.join(", "));
  }

  /* ---------------- standees: pick parts and the held pose ---------------- */
  const sSrc = src("scripts/features/diorama/render/standees.mjs");
  ctx.ok("pick: a flyer is grabbable by its foot and squares on the ground",
    /add\(e\.foot, e, "ground"\)/.test(sSrc) && /add\(e\.footprint, e, "ground"\)/.test(sSrc));
  ctx.ok("pick: a flyer's figure and stand move it at altitude", /add\(e\.column, e, "air"\)/.test(sSrc) && /const air = e\.flying \? "air" : "ground"/.test(sSrc));
  ctx.ok("hold: a token update while held is remembered, not animated", /if \(e\.hold\) e\.heldTarget = \{ \.\.\.target \}/.test(sSrc));
  ctx.ok("hold: a walker in the hand shows no flight stand", /held \? e\.flying && airborne : airborne/.test(sSrc));
  ctx.ok("hold: lift and drop durations come from TIMING", /TIMING\.liftUp/.test(sSrc) && /TIMING\.liftDrop/.test(sSrc));
}
