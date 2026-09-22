/**
 * Hexcrawl — the map data model.
 *
 * Pure. Everything that decides what a hex IS, and what a given viewer may SEE
 * of it, lives here, so the renderer, the tooltip, the arrival card and the
 * check tool all ask one function the same question.
 *
 * MapData (stored on the Scene at flags[SUITE_ID].hex.map):
 * {
 *   v: 1,
 *   hexes:    { [offsetKey]: Hex },
 *   regions:  { [id]: Region },
 *   terrains: { [id]: CustomTerrain },   // GM-defined; built-ins live in constants
 *   config:   SceneConfig,               // see DEFAULT_CONFIG
 *   presets:  { [id]: MaskPreset },      // GM-editable; seeded from MASK_PRESETS
 *   assetBase: string,                   // prefix for relative art paths ("" = Foundry Data)
 *   origin:   { i, j } | null,           // Foundry offset of import coordinate (0,0);
 *                                        // set by the JSON import so re-import/export line up
 *   bounds:   { i, j, rows, cols } | null, // the map's own EXTENT in Foundry offsets.
 *                                        // A hex outside it is BORDER — out of play, black —
 *                                        // unless a hex record says otherwise (`bd`). Null
 *                                        // means "no extent declared": every hex is in play.
 * }
 *
 * Hex (every field optional; an absent hex is a hidden blank hex):
 * { t: terrainId, rg: regionId, rt: 1..4 (overrides the region), st: STATES,
 *   mk: { p: presetId|"sight", f: { [field]: boolean } } (only meaningful while masked;
 *         "sight" resolves live to config.sightFields; an unknown id falls back to it),
 *   vs: true (visited), bl: true (blight), cost: number (overrides the table),
 *   bd: 1 (border: out of play) | 0 (in play), absent = follow map.bounds,
 *   lm: Landmark[], nm: name override, nt: GM notes }
 *
 * Landmark: { id, icon: "fa-solid fa-…"|null, img: path|null, label, journal: uuid|null,
 *             vis: LANDMARK_VIS, color: "#rrggbb"|null (null = the signal hue),
 *             size: number (a multiplier on the shipped badge, 1 = as shipped) }
 *
 * Region: { id, name, nk: bool (name known to players), t: terrainId, rt: 1..4,
 *           color: "#rrggbb"|null, bl: bool,
 *           enc: { text, table: uuid|null },
 *           rumor: { text, truth: RUMOR_TRUTH, known: bool, table: uuid|null },
 *           notes }
 *
 * CustomTerrain: { id, name, color: "#rrggbb", glyph: GLYPH_IDS, icon: path|null }
 *
 * Region art (optional): icon: [path, …] (≤ MAX_ICON_VARIANTS; each hex picks one
 *   by a stable hash of its key), tex: { src, mode: TEX_MODES, scale, pixel?: true } | null.
 * Paths are resolved by resolveAsset(): absolute URLs and Foundry paths stay as
 * they are, "glhex:…" is the module's own assets, and anything else relative is
 * joined to map.assetBase (e.g. an S3 bucket URL) when one is set.
 *
 * MaskPreset: { name: string ("" → GLHEX.mask.<id>), f: { [MASK_FIELDS]: boolean } }
 *
 * KNOWN LIMITATION: a scene flag is sent to every client. A player with the
 * console open can read the hidden map, exactly as they can read a hidden
 * Tile or Note. viewFor() decides what is DRAWN; it is not a secrecy boundary.
 */

import {
  BLANK_TERRAIN, BUILTIN_TERRAINS, COST_UNITS, DEFAULT_CONFIG,
  LANDMARK_COLOR_DEFAULT, LANDMARK_SIZE_DEFAULT, LANDMARK_SIZE_MAX, LANDMARK_SIZE_MIN,
  LANDMARK_VIS, MASK_FIELDS, MASK_PRESETS, MAX_LANDMARKS_PER_HEX, RATING_MAX, RATING_MIN,
  RENDER_MODES, RUMOR_TRUTH, STATE_RANK, STATES, DIE_SIZES, GLYPH_IDS,
  DEFAULT_SIGHT_FIELDS, RESERVED_PRESET_IDS, SIGHT_PRESET, SIGHT_STATES,
  ASSET_SCHEME, BUILTIN_ICON, MAX_ICON_VARIANTS, TEX_MODES,
} from "./constants.mjs";

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const hex6 = (v, fb) => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : fb);
const int = (v, fb) => { if (v == null || v === "") return fb; const n = Math.round(Number(v)); return Number.isFinite(n) ? n : fb; };
const num = (v, fb) => { if (v == null || v === "") return fb; const n = Number(v); return Number.isFinite(n) ? n : fb; };
const clampInt = (v, lo, hi, fb) => { const n = int(v, fb); return n == null ? fb : Math.max(lo, Math.min(hi, n)); };
const str = (v) => (typeof v === "string" ? v : "");

export function emptyMap() {
  return { v: 1, hexes: {}, regions: {}, terrains: {}, config: normalizeConfig({}), presets: defaultPresets(), assetBase: "", origin: null, bounds: null };
}

/** A full mask-field set: every MASK_FIELDS key a boolean, missing ones from `fb`. */
export function normalizeFields(f, fb = DEFAULT_SIGHT_FIELDS) {
  const out = {};
  for (const k of MASK_FIELDS) out[k] = isObj(f) && typeof f[k] === "boolean" ? f[k] : !!fb?.[k];
  return out;
}

/** The seed presets (blank names: the UI shows GLHEX.mask.<id>). */
export function defaultPresets() {
  const out = {};
  for (const [id, f] of Object.entries(MASK_PRESETS)) out[id] = { name: "", f: normalizeFields(f) };
  return out;
}

/** A preset id a GM may use: word characters, not reserved. */
export const validPresetId = (id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(id) && !RESERVED_PRESET_IDS.includes(id);

/** Absent → the seed; present (even empty — a GM may delete them all) → as given. */
export function normalizePresets(p) {
  if (!isObj(p)) return defaultPresets();
  const out = {};
  for (const [id, v] of Object.entries(p)) {
    if (!validPresetId(id) || !isObj(v)) continue;
    out[id] = { name: str(v.name).trim().slice(0, 60), f: normalizeFields(v.f, {}) };
  }
  return out;
}

/* ── Normalisation ──────────────────────────────────────────────────────── */

export function normalizeConfig(c) {
  const d = DEFAULT_CONFIG;
  c = isObj(c) ? c : {};
  const dice = isObj(c.dice) ? c.dice : {};
  const cost = isObj(c.cost) ? c.cost : {};
  const table4 = (arr, def, lo, hi) => [0, 1, 2, 3].map((i) => clampInt(arr?.[i], lo, hi, def[i]));
  return {
    sight: clampInt(c.sight, 0, 6, d.sight),
    // Older maps stored one preset id (autoPreset); read it as the equivalent checklist.
    sightState: SIGHT_STATES.includes(c.sightState) ? c.sightState : c.autoPreset === "revealed" ? "revealed" : d.sightState,
    sightFields: normalizeFields(isObj(c.sightFields) ? c.sightFields : MASK_PRESETS[c.autoPreset] ?? d.sightFields, d.sightFields),
    render: RENDER_MODES.includes(c.render) ? c.render : d.render,
    alwaysPips: typeof c.alwaysPips === "boolean" ? c.alwaysPips : d.alwaysPips,
    trail: typeof c.trail === "boolean" ? c.trail : d.trail,
    playersMove: typeof c.playersMove === "boolean" ? c.playersMove : d.playersMove,
    dice: {
      die: DIE_SIZES.includes(int(dice.die)) ? int(dice.die) : d.dice.die,
      perRating: table4(dice.perRating, d.dice.perRating, 0, 20),
      trigger: clampInt(dice.trigger, 1, 20, d.dice.trigger),
    },
    cost: {
      unit: Object.hasOwn(COST_UNITS, cost.unit) ? cost.unit : d.cost.unit,
      table: [0, 1, 2, 3].map((i) => Math.max(0, num(cost.table?.[i], d.cost.table[i]))),
      watchHours: Math.max(0.25, num(cost.watchHours, d.cost.watchHours)),
    },
    advanceTime: typeof c.advanceTime === "boolean" ? c.advanceTime : d.advanceTime,
    arrivalCard: typeof c.arrivalCard === "boolean" ? c.arrivalCard : d.arrivalCard,
    texStrength: Math.max(0, Math.min(1, num(c.texStrength, d.texStrength))),
  };
}

/** An art path as stored: trimmed, or null. */
const artPath = (v) => { const t = str(v).trim(); return t && t.length <= 2048 ? t : null; };

/** A region texture as stored, or null. */
export function normalizeTex(t) {
  if (typeof t === "string") t = { src: t };
  if (!isObj(t)) return null;
  const src = artPath(t.src);
  if (!src) return null;
  const out = { src, mode: TEX_MODES.includes(t.mode) ? t.mode : "fit", scale: Math.max(0.25, Math.min(40, num(t.scale, 4))) };
  // Pixel art: sampled nearest-neighbour, so its pixel clusters stay crisp instead of blurring.
  if (t.pixel) out.pixel = true;
  return out;
}

/** Region icon variants as stored: [] when none. */
export function normalizeIcons(v) {
  const list = Array.isArray(v) ? v : v == null ? [] : [v];
  return list.map(artPath).filter(Boolean).slice(0, MAX_ICON_VARIANTS);
}

/** A landmark's badge size: a finite multiplier inside the clamp, else the default. */
export function landmarkSize(v) {
  const n = num(v, LANDMARK_SIZE_DEFAULT);
  return Math.max(LANDMARK_SIZE_MIN, Math.min(LANDMARK_SIZE_MAX, n));
}

export function normalizeLandmark(l, idx = 0) {
  l = isObj(l) ? l : {};
  return {
    id: str(l.id) || `lm${idx}`,
    icon: str(l.icon) || null,
    img: str(l.img) || null,
    label: str(l.label),
    journal: str(l.journal) || null,
    vis: LANDMARK_VIS.includes(l.vis) ? l.vis : "follow",
    color: hex6(l.color, LANDMARK_COLOR_DEFAULT),
    size: landmarkSize(l.size),
  };
}

export function normalizeRegion(r, id) {
  r = isObj(r) ? r : {};
  const enc = isObj(r.enc) ? r.enc : {};
  const rumor = isObj(r.rumor) ? r.rumor : {};
  return {
    id: str(r.id) || id,
    name: str(r.name),
    nk: !!r.nk,
    t: str(r.t) || null,
    rt: clampInt(r.rt, RATING_MIN, RATING_MAX, null),
    color: hex6(r.color, null),
    bl: !!r.bl,
    enc: { text: str(enc.text), table: str(enc.table) || null },
    rumor: {
      text: str(rumor.text),
      truth: RUMOR_TRUTH.includes(String(rumor.truth)) ? String(rumor.truth) : "true",
      known: !!rumor.known,
      table: str(rumor.table) || null,
    },
    notes: str(r.notes),
    icon: normalizeIcons(r.icon),
    tex: normalizeTex(r.tex),
  };
}

export function normalizeTerrain(t, id) {
  t = isObj(t) ? t : {};
  return {
    id: str(t.id) || id,
    name: str(t.name) || id,
    color: hex6(t.color, BLANK_TERRAIN.color),
    glyph: GLYPH_IDS.includes(t.glyph) ? t.glyph : "none",
    icon: artPath(t.icon),
  };
}

export function normalizeHex(h) {
  h = isObj(h) ? h : {};
  const out = {};
  if (str(h.t)) out.t = h.t;
  if (str(h.rg)) out.rg = h.rg;
  const rt = clampInt(h.rt, RATING_MIN, RATING_MAX, null);
  if (rt != null && h.rt != null) out.rt = rt;
  out.st = STATES.includes(h.st) ? h.st : "hidden";
  if (isObj(h.mk)) {
    // Any id is kept: presets are per map, so it is resolved (and falls back) at read time.
    const p = str(h.mk.p) || SIGHT_PRESET;
    const f = {};
    if (isObj(h.mk.f)) for (const k of MASK_FIELDS) if (typeof h.mk.f[k] === "boolean") f[k] = h.mk.f[k];
    out.mk = { p, f };
  }
  if (h.vs) out.vs = true;
  if (h.bl) out.bl = true;
  // Tri-state on purpose: absent is "follow the map's extent", so a GM can say
  // "this padding hex IS in play" (0) as well as "this one is not" (1). Storing
  // only `true` would leave no way to bring a hex outside the extent back.
  if (h.bd != null && h.bd !== "") out.bd = h.bd ? 1 : 0;
  if (h.cost != null && h.cost !== "" && Number.isFinite(Number(h.cost))) out.cost = Math.max(0, Number(h.cost));
  if (Array.isArray(h.lm) && h.lm.length) out.lm = h.lm.slice(0, MAX_LANDMARKS_PER_HEX).map(normalizeLandmark);
  if (str(h.nm)) out.nm = h.nm;
  if (str(h.nt)) out.nt = h.nt;
  return out;
}

/** Accepts anything (a missing flag, an older shape) and returns a full MapData. */
export function normalizeMap(m) {
  m = isObj(m) ? m : {};
  const out = emptyMap();
  if (isObj(m.hexes)) for (const [k, h] of Object.entries(m.hexes)) if (h) out.hexes[k] = normalizeHex(h);
  if (isObj(m.regions)) for (const [id, r] of Object.entries(m.regions)) if (r) out.regions[id] = normalizeRegion(r, id);
  if (isObj(m.terrains)) for (const [id, t] of Object.entries(m.terrains)) if (t) out.terrains[id] = normalizeTerrain(t, id);
  out.config = normalizeConfig(m.config);
  out.presets = normalizePresets(m.presets);
  out.assetBase = artPath(m.assetBase) ?? "";
  const oi = Number(m.origin?.i), oj = Number(m.origin?.j);
  out.origin = Number.isInteger(oi) && Number.isInteger(oj) ? { i: oi, j: oj } : null;
  out.bounds = normalizeBounds(m.bounds);
  return out;
}

/** The map's extent as stored, or null. A degenerate rect is no extent at all —
 *  0 rows would put the whole map out of play, which looks like a black scene. */
export function normalizeBounds(b) {
  if (!isObj(b)) return null;
  const i = int(b.i, null), j = int(b.j, null);
  const rows = int(b.rows, null), cols = int(b.cols, null);
  if (i == null || j == null || !(rows > 0) || !(cols > 0)) return null;
  return { i, j, rows, cols };
}

/* ── Resolution ─────────────────────────────────────────────────────────── */

/* ── Border: the hexes that are not part of the map ─────────────────────── */

/** "i,j" → { i, j }. (hex-math owns the grid; this is only the key's shape.) */
const offsetOf = (k) => { const [i, j] = String(k).split(",").map(Number); return { i, j }; };

/** Is hex k inside the map's declared extent? No extent → everything is. */
export function inExtent(map, k) {
  const b = map?.bounds;
  if (!b) return true;
  const { i, j } = offsetOf(k);
  return i >= b.i && j >= b.j && i < b.i + b.rows && j < b.j + b.cols;
}

/**
 * Is hex k BORDER — not in play at all?
 *
 * A border hex is drawn as flat black for everyone, the party can neither see
 * nor enter it, and nothing on it is ever revealed. Two ways a hex becomes one:
 * the map's extent (the padding a scene carries around an imported map is
 * border by itself, with nothing written), or a GM's own brush. The hex record
 * always wins, in BOTH directions, so a GM can carve a border out of the map
 * and bring a padding hex into play.
 *
 * Everything that draws or walks the map asks this one function; a second
 * reading of `bd` or of `bounds` is how the map and the rules start disagreeing.
 */
export function isBorder(map, k) {
  const bd = map?.hexes?.[k]?.bd;
  if (bd != null) return !!bd;
  return !inExtent(map, k);
}

/**
 * What `bd` a hex needs to be border (or not): 1, 0, or null to store nothing
 * because the map's extent already says so. The brush and the hex editor both
 * go through this, so neither can write a flag that says what the extent says.
 */
export function borderFlagFor(map, k, want) {
  return !!want === !inExtent(map, k) ? null : (want ? 1 : 0);
}

export const getHex = (map, k) => map.hexes[k] ?? { st: "hidden" };
export const getRegion = (map, k) => { const rg = map.hexes[k]?.rg; return rg ? map.regions[rg] ?? null : null; };

/** Terrain definition for an id: custom first (a GM may shadow a built-in), then built-in. */
export function terrainDef(map, id) {
  if (!id) return null;
  const c = map.terrains?.[id];
  const b = BUILTIN_TERRAINS[id];
  // A custom terrain shadowing a built-in keeps the shipped icon unless it names its own.
  if (c) return { id, name: c.name, color: c.color, glyph: c.glyph, icon: c.icon ?? (b ? BUILTIN_ICON(id) : null), custom: true };
  if (b) return { id, name: null, color: b.color, glyph: b.glyph, icon: BUILTIN_ICON(id), custom: false };
  return null;
}

/* ── Art ────────────────────────────────────────────────────────────────── */

/**
 * Where an art path points. Absolute URLs (http:, https:, data:, blob:) and
 * rooted paths stay; "glhex:x" becomes `builtinRoot + x`; any other relative
 * path is joined to map.assetBase when there is one, else left for Foundry to
 * resolve against its Data folder.
 */
export function resolveAsset(src, { assetBase = "", builtinRoot = "" } = {}) {
  if (!src) return null;
  if (src.startsWith(ASSET_SCHEME)) return builtinRoot + src.slice(ASSET_SCHEME.length);
  if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(src) || !assetBase) return src;
  return assetBase.replace(/\/+$/, "") + "/" + src.replace(/^\.?\//, "");
}

/** A stable, well-spread small integer from a hex key (variant picking). */
export function keyHash(k) {
  let h = 2166136261;
  for (let n = 0; n < k.length; n++) { h ^= k.charCodeAt(n); h = Math.imul(h, 16777619); }
  return (h >>> 0);
}

/**
 * The art a viewer sees on hex k, given that viewer's `view` (from viewFor):
 *   icon: art path | null   — a region variant, else the terrain's icon
 *   tex:  { src, mode, scale, region } | null
 * Art DEPICTS the terrain, so nothing shows unless the view shows the terrain;
 * region art additionally needs the region shape (a withheld region falls back
 * to the plain terrain icon, and shows no texture).
 */
export function visualFor(map, k, view) {
  if (!view?.terrain) return { icon: null, tex: null };
  const region = view.regionId ? map.regions[view.regionId] ?? null : null;
  const icons = region?.icon ?? [];
  const icon = icons.length ? icons[keyHash(k) % icons.length] : view.terrain.icon ?? null;
  const tex = region?.tex ? { ...region.tex, region: region.id } : null;
  return { icon, tex };
}

export function effectiveTerrainId(map, k) {
  const h = map.hexes[k];
  return h?.t || getRegion(map, k)?.t || null;
}
export function effectiveTerrain(map, k) {
  return terrainDef(map, effectiveTerrainId(map, k)) ?? { id: null, name: null, ...BLANK_TERRAIN, custom: false };
}
export function effectiveRating(map, k) {
  const h = map.hexes[k];
  return h?.rt ?? getRegion(map, k)?.rt ?? null;
}
/** True when the hex's rating differs from its region's (the only pips drawn at rest). */
export function ratingOverridden(map, k) {
  const h = map.hexes[k];
  if (h?.rt == null) return false;
  const r = getRegion(map, k)?.rt ?? null;
  return r == null || r !== h.rt;
}
export function effectiveBlight(map, k) {
  return !!(map.hexes[k]?.bl || getRegion(map, k)?.bl);
}
export function regionColor(map, k) {
  const r = getRegion(map, k);
  return r?.color ?? null;
}
export function displayName(map, k) {
  return map.hexes[k]?.nm || getRegion(map, k)?.name || "";
}

/** Fields of a preset id on this map: "sight" (or an id the GM has since deleted) → the scene's sight checklist. */
export function presetFields(map, id) {
  const p = id && id !== SIGHT_PRESET ? map?.presets?.[id] : null;
  return p ? p.f : map?.config?.sightFields ?? DEFAULT_SIGHT_FIELDS;
}

/** Mask fields in force for a masked hex: its preset, then per-hex overrides. */
export function maskFields(map, hex) {
  return { ...presetFields(map, hex?.mk?.p), ...(hex?.mk?.f ?? {}) };
}

/**
 * Does this hex show its landmarks to players right now? (Revealed always; a
 * masked hex only with the `landmarks` field; fog never.) The one place that
 * question is answered, so the GM's badge, the tooltip tag and the editor's
 * chip can never disagree with what viewFor hands a player.
 */
export function landmarksShown(map, hex) {
  const st = hex?.st ?? "hidden";
  if (st === "revealed") return true;
  if (st === "masked") return !!maskFields(map, hex).landmarks;
  return false;
}

/** Can players see this one landmark right now? `shown` is landmarksShown(). */
export const landmarkSeen = (lm, shown) => lm?.vis === "visible" || (lm?.vis === "follow" && !!shown);

/** Does the preset value name something a hex can be masked with? */
export const isMaskPreset = (map, id) => id === SIGHT_PRESET || !!(validPresetId(id) && map?.presets?.[id]);

/** Cost of ENTERING hex k: per-hex override, else the table at its rating. */
export function travelCost(map, k) {
  const h = map.hexes[k];
  if (h?.cost != null) return h.cost;
  const rt = effectiveRating(map, k);
  if (rt == null) return 0;
  return map.config.cost.table[rt - 1] ?? 0;
}

/** Seconds of world time for `amount` of the configured unit. */
export function costSeconds(config, amount) {
  const u = config.cost.unit;
  const per = u === "watches" ? config.cost.watchHours * 3600 : COST_UNITS[u] ?? 86400;
  return Math.max(0, amount) * per;
}

/** Encounter dice for entering hex k: { count, die, trigger, formula } */
export function encounterDice(map, k) {
  const rt = effectiveRating(map, k);
  const count = rt ? map.config.dice.perRating[rt - 1] ?? 0 : 0;
  const die = map.config.dice.die;
  return { count, die, trigger: map.config.dice.trigger, formula: count > 0 ? `${count}d${die}` : null };
}

/* ── The viewer question ────────────────────────────────────────────────── */

/**
 * What a viewer may see of hex k. `asGM` true → everything, plus `gm` hints
 * about what players see (for the hatched GM view). For players, fields a mask
 * withholds come back null.
 *
 * Returns {
 *   key, state, visited, blight,
 *   terrain: {id,name,color,glyph,custom}|null,
 *   name: string|null, regionId: string|null, rating: number|null,
 *   nameUnknown: boolean,           // players: the name WOULD show, but the GM has not
 *                                   // marked the region's name known — draw "???"
 *   regionWithheld: boolean,        // players: a masked hex hiding which region it is in
 *   ratingOverridden: boolean,
 *   border: boolean,                // not in play at all: flat black, nothing else
 *   landmarks: Landmark[],          // only the ones this viewer may see; in the GM
 *                                   // view every landmark, each with `seen`: whether
 *                                   // the party can see that badge right now
 *   rumor: string|null,             // players: only when region rumour is known AND field shown
 *   drawn: boolean,                 // anything to draw beyond the fog?
 *   playerState: state              // what players see (== state)
 * }
 */
export function viewFor(map, k, { asGM = false } = {}) {
  const h = getHex(map, k);
  const region = getRegion(map, k);
  const terrain = effectiveTerrain(map, k);
  const state = h.st ?? "hidden";
  const base = {
    key: k, state, playerState: state, visited: !!h.vs,
    blight: effectiveBlight(map, k),
    regionId: region?.id ?? null,
    ratingOverridden: ratingOverridden(map, k),
    nameUnknown: false, regionWithheld: false, border: false,
  };

  // Border outranks everything, the GM view included: a hex that is not in play
  // has nothing to show, and drawing its terrain to the GM alone would make the
  // one thing this mark means — "this is not map" — the one thing they cannot see.
  if (isBorder(map, k)) {
    return {
      ...base, border: true, visited: false, blight: false, terrain: null, name: null,
      rating: null, ratingOverridden: false, regionId: null, landmarks: [], rumor: null,
      drawn: false,
    };
  }
  const lms = h.lm ?? [];
  // A region's name reaches players only once the GM marks it known (region.nk).
  // A hex outside any region has only its own name, which follows its state.
  const nameFor = (shown) => {
    if (!shown) return { name: null, nameUnknown: false };
    if (region && !region.nk) return { name: null, nameUnknown: true };
    return { name: displayName(map, k) || null, nameUnknown: false };
  };

  if (asGM) {
    // GM-only hint, like playerState: which of these badges the party can
    // actually see right now. Players never carry it (nothing they are handed
    // is unseen), so `seen === false` anywhere downstream means "GM view".
    const shown = landmarksShown(map, h);
    return {
      ...base, terrain, name: displayName(map, k) || null, rating: effectiveRating(map, k),
      landmarks: lms.map((l) => ({ ...l, seen: landmarkSeen(l, shown) })),
      rumor: region?.rumor?.text || null, drawn: true,
    };
  }

  const visibleLandmarks = (fieldShown) => lms.filter((l) => landmarkSeen(l, fieldShown));

  if (state === "revealed") {
    return {
      ...base, terrain, ...nameFor(true), rating: effectiveRating(map, k),
      landmarks: visibleLandmarks(true),
      rumor: region?.rumor?.known ? region.rumor.text || null : null, drawn: true,
    };
  }
  if (state === "masked") {
    const f = maskFields(map, h);
    const regionShown = !!(f.region || f.name);
    return {
      ...base,
      blight: f.terrain ? base.blight : false,
      terrain: f.terrain ? terrain : null,
      ...nameFor(!!f.name),
      rating: f.rating ? effectiveRating(map, k) : null,
      ratingOverridden: f.rating ? base.ratingOverridden : false,
      // The region's shape (its border) is its own field; the name implies it.
      regionId: regionShown ? base.regionId : null,
      regionWithheld: !regionShown && !!base.regionId,
      landmarks: visibleLandmarks(!!f.landmarks),
      rumor: f.rumor && region?.rumor?.known ? region.rumor.text || null : null,
      drawn: true,
    };
  }
  // hidden
  return {
    ...base, visited: false, blight: false, terrain: null, name: null, rating: null,
    ratingOverridden: false, regionId: null, landmarks: visibleLandmarks(false),
    rumor: null, drawn: false,
  };
}

/* ── Patches ────────────────────────────────────────────────────────────── */
/*
 * A patch is { [key]: Hex | null } — the FULL new hex for each touched key, or
 * null to delete it. Full objects (not field diffs) keep undo trivial: the
 * inverse of a patch is the previous full objects.
 */

export function applyPatch(map, patch) {
  const hexes = { ...map.hexes };
  for (const [k, h] of Object.entries(patch)) {
    if (h == null) delete hexes[k];
    else hexes[k] = normalizeHex(h);
  }
  return { ...map, hexes };
}

export function invertPatch(map, patch) {
  const inv = {};
  for (const k of Object.keys(patch)) inv[k] = map.hexes[k] ? structuredClone(map.hexes[k]) : null;
  return inv;
}

/**
 * The SHAPE of a patch as dotted update paths — for inspection and tests only.
 * NOT for writes: a plain nested update MERGES, so a hex that loses `bl` would
 * keep it forever. Writes go through store.mjs hexPatchUpdate(), which forces
 * replacement. See docs/HEXCRAWL.md → Storage.
 */
export function patchToUpdate(scope, patch) {
  const upd = {};
  const base = `flags.${scope}.hex.map.hexes`;
  for (const [k, h] of Object.entries(patch)) {
    if (h == null) upd[`${base}.-=${k}`] = null;
    else upd[`${base}.${k}`] = normalizeHex(h);
  }
  return upd;
}

/** Is a hex record indistinguishable from "absent"? (hidden, nothing set) */
export function isBlankHex(h) {
  const n = normalizeHex(h);
  return Object.keys(n).length === 1 && n.st === "hidden";
}

/* ── Brushes ────────────────────────────────────────────────────────────── */

/**
 * The patch a brush stroke produces over `keys`.
 * brush: { tool, value }
 *   terrain  value: terrainId|null
 *   region   value: regionId|null
 *   rating   value: 1..4|null     (null clears the override)
 *   state    value: "hidden"|"revealed"|<presetId> (a preset means masked with it)
 *   border   value: boolean        (out of play; stores nothing where the extent agrees)
 *   blight   value: boolean
 *   visited  value: boolean
 *   erase    — clears the whole hex back to hidden blank (border included: the
 *              hex goes back to following the map's extent)
 */
export function brushPatch(map, keys, brush) {
  const patch = {};
  for (const k of keys) {
    const cur = structuredClone(map.hexes[k] ?? { st: "hidden" });
    let next = cur;
    switch (brush.tool) {
      case "terrain": if (brush.value) next.t = brush.value; else delete next.t; break;
      case "region": if (brush.value) next.rg = brush.value; else delete next.rg; break;
      case "rating": if (brush.value) next.rt = brush.value; else delete next.rt; break;
      case "state":
        if (brush.value === "hidden" || brush.value === "revealed") { next.st = brush.value; delete next.mk; }
        else if (isMaskPreset(map, brush.value)) { next.st = "masked"; next.mk = { p: brush.value, f: {} }; }
        break;
      case "border": {
        const flag = borderFlagFor(map, k, brush.value);
        if (flag == null) delete next.bd; else next.bd = flag;
        break;
      }
      case "blight": if (brush.value) next.bl = true; else delete next.bl; break;
      case "visited": if (brush.value) next.vs = true; else delete next.vs; break;
      case "erase": next = { st: "hidden" }; break;
      default: continue;
    }
    patch[k] = isBlankHex(next) ? null : next;
  }
  return patch;
}

/* ── Auto-reveal ────────────────────────────────────────────────────────── */

const raise = (map, cur, sightState) => {
  // Returns the new hex, or null when nothing would rise. Never lowers.
  const st = cur.st ?? "hidden";
  if (sightState === "revealed") {
    if (STATE_RANK[st] >= STATE_RANK.revealed) return null;
    const n = { ...cur, st: "revealed" }; delete n.mk; return n;
  }
  if (STATE_RANK[st] >= STATE_RANK.revealed) return null;
  if (st !== "masked") return { ...cur, st: "masked", mk: { p: SIGHT_PRESET, f: {} } };
  // Already masked (a GM's silhouette, say): sight still shows what it shows.
  // The result is the field-wise union — the sight preset, plus per-hex
  // overrides for anything the old mask showed that sight does not — so a
  // shape-only hex gains terrain and difficulty and loses nothing.
  const had = maskFields(map, cur), sight = presetFields(map, SIGHT_PRESET);
  if (MASK_FIELDS.every((f) => had[f] || !sight[f])) return null;
  const f = {};
  for (const k of MASK_FIELDS) if (had[k] && !sight[k]) f[k] = true;
  return { ...cur, st: "masked", mk: { p: SIGHT_PRESET, f } };
};

/**
 * The patch for the party standing on `entered` with sight hexes `seen`
 * (a Set from hex-math unionRange). The entered hexes become revealed and
 * visited; every other seen hex rises to config.sightState — masked with the
 * live "sight" preset (config.sightFields), or revealed. Nothing is lowered —
 * the GM's hand-set states always survive.
 */
export function autoRevealPatch(map, { entered = [], seen = new Set() } = {}) {
  const patch = {};
  const preset = map.config.sightState;
  // A border hex is not map: the party neither sees into it nor stands on it,
  // so travel never writes one. Without this a walk along the edge quietly
  // marks the padding visited, and the frame stops being uniformly black.
  const enteredSet = new Set([...entered].filter((k) => !isBorder(map, k)));
  for (const k of seen) {
    if (enteredSet.has(k) || isBorder(map, k)) continue;
    const cur = map.hexes[k] ?? { st: "hidden" };
    const n = raise(map, cur, preset);
    if (n) patch[k] = n;
  }
  for (const k of enteredSet) {
    const cur = map.hexes[k] ?? { st: "hidden" };
    const n = { ...cur, st: "revealed", vs: true };
    delete n.mk;
    if (cur.st !== "revealed" || !cur.vs) patch[k] = n;
  }
  return patch;
}

/** Keys whose visible state changed between two maps, bucketed for animation. */
export function stateDiff(prev, next, keys = null) {
  const out = { revealed: [], masked: [], hidden: [], changed: [] };
  const all = keys ?? new Set([...Object.keys(prev?.hexes ?? {}), ...Object.keys(next?.hexes ?? {})]);
  for (const k of all) {
    const a = prev?.hexes?.[k]?.st ?? "hidden", b = next?.hexes?.[k]?.st ?? "hidden";
    if (a === b) {
      if (JSON.stringify(prev?.hexes?.[k] ?? null) !== JSON.stringify(next?.hexes?.[k] ?? null)) out.changed.push(k);
      continue;
    }
    out[b].push(k);
  }
  return out;
}

/** Re-address every hex by (di, dj) — the import/export origin shift (hex-math gridOrigin). */
export function shiftKeys(map, di, dj) {
  if (!di && !dj) return map;
  const hexes = {};
  for (const [k, h] of Object.entries(map.hexes)) {
    const [i, j] = k.split(",").map(Number);
    hexes[`${i + di},${j + dj}`] = h;
  }
  // The extent is addressed in the same offsets, so it travels with them —
  // left behind, it would put the map itself outside its own bounds and black
  // out every hex that just moved.
  const bounds = map.bounds ? { ...map.bounds, i: map.bounds.i + di, j: map.bounds.j + dj } : null;
  return { ...map, hexes, bounds };
}

/* ── Ids ────────────────────────────────────────────────────────────────── */

export function newId(prefix = "r") {
  return `${prefix}${Math.random().toString(36).slice(2, 10)}`;
}
