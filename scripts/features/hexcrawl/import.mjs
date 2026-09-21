/**
 * Hexcrawl — JSON import / export.
 *
 * Pure. The import format (docs/HEXCRAWL_IMPORT.md) is written for people and
 * for language models authoring a map outside Foundry, so it is forgiving where
 * forgiveness is safe — terrain names instead of ids, "hills" for "rolling",
 * region references by name, a bare Font Awesome icon name — and loud where it
 * is not: everything it had to guess or drop comes back in `warnings`, which the
 * dialog shows before anything is written.
 *
 * Coordinates are Foundry grid OFFSETS: `col` is the column (Foundry j), `row`
 * the row (Foundry i), both 0-based from the top-left hex. With the default
 * flat-top "odd" grid, odd columns sit half a hex lower (Red Blob's "odd-q").
 *
 * exportMap() emits the same format, and parseImport(exportMap(x)) reproduces x.
 */

import {
  BUILTIN_TERRAIN_IDS, DEFAULT_MASK_PRESET, GLYPH_IDS, LANDMARK_VIS, MASK_FIELDS,
  MASK_PRESETS, MAX_LANDMARKS_PER_HEX, RATING_MAX, RATING_MIN, RUMOR_TRUTH,
} from "./constants.mjs";
import { HEX_TYPES, key as offKey, parseKey } from "./hex-math.mjs";
import {
  emptyMap, isBlankHex, normalizeConfig, normalizeHex, normalizeMap, normalizeRegion, normalizeTerrain,
} from "./model.mjs";

export const IMPORT_FORMAT = "glhex-map";
export const IMPORT_VERSION = 1;
export const IMPORT_LIMITS = Object.freeze({ maxCols: 200, maxRows: 200, maxHexes: 20000 });

/** Common words for the built-in habitats. Keys are compared lower-case, spaces/dashes stripped. */
export const TERRAIN_ALIASES = Object.freeze({
  plains: "grassland", plain: "grassland", grass: "grassland", grasslands: "grassland", meadow: "grassland",
  meadows: "grassland", prairie: "grassland", steppe: "grassland", field: "grassland", fields: "grassland",
  woods: "forest", wood: "forest", woodland: "forest", forests: "forest", taiga: "forest",
  jungle: "tropical", rainforest: "tropical",
  swamp: "wetland", marsh: "wetland", bog: "wetland", fen: "wetland", wetlands: "wetland", mire: "wetland",
  water: "aquatic", lake: "aquatic", river: "aquatic", coast: "aquatic", coastal: "aquatic", shallows: "aquatic",
  sea: "ocean", deepwater: "ocean",
  desert: "drylands", dryland: "drylands", arid: "drylands", dunes: "drylands", savanna: "drylands", scrub: "drylands",
  hills: "rolling", hill: "rolling", rollinghills: "rolling", downs: "rolling", highlands: "rolling",
  mountains: "mountain", peaks: "mountain", alpine: "mountain",
  tundra: "frozen", snow: "frozen", ice: "frozen", arctic: "frozen", glacier: "frozen", frost: "frozen",
  wasteland: "badlands", wastes: "badlands", canyon: "badlands", canyons: "badlands", barrens: "badlands",
  cave: "underground", caves: "underground", cavern: "underground", underdark: "underground", subterranean: "underground",
});

const BLIGHT_WORDS = new Set(["shadowblighted", "blighted", "blight", "shadowblight"]);
const norm = (s) => String(s ?? "").toLowerCase().replace(/[\s_\-']/g, "");
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));
const slug = (s) => norm(s).replace(/[^a-z0-9]/g, "") || null;

/** Offset grid type from the friendly pair (or a raw Foundry number). */
export function gridTypeFrom(grid) {
  if (!isObj(grid)) return HEX_TYPES.HEXODDQ;
  if ([2, 3, 4, 5].includes(Number(grid.type))) return Number(grid.type);
  const pointy = /^(pointy|rows?|pointy-?top)$/i.test(str(grid.orientation));
  const even = /^even$/i.test(str(grid.offset));
  if (pointy) return even ? HEX_TYPES.HEXEVENR : HEX_TYPES.HEXODDR;
  return even ? HEX_TYPES.HEXEVENQ : HEX_TYPES.HEXODDQ;
}
export function gridFromType(type) {
  return {
    orientation: type === 2 || type === 3 ? "pointy" : "flat",
    offset: type === 3 || type === 5 ? "even" : "odd",
  };
}

/** "tower-observation" | "fa-tower-observation" | "fa-solid fa-tower-observation" → full class. */
export function normalizeIcon(v) {
  const s = str(v);
  if (!s) return null;
  if (/\bfa-(solid|regular|brands|light|thin|duotone)\b|\bfa[srlbd]\b/.test(s)) return s;
  const name = s.replace(/^fa-/, "");
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  return `fa-solid fa-${name}`;
}

/**
 * Parse an import document.
 * @param {object|string} input
 * @returns {{ scene:{name,gridType,size,cols,rows,background}, map, start:string|null, warnings:string[] }}
 * Throws only for input that is not a document at all (bad JSON, not an object).
 */
export function parseImport(input) {
  let doc = input;
  if (typeof doc === "string") {
    try { doc = JSON.parse(doc); } catch (e) { throw new Error(`Not valid JSON: ${e.message}`); }
  }
  if (!isObj(doc)) throw new Error("The import must be a JSON object.");
  const warnings = [];
  const warn = (m) => { if (warnings.length < 200) warnings.push(m); };
  if (doc.format && doc.format !== IMPORT_FORMAT) warn(`Unknown "format" ${JSON.stringify(doc.format)} — reading it as ${IMPORT_FORMAT}.`);
  if (doc.version && Number(doc.version) > IMPORT_VERSION) warn(`Written for a newer version (${doc.version}); unknown fields are ignored.`);

  const sc = isObj(doc.scene) ? doc.scene : {};
  const map = emptyMap();
  map.config = normalizeConfig(isObj(doc.config) ? doc.config : {});

  /* ── Terrains ── */
  const customByNorm = new Map();
  for (const [n, raw] of (Array.isArray(doc.terrains) ? doc.terrains : []).entries()) {
    if (!isObj(raw)) { warn(`terrains[${n}] is not an object — skipped.`); continue; }
    const id = slug(raw.id) || slug(raw.name);
    if (!id) { warn(`terrains[${n}] has no id or name — skipped.`); continue; }
    if (raw.glyph && !GLYPH_IDS.includes(raw.glyph)) warn(`Terrain "${id}": unknown glyph "${raw.glyph}" — drawn without one.`);
    map.terrains[id] = normalizeTerrain({ ...raw, id, name: str(raw.name) || id }, id);
    customByNorm.set(norm(id), id);
    if (raw.name) customByNorm.set(norm(raw.name), id);
  }

  const autoTerrains = new Map();
  /** Resolve a terrain word → { id, blight }. Unknown words become auto custom terrains (warned once). */
  function resolveTerrain(word, where) {
    const w = norm(word);
    if (!w) return { id: null, blight: false };
    if (BLIGHT_WORDS.has(w)) return { id: null, blight: true };
    if (customByNorm.has(w)) return { id: customByNorm.get(w), blight: false };
    if (BUILTIN_TERRAIN_IDS.includes(w)) return { id: w, blight: false };
    if (TERRAIN_ALIASES[w]) return { id: TERRAIN_ALIASES[w], blight: false };
    const id = slug(word);
    if (!autoTerrains.has(id)) {
      autoTerrains.set(id, true);
      map.terrains[id] = normalizeTerrain({ id, name: str(word), color: hashColor(id), glyph: "none" }, id);
      customByNorm.set(w, id);
      warn(`Unknown terrain "${word}" (${where}) — created as a custom terrain; set its colour and glyph in the terrain manager.`);
    }
    return { id, blight: false };
  }

  /* ── Regions ── */
  const regionByNorm = new Map();
  const regionHexLists = [];
  for (const [n, raw] of (Array.isArray(doc.regions) ? doc.regions : []).entries()) {
    if (!isObj(raw)) { warn(`regions[${n}] is not an object — skipped.`); continue; }
    let id = slug(raw.id) || slug(raw.name) || `region${n}`;
    while (map.regions[id]) id = `${id}_`;
    const where = `region "${raw.name ?? id}"`;
    const t = resolveTerrain(raw.terrain ?? raw.habitat, where);
    const rumor = isObj(raw.rumor) ? { ...raw.rumor } : raw.rumor ? { text: str(raw.rumor) } : {};
    // JSON booleans are the obvious way to write a yes/no truth; accept them as the strings they mean.
    if (typeof rumor.truth === "boolean") rumor.truth = String(rumor.truth);
    if (rumor.truth && !RUMOR_TRUTH.includes(rumor.truth)) warn(`${where}: rumour truth "${rumor.truth}" is not one of ${RUMOR_TRUTH.join("/")} — using "true".`);
    const rating = ratingOf(raw.rating ?? raw.terrainRating, where, warn);
    map.regions[id] = normalizeRegion({
      id, name: str(raw.name) || id, t: t.id, rt: rating,
      color: raw.color ?? null, bl: !!(raw.blight || t.blight),
      enc: { text: str(raw.encounter?.text ?? raw.encounter), table: str(raw.encounterTable ?? raw.encounter?.table) || null },
      rumor: { text: str(rumor.text), truth: rumor.truth, known: !!rumor.known, table: str(rumor.table ?? raw.rumorTable) || null },
      notes: str(raw.notes),
    }, id);
    if (raw.color && !/^#[0-9a-f]{6}$/i.test(String(raw.color))) warn(`${where}: colour "${raw.color}" is not #rrggbb — ignored.`);
    regionByNorm.set(norm(id), id);
    if (raw.name) regionByNorm.set(norm(raw.name), id);
    if (Array.isArray(raw.hexes)) regionHexLists.push([id, raw.hexes, where]);
  }
  const resolveRegion = (ref, where) => {
    if (ref == null || ref === "") return null;
    const id = regionByNorm.get(norm(ref));
    if (!id) warn(`${where}: unknown region "${ref}" — left unassigned.`);
    return id ?? null;
  };

  /* ── Hex accumulation ── */
  const hexes = new Map(); // key → raw working hex
  let maxRow = -1, maxCol = -1;
  const touch = (row, col) => {
    const k = offKey(row, col);
    if (!hexes.has(k)) hexes.set(k, { st: "hidden" });
    if (row > maxRow) maxRow = row;
    if (col > maxCol) maxCol = col;
    return hexes.get(k);
  };
  const coordOf = (c, where) => {
    let col, row;
    if (Array.isArray(c)) [col, row] = c;
    else if (isObj(c)) { col = c.col ?? c.x ?? c.j; row = c.row ?? c.y ?? c.i; }
    else if (typeof c === "string" && /^\s*-?\d+\s*,\s*-?\d+\s*$/.test(c)) [col, row] = c.split(",").map(Number);
    col = Number(col); row = Number(row);
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0) {
      warn(`${where}: bad coordinate ${JSON.stringify(c)} — expected {col,row} or [col,row], 0-based.`);
      return null;
    }
    if (col >= IMPORT_LIMITS.maxCols || row >= IMPORT_LIMITS.maxRows) {
      warn(`${where}: coordinate ${col},${row} is beyond the ${IMPORT_LIMITS.maxCols}×${IMPORT_LIMITS.maxRows} limit — skipped.`);
      return null;
    }
    return { col, row };
  };

  // 1. ASCII layout (lowest priority).
  if (isObj(doc.layout)) {
    const legend = isObj(doc.layout.legend) ? doc.layout.legend : {};
    const rows = Array.isArray(doc.layout.rows) ? doc.layout.rows : [];
    rows.forEach((line, row) => {
      const cells = Array.isArray(line) ? line : [...String(line)].filter((ch) => ch !== " " || doc.layout.spaces === true);
      cells.forEach((ch, col) => {
        if (!Object.hasOwn(legend, ch)) {
          if (ch !== "." && ch !== " ") warn(`layout row ${row}: symbol "${ch}" is not in the legend — left blank.`);
          return;
        }
        const entry = legend[ch];
        if (entry == null) return;
        applyFields(touch(row, col), typeof entry === "string" ? { terrain: entry } : entry, `layout "${ch}"`);
      });
    });
  }

  // 2. Region hex lists.
  for (const [id, list, where] of regionHexLists) {
    for (const c of list) {
      const p = coordOf(c, where);
      if (p) touch(p.row, p.col).rg = id;
    }
  }

  // 3. Explicit hexes (highest priority).
  for (const [n, raw] of (Array.isArray(doc.hexes) ? doc.hexes : []).entries()) {
    if (!isObj(raw)) { warn(`hexes[${n}] is not an object — skipped.`); continue; }
    const p = coordOf(raw.at ?? raw, `hexes[${n}]`);
    if (!p) continue;
    applyFields(touch(p.row, p.col), raw, `hex ${p.col},${p.row}`);
  }

  function applyFields(h, raw, where) {
    if (raw.terrain != null || raw.habitat != null) {
      const t = resolveTerrain(raw.terrain ?? raw.habitat, where);
      if (t.id) h.t = t.id; else delete h.t;
      if (t.blight) h.bl = true;
    }
    if (raw.region != null) { const id = resolveRegion(raw.region, where); if (id) h.rg = id; }
    if (raw.rating != null) { const r = ratingOf(raw.rating, where, warn); if (r) h.rt = r; }
    if (raw.blight != null) { if (raw.blight) h.bl = true; else delete h.bl; }
    if (raw.visited != null) { if (raw.visited) h.vs = true; else delete h.vs; }
    if (raw.cost != null && raw.cost !== "") {
      const c = Number(raw.cost);
      if (Number.isFinite(c) && c >= 0) h.cost = c; else warn(`${where}: cost "${raw.cost}" is not a number ≥ 0 — ignored.`);
    }
    if (raw.name != null) h.nm = str(raw.name);
    if (raw.notes != null) h.nt = str(raw.notes);
    if (raw.state != null) applyState(h, raw.state, raw.mask, where);
    else if (raw.mask != null) applyState(h, "masked", raw.mask, where);
    if (Array.isArray(raw.landmarks)) {
      if (raw.landmarks.length > MAX_LANDMARKS_PER_HEX) warn(`${where}: ${raw.landmarks.length} landmarks — only the first ${MAX_LANDMARKS_PER_HEX} are kept.`);
      h.lm = raw.landmarks.slice(0, MAX_LANDMARKS_PER_HEX).map((l, n) => {
        const L = typeof l === "string" ? { label: l } : isObj(l) ? l : {};
        const vis = L.visibility ?? L.vis ?? "follow";
        if (!LANDMARK_VIS.includes(vis)) warn(`${where}: landmark visibility "${vis}" is not one of ${LANDMARK_VIS.join("/")} — using "follow".`);
        const icon = normalizeIcon(L.icon);
        if (L.icon && !icon) warn(`${where}: landmark icon "${L.icon}" is not a Font Awesome name — dropped.`);
        return {
          id: `lm${n}`, icon: L.img ? null : icon ?? (L.img ? null : "fa-solid fa-location-dot"),
          img: str(L.img) || null, label: str(L.label ?? L.name), journal: str(L.journal) || null,
          vis: LANDMARK_VIS.includes(vis) ? vis : "follow",
        };
      });
    }
  }

  function applyState(h, state, mask, where) {
    const s = norm(state);
    if (s === "hidden" || s === "revealed") { h.st = s; delete h.mk; return; }
    if (s === "masked" || MASK_PRESETS[s]) {
      const p = MASK_PRESETS[s] ? s : (isObj(mask) && MASK_PRESETS[mask.preset] ? mask.preset : DEFAULT_MASK_PRESET);
      const f = {};
      if (isObj(mask)) for (const k of MASK_FIELDS) if (typeof mask[k] === "boolean") f[k] = mask[k];
      h.st = "masked"; h.mk = { p, f };
      return;
    }
    warn(`${where}: state "${state}" is not hidden/revealed/masked/${Object.keys(MASK_PRESETS).join("/")} — left hidden.`);
  }

  // Commit hexes.
  let count = 0;
  for (const [k, h] of hexes) {
    if (isBlankHex(h)) continue;
    if (++count > IMPORT_LIMITS.maxHexes) { warn(`More than ${IMPORT_LIMITS.maxHexes} hexes — the rest were skipped.`); break; }
    map.hexes[k] = normalizeHex(h);
  }

  /* ── Scene ── */
  const cols = Math.max(1, Math.min(IMPORT_LIMITS.maxCols, Number(sc.cols) || maxCol + 1 || 20));
  const rows = Math.max(1, Math.min(IMPORT_LIMITS.maxRows, Number(sc.rows) || maxRow + 1 || 14));
  if (Number(sc.cols) && maxCol >= Number(sc.cols)) warn(`Hexes reach column ${maxCol}, beyond scene.cols ${sc.cols} — they will sit off the scene.`);
  if (Number(sc.rows) && maxRow >= Number(sc.rows)) warn(`Hexes reach row ${maxRow}, beyond scene.rows ${sc.rows} — they will sit off the scene.`);
  const size = Math.max(50, Math.min(400, Math.round(Number(sc.grid?.size ?? sc.size) || 100)));

  let start = null;
  if (doc.start != null) {
    const p = coordOf(doc.start, "start");
    if (p) start = offKey(p.row, p.col);
  }

  return {
    scene: {
      name: str(sc.name) || str(doc.name) || "Hexcrawl",
      gridType: gridTypeFrom(sc.grid),
      size, cols, rows,
      background: str(sc.background) || null,
    },
    map: normalizeMap(map),
    start,
    warnings,
  };
}

function ratingOf(v, where, warn) {
  if (v == null || v === "") return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < RATING_MIN || n > RATING_MAX) {
    warn(`${where}: rating "${v}" is not ${RATING_MIN}–${RATING_MAX} — ignored.`);
    return null;
  }
  return n;
}

/** A stable, muted colour for an auto-created terrain. */
function hashColor(s) {
  let h = 0;
  for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  // HSL(hue, 30%, 50%) → hex
  const l = 0.5, c = (1 - Math.abs(2 * l - 1)) * 0.3, x = c * (1 - Math.abs(((hue / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hue < 60 ? [c, x, 0] : hue < 120 ? [x, c, 0] : hue < 180 ? [0, c, x] : hue < 240 ? [0, x, c] : hue < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}

/* ── Export ─────────────────────────────────────────────────────────────── */

/**
 * MapData (+ scene facts) → the import format. Regions carry their hex lists;
 * per-hex entries carry only what differs from "a hidden hex in its region".
 */
export function exportMap(map, { name = "Hexcrawl", gridType = HEX_TYPES.HEXODDQ, size = 100, cols = null, rows = null, background = null } = {}) {
  map = normalizeMap(map);
  const regionHexes = {};
  const hexes = [];
  let maxRow = -1, maxCol = -1;
  for (const [k, h] of Object.entries(map.hexes)) {
    const { i: row, j: col } = parseKey(k);
    maxRow = Math.max(maxRow, row); maxCol = Math.max(maxCol, col);
    if (h.rg && map.regions[h.rg]) (regionHexes[h.rg] ??= []).push([col, row]);
    const e = { col, row };
    if (h.t) e.terrain = h.t;
    if (h.rg && !map.regions[h.rg]) e.region = h.rg;
    if (h.rt) e.rating = h.rt;
    if (h.st && h.st !== "hidden") e.state = h.st === "masked" ? h.mk?.p ?? DEFAULT_MASK_PRESET : h.st;
    if (h.st === "masked" && h.mk?.f && Object.keys(h.mk.f).length) e.mask = { ...h.mk.f };
    if (h.vs) e.visited = true;
    if (h.bl) e.blight = true;
    if (h.cost != null) e.cost = h.cost;
    if (h.nm) e.name = h.nm;
    if (h.nt) e.notes = h.nt;
    if (h.lm?.length) e.landmarks = h.lm.map((l) => ({
      ...(l.icon ? { icon: l.icon } : {}), ...(l.img ? { img: l.img } : {}),
      label: l.label, ...(l.journal ? { journal: l.journal } : {}), ...(l.vis !== "follow" ? { visibility: l.vis } : {}),
    }));
    if (Object.keys(e).length > 2) hexes.push(e);
  }
  hexes.sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    format: IMPORT_FORMAT,
    version: IMPORT_VERSION,
    scene: {
      name, grid: { ...gridFromType(gridType), size },
      cols: cols ?? maxCol + 1, rows: rows ?? maxRow + 1,
      ...(background ? { background } : {}),
    },
    config: map.config,
    terrains: Object.values(map.terrains).map((t) => ({ id: t.id, name: t.name, color: t.color, glyph: t.glyph })),
    regions: Object.values(map.regions).map((r) => ({
      id: r.id, name: r.name, terrain: r.t, rating: r.rt,
      ...(r.color ? { color: r.color } : {}), ...(r.bl ? { blight: true } : {}),
      ...(r.enc.text ? { encounter: r.enc.text } : {}), ...(r.enc.table ? { encounterTable: r.enc.table } : {}),
      ...(r.rumor.text || r.rumor.known ? { rumor: { text: r.rumor.text, truth: r.rumor.truth, known: r.rumor.known, ...(r.rumor.table ? { table: r.rumor.table } : {}) } } : {}),
      ...(r.notes ? { notes: r.notes } : {}),
      hexes: (regionHexes[r.id] ?? []).sort((a, b) => a[1] - b[1] || a[0] - b[0]),
    })),
    hexes,
  };
}

/** A small, complete example — shown by the import dialog's "Copy example". */
export function exampleImport() {
  return {
    format: IMPORT_FORMAT,
    version: IMPORT_VERSION,
    scene: { name: "The Long Road North", grid: { orientation: "flat", offset: "odd", size: 100 }, cols: 8, rows: 6 },
    config: { sight: 1, autoPreset: "glimpsed", cost: { unit: "days", table: [1, 2, 3, 4] }, dice: { die: 6, perRating: [1, 2, 3, 4], trigger: 1 } },
    terrains: [{ id: "ashfield", name: "Ash Field", color: "#7a6f66", glyph: "lava" }],
    regions: [
      {
        id: "whisperwood", name: "The Whispering Wood", terrain: "forest", rating: 3,
        encounter: "A pack of hungry wolves shadows the party.",
        rumor: { text: "The trees remember the old road.", truth: "partial", known: true },
        hexes: [[1, 1], [2, 1], [1, 2], [2, 2]],
      },
      { id: "kingsroad", name: "King's Road", terrain: "grassland", rating: 1, hexes: [[0, 0], [1, 0], [2, 0], [3, 0]] },
    ],
    layout: {
      legend: { "^": "mountain", "~": { terrain: "ocean", rating: 4 }, "a": "ashfield", ".": null },
      rows: ["....^^~~", "....^^~~", "...a..~~", "...aa...", "........", "........"],
    },
    hexes: [
      { col: 2, row: 1, state: "revealed", landmarks: [{ icon: "tower-observation", label: "Old Watchtower", visibility: "visible" }] },
      { col: 4, row: 3, terrain: "shadowblighted", rating: 4, name: "The Grey Scar" },
    ],
    start: { col: 0, row: 0 },
  };
}
