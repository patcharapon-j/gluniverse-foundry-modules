/**
 * Renderer: purity, uniforms, shedding, and the terrain geometry builder.
 *
 * Everything here fails silently in a browser: a uniform declared and never
 * written holds the driver's initial value, a shed name never asked never
 * degrades, a side face emitted toward a higher neighbour draws a cliff inside
 * the hill, and a renderer that reads `game` breaks the preview that is the
 * only place its look is judged.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const RENDER_DIR = "scripts/features/diorama/render";

/** Source with JS comments removed (strings are left alone; good enough here). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/[^\n]*/g, "$1");
}

export default async function check(ctx) {
  const dir = join(ctx.root, RENDER_DIR);
  const files = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
  const sources = Object.fromEntries(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
  ctx.ok("render/ has the contract module", files.includes("renderer.mjs") && files.includes("three.mjs"));

  // ---- purity -----------------------------------------------------------
  const banned = /(?<![\w.$])(game|canvas|foundry|ui|Hooks|CONFIG)\s*\./g;
  for (const [f, src] of Object.entries(sources)) {
    const hits = [...stripComments(src).matchAll(banned)].map((m) => m[0]);
    ctx.ok(`render/${f} is pure`, hits.length === 0, hits.join(", "));
    const threeImports = [...src.matchAll(/from\s+["']([^"']*three[^"']*)["']/g)].map((m) => m[1]);
    const bad = threeImports.filter((p) => f === "three.mjs" ? !p.includes("vendor/three") : p !== "./three.mjs");
    ctx.ok(`render/${f} imports three only via render/three.mjs`, bad.length === 0, bad.join(", "));
  }

  // ---- imports under Node ----------------------------------------------
  const R = await import(ctx.url(`${RENDER_DIR}/renderer.mjs`));
  const api = ["setGrid", "setTerrain", "setBackground", "setWalls", "setTokens", "setLighting", "setOverlays",
    "setEffects", "setCamera", "getCamera", "setOptions", "setShed", "requestRender", "pick", "project", "resize", "dispose"];
  const missing = api.filter((m) => typeof R.DioramaRenderer?.prototype?.[m] !== "function");
  ctx.ok("renderer imports under Node with the full contract", missing.length === 0, missing.join(", "));

  // ---- uniforms ---------------------------------------------------------
  const { PROGRAMS, declaredUniforms } = await import(ctx.url(`${RENDER_DIR}/glsl.mjs`));
  const { MATERIALS, MATERIAL_PROGRAM, createShared } = await import(ctx.url(`${RENDER_DIR}/materials.mjs`));
  const shared = createShared();
  const used = new Set();
  for (const [name, make] of Object.entries(MATERIALS)) {
    const prog = PROGRAMS[MATERIAL_PROGRAM[name]];
    if (!ctx.ok(`material ${name} names a program`, !!prog)) continue;
    used.add(MATERIAL_PROGRAM[name]);
    const m = make(shared);
    const declared = [...new Set([...declaredUniforms(prog.vertex), ...declaredUniforms(prog.fragment)])];
    const unset = declared.filter((u) => !m.uniforms || !(u in m.uniforms) || m.uniforms[u].value === undefined);
    ctx.ok(`material ${name}: every declared uniform has a value`, unset.length === 0, unset.join(", "));
    ctx.ok(`material ${name}: declares something to check`, name === "depth" || declared.length > 0);
    m.dispose();
  }
  const orphan = Object.keys(PROGRAMS).filter((p) => !used.has(p));
  ctx.ok("every GLSL program is built by a material", orphan.length === 0, orphan.join(", "));
  // Shared uniforms the renderer must keep writing at runtime (not constants).
  const runtime = Object.keys(shared).filter((k) => !["uKeyDir", "uGroundColor"].includes(k));
  const js = Object.entries(sources).filter(([f]) => f !== "materials.mjs" && f !== "glsl.mjs").map(([, s]) => stripComments(s)).join("\n");
  const unwritten = runtime.filter((u) => !new RegExp(`\\b${u}\\.value\\b`).test(js));
  ctx.ok("every runtime shared uniform is written from JS", unwritten.length === 0, unwritten.join(", "));
  // Each declared uniform appears in a GLSL program at all (no dead JS uniforms in shared).
  const allGlsl = Object.values(PROGRAMS).map((p) => p.vertex + p.fragment).join("\n");
  const dead = Object.keys(shared).filter((u) => !allGlsl.includes(u));
  ctx.ok("no shared uniform is unused by GLSL", dead.length === 0, dead.join(", "));

  // ---- shedding ---------------------------------------------------------
  const { SHED_ORDER, KIND, DIR, SUB } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const rsrc = stripComments(sources["renderer.mjs"]);
  const unasked = SHED_ORDER.filter((n) => !rsrc.includes(`allows("${n}")`));
  ctx.ok("every SHED_ORDER name is consulted", unasked.length === 0, unasked.join(", "));
  ctx.ok("the ladder is bound with Budget.ladder", /Budget\.ladder\(\s*FEATURE_ID\s*,\s*SHED_ORDER\s*\)/.test(rsrc));
  ctx.ok("motion is claimed and released", /claimMotion\(FEATURE_ID, on\)/.test(rsrc) && /this\.claim\(false\)/.test(rsrc));
  ctx.ok("no loop without requestAnimationFrame", /hasRaf\(\)/.test(rsrc));
  const rawMs = Object.entries(sources).filter(([f]) => f !== "post.mjs")
    .flatMap(([f, s]) => [...stripComments(s).matchAll(/\b(setTimeout|setInterval)\s*\(/g)].map(() => f));
  ctx.ok("no timers: animation runs on the frame clock", rawMs.length === 0, rawMs.join(", "));

  // ---- terrain geometry -------------------------------------------------
  const { Terrain } = await import(ctx.url("scripts/features/diorama/terrain/model.mjs"));
  const { buildTerrainMesh } = await import(ctx.url(`${RENDER_DIR}/terrain-mesh.mjs`));

  const sane = (label, m) => {
    for (const key of ["tops", "sides", "water"]) {
      const g = m[key];
      let finite = true;
      for (const k of Object.keys(g.itemSize)) for (const v of g[k]) if (!Number.isFinite(v)) { finite = false; break; }
      ctx.ok(`${label}: ${key} has no NaN`, finite);
      ctx.ok(`${label}: ${key} indices in range`, g.index.every((i) => i < g.count) && g.index.length === g.quads * 6);
      if (key === "water") continue;
      // winding agrees with the stored normal
      let bad = 0;
      for (let i = 0; i < g.index.length; i += 3) {
        const [a, b, c] = [g.index[i], g.index[i + 1], g.index[i + 2]];
        const P = (v) => [g.position[v * 3], g.position[v * 3 + 1], g.position[v * 3 + 2]];
        const A = P(a), B = P(b), C = P(c);
        const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
        if (n[0] * g.normal[a * 3] + n[1] * g.normal[a * 3 + 1] + n[2] * g.normal[a * 3 + 2] < -1e-9) bad++;
      }
      ctx.ok(`${label}: ${key} winding faces its normal`, bad === 0, `${bad} flipped`);
    }
  };

  const flat = Terrain.blank(2, 2);
  const mf = buildTerrainMesh(flat, { meta: true });
  sane("flat 2×2", mf);
  ctx.ok("flat 2×2: one merged top per sub-row", mf.stats.topQuads === 2 * SUB, JSON.stringify(mf.stats));
  ctx.ok("flat 2×2: a side per perimeter sub-edge, down to the base", mf.stats.sideQuads === 4 * 2 * SUB
    && mf.baseY === -1, JSON.stringify(mf.stats));
  ctx.ok("flat 2×2: no water", mf.stats.waterQuads === 0);

  // A small scene: plateau, a void cell, water, stairs.
  const t = Terrain.blank(4, 4, (i, j) => !(i === 3 && j === 3));
  for (let si = 0; si < 4; si++) for (let sj = 0; sj < 4; sj++) t.set(si, sj, { h: 8 });
  for (let a = 0; a < SUB; a++) t.set(4, a, { h: 6 - a * 0, kind: KIND.STAIRS, dir: DIR.S });
  t.set(5, 0, { h: 3, kind: KIND.RAMP, dir: DIR.S });
  t.set(6, 2, { h: -1, kind: KIND.WATER });
  const m = buildTerrainMesh(t, { meta: true });
  sane("scene", m);
  // Void: nothing drawn over the void cell's interior.
  const inVoid = (x, z) => x > 3 + 1e-3 && x < 4 - 1e-3 && z > 3 + 1e-3 && z < 4 - 1e-3;
  let voidHits = 0;
  for (const g of [m.tops, m.water]) {
    for (let v = 0; v < g.count; v++) if (inVoid(g.position[v * 3], g.position[v * 3 + 2])) voidHits++;
  }
  ctx.ok("void sub-cells emit no tops or water", voidHits === 0, `${voidHits} vertices`);
  ctx.ok("water emits one surface per water sub-cell", m.stats.waterQuads === 1);
  // Sides only toward lower (or void / off-map) neighbours, and facing them.
  let wrong = 0, misfacing = 0;
  const lowerOf = (si, sj) => (t.inBounds(si, sj) && !t.isVoid(si, sj) ? t.topAt(si, sj) : -Infinity);
  m.sideMeta.forEach(([si, sj, nsi, nsj], q) => {
    if (si === nsi && sj === nsj) return; // a riser inside a stairs sub-cell
    // water shows its bed, and two slopes side by side compare step by step
    const special = (i, j) => [KIND.WATER, KIND.STAIRS, KIND.RAMP].includes(t.kindAt(i, j));
    const exempt = t.inBounds(nsi, nsj) && (special(nsi, nsj) || special(si, sj));
    if (!exempt && !(lowerOf(nsi, nsj) < t.topAt(si, sj))) wrong++;
    const v = m.sides.index[q * 6];
    const nx = m.sides.normal[v * 3], nz = m.sides.normal[v * 3 + 2];
    if (Math.round(nx) !== nsj - sj || Math.round(nz) !== nsi - si) misfacing++;
  });
  ctx.ok("sides only where the neighbour is lower", wrong === 0, `${wrong} sides`);
  ctx.ok("sides face the lower neighbour", misfacing === 0, `${misfacing} sides`);
  // Every floor-to-lower-floor boundary has a side.
  let gaps = 0;
  const has = new Set(m.sideMeta.map((s) => s.join(",")));
  for (let si = 0; si < t.sh; si++) for (let sj = 0; sj < t.sw; sj++) {
    if (t.kindAt(si, sj) !== KIND.FLOOR) continue;
    for (const [di, dj] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
      const ni = si + di, nj = sj + dj;
      if (!t.inBounds(ni, nj) || t.kindAt(ni, nj) !== KIND.FLOOR) continue;
      if (t.topAt(ni, nj) < t.topAt(si, sj) && !has.has([si, sj, ni, nj].join(","))) gaps++;
    }
  }
  ctx.ok("every drop between floors has a side", gaps === 0, `${gaps} missing`);
  // Stairs draw steps: more than one top quad per stairs sub-cell with a drop.
  const stairsTops = (() => {
    let n = 0;
    for (let v = 0; v < m.tops.count; v += 4) {
      const x = m.tops.position[v * 3], z = m.tops.position[v * 3 + 2];
      if (z >= 2 - 1e-6 && z <= 2.5 + 1e-6 && x >= 0 && x <= 1 + 1e-6 && m.tops.position[v * 3 + 1] < 2 + 1e-6) n++;
    }
    return n;
  })();
  ctx.ok("stairs draw treads", stairsTops >= 4, `${stairsTops} quads`);
  // Ramps tilt.
  const tilted = (() => {
    for (let v = 0; v < m.tops.count; v++) if (Math.abs(m.tops.normal[v * 3 + 1]) < 0.999) return true;
    return false;
  })();
  ctx.ok("ramps draw a slope", tilted);

  // ---- walls ------------------------------------------------------------
  const { outwardNormals } = await import(ctx.url(`${RENDER_DIR}/walls.mjs`));
  const room = [
    { id: "n", a: [0, 0], b: [400, 0] }, { id: "e", a: [400, 0], b: [400, 400] },
    { id: "s", a: [400, 400], b: [0, 400] }, { id: "w", a: [0, 400], b: [0, 0] },
    { id: "fence", a: [800, 0], b: [1200, 0] },
  ];
  const out = outwardNormals(room);
  const expect = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
  const off = Object.entries(expect).filter(([id, v]) => Math.round(out.get(id)[0]) !== v[0] || Math.round(out.get(id)[1]) !== v[1]);
  ctx.ok("a room's walls face outward", off.length === 0, off.map(([id]) => `${id}=${out.get(id)}`).join(" "));
  ctx.ok("a lone wall has no outward side (never cut)", out.get("fence")[0] === 0 && out.get("fence")[1] === 0);

  // ---- camera -----------------------------------------------------------
  const { yawOf, CameraRig } = await import(ctx.url(`${RENDER_DIR}/camera.mjs`));
  ctx.ok("yaw step 0 is the classic diagonal", Math.abs(yawOf(0) - Math.PI / 4) < 1e-9);
  const rig = new CameraRig();
  rig.set({ yawStep: 9, pitchIndex: 7, zoom: 99, target: { x: 100, y: 200, zQ: 4 } }, 0, false);
  const st = rig.get();
  ctx.ok("camera state is clamped", st.yawStep === 1 && st.pitchIndex === 2 && st.zoom === 4 && st.target.y === 200, JSON.stringify(st));
  rig.set({ yawStep: 2 }, 0, true);
  ctx.ok("camera tweens, then settles", rig.update(100) && rig.animating && (rig.update(1e6), !rig.animating));

  await checkStandees(ctx, sources, rig);
}

/**
 * Standees, the grid, flight stands, outlines, reticles, the effect halo and
 * target lines. All of it renders "fine" when wrong: a grid uniform nobody
 * writes is just no grid, a stand drawn for a grounded token is just clutter,
 * an outline in the wrong priority is just the wrong colour, a link to a token
 * that left the board is a line into nowhere.
 */
async function checkStandees(ctx, sources, rig) {
  const G = await import(ctx.url(`${RENDER_DIR}/glsl.mjs`));
  const { PROGRAMS, declaredUniforms, CARD_VERT, SIDE_FRAG } = G;
  const S = await import(ctx.url(`${RENDER_DIR}/standees.mjs`));
  const { StandeesLayer, outlineLook, haloSlot, targetRgb, OUTLINE_PX, FIGURE_SCALE, CHIP } = S;
  const L = await import(ctx.url(`${RENDER_DIR}/links.mjs`));
  const { SHADOW_LAYER } = await import(ctx.url(`${RENDER_DIR}/terrain.mjs`));
  const { createShared } = await import(ctx.url(`${RENDER_DIR}/materials.mjs`));
  const { PALETTE } = await import(ctx.url("scripts/core/theme.mjs"));
  const THREE = await import(ctx.url(`${RENDER_DIR}/three.mjs`));
  const rsrc = stripComments(sources["renderer.mjs"]);

  // ---- grid ---------------------------------------------------------------
  ctx.ok("the grid: TOP_FRAG declares uGrid", declaredUniforms(PROGRAMS.top.fragment).includes("uGrid"));
  ctx.ok("the grid: lines are device pixels (fwidth)", /float gridLine[\s\S]*fwidth\(xz\)/.test(PROGRAMS.top.fragment));
  ctx.ok("the grid: setOptions({grid}) writes uGrid and requests a frame",
    /grid !== undefined\) this\.setGridLines/.test(rsrc) && /setGridLines\([^)]*\)\s*\{[\s\S]*?uGrid\.value\.set[\s\S]*?requestRender\(\)/.test(rsrc));

  // ---- card depth ---------------------------------------------------------
  ctx.ok("cards are depth tested on their stand plane, not their lean",
    /gl_Position\.z = standClip\.z \/ standClip\.w \* gl_Position\.w/.test(CARD_VERT));
  ctx.ok("cliff faces take the paint at their lip", /mapAt\(vLip/.test(SIDE_FRAG) && declaredUniforms(SIDE_FRAG).includes("uSidePaint"));

  // ---- pure helpers -------------------------------------------------------
  const fly = [[0, 0, false], [0.2, 0, false], [0.25, 0, true], [3, 0, true], [5, 5, false]];
  const badFly = fly.filter(([y, g, want]) => StandeesLayer.isFlying(y, g) !== want);
  ctx.ok("flying is feet ≥ 1 q (0.25 cell) above the ground", badFly.length === 0, JSON.stringify(badFly));
  const fp = [[0.5, 1], [1, 1], [2, 2], [3, 3], [4, 4]].map(([w, n]) => ({ w, n, got: StandeesLayer.footprintOf(10.5, 4.5, w) }));
  ctx.ok("the footprint follows widthCells", fp.every((f) => f.got.n === f.n), JSON.stringify(fp));
  const snapped = [[10.5, 4.5, 1, 10, 4], [11, 5, 2, 10, 4], [11.5, 4.5, 3, 10, 3]]
    .every(([x, z, w, x0, z0]) => { const f = StandeesLayer.footprintOf(x, z, w); return f.x0 === x0 && f.z0 === z0; });
  ctx.ok("the footprint snaps to the grid", snapped);

  const rest = outlineLook({}), hov = outlineLook({ hovered: true }), ctl = outlineLook({ controlled: true, hovered: true });
  const tgt = outlineLook({ controlled: true, hovered: true, targets: ["#ff0000", "#00ff00"] });
  ctx.ok("outline priority: targeted > controlled > hovered > rest",
    rest.state === "rest" && hov.state === "hovered" && ctl.state === "controlled" && tgt.state === "targeted");
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3);
  ctx.ok("outline colours: ink at rest, gold controlled, the first targeter's colour",
    near(rest.rgb, targetRgb(PALETTE.ink0)) && near(ctl.rgb, targetRgb(PALETTE.signal)) && near(tgt.rgb, [1, 0, 0]));
  ctx.ok("a target's colour may be [r,g,b] 0..1 or 0..255", near(targetRgb([0, 0.5, 1]), [0, 0.5, 1]) && near(targetRgb([255, 0, 0]), [1, 0, 0]));
  ctx.ok("the targeted line is the thickest and the only one that glows",
    tgt.width > Math.max(rest.width, hov.width, ctl.width) && tgt.glow > 0 && rest.glow + hov.glow + ctl.glow === 0
    && tgt.width === OUTLINE_PX.targeted);
  ctx.ok("outline widths are device pixels (fwidth in CARD_FRAG)", /vec2 px = fwidth\(vUv\)/.test(PROGRAMS.card.fragment));

  const three = [0, 1, 2].map((k) => haloSlot(k, 3, 0.5));
  ctx.ok("halo: three chips share the front arc, left to right, centred",
    three.every((s) => s.arc === 0) && three[0].angle < three[1].angle && three[1].angle < three[2].angle
    && Math.abs(three[1].angle) < 1e-9 && Math.abs(three[0].angle + three[2].angle) < 1e-9);
  const nine = Array.from({ length: 9 }, (_, k) => haloSlot(k, 9, 0.5));
  const inner = nine.filter((s) => s.arc === 0);
  ctx.ok("halo: past the front arc's room, chips wrap to a larger arc",
    inner.length >= 3 && inner.length <= 7 && nine.some((s) => s.arc === 1)
    && nine.filter((s) => s.arc === 1).every((s) => s.radius > 0.5));
  ctx.ok("halo: the front arc stays in front (within ±70°)", inner.every((s) => Math.abs(s.angle) <= 1.22));

  // ---- the layer, driven under Node ---------------------------------------
  const shared = createShared();
  const layer = new StandeesLayer(shared, () => {});
  layer.setGridSize(100);
  const tok = (id, o) => ({ id, name: id, x: 450, y: 450, footQ: 0, heightQ: 6, widthCells: 1, art: "", disposition: 1,
    visible: true, ghost: false, controlled: false, hovered: false, targets: [], conditions: [], bars: [], ...o });
  const icon = (i) => ({ icon: `data:icon/${i}`, value: i % 3 ? null : i });
  layer.set([
    tok("ground", {}),
    tok("flyer", { x: 650, footQ: 12, groundQ: 0, widthCells: 2 }),
    tok("legacy", { x: 850, footQ: 8 }),                       // no groundQ: standing
    tok("target", { x: 250, targets: ["#ff4a52"] }),
    tok("halo", { x: 250, y: 650, halo: true, conditions: Array.from({ length: 14 }, (_, i) => icon(i)) }),
    tok("plain", { x: 450, y: 650, halo: false, conditions: [icon(1), icon(2)] }),
  ], 0, false);
  layer.frame(16, rig.camera, Math.PI / 4, false, { pxWorld: 0.01, markers: true });
  layer.frame(32, rig.camera, Math.PI / 4, false, { pxWorld: 0.01, markers: true });
  const E = (id) => layer.entries.get(id);
  ctx.ok("the flight stand shows only for a flying token",
    E("flyer").stand.visible && !E("ground").stand.visible && !E("legacy").stand.visible);
  ctx.ok("a 2-cell flyer's footprint is 2×2 squares", E("flyer").footprint.scale.x === 2 && E("flyer").footprint.material.uniforms.uSize.value === 2);
  ctx.ok("the flyer's contact shadow is on the ground", Math.abs(E("flyer").root.position.y + E("flyer").shadow.position.y - 0.008) < 1e-6);
  const col = E("flyer").column;
  const inCasters = (() => { let f = false; layer.casters.traverse((o) => { if (o === col) f = true; }); return f; })();
  ctx.ok("the glass column casts nothing (not on SHADOW_LAYER, not a caster)", !col.layers.isEnabled(SHADOW_LAYER) && !inCasters);
  ctx.ok("the glass column picks its flyer", col.userData.tokenId === "flyer");
  ctx.ok("the reticle is up only under a targeted token", E("target").reticle.visible && !E("ground").reticle.visible && layer.targeted);
  ctx.ok("the card is drawn FIGURE_SCALE tall; the rules height is not",
    Math.abs(E("ground").cardH - 1.5 * FIGURE_SCALE) < 1e-9 && E("ground").heightCells === 1.5);
  const m = E("ground").margin.value;
  ctx.ok("the card margin is sized from device pixels", m.x > 0 && m.y > 0 && Math.abs(m.y * E("ground").cardH - 12.5 * 0.01) < 1e-6);
  ctx.ok("halo mode: chips capped at 12, none on the plate",
    E("halo").chipCount === 12 && JSON.parse(E("halo").plateSig)[1].length === 0);
  ctx.ok("plate mode: conditions stay on the plate, no chips",
    E("plain").chipCount === 0 && JSON.parse(E("plain").plateSig)[1].length === 2);
  ctx.ok("halo chips are about 0.22 cell", Math.abs(CHIP - 0.22) < 1e-9 && E("halo").chips[0].scale.x === CHIP);
  // state changes are damped, frame-rate independent
  layer.set([tok("ground", { hovered: true })], 100, true);
  const w0 = E("ground").look.w;
  layer.frame(116, rig.camera, Math.PI / 4, false, { pxWorld: 0.01, markers: true });
  const w1 = E("ground").look.w;
  ctx.ok("hover follows with exponential damping, not a jump", w1 > w0 && w1 < OUTLINE_PX.hovered);
  layer.dispose();

  // ---- target lines -------------------------------------------------------
  const a = { x: 0, y: 0, z: 0 }, b = { x: 10, y: 0, z: 0 };
  const mid = L.arcPoint(a, b, 0.5, {}), end = L.arcPoint(a, b, 1, {});
  ctx.ok("a link arc starts and ends on its anchors", end.x === 10 && end.y === 0 && L.arcPoint(a, b, 0, {}).x === 0);
  ctx.ok("a link arc rises ARC_RISE × distance, at least a cell",
    Math.abs(mid.y - L.ARC_RISE * 10) < 1e-9 && Math.abs(L.arcApex(a, { x: 1, y: 0, z: 0 }) - 1) < 1e-9);
  const norm = L.normalizeLinks([{ sourceId: "a", targetId: "b", color: [1, 0, 0] }, { sourceId: "a", targetId: "b", color: [0, 1, 0] },
    { sourceId: "a", targetId: "a" }, { sourceId: null, targetId: "b" }, ...Array.from({ length: 30 }, (_, i) => ({ sourceId: "s" + i, targetId: "t" }))]);
  ctx.ok("links are deduplicated, self-links and broken ones dropped, capped", norm[0].key === "a>b" && norm.filter((l) => l.key === "a>b").length === 1
    && !norm.some((l) => l.sourceId === l.targetId) && norm.length === L.MAX_LINKS);
  const layer2 = new StandeesLayer(createShared(), () => {});
  layer2.set([tok("s", {}), tok("t", { x: 850 })], 0, false);
  layer2.frame(16, rig.camera, Math.PI / 4, false, { pxWorld: 0.01, markers: true });
  const links = new L.LinksLayer(createShared());
  links.set([{ sourceId: "s", targetId: "t", color: [0, 0.5, 1] }, { sourceId: "s", targetId: "gone", color: [1, 0, 0] }]);
  const drawn = links.frame(16, layer2, true);
  const vis = [...links.entries.values()].map((e) => e.mesh.visible);
  ctx.ok("a link to a token not on the board is not drawn", drawn && vis.filter(Boolean).length === 1);
  const lm = [...links.entries.values()][0].mesh;
  ctx.ok("target lines draw over the board (no depth test)", lm.material.depthTest === false && lm.material.depthWrite === false);
  ctx.ok("the renderer has setLinks and claims motion for lines and reticles",
    typeof (await import(ctx.url(`${RENDER_DIR}/renderer.mjs`))).DioramaRenderer.prototype.setLinks === "function"
    && /this\.links\.frame\(/.test(rsrc) && /this\.standees\.targeted && shed\.markerMotion/.test(rsrc));
  ctx.ok("glint and breathe loop on whole periods of TIMING", /now % P\) \/ P/.test(stripComments(sources["links.mjs"]))
    && /now % P\) \/ P\) \* Math\.PI \* 2/.test(stripComments(sources["standees.mjs"])));
  links.dispose();
  layer2.dispose();
  ctx.ok("THREE loads", !!THREE.Vector3);
}
