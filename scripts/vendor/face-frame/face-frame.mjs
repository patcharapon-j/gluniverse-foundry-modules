//#region src/core/rank.ts
/**
* Score a candidate for "which head is the subject".
* Combines confidence, relative size, and closeness to the image centre.
* Higher is better. Must return a finite number for any candidate.
*/
function scoreCandidate(c, image) {
	const { box } = c;
	const size = Math.sqrt(box.width * box.height / (image.width * image.height));
	const dx = box.x + box.width / 2 - image.width / 2;
	const dy = box.y + box.height / 2 - image.height * .4;
	const dist = Math.hypot(dx, dy) / Math.hypot(image.width, image.height);
	const score = c.confidence ** 2 * Math.sqrt(.05 + size) * Math.max(0, 1 - dist);
	return Number.isFinite(score) ? score : 0;
}
function rankCandidates(candidates, image) {
	return [...candidates].sort((a, b) => scoreCandidate(b, image) - scoreCandidate(a, image));
}
//#endregion
//#region src/core/crop.ts
/**
* Built-in framings. headRatio = head height / crop height; eyeLine = where the eye line
* lands, as a fraction of crop height from the top.
*/
var PRESETS = {
	"token-ring": {
		aspect: 1,
		headRatio: .42,
		eyeLine: .4,
		eyeInHead: .55
	},
	"token-square": {
		aspect: 1,
		headRatio: .34,
		eyeLine: .34,
		eyeInHead: .55
	},
	"portrait-bust": {
		aspect: 3 / 4,
		headRatio: .3,
		eyeLine: .3,
		eyeInHead: .55
	},
	"avatar-circle": {
		aspect: 1,
		headRatio: .62,
		eyeLine: .47,
		eyeInHead: .55
	}
};
/**
* Where to crop the source image for a preset. The rect is shifted inside the image when
* it fits; otherwise transparent art is padded (head stays placed) and opaque art is
* zoomed in until it fits.
*/
function computeCrop(result, preset, opts = {}) {
	const p = typeof preset === "string" ? PRESETS[preset] : preset;
	const { width: W, height: H } = result.image;
	if (result.kind !== "subject" && opts.override) {
		const side = Math.min(W, H) * .25;
		const o = opts.override;
		const head = {
			x: o.x - side / 2,
			y: o.y - side * p.eyeInHead,
			width: side,
			height: side
		};
		return computeCrop({
			kind: "subject",
			image: result.image,
			candidates: [{
				box: head,
				confidence: 0,
				tier: "manual",
				source: "manual"
			}],
			eyeLineY: o.y,
			focal: {
				x: o.x,
				y: o.y
			}
		}, p, {
			...opts,
			candidate: 0
		});
	}
	if (result.kind !== "subject") {
		if (result.kind === "already-framed") return {
			x: 0,
			y: 0,
			width: W,
			height: H,
			padded: false
		};
		return coverCrop(W, H, p.aspect);
	}
	const head = (result.candidates[opts.candidate ?? 0] ?? result.candidates[0]).box;
	const zoom = opts.override?.zoom ?? 1;
	const height = head.height / (p.headRatio * zoom);
	const width = height * p.aspect;
	const focusX = opts.override?.x ?? head.x + head.width / 2;
	const eyeY = opts.override ? opts.override.y : head.y + head.height * p.eyeInHead;
	const t = edgesFor(result.image, opts.allowPadding);
	const maxW = t.left && t.right ? W : Infinity;
	const maxH = t.top && t.bottom ? H : Infinity;
	const fit = Math.min(1, maxW / width, maxH / height);
	const w = width * fit;
	const h = height * fit;
	const x = placeAxis(focusX - w / 2, w, W, t.left, t.right);
	const y = placeAxis(eyeY - p.eyeLine * h, h, H, t.top, t.bottom);
	return {
		x,
		y,
		width: w,
		height: h,
		padded: x < 0 || y < 0 || x + w > W || y + h > H
	};
}
function edgesFor(image, allowPadding) {
	if (allowPadding === true) return {
		top: false,
		right: false,
		bottom: false,
		left: false
	};
	if (allowPadding === false || !image.hasAlpha) return {
		top: true,
		right: true,
		bottom: true,
		left: true
	};
	return image.touches ?? {
		top: false,
		right: false,
		bottom: false,
		left: false
	};
}
/**
* Positions a span on one axis. It is shifted off any edge it may not cross; if it fits in
* the image anyway, it is kept inside (no needless padding).
*/
function placeAxis(start, span, size, lowLocked, highLocked) {
	if (span <= size) return Math.min(size - span, Math.max(0, start));
	if (lowLocked) return 0;
	if (highLocked) return size - span;
	return start;
}
function coverCrop(W, H, aspect) {
	let width = W;
	let height = W / aspect;
	if (height > H) {
		height = H;
		width = H * aspect;
	}
	return {
		x: (W - width) / 2,
		y: (H - height) * .2,
		width,
		height,
		padded: false
	};
}
//#endregion
//#region src/core/detect/framed.ts
var ANGLES = 120;
/**
* Detects tokens that already have a ring frame baked in.
* The token must be a transparent-cornered disc (fitted with RANSAC so art breaking
* out of the frame is ignored). A frame then shows up either as a rim that looks the
* same at every angle, or as a sharp radial edge on one common radius; a plain
* circular cutout of a portrait has neither.
*/
function detectRingFrame(px, opts = {}) {
	const { width: w, height: h, data } = px;
	const coherenceThreshold = opts.coherenceThreshold ?? .75;
	const circularityThreshold = opts.circularityThreshold ?? .35;
	const angles = opts.angles ?? ANGLES;
	const alpha = (x, y) => data[(y * w + x) * 4 + 3];
	const edge = [];
	let opaque = 0;
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		if (alpha(x, y) <= 128) continue;
		opaque++;
		if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || alpha(x - 1, y) <= 128 || alpha(x + 1, y) <= 128 || alpha(x, y - 1) <= 128 || alpha(x, y + 1) <= 128) edge.push([x + .5, y + .5]);
	}
	let cx = w / 2, cy = h / 2, radius = Math.min(w, h) / 2;
	let alphaDisc = false;
	const fill = opaque / (w * h);
	if (fill > .15 && fill < .97 && edge.length >= 30) {
		const fit = fitCircle(edge, Math.min(w, h));
		if (fit && fit.coverage > .6) {
			[cx, cy, radius] = [
				fit.cx,
				fit.cy,
				fit.r
			];
			alphaDisc = true;
		}
	}
	const aspect = w / h;
	const result = {
		circularity: 0,
		coherence: 0,
		alphaDisc,
		cx,
		cy,
		radius,
		innerRadius: 0
	};
	if (!alphaDisc && (aspect < .9 || aspect > 1.1)) return {
		framed: false,
		...result
	};
	const lum = (x, y) => {
		const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
		const i = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + xi) * 4;
		const a = data[i + 3] / 255;
		return (.299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]) * a;
	};
	const rMin = Math.floor(radius * .7);
	const rMax = Math.floor(radius * .97);
	if (rMax - rMin < 6) return {
		framed: false,
		...result
	};
	const peaks = [];
	for (let k = 0; k < angles; k++) {
		const t = 2 * Math.PI * k / angles;
		const dx = Math.cos(t);
		const dy = Math.sin(t);
		let best = -1, bestR = rMin;
		let prev = lum(cx + dx * (rMin - 1), cy + dy * (rMin - 1));
		for (let r = rMin; r <= rMax; r++) {
			const cur = lum(cx + dx * r, cy + dy * r);
			const g = Math.abs(cur - prev);
			if (g > best) [best, bestR] = [g, r];
			prev = cur;
		}
		peaks.push(bestR);
	}
	const tol = Math.max(1.5, radius * .025);
	let circularity = 0, innerRadius = 0;
	for (let r = rMin; r <= rMax; r++) {
		const share = peaks.filter((p) => Math.abs(p - r) <= tol).length / angles;
		if (share > circularity) [circularity, innerRadius] = [share, r];
	}
	const rimCoherence = (from, to) => {
		const J = 20;
		const profiles = [];
		for (let k = 0; k < angles; k++) {
			const t = 2 * Math.PI * k / angles;
			const prof = [];
			for (let j = 0; j < J; j++) {
				const r = radius * (from + (to - from) * j / 19);
				prof.push(lum(cx + Math.cos(t) * r, cy + Math.sin(t) * r));
			}
			profiles.push(prof);
		}
		const mean = Array.from({ length: J }, (_, j) => profiles.reduce((s, p) => s + p[j], 0) / angles);
		return spread(mean) < 4 ? 0 : median(profiles.map((p) => correlation(p, mean)));
	};
	const coherence = rimCoherence(.7, .98);
	const framed = alphaDisc && (coherence >= coherenceThreshold || circularity >= circularityThreshold);
	return {
		...result,
		circularity,
		coherence,
		innerRadius,
		framed
	};
}
function spread(v) {
	return Math.max(...v) - Math.min(...v);
}
function median(v) {
	const s = [...v].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)] ?? 0;
}
function correlation(a, b) {
	const n = a.length;
	const ma = a.reduce((s, x) => s + x, 0) / n;
	const mb = b.reduce((s, x) => s + x, 0) / n;
	let num = 0, da = 0, db = 0;
	for (let i = 0; i < n; i++) {
		num += (a[i] - ma) * (b[i] - mb);
		da += (a[i] - ma) ** 2;
		db += (b[i] - mb) ** 2;
	}
	return da && db ? num / Math.sqrt(da * db) : 0;
}
/** Deterministic RANSAC circle fit; coverage = share of angles with an edge point on the circle. */
function fitCircle(points, size) {
	let seed = 12345;
	const rand = () => (seed = Math.imul(seed, 1103515245) + 12345 >>> 0) / 2 ** 32;
	const pick = () => points[Math.floor(rand() * points.length)];
	let best;
	for (let i = 0; i < 300; i++) {
		const [a, b, c] = [
			pick(),
			pick(),
			pick()
		];
		const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
		if (Math.abs(d) < 1e-6) continue;
		const s1 = a[0] ** 2 + a[1] ** 2, s2 = b[0] ** 2 + b[1] ** 2, s3 = c[0] ** 2 + c[1] ** 2;
		const cx = (s1 * (b[1] - c[1]) + s2 * (c[1] - a[1]) + s3 * (a[1] - b[1])) / d;
		const cy = (s1 * (c[0] - b[0]) + s2 * (a[0] - c[0]) + s3 * (b[0] - a[0])) / d;
		const r = Math.hypot(a[0] - cx, a[1] - cy);
		if (r < size * .2 || r > size * .75) continue;
		const tol = Math.max(1.5, r * .02);
		let inliers = 0;
		for (const p of points) if (Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r) <= tol) inliers++;
		if (!best || inliers > best.inliers) best = {
			cx,
			cy,
			r,
			inliers
		};
	}
	if (!best) return void 0;
	const bins = /* @__PURE__ */ new Uint8Array(72);
	const tol = Math.max(1.5, best.r * .02);
	for (const p of points) {
		if (Math.abs(Math.hypot(p[0] - best.cx, p[1] - best.cy) - best.r) > tol) continue;
		const t = Math.atan2(p[1] - best.cy, p[0] - best.cx);
		bins[Math.floor((t + Math.PI) / (2 * Math.PI) * 72) % 72] = 1;
	}
	return {
		...best,
		coverage: bins.reduce((s, v) => s + v, 0) / 72
	};
}
//#endregion
//#region src/core/detect/openvocab.ts
var area = (c) => c.box.width * c.box.height;
function containment(outer, inner) {
	const a = outer.box;
	const b = inner.box;
	return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)) / area(inner);
}
/**
* Open-vocabulary detectors asked for "a monster head" happily box the whole monster.
* Keep head-sized boxes: drop huge ones and any box that contains a plausible head.
*/
function refineOpenVocab(cands, image, opts = {}) {
	const minScore = opts.minScore ?? .2;
	const maxAreaShare = opts.maxAreaShare ?? .45;
	const containRatio = opts.containRatio ?? .6;
	const imageArea = image.width * image.height;
	const kept = cands.filter((c) => c.confidence >= minScore && area(c) / imageArea <= maxAreaShare);
	return kept.filter((outer) => !kept.some((inner) => inner !== outer && area(inner) < area(outer) * .7 && containment(outer, inner) > .85 && inner.confidence >= outer.confidence * containRatio));
}
//#endregion
//#region src/core/detect/pixels.ts
function hasTransparency(px) {
	const { data } = px;
	for (let i = 3; i < data.length; i += 28) if (data[i] < 250) return true;
	return false;
}
/** Copy a sub-rectangle (clamped to the image). */
function cropPixels(px, x, y, w, h) {
	const x0 = Math.max(0, Math.floor(x));
	const y0 = Math.max(0, Math.floor(y));
	const x1 = Math.min(px.width, Math.ceil(x + w));
	const y1 = Math.min(px.height, Math.ceil(y + h));
	const width = Math.max(1, x1 - x0);
	const height = Math.max(1, y1 - y0);
	const data = new Uint8ClampedArray(width * height * 4);
	for (let row = 0; row < height; row++) {
		const src = ((y0 + row) * px.width + x0) * 4;
		data.set(px.data.subarray(src, src + width * 4), row * width * 4);
	}
	return {
		data,
		width,
		height
	};
}
/**
* Bilinear downscale so the long side is at most `maxSide`, compositing transparency
* onto `background` (open-vocabulary models were trained on opaque photos).
*/
function resizePixels(px, maxSide, background) {
	const scale = Math.min(1, maxSide / Math.max(px.width, px.height));
	const w = Math.max(1, Math.round(px.width * scale));
	const h = Math.max(1, Math.round(px.height * scale));
	const out = new Uint8ClampedArray(w * h * 4);
	const sx = px.width / w;
	const sy = px.height / h;
	const { data } = px;
	for (let y = 0; y < h; y++) {
		const fy = Math.min(px.height - 1, Math.max(0, (y + .5) * sy - .5));
		const y0 = Math.floor(fy);
		const y1 = Math.min(px.height - 1, y0 + 1);
		const wy = fy - y0;
		for (let x = 0; x < w; x++) {
			const fx = Math.min(px.width - 1, Math.max(0, (x + .5) * sx - .5));
			const x0 = Math.floor(fx);
			const x1 = Math.min(px.width - 1, x0 + 1);
			const wx = fx - x0;
			const o = (y * w + x) * 4;
			const i00 = (y0 * px.width + x0) * 4;
			const i01 = (y0 * px.width + x1) * 4;
			const i10 = (y1 * px.width + x0) * 4;
			const i11 = (y1 * px.width + x1) * 4;
			for (let c = 0; c < 4; c++) out[o + c] = (data[i00 + c] * (1 - wx) + data[i01 + c] * wx) * (1 - wy) + (data[i10 + c] * (1 - wx) + data[i11 + c] * wx) * wy;
			if (background) {
				const a = out[o + 3] / 255;
				for (let c = 0; c < 3; c++) out[o + c] = out[o + c] * a + background[c] * (1 - a);
				out[o + 3] = 255;
			}
		}
	}
	return {
		data: out,
		width: w,
		height: h
	};
}
/** Which edges carry opaque content (more than 2% of the edge's pixels). */
function edgeTouches(px) {
	const { width: w, height: h, data } = px;
	const opaqueShare = (count, at) => {
		let n = 0;
		const step = Math.max(1, Math.floor(count / 400));
		for (let i = 0; i < count; i += step) if (data[at(i) + 3] > 200) n++;
		return n / Math.ceil(count / step);
	};
	return {
		top: opaqueShare(w, (x) => x * 4) > .02,
		bottom: opaqueShare(w, (x) => ((h - 1) * w + x) * 4) > .02,
		left: opaqueShare(h, (y) => y * w * 4) > .02,
		right: opaqueShare(h, (y) => (y * w + w - 1) * 4) > .02
	};
}
//#endregion
//#region src/core/detect/saliency.ts
var GRID = 96;
/**
* Tier 3: a guess for art with no detectable head (oozes, swarms, sigils).
* Weights each pixel by opacity and local detail, takes the upper part of that mass
* (subjects are usually "looked at" high), and returns a head-sized box around it.
*/
function saliencyCandidate(px) {
	const { width: w, height: h, data } = px;
	const gw = Math.max(1, Math.round(Math.min(GRID, w * (GRID / Math.max(w, h)))));
	const gh = Math.max(1, Math.round(Math.min(GRID, h * (GRID / Math.max(w, h)))));
	const sx = w / gw;
	const sy = h / gh;
	const lum = new Float32Array(gw * gh);
	const alpha = new Float32Array(gw * gh);
	for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
		const i = (Math.min(h - 1, Math.floor((gy + .5) * sy)) * w + Math.min(w - 1, Math.floor((gx + .5) * sx))) * 4;
		const a = data[i + 3] / 255;
		alpha[gy * gw + gx] = a;
		lum[gy * gw + gx] = (.299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2]) * a;
	}
	let alphaSum = 0;
	for (const a of alpha) alphaSum += a;
	const opaqueImage = alphaSum / alpha.length > .98;
	const weight = new Float32Array(gw * gh);
	let total = 0;
	for (let gy = 1; gy < gh - 1; gy++) for (let gx = 1; gx < gw - 1; gx++) {
		const i = gy * gw + gx;
		const g = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + gw] - lum[i - gw]);
		const wgt = alpha[i] * (opaqueImage ? g : 89.25 + g);
		weight[i] = wgt;
		total += wgt;
	}
	const box = {
		x: 0,
		y: 0,
		width: w,
		height: h
	};
	if (total <= 0) {
		const side = Math.min(w, h) * .4;
		return candidate({
			x: (w - side) / 2,
			y: (h - side) / 3,
			width: side,
			height: side
		});
	}
	const rowMass = new Float32Array(gh);
	for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) rowMass[gy] += weight[gy * gw + gx];
	const rowAt = (q) => {
		let acc = 0;
		for (let gy = 0; gy < gh; gy++) if ((acc += rowMass[gy]) >= q * total) return gy;
		return gh - 1;
	};
	const top = rowAt(.05);
	const bottom = rowAt(.95);
	const cut = top + Math.max(1, Math.round((bottom - top) * .45));
	let mx = 0, my = 0, m = 0;
	for (let gy = top; gy <= cut; gy++) for (let gx = 0; gx < gw; gx++) {
		const wgt = weight[gy * gw + gx];
		mx += wgt * gx;
		my += wgt * gy;
		m += wgt;
	}
	const cx = ((m ? mx / m : gw / 2) + .5) * sx;
	const cy = ((m ? my / m : (top + cut) / 2) + .5) * sy;
	const side = Math.min(Math.min(w, h), Math.max(Math.min(w, h) * .15, (bottom - top + 1) * sy * .28));
	box.width = side;
	box.height = side;
	box.x = Math.min(w - side, Math.max(0, cx - side / 2));
	box.y = Math.min(h - side, Math.max(0, cy - side / 2));
	return candidate(box);
}
function candidate(box) {
	return {
		box,
		confidence: .1,
		tier: "saliency",
		source: "saliency",
		label: "focus"
	};
}
//#endregion
//#region src/core/detect/yolo.ts
var STRIDE = 32;
var PAD_VALUE = 114 / 255;
/**
* Resize so the long side is `size`, pad (centred) to a multiple of the stride,
* composite transparency onto white, and emit a CHW float tensor.
*/
function letterbox(px, size = 640) {
	const scale = size / Math.max(px.width, px.height);
	const w = Math.max(1, Math.round(px.width * scale));
	const h = Math.max(1, Math.round(px.height * scale));
	const inputWidth = Math.ceil(w / STRIDE) * STRIDE;
	const inputHeight = Math.ceil(h / STRIDE) * STRIDE;
	const padX = Math.floor((inputWidth - w) / 2);
	const padY = Math.floor((inputHeight - h) / 2);
	const plane = inputWidth * inputHeight;
	const tensor = new Float32Array(plane * 3).fill(PAD_VALUE);
	const sx = px.width / w;
	const sy = px.height / h;
	const { data } = px;
	for (let y = 0; y < h; y++) {
		const fy = Math.min(px.height - 1, Math.max(0, (y + .5) * sy - .5));
		const y0 = Math.floor(fy);
		const y1 = Math.min(px.height - 1, y0 + 1);
		const wy = fy - y0;
		for (let x = 0; x < w; x++) {
			const fx = Math.min(px.width - 1, Math.max(0, (x + .5) * sx - .5));
			const x0 = Math.floor(fx);
			const x1 = Math.min(px.width - 1, x0 + 1);
			const wx = fx - x0;
			const i00 = (y0 * px.width + x0) * 4;
			const i01 = (y0 * px.width + x1) * 4;
			const i10 = (y1 * px.width + x0) * 4;
			const i11 = (y1 * px.width + x1) * 4;
			const out = (y + padY) * inputWidth + (x + padX);
			const sample = (o) => (data[i00 + o] * (1 - wx) + data[i01 + o] * wx) * (1 - wy) + (data[i10 + o] * (1 - wx) + data[i11 + o] * wx) * wy;
			const a = sample(3) / 255;
			for (let c = 0; c < 3; c++) tensor[c * plane + out] = (sample(c) * a + 255 * (1 - a)) / 255;
		}
	}
	return {
		tensor,
		inputWidth,
		inputHeight,
		scale,
		padX,
		padY
	};
}
/** Decode a YOLOv8/11 single-class `[1, 5, N]` output back into source-image pixels. */
function decodeYolo(output, lb, threshold) {
	const data = output.data;
	const n = output.dims[2];
	const out = [];
	for (let i = 0; i < n; i++) {
		const score = data[4 * n + i];
		if (score < threshold) continue;
		const cx = (data[i] - lb.padX) / lb.scale;
		const cy = (data[n + i] - lb.padY) / lb.scale;
		const w = data[2 * n + i] / lb.scale;
		const h = data[3 * n + i] / lb.scale;
		out.push({
			box: {
				x: cx - w / 2,
				y: cy - h / 2,
				width: w,
				height: h
			},
			score
		});
	}
	return out;
}
function iou(a, b) {
	const x0 = Math.max(a.x, b.x);
	const y0 = Math.max(a.y, b.y);
	const x1 = Math.min(a.x + a.width, b.x + b.width);
	const y1 = Math.min(a.y + a.height, b.y + b.height);
	const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
	const union = a.width * a.height + b.width * b.height - inter;
	return union > 0 ? inter / union : 0;
}
function nms(dets, iouThreshold = .5) {
	const sorted = [...dets].sort((a, b) => b.score - a.score);
	const kept = [];
	for (const d of sorted) if (kept.every((k) => iou(k.box, d.box) < iouThreshold)) kept.push(d);
	return kept;
}
async function runYolo(ort, session, px, threshold, size = 640) {
	const lb = letterbox(px, size);
	const input = new ort.Tensor("float32", lb.tensor, [
		1,
		3,
		lb.inputHeight,
		lb.inputWidth
	]);
	return nms(decodeYolo((await session.run({ [session.inputNames[0]]: input }))[session.outputNames[0]], lb, threshold));
}
//#endregion
//#region src/core/pipeline.ts
var DEFAULT_EYE_IN_HEAD = .55;
/** The whole detection chain: ring check → tier 1 → tier 2 → optional saliency. */
var FaceFramer = class {
	opts;
	tier1;
	tier2;
	constructor(opts) {
		this.opts = opts;
	}
	async detect(px, options = {}) {
		const hasAlpha = hasTransparency(px);
		const image = {
			width: px.width,
			height: px.height,
			hasAlpha,
			...hasAlpha && { touches: edgeTouches(px) }
		};
		if (this.opts.ringFrame !== false && !options.forceCrop && image.hasAlpha) {
			const ring = detectRingFrame(px, this.opts.ringFrame ?? {});
			if (ring.framed) return {
				kind: "already-framed",
				image,
				ring
			};
		}
		let candidates = await (await this.getTier1()).detect(px);
		if (!candidates.length && this.opts.tier2 && !options.skipTier2) candidates = nms(refineOpenVocab(await (await this.getTier2()).detect(px), image, { minScore: this.opts.tier2MinScore ?? .3 }).map((c) => ({
			...c,
			score: c.confidence
		}))).map(({ score: _, ...c }) => c);
		if (!candidates.length && options.fallback === "saliency") candidates = [saliencyCandidate(px)];
		if (!candidates.length) return {
			kind: "none",
			image
		};
		return subjectResult(image, rankCandidates(candidates, image), this.opts.eyeInHead);
	}
	getTier1() {
		return this.tier1 ??= resolve(this.opts.tier1);
	}
	getTier2() {
		return this.tier2 ??= resolve(this.opts.tier2);
	}
};
/** Builds a subject result for a given (already ranked) candidate list, e.g. after a manual pick. */
function subjectResult(image, candidates, eyeInHead = DEFAULT_EYE_IN_HEAD) {
	const head = candidates[0].box;
	return {
		kind: "subject",
		image,
		candidates,
		eyeLineY: head.y + head.height * eyeInHead,
		focal: {
			x: head.x + head.width / 2,
			y: head.y + head.height / 2
		}
	};
}
async function resolve(lazy) {
	return typeof lazy === "function" ? lazy() : lazy;
}
//#endregion
//#region src/core/detect/tier1.ts
var offset = (b, dx, dy) => ({
	...b,
	x: b.x + dx,
	y: b.y + dy
});
/** Tier 1: specialised head detectors, merged, with a small-head refine pass. */
var Tier1Detector = class {
	ort;
	models;
	opts;
	constructor(ort, models, opts = {}) {
		this.ort = ort;
		this.models = models;
		this.opts = opts;
	}
	async detect(px) {
		let dets = await this.runAll(px);
		const tall = px.height > px.width * (this.opts.tallRatio ?? 1.4);
		if (dets.length === 0 && tall) {
			const top = cropPixels(px, 0, 0, px.width, px.height / 2);
			dets = await this.runAll(top);
		}
		const longSide = Math.max(px.width, px.height);
		const refineBelow = this.opts.refineBelow ?? .25;
		const refined = [];
		for (const d of dets) {
			const small = Math.max(d.box.width, d.box.height) < longSide * refineBelow;
			refined.push(small ? await this.refine(px, d) : d);
		}
		return nms(refined).map((d) => ({
			box: d.box,
			confidence: d.score,
			tier: "detector",
			source: d.model.id,
			label: "head"
		}));
	}
	async runAll(px) {
		const all = [];
		for (const model of this.models) for (const d of await runYolo(this.ort, model.session, px, model.threshold)) all.push({
			...d,
			model
		});
		return nms(all);
	}
	/** Re-detect inside a padded window around a small head for a tighter box. */
	async refine(px, d) {
		const side = Math.max(d.box.width, d.box.height) * 3;
		const x = d.box.x + d.box.width / 2 - side / 2;
		const y = d.box.y + d.box.height / 2 - side / 2;
		const win = cropPixels(px, x, y, side, side);
		const ox = Math.max(0, Math.floor(x));
		const oy = Math.max(0, Math.floor(y));
		const found = await runYolo(this.ort, d.model.session, win, d.model.threshold);
		let best = d;
		let bestIou = .3;
		for (const f of found) {
			const box = offset(f.box, ox, oy);
			const overlap = iou(box, d.box);
			if (overlap > bestIou) {
				bestIou = overlap;
				best = {
					box,
					score: Math.max(f.score, d.score),
					model: d.model
				};
			}
		}
		return best;
	}
};
//#endregion
//#region src/core/runtime/models.ts
var deepghs = (repo, variant) => ({
	path: `${repo}/${variant}/model.onnx`,
	url: `https://huggingface.co/deepghs/${repo}/resolve/main/${variant}/model.onnx`
});
var TIER1_MODELS = [{
	id: "anime_head_detection/head_detect_v2.0_s_yv11",
	file: deepghs("anime_head_detection", "head_detect_v2.0_s_yv11"),
	threshold: .383
}, {
	id: "real_head_detection/head_detect_v0_s_yv11",
	file: deepghs("real_head_detection", "head_detect_v0_s_yv11"),
	threshold: .187
}];
var TIER2_MODEL_ID = "Xenova/owlv2-base-patch16-ensemble";
var OWLV2_FILES = {
	q8: "model_quantized.onnx",
	q4f16: "model_q4f16.onnx",
	fp16: "model_fp16.onnx"
};
var tier2Model = (variant) => ({
	path: `owlv2-base-patch16-ensemble/${OWLV2_FILES[variant]}`,
	url: `https://huggingface.co/Xenova/owlv2-base-patch16-ensemble/resolve/main/onnx/${OWLV2_FILES[variant]}`
});
var TIER2_MODEL = tier2Model("q8");
/** Foundry serves `Data/face-frame-models/` at `/face-frame-models/`. */
var localSource = (base = "face-frame-models") => (file) => `${base.replace(/\/$/, "")}/${file.path}`;
var remoteSource = (file) => file.url;
var CACHE = "face-frame-models-v1";
/**
* Fetches a model file from the first source that has it. Cross-origin hits are stored in
* the Cache API so each browser downloads a model once.
*/
async function fetchModel(file, sources) {
	const errors = [];
	for (const source of sources) {
		const url = source(file);
		const remote = /^https?:/.test(url) && typeof location !== "undefined" && new URL(url).origin !== location.origin;
		try {
			const cache = remote && typeof caches !== "undefined" ? await caches.open(CACHE).catch(() => void 0) : void 0;
			const cached = await cache?.match(url);
			if (cached) return await cached.arrayBuffer();
			const res = await fetch(url);
			if (!res.ok) {
				errors.push(`${url}: HTTP ${res.status}`);
				continue;
			}
			if (cache) await cache.put(url, res.clone()).catch(() => void 0);
			return await res.arrayBuffer();
		} catch (e) {
			errors.push(`${url}: ${e}`);
		}
	}
	throw new Error(`face-frame: could not load ${file.path}\n${errors.join("\n")}`);
}
//#endregion
//#region src/core/detect/owlv2.ts
/** CLIP token ids for the fixed tier-2 prompts, padded to the longest (as Transformers.js does). */
var OWLV2_PROMPTS = [
	{
		label: "a head",
		ids: [
			49406,
			320,
			1375,
			49407
		]
	},
	{
		label: "a face",
		ids: [
			49406,
			320,
			1710,
			49407
		]
	},
	{
		label: "an animal head",
		ids: [
			49406,
			550,
			4668,
			1375,
			49407
		]
	},
	{
		label: "a monster head",
		ids: [
			49406,
			320,
			6060,
			1375,
			49407
		]
	}
];
var SIZE = 960;
var MEAN = [
	.48145466,
	.4578275,
	.40821073
];
var STD = [
	.26862954,
	.26130258,
	.27577711
];
/**
* OWLv2 zero-shot head detection on a raw ONNX session: composite on white, resize to
* 960 (padding or stretching), CLIP-normalise, sigmoid scores per prompt.
*/
async function runOwlv2(ort, session, px, opts = {}) {
	const threshold = opts.threshold ?? .05;
	const stretch = opts.mode === "stretch";
	const extentX = stretch ? px.width : Math.max(px.width, px.height);
	const extentY = stretch ? px.height : Math.max(px.width, px.height);
	const scaleX = SIZE / extentX;
	const scaleY = SIZE / extentY;
	const plane = SIZE * SIZE;
	const pixels = new Float32Array(plane * 3);
	const { data } = px;
	for (let y = 0; y < SIZE; y++) {
		const sy = (y + .5) / scaleY - .5;
		for (let x = 0; x < SIZE; x++) {
			const sx = (x + .5) / scaleX - .5;
			const o = y * SIZE + x;
			let rgb;
			if (sx > px.width - .5 || sy > px.height - .5) rgb = [
				.5,
				.5,
				.5
			];
			else {
				const x0 = Math.max(0, Math.min(px.width - 1, Math.floor(sx)));
				const y0 = Math.max(0, Math.min(px.height - 1, Math.floor(sy)));
				const x1 = Math.min(px.width - 1, x0 + 1);
				const y1 = Math.min(px.height - 1, y0 + 1);
				const wx = Math.max(0, Math.min(1, sx - x0));
				const wy = Math.max(0, Math.min(1, sy - y0));
				const s = (c) => ((data[(y0 * px.width + x0) * 4 + c] * (1 - wx) + data[(y0 * px.width + x1) * 4 + c] * wx) * (1 - wy) + (data[(y1 * px.width + x0) * 4 + c] * (1 - wx) + data[(y1 * px.width + x1) * 4 + c] * wx) * wy) / 255;
				const a = s(3);
				rgb = [
					s(0) * a + (1 - a),
					s(1) * a + (1 - a),
					s(2) * a + (1 - a)
				];
			}
			for (let c = 0; c < 3; c++) pixels[c * plane + o] = (rgb[c] - MEAN[c]) / STD[c];
		}
	}
	const len = Math.max(...OWLV2_PROMPTS.map((p) => p.ids.length));
	const ids = new BigInt64Array(OWLV2_PROMPTS.length * len);
	const mask = new BigInt64Array(OWLV2_PROMPTS.length * len);
	OWLV2_PROMPTS.forEach((p, i) => p.ids.forEach((id, j) => (ids[i * len + j] = BigInt(id), mask[i * len + j] = 1n)));
	const out = await session.run({
		pixel_values: new ort.Tensor("float32", pixels, [
			1,
			3,
			SIZE,
			SIZE
		]),
		input_ids: new ort.Tensor("int64", ids, [OWLV2_PROMPTS.length, len]),
		attention_mask: new ort.Tensor("int64", mask, [OWLV2_PROMPTS.length, len])
	});
	const logits = out.logits.data;
	const boxes = out.pred_boxes.data;
	const [, queries, labels] = out.logits.dims;
	const found = [];
	for (let q = 0; q < queries; q++) {
		let best = -Infinity, label = 0;
		for (let l = 0; l < labels; l++) {
			const v = logits[q * labels + l];
			if (v > best) [best, label] = [v, l];
		}
		const score = 1 / (1 + Math.exp(-best));
		if (score < threshold) continue;
		const [cx, cy, w, h] = [
			boxes[q * 4],
			boxes[q * 4 + 1],
			boxes[q * 4 + 2],
			boxes[q * 4 + 3]
		];
		const x = Math.max(0, (cx - w / 2) * extentX);
		const y = Math.max(0, (cy - h / 2) * extentY);
		found.push({
			box: {
				x,
				y,
				width: Math.min(px.width, (cx + w / 2) * extentX) - x,
				height: Math.min(px.height, (cy + h / 2) * extentY) - y
			},
			confidence: score,
			label: OWLV2_PROMPTS[label].label,
			tier: "open-vocab",
			source: opts.source ?? "owlv2"
		});
	}
	return found.sort((a, b) => b.confidence - a.confidence);
}
//#endregion
//#region src/core/detect/owlv2-patch.ts
/**
* The Xenova OWLv2 exports mask padded queries in float64:
*   … → Cast(to=DOUBLE) → Where(mask, Constant_11 = -1e6 (double), ·) → Cast(to=FLOAT) → logits
* onnxruntime-web has no float64 kernels, so the session fails to load. Rewrite that path to
* float32 in place, without changing any message length:
*   - the Cast target becomes FLOAT (a one-byte varint either way);
*   - the constant's data_type becomes FLOAT and its 8-byte raw_data becomes 4 bytes plus an
*     unused 4-byte protobuf field (parsers skip unknown fields);
*   - value_info entries for the retyped tensors get elem_type FLOAT.
* Scores are unchanged: -1e6 is exact in float32. Works for the q8, q4f16 and fp16 files.
*/
function patchOwlv2Float64(model) {
	const castNode = indexOf(model, hex("1a10" + ascii("/class_head/Cast") + "2204" + ascii("Cast")));
	if (castNode < 0) return model;
	const castTo = indexOf(model, hex("0a02" + ascii("to") + "180b"), castNode, castNode + 256);
	if (castTo < 0) return model;
	const out = model.slice();
	out[castTo + 5] = 1;
	const rawDouble = hex("4a080000000080842ec1");
	const rawFloat = hex("4a04002474c998068001");
	const attr = indexOf(out, hex("100b").concat(rawDouble));
	if (attr >= 0) {
		out[attr + 1] = 1;
		out.set(rawFloat, attr + 2);
	}
	const name = hex("4220" + ascii("/class_head/Constant_11_output_0"));
	const init = indexOf(out, name);
	if (init >= 2 && out[init - 2] === 16 && out[init - 1] === 11 && startsWith(out, rawDouble, init + name.length)) {
		out[init - 1] = 1;
		out.set(rawFloat, init + name.length);
	}
	for (const tensor of [
		"/class_head/Cast_output_0",
		"/class_head/Where_output_0",
		"/class_head/Constant_11_output_0"
	]) {
		const bytes = ascii(tensor);
		const header = hex((bytes.length / 2).toString(16).padStart(2, "0") + bytes + "12");
		for (let from = 0, i; (i = indexOf(out, header, from)) >= 0; from = i + 1) {
			if (out[i - 1] !== 10) continue;
			const at = indexOf(out, [8, 11], i + header.length, i + header.length + 12);
			if (at >= 0) out[at + 1] = 1;
		}
	}
	return out;
}
function ascii(s) {
	return [...s].map((ch) => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("");
}
function hex(s) {
	return s.match(/../g).map((b) => parseInt(b, 16));
}
function startsWith(hay, needle, at) {
	return needle.every((b, j) => hay[at + j] === b);
}
function indexOf(hay, needle, from = 0, to = hay.length) {
	const end = Math.min(to, hay.length - needle.length);
	for (let i = hay.indexOf(needle[0], from); i >= 0 && i <= end; i = hay.indexOf(needle[0], i + 1)) if (startsWith(hay, needle, i)) return i;
	return -1;
}
//#endregion
//#region src/core/runtime/web.ts
var ORT_VERSION = "1.30.0";
var TIER2_MIN_SCORE = {
	fp16: .25,
	q8: .3,
	q4f16: .3
};
function hasWebGPU() {
	return typeof navigator !== "undefined" && !!navigator.gpu;
}
/** A FaceFramer wired to onnxruntime-web. Nothing is downloaded until it is needed. */
function createWebFramer(opts = {}) {
	const sources = opts.sources ?? [localSource(), remoteSource];
	const devices = opts.devices ?? (hasWebGPU() ? ["webgpu", "wasm"] : ["wasm"]);
	const gpu = devices[0] === "webgpu";
	const variant = opts.tier2Variant ?? (gpu ? "fp16" : "q8");
	const tier2Enabled = opts.tier2 ?? gpu;
	let ortPromise;
	const ort = () => ortPromise ??= (opts.loadOrt ?? (() => import("onnxruntime-web/webgpu")))().then((m) => {
		m.env.wasm.wasmPaths ??= opts.wasmPaths ?? `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;
		return m;
	});
	const tier1 = async () => {
		const runtime = await ort();
		const models = [];
		for (const spec of TIER1_MODELS) {
			const session = await createSession(runtime, await fetchModel(spec.file, sources), devices);
			models.push({
				id: spec.id,
				session,
				threshold: spec.threshold
			});
		}
		return new Tier1Detector(runtime, models);
	};
	const tier2 = !tier2Enabled ? void 0 : async () => {
		const runtime = await ort();
		const session = await createSession(runtime, patchOwlv2Float64(new Uint8Array(await fetchModel(tier2Model(variant), sources))), devices);
		return { async detect(px) {
			const small = resizePixels(px, 1024);
			const k = px.width / small.width;
			return (await runOwlv2(runtime, session, small, {
				mode: opts.tier2Mode ?? "pad",
				source: TIER2_MODEL_ID
			})).map((c) => ({
				...c,
				box: {
					x: c.box.x * k,
					y: c.box.y * k,
					width: c.box.width * k,
					height: c.box.height * k
				}
			}));
		} };
	};
	const tier2MinScore = opts.tier2MinScore ?? TIER2_MIN_SCORE[variant];
	return new FaceFramer({
		...opts,
		tier1,
		tier2,
		tier2MinScore
	});
}
async function createSession(ort, bytes, devices) {
	let lastError;
	for (const device of devices) try {
		return await ort.InferenceSession.create(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { executionProviders: [device] });
	} catch (e) {
		lastError = e;
		console.warn(`face-frame: ${device} session failed, trying next`, e);
	}
	throw lastError;
}
/**
* S3 only sends `Vary: Origin` on CORS requests, so an image the page (or Foundry's
* canvas) loaded without CORS can sit in the HTTP cache without CORS headers and make a
* CORS fetch fail. Retry once bypassing the cache.
*/
async function fetchImage(url) {
	let res;
	try {
		res = await fetch(url, { mode: "cors" });
	} catch {
		res = await fetch(url, {
			mode: "cors",
			cache: "reload"
		});
	}
	if (!res.ok) throw new Error(`face-frame: ${url} returned HTTP ${res.status}`);
	return res.blob();
}
/**
* Decodes an image URL or blob into RGBA pixels. Cross-origin URLs need CORS
* (Foundry's S3 setup already requires it for canvas textures).
*/
async function loadPixels(src) {
	const blob = typeof src === "string" ? await fetchImage(src) : src;
	const bitmap = await createImageBitmap(blob, {
		premultiplyAlpha: "none",
		colorSpaceConversion: "none"
	});
	try {
		const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d", { willReadFrequently: true });
		ctx.drawImage(bitmap, 0, 0);
		const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
		return {
			data,
			width: bitmap.width,
			height: bitmap.height
		};
	} finally {
		bitmap.close();
	}
}
//#endregion
//#region src/core/index.ts
var VERSION = "0.1.0";
//#endregion
export { DEFAULT_EYE_IN_HEAD, FaceFramer, OWLV2_PROMPTS, PRESETS, TIER1_MODELS, TIER2_MODEL, TIER2_MODEL_ID, Tier1Detector, VERSION, computeCrop, createWebFramer, cropPixels, detectRingFrame, fetchModel, hasTransparency, hasWebGPU, iou, loadPixels, localSource, nms, patchOwlv2Float64, rankCandidates, refineOpenVocab, remoteSource, resizePixels, runOwlv2, saliencyCandidate, scoreCandidate, subjectResult, tier2Model };
