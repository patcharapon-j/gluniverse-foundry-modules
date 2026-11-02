/**
 * Tactical readouts and spell-area volumes.
 *
 * PF2e's 3D distance against hand-counted cases (and Foundry's own
 * ALTERNATING_1 count, term for term), the falling-damage table, the line of
 * sight held ray for ray to terrain/occlusion.mjs, the line's drawn pieces,
 * the volume of an area kept inside its covered squares, and the gates that
 * keep a hidden creature's line or aura off a player's screen. Everything here
 * renders "fine" when it is wrong. Nothing here proves Foundry's own vision,
 * PF2e's distanceTo or the region shapes of a live scene; those need a session.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIO = "scripts/features/diorama";

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

/** A small deterministic generator, so a failure reproduces. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export default async function check(ctx) {
  const D = await import(ctx.url(`${DIO}/rules/distance3d.mjs`));
  const F = await import(ctx.url(`${DIO}/rules/fall.mjs`));
  const L = await import(ctx.url(`${DIO}/rules/los.mjs`));
  const O = await import(ctx.url(`${DIO}/terrain/occlusion.mjs`));
  const { Terrain } = await import(ctx.url(`${DIO}/terrain/model.mjs`));
  const { SUB, KIND, SHED_ORDER, TIMING } = await import(ctx.url(`${DIO}/constants.mjs`));

  /* ---------------- PF2e 3D distance ---------------- */
  const med = (x, y, elevation = 0) => ({ x: x * 100, y: y * 100, w: 100, h: 100, elevation, height: 5, actor: true });
  const dist = (a, b, o = {}) => D.pf2eDistance(a, b, { size: 100, distance: 5, ...o }).distance;
  ctx.ok("3D distance: adjacent is 5 ft", dist(med(0, 0), med(1, 0)) === 5);
  ctx.ok("3D distance: three squares east is 15 ft", dist(med(0, 0), med(3, 0)) === 15);
  ctx.ok("3D distance: two diagonals is 15 ft (5 + 10)", dist(med(0, 0), med(2, 2)) === 15);
  ctx.ok("3D distance: three diagonals is 20 ft (5 + 10 + 5)", dist(med(0, 0), med(3, 3)) === 20);
  // the flyer's feet 10 ft up, the walker's head at 5: 5 ft of air between, +1 square
  ctx.ok("3D distance: adjacent with the target 10 ft up is 10 ft", dist(med(0, 0), med(1, 0, 10)) === 10,
    JSON.stringify(D.pf2eDistance(med(0, 0), med(1, 0, 10)).counts));
  ctx.ok("3D distance: straight overhead at 20 ft is 20 ft", dist(med(0, 0), med(0, 0, 20)) === 20);
  ctx.ok("3D distance: same elevation ignores height", dist(med(0, 0), med(4, 0)) === 20 && dist(med(0, 0, 15), med(4, 0, 15)) === 20);
  ctx.ok("3D distance: a 3D double diagonal [2,2,2] is 15 ft", D.pf2eSquares(2, 2, 2) * 5 === 15);
  ctx.ok("3D distance: 10 ft reach reaches the second diagonal", D.pf2eSquares(2, 2, 0, { reach: 10 }) * 5 === 10
    && D.pf2eSquares(2, 2, 0) * 5 === 15 && D.pf2eSquares(1, 2, 0, { reach: 10 }) * 5 === 10);
  ctx.ok("3D distance: a Large creature is adjacent from its edge",
    dist({ x: 0, y: 0, w: 200, h: 200, elevation: 0, height: 10, actor: true }, med(2, 1)) === 5);
  ctx.ok("3D distance: a side without an actor counts no height", dist(med(0, 0), { ...med(1, 0, 30), actor: false }) === 5);
  let mismatch = 0;
  const r1 = rng(7);
  for (let n = 0; n < 2000; n++) {
    const a = Math.floor(r1() * 12), b = Math.floor(r1() * 12), c = Math.floor(r1() * 12);
    if (D.pf2eSquares(a, b, c) !== D.foundryAlternating(a, b, c)) mismatch++;
  }
  ctx.ok("3D distance: PF2e's count is Foundry's ALTERNATING_1, term for term", mismatch === 0, `${mismatch} differ`);

  /* ---------------- falling ---------------- */
  const dmg = (d, o) => F.pf2eFall(d, o).damage;
  const table = [[10, 5], [15, 7], [20, 10], [30, 15], [5, 0], [2.5, 0], [6, 3], [1500, 750], [2000, 750]];
  const badFalls = table.filter(([d, want]) => dmg(d) !== want).map(([d, want]) => `${d} ft: ${dmg(d)} (want ${want})`);
  ctx.ok("fall: half the drop over 5 ft, capped at 1,500 ft", badFalls.length === 0, badFalls.join("; "));
  ctx.ok("fall: any damage lands prone, none does not", F.pf2eFall(10).prone && !F.pf2eFall(5).prone);
  ctx.ok("fall: water counts 20 ft shorter", dmg(30, { soft: true }) === 5 && dmg(25, { soft: true }) === 0 && dmg(20, { soft: true }) === 0);
  ctx.ok("fall: never more off than the water is deep", dmg(30, { soft: true, depth: 10 }) === 10 && F.pf2eFall(30, { soft: true, depth: 10 }).reduction === 10);
  ctx.ok("fall: diving in counts 30 ft shorter", dmg(40, { soft: true, dove: true }) === 5);
  ctx.ok("fall: a soft landing never adds height", F.pf2eFall(10, { soft: true }).effective === 0);

  /* ---------------- line of sight ---------------- */
  const t = Terrain.blank(10, 10);
  const r2 = rng(11);
  for (let si = 0; si < t.sh; si++) for (let sj = 0; sj < t.sw; sj++) if (r2() < 0.18) t.set(si, sj, { h: Math.floor(r2() * 16) });
  let spanBad = 0, coverBad = 0;
  for (let n = 0; n < 1500; n++) {
    const a = { u: r2() * t.sw, v: r2() * t.sh, z: r2() * 16 }, b = { u: r2() * t.sw, v: r2() * t.sh, z: r2() * 16 };
    const blocked = O.rayBlocked(t, a, b) !== null, spans = L.blockedSpans(t, a, b);
    if (blocked !== spans.length > 0) spanBad++;
    if (spans.some((s) => !(s.t0 >= 0 && s.t1 <= 1 && s.t1 > s.t0))) spanBad++;
  }
  ctx.ok("sight: a ray has a blocked stretch exactly when occlusion says it is blocked", spanBad === 0, `${spanBad} differ`);
  for (let n = 0; n < 400; n++) {
    const from = { x: r2() * 1000, y: r2() * 1000, eyeQ: r2() * 12 };
    const to = { x: r2() * 1000, y: r2() * 1000, footQ: r2() * 8, heightQ: 4 + r2() * 4, radiusPx: 50 };
    const mine = L.lineOfSight(t, from, to, 100), theirs = O.coverBetween(t, from, to, 100);
    if (mine.cover !== theirs.cover || mine.lineOfSight !== theirs.lineOfSight || mine.blocked !== theirs.blocked) coverBad++;
  }
  ctx.ok("sight: the badge is terrain/occlusion.mjs's cover, ray for ray", coverBad === 0, `${coverBad} differ`);
  ctx.ok("sight: cover classes (none, standard, greater, no line)",
    L.classifyCover(0, 5).cover === "none" && L.classifyCover(1, 5).cover === "standard" && L.classifyCover(2, 5).cover === "standard"
    && L.classifyCover(3, 5).cover === "greater" && L.classifyCover(5, 5).lineOfSight === false);
  ctx.ok("sight: PF2e cover bonuses are +2 standard, +4 greater", L.COVER_AC.standard === 2 && L.COVER_AC.greater === 4 && L.COVER_AC.none === 0);
  // a wall between: every ray crosses it, so no line of sight, and the line shows where
  const open = Terrain.blank(10, 10);
  const walled = L.lineOfSight(open, { x: 150, y: 450, eyeQ: 5 }, { x: 750, y: 450, footQ: 0, heightQ: 6, radiusPx: 50 }, 100,
    { walls: [{ ax: 450, ay: 0, bx: 450, by: 1000 }] });
  ctx.ok("sight: a sight wall across the line blocks every ray", !walled.lineOfSight && walled.blocked === 5
    && walled.line.spans.length === 1 && Math.abs((walled.line.spans[0].t0 + walled.line.spans[0].t1) / 2 - 0.5) < 1e-6);
  // a ridge between two creatures on open ground: the centre line runs into it
  const ridge = Terrain.blank(10, 10);
  for (let si = 0; si < ridge.sh; si++) for (let sj = 8; sj < 10; sj++) ridge.set(si, sj, { h: 16 });
  const behind = L.lineOfSight(ridge, { x: 150, y: 450, eyeQ: 5 }, { x: 850, y: 450, footQ: 0, heightQ: 6, radiusPx: 50 }, 100);
  const pieces = L.lineStyles(behind.line.spans);
  ctx.ok("sight: a line into a ridge is clear, then blocked, then beyond",
    pieces.map((p) => p.style).join(",") === "clear,blocked,beyond" && pieces[0].t0 === 0 && pieces.at(-1).t1 === 1,
    JSON.stringify(pieces));
  ctx.ok("sight: an unblocked line is one clear piece", L.lineStyles([]).length === 1 && L.lineStyles([])[0].style === "clear");
  const flush = L.lineStyles([{ t0: 0.2, t1: 1 }]);
  ctx.ok("sight: a line that ends inside the block has no beyond", flush.map((p) => p.style).join(",") === "clear,blocked");

  /* ---------------- the view's readouts and their gates ---------------- */
  const V = await import(ctx.url(`${DIO}/view/tactics.mjs`));
  const { seams } = await import(ctx.url(`${DIO}/view/seams.mjs`));
  const scene = {};
  const tok = (id, o = {}) => ({ id, isVisible: true, controlled: false, document: { parent: scene, elevation: 0 }, ...o });
  const me = tok("me", { controlled: true });
  const seen = tok("seen"), hidden = tok("hidden", { isVisible: false }), elsewhere = tok("far", { document: { parent: {} } });
  ctx.ok("gate: a visible token may be measured to", V.mayMeasure(me, seen));
  ctx.ok("gate: a token Foundry hides from this viewer is never measured to", !V.mayMeasure(me, hidden));
  ctx.ok("gate: nothing is measured while the GM views as the players", !V.mayMeasure(me, seen, { asPlayers: true }));
  ctx.ok("gate: not to itself, nor across scenes", !V.mayMeasure(me, me) && !V.mayMeasure(me, elsewhere));
  const prev = seams.cover;
  const calls = [];
  seams.cover = {
    tacticsBetween: (a, b) => {
      calls.push(b.id);
      return { cover: "standard", lineOfSight: true, blocked: 1, total: 5, distance: 15, rise: 10,
        line: { a: { x: 0, y: 0, zQ: 5 }, b: { x: 300, y: 0, zQ: 3 }, spans: [{ t0: 0.4, t1: 0.6 }], clear: false } };
    },
  };
  const keyT = (k, d) => (d ? `${k}${JSON.stringify(d)}` : k);
  const out = V.sightReadouts({ from: me, hovered: hidden, targets: [seen, hidden, elsewhere], grid: { distance: 5, units: "ft" }, systemId: "pf2e", t: keyT });
  seams.cover = prev;
  ctx.ok("gate: a hidden hovered or targeted token gets no line and no label",
    calls.join(",") === "seen" && out.labels.length === 1 && out.labels[0].tokenId === "seen" && out.lines.length === 1, calls.join(","));
  const lab = out.labels[0]?.lines ?? [];
  ctx.ok("readout: distance, height and a cover badge with its AC",
    lab.length === 3 && /GLDIO\.tactics\.above/.test(lab[1]) && lab[2]?.chip === "warn" && /GLDIO\.tactics\.coverAc/.test(lab[2]?.text ?? ""), JSON.stringify(lab));
  ctx.ok("readout: the line is broken where it is blocked",
    out.lines[0]?.pieces.map((p) => p.style).join(",") === "clear,blocked,beyond");
  ctx.ok("readout: badge tones (none info, standard warn, greater hazard, no line peril)",
    V.sightTone({ cover: "none", lineOfSight: true }) === "info" && V.sightTone({ cover: "standard", lineOfSight: true }) === "warn"
    && V.sightTone({ cover: "greater", lineOfSight: true }) === "hazard" && V.sightTone({ cover: "greater", lineOfSight: false }) === "peril");
  ctx.ok("readout: an unchanged readout has the same key", V.linesKey(out.lines) === V.linesKey(JSON.parse(JSON.stringify(out.lines))) && V.linesKey([]) === "");
  ctx.ok("readout: flyers do not fall", V.isFlying(5, "walk") && V.isFlying(0, "fly") && !V.isFlying(0, "walk"));

  // a drop off a 10 ft plateau, and the same drop into water
  const cliff = Terrain.blank(6, 6);
  for (let si = 0; si < cliff.sh; si++) for (let sj = 0; sj < 2 * SUB; sj++) cliff.set(si, sj, { h: 8 });
  const { analyzePath } = await import(ctx.url(`${DIO}/rules/path.mjs`));
  const route = [{ i: 2, j: 1 }, { i: 2, j: 2 }, { i: 2, j: 3 }];
  const an = analyzePath(cliff, route, { distance: 5 });
  const fr = V.fallReadouts({ terrain: cliff, cells: route, falls: an.falls, grid: { size: 100, distance: 5, units: "ft" }, systemId: "pf2e", t: keyT });
  ctx.ok("fall preview: one drop line, from the lip down to the ground", fr.lines.length === 1 && fr.lines[0].a.zQ === 8 && fr.lines[0].b.zQ === 0
    && fr.lines[0].a.x === 200 && fr.lines[0].a.y === 250, JSON.stringify(fr.lines[0]));
  ctx.ok("fall preview: 10 ft is 5 bludgeoning, prone", /"damage":5/.test(fr.labels[0]?.lines?.[1]?.text ?? "") && fr.labels[0]?.lines?.[1]?.chip === "hazard",
    JSON.stringify(fr.labels[0]?.lines));
  for (let si = 0; si < cliff.sh; si++) for (let sj = 2 * SUB; sj < 3 * SUB; sj++) cliff.set(si, sj, { kind: KIND.WATER });
  const wet = analyzePath(cliff, route, { distance: 5 });
  const fw = V.fallReadouts({ terrain: cliff, cells: route, falls: wet.falls, grid: { size: 100, distance: 5, units: "ft" }, systemId: "pf2e", t: keyT });
  ctx.ok("fall preview: into water, no damage and the depth condition said", wet.falls[0]?.intoWater === true
    && fw.labels[0]?.lines?.[1]?.text === "GLDIO.tactics.fallSafe" && /GLDIO\.tactics\.fallWater/.test(fw.labels[0]?.lines?.[2] ?? ""), JSON.stringify(fw.labels[0]?.lines));
  const other = V.fallReadouts({ terrain: cliff, cells: route, falls: an.falls, grid: { size: 100, distance: 5, units: "ft" }, systemId: "dnd5e", t: keyT });
  ctx.ok("fall preview: another system shows the drop only", other.labels[0]?.lines?.length === 1);

  /* ---------------- areas ---------------- */
  const T = await import(ctx.url(`${DIO}/integrations/templates.mjs`));
  const regionDoc = (o = {}) => ({ hidden: false, visibility: 2, attachment: null, ...o });
  ctx.ok("area gate: the GM sees every area", T.mayShowArea(regionDoc({ hidden: true }), { visible: false }, { isGM: true }));
  ctx.ok("area gate: a hidden area is never a player's", !T.mayShowArea(regionDoc({ hidden: true }), null, { isGM: false }));
  ctx.ok("area gate: one Foundry does not show this player stays off", !T.mayShowArea(regionDoc(), { visible: false }, { isGM: false }));
  ctx.ok("area gate: viewing as the players shows only areas visible to everyone",
    !T.mayShowArea(regionDoc({ visibility: 1 }), { visible: true }, { isGM: true, asPlayers: true })
    && T.mayShowArea(regionDoc({ visibility: 2 }), { visible: true }, { isGM: true, asPlayers: true }));
  ctx.ok("area gate: an aura of a creature not on the board is not drawn",
    !T.mayShowArea(regionDoc({ attachment: { token: "ghost" } }), null, { isGM: false, tokenSeen: () => false })
    && !T.mayShowArea(regionDoc({ attachment: { token: { id: "x", hidden: true } } }), null, { isGM: false, tokenSeen: () => true })
    && T.mayShowArea(regionDoc({ attachment: { token: "pal" } }), null, { isGM: false, tokenSeen: (id) => id === "pal" }));
  const cone = T.areaParams({ geometry: { shapeId: 1, origin: { x: 450, y: 450 }, radius: 3, direction: 0, angle: Math.PI / 2, base: [0, 0] }, size: 100, apex: { x: 500, y: 450 } });
  ctx.ok("area params: a cone takes PF2e's apex", cone.kind === "cone" && cone.origin.x === 500 && cone.radius === 3);
  ctx.ok("area params: a shape read without pf2e-aoe", T.areaParams({ shape: { type: "circle", x: 400, y: 400, radius: 200 }, size: 100 }).kind === "burst"
    && T.areaParams({ shape: { type: "circle", radius: 200 }, size: 100 }).radius === 2
    && T.areaParams({ shape: { type: "line", width: 100 }, size: 100 }).kind === "line"
    && T.areaParams({ shape: { type: "polygon" }, size: 100 }).kind === "flat");

  const A = await import(ctx.url(`${DIO}/render/areas.mjs`));
  // PF2e burst coverage, restated: centres within R by 5/10/5, from a grid intersection
  const pf2eBurst = (oi, oj, R) => {
    const out = [];
    for (let i = oi - R - 1; i <= oi + R; i++) for (let j = oj - R - 1; j <= oj + R; j++) {
      const di = Math.ceil(Math.abs(i + 0.5 - oi)), dj = Math.ceil(Math.abs(j + 0.5 - oj));
      if (D.pf2eSquares(di, dj, 0) <= R) out.push({ i, j });
    }
    return out;
  };
  // a plateau 2 cells (8 q) high over rows 0..5, cols 6..11; the burst's origin on it
  const top = (i, j) => (i >= 0 && i <= 5 && j >= 6 && j <= 11 ? 8 : 0);
  const cellsB = pf2eBurst(3, 8, 3);
  const burst = A.normalizeArea({ id: "b", kind: "burst", cells: cellsB, origin: { x: 800, y: 300 }, radius: 3, color: "#ff8800" }, 100);
  const gB = A.buildAreaGeometry(burst, top);
  const insideCovered = (g, area) => {
    let bad = 0;
    for (let v = 0; v < g.position.length; v += 3) {
      const x = g.position[v], z = g.position[v + 2];
      const ok = area.cells.some((c) => x >= c.j - 1e-6 && x <= c.j + 1 + 1e-6 && z >= c.i - 1e-6 && z <= c.i + 1 + 1e-6);
      if (!ok) bad++;
    }
    return bad;
  };
  ctx.ok("area volume: every vertex lies on a covered square (the staircase, not the circle)", insideCovered(gB, burst) === 0);
  ctx.ok("area volume: a burst on a plateau stands on the plateau", Math.abs(gB.ref - 2.012) < 1e-9 && Math.abs(Math.max(...gB.position.filter((_, k) => k % 3 === 1)) - (2 + 3 + 0.012)) < 0.05,
    `ref ${gB.ref}`);
  // every covered square is at least a skin above its own ground
  let thin = 0;
  for (let v = 0; v < gB.aKind.length; v++) {
    if (gB.aKind[v] !== 0) continue;
    const x = gB.position[v * 3], y = gB.position[v * 3 + 1], z = gB.position[v * 3 + 2];
    const ground = Math.max(...burst.cells.filter((c) => x >= c.j - 1e-6 && x <= c.j + 1 + 1e-6 && z >= c.i - 1e-6 && z <= c.i + 1 + 1e-6).map((c) => top(c.i, c.j) / 4));
    if (y < ground + A.SKIN - 1e-6 && y < ground + A.SKIN - 0.5) thin++;
  }
  ctx.ok("area volume: no covered square is left bare", thin === 0, `${thin} vertices under the skin`);
  let flipped = 0;
  for (let k = 0; k < gB.index.length; k += 3) {
    const [a, b, c] = [gB.index[k], gB.index[k + 1], gB.index[k + 2]];
    const P = (v) => [gB.position[v * 3], gB.position[v * 3 + 1], gB.position[v * 3 + 2]];
    const p = P(a), q = P(b), r = P(c);
    const u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r[0] - p[0], r[1] - p[1], r[2] - p[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const want = [gB.normal[a * 3], gB.normal[a * 3 + 1], gB.normal[a * 3 + 2]];
    if (gB.aKind[a] === 0 && n[1] < -1e-9) flipped++;
    if (gB.aKind[a] === 1 && n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < -1e-9) flipped++;
  }
  ctx.ok("area volume: tops face up and walls face out", flipped === 0, `${flipped} flipped`);
  const H = A.heightFn(burst);
  ctx.ok("area volume: a burst is a sphere about its origin", Math.abs(H(8, 3) - 3) < 1e-9 && H(11, 3) === 0 && Math.abs(H(9, 3) - Math.sqrt(8)) < 1e-9);
  const em = A.normalizeArea({ kind: "emanation", cells: [{ i: 0, j: 0 }], origin: { x: 50, y: 50 }, radius: 2, base: [0.5, 0.5] }, 100);
  const He = A.heightFn(em);
  ctx.ok("area volume: an emanation is measured from the edge of its source", He(0.5, 0.5) === 2 && He(0.9, 0.2) === 2 && Math.abs(He(2, 0.5) - Math.sqrt(3)) < 1e-9);
  const co = A.normalizeArea({ kind: "cone", cells: [{ i: 5, j: 1 }], origin: { x: 0, y: 500 }, radius: 3, direction: 0, angle: Math.PI / 2 }, 100);
  const Hc = A.heightFn(co);
  ctx.ok("area volume: a cone widens from its apex and stops at its length", Math.abs(Hc(2, 5) - 2) < 1e-9 && Hc(-1, 5) === 0 && Hc(3.5, 5) === 0
    && Math.abs(Hc(1, 5) - 1) < 1e-9);
  const lineA = A.normalizeArea({ kind: "line", cells: [{ i: 0, j: 0 }, { i: 0, j: 1 }, { i: 0, j: 2 }] }, 100);
  const gL = A.buildAreaGeometry(lineA, () => 0);
  ctx.ok("area volume: a line is a slab over its squares", insideCovered(gL, lineA) === 0
    && Math.abs(Math.max(...gL.position.filter((_, k) => k % 3 === 1)) - (A.LINE_H + 0.012)) < 1e-6);
  ctx.ok("area volume: an empty area builds nothing", A.normalizeArea({ kind: "burst", cells: [] }) === null && A.buildAreaGeometry(null, () => 0).index.length === 0);
  ctx.ok("area volume: an unknown shape draws as a low slab", A.normalizeArea({ kind: "ring", cells: [{ i: 0, j: 0 }] }).kind === "flat");

  /* ---------------- materials, budget, purity ---------------- */
  const { declaredUniforms } = await import(ctx.url(`${DIO}/render/glsl.mjs`));
  const RT = await import(ctx.url(`${DIO}/render/tactics.mjs`));
  const need = (src, u) => declaredUniforms(src).filter((n) => !(n in u) || u[n].value === undefined);
  const lu = RT.lineUniforms(), mu = RT.markUniforms(), au = A.areaUniforms();
  ctx.ok("materials: the sight line's uniforms all have values", need(RT.TACTICS_VERT + RT.TACTICS_FRAG, lu).length === 0, need(RT.TACTICS_VERT + RT.TACTICS_FRAG, lu).join(","));
  ctx.ok("materials: the line ends' uniforms all have values", need(RT.MARK_VERT + RT.MARK_FRAG, mu).length === 0);
  ctx.ok("materials: the area volume's uniforms all have values", need(A.AREA_VERT + A.AREA_FRAG, au).length === 0, need(A.AREA_VERT + A.AREA_FRAG, au).join(","));
  ctx.ok("materials: the area program reads its glow and its hairlines",
    ["uPhase", "uMotion", "uRimPx", "uContourPx", "uRef", "uPeak"].every((u) => new RegExp(`\\b${u}\\b`).test(A.AREA_FRAG)));
  const meshes = RT.tacticsMeshes([{ id: "x", a: { x: 0, y: 0, zQ: 4 }, b: { x: 500, y: 0, zQ: 2 }, color: "#ffaa00", pieces: L.lineStyles([{ t0: 0.3, t1: 0.5 }]) }], 100);
  ctx.ok("lines: a broken line is three pieces and four end marks (eye, aim, where it stops)",
    meshes.length === 2 && meshes[0].geometry.index.count === 18 && meshes[1].geometry.attributes.position.count === 3);
  for (const m of meshes) { m.geometry.dispose(); m.material.dispose(); }
  ctx.ok("lines: widths are device px, read from the drawing buffer", /getDrawingBufferSize/.test(readFileSync(join(ctx.root, `${DIO}/render/tactics.mjs`), "utf8")));
  ctx.ok("budget: areaMotion is a shed name", SHED_ORDER.includes("areaMotion"));
  ctx.ok("budget: the glow band's loop is a TIMING", Number(TIMING.areaDrift) > 0);
  const asrc = stripComments(readFileSync(join(ctx.root, `${DIO}/render/areas.mjs`), "utf8"));
  ctx.ok("budget: the glow band turns once per whole loop and stops when shed", /now % P\) \/ P/.test(asrc) && /return motion;/.test(asrc));
  const rsrc = stripComments(readFileSync(join(ctx.root, `${DIO}/render/renderer.mjs`), "utf8"));
  ctx.ok("budget: the renderer draws areas from fx (areaVolumes and areaMotion)",
    /areaMotion: g\.areaVolumes !== false && shed\.areaMotion/.test(rsrc) && /this\.areas\.frame\(t, fx\)/.test(rsrc));
  const { OPTIONS, resolveGraphics } = await import(ctx.url(`${DIO}/options.mjs`));
  ctx.ok("options: tactics and areaVolumes are client toggles, on by default",
    ["tactics", "areaVolumes"].every((n) => { const o = OPTIONS.find((x) => x.name === n); return o?.scope === "client" && o.type === "boolean" && o.default === true; })
    && resolveGraphics({}).areaVolumes === true && resolveGraphics({ areaVolumes: false }).areaVolumes === false);
  const lang = JSON.parse(readFileSync(join(ctx.root, "lang/diorama.en.json"), "utf8"));
  const keys = ["tactics", "areaVolumes"].flatMap((n) => [`GLDIO.settings.${n}.name`, `GLDIO.settings.${n}.hint`]);
  ctx.ok("lang: the two toggles are named and explained", keys.every((k) => typeof lang[k] === "string" && lang[k]), keys.filter((k) => !lang[k]).join(","));

  // the drag path keeps its fall preview and its flyer gate
  const isrc = stripComments(readFileSync(join(ctx.root, `${DIO}/view/input.mjs`), "utf8"));
  ctx.ok("input: the drag path previews falls, never for a flyer",
    /isFlying\(Seam\.altitude\(doc\), wps\[0\]\.action\)/.test(isrc) && /fallReadouts\(/.test(isrc) && /falls: fr\.lines/.test(isrc));
  ctx.ok("input: hover and targets go through the gated readout", /sightReadouts\(\{/.test(isrc) && /asPlayers: this\.ctx\.asPlayers\(\)/.test(isrc));
  const osrc = stripComments(readFileSync(join(ctx.root, `${DIO}/view/overlay.mjs`), "utf8"));
  ctx.ok("overlay: areas are read with the board's tokens, and re-read when they change",
    /tokenSeen: \(id\) => S\.tokenIds\.has\(id\)/.test(osrc) && /setAreas\?\.\(areas\)/.test(osrc) && /d\.add\("cells"\)/.test(osrc));
}
