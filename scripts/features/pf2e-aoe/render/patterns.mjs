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
 * Pure: no PIXI, no Foundry, no DOM lookup. The renderer and the preview page
 * hand in the context, and `tools/pf2e-aoe-check.mjs` drives every recipe
 * against a recording context to prove each one paints.
 */

export const TILE = 128;

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

function star(ctx, x, y, r, points, inner, rot) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + i * Math.PI / points;
    const k = i % 2 ? r * inner : r;
    const px = x + Math.cos(a) * k, py = y + Math.sin(a) * k;
    if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

const RECIPES = {
  /* harm — scattered jagged starbursts and slash streaks: impact. */
  shards(ctx, S) {
    const r = rand(11);
    const bursts = Array.from({ length: 5 }, () => ({
      x: r() * S, y: r() * S, s: S * (0.07 + r() * 0.07), rot: r() * Math.PI, n: 4 + Math.floor(r() * 3),
    }));
    const slashes = Array.from({ length: 6 }, () => ({ x: r() * S, y: r() * S, l: S * (0.10 + r() * 0.10) }));
    ctx.lineCap = "round";
    wrapped(S, (dx, dy) => {
      ctx.globalAlpha = 1;
      for (const b of bursts) star(ctx, b.x + dx, b.y + dy, b.s, b.n, 0.32, b.rot);
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = S * 0.022;
      for (const s of slashes) {
        ctx.beginPath();
        ctx.moveTo(s.x + dx - s.l * 0.5, s.y + dy + s.l * 0.5);
        ctx.lineTo(s.x + dx + s.l * 0.5, s.y + dy - s.l * 0.5);
        ctx.stroke();
      }
    });
  },

  /* restore — plus signs on a staggered grid: aid. */
  cross(ctx, S) {
    const arm = S * 0.13, w = S * 0.05;
    const marks = [[S * 0.25, S * 0.25, 1], [S * 0.75, S * 0.75, 1], [S * 0.75, S * 0.25, 0.45], [S * 0.25, S * 0.75, 0.45]];
    wrapped(S, (dx, dy) => {
      for (const [x, y, a] of marks) {
        ctx.globalAlpha = a;
        ctx.fillRect(x + dx - arm, y + dy - w / 2, arm * 2, w);
        ctx.fillRect(x + dx - w / 2, y + dy - arm, w, arm * 2);
      }
    });
  },

  /* support — rising chevrons: uplift. */
  chevron(ctx, S) {
    ctx.lineWidth = S * 0.05;
    ctx.lineJoin = "miter";
    ctx.lineCap = "butt";
    const rows = 2, per = 2, h = S * 0.12, w = S * 0.18;
    wrapped(S, (dx, dy) => {
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < per; i++) {
          const x = (i + 0.5 + (j % 2) * 0.5) * S / per + dx;
          const y = (j + 0.5) * S / rows + dy;
          ctx.globalAlpha = j % 2 ? 0.6 : 1;
          ctx.beginPath();
          ctx.moveTo(x - w, y + h / 2);
          ctx.lineTo(x, y - h / 2);
          ctx.lineTo(x + w, y + h / 2);
          ctx.stroke();
        }
      }
    });
  },

  /* protect — overlapping shield scales. */
  scales(ctx, S) {
    const n = 2, cw = S / n, r = cw / 2;
    ctx.lineWidth = S * 0.03;
    wrapped(S, (dx, dy) => {
      for (let j = 0; j < n * 2; j++) {
        for (let i = 0; i < n; i++) {
          const x = (i + (j % 2) * 0.5) * cw + r + dx;
          const y = j * (S / (n * 2)) + dy;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(x, y, r * 0.92, 0, Math.PI);
          ctx.stroke();
          ctx.globalAlpha = 0.22;
          ctx.beginPath();
          ctx.arc(x, y, r * 0.55, 0, Math.PI);
          ctx.fill();
        }
      }
    });
  },

  /* hinder — sawtooth zigzags: drag. */
  zigzag(ctx, S) {
    const lines = 3, teeth = 4, amp = S * 0.06;
    ctx.lineWidth = S * 0.045;
    ctx.lineJoin = "miter";
    for (let j = 0; j < lines; j++) {
      const y = (j + 0.5) * S / lines;
      ctx.globalAlpha = j === 1 ? 1 : 0.65;
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
    ctx.lineWidth = S * 0.028;
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
        ctx.beginPath();
        ctx.arc(x * S + dx, y * S + dy, S * 0.035, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  },

  /* conceal — drifting fog: soft blobs and stipple. */
  fog(ctx, S) {
    const r = rand(29);
    const blobs = Array.from({ length: 9 }, () => ({ x: r() * S, y: r() * S, s: S * (0.12 + r() * 0.16), a: 0.18 + r() * 0.22 }));
    const dots = Array.from({ length: 70 }, () => ({ x: r() * S, y: r() * S, s: S * (0.006 + r() * 0.014), a: 0.35 + r() * 0.6 }));
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
        ctx.beginPath();
        ctx.arc(d.x + dx, d.y + dy, d.s, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  },

  /* terrain — laid cobbles: difficult ground. */
  cobble(ctx, S) {
    const rows = 3, per = 2, gap = S * 0.035;
    const rh = S / rows, cw = S / per;
    ctx.lineWidth = S * 0.026;
    wrapped(S, (dx, dy) => {
      const rr = rand(47);
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < per; i++) {
          const jitter = (rr() - 0.5) * cw * 0.18;
          const x = i * cw + (j % 2) * cw * 0.5 + dx + gap + jitter * 0.3;
          const y = j * rh + dy + gap;
          const w = cw - gap * 2, h = rh - gap * 2;
          const k = Math.min(w, h) * 0.32;
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
          ctx.globalAlpha = 0.14;
          ctx.fill();
        }
      }
    });
  },

  /* detect — scan lines with blips. */
  scan(ctx, S) {
    const lines = 8;
    for (let j = 0; j < lines; j++) {
      ctx.globalAlpha = j % 4 === 0 ? 0.95 : 0.4;
      ctx.fillRect(0, j * S / lines, S, j % 4 === 0 ? S * 0.03 : S * 0.014);
    }
    const r = rand(61);
    const blips = Array.from({ length: 4 }, () => ({ x: r() * S, y: r() * S }));
    wrapped(S, (dx, dy) => {
      ctx.globalAlpha = 1;
      for (const b of blips) {
        ctx.beginPath();
        ctx.arc(b.x + dx, b.y + dy, S * 0.025, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  },

  /* summon — rune circles: a gate. */
  sigil(ctx, S) {
    const c = S / 2, R = S * 0.3;
    ctx.lineWidth = S * 0.028;
    ctx.globalAlpha = 1;
    ctx.beginPath(); ctx.arc(c, c, R, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.55;
    ctx.beginPath(); ctx.arc(c, c, R * 0.62, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.beginPath();
      ctx.moveTo(c + Math.cos(a) * R * 0.62, c + Math.sin(a) * R * 0.62);
      ctx.lineTo(c + Math.cos(a) * R * 1.18, c + Math.sin(a) * R * 1.18);
      ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(c, c, S * 0.04, 0, Math.PI * 2); ctx.fill();
    wrapped(S, (dx, dy) => {
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.arc(dx, dy, S * 0.03, 0, Math.PI * 2); ctx.fill();
    });
  },

  /* hazard — warning tape: wide 45° bands at 50% duty. */
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
        ctx.globalAlpha = (i + j) % 2 ? 0.55 : 1;
        ctx.beginPath();
        ctx.arc((i + 0.5) * S / n, (j + 0.5) * S / n, S * 0.022, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  },

  /* blocked squares — the oldest "no line of effect" mark there is. */
  hatch(ctx, S) {
    ctx.lineWidth = S * 0.035;
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

/** Paint pattern `id` into `ctx` as a TILE × TILE white-on-clear tile. */
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
