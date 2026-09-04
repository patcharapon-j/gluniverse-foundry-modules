/** Identity and contextual measurement presenter, separate from render resources. */

import { lighten } from "../../core/theme.mjs";

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

export function createMeasurementPresenter(region, style, geometry) {
  if (!style.label && !region?.document?.displayMeasurements) return null;
  const root = new PIXI.Container();
  root.eventMode = "none";
  root.position.set(geometry.labelAt.x, geometry.labelAt.y);
  root.glAoeBaseY = geometry.labelAt.y;
  const color = Number.parseInt(lighten(style.color, 0.48).slice(1), 16);
  const fontSize = clamp(Math.round(geometry.grid * 0.24), 14, 30);
  const title = new PIXI.Text(String(style.label ?? "").toUpperCase(), {
    fontFamily: "Oxanium, Rajdhani, sans-serif", fontSize, fontWeight: "650",
    letterSpacing: Math.max(1, Math.round(fontSize * 0.12)), fill: color, align: "center",
    stroke: 0x030509, strokeThickness: Math.max(2, Math.round(fontSize * 0.11)),
    dropShadow: true, dropShadowColor: color, dropShadowAlpha: 0.56,
    dropShadowBlur: Math.max(3, fontSize * 0.28), dropShadowDistance: 0,
  });
  title.anchor.set(0.5);
  title.resolution = Math.max(2, globalThis.devicePixelRatio || 2);
  const summary = measurementSummary(region.document, {
    gridSize: geometry.grid,
    gridDistance: canvas?.dimensions?.distance ?? 5,
    units: canvas?.scene?.grid?.units || "ft",
  });
  const detail = new PIXI.Text(summary, {
    fontFamily: "Rajdhani, sans-serif", fontSize: Math.max(11, Math.round(fontSize * 0.55)),
    fontWeight: "600", letterSpacing: 1, fill: color, align: "center",
    stroke: 0x030509, strokeThickness: 2,
  });
  detail.anchor.set(0.5); detail.position.y = fontSize * 0.88; detail.resolution = title.resolution;
  const maxWidth = Math.max(geometry.grid * 1.6, geometry.bounds.width * 0.72);
  if (title.width > maxWidth) title.scale.set(maxWidth / title.width);
  const width = Math.max(Math.min(maxWidth, title.width), detail.width) + fontSize * 1.8;
  const backing = new PIXI.Graphics();
  backing.lineStyle({ width: 1, color, alpha: 0.62 }); backing.moveTo(-width / 2, -fontSize * 0.72); backing.lineTo(width / 2, -fontSize * 0.72);
  backing.lineStyle({ width: 1, color, alpha: 0.38 }); backing.moveTo(-width / 2, fontSize * 1.45); backing.lineTo(width / 2, fontSize * 1.45);
  root.addChild(backing, title, detail);
  root.glAoeDetail = detail;
  root.glAoeSummary = summary;
  root.setInspected = (inspected) => { detail.visible = Boolean(summary && inspected && region.document?.displayMeasurements); };
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
