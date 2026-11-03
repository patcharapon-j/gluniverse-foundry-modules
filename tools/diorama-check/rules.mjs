/**
 * Height rules: path analysis, per-system readouts, creature height, the
 * lang keys they reach for, and the sight backend's edge selection driven
 * through a stubbed ClockwiseSweepPolygon. Nothing here proves Foundry's own
 * sweep, detection or drag workflow; those need a live v14 session.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export default async function check(ctx) {
  const { Terrain } = await import(ctx.url("scripts/features/diorama/terrain/model.mjs"));
  const { rayBlocked, rayPoint, cliffEdges } = await import(ctx.url("scripts/features/diorama/terrain/occlusion.mjs"));
  const { KIND, SUB, SIZE_HEIGHT, DH_BANDS } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const { SUITE_ID } = await import(ctx.url("scripts/core/const.mjs"));
  const { analyzePath, isGroundAction } = await import(ctx.url("scripts/features/diorama/rules/path.mjs"));
  const sys = await import(ctx.url("scripts/features/diorama/rules/systems.mjs"));
  const { heightForSize, creatureHeightDist, eyeQ } = await import(ctx.url("scripts/features/diorama/rules/creature.mjs"));

  const grid = { size: 100, distance: 5 };
  const fillCell = (t, i, j, o) => { for (let a = 0; a < SUB; a++) for (let b = 0; b < SUB; b++) t.set(i * SUB + a, j * SUB + b, o); };

  /* ---------------- path analysis ---------------- */
  const t = Terrain.blank(8, 4);
  for (let i = 0; i < 4; i++) for (const j of [3, 4]) fillCell(t, i, j, { h: 8 });
  fillCell(t, 2, 5, { h: -1, kind: KIND.WATER });
  // A flight at the ledge's height, descending west to the floor.
  fillCell(t, 3, 2, { h: 8, kind: KIND.STAIRS, dir: 3 });
  const row = (i) => Array.from({ length: 7 }, (_, j) => ({ i, j }));

  const p1 = analyzePath(t, row(1), grid);
  ctx.ok("path: one step per transition", p1.steps.length === 6);
  ctx.ok("path: the 10 ft rise is a climb", p1.climbs.length === 1 && p1.climbs[0].j === 3 && p1.climbs[0].riseDist === 10,
    JSON.stringify(p1.climbs));
  ctx.ok("path: the 10 ft drop is a fall onto dry ground",
    p1.falls.length === 1 && p1.falls[0].j === 5 && p1.falls[0].dropDist === 10 && !p1.falls[0].intoWater, JSON.stringify(p1.falls));
  const p2 = analyzePath(t, row(2), grid);
  ctx.ok("path: a fall into a water cell says so", p2.falls.length === 1 && p2.falls[0].intoWater
    && p2.falls[0].dropDist === 11.25, JSON.stringify(p2.falls));
  const p3 = analyzePath(t, row(3), grid);
  ctx.ok("path: stairs make the way up walkable", p3.climbs.length === 0 && p3.steps.some((s) => s.rise === 8),
    JSON.stringify(p3.climbs));
  ctx.ok("path: degenerate input is total", analyzePath(t, null, grid).steps.length === 0
    && analyzePath(t, [{ i: 0, j: 0 }], grid).steps.length === 0);
  ctx.ok("ground actions: walk, crawl and PF2e travel are cliff-bound",
    ["walk", "crawl", "travel"].every((a) => isGroundAction(a)));
  ctx.ok("ground actions: climb, fly, burrow, swim, jump, displace are not",
    ["climb", "fly", "burrow", "swim", "jump", "displace", "blink"].every((a) => !isGroundAction(a)));
  ctx.ok("ground actions: snapshot extras count", isGroundAction("hover", ["hover"]) && !isGroundAction("climb", ["climb"]));

  /* ---------------- PF2e readouts ---------------- */
  const mr = (o) => sys.movementReadout({ systemId: "pf2e", speed: 25, units: "ft", ...o });
  const r20 = mr({ distance: 20, cost: 20 });
  ctx.ok("PF2e: 20 ft at Speed 25 is 1 action, info", r20.actions === 1 && r20.tone === "info"
    && r20.text === "GLDIO.rules.pf2eActionsOne", JSON.stringify(r20));
  const r30 = mr({ distance: 30, cost: 30 });
  ctx.ok("PF2e: 30 ft at Speed 25 is 2 actions, warn", r30.actions === 2 && r30.tone === "warn"
    && r30.text === "GLDIO.rules.pf2eActionsMany", JSON.stringify(r30));
  ctx.ok("PF2e: 3 actions is hazard, 4 is peril", mr({ distance: 75 }).tone === "hazard" && mr({ distance: 80 }).tone === "peril");
  ctx.ok("PF2e: difficult terrain counts by cost", mr({ distance: 20, cost: 40 }).actions === 2);
  ctx.ok("PF2e: an infinite cost is blocked", mr({ distance: 10, cost: Infinity }).tone === "peril"
    && mr({ distance: 10, cost: Infinity }).text === "GLDIO.rules.blocked");
  const noSpeed = sys.movementReadout({ systemId: "pf2e", speed: null, distance: 15, units: "ft" });
  ctx.ok("PF2e without a Speed reads as plain distance", noSpeed.actions === null && noSpeed.text === "GLDIO.rules.distance");
  const other = sys.movementReadout({ systemId: "dnd5e", speed: 30, distance: 45, units: "ft" });
  ctx.ok("other systems: plain distance, info", other.tone === "info" && other.actions === null && other.text === "GLDIO.rules.distance");
  const fmt = sys.movementReadout({ systemId: "x", distance: 7.5, units: "ft", t: (k, d) => `${d.distance} ${d.units}` });
  ctx.ok("readouts format distance with t()", fmt.text === "7.5 ft", fmt.text);

  /* ---------------- Daggerheart ---------------- */
  const bands = [[5, "melee"], [10, "veryClose"], [15, "veryClose"], [20, "close"], [30, "close"],
    [35, "far"], [60, "far"], [65, "veryFar"], [500, "veryFar"]];
  for (const [d, key] of bands) {
    const r = sys.distanceReadout({ systemId: "gluniverse-daggerheart", distance: d, gridDistance: 5, units: "ft" });
    ctx.ok(`Daggerheart: ${d} ft is ${key}`, r.band === key && r.text === "GLDIO.rules.distanceBand", JSON.stringify(r));
  }
  ctx.ok("Daggerheart bands are keyed by squares, not feet",
    sys.distanceReadout({ systemId: "gluniverse-daggerheart", distance: 2, gridDistance: 1 }).band === "veryClose");
  ctx.ok("non-Daggerheart distance has no band", sys.distanceReadout({ systemId: "pf2e", distance: 30 }).band === null);
  const seen = [];
  const dh = (cost) => sys.movementReadout({ systemId: "gluniverse-daggerheart", distance: cost, cost, units: "ft", gridDistance: 5,
    t: (k, d) => { seen.push(k); return d?.band ? `${k}|${d.band}` : k; } });
  const dIn = dh(30), dOut = dh(35);
  ctx.ok("Daggerheart: a move within Close is info", dIn.tone === "info" && dIn.text === "GLDIO.rules.dhWithin|GLDIO.band.close", dIn.text);
  ctx.ok("Daggerheart: beyond Close is warn (Agility Roll)", dOut.tone === "warn" && dOut.text === "GLDIO.rules.dhBeyond|GLDIO.band.far", dOut.text);

  /* ---------------- falls ---------------- */
  const capture = (k, d) => ({ k, d });
  const f30 = sys.fallHint({ systemId: "pf2e", dropDist: 30, units: "ft", t: capture });
  ctx.ok("PF2e: a 30 ft fall is 15 bludgeoning", f30?.k === "GLDIO.rules.fallPf2e" && f30.d.damage === 15, JSON.stringify(f30));
  const fw = sys.fallHint({ systemId: "pf2e", dropDist: 30, intoWater: true, units: "ft", t: capture });
  ctx.ok("PF2e: 30 ft into water is 5", fw?.k === "GLDIO.rules.fallPf2eWater" && fw.d.damage === 5, JSON.stringify(fw));
  ctx.ok("PF2e: 5 ft or less does no damage", sys.fallHint({ systemId: "pf2e", dropDist: 5, t: capture })?.k === "GLDIO.rules.fallSafe"
    && sys.fallHint({ systemId: "pf2e", dropDist: 20, intoWater: true, t: capture })?.k === "GLDIO.rules.fallSafe");
  ctx.ok("PF2e: odd falls round down", sys.fallHint({ systemId: "pf2e", dropDist: 15, t: capture }).d.damage === 7);
  ctx.ok("other systems: just the fall", sys.fallHint({ systemId: "gluniverse-daggerheart", dropDist: 10, t: capture })?.k === "GLDIO.rules.fall");
  ctx.ok("no drop, no hint", sys.fallHint({ systemId: "pf2e", dropDist: 0 }) === null);

  /* ---------------- creature height ---------------- */
  const table = { tiny: 2.5, sm: 3, med: 6, lg: 10, huge: 15, grg: 20, small: 3, medium: 6, large: 10, gargantuan: 20 };
  ctx.ok("heightForSize follows the book table", Object.entries(table).every(([k, v]) => heightForSize(k) === v && SIZE_HEIGHT[k] === v));
  ctx.ok("unknown sizes are Medium", heightForSize("colossal") === 6 && heightForSize(undefined) === 6);
  const flagged = { flags: { [SUITE_ID]: { dio: { height: 12 } } }, system: { traits: { size: { value: "sm" } } } };
  ctx.ok("the actor flag wins", creatureHeightDist(flagged, null) === 12);
  const viaGetFlag = { getFlag: (s, k) => (s === SUITE_ID && k === "dio.height" ? 7 : undefined) };
  ctx.ok("the actor flag is read through getFlag", creatureHeightDist(viaGetFlag, null) === 7);
  ctx.ok("PF2e size key", creatureHeightDist({ system: { traits: { size: { value: "lg" } } } }, null) === 10);
  ctx.ok("token size for other systems", creatureHeightDist({ system: {} }, { width: 2, height: 2 }) === 10
    && creatureHeightDist(null, { width: 0.5, height: 0.5 }) === 2.5 && creatureHeightDist(null, { width: 3, height: 3 }) === 15);
  ctx.ok("fallback is 6", creatureHeightDist(null, null) === 6);
  const CR = await import(ctx.url("scripts/features/diorama/rules/creature.mjs"));
  const near = (a, b) => Math.abs(a - b) < 1e-9;
  const cm = (v, extra = {}) => ({ flags: { [SUITE_ID]: { dio: { heightCm: v, ...extra } } } });
  ctx.ok("height in cm converts to feet", near(creatureHeightDist(cm(182.88), null, "ft"), 6) && near(creatureHeightDist(cm(30.48), null, "feet"), 1)
    && near(creatureHeightDist(cm(30.48), null, "ft."), 1));
  ctx.ok("height in cm converts to metres", near(creatureHeightDist(cm(180), null, "m"), 1.8)
    && near(creatureHeightDist(cm(180), null, "metres"), 1.8) && near(creatureHeightDist(cm(180), null, "Meters"), 1.8));
  ctx.ok("unknown units read as feet", near(creatureHeightDist(cm(182.88), null, "parsecs"), 6) && near(creatureHeightDist(cm(182.88), null), 6));
  ctx.ok("the token's scene units are used", near(creatureHeightDist(cm(150), { parent: { grid: { units: "m" } }, width: 1, height: 1 }), 1.5));
  ctx.ok("cm beats the legacy flag, which still reads", creatureHeightDist(cm(91.44, { height: 12 }), null, "ft") === 3
    && creatureHeightDist(flagged, null, "m") === 12);
  ctx.ok("size heights follow the scene's units", near(creatureHeightDist({ system: { traits: { size: { value: "med" } } } }, null, "m"), 1.8288)
    && creatureHeightDist({ system: { traits: { size: { value: "med" } } } }, null, "ft") === 6);
  ctx.ok("a bad cm value falls through", creatureHeightDist(cm(-5), null, "ft") === 6 && creatureHeightDist(cm("x"), null, "ft") === 6
    && creatureHeightDist(cm(""), null, "ft") === 6);
  ctx.ok("autoHeight names the size it came from", CR.autoHeight({ system: { traits: { size: { value: "large" } } } }).size === "lg"
    && CR.autoHeight(null, { width: 3, height: 3 }).size === "huge" && CR.autoHeight(null, null).ft === 6);
  const fi = CR.cmToFtIn(182.88);
  const fi2 = CR.cmToFtIn(182.87);
  ctx.ok("cm ↔ ft + in round-trips, and inches never read 12", fi.ft === 6 && fi.in === 0 && near(CR.ftInToCm(5, 11), 180.34)
    && fi2.ft === 6 && fi2.in === 0);
  const M = CR.standeeMarks;
  ctx.ok("marks: valid fractions with the head above the feet", JSON.stringify(M({ top: 0.1, bottom: 0.9 })) === JSON.stringify({ top: 0.1, bottom: 0.9 }));
  ctx.ok("marks: inverted, too thin, out of range or missing are none", M({ top: 0.9, bottom: 0.1 }) === null && M({ top: 0.5, bottom: 0.52 }) === null
    && M({ top: -0.1, bottom: 0.9 }) === null && M({ top: 0.1, bottom: 1.2 }) === null && M({ top: null, bottom: 0.9 }) === null && M(null) === null);
  ctx.ok("marks apply only to the art they were made on", M({ top: 0.1, bottom: 0.9, src: "a.webp" }, "a.webp") !== null
    && M({ top: 0.1, bottom: 0.9, src: "a.webp" }, "chest.webp") === null);
  ctx.ok("marks are read off the actor flag", JSON.stringify(CR.artMarksOf({ flags: { [SUITE_ID]: { dio: { artMarks: { top: 0.2, bottom: 0.8 } } } } })) === JSON.stringify({ top: 0.2, bottom: 0.8 }));
  const e = eyeQ({ elevation: 10, width: 1, height: 1, actor: null }, grid);
  ctx.ok("eyeQ: elevation + 0.9 x height, in q", Math.abs(e - (10 + 5.4) / 5 * 4) < 1e-9, String(e));

  /* ---------------- lang keys ---------------- */
  let lang = {};
  try { lang = JSON.parse(readFileSync(join(ctx.root, "lang/diorama-rules.en.json"), "utf8")); }
  catch (x) { ctx.ok("lang/diorama-rules.en.json parses", false, String(x)); }
  const has = (k) => typeof lang[k] === "string" && lang[k].length > 0;
  ctx.ok("lang keys are flat and namespaced", Object.keys(lang).every((k) => /^GLDIO\.(rules|band|cover)\./.test(k)));
  for (const b of DH_BANDS) ctx.ok(`lang: GLDIO.band.${b.key}`, has(`GLDIO.band.${b.key}`));
  for (const c of sys.COVER_VALUES) ctx.ok(`lang: GLDIO.cover.${c}`, has(`GLDIO.cover.${c}`));
  for (const k of sys.RULE_KEYS) ctx.ok(`lang: ${k}`, has(k));
  const literal = /["'`](GLDIO\.(?:rules|band|cover)\.[A-Za-z0-9_]+)["'`]/g;
  for (const dir of ["scripts/features/diorama/rules", "scripts/features/diorama/foundry"]) {
    for (const f of readdirSync(join(ctx.root, dir)).filter((x) => x.endsWith(".mjs"))) {
      const src = readFileSync(join(ctx.root, dir, f), "utf8");
      for (const m of src.matchAll(literal)) ctx.ok(`lang: ${m[1]} (${dir}/${f})`, has(m[1]));
    }
  }
  // Placeholders the readouts pass must exist in the strings that use them.
  ctx.ok("lang: action strings carry {actions}", lang["GLDIO.rules.pf2eActionsMany"]?.includes("{actions}"));
  ctx.ok("lang: fall strings carry {damage}", ["GLDIO.rules.fallPf2e", "GLDIO.rules.fallPf2eWater"].every((k) => lang[k]?.includes("{damage}")));
  ctx.ok("lang: band strings carry {band}", ["GLDIO.rules.dhWithin", "GLDIO.rules.dhBeyond", "GLDIO.rules.distanceBand"]
    .every((k) => lang[k]?.includes("{band}")));

  /* ---------------- rules/ purity ---------------- */
  for (const f of readdirSync(join(ctx.root, "scripts/features/diorama/rules")).filter((x) => x.endsWith(".mjs"))) {
    const src = readFileSync(join(ctx.root, "scripts/features/diorama/rules", f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    ctx.ok(`rules/${f} is pure`, !/\b(game|canvas|foundry|ui|Hooks|CONFIG)\s*[.[]/.test(src));
  }

  /* ---------------- foundry/ imports under Node ---------------- */
  const mods = {};
  for (const f of readdirSync(join(ctx.root, "scripts/features/diorama/foundry")).filter((x) => x.endsWith(".mjs"))) {
    try { mods[f] = await import(ctx.url(`scripts/features/diorama/foundry/${f}`)); ctx.ok(`foundry/${f} imports under Node`, true); }
    catch (x) { ctx.ok(`foundry/${f} imports under Node`, false, x?.stack ?? String(x)); }
  }
  const api = [
    ["movement.mjs", ["groundDistAt", "altitudeOf", "speedOf", "installMovement", "onUpdateToken", "resyncScene", "planElevation"]],
    ["sight-backend.mjs", ["heightSweepClass", "installSightBackend", "createHeightSweepClass", "clearSightCache"]],
    ["cover.mjs", ["coverBetween"]],
    ["install.mjs", ["installRules", "readyRules"]],
  ];
  for (const [f, names] of api) {
    ctx.ok(`foundry/${f} exports ${names.join(", ")}`, names.every((n) => typeof mods[f]?.[n] === "function"));
  }

  /* ---------------- elevation planning ---------------- */
  const plan = mods["movement.mjs"]?.planElevation;
  if (plan) {
    const walkUp = plan({ elevation: 0, action: "walk", ground: 10, altFlag: undefined });
    ctx.ok("sync: a walker is put on the ledge", walkUp?.elevation === 10 && walkUp.writeElevation && !walkUp.writeAltitude);
    ctx.ok("sync: a walker on the ground needs nothing", plan({ elevation: 10, action: "walk", ground: 10, altFlag: 0 }) === null);
    const flyer = plan({ elevation: 30, action: "walk", ground: 10, altFlag: 20 });
    ctx.ok("sync: altitude rides the ground", flyer === null);
    const drop = plan({ elevation: 30, action: "walk", ground: 0, altFlag: 20 });
    ctx.ok("sync: altitude follows the ground down", drop?.elevation === 20);
    const hud = plan({ elevation: 25, action: "walk", ground: 10, altFlag: 0, elevationChanged: true });
    ctx.ok("sync: an explicit elevation above ground becomes altitude", hud?.altitude === 15 && hud.writeAltitude && !hud.writeElevation);
    const under = plan({ elevation: 0, action: "fly", ground: 10, altFlag: 5, elevationChanged: true });
    ctx.ok("sync: never below ground", under?.elevation === 10 && under.altitude === 0);
    ctx.ok("sync: burrowers are left alone", plan({ elevation: -10, action: "burrow", ground: 0 }) === null);
    ctx.ok("sync: a flagless token uses the ground before a repaint",
      plan({ elevation: 20, action: "walk", ground: 0, altFlag: undefined, fallbackAlt: 20 })?.writeAltitude === true
      && plan({ elevation: 20, action: "walk", ground: 0, altFlag: undefined, fallbackAlt: 20 }).writeElevation === false);
    // A new token (a drop, a paste): no flag reads its elevation as set on purpose, a flag rides the ground.
    const dropped = plan({ elevation: 0, action: "walk", ground: 10, altFlag: undefined, elevationChanged: true });
    ctx.ok("create: a token dropped on high ground stands on it", dropped?.elevation === 10 && dropped.writeElevation && !dropped.writeAltitude);
    const pasted = plan({ elevation: 30, action: "walk", ground: 0, altFlag: 20 });
    ctx.ok("create: a pasted flyer keeps its altitude over the new ground", pasted?.elevation === 20 && !pasted.writeAltitude);
  }
  const edit = mods["movement.mjs"]?.isElevationEdit;
  ctx.ok("foundry/movement.mjs exports the elevation-edit seams",
    typeof edit === "function" && typeof mods["movement.mjs"]?.onPreUpdateToken === "function" && typeof mods["movement.mjs"]?.onPreCreateToken === "function");
  if (edit) {
    const src = { x: 100, y: 200, width: 1, height: 1, elevation: 10 };
    ctx.ok("edit: a new elevation on the same square is an edit (the HUD's move carries x and y unchanged)",
      edit(src, { x: 100, y: 200, width: 1, height: 1, elevation: 25 }) && edit(src, { elevation: 25 }));
    ctx.ok("edit: a move is not an edit, and an unchanged elevation is nothing",
      !edit(src, { x: 200, y: 200, elevation: 25 }) && !edit(src, { elevation: 10 }) && !edit(src, { x: 100 }) && !edit(src, null));
  }
  const preUpdate = mods["movement.mjs"]?.onPreUpdateToken, ctxMod = mods["context.mjs"];
  if (preUpdate && ctxMod?.setRulesOn) {
    // A flat or unprepared scene (no terrain at all) still has the 3D view moving tokens at ground +
    // altitude, so the HUD's elevation must land in the flag there too, or the next drag drops the token.
    const had = globalThis.foundry, path = (o, p) => p.split(".").reduce((a, k) => a?.[k], o);
    const set = (o, p, v) => { const ks = p.split("."); let a = o; for (const k of ks.slice(0, -1)) a = a[k] ??= {}; a[ks.at(-1)] = v; };
    globalThis.foundry = { utils: { hasProperty: (o, p) => path(o, p) !== undefined, setProperty: set } };
    const wasOn = ctxMod.rulesOn();
    ctxMod.setRulesOn(true);
    const doc = { parent: null, movementAction: "walk", flags: {}, _source: { x: 100, y: 200, width: 1, height: 1, elevation: 0 } };
    const changes = { elevation: 20 };
    preUpdate(doc, changes, {});
    ctxMod.setRulesOn(wasOn);
    globalThis.foundry = had;
    ctx.ok("edit: a HUD elevation on a scene with no terrain becomes altitude, so a 3D drag keeps it",
      path(changes, "flags.gluniverse-foundry-modules.dio.altitude") === 20, JSON.stringify(changes));
  }
  const foot = mods["movement.mjs"]?.footprintTopQ;
  if (foot) {
    ctx.ok("footprint: a 1x1 token reads its own cell", foot(t, 100, 300, 100, 1, 1) === 8 && foot(t, 100, 200, 100, 1, 1) === 0);
    ctx.ok("footprint: a 2x2 token stands on the highest cell it covers", foot(t, 100, 200, 100, 2, 2) === 8);
    ctx.ok("footprint: a token between squares covers both", foot(t, 100, 250, 100, 1, 1) === 8);
  }
  const speedOf = mods["movement.mjs"]?.speedOf;
  if (speedOf) {
    const actor = { system: { movement: { speeds: { land: { value: 25 }, fly: null } } } };
    ctx.ok("speedOf: PF2e land speed", speedOf(actor, "pf2e") === 25 && speedOf(actor, "pf2e", "walk") === 25);
    ctx.ok("speedOf: PF2e fly without a fly speed is null", speedOf(actor, "pf2e", "fly") === null);
    ctx.ok("speedOf: Daggerheart has none", speedOf(actor, "gluniverse-daggerheart") === null);
  }

  /* ---------------- sight backend over a stub sweep ---------------- */
  const sb = mods["sight-backend.mjs"];
  if (!sb) return;
  class StubVertex {
    constructor(x, y, { distance } = {}) { this.x = x; this.y = y; this._distance = distance; }
  }
  const segX = (p, q, r, s) => {
    const d = (q.x - p.x) * (s.y - r.y) - (q.y - p.y) * (s.x - r.x);
    if (!d) return null;
    const u = ((r.x - p.x) * (s.y - r.y) - (r.y - p.y) * (s.x - r.x)) / d;
    const v = ((r.x - p.x) * (q.y - p.y) - (r.y - p.y) * (q.x - p.x)) / d;
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? { x: p.x + u * (q.x - p.x), y: p.y + u * (q.y - p.y), t0: u, t1: v } : null;
  };
  class StubEdge {
    constructor(a, b, o = {}) {
      this.id = o.id; this.type = o.type ?? "wall"; this.object = o.object ?? null;
      for (const k of ["sight", "light", "move", "sound", "darkness"]) this[k] = o[k] ?? 0;
      this.a = { x: a.x, y: a.y }; this.b = { x: b.x, y: b.y };
      const se = b.x === a.x ? b.y > a.y : b.x > a.x;
      this.nw = se ? this.a : this.b; this.se = se ? this.b : this.a;
      this.intersections = {};
    }
    clone() {
      const c = new StubEdge(this.a, this.b, this);
      c.intersections = Object.fromEntries(Object.entries(this.intersections).map(([k, v]) => [k, [...v]]));
      return c;
    }
    recordIntersections(o, level) {
      const shared = [this.a, this.b].some((p) => [o.a, o.b].some((q) => p.x === q.x && p.y === q.y));
      const i = shared ? null : segX(this.a, this.b, o.a, o.b);
      if (!i) return;
      (this.intersections[level] ??= []).push({ edge: o, intersection: i });
      (o.intersections[level] ??= []).push({ edge: this, intersection: i });
    }
  }
  class StubBase {
    constructor() {
      this.edges = new Set(); this.config = {}; this.origin = { x: 0, y: 0, elevation: 0 };
      this._edgeTypes = { wall: { mode: 1 } }; this.level = { id: "L" }; this.walls = [];
    }
    _identifyEdges() { for (const w of this.walls) this.edges.add(w.clone()); }
    _testEdgeInclusion(edge, types) { return !!types[edge.type]?.mode && edge[this.config.type] !== 0; }
    _testCollision(ray, mode, destination, tMin, tMax) {
      if (tMin < tMax) this._identifyEdges();
      this.superSawCliffs = [...this.edges].some((x) => String(x.id).startsWith("dio.cliff"));
      return mode === "any" ? false : mode === "all" ? [] : null;
    }
  }
  const block = Terrain.blank(6, 6);
  // 20 ft: taller than a medium eye plus the sight reveal, so it outlines sight too.
  for (let si = 4; si < 8; si++) for (let sj = 4; sj < 8; sj++) block.set(si, sj, { h: 16 });
  const live = { terrain: block, grid };
  const Cls = sb.createHeightSweepClass(StubBase, { Edge: StubEdge, Vertex: () => StubVertex, context: () => live });
  const tok = (elevation) => ({ documentName: "Token", elevation, width: 1, height: 1, actor: null });
  const make = (type, { doc = tok(0), origin = { x: 50, y: 250, elevation: 0 }, box = null, walls = [] } = {}) => {
    const p = new Cls();
    p.config = { type, source: doc ? { object: { document: doc } } : null, boundingBox: box };
    p.origin = origin; p.walls = walls;
    return p;
  };
  const cliffsIn = (p) => [...p.edges].filter((x) => String(x.id).startsWith("dio.cliff"));

  const low = make("sight");
  low._identifyEdges();
  ctx.ok("backend: a low eye gets the raised block's outline", cliffsIn(low).length === cliffEdges(block, 4, 100).length
    && cliffsIn(low).length === 4, String(cliffsIn(low).length));
  ctx.ok("backend: cliff edges block sight and light, not movement or sound",
    cliffsIn(low).every((x) => x.sight > 0 && x.light > 0 && x.move === 0 && x.sound === 0));
  ctx.ok("backend: cliff edges are clones of the cache", cliffsIn(low).every((x) => !sb.cliffEdgeObjects(block, 4, 100, StubEdge).includes(x)));
  const high = make("sight", { doc: tok(20) });
  high._identifyEdges();
  ctx.ok("backend: an eye above the block gets none", cliffsIn(high).length === 0);
  const sound = make("sound");
  sound._identifyEdges();
  ctx.ok("backend: sound polygons get none", cliffsIn(sound).length === 0);
  const light = make("light", { doc: null, origin: { x: 50, y: 250, elevation: 0 } });
  light._identifyEdges();
  ctx.ok("backend: a light on the ground is blocked by the block", cliffsIn(light).length === 4);
  ctx.ok("backend: a light's eye is never under the ground",
    sb.polygonEyeQ({ config: { type: "light" }, origin: { x: 250, y: 250, elevation: 0 } }, live) === 17);

  // The sight reveal: a 10 ft block hides its own top from a medium eye's floor
  // view, but a creature standing on it would be seen, so sight is not cut there.
  // Light keeps the exact outline, and a creature behind it is still hidden in 3D.
  const terrace = Terrain.blank(6, 6);
  for (let si = 4; si < 8; si++) for (let sj = 4; sj < 8; sj++) terrace.set(si, sj, { h: 8 });
  const tLive = { terrain: terrace, grid };
  const TCls = sb.createHeightSweepClass(StubBase, { Edge: StubEdge, Vertex: () => StubVertex, context: () => tLive });
  const tMake = (type, doc) => { const p = new TCls(); p.config = { type, source: doc ? { object: { document: doc } } : null }; p.origin = { x: 50, y: 250, elevation: 0 }; return p; };
  const tSight = tMake("sight", tok(0)); tSight._identifyEdges();
  const tLight = tMake("light", null); tLight._identifyEdges();
  ctx.ok("reveal: sight reveals ground a medium creature there would be seen on",
    cliffsIn(tSight).length === 0 && sb.outlineFloorQ(tSight, tLive) === Math.floor(eyeQ(tok(0), grid) + (sb.SIGHT_REVEAL_DIST / grid.distance) * 4),
    String(cliffsIn(tSight).length));
  ctx.ok("reveal: lights keep the exact outline", cliffsIn(tLight).length === 4 && sb.outlineFloorQ(tLight, tLive) === Math.floor(sb.polygonEyeQ(tLight, tLive)));
  ctx.ok("reveal: a creature behind the 10 ft block is still hidden in 3D",
    !sb.targetInClearLine(tLive, eyeQ(tok(0), grid), { x: 50, y: 250 }, { x: 550, y: 250 }, 0, 6));
  ctx.ok("reveal: the lift is a medium creature, from SIZE_HEIGHT", /SIGHT_REVEAL_DIST = SIZE_HEIGHT\.med/.test(readFileSync(join(ctx.root, "scripts/features/diorama/foundry/sight-backend.mjs"), "utf8")));
  const boxed = make("sight", { box: { x: 0, y: 0, width: 300, height: 600 } });
  boxed._identifyEdges();
  ctx.ok("backend: the bounding box filters cliff edges", cliffsIn(boxed).length === 3, String(cliffsIn(boxed).length));
  const wall = new StubEdge({ x: 300, y: 0 }, { x: 300, y: 600 }, { id: "wall1", sight: 20, light: 20 });
  const crossed = make("sight", { walls: [wall] });
  crossed._identifyEdges();
  const wc = [...crossed.edges].find((x) => x.id === "wall1");
  ctx.ok("backend: a wall crossing the outline gets its intersections recorded",
    (wc?.intersections.L ?? []).length === 2 && !wall.intersections.L, JSON.stringify(wc?.intersections.L?.map((x) => x.intersection)));

  const ray = { A: { x: 50, y: 250 }, B: { x: 550, y: 250 } };
  const any = make("sight");
  ctx.ok("backend: a 3D ray into the block collides", any._testCollision(ray, "any", { x: 550, y: 250, elevation: 0 }, 0, 1) === true);
  const over = make("sight", { doc: tok(20) });
  const res = over._testCollision(ray, "any", { x: 550, y: 250, elevation: 20 }, 0, 1);
  ctx.ok("backend: a ray over the block falls through to the walls", res === false && over.superSawCliffs === false);
  const lowWalls = make("sight");
  lowWalls._testCollision({ A: { x: 50, y: 50 }, B: { x: 550, y: 50 } }, "any", { x: 550, y: 50, elevation: 0 }, 0, 1);
  ctx.ok("backend: collision tests never see the 2D outline", lowWalls.superSawCliffs === false);
  const closest = make("sight")._testCollision(ray, "closest", { x: 550, y: 250, elevation: 0 }, 0, 1);
  ctx.ok("backend: closest returns a vertex at the lip", closest instanceof StubVertex && closest._distance > 0.2 && closest._distance < 0.5,
    JSON.stringify(closest));
  const all = make("sight")._testCollision(ray, "all", { x: 550, y: 250, elevation: 0 }, 0, 1);
  ctx.ok("backend: all returns a sorted list", Array.isArray(all) && all.length === 1);

  // Detection: a head above a lip is seen though the feet are not.
  const lip = Terrain.blank(6, 6);
  for (let si = 0; si < 12; si++) lip.set(si, 6, { h: 3 });
  const lipLive = { terrain: lip, grid };
  const eye = eyeQ(tok(0), grid);
  ctx.ok("detection: the feet alone are hidden by the lip",
    rayBlocked(lip, rayPoint(50, 300, eye, 100), rayPoint(550, 300, (0.1 * 6) / 5 * 4, 100)) !== null);
  ctx.ok("detection: the head over the lip is seen", sb.targetInClearLine(lipLive, eye, { x: 50, y: 300 }, { x: 550, y: 300 }, 0, 6));
  ctx.ok("detection: behind the block nothing is seen", !sb.targetInClearLine(live, eye, { x: 50, y: 250 }, { x: 550, y: 250 }, 0, 6));

  // High ground: an eye on a 20 ft plateau sees down onto the low ground, but
  // not a creature pressed against the foot of its own cliff.
  const hill = Terrain.blank(6, 6);
  for (let row = 0; row < 12; row++) for (let col = 0; col < 4; col++) hill.set(row, col, { h: 16 });
  const hillLive = { terrain: hill, grid };
  const HCls = sb.createHeightSweepClass(StubBase, { Edge: StubEdge, Vertex: () => StubVertex, context: () => hillLive });
  const top = new HCls();
  top.config = { type: "sight", source: { object: { document: tok(20) } } };
  top.origin = { x: 125, y: 250, elevation: 20 };
  top._identifyEdges();
  ctx.ok("high ground: sight from the plateau gets no cliff edges", cliffsIn(top).length === 0, String(cliffsIn(top).length));
  const topEye = eyeQ(tok(20), grid);
  ctx.ok("high ground: a creature on the low ground below is seen, feet included",
    sb.clearSampleHeights(hillLive, topEye, { x: 125, y: 250 }, { x: 550, y: 250 }, 0, 6).length === sb.TARGET_SAMPLES.length);
  ctx.ok("high ground: a creature at the foot of the cliff is hidden by the lip",
    !sb.targetInClearLine(hillLive, topEye, { x: 125, y: 250 }, { x: 260, y: 250 }, 0, 6));
  ctx.ok("high ground: from below, the creature on the plateau's edge is seen",
    sb.targetInClearLine(hillLive, eyeQ(tok(0), grid), { x: 550, y: 250 }, { x: 175, y: 250 }, 20, 6));

  // Walls have the top the 3D view draws: an eye above it sees over.
  const wallDoc = (c, flags = {}) => ({ documentName: "Wall", id: "w", c, flags });
  const fence = () => new StubEdge({ x: 300, y: 0 }, { x: 300, y: 150 }, { id: "wall.f", sight: 20, light: 20, object: wallDoc([300, 0, 300, 150]) });
  const bound = () => new StubEdge({ x: 300, y: 0 }, { x: 300, y: 150 }, { id: "bound", sight: 20, light: 20 });
  ctx.ok("walls: a wall's top is the view's (ground + the terrain's wall height)",
    sb.edgeWallTopQ(fence(), live) === block.wallHeight, String(sb.edgeWallTopQ(fence(), live)));
  ctx.ok("walls: an edge with no wall document has no top", sb.edgeWallTopQ(bound(), live) === null);
  const hasFence = (p) => [...p.edges].some((x) => x.id === "wall.f");
  const ground = make("sight", { origin: { x: 50, y: 50, elevation: 0 }, walls: [fence(), bound()] });
  ground._identifyEdges();
  ctx.ok("walls: an eye below the top keeps the wall", hasFence(ground));
  const raised = make("sight", { doc: tok(10), origin: { x: 50, y: 50, elevation: 10 }, walls: [fence(), bound()] });
  raised._identifyEdges();
  ctx.ok("walls: an eye above the top sees over it", !hasFence(raised));
  ctx.ok("walls: scene bounds and other edges always block", [...raised.edges].some((x) => x.id === "bound"));
  const tall = make("sight", { doc: tok(10), origin: { x: 50, y: 50, elevation: 10 },
    walls: [new StubEdge({ x: 300, y: 0 }, { x: 300, y: 150 }, { id: "wall.f", sight: 20, light: 20, object: wallDoc([300, 0, 300, 150], { "wall-height": { top: 30 } }) })] });
  tall._identifyEdges();
  ctx.ok("walls: a Wall Height top is honoured", hasFence(tall));
  const torch = make("light", { doc: null, origin: { x: 50, y: 50, elevation: 15 }, walls: [fence()] });
  torch._identifyEdges();
  ctx.ok("walls: a light above the top lights over it", !hasFence(torch));
  const fRay = { A: { x: 50, y: 50 }, B: { x: 550, y: 50 } };
  const pOver = make("sight", { doc: tok(10), origin: { x: 50, y: 50, elevation: 10 }, walls: [fence()] });
  pOver._testCollision(fRay, "any", { x: 550, y: 50, elevation: 10 }, 0, 1);
  ctx.ok("walls: a point test whose ray passes over the top drops the wall", !hasFence(pOver));
  const pDown = make("sight", { doc: tok(10), origin: { x: 50, y: 50, elevation: 10 }, walls: [fence()] });
  pDown._testCollision(fRay, "any", { x: 550, y: 50, elevation: 0 }, 0, 1);
  ctx.ok("walls: a ray that dips under the top still hits the wall", hasFence(pDown));
  const pLow = make("sight", { origin: { x: 50, y: 50, elevation: 0 }, walls: [fence()] });
  pLow._testCollision(fRay, "any", { x: 550, y: 50, elevation: 0 }, 0, 1);
  ctx.ok("walls: a low ray hits the wall", hasFence(pLow));

  // Movement: a wall's top lets a move over it when the feet clear it within a
  // step. Foundry tests a move from the token's centre, half its depth up.
  const half = grid.distance / 2;
  const moveOver = (feet, walls, toFeet = feet) => {
    const p = make("move", { doc: tok(feet), origin: { x: 50, y: 50, elevation: feet + half }, walls });
    p._testCollision(fRay, "any", { x: 550, y: 50, elevation: toFeet + half }, 0, 1);
    return p;
  };
  ctx.ok("move: walking into a wall is still blocked", hasFence(moveOver(0, [fence()])));
  ctx.ok("move: flying with the feet above the top passes over", !hasFence(moveOver(12, [fence()])));
  ctx.ok("move: flying lower than the top is blocked", hasFence(moveOver(4, [fence()])));
  ctx.ok("move: dropping from above to the ground meets the wall where the feet dip under its top", hasFence(moveOver(12, [fence()], 0)));
  const rail = () => new StubEdge({ x: 300, y: 0 }, { x: 300, y: 150 }, { id: "wall.f", sight: 20, light: 20, move: 20,
    object: wallDoc([300, 0, 300, 150], { "wall-height": { top: 1.5 } }) });
  ctx.ok("move: a rail within the step height is stepped over", !hasFence(moveOver(0, [rail()])));
  ctx.ok("move: scene bounds always block a move", [...moveOver(30, [bound()]).edges].some((x) => x.id === "bound"));
  const movePoly = make("move", { origin: { x: 50, y: 50, elevation: half }, walls: [fence()] });
  movePoly._identifyEdges();
  ctx.ok("move: a movement polygon (no ray) keeps every wall and gets no cliffs", hasFence(movePoly) && cliffsIn(movePoly).length === 0);
  const WT = await import(ctx.url("scripts/features/diorama/terrain/wall-top.mjs"));
  ctx.ok("move: climbing does not pass a wall, and a wall with no top never passes",
    WT.movesOverWall.length === 3 && !WT.movesOverWall(null, 100, 2) && WT.movesOverWall(8, 6, 2) && !WT.movesOverWall(8, 5, 2));
  const R = await import(ctx.url("scripts/features/diorama/rules/reach.mjs"));
  const idx = R.wallIndex([{ ax: 300, ay: 0, bx: 300, by: 600, topQ: 8 }], 100);
  ctx.ok("move: the reach overlay steps over a wall only when the step says so",
    idx.crosses(250, 50, 350, 50) && idx.crosses(250, 50, 350, 50, () => false) && !idx.crosses(250, 50, 350, 50, (w) => w.topQ === 8));
  const src = readFileSync(join(ctx.root, "scripts/features/diorama/foundry/sight-backend.mjs"), "utf8");
  ctx.ok("move: the backend is installed for movement too", /for \(const type of \["sight", "light", "move"\]\)/.test(src));
  const reachSrc = readFileSync(join(ctx.root, "scripts/features/diorama/view/reach.mjs"), "utf8");
  ctx.ok("walls: a flat saved terrain still gives walls their tops (wallContext, not activeContext)",
    /function defaultContext[\s\S]*?return wallContext\(/.test(src) && /function testLOSWrapper[\s\S]*?wallContext\(/.test(src));
  ctx.ok("move: the reach overlay reads the same wall top and rule", /wallSpanQ\(/.test(reachSrc) && /movesOverWall\(/.test(reachSrc));
  ctx.ok("walls: detection tests each clear height against the walls, not only the feet",
    /function testLOSWrapper[\s\S]*clearSampleHeights\([\s\S]*for \(const d of clear\)/.test(src));
  ctx.ok("walls: the view and sight read one wall top",
    /wallSpanQ\(/.test(readFileSync(join(ctx.root, "scripts/features/diorama/view/snapshot.mjs"), "utf8")) && /wallSpanQ\(/.test(src));
}
