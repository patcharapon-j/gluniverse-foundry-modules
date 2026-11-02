/**
 * Spellglass — the floor patterns, one per function.
 *
 * Each recipe paints WHITE on a transparent square tile through a plain
 * CanvasRenderingContext2D; the renderer tints the tile with the material's
 * hot colour, so one baked tile serves every material. Every recipe is
 * seamless: anything that crosses the tile edge is painted at each of the
 * nine wrap offsets, and every periodic stroke has a whole number of repeats
 * per tile. A pattern that does not wrap draws a hard seam at the tile period
 * across the whole area, which reads as a grid that is not the rules grid.
 *
 * The marks are drawn fine on purpose. A pattern is a texture the eye reads
 * at a glance ("that is a net, that is a heal"), not a picture to study, and
 * a heavy one competes with the tokens standing on it. Every size below is a
 * fraction of the tile, so the tile can change resolution without a recipe
 * changing its look.
 *
 * Pure: no PIXI, no Foundry, no DOM lookup. The renderer, the GM swatches and
 * the preview page hand in the context, and `tools/pf2e-aoe-check.mjs` drives
 * every recipe against a recording context to prove each one paints.
 */

/** Tile edge in texels. A power of two, so it repeats in hardware with mips. */
export const TILE = 256;

/** Deterministic hash → [0, 1), so a tile is identical on every client. */
function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Paint `fn(dx, dy)` at the nine wrap offsets. */
function wrapped(S, fn) {
  for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) fn(dx, dy);
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** A long, thin, two-sided blade from (x, y) along angle `a`. */
function sliver(ctx, x, y, len, width, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const nx = -s * width / 2, ny = c * width / 2;
  ctx.beginPath();
  ctx.moveTo(x - c * len / 2, y - s * len / 2);
  ctx.lineTo(x + nx - c * len * 0.08, y + ny - s * len * 0.08);
  ctx.lineTo(x + c * len / 2, y + s * len / 2);
  ctx.lineTo(x - nx - c * len * 0.08, y - ny - s * len * 0.08);
  ctx.closePath();
  ctx.fill();
}

const RECIPES = {
  /* harm — thin blades thrown outward, with a scatter of sparks: impact. */
  shards(ctx, S) {
    const r = rand(11);
    const blades = Array.from({ length: 5 }, () => ({
      x: r() * S, y: r() * S, l: S * (0.16 + r() * 0.14), w: S * (0.026 + r() * 0.014),
      a: -Math.PI / 4 + (r() - 0.5) * 1.1, alpha: 0.55 + r() * 0.45,
    }));
    const sparks = Array.from({ length: 7 }, () => ({ x: r() * S, y: r() * S, s: S * (0.008 + r() * 0.008) }));
    wrapped(S, (dx, dy) => {
      for (const b of blades) {
        ctx.globalAlpha = b.alpha;
        sliver(ctx, b.x + dx, b.y + dy, b.l, b.w, b.a);
      }
      ctx.globalAlpha = 0.85;
      for (const s of sparks) dot(ctx, s.x + dx, s.y + dy, s.s);
    });
  },

  /* restore — small plus signs on a staggered lattice: aid. */
  cross(ctx, S) {
    const marks = [[0.25, 0.25, 0.1, 1], [0.75, 0.75, 0.1, 1], [0.75, 0.25, 0.065, 0.5], [0.25, 0.75, 0.065, 0.5]];
    const w = S * 0.022;
    for (const [x, y, arm, a] of marks) {
      ctx.globalAlpha = a;
      ctx.fillRect(x * S - arm * S, y * S - w / 2, arm * S * 2, w);
      ctx.fillRect(x * S - w / 2, y * S - arm * S, w, arm * S * 2);
    }
  },

  /* support — rising chevrons in two staggered rows: uplift. */
  chevron(ctx, S) {
    ctx.lineWidth = S * 0.022;
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    const rows = 2, per = 2, h = S * 0.075, w = S * 0.12;
    wrapped(S, (dx, dy) => {
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < per; i++) {
          const x = (i + 0.5 + (j % 2) * 0.5) * S / per + dx;
          const y = (j + 0.5) * S / rows + dy;
          for (const [k, a] of [[0, 1], [1, 0.45]]) {
            ctx.globalAlpha = (j % 2 ? 0.7 : 1) * a;
            const oy = k * h * 1.15;
            ctx.beginPath();
            ctx.moveTo(x - w, y + h / 2 + oy);
            ctx.lineTo(x, y - h / 2 + oy);
            ctx.lineTo(x + w, y + h / 2 + oy);
            ctx.stroke();
          }
        }
      }
    });
  },

  /* protect — overlapping shield scales. */
  scales(ctx, S) {
    const n = 2, cw = S / n, r = cw / 2;
    ctx.lineWidth = S * 0.016;
    wrapped(S, (dx, dy) => {
      for (let j = 0; j < n * 2; j++) {
        for (let i = 0; i < n; i++) {
          const x = (i + (j % 2) * 0.5) * cw + r + dx;
          const y = j * (S / (n * 2)) + dy;
          ctx.globalAlpha = 0.95;
          ctx.beginPath();
          ctx.arc(x, y, r * 0.92, 0, Math.PI);
          ctx.stroke();
          ctx.globalAlpha = 0.35;
          ctx.beginPath();
          ctx.arc(x, y, r * 0.62, Math.PI * 0.15, Math.PI * 0.85);
          ctx.stroke();
        }
      }
    });
  },

  /* hinder — sawtooth lines: drag. */
  zigzag(ctx, S) {
    const lines = 3, teeth = 4, amp = S * 0.045;
    ctx.lineWidth = S * 0.02;
    ctx.lineJoin = "miter";
    for (let j = 0; j < lines; j++) {
      const y = (j + 0.5) * S / lines;
      ctx.globalAlpha = j === 1 ? 1 : 0.5;
      ctx.beginPath();
      for (let k = -1; k <= teeth * 2 + 1; k++) {
        const x = k * S / (teeth * 2);
        const py = y + (k % 2 ? amp : -amp);
        if (k === -1) ctx.moveTo(x, py); else ctx.lineTo(x, py);
      }
      ctx.stroke();
    }
  },

  /* control — a knotted diamond net: binding. */
  net(ctx, S) {
    ctx.lineWidth = S * 0.014;
    ctx.globalAlpha = 0.85;
    wrapped(S, (dx, dy) => {
      for (const k of [0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(dx + k * S, dy);
        ctx.lineTo(dx + k * S + S, dy + S);
        ctx.moveTo(dx + k * S + S, dy);
        ctx.lineTo(dx + k * S, dy + S);
        ctx.stroke();
      }
    });
    ctx.globalAlpha = 1;
    wrapped(S, (dx, dy) => {
      for (const [x, y] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]]) {
        dot(ctx, x * S + dx, y * S + dy, S * 0.024);
      }
    });
  },

  /* conceal — drifting fog: soft banks and a fine stipple. */
  fog(ctx, S) {
    const r = rand(29);
    const blobs = Array.from({ length: 9 }, () => ({ x: r() * S, y: r() * S, s: S * (0.14 + r() * 0.16), a: 0.16 + r() * 0.2 }));
    const dots = Array.from({ length: 40 }, () => ({ x: r() * S, y: r() * S, s: S * (0.004 + r() * 0.008), a: 0.3 + r() * 0.5 }));
    wrapped(S, (dx, dy) => {
      for (const b of blobs) {
        const g = ctx.createRadialGradient(b.x + dx, b.y + dy, 0, b.x + dx, b.y + dy, b.s);
        g.addColorStop(0, `rgba(255,255,255,${b.a})`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.globalAlpha = 1;
        ctx.fillStyle = g;
        ctx.fillRect(b.x + dx - b.s, b.y + dy - b.s, b.s * 2, b.s * 2);
      }
      ctx.fillStyle = "#ffffff";
      for (const d of dots) {
        ctx.globalAlpha = d.a;
        dot(ctx, d.x + dx, d.y + dy, d.s);
      }
    });
  },

  /* terrain — laid cobbles: difficult ground. */
  cobble(ctx, S) {
    const rows = 3, per = 2, gap = S * 0.04;
    const rh = S / rows, cw = S / per;
    ctx.lineWidth = S * 0.014;
    wrapped(S, (dx, dy) => {
      const rr = rand(47);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < per; i++) {
          const jitter = (rr() - 0.5) * cw * 0.18;
          const x = i * cw + (j % 2) * cw * 0.5 + dx + gap + jitter * 0.3;
          const y = j * rh + dy + gap;
          const w = cw - gap * 2, h = rh - gap * 2;
          const k = Math.min(w, h) * 0.34;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.moveTo(x + k, y);
          ctx.lineTo(x + w - k, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + k);
          ctx.lineTo(x + w, y + h - k);
          ctx.quadraticCurveTo(x + w, y + h, x + w - k, y + h);
          ctx.lineTo(x + k, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - k);
          ctx.lineTo(x, y + k);
          ctx.quadraticCurveTo(x, y, x + k, y);
          ctx.stroke();
          ctx.globalAlpha = 0.1;
          ctx.fill();
        }
      }
    });
  },

  /* detect — scan lines with ringed blips. */
  scan(ctx, S) {
    const lines = 8;
    for (let j = 0; j < lines; j++) {
      const major = j % 4 === 0;
      ctx.globalAlpha = major ? 0.9 : 0.32;
      ctx.fillRect(0, j * S / lines, S, major ? S * 0.012 : S * 0.006);
    }
    const r = rand(61);
    const blips = Array.from({ length: 3 }, () => ({ x: r() * S, y: r() * S }));
    ctx.lineWidth = S * 0.01;
    wrapped(S, (dx, dy) => {
      for (const b of blips) {
        ctx.globalAlpha = 1;
        dot(ctx, b.x + dx, b.y + dy, S * 0.012);
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(b.x + dx, b.y + dy, S * 0.04, 0, Math.PI * 2);
        ctx.stroke();
      }
    });
  },

  /* summon — a ticked rune circle: a gate. */
  sigil(ctx, S) {
    const c = S / 2, R = S * 0.3;
    ctx.lineWidth = S * 0.014;
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(c, c, R * 0.64, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const long = i % 2 === 0;
      const reach = long ? 1.2 : 1.1;
      ctx.globalAlpha = long ? 1 : 0.55;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
      ctx.lineTo(c + Math.cos(a) * R * reach, c + Math.sin(a) * R * reach);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    dot(ctx, c, c, S * 0.022);
    wrapped(S, (dx, dy) => {
      ctx.globalAlpha = 0.6;
      dot(ctx, dx, dy, S * 0.014);
    });
  },

  /* hazard — warning tape: wide 45° bands at 50% duty. Loud on purpose. */
  tape(ctx, S) {
    const bands = 2, p = S / bands;
    ctx.globalAlpha = 1;
    wrapped(S, (dx, dy) => {
      for (let k = -bands; k <= bands; k++) {
        const o = k * p;
        ctx.beginPath();
        ctx.moveTo(dx + o, dy + S);
        ctx.lineTo(dx + o + p / 2, dy + S);
        ctx.lineTo(dx + o + p / 2 + S, dy);
        ctx.lineTo(dx + o + S, dy);
        ctx.closePath();
        ctx.fill();
      }
    });
  },

  /* neutral — an instrument's dot grid. */
  dots(ctx, S) {
    const n = 4;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        ctx.globalAlpha = (i + j) % 2 ? 0.5 : 1;
        dot(ctx, (i + 0.5) * S / n, (j + 0.5) * S / n, S * 0.016);
      }
    }
  },

  /* blocked squares — the oldest "no line of effect" mark there is. */
  hatch(ctx, S) {
    ctx.lineWidth = S * 0.022;
    ctx.globalAlpha = 1;
    wrapped(S, (dx, dy) => {
      for (let k = 0; k < 4; k++) {
        const o = k * S / 4;
        ctx.beginPath();
        ctx.moveTo(dx + o, dy + S);
        ctx.lineTo(dx + o + S, dy);
        ctx.stroke();
      }
    });
  },
};

export const PATTERN_IDS = Object.freeze(Object.keys(RECIPES));

/** Paint pattern `id` into `ctx` as a size × size white-on-clear tile. */
export function paintPattern(ctx, id, size = TILE) {
  const recipe = RECIPES[id] ?? RECIPES.dots;
  ctx.save();
  ctx.clearRect(0, 0, size, size);
  ctx.beginPath();
  ctx.rect(0, 0, size, size);
  ctx.clip();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = "#ffffff";
  recipe(ctx, size);
  ctx.restore();
}
