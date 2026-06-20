/**
 * TrackerRender — the shared, store-agnostic row visuals for a tracker.
 *
 * These are the exact body builders the global dock (TrackerHud) uses, lifted
 * out so the per-PC sheet tab can mount byte-identical rows: a point's slot
 * reel, a clock's segmented pie, a pool's count, task/hazard boxes, separators —
 * plus the completion/empty overlay. Each `buildBody(t)` returns
 * `{ content, paint, stepEls }`: a DOM node, a repaint(tracker) closure that
 * animates value changes in place, and the sub-elements that act as the value's
 * click target. Both mounts wrap a body in a `.trow` (with an `.rovl` overlay)
 * so `setOverlay` resolves the same way in either home.
 */

const NS = "http://www.w3.org/2000/svg";

export const TrackerRender = {
  el(tag, cls, txt) { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; },
  svg(tag, attrs) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; },
  polar(cx, cy, r, deg) { const a = deg * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; },

  /** Read an optional point bound (min/max): blank/null stays unset (null). */
  bound(v) {
    if (v === null || v === undefined || v === "") return null;
    const n = Math.trunc(Number(v));
    return Number.isFinite(n) ? n : null;
  },

  buildBody(t) {
    switch (t.type) {
      case "point": return this.bodyPoint(t);
      case "clock": return this.bodyClock(t);
      case "pool": return this.bodyPool(t);
      case "task": return this.bodyTask(t);
      case "hazard": return this.bodyHazard(t);
      case "separator": return this.bodySeparator(t);
      default: return this.bodyPoint(t);
    }
  },

  /* ---- POINT (slot-reel digit) ---- */
  bodyPoint(t) {
    const c = this.el("div", "t-point");
    const chev = this.el("div", "chev");
    const nm = this.el("div", "nm", t.name ?? "");
    const val = this.el("div", "pval");
    const reel = this.el("div", "reeldig");
    const maxlbl = this.el("div", "reelmax");      // faint "/max" suffix, only when a max is set
    val.append(reel, maxlbl);
    c.append(chev, nm, val);
    let last = null;
    const paint = (tr) => {
      nm.textContent = tr.name ?? "";
      const lo = this.bound(tr.min), hi = this.bound(tr.max);
      const v = Math.trunc(Number(tr.value) || 0);
      this.renderReel(reel, v, last);
      maxlbl.textContent = hi !== null ? `/${hi}` : "";
      maxlbl.style.display = hi !== null ? "" : "none";
      val.classList.toggle("at-max", hi !== null && v >= hi);
      val.classList.toggle("at-min", lo !== null && v <= lo);
      if (last !== null && v !== last) {
        const dir = v > last ? "up" : "down";
        chev.textContent = v > last ? "▲" : "▼";
        // Clear then re-add the direction class (with a reflow between) so the
        // float animation replays on every step — even repeats in one direction.
        chev.className = "chev";
        void chev.offsetWidth;
        chev.className = "chev " + dir;
      }
      last = v;
    };
    return { content: c, paint, stepEls: [val] };
  },

  /** Render an integer as per-digit reels; animates when the digit layout is stable. */
  renderReel(host, value, prev) {
    const str = String(value);
    const layout = str.replace(/[0-9]/g, "#");          // sign/structure fingerprint
    if (host._layout !== layout) {
      host.replaceChildren();
      host._wheels = [];
      for (const ch of str) {
        if (ch >= "0" && ch <= "9") {
          const reel = this.el("span", "reel");
          const strip = this.el("span", "strip");
          for (let n = 0; n <= 9; n++) strip.appendChild(this.el("span", null, String(n)));
          reel.appendChild(strip);
          host.appendChild(reel);
          host._wheels.push(strip);
        } else {
          host.appendChild(this.el("span", "sign", ch));
        }
      }
      host._layout = layout;
      // set without transition on first lay-out
      host._wheels.forEach((strip, i) => {
        strip.style.transition = "none";
        strip.style.transform = `translateY(-${Number(str.replace(/[^0-9]/g, "")[i]) * 10}%)`;
      });
      void host.offsetWidth;
      host._wheels.forEach(strip => strip.style.transition = "");
      return;
    }
    const digits = str.replace(/[^0-9]/g, "");
    host._wheels.forEach((strip, i) => {
      strip.style.transform = `translateY(-${Number(digits[i]) * 10}%)`;
    });
  },

  /** Build a segmented clock pie at the given pixel size; returns {svg, segs}. */
  makePie(slices, size) {
    const s = this.svg("svg", { viewBox: "0 0 104 104", width: size, height: size, class: "pie" });
    const segs = [];
    for (let i = 0; i < slices; i++) {
      const a0 = (i / slices) * 360 - 90, a1 = ((i + 1) / slices) * 360 - 90;
      const [x0, y0] = this.polar(52, 52, 42, a0), [x1, y1] = this.polar(52, 52, 42, a1);
      const lg = (a1 - a0) <= 180 ? 0 : 1;
      const seg = this.svg("path", { d: `M52 52 L${x0.toFixed(2)} ${y0.toFixed(2)} A42 42 0 ${lg} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`, class: "seg" });
      s.appendChild(seg); segs.push(seg);
    }
    s.appendChild(this.svg("circle", { cx: 52, cy: 52, r: 42, class: "ring" }));
    return { svg: s, segs };
  },

  /* ---- CLOCK (segmented pie) ---- */
  bodyClock(t) {
    const c = this.el("div", "t-clock");
    const slices = Math.max(1, Math.trunc(Number(t.slices) || 6));
    const { svg: s, segs } = this.makePie(slices, 26);
    const pie = this.el("div", "piewrap"); pie.appendChild(s);
    const nm = this.el("div", "nm", t.name ?? "");
    const frac = this.el("div", "frac");
    c.append(pie, nm, frac);
    let last = -1;
    const paint = (tr) => {
      nm.textContent = tr.name ?? "";
      const v = Math.max(0, Math.min(slices, Math.trunc(Number(tr.value) || 0)));
      segs.forEach((sg, i) => {
        const fill = i < v;
        sg.classList.toggle("fill", fill);
        if (fill && i >= last && last >= 0) { sg.classList.remove("justfilled"); void sg.getBoundingClientRect().width; sg.classList.add("justfilled"); }
      });
      frac.innerHTML = `<b>${v}</b>/${slices}`;
      const done = v >= slices;
      c.classList.toggle("complete", done);
      // A bad clock filling up is an ominous event — a red "doom" stamp rather
      // than the usual green "filled".
      const bad = !!tr.bad;
      this.setOverlay(c, done ? (bad ? "doom" : "done") : null,
        game.i18n.localize(bad ? "GLCT.tracker.doom" : "GLCT.tracker.filled"));
      last = v;
    };
    return { content: c, paint, stepEls: [pie, frac] };
  },

  /* ---- POOL (point-style remaining count; 3D roll handled by Dice So Nice in chat) ---- */
  bodyPool(t) {
    const c = this.el("div", "t-pool");
    const chev = this.el("div", "chev");
    const nm = this.el("div", "nm", t.name ?? "");
    const val = this.el("div", "pval");
    const reel = this.el("div", "reeldig");
    const sizelbl = this.el("div", "reelmax");     // faint "d?" cap, mirroring point's "/max"
    val.append(reel, sizelbl);
    c.append(chev, nm, val);
    if (t.playerRoll) { const p = this.el("div", "play"); p.innerHTML = '<i class="fa-solid fa-play"></i>'; p.title = game.i18n.localize("GLCT.tracker.playersMayRoll"); c.append(p); }
    let last = null;
    const paint = (tr) => {
      nm.textContent = tr.name ?? "";
      const cur = Math.max(0, Math.trunc(Number(tr.current) || 0));
      const size = Math.max(2, Math.trunc(Number(tr.size) || 6));
      this.renderReel(reel, cur, last);
      sizelbl.textContent = `d${size}`;
      val.classList.toggle("at-min", cur === 0);     // empty pool reads red, like a point at its floor
      if (last !== null && cur !== last) {
        const dir = cur > last ? "up" : "down";
        chev.textContent = cur > last ? "▲" : "▼";
        chev.className = "chev";
        void chev.offsetWidth;
        chev.className = "chev " + dir;
      }
      this.setOverlay(c, cur === 0 ? "empty" : null, game.i18n.localize("GLCT.tracker.empty"));
      last = cur;
    };
    return { content: c, paint, stepEls: [val] };
  },

  /* ---- TASK (discrete boxes) ---- */
  bodyTask(t) {
    const c = this.el("div", "t-task");
    const titles = this.el("div", "titles");
    const tt = this.el("div", "tt", t.title ?? "");
    const st = this.el("div", "st", t.subtitle ?? "");
    titles.append(tt, st);
    const boxes = Math.max(1, Math.trunc(Number(t.boxes) || 6));
    const br = this.el("div", "boxrow");
    const cells = [];
    for (let i = 0; i < boxes; i++) { const b = this.el("div", "box"); br.appendChild(b); cells.push(b); }
    c.append(titles, br);
    let last = -1;
    const paint = (tr) => {
      tt.textContent = tr.title ?? ""; st.textContent = tr.subtitle ?? "";
      const v = Math.max(0, Math.min(boxes, Math.trunc(Number(tr.value) || 0)));
      cells.forEach((cl, i) => {
        const fill = i < v;
        cl.classList.toggle("fill", fill);
        if (fill && i >= last && last >= 0) { cl.classList.remove("justfill"); void cl.offsetWidth; cl.classList.add("justfill"); }
      });
      this.setOverlay(c, v >= boxes ? "done" : null, game.i18n.localize("GLCT.tracker.completed"));
      last = v;
    };
    return { content: c, paint, stepEls: [br] };
  },

  /* ---- HAZARD (red dread boxes; no overlay) ---- */
  bodyHazard(t) {
    const c = this.el("div", "t-task haz");
    const titles = this.el("div", "titles");
    const tt = this.el("div", "tt", t.title ?? "");
    const st = this.el("div", "st", t.subtitle ?? "");
    titles.append(tt, st);
    const boxes = Math.max(1, Math.trunc(Number(t.boxes) || 8));
    const br = this.el("div", "boxrow");
    const cells = [];
    for (let i = 0; i < boxes; i++) { const b = this.el("div", "box"); br.appendChild(b); cells.push(b); }
    c.append(titles, br);
    let last = -1;
    const paint = (tr) => {
      tt.textContent = tr.title ?? ""; st.textContent = tr.subtitle ?? "";
      const v = Math.max(0, Math.min(boxes, Math.trunc(Number(tr.value) || 0)));
      cells.forEach((cl, i) => {
        const fill = i < v;
        cl.classList.toggle("fill", fill);
        cl.classList.toggle("head", fill && i === v - 1 && v < boxes);
        if (fill && i >= last && last >= 0) { cl.classList.remove("justfill"); void cl.offsetWidth; cl.classList.add("justfill"); }
      });
      c.closest(".trow")?.classList.toggle("full", v >= boxes);
      last = v;
    };
    return { content: c, paint, stepEls: [br] };
  },

  /* ---- SEPARATOR (purely visual divider with optional centered label) ---- */
  bodySeparator(t) {
    const c = this.el("div", "t-sep");
    const lab = this.el("span", "lab", t.label ?? "");
    c.appendChild(lab);
    const paint = (tr) => {
      const txt = (tr.label ?? "").trim();
      lab.textContent = txt;
      lab.style.display = txt ? "" : "none";
    };
    return { content: c, paint, stepEls: [] };
  },

  setOverlay(bodyEl, kind, txt) {
    const ovl = bodyEl.closest(".trow")?.querySelector(".rovl");
    if (!ovl) return;
    ovl.className = "rovl " + (kind || "");
    ovl.querySelector(".ot").textContent = kind ? txt : "";
    if (kind) ovl.classList.add("show");
  }
};
