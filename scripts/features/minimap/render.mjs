/**
 * GLUniverse Suite — Minimap SVG renderer.
 *
 * Renders a published/draft snapshot into a host element as a single inline
 * `<svg>` living in a fixed logical coordinate space (snapshot.w × snapshot.h),
 * with pan/zoom expressed purely through the viewBox. An HTML overlay layer on
 * top carries crisp etched-glass tooltips. The renderer owns the visual
 * vocabulary (rooms / connectors / labels / icons / markers), the ping & beacon
 * FX, and the broadcast diff animation (tween moved markers + trail, draw in
 * additions, fade removals, highlight changes).
 *
 * It is intentionally UI-framework-free: both the floating viewer and the Map
 * Studio mount one of these and layer their own interaction on top.
 */

import {
  MAP_W, MAP_H, PING_TTL_MS, ATTENTION_TTL_MS, SCALE_MIN, SCALE_MAX,
  DEFAULT_MARKER_COLOR, DEFAULT_ROOM_COLOR, DEFAULT_ELEMENT_COLOR, DEFAULT_PARTY_COLOR,
  PARTY_GLYPH, SCRAMBLE_GLYPHS, safeIconClass
} from "./const.mjs";

const SVGNS = "http://www.w3.org/2000/svg";

/**
 * Per-character "decoder" reveal: each glyph cycles through random characters
 * then locks in, staggered left→right, so text scrambles into place. Works on
 * any node with textContent (HTML or SVG <text>). Returns a cancel fn.
 */
export function scrambleText(node, finalText, { dur = 820, settle = 0.55 } = {}) {
  if (!node) return () => {};
  const text = String(finalText ?? "");
  const n = text.length;
  if (!n) { node.textContent = ""; return () => {}; }
  // Each char reveals across [start, end] of normalised progress.
  const spans = [];
  for (let i = 0; i < n; i++) {
    const start = (i / n) * (1 - settle);
    spans.push([start, start + settle]);
  }
  let raf = 0;
  let t0 = 0;
  const pick = () => SCRAMBLE_GLYPHS[(Math.random() * SCRAMBLE_GLYPHS.length) | 0];
  const step = (now) => {
    if (!t0) t0 = now;
    const p = Math.min(1, (now - t0) / dur);
    let out = "";
    for (let i = 0; i < n; i++) {
      const ch = text[i];
      if (ch === " " || ch === "\n") { out += ch; continue; }
      const [s, e] = spans[i];
      out += p >= e ? ch : pick();
    }
    node.textContent = out;
    if (p < 1) raf = requestAnimationFrame(step);
    else node.textContent = text;
  };
  raf = requestAnimationFrame(step);
  return () => { cancelAnimationFrame(raf); node.textContent = text; };
}

/** Tiny SVG element builder. `text` sets textContent; everything else is an attr. */
function S(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "class") n.setAttribute("class", v);
    else if (k === "text") n.textContent = v;
    else n.setAttribute(k, String(v));
  }
  for (const kid of kids) if (kid) n.appendChild(kid);
  return n;
}

function H(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

/** Clamp the camera scale (pixels per logical unit). */
const clampScale = (z) => Math.max(SCALE_MIN, Math.min(SCALE_MAX, z || 1));

/** Monotonic id so concurrent renderers (viewer + studio) get unique <defs>. */
let RID = 0;

export class MapRenderer {
  /**
   * @param {HTMLElement} host         container (must allow position:relative)
   * @param {object} opts
   *   isGM, interactive (hover tooltips), showGhosts (render hidden els ghosted),
   *   onHover(el|null)
   */
  constructor(host, opts = {}) {
    this.host = host;
    this.opts = opts;
    this.snapshot = null;
    this.ghosts = [];
    // zoom is a true scale: pixels per logical unit (set properly by fit()).
    this.view = { pan: { x: MAP_W / 2, y: MAP_H / 2 }, zoom: 0.5 };
    this._viewAnim = null;
    this._refitPending = false;
    this._rid = ++RID; // unique suffix for in-document <defs> ids
    this._nodes = new Map(); // element id -> rendered group node
    this._build();
  }

  /* --------------------------------- DOM --------------------------------- */

  _build() {
    this.host.classList.add("glmm-stage");
    const svg = S("svg", { class: "glmm-svg", viewBox: `0 0 ${MAP_W} ${MAP_H}`, preserveAspectRatio: "xMidYMid meet" });
    const uid = this._rid;

    // A centred vignette + a two-level blueprint grid live in <defs>. The cover
    // rects below are re-sized to the live viewBox each frame so the backdrop is
    // seamless no matter where the endless canvas is panned.
    const defs = S("defs");
    const vign = S("radialGradient", { id: `glmm-vign-${uid}`, cx: "50%", cy: "42%", r: "75%" });
    vign.appendChild(S("stop", { offset: "0%", "stop-color": "#0c1422" }));
    vign.appendChild(S("stop", { offset: "58%", "stop-color": "#080d16" }));
    vign.appendChild(S("stop", { offset: "100%", "stop-color": "#04070d" }));
    defs.appendChild(vign);
    const minor = S("pattern", { id: `glmm-grid-${uid}`, width: 50, height: 50, patternUnits: "userSpaceOnUse" });
    minor.appendChild(S("path", { d: "M 50 0 L 0 0 0 50", fill: "none", stroke: "rgba(120,180,255,0.055)", "stroke-width": 1 }));
    defs.appendChild(minor);
    const major = S("pattern", { id: `glmm-grid-maj-${uid}`, width: 250, height: 250, patternUnits: "userSpaceOnUse" });
    major.appendChild(S("path", { d: "M 250 0 L 0 0 0 250", fill: "none", stroke: "rgba(120,180,255,0.10)", "stroke-width": 1.5 }));
    defs.appendChild(major);
    svg.appendChild(defs);

    const bg = S("rect", { class: "glmm-bg", fill: `url(#glmm-vign-${uid})` });
    const gMinor = S("rect", { class: "glmm-gridfill", fill: `url(#glmm-grid-${uid})` });
    const gMajor = S("rect", { class: "glmm-gridfill glmm-gridfill-maj", fill: `url(#glmm-grid-maj-${uid})` });
    svg.append(bg, gMinor, gMajor);
    this._coverRects = [bg, gMinor, gMajor];

    // Paint order: rooms < connectors < icons/labels < markers < fx
    this.layers = {
      rooms: S("g", { class: "glmm-l-rooms" }),
      connectors: S("g", { class: "glmm-l-connectors" }),
      annot: S("g", { class: "glmm-l-annot" }),
      markers: S("g", { class: "glmm-l-markers" }),
      fx: S("g", { class: "glmm-l-fx" })
    };
    for (const g of Object.values(this.layers)) svg.appendChild(g);

    const overlay = H("div", "glmm-html-fx");
    const tip = H("div", "glmm-tip");
    tip.style.display = "none";
    overlay.appendChild(tip);

    this.host.replaceChildren(svg, overlay);
    this.svg = svg;
    this.overlay = overlay;
    this.tip = tip;

    // The viewBox is derived from the host's pixel size, so re-derive it whenever
    // the host resizes (window morph, drag-resize, studio window resize).
    try {
      this._ro = new ResizeObserver(() => { if (this._refitPending) this.fit(); else this.applyView(); });
      this._ro.observe(this.host);
    } catch { /* ResizeObserver unavailable — applyView still runs on demand */ }
  }

  destroy() {
    if (this._viewAnim) cancelAnimationFrame(this._viewAnim);
    this._viewAnim = null;
    this._ro?.disconnect();
    this._ro = null;
  }

  /* ----------------------------- view / camera --------------------------- */

  mapW() { return this.snapshot?.w ?? MAP_W; }
  mapH() { return this.snapshot?.h ?? MAP_H; }

  /** Host pixel size; (0,0) until the element has been laid out. */
  _hostSize() { return { w: this.host.clientWidth || 0, h: this.host.clientHeight || 0 }; }

  /**
   * Derive the viewBox from the host's pixel size, the camera centre (pan) and
   * the scale (pixels per logical unit). Because the viewBox aspect ratio always
   * matches the container, nothing is letterboxed and the canvas is effectively
   * endless — square, wide and tall maps all behave identically. Pan is *not*
   * clamped: the camera can roam anywhere.
   */
  applyView() {
    const { w: pw, h: ph } = this._hostSize();
    if (!pw || !ph) return; // not laid out yet — the ResizeObserver re-runs us
    const scale = clampScale(this.view.zoom);
    this.view.zoom = scale;
    const vw = pw / scale, vh = ph / scale;
    const cx = this.view.pan?.x ?? 0, cy = this.view.pan?.y ?? 0;
    const vx = cx - vw / 2, vy = cy - vh / 2;
    this.svg.setAttribute("viewBox", `${vx} ${vy} ${vw} ${vh}`);
    for (const r of this._coverRects ?? []) {
      r.setAttribute("x", vx); r.setAttribute("y", vy);
      r.setAttribute("width", vw); r.setAttribute("height", vh);
    }
    this._syncTip();
  }

  setView(pan, zoom) {
    if (pan) this.view.pan = { ...pan };
    if (zoom != null) this.view.zoom = clampScale(zoom);
    this.applyView();
  }

  /** The logical bounding box of everything drawn (or the nominal frame when the
   *  map is empty). This is what "fit" frames, so the map's apparent shape simply
   *  follows its content. */
  contentBounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const consider = (b) => {
      if (!b) return;
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    };
    for (const el of this.snapshot?.elements ?? []) consider(this._elBounds(el));
    for (const el of this.ghosts ?? []) consider(this._elBounds(el));
    if (!isFinite(minX)) return { x: 0, y: 0, w: this.mapW(), h: this.mapH() };
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  /** Approximate logical bounding box of a single element (label/glyph extents
   *  are estimated; fit padding absorbs the slack). */
  _elBounds(el) {
    if (!el || !el.type) return null;
    if (el.type === "room" && el.shape !== "polygon") {
      return { x: el.x ?? 0, y: el.y ?? 0, w: el.w ?? 100, h: el.h ?? 100 };
    }
    if ((el.type === "room" && el.shape === "polygon") || el.type === "connector") {
      const pts = el.points ?? [];
      if (!pts.length) return null;
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
    if (el.type === "label") {
      const sz = el.size ?? 26, len = String(el.text ?? el.label ?? "").length || 1;
      const w = len * sz * 0.6, h = sz * 1.3;
      return { x: (el.x ?? 0) - w / 2, y: (el.y ?? 0) - h / 2, w, h };
    }
    if (el.type === "icon") {
      const sz = (el.size ?? 40) * 1.1;
      return { x: (el.x ?? 0) - sz, y: (el.y ?? 0) - sz, w: sz * 2, h: sz * 2.2 };
    }
    // marker
    const r = (el.r ?? 16) * 2.2;
    return { x: (el.x ?? 0) - r, y: (el.y ?? 0) - r, w: r * 2, h: r * 2.4 };
  }

  /** Frame all content (or the nominal frame) with breathing room. A minimum
   *  framed span keeps a sparse map (a lone marker) from filling the screen. */
  fit(pad = 1.16) {
    const b = this.contentBounds();
    const MIN = 480;
    let { x, y, w, h } = b;
    if (w < MIN) { x -= (MIN - w) / 2; w = MIN; }
    if (h < MIN) { y -= (MIN - h) / 2; h = MIN; }
    this.view.pan = { x: x + w / 2, y: y + h / 2 };
    const { w: pw, h: ph } = this._hostSize();
    if (!pw || !ph) { this._refitPending = true; return; }
    this._refitPending = false;
    this.view.zoom = clampScale(Math.min(pw / (w * pad), ph / (h * pad)));
    this.applyView();
  }

  /** Scale (px/unit) at which a logical span fills the corresponding viewport
   *  dimension — used to focus on a marker / a change region. */
  scaleForSpan(spanX, spanY = spanX) {
    const { w, h } = this._hostSize();
    if (!w || !h || !spanX || !spanY) return this.view.zoom;
    return clampScale(Math.min(w / spanX, h / spanY));
  }

  /** Smoothly glide the camera to a target pan/zoom (ease-in-out for a calm,
   *  un-snappy feel even on long glides). */
  animateView(pan, zoom, dur = 760) {
    if (this._viewAnim) cancelAnimationFrame(this._viewAnim);
    const from = { x: this.view.pan.x, y: this.view.pan.y, z: this.view.zoom };
    const to = { x: pan?.x ?? from.x, y: pan?.y ?? from.y, z: clampScale(zoom ?? from.z) };
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const k = ease(t);
      this.view.pan = { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k };
      this.view.zoom = from.z + (to.z - from.z) * k;
      this.applyView();
      if (t < 1) this._viewAnim = requestAnimationFrame(step);
      else this._viewAnim = null;
    };
    this._viewAnim = requestAnimationFrame(step);
  }

  zoomBy(factor, centerLogical) {
    const z = clampScale(this.view.zoom * factor);
    if (centerLogical) this.view.pan = { ...centerLogical };
    this.view.zoom = z;
    this.applyView();
  }

  /** Zoom while keeping the logical point under (clientX, clientY) stationary. */
  zoomAt(factor, clientX, clientY) {
    const before = this.toLogical(clientX, clientY);
    this.view.zoom = clampScale(this.view.zoom * factor);
    this.applyView();
    const after = this.toLogical(clientX, clientY);
    this.view.pan = { x: this.view.pan.x + (before.x - after.x), y: this.view.pan.y + (before.y - after.y) };
    this.applyView();
  }

  /** Drag-pan: keep `grabLogical` pinned under the cursor at (clientX, clientY). */
  panGrab(grabLogical, clientX, clientY) {
    const L = this.toLogical(clientX, clientY);
    this.view.pan = { x: this.view.pan.x + (grabLogical.x - L.x), y: this.view.pan.y + (grabLogical.y - L.y) };
    this.applyView();
  }

  /** Client coords → logical map coords (accounts for viewBox + letterboxing). */
  toLogical(clientX, clientY) {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
    return { x: pt.x, y: pt.y };
  }

  /** Logical map coords → client (screen) coords. */
  toScreen(x, y) {
    const ctm = this.svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = new DOMPoint(x, y).matrixTransform(ctm);
    return { x: pt.x, y: pt.y };
  }

  /* ------------------------------ rendering ------------------------------ */

  resolveMarker(el) {
    if (el.kind === "party") {
      const color = el.color || DEFAULT_PARTY_COLOR;
      const name = (el.label && el.label.trim()) || game.i18n?.localize?.("GLMM.legend.party") || "Party";
      return { color, name, isSelf: false, isParty: true, user: null };
    }
    const user = el.userId ? game.users?.get(el.userId) : null;
    let color = el.color;
    if (user?.color) color = user.color.css ?? (typeof user.color === "string" ? user.color : color);
    color ||= DEFAULT_MARKER_COLOR;
    const name = (el.label && el.label.trim()) || user?.name || "";
    const isSelf = !!user && user.id === game.user?.id;
    return { color, name, isSelf, isParty: false, user };
  }

  setSnapshot(snapshot, { ghosts = [] } = {}) {
    this.snapshot = snapshot ? foundry.utils.deepClone(snapshot) : null;
    this.ghosts = ghosts ?? [];
    this._renderAll();
    this.applyView(); // keeps the current camera; the viewer/studio call fit() on first show
  }

  _renderAll() {
    for (const g of [this.layers.rooms, this.layers.connectors, this.layers.annot, this.layers.markers]) g.replaceChildren();
    this._nodes.clear();
    this.hideTip();

    if (!this.snapshot) return;

    // GM ghosts (hidden elements) render dimmed beneath everything else.
    for (const el of this.ghosts) this._mount(this._renderElement(el, true));
    for (const el of this.snapshot.elements ?? []) this._mount(this._renderElement(el, false));
  }

  _mount(node) {
    if (!node) return;
    const layer = node.dataset.layer;
    (this.layers[layer] ?? this.layers.annot).appendChild(node);
    this._nodes.set(node.dataset.id, node);
  }

  nodeFor(id) { return this._nodes.get(id) ?? null; }

  _renderElement(el, ghost) {
    if (!el || !el.type) return null;
    let node;
    switch (el.type) {
      case "room": node = this._room(el); break;
      case "connector": node = this._connector(el); break;
      case "label": node = this._label(el); break;
      case "icon": node = this._icon(el); break;
      case "marker": node = this._marker(el); break;
      default: return null;
    }
    if (!node) return null;
    node.dataset.id = el.id;
    node.dataset.type = el.type;
    node.classList.add("glmm-el");
    if (ghost) node.classList.add("is-ghost");
    if (this.opts.interactive) this._wireHover(node, el, ghost);
    return node;
  }

  _room(el) {
    const color = el.color || DEFAULT_ROOM_COLOR;
    const g = S("g", { class: "glmm-room", style: `--c:${color}` });
    g.dataset.layer = "rooms";
    let shapeEl, cx, cy;
    if (el.shape === "ellipse") {
      const rx = (el.w ?? 100) / 2, ry = (el.h ?? 100) / 2;
      cx = (el.x ?? 0) + rx; cy = (el.y ?? 0) + ry;
      shapeEl = S("ellipse", { class: "glmm-room-shape", cx, cy, rx, ry });
    } else if (el.shape === "polygon" && Array.isArray(el.points) && el.points.length > 2) {
      const pts = el.points.map((p) => `${p.x},${p.y}`).join(" ");
      shapeEl = S("polygon", { class: "glmm-room-shape", points: pts });
      const n = el.points.length;
      const c = el.points.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
      cx = c.x / n; cy = c.y / n;
    } else {
      cx = (el.x ?? 0) + (el.w ?? 100) / 2; cy = (el.y ?? 0) + (el.h ?? 100) / 2;
      shapeEl = S("rect", { class: "glmm-room-shape", x: el.x ?? 0, y: el.y ?? 0, width: el.w ?? 100, height: el.h ?? 100, rx: 10 });
    }
    g.appendChild(shapeEl);
    if (el.label) {
      g.appendChild(S("text", { class: "glmm-room-label", x: cx, y: cy, "text-anchor": "middle", "dominant-baseline": "central", text: el.label }));
    }
    return g;
  }

  _connector(el) {
    const color = el.color || DEFAULT_ELEMENT_COLOR;
    const pts = (el.points ?? []).map((p) => `${p.x},${p.y}`).join(" ");
    const g = S("g", { class: "glmm-connector" + (el.dashed ? " is-dashed" : ""), style: `--c:${color}` });
    g.dataset.layer = "connectors";
    g.appendChild(S("polyline", { class: "glmm-conn-line", points: pts, fill: "none" }));
    return g;
  }

  _label(el) {
    const color = el.color || "#f3fbff";
    const g = S("g", { class: "glmm-label", style: `--c:${color}` });
    g.dataset.layer = "annot";
    g.appendChild(S("text", {
      class: "glmm-label-text", x: el.x ?? 0, y: el.y ?? 0,
      "text-anchor": "middle", "dominant-baseline": "central",
      "font-size": el.size ?? 26, text: el.text ?? el.label ?? ""
    }));
    return g;
  }

  _icon(el) {
    const color = el.color || DEFAULT_ELEMENT_COLOR;
    const size = el.size ?? 40;
    const x = el.x ?? 0, y = el.y ?? 0;
    const g = S("g", { class: "glmm-icon", style: `--c:${color}` });
    g.dataset.layer = "annot";
    g.appendChild(S("circle", { class: "glmm-icon-disc", cx: x, cy: y, r: size * 0.7 }));
    const fo = S("foreignObject", { x: x - size / 2, y: y - size / 2, width: size, height: size });
    const wrap = H("div", "glmm-icon-glyph");
    const i = H("i");
    i.className = safeIconClass(el.icon);
    i.style.fontSize = `${size * 0.62}px`;
    wrap.appendChild(i);
    fo.appendChild(wrap);
    g.appendChild(fo);
    if (el.label) {
      g.appendChild(S("text", { class: "glmm-icon-label", x, y: y + size * 0.95, "text-anchor": "middle", text: el.label }));
    }
    return g;
  }

  _marker(el) {
    if (el.kind === "party") return this._partyMarker(el);
    const { color, name, isSelf } = this.resolveMarker(el);
    const x = el.x ?? 0, y = el.y ?? 0, r = el.r ?? 16;
    const g = S("g", { class: "glmm-marker" + (isSelf ? " is-self" : ""), style: `--c:${color}` });
    g.dataset.layer = "markers";
    g.appendChild(S("circle", { class: "glmm-marker-halo", cx: x, cy: y, r: r * 2.1 }));
    g.appendChild(S("circle", { class: "glmm-marker-ring", cx: x, cy: y, r: r * 1.35 }));
    g.appendChild(S("circle", { class: "glmm-marker-dot", cx: x, cy: y, r }));
    if (name) {
      g.appendChild(S("text", { class: "glmm-marker-name", x, y: y - r * 1.9, "text-anchor": "middle", text: name }));
    }
    return g;
  }

  /** A single badge standing in for the whole party — a glyph disc, not a dot. */
  _partyMarker(el) {
    const { color, name } = this.resolveMarker(el);
    const x = el.x ?? 0, y = el.y ?? 0, r = el.r ?? 20;
    const g = S("g", { class: "glmm-marker glmm-party", style: `--c:${color}` });
    g.dataset.layer = "markers";
    g.appendChild(S("circle", { class: "glmm-marker-halo", cx: x, cy: y, r: r * 2.3 }));
    g.appendChild(S("circle", { class: "glmm-party-ring", cx: x, cy: y, r: r * 1.5 }));
    g.appendChild(S("circle", { class: "glmm-party-disc", cx: x, cy: y, r: r * 1.05 }));
    const sz = r * 1.35;
    const fo = S("foreignObject", { x: x - sz / 2, y: y - sz / 2, width: sz, height: sz });
    const wrap = H("div", "glmm-icon-glyph glmm-party-glyph");
    const i = H("i");
    i.className = safeIconClass(PARTY_GLYPH);
    i.style.fontSize = `${sz * 0.6}px`;
    wrap.appendChild(i);
    fo.appendChild(wrap);
    g.appendChild(fo);
    if (name) {
      g.appendChild(S("text", { class: "glmm-marker-name", x, y: y - r * 2.05, "text-anchor": "middle", text: name }));
    }
    return g;
  }

  /** The primary text node of a rendered element (for the decoder reveal). */
  _textNodeOf(node) {
    return node?.querySelector?.(".glmm-marker-name, .glmm-room-label, .glmm-icon-label, .glmm-label-text") ?? null;
  }

  /** Scramble-in every visible text node — used when a map first appears. */
  revealText() {
    for (const node of this._nodes.values()) {
      const t = this._textNodeOf(node);
      if (t && t.textContent) scrambleText(t, t.textContent, { dur: 760 });
    }
  }

  /** Stagger an enter animation across all elements (a calm cascade on load). */
  revealAll() {
    let i = 0;
    for (const node of this._nodes.values()) {
      node.classList.remove("glmm-enter");
      void node.getBoundingClientRect();
      node.style.setProperty("--gl-delay", `${Math.min(i * 45, 520)}ms`);
      node.classList.add("glmm-enter");
      const t = this._textNodeOf(node);
      if (t && t.textContent) scrambleText(t, t.textContent, { dur: 720 });
      i++;
    }
    setTimeout(() => {
      for (const node of this._nodes.values()) { node.classList.remove("glmm-enter"); node.style.removeProperty("--gl-delay"); }
    }, 1100);
  }

  /* ------------------------------- tooltips ------------------------------ */

  _wireHover(node, el, ghost) {
    node.addEventListener("pointerenter", (ev) => {
      const title = el.type === "label" ? (el.text ?? el.label) : (this.resolveMarker?.(el)?.name || el.label);
      const note = el.note || (this.opts.isGM ? el.noteGM : "");
      if (!title && !note) return;
      this.showTip(title, note, ev.clientX, ev.clientY, ghost);
      this.opts.onHover?.(el);
    });
    node.addEventListener("pointerleave", () => { this.hideTip(); this.opts.onHover?.(null); });
  }

  showTip(title, note, clientX, clientY, ghost) {
    const t = this.tip;
    t.replaceChildren();
    if (title) t.appendChild(H("div", "glmm-tip-title", title));
    if (note) t.appendChild(H("div", "glmm-tip-note", note));
    if (ghost) t.appendChild(H("div", "glmm-tip-flag", game.i18n.localize("GLMM.tip.hidden")));
    t.style.display = "";
    t.classList.add("is-in");
    this._tipAt = { clientX, clientY };
    this._syncTip();
  }

  _syncTip() {
    if (!this._tipAt || this.tip.style.display === "none") return;
    const host = this.host.getBoundingClientRect();
    let left = this._tipAt.clientX - host.left + 14;
    let top = this._tipAt.clientY - host.top + 14;
    left = Math.min(left, host.width - this.tip.offsetWidth - 8);
    top = Math.min(top, host.height - this.tip.offsetHeight - 8);
    this.tip.style.left = `${Math.max(6, left)}px`;
    this.tip.style.top = `${Math.max(6, top)}px`;
  }

  hideTip() {
    this._tipAt = null;
    this.tip.classList.remove("is-in");
    this.tip.style.display = "none";
  }

  /* --------------------------------- FX ---------------------------------- */

  /** Animated ripple + who-pinged label at a logical point. */
  ping(x, y, { color = "#5eeaff", name = "" } = {}) {
    const g = S("g", { class: "glmm-ping", style: `--c:${color}` });
    for (let i = 0; i < 3; i++) {
      const ring = S("circle", { class: "glmm-ping-ring", cx: x, cy: y, r: 8 });
      ring.style.animationDelay = `${i * 230}ms`;
      g.appendChild(ring);
    }
    g.appendChild(S("circle", { class: "glmm-ping-core", cx: x, cy: y, r: 7 }));
    if (name) {
      g.appendChild(S("text", { class: "glmm-ping-name", x, y: y - 34, "text-anchor": "middle", text: name }));
    }
    this.layers.fx.appendChild(g);
    setTimeout(() => g.remove(), PING_TTL_MS);
    return g;
  }

  /** Sustained GM beacon at a point (or on an element). Glides the camera too. */
  attention(x, y, { color = "#ffd24a" } = {}) {
    const g = S("g", { class: "glmm-beacon", style: `--c:${color}` });
    g.appendChild(S("circle", { class: "glmm-beacon-pulse", cx: x, cy: y, r: 60 }));
    g.appendChild(S("circle", { class: "glmm-beacon-pulse d2", cx: x, cy: y, r: 60 }));
    g.appendChild(S("circle", { class: "glmm-beacon-dot", cx: x, cy: y, r: 9 }));
    // four converging chevrons
    for (let k = 0; k < 4; k++) {
      const a = (Math.PI / 2) * k;
      const cv = S("path", {
        class: "glmm-beacon-arrow",
        d: "M -16 -8 L 0 0 L -16 8",
        transform: `translate(${x + Math.cos(a) * 90} ${y + Math.sin(a) * 90}) rotate(${(a * 180) / Math.PI})`
      });
      cv.style.animationDelay = `${k * 80}ms`;
      g.appendChild(cv);
    }
    this.layers.fx.appendChild(g);
    setTimeout(() => g.classList.add("is-out"), ATTENTION_TTL_MS - 600);
    setTimeout(() => g.remove(), ATTENTION_TTL_MS);
    return g;
  }

  clearFx() { this.layers.fx.replaceChildren(); }

  /* --------------------------- diff animation ---------------------------- */

  /**
   * Render `newSnap` and animate the transition from `oldSnap`:
   *   moved markers tween old→new (with a fading trail), additions draw in,
   *   removals fade out, changed elements pulse.
   * Returns a promise that resolves when the motion has played.
   */
  async animateDiff(oldSnap, newSnap, diff) {
    // Ghost the removed elements first (rendered from the OLD snapshot) so they
    // can fade as the new state mounts.
    const removalGhosts = [];
    for (const el of diff.removed ?? []) {
      const node = this._renderElement(el, false);
      if (node) {
        node.classList.add("glmm-leave");
        (this.layers[node.dataset.layer] ?? this.layers.annot).appendChild(node);
        removalGhosts.push(node);
      }
    }

    this.setSnapshot(newSnap);

    // Re-mount removal ghosts on top of the freshly rendered snapshot.
    for (const node of removalGhosts) (this.layers[node.dataset.layer] ?? this.layers.annot).appendChild(node);
    setTimeout(() => removalGhosts.forEach((n) => n.remove()), 780);

    // Additions: draw in + scramble any text into place.
    diff.added?.forEach((el, i) => {
      const node = this.nodeFor(el.id);
      if (!node) return;
      node.style.setProperty("--gl-delay", `${Math.min(i * 60, 360)}ms`);
      node.classList.add("glmm-enter");
      const t = this._textNodeOf(node);
      if (t && t.textContent) scrambleText(t, t.textContent, { dur: 860 });
    });

    // Changed: highlight pulse + re-scramble text if it changed.
    for (const el of diff.changed ?? []) {
      const node = this.nodeFor(el.id);
      if (!node) continue;
      node.classList.add("glmm-changed");
      const t = this._textNodeOf(node);
      if (t && t.textContent) scrambleText(t, t.textContent, { dur: 760 });
    }

    // Moved: tween from old anchor to new, leaving a trail.
    for (const m of diff.moved ?? []) {
      const node = this.nodeFor(m.id);
      if (!node) continue;
      const dx = m.from.x - m.to.x;
      const dy = m.from.y - m.to.y;
      // trail behind the journey
      const trail = S("line", {
        class: "glmm-trail", x1: m.from.x, y1: m.from.y, x2: m.to.x, y2: m.to.y,
        style: `--c:${(node.style.getPropertyValue("--c") || "#5eeaff").trim()}`
      });
      this.layers.fx.appendChild(trail);
      requestAnimationFrame(() => trail.classList.add("is-in"));
      setTimeout(() => trail.remove(), 2100);

      node.style.transition = "none";
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      node.classList.add("glmm-moving");
      // force reflow, then release to the final (untranslated) position
      void node.getBoundingClientRect();
      requestAnimationFrame(() => {
        node.style.transition = "transform 1.25s var(--gl-ease, cubic-bezier(0.16,1,0.3,1))";
        node.style.transform = "translate(0px, 0px)";
      });
      setTimeout(() => {
        node.style.transition = "";
        node.style.transform = "";
        node.classList.remove("glmm-moving");
      }, 1500);
    }

    // settle: drop the one-shot highlight classes
    await new Promise((res) => setTimeout(res, 1600));
    for (const el of diff.added ?? []) { const n = this.nodeFor(el.id); n?.classList.remove("glmm-enter"); n?.style.removeProperty("--gl-delay"); }
    for (const el of diff.changed ?? []) this.nodeFor(el.id)?.classList.remove("glmm-changed");
  }

  /* ------------------------------- legend -------------------------------- */

  legend() {
    const markers = [];
    const iconMap = new Map();
    for (const el of this.snapshot?.elements ?? []) {
      if (el.type === "marker") {
        const m = this.resolveMarker(el);
        markers.push({ id: el.id, name: m.name || game.i18n.localize("GLMM.legend.unnamed"), color: m.color, isSelf: m.isSelf, isParty: m.isParty });
      } else if (el.type === "icon" && el.label) {
        const key = el.label;
        if (!iconMap.has(key)) iconMap.set(key, { label: el.label, cls: safeIconClass(el.icon), color: el.color || DEFAULT_ELEMENT_COLOR });
      }
    }
    return { markers, icons: [...iconMap.values()] };
  }
}
