/** PF2e AoE — Region interpretation, rules coverage, and authored style. */

import { SUITE_ID } from "../../core/const.mjs";
import { hexToRgbFloat, lighten } from "../../core/theme.mjs";
import {
  ARCHETYPES,
  ARCHETYPE_PALETTE,
  CELL,
  DAMAGE_ARCHETYPE,
  FLAGS,
  LAYOUT,
  SETTINGS,
  SHAPE,
  TRAIT_ARCHETYPE,
} from "./constants.mjs";

const HEX = /^#[0-9a-f]{6}$/i;
const ARCH_SET = new Set(ARCHETYPES);
const DAMAGE_SET = new Set(Object.keys(DAMAGE_ARCHETYPE));

const byte = (n) => Math.round(Math.max(0, Math.min(1, n)) * 255)
  .toString(16).padStart(2, "0");

export const DEFAULT_STYLE_COLORS = Object.freeze(Object.fromEntries(
  ARCHETYPES.map((id) => [id, `#${ARCHETYPE_PALETTE[id].tint.map(byte).join("")}`])
));

const get = (key, fallback) => {
  try { return game.settings.get(SUITE_ID, key); } catch { return fallback; }
};

export function normalizeColor(value, fallback = "#759dff") {
  const color = String(value ?? "").trim();
  return HEX.test(color) ? color.toLowerCase() : fallback;
}

export function normalizeLabel(value) {
  return String(value ?? "").trim().slice(0, 80);
}

/** Default player-facing label for a Region placed from a PF2e item. */
export function inferredLabel(document) {
  const origin = document?.flags?.pf2e?.origin;
  if (!origin || typeof origin !== "object") return normalizeLabel(document?.name);
  const item = originItem(origin);
  return normalizeLabel(origin.name ?? item?.name ?? document?.name);
}

export function styleDefaults() {
  const raw = get(SETTINGS.styleDefaults, {});
  return Object.fromEntries(ARCHETYPES.map((id) => [
    id,
    normalizeColor(raw?.[id], DEFAULT_STYLE_COLORS[id]),
  ]));
}

function asTraits(value) {
  if (value instanceof Set) return [...value];
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return Object.keys(value).filter((key) => value[key]);
  return [];
}

function originItem(origin) {
  const uuid = origin?.uuid ?? origin?.itemUuid ?? null;
  if (!uuid || typeof fromUuidSync !== "function") return null;
  try {
    const item = fromUuidSync(uuid);
    return item?.original ?? item;
  } catch { return null; }
}

function collectDamageTypes(value, out = new Set(), depth = 0) {
  if (depth > 7 || value == null) return out;
  if (typeof value === "string") {
    if (DAMAGE_SET.has(value)) out.add(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectDamageTypes(entry, out, depth + 1);
    return out;
  }
  if (typeof value !== "object") return out;
  for (const [key, child] of Object.entries(value)) {
    if (["type", "damageType", "damage-type"].includes(key) && typeof child === "string" && DAMAGE_SET.has(child)) {
      out.add(child);
    } else if (["damage", "damages", "formula", "instances", "persistent"].includes(key) || depth < 2) {
      collectDamageTypes(child, out, depth + 1);
    }
  }
  return out;
}

/** Trait override -> first explicit damage type -> arcane. */
export function inferredArchetype(document) {
  const origin = document?.flags?.pf2e?.origin ?? {};
  const item = originItem(origin);
  const traits = new Set([
    ...asTraits(origin.traits),
    ...asTraits(item?.system?.traits?.value),
  ]);
  for (const [trait, archetype] of TRAIT_ARCHETYPE) {
    if (traits.has(trait)) return archetype;
  }

  const damage = collectDamageTypes(item?.system?.damage ?? origin.damage);
  for (const type of damage) return DAMAGE_ARCHETYPE[type] ?? "arcane";
  return "arcane";
}

export function authoredStyle(document) {
  let raw = null;
  try { raw = document?.getFlag?.(SUITE_ID, FLAGS.style) ?? null; } catch { /* no flag */ }
  if (!raw || typeof raw !== "object") raw = {};
  const explicit = ARCH_SET.has(raw.archetype) ? raw.archetype : null;
  const archetype = explicit ?? inferredArchetype(document);
  const defaults = styleDefaults();
  /* Older Spellglass Regions predate the toggle and always stored a color.
     Treat those as opted in, while new Regions persist the explicit boolean. */
  const colorOverride = raw.colorOverride ?? Boolean(raw.color);
  const color = colorOverride
    ? normalizeColor(raw.color, defaults[archetype] ?? DEFAULT_STYLE_COLORS[archetype])
    : defaults[archetype] ?? DEFAULT_STYLE_COLORS[archetype];
  const hot = archetype === "generic" ? color : lighten(color, 0.58);
  const hasExplicitLabel = Object.prototype.hasOwnProperty.call(raw, "label");
  return {
    archetype,
    archetypeIndex: ARCHETYPES.indexOf(archetype),
    color,
    tint: new Float32Array(hexToRgbFloat(color)),
    hot: new Float32Array(hexToRgbFloat(hot)),
    label: hasExplicitLabel ? normalizeLabel(raw.label) : inferredLabel(document),
    explicit: Boolean(explicit),
    colorOverride: Boolean(colorOverride),
  };
}

export function isEffectRegion(document) {
  if (!document) return false;
  if (document.flags?.pf2e?.areaShape) return true;
  if (document.flags?.core?.MeasuredTemplate) return true;
  try { return Boolean(document.getFlag?.(SUITE_ID, FLAGS.style)); } catch { return false; }
}

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const radians = (degrees) => finite(degrees) * Math.PI / 180;

function firstShape(document) {
  const shapes = document?.shapes ?? document;
  return shapes?.contents?.[0] ?? shapes?.[0] ?? shapes?.at?.(0) ?? null;
}

function rectFrom(value) {
  if (!value) return null;
  const x = finite(value.x, NaN), y = finite(value.y, NaN);
  const width = finite(value.width, NaN), height = finite(value.height, NaN);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  return { x, y, width, height };
}

function fallbackBounds(shape, origin, grid, radius, base) {
  if (shape?.type === "rectangle") {
    return { x: finite(shape.x), y: finite(shape.y), width: finite(shape.width, grid), height: finite(shape.height, grid) };
  }
  const extent = Math.max(radius + Math.max(base[0], base[1]), 1) * grid;
  return { x: origin.x - extent, y: origin.y - extent, width: extent * 2, height: extent * 2 };
}

/**
 * Convert one PF2e Region into the shader's origin-relative grid contract.
 * Unsupported polygonal shapes retain exact rules coverage and use an outer
 * burst ghost only; gameplay truth always comes from the cell texture.
 */
export function regionGeometry(region) {
  const document = region?.document ?? region;
  /* A token-attached Region exposes transient animated shapes on its placeable
     while the Token is moving. Prefer those so the overlay follows the Token
     without rebuilding its coverage texture every animation frame. */
  const shape = firstShape(region?.animationState?.shapes ?? document) ?? firstShape(document);
  if (!shape) return null;
  const grid = finite(canvas?.dimensions?.size, 100) || 100;
  const areaShape = document.flags?.pf2e?.areaShape ?? shape.type;
  let shapeId = SHAPE.burst;
  let radius = finite(shape.radius, finite(shape.distance, grid)) / grid;
  let direction = radians(shape.rotation ?? shape.direction ?? 0);
  let angle = radians(shape.angle ?? 90);
  let base = [0, 0];
  let origin = {
    x: finite(shape.origin?.x, finite(shape.x)),
    y: finite(shape.origin?.y, finite(shape.y)),
  };

  if (shape.type === "cone" || areaShape === "cone") {
    shapeId = SHAPE.cone;
  } else if (shape.type === "line" || areaShape === "line") {
    shapeId = SHAPE.line;
    radius = finite(shape.length, finite(shape.radius, grid)) / grid;
  } else if (shape.type === "emanation" || areaShape === "emanation") {
    shapeId = SHAPE.emanation;
    const token = shape.base ?? shape.token ?? {};
    const tokenUnits = token.type === "token";
    const rawWidth = finite(token.width, finite(token.w, tokenUnits ? 1 : grid)) * (tokenUnits ? grid : 1);
    const rawHeight = finite(token.height, finite(token.h, tokenUnits ? 1 : grid)) * (tokenUnits ? grid : 1);
    /* PF2e treats Medium and smaller creatures as the grid square containing
       their centre. Gridless Scenes retain the token's continuous footprint. */
    const squareBase = tokenUnits && canvas?.grid?.isSquare;
    const width = squareBase ? Math.max(grid, rawWidth) : rawWidth;
    const height = squareBase ? Math.max(grid, rawHeight) : rawHeight;
    const rawCenter = {
      x: finite(token.x) + rawWidth / 2,
      y: finite(token.y) + rawHeight / 2,
    };
    origin = tokenUnits ? {
      x: squareBase && rawWidth < grid ? Math.floor(rawCenter.x / grid) * grid + grid / 2 : rawCenter.x,
      y: squareBase && rawHeight < grid ? Math.floor(rawCenter.y / grid) * grid + grid / 2 : rawCenter.y,
    } : {
      x: finite(token.center?.x, finite(token.origin?.x, finite(token.x, origin.x))),
      y: finite(token.center?.y, finite(token.origin?.y, finite(token.y, origin.y))),
    };
    base = [width / grid / 2, height / grid / 2];
  } else if (["rectangle", "grid"].includes(shape.type) || ["cube", "square"].includes(areaShape)) {
    shapeId = SHAPE.emanation;
    const width = finite(shape.width, grid), height = finite(shape.height, grid);
    origin = {
      x: finite(shape.center?.x, finite(shape.x) + width / 2),
      y: finite(shape.center?.y, finite(shape.y) + height / 2),
    };
    base = [width / grid / 2, height / grid / 2];
    radius = 0;
  } else if (shape.type === "ring" || areaShape === "ring") {
    shapeId = SHAPE.burst;
    radius = finite(shape.radius, grid) / grid;
  }

  const bounds = rectFrom(region?.bounds) ?? rectFrom(document?.bounds)
    ?? fallbackBounds(shape, origin, grid, radius, base);
  const pad = Math.max(LAYOUT.skirtRise, LAYOUT.scorchSpread) + 0.65;
  const x0 = (bounds.x - origin.x) / grid - pad;
  const y0 = (bounds.y - origin.y) / grid - pad;
  const x1 = (bounds.x + bounds.width - origin.x) / grid + pad;
  const y1 = (bounds.y + bounds.height - origin.y) / grid + pad;

  return {
    areaShape,
    shapeId,
    gridless: Boolean(canvas?.grid?.isGridless),
    radius: Math.max(0, radius),
    direction,
    angle,
    base,
    origin,
    grid,
    bounds,
    view: [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)],
    quad: { x: origin.x + x0 * grid, y: origin.y + y0 * grid, width: (x1 - x0) * grid, height: (y1 - y0) * grid },
    gridOffset: [origin.x / grid, origin.y / grid],
    labelAt: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
  };
}

function pointXY(point) {
  if (Array.isArray(point)) return { x: finite(point[0], NaN), y: finite(point[1], NaN) };
  if (Number.isInteger(point?.i) && Number.isInteger(point?.j)) {
    try { return canvas.grid.getTopLeftPoint(point); } catch { return { x: NaN, y: NaN }; }
  }
  return { x: finite(point?.x, NaN), y: finite(point?.y, NaN) };
}

function shapeCount(document) {
  const shapes = document?.shapes ?? document;
  return Number.isInteger(shapes?.length) ? shapes.length
    : Number.isInteger(shapes?.size) ? shapes.size
      : shapes?.contents?.length ?? 0;
}

/** Measure point distance using PF2e's alternating 5/10/5 diagonal rule. */
function measurePf2eDistance(p0, p1) {
  const size = finite(canvas?.dimensions?.size, 100) || 100;
  const distance = finite(canvas?.dimensions?.distance, 5) || 5;
  const nx = Math.ceil(Math.abs((p1.x - p0.x) / size));
  const ny = Math.ceil(Math.abs((p1.y - p0.y) / size));
  const [low, middle, high] = [0, nx, ny].sort((a, b) => a - b);
  const doubleDiagonal = low;
  const diagonal = middle - low;
  const straight = high - middle;
  return Math.floor(doubleDiagonal * 1.75 + diagonal * 1.5 + straight) * distance;
}

function coneCoverage(shape, placedOrigin) {
  const size = finite(canvas?.dimensions?.size, 100) || 100;
  const direction = finite(shape.rotation ?? shape.direction);
  const angle = finite(shape.angle, 90);
  const minAngle = (360 + ((direction - angle * 0.5) % 360)) % 360;
  const maxAngle = (360 + ((direction + angle * 0.5) % 360)) % 360;
  const withinAngle = (value) => {
    value = (360 + (value % 360)) % 360;
    return minAngle < maxAngle
      ? value >= minAngle && value <= maxAngle
      : value >= minAngle || value <= maxAngle;
  };

  /* PF2e distinguishes corner- and edge-origin cones. Move only coordinates
     that sit inside a cell by half a cell toward the firing direction. */
  const dir = (direction >= 0 ? 360 - direction : -direction) % 360;
  const xOffset = placedOrigin.x % size !== 0
    ? Math.sign(Math.round(Math.cos(radians(dir)) * 100)) / 2 : 0;
  const yOffset = placedOrigin.y % size !== 0
    ? -Math.sign(Math.round(Math.sin(radians(dir)) * 100)) / 2 : 0;
  const origin = {
    x: placedOrigin.x + xOffset * size,
    y: placedOrigin.y + yOffset * size,
  };
  return {
    origin,
    contains: (destination) => {
      const dx = destination.x - origin.x;
      const dy = destination.y - origin.y;
      if (dx === 0 && dy === 0) return true;
      return withinAngle((360 + Math.atan2(dy, dx) / (Math.PI / 180)) % 360);
    },
  };
}

function areaCoverage(shape) {
  const size = finite(canvas?.dimensions?.size, 100) || 100;
  const distance = finite(canvas?.dimensions?.distance, 5) || 5;
  if (shape.type === "circle") {
    const origin = { x: finite(shape.x), y: finite(shape.y) };
    const radius = finite(shape.radius) / size * distance;
    return {
      origin,
      searchCenter: origin,
      reach: finite(shape.radius) / size,
      contains: (destination) => measurePf2eDistance(destination, origin) <= radius,
    };
  }

  if (shape.type === "cone") {
    const radius = finite(shape.radius) / size * distance;
    const cone = coneCoverage(shape, { x: finite(shape.x), y: finite(shape.y) });
    return {
      origin: cone.origin,
      searchCenter: cone.origin,
      reach: finite(shape.radius) / size,
      contains: (destination) => cone.contains(destination)
        && measurePf2eDistance(destination, cone.origin) <= radius,
    };
  }

  if (shape.type === "emanation" && shape.base?.type === "token") {
    const base = shape.base;
    const rawWidth = finite(base.width, 1) * size;
    const rawHeight = finite(base.height, 1) * size;
    const width = Math.max(size, rawWidth);
    const height = Math.max(size, rawHeight);
    const x = rawWidth < size
      ? Math.floor((finite(base.x) + rawWidth / 2) / size) * size
      : finite(base.x);
    const y = rawHeight < size
      ? Math.floor((finite(base.y) + rawHeight / 2) / size) * size
      : finite(base.y);
    const radius = finite(shape.radius) / size * distance;
    const minCenter = { x: x + size / 2, y: y + size / 2 };
    const maxCenter = { x: x + width - size / 2, y: y + height - size / 2 };
    const origin = { x: x + width / 2, y: y + height / 2 };
    return {
      origin,
      searchCenter: origin,
      reach: finite(shape.radius) / size + Math.max(width, height) / size / 2,
      contains: (destination) => {
        const nearest = {
          x: Math.min(maxCenter.x, Math.max(minCenter.x, destination.x)),
          y: Math.min(maxCenter.y, Math.max(minCenter.y, destination.y)),
        };
        return measurePf2eDistance(destination, nearest) <= radius;
      },
    };
  }

  const direction = radians(shape.rotation ?? shape.direction);
  const along = { x: Math.cos(direction), y: Math.sin(direction) };
  const perpendicular = { x: -along.y, y: along.x };
  const width = finite(shape.width, size);
  const length = finite(shape.length, finite(shape.radius));
  const halfWidth = width / 2;
  const toCorner = (coordinate, component) => coordinate % size !== 0
    ? coordinate - Math.sign(Math.round(component * 100)) * (size / 2) : coordinate;
  const origin = {
    x: toCorner(finite(shape.x), along.x),
    y: toCorner(finite(shape.y), along.y),
  };
  return {
    origin,
    searchCenter: {
      x: origin.x + along.x * length / 2,
      y: origin.y + along.y * length / 2,
    },
    reach: (length / 2 + halfWidth) / size,
    contains: (destination) => {
      const dx = destination.x - origin.x;
      const dy = destination.y - origin.y;
      const projection = dx * along.x + dy * along.y;
      const offset = dx * perpendicular.x + dy * perpendicular.y;
      return projection >= 0 && projection <= length && Math.abs(offset) <= halfWidth;
    },
  };
}

/**
 * PF2e rules coverage for the template Region shapes. This mirrors the
 * system's square-grid resolver and remains local for PF2e releases that still
 * delegate Region coverage to Foundry core.
 */
export function pf2eCoverage(region) {
  const document = region?.document ?? region;
  const shapes = region?.animationState?.shapes ?? document;
  const shape = firstShape(shapes);
  /* Live auras already expose PF2e's authoritative active squares, including
     five-point wall testing. Let regionCells consume those offsets directly. */
  if (region?.glAoeAuraRenderer || !canvas?.grid?.isSquare || shapeCount(shapes) !== 1
    || !["circle", "cone", "line", "emanation"].includes(shape?.type)) return null;

  const area = areaCoverage(shape);
  const size = finite(canvas?.dimensions?.size, 100) || 100;
  const grid = canvas.grid;
  let centerOffset;
  try {
    centerOffset = grid.getOffset(grid.getCenterPoint(area.searchCenter));
  } catch { return null; }
  if (!Number.isInteger(centerOffset?.i) || !Number.isInteger(centerOffset?.j)) return null;

  /* Keep this i/j ordering identical to PF2e's Region implementation. */
  const { i: col0, j: row0 } = centerOffset;
  const span = Math.ceil(area.reach) + 1;
  const covered = [];
  const blocked = [];
  for (let a = -span; a <= span; a++) {
    for (let b = -span; b <= span; b++) {
      const offset = { i: col0 + a, j: row0 + b };
      const topLeft = pointXY(offset);
      const destination = { x: topLeft.x + size * 0.5, y: topLeft.y + size * 0.5 };
      if (destination.x < 0 || destination.y < 0 || !area.contains(destination)) continue;
      const blockedByWall = Boolean(canvas?.ready) && collision(area.origin, destination);
      (blockedByWall ? blocked : covered).push(offset);
    }
  }
  return { covered, blocked, origin: area.origin };
}

function collision(origin, destination) {
  try {
    return Boolean(CONFIG.Canvas?.polygonBackends?.move?.testCollision?.(
      origin,
      destination,
      { type: "move", mode: "any" },
    ));
  } catch { return false; }
}

function contains(document, point) {
  try { return Boolean(document?.testPoint?.({ ...point, elevation: document?.elevation?.bottom ?? 0 })); }
  catch { return false; }
}

/** Build an RGBA rules texture: 0 outside, 128 blocked, 255 covered. */
export function regionCells(region, geometry) {
  const document = region?.document ?? region;
  const grid = geometry.grid;
  const rulesCoverage = pf2eCoverage(region);
  let offsets = rulesCoverage?.covered ?? [];
  if (!rulesCoverage) {
    try {
      const result = region?._getCoveredGridSpaceOffsets?.();
      offsets = result ? [...result] : [];
    } catch { offsets = []; }
  }

  const covered = new Set();
  for (const value of offsets) {
    const point = pointXY(value);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    covered.add(`${Math.round(point.x / grid)},${Math.round(point.y / grid)}`);
  }
  const blocked = new Set();
  for (const value of rulesCoverage?.blocked ?? []) {
    const point = pointXY(value);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    blocked.add(`${Math.round(point.x / grid)},${Math.round(point.y / grid)}`);
  }

  const b = geometry.bounds;
  let minX = Math.floor(b.x / grid) - 2;
  let minY = Math.floor(b.y / grid) - 2;
  let maxX = Math.ceil((b.x + b.width) / grid) + 1;
  let maxY = Math.ceil((b.y + b.height) / grid) + 1;
  for (const key of [...covered, ...blocked]) {
    const [x, y] = key.split(",").map(Number);
    minX = Math.min(minX, x - 1); minY = Math.min(minY, y - 1);
    maxX = Math.max(maxX, x + 1); maxY = Math.max(maxY, y + 1);
  }

  /* A malformed or enormous Region must not allocate an unbounded GPU texture. */
  if (maxX - minX + 1 > 512 || maxY - minY + 1 > 512) return null;
  const width = Math.max(1, maxX - minX + 1);
  const height = Math.max(1, maxY - minY + 1);
  const data = new Uint8Array(width * height * 4);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const key = `${x},${y}`;
      let state = covered.has(key) ? CELL.covered : blocked.has(key) ? CELL.blocked : CELL.outside;
      const center = { x: (x + 0.5) * grid, y: (y + 0.5) * grid };
      if (!rulesCoverage && state === CELL.outside && contains(document, center) && collision(geometry.origin, center)) {
        state = CELL.blocked;
      } else if (!rulesCoverage && !covered.size && contains(document, center)) {
        state = collision(geometry.origin, center) ? CELL.blocked : CELL.covered;
      }
      const i = ((y - minY) * width + (x - minX)) * 4;
      const value = Math.round(state * 255);
      data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255;
    }
  }

  return {
    data,
    width,
    height,
    minX,
    minY,
    origin: [minX - geometry.gridOffset[0], minY - geometry.gridOffset[1]],
  };
}

export function cellStateAt(cells, x, y, grid) {
  if (!cells) return CELL.outside;
  const ix = Math.floor(x / grid) - cells.minX;
  const iy = Math.floor(y / grid) - cells.minY;
  if (ix < 0 || iy < 0 || ix >= cells.width || iy >= cells.height) return CELL.outside;
  return cells.data[(iy * cells.width + ix) * 4] / 255;
}

export function seedFor(value) {
  let hash = 2166136261;
  for (const char of String(value ?? "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 1000;
}
