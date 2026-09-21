/**
 * Hexcrawl — hex geometry.
 *
 * Pure. Every hex in the feature is addressed by its Foundry grid OFFSET key,
 * "i,j" (i = row, j = column — Foundry's own convention). Range, rings and
 * distance are done in cube space. The mapping between offsets, cubes and pixels
 * goes through a GRID ADAPTER so the same code runs:
 *
 *   • in Foundry, where `foundryAdapter(canvas.grid)` defers to Foundry's own
 *     HexagonalGrid — the only authority on where Foundry thinks a hex is. Our
 *     layout maths must never be the thing that disagrees with the token snap.
 *   • in the preview / check tool, where `pureAdapter({ type, size })` lays the
 *     grid out itself.
 *
 * Adapter interface:
 *   { type, size, columns: boolean,
 *     toCube(key) → {q,r,s},  fromCube({q,r,s}) → key,
 *     center(key) → {x,y},    vertices(key) → [{x,y}×6],
 *     keyAt({x,y}) → key,     inBounds(key) → boolean }
 */

/** Foundry CONST.GRID_TYPES for hex grids. Columns (Q) are flat-top. */
export const HEX_TYPES = Object.freeze({ HEXODDR: 2, HEXEVENR: 3, HEXODDQ: 4, HEXEVENQ: 5 });
export const isHexType = (t) => t >= 2 && t <= 5;
export const isColumns = (t) => t === 4 || t === 5;
export const isEven = (t) => t === 3 || t === 5;

export const key = (i, j) => `${i},${j}`;
export function parseKey(k) {
  const [i, j] = String(k).split(",").map(Number);
  return { i, j };
}
export const isKey = (k) => typeof k === "string" && /^-?\d+,-?\d+$/.test(k);

/* ── Cube maths ─────────────────────────────────────────────────────────── */

export const CUBE_DIRS = Object.freeze([
  { q: 1, r: 0, s: -1 }, { q: 1, r: -1, s: 0 }, { q: 0, r: -1, s: 1 },
  { q: -1, r: 0, s: 1 }, { q: -1, r: 1, s: 0 }, { q: 0, r: 1, s: -1 },
]);

export const cubeAdd = (a, b) => ({ q: a.q + b.q, r: a.r + b.r, s: a.s + b.s });
export const cubeDistance = (a, b) =>
  Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s));

export function cubeRound({ q, r, s }) {
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  else rs = -rq - rr;
  return { q: rq + 0, r: rr + 0, s: rs + 0 };
}

/** Every cube within `n` steps of `c`, including `c`. */
export function cubeRange(c, n) {
  const out = [];
  for (let dq = -n; dq <= n; dq++) {
    for (let dr = Math.max(-n, -dq - n); dr <= Math.min(n, -dq + n); dr++) {
      out.push({ q: c.q + dq, r: c.r + dr, s: c.s - dq - dr });
    }
  }
  return out;
}

/* ── Adapter-level helpers ──────────────────────────────────────────────── */

export const distance = (adapter, a, b) => cubeDistance(adapter.toCube(a), adapter.toCube(b));

export function neighbors(adapter, k) {
  const c = adapter.toCube(k);
  return CUBE_DIRS.map((d) => adapter.fromCube(cubeAdd(c, d)));
}

/** Keys within `n` of `k` (including `k`), filtered to the adapter's bounds. */
export function range(adapter, k, n) {
  return cubeRange(adapter.toCube(k), Math.max(0, n | 0))
    .map((c) => adapter.fromCube(c))
    .filter((x) => adapter.inBounds(x));
}

/** Union of ranges around several centres: [{ key, sight }] → Set<key>. */
export function unionRange(adapter, centres) {
  const out = new Set();
  for (const { key: k, sight } of centres) for (const x of range(adapter, k, sight)) out.add(x);
  return out;
}

/** The hexes a straight walk from a to b passes through (cube line), a first. */
export function line(adapter, a, b) {
  const A = adapter.toCube(a), B = adapter.toCube(b);
  const n = cubeDistance(A, B);
  if (n === 0) return [a];
  const out = [];
  for (let t = 0; t <= n; t++) {
    const f = t / n;
    out.push(adapter.fromCube(cubeRound({
      q: A.q + (B.q - A.q) * f + 1e-6,
      r: A.r + (B.r - A.r) * f + 1e-6,
      s: A.s + (B.s - A.s) * f - 2e-6,
    })));
  }
  return out;
}

/**
 * The boundary of a set of hexes as edge segments: every edge whose other side
 * is not in the set. Works for any adapter because it pairs edges by shared
 * vertices rather than by a direction table that would have to agree with
 * Foundry's vertex order. Returns [{ a:{x,y}, b:{x,y}, key, outside }].
 */
export function boundaryEdges(adapter, keys) {
  const set = keys instanceof Set ? keys : new Set(keys);
  const out = [];
  for (const k of set) {
    const v = adapter.vertices(k);
    const c = adapter.center(k);
    for (let e = 0; e < 6; e++) {
      const a = v[e], b = v[(e + 1) % 6];
      // Mirror the hex centre across the edge midpoint → the neighbour's centre.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const other = adapter.keyAt({ x: 2 * mx - c.x, y: 2 * my - c.y });
      if (!set.has(other)) out.push({ a, b, key: k, outside: other });
    }
  }
  return out;
}

/* ── Pure adapter (preview / check tool) ────────────────────────────────── */

/**
 * Lays a hex grid out EXACTLY as Foundry's HexagonalGrid#getCenterPoint does
 * (common/grid/hexagonal.mjs), so a pure computation — scene sizing, the import
 * origin — agrees with the live grid. `size` is the distance between adjacent
 * hex centres (Foundry's grid.size). Note Foundry puts the higher class of
 * columns (or rows) with its centres ON the canvas edge: row 0 of that class is
 * half off a padding-less scene, which is what gridOrigin() exists to skip. Columns (types 4/5) are flat-top;
 * the odd/even flag says which columns (or rows) are pushed half a hex along.
 * `bounds` is optional { rows, cols } for inBounds.
 */
export function pureAdapter({ type = HEX_TYPES.HEXODDQ, size = 100, bounds = null } = {}) {
  const columns = isColumns(type);
  const even = isEven(type);
  const R = size / Math.sqrt(3); // circumradius
  const w = columns ? 2 * R : size;   // hex bounding width
  const h = columns ? size : 2 * R;   // hex bounding height

  const shifted = (n) => (even ? (n & 1) === 0 : (n & 1) === 1);

  function toCube(k) {
    const { i, j } = parseKey(k);
    if (columns) {
      const q = j;
      const r = even ? i - (j + (j & 1)) / 2 : i - (j - (j & 1)) / 2;
      return { q, r, s: -q - r };
    }
    const r = i;
    const q = even ? j - (i + (i & 1)) / 2 : j - (i - (i & 1)) / 2;
    return { q, r, s: -q - r };
  }

  function fromCube({ q, r }) {
    if (columns) {
      const j = q;
      const i = even ? r + (q + (q & 1)) / 2 : r + (q - (q & 1)) / 2;
      return key(i, j);
    }
    const i = r;
    const j = even ? q + (r + (r & 1)) / 2 : q + (r - (r & 1)) / 2;
    return key(i, j);
  }

  function center(k) {
    const { i, j } = parseKey(k);
    if (columns) {
      return { x: w / 2 + j * (w * 0.75), y: i * h + (shifted(j) ? h / 2 : 0) };
    }
    return { x: j * w + (shifted(i) ? w / 2 : 0), y: h / 2 + i * (h * 0.75) };
  }

  function vertices(k) {
    const c = center(k);
    const out = [];
    for (let n = 0; n < 6; n++) {
      const a = Math.PI / 3 * n + (columns ? 0 : Math.PI / 6);
      out.push({ x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a) });
    }
    return out;
  }

  function keyAt({ x, y }) {
    // Nearest centre among a small candidate neighbourhood around the estimate.
    let ei, ej;
    if (columns) { ej = Math.round((x - w / 2) / (w * 0.75)); ei = Math.round((y - (shifted(ej) ? h / 2 : 0)) / h); }
    else { ei = Math.round((y - h / 2) / (h * 0.75)); ej = Math.round((x - (shifted(ei) ? w / 2 : 0)) / w); }
    let best = key(ei, ej), bd = Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const k = key(ei + di, ej + dj);
      const c = center(k);
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = k; }
    }
    return best;
  }

  function inBounds(k) {
    if (!bounds) return true;
    const { i, j } = parseKey(k);
    return i >= 0 && j >= 0 && i < bounds.rows && j < bounds.cols;
  }

  return { type, size, columns, radius: R, width: w, height: h, toCube, fromCube, center, vertices, keyAt, inBounds };
}

/* ── Foundry adapter ────────────────────────────────────────────────────── */

/**
 * Wrap Foundry's HexagonalGrid. Only called at runtime (never at import), so
 * this module stays loadable under Node. `sceneRect` (canvas.dimensions.sceneRect)
 * bounds the map to the scene's own area, excluding padding.
 */
export function foundryAdapter(grid, sceneRect = null) {
  const type = grid.type;
  const columns = !!grid.columns;
  const toOffset = (k) => { const { i, j } = parseKey(k); return { i, j }; };
  return {
    type,
    size: grid.size,
    columns,
    radius: grid.size / Math.sqrt(3),
    width: grid.sizeX,
    height: grid.sizeY,
    toCube(k) { const c = grid.getCube(toOffset(k)); return { q: c.q, r: c.r, s: c.s ?? -c.q - c.r }; },
    fromCube(c) { const o = grid.getOffset({ q: c.q, r: c.r, s: c.s ?? -c.q - c.r }); return key(o.i, o.j); },
    center(k) { const p = grid.getCenterPoint(toOffset(k)); return { x: p.x, y: p.y }; },
    vertices(k) { return grid.getVertices(toOffset(k)).map((p) => ({ x: p.x, y: p.y })); },
    keyAt(p) { const o = grid.getOffset({ x: p.x, y: p.y }); return key(o.i, o.j); },
    inBounds(k) { return !sceneRect || fullyInside(this, k, sceneRect); },
  };
}

/** Every key whose hexagon lies wholly inside `rect` (and the adapter's bounds). */
export function keysInRect(adapter, rect) {
  const out = new Set();
  const stepX = adapter.width * 0.5, stepY = adapter.height * 0.5;
  for (let y = rect.y; y <= rect.y + rect.height; y += stepY) {
    for (let x = rect.x; x <= rect.x + rect.width; x += stepX) {
      const k = adapter.keyAt({ x, y });
      if (!out.has(k) && adapter.inBounds(k) && fullyInside(adapter, k, rect)) out.add(k);
    }
  }
  return [...out];
}

/* ── Scene rectangles ───────────────────────────────────────────────────── */

const EDGE_EPS = 1; // px — Foundry rounds scene dimensions to whole pixels

/** Is the whole hexagon of `k` inside `rect`? (Half-cut edge hexes are not map.) */
export function fullyInside(adapter, k, rect, eps = EDGE_EPS) {
  const c = adapter.center(k);
  const hw = adapter.width / 2, hh = adapter.height / 2;
  return c.x - hw >= rect.x - eps && c.y - hh >= rect.y - eps
    && c.x + hw <= rect.x + rect.width + eps && c.y + hh <= rect.y + rect.height + eps;
}

/**
 * The Foundry offset of import coordinate (0,0) in `rect`: the first row and
 * column whose hexes sit wholly inside it, with the SHIFTED axis moved to an
 * even offset so parity survives — an import written for "odd columns sit
 * lower" must land on a grid where odd columns sit lower. Import keys are
 * (row + i, col + j); export subtracts it. The cross axis may move by any amount.
 */
export function gridOrigin(adapter, rect) {
  const { columns } = adapter;
  const along = columns ? adapter.width * 0.75 : adapter.height * 0.75;
  const start = Math.floor((columns ? rect.x : rect.y) / along) - 2;
  let a = start;
  const first = (n) => (columns ? adapter.center(key(0, n)).x - adapter.width / 2 : adapter.center(key(n, 0)).y - adapter.height / 2);
  while (first(a) < (columns ? rect.x : rect.y) - EDGE_EPS) a++;
  if (a & 1) a++;
  const cross = columns ? adapter.height : adapter.width;
  let b = Math.floor((columns ? rect.y : rect.x) / cross) - 2;
  const fits = (n) => [a, a + 1].every((m) => {
    const c = adapter.center(columns ? key(n, m) : key(m, n));
    return columns ? c.y - adapter.height / 2 >= rect.y - EDGE_EPS : c.x - adapter.width / 2 >= rect.x - EDGE_EPS;
  });
  while (!fits(b)) b++;
  return columns ? { i: b, j: a } : { i: a, j: b };
}

/**
 * Scene size (Foundry padding 0) that holds exactly `cols` × `rows` whole
 * hexes plus a ring of `pad` blank hexes around them, and the origin the map
 * starts at (see gridOrigin — computed, not assumed, so the two never
 * disagree). The ring is uncharted fog — a frame, so an imported map never runs
 * into the scene edge. Along the SHIFTED axis the ring is rounded up to an even
 * count, because an odd shift there would flip the grid's parity.
 */
export function hexSceneDims({ type = HEX_TYPES.HEXODDQ, size = 100, cols = 20, rows = 14, pad = 0 } = {}) {
  const long = (2 * size) / Math.sqrt(3);
  const p = Math.max(0, Math.round(pad) || 0);
  const along = p ? 2 * Math.ceil(p / 2) : 0;
  const columns = isColumns(type);
  const C = cols + 2 * (columns ? along : p);
  const R = rows + 2 * (columns ? p : along);
  const dims = columns
    ? { width: Math.ceil(long * (0.75 * C + 0.25)), height: Math.ceil(size * (R + 1)) }
    : { width: Math.ceil(size * (C + 1)), height: Math.ceil(long * (0.75 * R + 0.25)) };
  const base = gridOrigin(pureAdapter({ type, size }), { x: 0, y: 0, ...dims });
  const origin = columns ? { i: base.i + p, j: base.j + along } : { i: base.i + along, j: base.j + p };
  return { ...dims, origin };
}
