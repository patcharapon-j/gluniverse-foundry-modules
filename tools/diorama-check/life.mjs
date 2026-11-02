/**
 * Token life: the walk, the fall, the landing dust and the flyer's hover.
 *
 * All of it renders "fine" when wrong: a hop out of step with the squares
 * still bounces, a fall that stops a hair above the ground still looks like
 * a landing until the next move starts from the wrong height, a hover that
 * snaps once per loop is a twitch nobody can name, a dust pool that allocates
 * per frame is a GC hitch on every landing, and a renderer that keeps a frame
 * loop alive for a finished puff never lets the table rest. So this drives the
 * real model (render/life.mjs), the real pool (render/dust.mjs) and the real
 * StandeesLayer under Node and measures them.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const RENDER = "scripts/features/diorama/render";

export default async function check(ctx) {
  const L = await import(ctx.url(`${RENDER}/life.mjs`));
  const { planMove, poseAt, squashAt, hoverPose, FALL_STEP, HOVER } = L;
  const { TIMING, SHED_ORDER } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const { DustLayer, DUST_PUFFS, DUST_MOTES } = await import(ctx.url(`${RENDER}/dust.mjs`));
  const { StandeesLayer } = await import(ctx.url(`${RENDER}/standees.mjs`));
  const { createShared } = await import(ctx.url(`${RENDER}/materials.mjs`));
  const { CameraRig } = await import(ctx.url(`${RENDER}/camera.mjs`));
  const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
  const src = (rel) => readFileSync(join(ctx.root, rel), "utf8");

  /* ---------------- timing and shedding ---------------- */
  ctx.ok("life: every duration is in TIMING",
    ["standeeStep", "standeeSettle", "standeeFall", "dustLife", "hoverLoop"].every((k) => Number(TIMING[k]) > 0));
  ctx.ok("life: dust and hover degrade under load (standeeDust, standeeSway in SHED_ORDER)",
    SHED_ORDER.includes("standeeDust") && SHED_ORDER.includes("standeeSway")
    && SHED_ORDER.indexOf("standeeDust") < SHED_ORDER.indexOf("standeeSway"));
  const lifeSrc = src(`${RENDER}/life.mjs`), dustSrc = src(`${RENDER}/dust.mjs`);
  const msLiteral = /\b(ms|Ms|life|Life|P)\s*[:=]\s*\d{2,}/;
  ctx.ok("life: no literal durations in the model or the pool", !msLiteral.test(lifeSrc) && !msLiteral.test(dustSrc));

  /* ---------------- the walk: one hop per step ---------------- */
  const count = (plan, key, dt = 1) => {
    // local maxima of a pose field over the whole move, sampled every dt ms
    const out = {};
    let n = 0, prev = -1, rising = false;
    for (let t = 0; t <= plan.ms; t += dt) {
      const v = poseAt(plan, t, out)[key];
      if (v > prev + 1e-12) rising = true;
      else if (v < prev - 1e-12 && rising) { n++; rising = false; }
      prev = v;
    }
    return n;
  };
  for (const cells of [1, 3, 5, 12]) {
    const plan = planMove({ x: 0.5, z: 0.5, y: 0, g: 0 }, { x: 0.5 + cells, z: 0.5, y: 0, g: 0 });
    const hops = plan.segs.filter((s) => s.kind === "hop").length;
    ctx.ok(`walk: ${cells} square${cells > 1 ? "s" : ""}, ${cells} hop${cells > 1 ? "s" : ""}`, hops === cells && count(plan, "lift") === cells,
      `${hops} segments, ${count(plan, "lift")} apexes`);
    ctx.ok(`walk: ${cells} squares take ${cells} steps of TIMING.standeeStep`, near(plan.ms, cells * TIMING.standeeStep));
  }
  const diag = planMove({ x: 0.5, z: 0.5, y: 0, g: 0 }, { x: 3.5, z: 3.5, y: 0, g: 0 });
  ctx.ok("walk: a hop is timed by the step it carries (each lasts TIMING.standeeStep)",
    diag.segs.every((s) => near(s.t1 - s.t0, TIMING.standeeStep)) && diag.segs.length === diag.steps);
  const flat = planMove({ x: 0.5, z: 0.5, y: 0, g: 0 }, { x: 4.5, z: 0.5, y: 0, g: 0 });
  const o = {};
  const atFeet = flat.segs.every((s) => near(poseAt(flat, s.t0, o).lift, 0, 1e-9) && near(poseAt(flat, s.t1 - 1e-9, o).lift, 0, 1e-6));
  const apex = poseAt(flat, flat.segs[0].t0 + TIMING.standeeStep / 2, o).lift;
  ctx.ok("walk: every hop leaves and lands on its feet, a small arc between", atFeet && apex > 0.03 && apex < 0.15, `apex ${apex.toFixed(3)}`);
  const end = poseAt(flat, flat.ms, o);
  ctx.ok("walk: it ends exactly on its square", end.x === 4.5 && end.z === 0.5 && end.y === 0 && end.lift === 0);
  ctx.ok("walk: footfalls are lighter than the landing", flat.segs.slice(0, -1).every((s) => s.land > 0 && s.land < flat.segs.at(-1).land && s.dust < flat.segs.at(-1).dust));
  // stairs (half a cell per half square) are walked, not fallen down
  const stairs = (x) => Math.max(0, 2 - Math.floor(x * 2) * 0.5);
  const down = planMove({ x: 0.25, z: 0.5, y: 2, g: 2 }, { x: 4.25, z: 0.5, y: 0, g: 0 }, { ground: (x) => stairs(x) });
  ctx.ok("walk: stairs are hopped down, never fallen", down.segs.every((s) => s.kind === "hop"), down.segs.map((s) => s.kind).join(","));
  // a flyer glides; no hop
  const glide = planMove({ x: 0.5, z: 0.5, y: 3, g: 0 }, { x: 4.5, z: 0.5, y: 3, g: 0 });
  ctx.ok("walk: a flyer glides (no hop, no contact in the air)", glide.flyer && glide.segs.length === 1 && glide.segs[0].kind === "glide"
    && glide.segs[0].land === 0 && count(glide, "lift") === 0);
  const landing = planMove({ x: 0.5, z: 0.5, y: 3, g: 0 }, { x: 2.5, z: 0.5, y: 0, g: 0 }, { flyer: true });
  ctx.ok("walk: a flyer coming down to the ground lands softly (no fall)", landing.segs.every((s) => s.kind !== "fall") && landing.segs.at(-1).land > 0);

  /* ---------------- the fall ---------------- */
  const ledge = (x) => (x < 2 ? 1.5 : 0);
  const fallPlan = planMove({ x: 0.5, z: 0.5, y: 1.5, g: 1.5 }, { x: 4.5, z: 0.5, y: 0, g: 0 }, { ground: (x) => ledge(x) });
  const fall = fallPlan.segs.find((s) => s.kind === "fall");
  ctx.ok("fall: a walker stepping off a ledge falls", !!fall && fallPlan.segs.filter((s) => s.kind === "fall").length === 1,
    fallPlan.segs.map((s) => s.kind).join(","));
  if (fall) {
    const ys = [];
    for (let i = 0; i <= 60; i++) ys.push(poseAt(fallPlan, fall.t0 + ((fall.t1 - fall.t0) * i) / 60, o).y);
    const v = ys.slice(1).map((y, i) => ys[i] - y);           // drop per sample
    const monotone = v.every((d) => d >= -1e-12);
    const accelerating = v.slice(1).every((d, i) => d > v[i] - 1e-12) && v.at(-1) > v[0] * 10;
    ctx.ok("fall: monotone and accelerating (constant gravity)", monotone && accelerating);
    ctx.ok("fall: it starts at the ledge's height and lands exactly on the ground below",
      ys[0] === 1.5 && poseAt(fallPlan, fall.t1, o).y === 0 && fall.y1 === 0);
    ctx.ok("fall: it leaves from the ledge's edge, not from inside the block",
      fall.x0 > 1.6 && fall.x0 <= 2.05, `edge at x=${fall.x0.toFixed(3)}`);
    ctx.ok("fall: a longer drop takes longer, by √ (gravity)",
      near(fall.t1 - fall.t0, TIMING.standeeFall * Math.sqrt(1.5), 1e-6));
    ctx.ok("fall: lands harder than a step (more squash, more dust)", fall.land > fallPlan.segs[0].land && fall.dust > 0.6);
  }
  const blind = planMove({ x: 0.5, z: 0.5, y: 1.5, g: 1.5 }, { x: 3.5, z: 0.5, y: 0, g: 0 });
  ctx.ok("fall: without the terrain, the drop is the last step", blind.segs.at(-1).kind === "fall"
    && blind.segs.slice(0, -2).every((s) => s.kind === "hop" && s.y0 === 1.5 && s.y1 === 1.5));
  const flyerDown = planMove({ x: 0.5, z: 0.5, y: 1.5, g: 1.5 }, { x: 4.5, z: 0.5, y: 0, g: 0 }, { ground: (x) => ledge(x), flyer: true });
  ctx.ok("fall: a flyer never falls", flyerDown.segs.every((s) => s.kind !== "fall"));
  const small = planMove({ x: 0.5, z: 0.5, y: 0.5, g: 0.5 }, { x: 2.5, z: 0.5, y: 0, g: 0 }, { ground: (x) => (x < 1 ? 0.5 : 0) });
  ctx.ok(`fall: a drop of a step (${FALL_STEP} cell) or less is a hop`, small.segs.every((s) => s.kind === "hop"));

  /* ---------------- squash ---------------- */
  ctx.ok("squash: full at the contact, gone after TIMING.standeeSettle, never negative",
    squashAt(0.05, 0) === 0.05 && squashAt(0.05, TIMING.standeeSettle) === 0
    && [10, 50, 100, 150, 199].every((t, i, a) => squashAt(0.05, t) > 0 && (i === 0 || squashAt(0.05, t) < squashAt(0.05, a[i - 1]))));

  /* ---------------- the hover loop ---------------- */
  const P = TIMING.hoverLoop;
  const h1 = {}, h2 = {};
  let seam = 0;
  for (const t of [0, 1, 123.4, P / 3, P - 1, 1e6 + 17, 3.6e6 * 5 + 0.5]) {
    hoverPose(t, 1.3, h1); hoverPose(t + P, 1.3, h2);
    seam = Math.max(seam, Math.abs(h1.dy - h2.dy), Math.abs(h1.roll - h2.roll));
  }
  ctx.ok("hover: one loop later it is exactly where it was", seam < 1e-6, `worst ${seam}`);
  // no snap at the wrap: the step across P is no bigger than any other step
  let worst = 0, wrap = 0;
  for (let t = P - 50; t < P + 50; t += 1) {
    hoverPose(t, 0.7, h1); hoverPose(t + 1, 0.7, h2);
    const d = Math.abs(h2.dy - h1.dy);
    if (Math.floor(t / P) !== Math.floor((t + 1) / P)) wrap = d; else worst = Math.max(worst, d);
  }
  ctx.ok("hover: no snap where the loop wraps", wrap <= worst * 1.5 + 1e-12, `wrap ${wrap}, step ${worst}`);
  ctx.ok("hover: whole cycles per loop, gentle amplitudes",
    Number.isInteger(HOVER.breaths) && Number.isInteger(HOVER.sways) && HOVER.lift <= 0.06 && HOVER.roll <= 0.03);

  /* ---------------- the dust pool ---------------- */
  const rig = new CameraRig();
  const cam = rig.camera;
  const shared = createShared();
  const dust = new DustLayer(shared);
  const meshes = dust.group.children.length;
  ctx.ok("dust: a fixed pool, built once", meshes === DUST_PUFFS * DUST_MOTES);
  for (let i = 0; i < 100; i++) { dust.emit(i * 0.1, 0, 0, 0.4, 1, i * 10); dust.frame(i * 10 + 5, cam); }
  ctx.ok("dust: a hundred landings reuse the pool", dust.group.children.length === meshes && dust.live <= DUST_PUFFS);
  const body = (name) => {
    const s = DustLayer.prototype[name].toString();
    return s.replace(/\/\/[^\n]*/g, "");
  };
  const allocates = (s) => /\bnew\s|=\s*\[|=\s*\{|\(\s*\{|\.\.\.|\.map\(|\.filter\(|\.slice\(|\.concat\(/.test(s);
  ctx.ok("dust: emit and frame allocate nothing (typed arrays, reused meshes)", !allocates(body("emit")) && !allocates(body("frame")));
  ctx.ok("dust: the motes are on the shared unlit program", dust.mats.every((m) => m.name === "dio.unlit"));
  const busy = dust.frame(1000 + TIMING.dustLife * 2, cam);
  ctx.ok("dust: every puff dies, and then it asks for no frames", !busy && dust.live === 0 && dust.motes.every((m) => !m.visible));
  dust.emit(0, 0, 0, 0.4, 0.3, 0);
  dust.emit(1, 0, 0, 0.4, 0.6, 0);
  dust.frame(TIMING.dustLife * 0.75, cam);
  ctx.ok("dust: a footfall's puff is shorter-lived than a landing's", dust.live === 1 && dust.strength[dust.count.findIndex((c) => c > 0)] > 0.5);
  dust.clear();
  dust.dispose();

  /* ---------------- through the real layer ---------------- */
  const tok = (id, o2) => ({ id, name: id, x: 50, y: 50, footQ: 0, heightQ: 6, widthCells: 1, art: "", disposition: 1,
    visible: true, ghost: false, controlled: false, hovered: false, targets: [], conditions: [], bars: [], ...o2 });
  const run = (layer, from, to, opt, step = 4) => {
    // drive frames from `from` to `to` ms; returns the last frame's answer and the root y track
    let last = false;
    const ys = [];
    for (let t = from; t <= to; t += step) { last = layer.frame(t, cam, Math.PI / 4, false, opt); ys.push(layer.entries.values().next().value.root.position.y); }
    return { last, ys };
  };
  const maxima = (ys) => { let n = 0; for (let i = 1; i < ys.length - 1; i++) if (ys[i] > ys[i - 1] + 1e-9 && ys[i] >= ys[i + 1]) n++; return n; };
  const ON = { pxWorld: 0.01, markers: true, life: true, dust: true, hover: true };

  // a 4-square walk on flat ground
  const walk = new StandeesLayer(createShared(), () => {});
  walk.setGridSize(100);
  walk.set([tok("w", {})], 0, false);
  walk.frame(0, cam, Math.PI / 4, false, ON);
  walk.set([tok("w", { x: 450 })], 10, true);
  const wr = run(walk, 10, 10 + 4 * TIMING.standeeStep + 2, ON, 2);
  const W = walk.entries.get("w");
  ctx.ok("layer: a 4-square walk lifts the whole miniature 4 times", maxima(wr.ys) === 4, `${maxima(wr.ys)} lifts`);
  ctx.ok("layer: the base hops with the card (the root rises, the card does not leave it)", Math.max(...wr.ys) > 0.03 && W.body.position.y === 0);
  ctx.ok("layer: it ends exactly on the ground of its square", !W.move && W.root.position.y === 0 && W.root.position.x === 4.5);
  ctx.ok("layer: the contact shadow stays on the ground while it hops",
    (() => { const l = new StandeesLayer(createShared(), () => {}); l.setGridSize(100); l.set([tok("s", {})], 0, false); l.frame(0, cam, 0, false, ON);
      l.set([tok("s", { x: 250 })], 1, true); l.frame(1 + TIMING.standeeStep / 2, cam, 0, false, ON);
      const e = l.entries.get("s"); const ok = e.root.position.y > 0.03 && near(e.root.position.y + e.shadow.position.y, 0.008, 1e-9); l.dispose(); return ok; })());
  ctx.ok("layer: each footfall and the landing raised dust", walk.dust.live >= 2);
  const settled = run(walk, 10 + 4 * TIMING.standeeStep + 4, 10 + 4 * TIMING.standeeStep + TIMING.dustLife + TIMING.standeeSettle + 40, ON, 8);
  ctx.ok("layer: after the walk it settles and then asks for no frames (idle)",
    !settled.last && W.body.scale.y === 1 && walk.dust.live === 0);
  walk.dispose();

  // life off: the old slide, no dust, no squash
  const off = new StandeesLayer(createShared(), () => {});
  off.setGridSize(100);
  const OFF = { ...ON, life: false };
  off.set([tok("o", {})], 0, false);
  off.frame(0, cam, 0, false, OFF);
  off.set([tok("o", { x: 350 })], 1, true);
  let squashed = false, rootUp = false, cardUp = false;
  for (let t = 1; t <= 1 + 3 * TIMING.standeeStep + 40; t += 4) {
    off.frame(t, cam, 0, false, OFF);
    const e = off.entries.get("o");
    if (e.body.scale.y !== 1) squashed = true;
    if (e.root.position.y !== 0) rootUp = true;
    if (e.body.position.y > 0.01) cardUp = true;
  }
  ctx.ok("toggle off: the old card-only bounce, no squash, no dust", cardUp && !rootUp && !squashed && off.dust.live === 0);
  off.dispose();

  // a fall off a ledge, with the terrain known
  const fl = new StandeesLayer(createShared(), () => {});
  fl.setGridSize(100);
  fl.setGround((x) => (x < 2 ? 1.5 : 0));
  fl.set([tok("f", { footQ: 6, groundQ: 6 })], 0, false);
  fl.frame(0, cam, 0, false, ON);
  fl.set([tok("f", { x: 450, footQ: 0, groundQ: 0 })], 1, true);
  const F = fl.entries.get("f");
  const fplan = fl.planOf(F);
  const fs = fplan.segs.find((s) => s.kind === "fall");
  let below = false;
  for (let t = 1; t <= 1 + fplan.ms; t += 2) {
    fl.frame(t, cam, 0, false, ON);
    const x = F.root.position.x, y = F.root.position.y;
    if (y < (x < 2 ? 1.5 : 0) - 1e-6) below = true;
  }
  fl.frame(1 + fplan.ms + 1, cam, 0, false, ON);
  ctx.ok("layer: a fall is planned through the layer's ground", !!fs && fs.x0 > 1.6);
  ctx.ok("layer: a falling figure never sinks into the ledge or the ground", !below);
  ctx.ok("layer: it lands exactly on the ground, squashed, in dust",
    !F.move && F.root.position.y === 0 && F.body.scale.y < 1 && fl.dust.live >= 1);
  fl.dispose();

  // a flyer hovers; shed, the hover fades out and the layer goes idle
  const fy = new StandeesLayer(createShared(), () => {});
  fy.setGridSize(100);
  fy.set([tok("h", { footQ: 12, groundQ: 0 })], 0, false);
  fy.frame(0, cam, 0, false, ON);
  const hy = [];
  let hoverActive = true;
  for (let t = 16; t <= P; t += 16) { if (!fy.frame(t, cam, 0, false, ON)) hoverActive = false; hy.push(fy.entries.get("h").root.position.y); }
  const H = fy.entries.get("h");
  ctx.ok("hover: a flyer breathes on its stand while it may", hoverActive && Math.max(...hy) - Math.min(...hy) > HOVER.lift && H.stand.visible);
  ctx.ok("hover: its stand still reaches the ground, its shadow stays on it",
    near(H.root.position.y + H.column.position.y, 0, 1e-9) && near(H.root.position.y + H.shadow.position.y, 0.008, 1e-9)
    && near(H.column.scale.y, H.root.position.y, 1e-9));
  ctx.ok("hover: the soft shadow shows under a flyer, never under a walker", H.shadowSoft.visible && H.shadowSoft.material.uniforms.uOpacity.value > 0);
  const hi = (() => {
    const l = new StandeesLayer(createShared(), () => {}); l.setGridSize(100);
    l.set([tok("a", { footQ: 4, groundQ: 0 }), tok("b", { x: 250, footQ: 24, groundQ: 0 })], 0, false); l.frame(0, cam, 0, false, ON);
    const a = l.entries.get("a"), b = l.entries.get("b");
    const r = { low: [a.shadow.scale.x, a.shadowSoft.material.uniforms.uOpacity.value], high: [b.shadow.scale.x, b.shadowSoft.material.uniforms.uOpacity.value] };
    l.dispose(); return r;
  })();
  ctx.ok("hover: higher up, the contact shadow is smaller and the soft one stronger",
    hi.high[0] < hi.low[0] && hi.high[1] > hi.low[1], JSON.stringify(hi));
  const SHED = { ...ON, hover: false };
  let idle = false;
  for (let t = P; t <= P + 1500; t += 16) idle = !fy.frame(t, cam, 0, false, SHED);
  ctx.ok("hover: shed, it fades out (no snap) and the layer goes idle", idle && H.hoverW === 0 && H.root.position.y === 3);
  fy.dispose();

  // the miniature in the hand: no bob, no hover; set down, it lands in dust
  const hd = new StandeesLayer(createShared(), () => {});
  hd.setGridSize(100);
  hd.set([tok("c", {}), tok("k", { x: 250, footQ: 8, groundQ: 0 })], 0, false);
  hd.frame(0, cam, 0, false, ON);
  hd.setHold("c", { x: 50, y: 50, footQ: 0, groundQ: 0, phase: "carry" }, 1);
  hd.setHold("k", { x: 250, y: 50, footQ: 8, groundQ: 0, phase: "carry" }, 1);
  let bob = false;
  const C = hd.entries.get("c"), K = hd.entries.get("k");
  for (let t = 16; t <= 1200; t += 16) {
    hd.set([tok("c", { x: 150 }), tok("k", { x: 350, footQ: 8, groundQ: 0 })], t, true);   // Foundry moves it while held
    hd.setHold("c", { x: 50 + t / 12, y: 50, footQ: 0, groundQ: 0, phase: "carry" }, t);
    hd.frame(t, cam, 0, false, ON);
    if (C.body.position.y !== 0 || C.body.scale.y !== 1 || C.move || K.body.scale.y !== 1 || C.pose.lift !== 0) bob = true;
  }
  ctx.ok("hold: a held figure does not bob, squash or walk", !bob);
  ctx.ok("hold: a held flyer stops hovering", K.hoverW === 0);
  const before = hd.dust.live;
  hd.setHold("c", { x: 150, y: 50, footQ: 0, groundQ: 0, phase: "drop" }, 1216);
  for (let t = 1216; t <= 1216 + TIMING.liftDrop + 32; t += 16) hd.frame(t, cam, 0, false, ON);
  ctx.ok("hold: a drop onto the table ends in a landing (dust and squash)", !C.hold && hd.dust.live > before && C.squash.amp > 0);
  hd.dispose();

  /* ---------------- wiring ---------------- */
  const rsrc = src(`${RENDER}/renderer.mjs`);
  ctx.ok("wiring: the renderer hands the layer token life, dust and hover from fx",
    /sf\.life = fx\.life/.test(rsrc) && /sf\.dust = fx\.dust/.test(rsrc) && /sf\.hover = fx\.hover/.test(rsrc)
    && /dust: g\.tokenLife !== false && shed\.standeeDust/.test(rsrc) && /hover: g\.tokenLife !== false && shed\.standeeSway/.test(rsrc));
  ctx.ok("wiring: the walk reads the rules ground", /this\.standees\.setGround\(/.test(rsrc));
  const O = await import(ctx.url("scripts/features/diorama/options.mjs"));
  const opt = O.OPTIONS.find((x) => x.name === "tokenLife");
  ctx.ok("wiring: token animation is a client option, on by default, resolved for the renderer",
    opt?.scope === "client" && opt.type === "boolean" && O.resolveGraphics({}).tokenLife === true && O.resolveGraphics({ tokenLife: false }).tokenLife === false);
  const sSrc = src(`${RENDER}/standees.mjs`);
  ctx.ok("wiring: the hover stays out of the cast shadow (no shadow pass per frame)", /placeCaster\(e, p, hop \+ lift, sunYaw\)/.test(sSrc));
}
