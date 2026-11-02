/** Identity and contextual measurement presenter, separate from render resources. */

import { buildPlate } from "./render/plate.mjs";

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function firstShape(document) {
  const shapes = document?.shapes;
  return shapes?.contents?.[0] ?? shapes?.[0] ?? shapes?.at?.(0) ?? null;
}

function number(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Pure compact summary using scene distance authority supplied by the caller. */
export function measurementSummary(document, { gridSize = 100, gridDistance = 5, units = "ft" } = {}) {
  const shape = firstShape(document);
  if (!shape) return "";
  const area = String(document?.flags?.pf2e?.areaShape ?? shape.type ?? "").toLowerCase();
  const toDistance = (pixels) => finite(pixels) / Math.max(1, gridSize) * gridDistance;
  if (area === "line" || shape.type === "line") {
    const length = toDistance(shape.length ?? shape.radius);
    const width = toDistance(shape.width ?? gridSize);
    return `${number(length)} × ${number(width)} ${units} • LINE`;
  }
  if (["square", "cube"].includes(area) || shape.type === "rectangle") {
    const width = toDistance(shape.width), height = toDistance(shape.height);
    return `${number(width)} × ${number(height)} ${units} • ${area === "cube" ? "CUBE" : "SQUARE"}`;
  }
  if (["burst", "cone", "emanation", "ring", "cylinder"].includes(area) || shape.type === "circle") {
    const radius = toDistance(shape.radius ?? shape.distance);
    const type = area === "circle" ? "BURST" : area.toUpperCase();
    const angle = area === "cone" ? ` • ${number(finite(shape.angle, 90))}°` : "";
    return `${number(radius)} ${units} • ${type}${angle}`;
  }
  return "";
}

/**
 * The identity plate for one Region (render/plate.mjs draws it). `anchor` is
 * where it stands, in world pixels: the top centre of the area.
 */
export function createMeasurementPresenter(region, style, geometry, anchor = geometry.labelAt) {
  const measured = Boolean(region?.document?.displayMeasurements);
  if (!style.label && !measured) return null;
  const summary = measured ? measurementSummary(region.document, {
    gridSize: geometry.grid,
    gridDistance: canvas?.dimensions?.distance ?? 5,
    units: canvas?.scene?.grid?.units || "ft",
  }) : "";
  if (!style.label && !summary) return null;
  const root = buildPlate(PIXI, {
    title: style.label ?? "",
    detail: summary,
    tone: style.look?.hot ?? style.color,
    grid: geometry.grid,
    resolution: clamp(Math.ceil((globalThis.devicePixelRatio || 1) * 2), 2, 4),
  });
  root.position.set(anchor.x, anchor.y);
  root.glAoeBaseY = anchor.y;
  /* The host keeps a plate across in-place refreshes and re-points this at the
     live Region, so nothing here may pin the one it was built from. */
  root.glAoeRegion = region;
  root.setInspected(Boolean(region?.hover || region?.controlled));
  return root;
}

/** Event-driven, bounded collision layout for screen-space identity labels. */
export function layoutPresenters(entries) {
  const labels = [...entries].map((entry) => entry.label).filter(Boolean)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const occupied = [];
  for (const label of labels) {
    label.position.y = label.glAoeBaseY;
    let bounds = label.getBounds?.();
    if (!bounds) continue;
    let attempts = 0;
    while (attempts < 4 && occupied.some((other) => bounds.x < other.x + other.width && bounds.x + bounds.width > other.x
      && bounds.y < other.y + other.height && bounds.y + bounds.height > other.y)) {
      label.position.y += (attempts % 2 ? -1 : 1) * (bounds.height + 5) * (Math.floor(attempts / 2) + 1);
      bounds = label.getBounds(); attempts++;
    }
    occupied.push(bounds);
  }
}
