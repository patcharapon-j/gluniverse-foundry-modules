/** PF2e AuraRenderer -> ephemeral Spellglass Region adapters. */

import { SUITE_ID } from "../../core/const.mjs";
import { FLAGS } from "./constants.mjs";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function colorHex(value) {
  const number = Number(value);
  return Number.isFinite(number)
    ? `#${Math.max(0, Math.min(0xffffff, Math.round(number))).toString(16).padStart(6, "0")}`
    : null;
}

function styleFor(renderer) {
  const color = colorHex(renderer.appearance?.highlight?.color)
    ?? colorHex(renderer.appearance?.border?.color);
  return {
    colorOverride: Boolean(color),
    color,
    label: "",
  };
}

/** Convert one live PF2e AuraRenderer into the Region-shaped host contract. */
export function auraRegionFor(renderer) {
  const token = renderer?.token;
  if (!token || renderer.destroyed || !token.visible) return null;
  const grid = finite(canvas?.dimensions?.size, 100) || 100;
  const distance = finite(canvas?.dimensions?.distance, 5) || 5;
  const mechanical = token.mechanicalBounds;
  if (!mechanical) return null;
  const squareBase = Boolean(canvas?.grid?.isSquare);
  const width = squareBase ? Math.max(grid, mechanical.width) : mechanical.width;
  const height = squareBase ? Math.max(grid, mechanical.height) : mechanical.height;
  const base = {
    x: squareBase && mechanical.width < grid
      ? Math.floor((mechanical.x + mechanical.width / 2) / grid) * grid
      : mechanical.x,
    y: squareBase && mechanical.height < grid
      ? Math.floor((mechanical.y + mechanical.height / 2) / grid) * grid
      : mechanical.y,
    width,
    height,
  };
  const radius = finite(renderer.radius) * grid / distance;
  const bounds = {
    x: base.x - radius,
    y: base.y - radius,
    width: base.width + radius * 2,
    height: base.height + radius * 2,
  };
  const style = styleFor(renderer);
  const document = {
    documentName: "Region",
    name: renderer.slug,
    shapes: [{
      type: "emanation",
      base: {
        type: "token",
        x: base.x,
        y: base.y,
        width: base.width / grid,
        height: base.height / grid,
      },
      radius,
      gridBased: Boolean(canvas?.grid?.isSquare),
    }],
    bounds,
    attachment: { token: token.id },
    elevation: { bottom: finite(token.document?.elevation) },
    flags: { pf2e: { areaShape: "emanation", origin: { traits: [...(renderer.traits ?? [])] } } },
    getFlag: (namespace, key) => namespace === SUITE_ID && key === FLAGS.style ? style : null,
    testPoint: ({ x, y }) => {
      const dx = Math.max(base.x - x, 0, x - (base.x + base.width));
      const dy = Math.max(base.y - y, 0, y - (base.y + base.height));
      return Math.hypot(dx, dy) <= radius;
    },
  };
  return {
    id: `aura:${token.id}:${renderer.slug}`,
    visible: true,
    document,
    bounds,
    glAoeAuraRenderer: renderer,
    _getCoveredGridSpaceOffsets: () => {
      try {
        return renderer.squares.filter((square) => square.active)
          .map((square) => ({ x: square.x, y: square.y }));
      } catch { return []; }
    },
  };
}

/** All currently drawn PF2e auras, without creating or changing game data. */
export function auraRegions() {
  const regions = [];
  for (const token of canvas?.tokens?.placeables ?? []) {
    for (const renderer of token?.auras?.values?.() ?? []) {
      const region = auraRegionFor(renderer);
      if (region) regions.push(region);
    }
  }
  return regions;
}

/** Native PF2e aura nodes hidden while their Spellglass replacement is alive. */
export function auraNativeNodes(region) {
  const renderer = region?.glAoeAuraRenderer;
  if (!renderer) return [];
  return [renderer.border, renderer.textureContainer, renderer.highlightLayer]
    .filter((node) => node && !node.destroyed);
}
