/**
 * Editor: the painting tools, undo / redo, Auto setup, the difficult-terrain
 * planner, the session a stroke runs through, every GLDIO.editor.* key, and
 * that every editor module imports under plain Node (the panel, the layer and
 * the preview build their Foundry classes in factories, never at import).
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export default async function check(ctx) {
  const E = (f) => ctx.url(`scripts/features/diorama/editor/${f}`);
  const { Terrain } = await import(ctx.url("scripts/features/diorama/terrain/model.mjs"));
  const { KIND, DIR, SUB, KIND_KEYS, CLIFF_MATERIALS, WALL_MATERIALS } = await import(ctx.url("scripts/features/diorama/constants.mjs"));
  const T = await import(E("tools.mjs"));
  const { autoSetup, autoSetupDetailed, classifyColour } = await import(E("auto-setup.mjs"));
  const D = await import(E("difficult.mjs"));
  const { EditorSession, TOOLS } = await import(E("session.mjs"));

  const snap = (t) => ({ h: t.h.slice(), layer: t.layer.slice(), kind: t.kind.slice(), palette: JSON.stringify(t.palette), walls: JSON.stringify(t.walls) });
  const same = (t, s) => t.h.every((v, k) => v === s.h[k]) && t.layer.every((v, k) => v === s.layer[k])
    && t.kind.every((v, k) => v === s.kind[k]) && JSON.stringify(t.palette) === s.palette && JSON.stringify(t.walls) === s.walls;
  const count = (t, pred) => { let n = 0; for (let k = 0; k < t.h.length; k++) if (pred(k)) n++; return n; };

  /* ── brush ─────────────────────────────────────────────────────────── */
  ctx.ok("brush radius 0 is one sub-cell", T.brushCells(5, 5, 0).length === 1);
  ctx.ok("round brush radius 1 is 3×3", T.brushCells(5, 5, 1).length === 9);
  ctx.ok("round brush radius 2 drops the corners", T.brushCells(5, 5, 2).length === 21, String(T.brushCells(5, 5, 2).length));
  ctx.ok("square brush radius 2 is 5×5", T.brushCells(5, 5, 2, "square").length === 25);
  const t = Terrain.blank(10, 10);
  const ledge = t.palette.findIndex((p) => p.kind === KIND.FLOOR && p.h === 8);
  const ch = T.brush(t, 6, 6, 2, { layer: ledge });
  ctx.ok("brush paints exactly its footprint", ch.count === 21 && count(t, (k) => t.layer[k] === ledge) === 21);
  ctx.ok("brush reports its box", JSON.stringify(ch.box) === "[4,4,8,8]", JSON.stringify(ch.box));
  ctx.ok("painting a layer sets its height", t.topAt(6, 6) === 8);
  ctx.ok("brush clips at the map edge", T.brush(t, 0, 0, 1, { layer: ledge }).count === 4);
  const line = T.lineCells([0, 0], [3, 7]);
  ctx.ok("a stroke line is unbroken", line.length === 8 && line.every(([a, b], i) => i === 0 || Math.max(Math.abs(a - line[i - 1][0]), Math.abs(b - line[i - 1][1])) === 1));

  /* ── rect ──────────────────────────────────────────────────────────── */
  const r = Terrain.blank(8, 8);
  const water = r.palette.findIndex((p) => p.kind === KIND.WATER);
  const rc = T.rect(r, [10, 3], [2, 5], { layer: water });
  ctx.ok("rect fills the inclusive box either way round", rc.count === 9 * 3 && r.kindAt(2, 3) === KIND.WATER && r.kindAt(10, 5) === KIND.WATER && r.kindAt(11, 5) === KIND.FLOOR);
  ctx.ok("rect clamps to the map", T.rect(r, [-5, -5], [1, 1], { layer: water }).count === 4);

  /* ── fill ──────────────────────────────────────────────────────────── */
  const f = Terrain.blank(6, 6);
  for (let si = 0; si < 12; si++) f.paint(si, 6, ledge);               // a ridge splitting the map in two
  const fc = T.fill(f, 0, 0, { layer: water });
  ctx.ok("flood fill stops at a differing column", fc.count === 12 * 6 && f.kindAt(0, 5) === KIND.WATER && f.kindAt(0, 7) === KIND.FLOOR && f.layerAt(0, 6) === ledge);
  f.set(3, 3, { h: 1 });
  const fc2 = T.fill(f, 0, 0, { layer: 0 });
  ctx.ok("flood fill stops at a differing height", fc2.count === 12 * 6 - 1 && f.layerAt(3, 3) === water);

  /* ── wand ──────────────────────────────────────────────────────────── */
  const W = 8, H = 4;
  const col = new Uint8Array(W * H * 3);
  for (let si = 0; si < H; si++) for (let sj = 0; sj < W; sj++) {
    const o = (si * W + sj) * 3;
    const red = sj < 2 || sj >= 6;                      // two red bands, separated by grey
    col[o] = red ? 200 + sj : 100; col[o + 1] = red ? 20 : 100; col[o + 2] = red ? 20 : 100;
  }
  const mc = T.wandSelect(col, W, H, 0, 0, { tolerance: 10, contiguous: true });
  const mg = T.wandSelect(col, W, H, 0, 0, { tolerance: 10, contiguous: false });
  ctx.ok("wand contiguous takes one band", T.maskCount(mc) === 2 * H);
  ctx.ok("wand global takes both bands", T.maskCount(mg) === 4 * H);
  ctx.ok("wand tolerance excludes a far colour", T.maskCount(T.wandSelect(col, W, H, 0, 0, { tolerance: 3, contiguous: false })) === 2 * H);
  const tight = T.wandSelect(col, W, H, 0, 0, { tolerance: 0, contiguous: false });
  ctx.ok("wand tolerance 0 takes the exact colour only", T.maskCount(tight) === H);
  ctx.ok("wand add / subtract", T.maskCount(T.combineMask(mc, mg, "add")) === 4 * H && T.maskCount(T.combineMask(mg, mc, "subtract")) === 2 * H);
  const wt = new Terrain({ cols: W / SUB, rows: H / SUB });
  ctx.ok("applyMask paints the selection", T.applyMask(wt, mc, { layer: water }).count === 2 * H && wt.kindAt(0, 1) === KIND.WATER && wt.kindAt(0, 2) === KIND.FLOOR);

  /* ── raise / lower ─────────────────────────────────────────────────── */
  const rl = Terrain.blank(4, 4, (i, j) => j < 3);
  const visited = new Set();
  T.raise(rl, 2, 2, 1, 4, { visited });
  T.raise(rl, 2, 2, 1, 4, { visited });
  ctx.ok("raise applies once per sub-cell per stroke", rl.h[rl.idx(2, 2)] === 4);
  for (let n = 0; n < 200; n++) T.raise(rl, 2, 2, 0, 8);
  ctx.ok("raise clamps at H_MAX", rl.h[rl.idx(2, 2)] === T.H_MAX);
  for (let n = 0; n < 200; n++) T.lower(rl, 2, 2, 0, 8);
  ctx.ok("lower clamps at H_MIN", rl.h[rl.idx(2, 2)] === T.H_MIN);
  T.raise(rl, 0, 7, 0, 4);
  ctx.ok("void is never raised", rl.isVoid(0, 7) && rl.h[rl.idx(0, 7)] === 0);

  /* ── stairs ────────────────────────────────────────────────────────── */
  ctx.ok("drag east climbs east, so it goes down west", T.dirFromDrag(5, 1) === DIR.W && T.dirFromDrag(0, -4) === DIR.S);
  const st = Terrain.blank(6, 6);
  for (let si = 0; si < 4; si++) for (let sj = 0; sj < 12; sj++) st.set(si, sj, { h: 8 });      // high ground north
  const flight = [[4, 4], [4, 5], [5, 4], [5, 5]];
  for (const [a, b] of flight) st.set(a, b, { h: 4 });
  const sc = T.stairs(st, flight, T.inferStairDir(st, flight));
  ctx.ok("stairs set kind and direction", sc.count === 4 && flight.every(([a, b]) => st.kindAt(a, b) === KIND.STAIRS && st.dirAt(a, b) === DIR.S));
  ctx.ok("stairs keep the height", st.h[st.idx(4, 4)] === 4);
  T.stairs(st, flight, DIR.E, KIND.RAMP);
  ctx.ok("ramp kind and a new direction", st.kindAt(4, 4) === KIND.RAMP && st.dirAt(4, 4) === DIR.E);

  /* ── palette ───────────────────────────────────────────────────────── */
  const pt = Terrain.blank(4, 4);
  T.brush(pt, 2, 2, 1, { layer: ledge });
  T.raise(pt, 2, 2, 0, 1);
  T.updatePaletteEntry(pt, ledge, { h: 12 });
  ctx.ok("moving a named height moves its cells and keeps offsets", pt.topAt(2, 2) === 13 && pt.topAt(1, 1) === 12 && pt.palette[ledge].h === 12);
  T.updatePaletteEntry(pt, ledge, { kind: KIND.PIT });
  ctx.ok("changing a named height's kind changes its cells", pt.kindAt(1, 1) === KIND.PIT);
  const before = pt.palette.length;
  T.removePaletteEntry(pt, 0);
  ctx.ok("removing an entry shifts layers down", pt.palette.length === before - 1 && pt.layerAt(1, 1) === ledge - 1);
  ctx.ok("removing the floor repaints with the next floor", pt.palette[pt.layerAt(0, 0)].kind === KIND.FLOOR);
  const one = new Terrain({ cols: 1, rows: 1, palette: [{ name: "Only", h: 0, color: "#123456", kind: 0, material: "earth" }] });
  ctx.ok("the last entry cannot be removed", T.removePaletteEntry(one, 0).count === 0 && one.palette.length === 1);
  ctx.ok("addPaletteEntry appends above the highest floor", T.addPaletteEntry(pt, {}) === pt.palette.length - 1 && pt.palette.at(-1).h > 0);

  /* ── history ───────────────────────────────────────────────────────── */
  const ht = Terrain.blank(12, 10, (i, j) => j < 11);
  const hist = new T.History(ht, { limit: 50 });
  const states = [snap(ht)];
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let n = 0; n < 12; n++) {
    const op = n % 4 === 0 ? { delta: 3 } : n % 4 === 1 ? { kind: KIND.WATER } : { layer: rnd(ht.palette.length) };
    T.brush(ht, rnd(ht.sh), rnd(ht.sw), rnd(4), op);
    if (n === 5) T.setWallMaterial(ht, "wall1", "hedge");
    if (n === 8) T.updatePaletteEntry(ht, 1, { color: "#abcdef", name: "Renamed" });
    if (hist.commit(ht, `s${n}`)) states.push(snap(ht));     // a no-op stroke is not a step
  }
  ctx.ok("history recorded the strokes", states.length > 6, String(states.length));
  ctx.ok("history is dirty after edits", hist.dirty);
  let undoOk = true;
  for (let n = states.length - 2; n >= 0; n--) { hist.undo(ht); if (!same(ht, states[n])) undoOk = false; }
  ctx.ok("undo restores every step exactly", undoOk && !hist.canUndo);
  ctx.ok("back at the start is clean", !hist.dirty);
  let redoOk = true;
  for (let n = 1; n < states.length; n++) { hist.redo(ht); if (!same(ht, states[n])) redoOk = false; }
  ctx.ok("redo replays every step exactly", redoOk && !hist.canRedo);
  hist.markSaved();
  ctx.ok("markSaved clears dirty", !hist.dirty);
  T.brush(ht, 3, 3, 1, { layer: 0 });
  ht.palette[0].name = "uncommitted";
  hist.undo(ht);
  ctx.ok("undo discards uncommitted edits first", same(ht, states[states.length - 2]));
  ctx.ok("a no-op commit is not a step", !hist.commit(ht, "noop"));
  const bounded = new T.History(ht, { limit: 5 });
  for (let n = 0; n < 9; n++) { ht.set(0, n, { h: n + 1 }); bounded.commit(ht, "b"); }
  ctx.ok("history is bounded", bounded.done.length === 5);
  const aux = new T.History(ht, { aux: { pending: [] } });
  aux.commit(ht, "aux", { pending: [{ cells: ["1.1"], difficulty: 2 }] });
  ctx.ok("aux rides the history", aux.undo(ht)?.aux?.pending?.length === 0 && aux.redo(ht)?.aux?.pending?.length === 1);

  /* ── auto setup ────────────────────────────────────────────────────── */
  const cols = 20, rows = 16, size = 100;
  const sw = cols * SUB, sh = rows * SUB;
  const map = new Uint8Array(sw * sh * 3);
  const put = (si, sj, rgb) => { const o = (si * sw + sj) * 3; map[o] = rgb[0]; map[o + 1] = rgb[1]; map[o + 2] = rgb[2]; };
  for (let si = 0; si < sh; si++) for (let sj = 0; sj < sw; sj++) {
    const i = Math.floor(si / SUB), j = Math.floor(sj / SUB);
    let rgb = [12, 11, 14];                                             // the black around the dungeon
    if (i >= 4 && i < 12 && j >= 5 && j < 15) rgb = [150, 132, 104];   // the room's flagstones
    if (i >= 10 && i < 12 && j >= 12 && j < 15) rgb = [14, 12, 12];    // a dark shadow inside the room
    if (i >= 7 && i < 9 && j >= 8 && j < 11) rgb = [38, 96, 196];      // the pool
    rgb = rgb.map((v, c) => Math.max(0, Math.min(255, v + ((si * 7 + sj * 13 + c) % 5) - 2)));   // a little texture
    put(si, sj, rgb);
  }
  const box = (x0, y0, x1, y1) => [
    { a: [x0, y0], b: [x1, y0] }, { a: [x1, y0], b: [x1, y1] }, { a: [x1, y1], b: [x0, y1] }, { a: [x0, y1], b: [x0, y0] },
  ];
  const input = {
    colours: map, cols, rows, gridSize: size,
    walls: box(500, 400, 1500, 1200),
    sceneInside: (i, j) => i >= 1 && i < rows - 1 && j >= 1 && j < cols - 1,
  };
  const a1 = autoSetupDetailed(input), a2 = autoSetup(input);
  const at = a1.terrain;
  const cellKind = (tt, i, j) => tt.kindAt(i * SUB, j * SUB);
  ctx.ok("auto: colour classes", classifyColour(10, 10, 12) === "void" && classifyColour(38, 96, 196) === "water" && classifyColour(150, 132, 104) === "floor");
  ctx.ok("auto: room cells are floor at 0", cellKind(at, 5, 6) === KIND.FLOOR && at.cellTop(5, 6) === 0);
  ctx.ok("auto: dark inside a room stays floor", cellKind(at, 11, 13) === KIND.FLOOR, `kind ${cellKind(at, 11, 13)}`);
  ctx.ok("auto: dark outside rooms is void", cellKind(at, 2, 2) === KIND.VOID && cellKind(at, 13, 17) === KIND.VOID);
  ctx.ok("auto: the pool is water just below 0", cellKind(at, 7, 9) === KIND.WATER && at.topAt(7 * SUB, 9 * SUB) < 0 && at.topAt(7 * SUB, 9 * SUB) > -4);
  ctx.ok("auto: outside the scene is void", cellKind(at, 0, 0) === KIND.VOID && cellKind(at, rows - 1, 5) === KIND.VOID);
  ctx.ok("auto: flat art drafts no heights", at.distinctTops().every((q) => q <= 0), String(at.distinctTops()));
  const off = autoSetup({ ...input, options: { heights: false } });
  ctx.ok("auto: heights off keeps every top at or below 0", off.distinctTops().every((q) => q <= 0));
  ctx.ok("auto: deterministic across runs", at.h.every((v, k) => v === a2.h[k]) && at.kind.every((v, k) => v === a2.kind[k]) && at.layer.every((v, k) => v === a2.layer[k]));
  ctx.ok("auto: counts the enclosed room", a1.stats.roomCells === 8 * 10, String(a1.stats.roomCells));
  const open = autoSetup({ ...input, walls: [] });
  ctx.ok("auto: without walls the dark patch is void (rooms come from walls)", cellKind(open, 11, 13) === KIND.VOID);
  const gap = autoSetup({ ...input, walls: box(500, 400, 1500, 1200).slice(1) });
  ctx.ok("auto: a room with a missing wall is not enclosed", cellKind(gap, 11, 13) === KIND.VOID);
  const kept = autoSetup({ ...input, palette: [{ name: "Ground", h: 0, color: "#556644", kind: KIND.FLOOR, material: "stone" }] });
  ctx.ok("auto: keeps the draft palette and adds what it needs", kept.palette[0].name === "Ground"
    && kept.palette.some((p) => p.kind === KIND.VOID) && kept.palette.some((p) => p.kind === KIND.WATER));
  ctx.ok("auto: no colours still drafts walls and void", autoSetup({ ...input, colours: null }).kindAt(0, 0) === KIND.VOID);

  /* ── auto setup options dialog ─────────────────────────────────────── */
  const AD = await import(E("auto-dialog.mjs"));
  const AS = await import(E("auto-setup.mjs"));
  const html = AD.autoDialogContent({ light: "SW", faces: "S", heightScale: 1.5, step: 5, heights: true }, { units: "ft", t: (k) => k });
  const names = [...html.matchAll(/name="([^"]+)"/g)].map((m) => m[1]).sort();
  ctx.ok("auto dialog: one field per option", JSON.stringify(names) === JSON.stringify(Object.keys(AS.AUTO_DEFAULTS).sort()), names.join(", "));
  // Read the rendered form back the way the dialog does: selected options, checked box, values.
  const field = (name) => {
    const sel = new RegExp(`<select name="${name}"[^>]*>([\\s\\S]*?)</select>`).exec(html);
    if (sel) return { value: /<option value="([^"]*)" selected/.exec(sel[1])?.[1] };
    const inp = new RegExp(`<input[^>]*name="${name}"[^>]*>`).exec(html)?.[0] ?? "";
    return { value: /value="([^"]*)"/.exec(inp)?.[1], checked: / checked/.test(inp) };
  };
  const back = AD.readAutoForm(Object.fromEntries(names.map((n) => [n, field(n)])));
  ctx.ok("auto dialog: the form reads back as the options it showed", JSON.stringify(back)
    === JSON.stringify(AS.autoOptions({ light: "SW", faces: "S", heightScale: 1.5, step: 5, heights: true })), JSON.stringify(back));
  ctx.ok("auto dialog: every light and face choice is offered", AS.LIGHT_DIRS.every((d) => html.includes(`value="${d}"`)) && AS.FACE_SIDES.every((d) => html.includes(`value="${d}"`)));
  ctx.ok("auto dialog: options without storage are the defaults", JSON.stringify(AD.loadAutoOptions()) === JSON.stringify(AS.autoOptions({})));
  ctx.ok("auto dialog: the done sentence names the light", AD.describeAuto({ sampled: true, light: "NW" }, {}, (k, d) => `${k}${d ? JSON.stringify(d) : ""}`).includes("GLDIO.editor.auto.dir.NW"));

  /* ── difficult terrain ─────────────────────────────────────────────── */
  const cells = ["0.0", "0.1", "0.2", "1.0", "1.1", "1.2", "2.0", "3.5"];
  const rects = D.cellsToRects(cells);
  const covered = new Set();
  for (const q of rects) for (let i = q.i; i < q.i + q.h; i++) for (let j = q.j; j < q.j + q.w; j++) covered.add(D.cellKey(i, j));
  ctx.ok("rects cover the cells exactly", covered.size === cells.length && cells.every((k) => covered.has(k)));
  ctx.ok("rects merge rows", rects.length === 3, JSON.stringify(rects));
  const shapes = D.shapesFor(["2.3"], 100);
  ctx.ok("region shape is a px rectangle", shapes.length === 1 && shapes[0].type === "rectangle" && shapes[0].x === 300 && shapes[0].y === 200 && shapes[0].width === 100);
  const existing = [{ id: "r2", cells: ["0.0", "0.1", "0.2"], difficulty: 2 }];
  const p1 = D.planDifficult(existing, [{ cells: ["0.1", "5.5"], difficulty: 3 }]);
  ctx.ok("×3 over ×2 moves the cell out (never stacks)", p1.final.get("0.1") === 3 && p1.update[0]?.cells.join() === "0.0,0.2" && p1.create[0]?.cells.join() === "0.1,5.5");
  const p2 = D.planDifficult(existing, [{ cells: ["0.0", "0.1", "0.2"], difficulty: 0 }]);
  ctx.ok("erasing every cell deletes the region", p2.remove.join() === "r2" && !p2.final.size && !p2.create.length);
  const p3 = D.planDifficult(existing, [{ cells: ["0.0", "0.1"], difficulty: 2 }]);
  ctx.ok("painting the same difficulty again writes nothing", !p3.update.length && !p3.create.length && !p3.remove.length);
  ctx.ok("the behaviour is core's movement cost", D.BEHAVIOR_TYPE === "modifyMovementCost");

  /* ── session ───────────────────────────────────────────────────────── */
  const s = new EditorSession({ terrain: Terrain.blank(8, 8), grid: { size: 100, cols: 8, rows: 8, distance: 5, units: "ft" },
    walls: [{ id: "w1", a: [0, 300], b: [800, 300] }] });
  const s0 = snap(s.terrain);
  const events = [];
  s.on((k) => events.push(k));
  s.setLayer(ledge);
  s.down({ si: 2, sj: 2 }); s.move({ si: 2, sj: 9 }); s.up({ si: 2, sj: 9 });
  ctx.ok("session: a stroke paints a line", s.terrain.layerAt(2, 5) === ledge && s.dirty && events.includes("terrain") && events.includes("history"));
  s.down({ si: 6, sj: 6, shift: true }); s.up();
  ctx.ok("session: shift erases to floor", s.terrain.layerAt(6, 6) === T.floorIndex(s.terrain.palette) || s.terrain.layerAt(6, 6) === 0);
  s.down({ si: 2, sj: 5, alt: true });
  ctx.ok("session: alt is the eyedropper", s.layer === ledge && !s.stroking);
  s.setTool("wall");
  s.set("material", "hedge");
  s.down({ si: 0, sj: 0, x: 400, y: 304, tolPx: 10 });
  ctx.ok("session: clicking a wall sets its material", s.terrain.walls.w1 === "hedge");
  s.setTool("difficult");
  s.down({ si: 0, sj: 0 }); s.move({ si: 0, sj: 6 }); s.up();
  ctx.ok("session: difficult strokes are pending, per cell", s.pending.length === 1 && s.difficultMap.size >= 3);
  s.undo();
  ctx.ok("session: undo takes the pending stroke back", s.pending.length === 0);
  while (s.canUndo) s.undo();
  ctx.ok("session: undo all returns the saved terrain", same(s.terrain, s0) && !s.dirty);
  s.setTool("wand");
  let asked = false;
  s.onNeedColours = () => { asked = true; };
  s.down({ si: 1, sj: 1 });
  ctx.ok("session: the wand asks for colours it does not have", asked && !s.mask);
  ctx.ok("session: every tool is known", TOOLS.length === 9);

  /* ── i18n ──────────────────────────────────────────────────────────── */
  const langPath = join(ctx.root, "lang/diorama-editor.en.json");
  const lang = JSON.parse(readFileSync(langPath, "utf8"));
  ctx.ok("lang keys are flat and namespaced", Object.keys(lang).every((k) => k.startsWith("GLDIO.editor.") && typeof lang[k] === "string"));
  const srcDir = join(ctx.root, "scripts/features/diorama/editor");
  const sources = readdirSync(srcDir).filter((f) => f.endsWith(".mjs")).map((f) => readFileSync(join(srcDir, f), "utf8"));
  const tplDir = join(ctx.root, "templates/diorama");
  const templates = existsSync(tplDir) ? readdirSync(tplDir).filter((f) => /^editor.*\.hbs$/.test(f)).map((f) => readFileSync(join(tplDir, f), "utf8")) : [];
  ctx.ok("the editor template exists", templates.length > 0);
  const used = new Set();
  for (const src of [...sources, ...templates]) {
    for (const m of src.matchAll(/GLDIO\.editor\.[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*/g)) {
      if (src[m.index + m[0].length] === "$" || src.slice(m.index + m[0].length, m.index + m[0].length + 2) === ".$") continue;
      if (m[0].endsWith(".")) continue;
      used.add(m[0]);
    }
  }
  // Dynamic families built at runtime.
  for (const id of TOOLS) { used.add(`GLDIO.editor.tool.${id}`); used.add(`GLDIO.editor.hint.${id}`); }
  for (const e of ["none", "load", "tainted"]) used.add(`GLDIO.editor.colours.${e}`);
  for (const d of AS.LIGHT_DIRS) used.add(`GLDIO.editor.auto.dir.${d}`);
  for (const f of AS.FACE_SIDES) used.add(`GLDIO.editor.auto.face.${f}`);
  const missing = [...used].filter((k) => !(k in lang));
  ctx.ok("every GLDIO.editor key used exists", !missing.length, missing.join(", "));
  // The shared families the editor reads (owned by the feature's main lang file).
  const mainLang = join(ctx.root, "lang/diorama.en.json");
  if (existsSync(mainLang)) {
    const m = JSON.parse(readFileSync(mainLang, "utf8"));
    const has = (k) => k in m || k.split(".").reduce((o, p) => (o && typeof o === "object" ? o[p] : undefined), m) !== undefined;
    const need = [...KIND_KEYS.map((k) => `GLDIO.kind.${k}`), ...CLIFF_MATERIALS.map((k) => `GLDIO.material.cliff.${k}`),
      ...WALL_MATERIALS.map((k) => `GLDIO.material.wall.${k}`)];
    const miss = need.filter((k) => !has(k));
    ctx.ok("the kind / material keys the editor shows exist", !miss.length, miss.join(", "));
  }

  /* ── imports under Node ────────────────────────────────────────────── */
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith(".mjs"))) {
    try { await import(E(f)); ctx.ok(`${f} imports under Node`, true); }
    catch (e) { ctx.ok(`${f} imports under Node`, false, e?.message ?? String(e)); }
  }
  // The renderer is loaded lazily, inside the preview window only.
  const preview = readFileSync(join(srcDir, "preview.mjs"), "utf8");
  ctx.ok("the renderer is imported lazily", /await import\(["']\.\.\/render\/renderer\.mjs["']\)/.test(preview)
    && !/^import[^;]*render\/renderer/m.test(sources.join("\n")));
}
