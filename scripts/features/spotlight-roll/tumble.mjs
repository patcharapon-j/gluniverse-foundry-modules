/**
 * The tumble: how a spotlit die gets from wherever it is to the face it rolled.
 *
 * Pure, dependency-free and seeded, so the preview page and the live feature
 * run the SAME motion and a check tool can drive it under plain Node. It knows
 * nothing about three.js or Dice So Nice: it hands out unit quaternions
 * [x, y, z, w] and a small translation/scale, and the host applies them to
 * whatever mesh it owns.
 *
 * The die is never simulated. A physics throw lands where physics puts it and
 * the spotlight needs it to land HERE, on THIS face, at THIS moment, so the
 * orientation is composed instead:
 *
 *   q(t) = target · R(a2, θ2(t)) · R(a1, θ1(t)) · C(t)
 *
 * Two random body axes spin down to zero angle at the landing, so q(T) is the
 * target exactly, whatever the seed. θ1 arrives with a little speed left, which
 * the settle spends as a damped rock about the same axis — the die tips onto
 * its face and rocks once or twice instead of stopping dead. C(t) blends away
 * the difference between the idle pose and the tumble's start, so the throw
 * picks up from wherever the hovering die was facing. Both spin rates ramp in
 * from rest over `windup`, which is what makes the throw read as a flick
 * rather than a cut.
 */

const TAU = Math.PI * 2;

/* ── quaternion helpers ([x, y, z, w]) ───────────────────────────────── */

export function qmul(a, b) {
  const [ax, ay, az, aw] = a, [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function qnorm(q) {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / l, q[1] / l, q[2] / l, q[3] / l];
}

export function qconj(q) { return [-q[0], -q[1], -q[2], q[3]]; }

export function qaxis(axis, angle) {
  const s = Math.sin(angle / 2);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}

export function qslerp(a, b, t) {
  let [bx, by, bz, bw] = b;
  let d = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (d > 0.9995) return qnorm([a[0] + (bx - a[0]) * t, a[1] + (by - a[1]) * t, a[2] + (bz - a[2]) * t, a[3] + (bw - a[3]) * t]);
  const th = Math.acos(d), s = Math.sin(th);
  const wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** Rotate a vector by a unit quaternion. */
export function qrotate(q, v) {
  const p = qmul(qmul(q, [v[0], v[1], v[2], 0]), qconj(q));
  return [p[0], p[1], p[2]];
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

/** Quaternion from a row-major 3×3 rotation matrix. */
function qFromMatrix(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return qnorm([(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s]);
  }
  if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    return qnorm([0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]);
  }
  if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    return qnorm([(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s]);
  }
  const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
  return qnorm([(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s]);
}

/**
 * The orientation that shows a face to the camera: the face's outward normal
 * turned to `view` (towards the camera, +Z by default) and the face's reading
 * direction `up` turned to screen-up (+Y), so the number lands upright.
 * `normal` and `up` are in the die's own model space.
 */
export function faceQuaternion(normal, up, view = [0, 0, 1], screenUp = [0, 1, 0]) {
  const n = unit(normal);
  const u = unit(cross(cross(n, up), n));          // up, made orthogonal to n
  const r = cross(u, n);
  const V = unit(view);
  const U = unit(cross(cross(V, screenUp), V));
  const R = cross(U, V);
  // M = [R U V] · [r u n]^T
  const m = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) m.push(R[i] * r[j] + U[i] * u[j] + V[i] * n[j]);
  return qFromMatrix(m);
}

/**
 * How far a landed die leans its reading face towards the bottom of the
 * screen, in radians. Dead face-on, a d6 is a flat tile and a d20 a hexagon
 * with no depth; a small lean shows the top facets, so it reads as an object.
 */
export const LANDING_TILT = 0.26;

/** The view direction for faceQuaternion, leaned by LANDING_TILT towards screen-down. */
export function tiltedView(view, screenUp, tilt = LANDING_TILT) {
  const c = Math.cos(tilt), s = Math.sin(tilt);
  return unit([view[0] * c - screenUp[0] * s, view[1] * c - screenUp[1] * s, view[2] * c - screenUp[2] * s]);
}

/* ── seeded randomness ───────────────────────────────────────────────── */

/** mulberry32: small, fast, and identical on every client for one seed. */
export function rng(seed) {
  let a = (Number(seed) >>> 0) || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomAxis(rand) {
  const z = rand() * 2 - 1, a = rand() * TAU, s = Math.sqrt(1 - z * z);
  return [s * Math.cos(a), s * Math.sin(a), z];
}

/* ── the motion ──────────────────────────────────────────────────────── */

/** Every number the feel depends on, in seconds and radians. */
export const TUMBLE = Object.freeze({
  duration: 3.6,      // throw → landing: long enough to read as a throw, not a flick
  windup: 0.16,       // spin rate ramps in from rest
  spinPeak: 19,       // rad/s at the top of the primary spin (~3 rev/s)
  spinCross: 9,       // rad/s on the secondary axis — the precession
  arrival: 2.2,       // rad/s left on the primary axis at landing
  rockHz: 1.7,        // the settle's rocking frequency
  rockDecay: 5.2,     // 1/s — how fast the rock dies
  settle: 0.95,       // landing → at rest
  lift: 0.34,         // how far the die rises towards the camera mid-throw
  liftScale: 0.14,    // and how much bigger it reads at the top
  bounce: 0.05,       // the landing dip
});

const SAMPLES = 360;

/**
 * Integrate a rate profile ω(t) on [0, T] into an angle that runs from its
 * total down to 0: θ(t) = ∫_t^T ω. Returned as a sampled table so evaluation
 * is a lookup, not an integration, every frame.
 */
function angleTable(rate, T) {
  const dt = T / SAMPLES, acc = new Float64Array(SAMPLES + 1);
  for (let i = 1; i <= SAMPLES; i++) {
    const t0 = (i - 1) * dt, t1 = i * dt;
    acc[i] = acc[i - 1] + (rate(t0) + 4 * rate((t0 + t1) / 2) + rate(t1)) * dt / 6;
  }
  const total = acc[SAMPLES];
  return (t) => {
    if (t <= 0) return total;
    if (t >= T) return 0;
    const f = t / dt, i = Math.floor(f), k = f - i;
    return total - (acc[i] + (acc[i + 1] - acc[i]) * k);
  };
}

const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/**
 * Build one die's tumble.
 *
 *   target  quaternion the die must end on (see faceQuaternion)
 *   from    the die's orientation at the moment of the throw
 *   seed    shared by every client, so every screen sees the same tumble
 *   scale   motion tier: >1 slower and longer, <1 snappier
 *
 * Returns { duration, settle, total, at(t) } with t in seconds since the
 * throw; at(t) → { q, lift, scale, rate } where `rate` is the current spin in
 * rad/s (a readout can show it) and `lift` is a 0..1-ish offset towards the
 * camera that the host maps to its own units.
 */
export function createTumble({ target, from = [0, 0, 0, 1], seed = 1, scale = 1, params = {} } = {}) {
  const P = { ...TUMBLE, ...params };
  const rand = rng(seed);
  const T = P.duration * scale;
  const W = P.windup * scale;
  const settle = P.settle * scale;
  const a1 = randomAxis(rand);
  let a2 = randomAxis(rand);
  if (Math.abs(dot(a1, a2)) > 0.8) a2 = unit(cross(a1, [a1[1], a1[2], -a1[0]]));
  const peak = P.spinPeak * (0.85 + rand() * 0.3) / scale;
  const cross2 = P.spinCross * (0.7 + rand() * 0.6) / scale;
  const arrive = P.arrival / scale;

  // Primary: ramps in, then decays exponentially towards the arrival speed.
  const k = 3.2;
  const ramp = (t) => smooth(t / W);
  const r1 = (t) => ramp(t) * (arrive + (peak - arrive) * (Math.exp(-k * t / T) - Math.exp(-k)) / (1 - Math.exp(-k)));
  // Secondary: ramps in, then eases all the way to zero — no residual.
  const r2 = (t) => ramp(t) * cross2 * (1 - t / T) * (1 - t / T);
  const th1 = angleTable(r1, T), th2 = angleTable(r2, T);

  // The rock that spends the arrival speed: θ(τ) = A e^{-λτ} sin(ωτ), with
  // A·ω = arrive so the rate is continuous across the landing.
  const w = TAU * P.rockHz / scale, lam = P.rockDecay / scale;
  const rockA = arrive / w;

  const start = qmul(qmul(target, qaxis(a2, th2(0))), qaxis(a1, th1(0)));
  const correction = qmul(qconj(start), from);          // C(0)
  const blendEnd = T * 0.42;

  const at = (t) => {
    if (t >= T) {
      const tau = t - T;
      // The rock decays exponentially, which never quite reaches zero; a window
      // over the last 40% of the settle takes it the rest of the way, so the die
      // is exactly on its face at rest instead of snapping the last hair.
      const win = 1 - smooth((tau - settle * 0.6) / (settle * 0.4));
      const rock = tau >= settle ? 0 : rockA * Math.exp(-lam * tau) * Math.sin(w * tau) * win;
      const dip = tau >= settle ? 0 : -P.bounce * Math.exp(-lam * 1.4 * tau) * Math.sin(Math.min(Math.PI, tau * w * 0.9)) * win;
      return { q: qnorm(qmul(target, qaxis(a1, -rock))), lift: dip, scale: 1, rate: Math.abs(rockA * w * Math.exp(-lam * tau)) };
    }
    const tt = Math.max(0, t);
    const c = qslerp(correction, [0, 0, 0, 1], smooth(tt / blendEnd));
    const q = qnorm(qmul(qmul(qmul(target, qaxis(a2, th2(tt))), qaxis(a1, th1(tt))), c));
    // Rise towards the camera and fall back: a single smooth arc that lands at T.
    const u = tt / T;
    const arc = Math.sin(Math.PI * Math.min(1, u * 1.08)) * (1 - u * 0.15);
    return { q, lift: P.lift * Math.max(0, arc), scale: 1 + P.liftScale * Math.max(0, arc), rate: Math.hypot(r1(tt), r2(tt)) };
  };

  return { duration: T, settle, total: T + settle, at, axes: [a1, a2] };
}

/**
 * The hover before the throw: a slow precession about a tilted axis, so the
 * die is alive while the table waits. Pure in time, so a seek lands anywhere.
 */
export function idlePose(t, seed = 1) {
  const rand = rng(seed ^ 0x51ed);
  const axis = unit([0.35 + rand() * 0.2, 1, 0.2]);
  const wob = qaxis([1, 0, 0], Math.sin(t * 0.9) * 0.22);
  return { q: qnorm(qmul(wob, qaxis(axis, t * 0.55 + rand() * TAU))), lift: Math.sin(t * 1.3) * 0.04, scale: 1 };
}
