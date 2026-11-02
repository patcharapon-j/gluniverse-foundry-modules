/**
 * Diorama — 3D distance between two creatures, pure.
 *
 * PF2e has no printed formula for distance in three dimensions (Player Core
 * p. 421 "3D Movement" defers to Special Battles, which only says to track
 * positions in three dimensions). The system's own code is the rule at a
 * Foundry table, so this restates it: `measureDistanceCuboid` and
 * `measureDistanceOnGrid` in the PF2e system (TokenPF2e#distanceTo).
 *
 *   • Each creature is a box: its space on the map, and a column as tall as
 *     its space (`ActorPF2e#dimensions.height` = the smaller side of its
 *     space) standing on its elevation.
 *   • Per axis, the gap between the two boxes in whole squares, plus one
 *     (adjacent = 1 square = 5 ft). Overlapping on the map counts 0 on both
 *     map axes; overlapping columns count 0 vertically.
 *   • The vertical is a third axis with the same 5/10 diagonal alternation:
 *     sorted counts (low, mid, high) cost floor(1.75·low + 1.5·(mid − low) +
 *     (high − mid)) squares. That is Foundry's ALTERNATING_1 measurement of a
 *     single 3D segment, term for term (`foundryAlternating` below).
 *   • A 10 ft reach creature reaches the second diagonal square: one square
 *     comes off when the measurement is diagonal and `reach` is 10.
 *   • Same elevation (or a side with no actor): the vertical is not counted.
 *
 * Inputs are px for the map (Foundry's units) and distance units for heights.
 */

const finite = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

/**
 * Squares for a 3D offset counted per axis (each already a whole number of
 * squares), PF2e's diagonal rule. Pure arithmetic: `measureDistanceOnGrid`.
 * @param {number} nx
 * @param {number} ny
 * @param {number} [nz]
 * @param {{reach?:number|null}} [o]
 * @returns {number} squares
 */
export function pf2eSquares(nx, ny, nz = 0, { reach = null } = {}) {
  const [low, mid, high] = [Math.abs(nx), Math.abs(ny), Math.abs(nz)].map((n) => Math.ceil(n)).sort((a, b) => a - b);
  const doubleDiagonal = low, diagonal = mid - low, straight = high - mid;
  const reachTen = diagonal + doubleDiagonal > 1 && reach === 10 ? 1 : 0;
  return Math.floor(doubleDiagonal * 1.75 + diagonal * 1.5 + straight) - reachTen;
}

/**
 * Foundry's ALTERNATING_1 cost of one 3D grid segment from a fresh count
 * (SquareGrid#_measurePath): di + floor((dj + dk / 2) / 2), di ≥ dj ≥ dk.
 * Here so the check can hold pf2eSquares to Foundry's own measurement.
 */
export function foundryAlternating(di, dj, dk = 0) {
  const [a, b, c] = [Math.abs(di), Math.abs(dj), Math.abs(dk)].sort((x, y) => y - x);
  return a + Math.floor((b + 0.5 * c) / 2);
}

/** PF2e's snapBounds: a box snapped outward to whole squares, toward the other box. */
function snapToward(e, t, s) {
  const fx = e.left < t.left ? Math.ceil : Math.floor;
  const fy = e.top < t.top ? Math.ceil : Math.floor;
  const left = fx(e.left / s) * s, top = fy(e.top / s) * s;
  const width = Math.ceil(e.width / s) * s, height = Math.ceil(e.height / s) * s;
  return { left, top, right: left + width, bottom: top + height };
}

const box = (x, y, w, h) => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
const overlaps = (e, t) => t.right > e.left && t.left < e.right && t.bottom > e.top && t.top < e.bottom;

/** The gap between two boxes along x and y, in px, each +1 square (0 when they overlap). */
function mapGap(a, b, s) {
  if (overlaps(a, b) || overlaps(b, a)) return { dx: 0, dy: 0 };
  const n = snapToward(a, b, s), r = snapToward(b, a, s);
  return {
    dx: Math.max(n.left - r.right, r.left - n.right, 0) + s,
    dy: Math.max(n.top - r.bottom, r.top - n.bottom, 0) + s,
  };
}

/**
 * PF2e distance between two creatures, in distance units.
 * @param {{x:number,y:number,w:number,h:number,elevation?:number,height?:number,actor?:boolean}} a  px box, ft
 * @param {typeof a} b
 * @param {{size:number, distance:number, reach?:number|null}} grid
 * @returns {{distance:number, squares:number, counts:{dx:number,dy:number,dz:number}}}
 *   counts in squares per axis, as PF2e counts them
 */
export function pf2eDistance(a, b, { size = 100, distance = 5, reach = null } = {}) {
  const s = finite(size, 100) || 100, d = finite(distance, 5) || 5;
  const A = box(finite(a.x), finite(a.y), Math.max(1, finite(a.w, s)), Math.max(1, finite(a.h, s)));
  const B = box(finite(b.x), finite(b.y), Math.max(1, finite(b.w, s)), Math.max(1, finite(b.h, s)));
  const { dx, dy } = mapGap(A, B, s);
  let dz = 0;
  const ea = finite(a.elevation), eb = finite(b.elevation);
  if (ea !== eb && a.actor !== false && b.actor !== false) {
    // The columns, laid on their side as boxes so the same snapping applies.
    const ha = Math.floor((finite(a.height, d) / d) * s), hb = Math.floor((finite(b.height, d) / d) * s);
    const ca = box(A.left, Math.floor((ea / d) * s), A.width, ha);
    const cb = box(B.left, Math.floor((eb / d) * s), B.width, hb);
    const vOverlap = cb.bottom > ca.top && cb.top < ca.bottom;
    if (!vOverlap) {
      const n = snapToward(ca, cb, s), r = snapToward(cb, ca, s);
      dz = Math.max(n.top - r.bottom, r.top - n.bottom, 0) + s;
    }
  }
  const counts = { dx: Math.ceil(Math.abs(dx / s)), dy: Math.ceil(Math.abs(dy / s)), dz: Math.ceil(Math.abs(dz / s)) };
  const squares = pf2eSquares(counts.dx, counts.dy, counts.dz, { reach });
  return { distance: squares * d, squares, counts };
}

/** PF2e's column height for a size key, ft (ActorPF2e#dimensions: the smaller side of the space). */
export const PF2E_SPACE_FT = Object.freeze({ tiny: 2.5, sm: 5, med: 5, lg: 10, huge: 15, grg: 20 });
