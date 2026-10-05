/**
 * PREVIEW ONLY — a three.js stand-in for the Dice So Nice box.
 *
 * In the live feature the die is the roller's own DSN dice, built by DSN's
 * factory inside a DiceBox we mount. Here there is no Foundry and no DSN, so
 * this draws a d20 that is close enough to judge the overlay and — the part
 * that is NOT a stand-in — drives it with the shipped tumble model
 * (scripts/features/spotlight-roll/tumble.mjs).
 *
 * Faces carry their own numbers on a canvas atlas so the landed face can be
 * relabelled as the modifiers tally, which is what the live feature will do
 * to a DSN face.
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { faceQuaternion, tiltedView } from "/scripts/features/spotlight-roll/tumble.mjs";
const VIEW = tiltedView([0, 0, 1], [0, 1, 0]);

const CELL = 256, COLS = 5, ROWS = 4;
const APEX = [128, 26], BL = [20, 214], BR = [236, 214];
const CENTROID = [(APEX[0] + BL[0] + BR[0]) / 3, (APEX[1] + BL[1] + BR[1]) / 3 + 6];

export const SKINS = {
  crystal: { label: "Smoked crystal", body: "#121b29", glyph: "#eaf4ff", edge: "#7d9cc7", metal: 0.05, rough: 0.07, transmission: 0.35, iridescence: 0.45, emissive: 0.85 },
  ivory: { label: "Ivory & gold", body: "#e9e1d0", glyph: "#9a6a12", edge: "#c8a35a", metal: 0.0, rough: 0.32, transmission: 0, iridescence: 0, emissive: 0 },
  obsidian: { label: "Obsidian & ember", body: "#0d0b0c", glyph: "#ff9a4a", edge: "#55302a", metal: 0.25, rough: 0.18, transmission: 0, iridescence: 0.15, emissive: 1.25 },
};

export class PreviewDice {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, premultipliedAlpha: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    this.camera.position.set(0, 0, 14);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.key = new THREE.DirectionalLight(0xffffff, 1.6);
    this.key.position.set(-3, 5, 6);
    this.rim = new THREE.PointLight(0x6b86d6, 0, 12, 1.4);
    this.rim.position.set(0, -1.5, -2.5);
    this.fill = new THREE.PointLight(0xffffff, 0, 10, 1.6);
    this.fill.position.set(0, 0, 4);
    this.scene.add(this.key, this.rim, this.fill);
    this.dice = [];
    this.resize();
  }

  /** Director contract: one die per spec entry. The stand-in draws a d20 for every face count. */
  async createDice(specs) {
    return specs.map((roll) => roll.map((spec) => this.addDie(this.skin)));
  }

  resize(width, height) {
    const w = width ?? (this.canvas.clientWidth || innerWidth), h = height ?? (this.canvas.clientHeight || innerHeight);
    if (w === this.w && h === this.h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.w = w; this.h = h;
    // World units per CSS pixel on the z = 0 plane.
    this.unit = (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * this.camera.position.z) / h;
  }

  clear() {
    for (const d of this.dice) d.dispose();
    this.dice = [];
  }

  addDie(skin = "crystal") {
    const d = new D20(SKINS[skin] ?? SKINS.crystal);
    this.scene.add(d.group);
    this.dice.push(d);
    return d;
  }

  /** Place a die by its centre and diameter in CSS pixels. */
  place(die, { x, y, size }, lift = 0, scale = 1) {
    const u = this.unit;
    die.group.position.set((x - this.w / 2) * u, (this.h / 2 - y) * u, lift * 2.2);
    // An icosahedron of radius 1 spans ~1.9 units vertex to vertex on screen.
    die.group.scale.setScalar((size * u / 1.9) * scale);
  }

  setLights({ rim, rimI = 0, fillI = 0, keyI = 1.6 } = {}) {
    if (rim) this.rim.color.set(rim);
    this.rim.intensity = rimI;
    this.fill.intensity = fillI;
    this.key.intensity = keyI;
  }

  render() { this.renderer.render(this.scene, this.camera); }

  /** Draw once so the programs compile before anything has to move. */
  warm() {
    const d = this.addDie("crystal");
    d.group.visible = true;
    this.render();
    this.clear();
  }
}

class D20 {
  constructor(skin) {
    this.skin = skin;
    this.faceCount = 20;
    const geo = new THREE.IcosahedronGeometry(1, 0); // non-indexed: 20 faces × 3 verts
    const pos = geo.attributes.position;
    this.faces = [];
    for (let f = 0; f < 20; f++) {
      const v = [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k));
      const c = v[0].clone().add(v[1]).add(v[2]).multiplyScalar(1 / 3);
      const n = c.clone().normalize();
      const up = v[0].clone().sub(c).normalize();
      this.faces.push({ index: f, normal: n, up, value: 0 });
    }
    // Opposite faces sum to 21, as on a real d20.
    let next = 1;
    for (const face of this.faces) {
      if (face.value) continue;
      const opp = this.faces.find((o) => !o.value && o !== face && o.normal.dot(face.normal) < -0.99);
      face.value = next; if (opp) opp.value = 21 - next; next++;
    }
    const uv = new Float32Array(20 * 3 * 2);
    for (let f = 0; f < 20; f++) {
      const ox = (f % COLS) * CELL, oy = Math.floor(f / COLS) * CELL;
      [APEX, BL, BR].forEach((p, k) => {
        uv[(f * 3 + k) * 2] = (ox + p[0]) / (COLS * CELL);
        uv[(f * 3 + k) * 2 + 1] = 1 - (oy + p[1]) / (ROWS * CELL);
      });
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    this.geo = geo;

    this.atlas = document.createElement("canvas");
    this.atlas.width = COLS * CELL; this.atlas.height = ROWS * CELL;
    this.glyphs = document.createElement("canvas");
    this.glyphs.width = COLS * CELL; this.glyphs.height = ROWS * CELL;
    this.map = new THREE.CanvasTexture(this.atlas);
    this.map.colorSpace = THREE.SRGBColorSpace;
    this.map.anisotropy = 8;
    this.emap = new THREE.CanvasTexture(this.glyphs);
    this.emap.colorSpace = THREE.SRGBColorSpace;
    for (const face of this.faces) this.drawFace(face.index, String(face.value));

    this.material = new THREE.MeshPhysicalMaterial({
      color: 0xffffff, map: this.map, metalness: skin.metal, roughness: skin.rough,
      transmission: skin.transmission, thickness: 1.4, ior: 1.55,
      clearcoat: 1, clearcoatRoughness: 0.06, iridescence: skin.iridescence, iridescenceIOR: 1.3,
      emissive: new THREE.Color(skin.glyph), emissiveMap: this.emap, emissiveIntensity: skin.emissive,
      envMapIntensity: 1.35, flatShading: true,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: skin.edge, transparent: true, opacity: 0.55 }));
    this.mesh.add(edges);
    this.group = new THREE.Group();
    this.group.add(this.mesh);

    // Shards for the dropped die of a fortune pair: one per face.
    this.shards = this.faces.map((face) => {
      const g = new THREE.BufferGeometry();
      const p = new Float32Array(9), u = new Float32Array(6);
      for (let k = 0; k < 3; k++) {
        p.set([pos.getX(face.index * 3 + k), pos.getY(face.index * 3 + k), pos.getZ(face.index * 3 + k)], k * 3);
        u.set([uv[(face.index * 3 + k) * 2], uv[(face.index * 3 + k) * 2 + 1]], k * 2);
      }
      g.setAttribute("position", new THREE.BufferAttribute(p, 3));
      g.setAttribute("uv", new THREE.BufferAttribute(u, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.material.clone());
      m.material.transparent = true;
      m.visible = false;
      this.group.add(m);
      return { mesh: m, face, spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(), speed: 0.7 + Math.random() * 0.8 };
    });
  }

  drawFace(index, text, { hot = false } = {}) {
    const ox = (index % COLS) * CELL, oy = Math.floor(index / COLS) * CELL;
    for (const [cv, glyphOnly] of [[this.atlas, false], [this.glyphs, true]]) {
      const g = cv.getContext("2d");
      g.save();
      g.beginPath(); g.rect(ox, oy, CELL, CELL); g.clip();
      g.fillStyle = glyphOnly ? "#000" : this.skin.body;
      g.fillRect(ox, oy, CELL, CELL);
      if (!glyphOnly) {
        // A faint inner bevel line so faces read as cut stone, not flat paint.
        g.strokeStyle = this.skin.edge; g.globalAlpha = 0.35; g.lineWidth = 3;
        g.beginPath();
        const k = 0.86, cx = CENTROID[0], cy = CENTROID[1] - 6;
        [APEX, BL, BR].forEach((p, i) => { const x = ox + cx + (p[0] - cx) * k, y = oy + cy + (p[1] - cy) * k; i ? g.lineTo(x, y) : g.moveTo(x, y); });
        g.closePath(); g.stroke(); g.globalAlpha = 1;
      }
      const size = text.length > 2 ? 52 : text.length > 1 ? 66 : 76;
      g.font = `700 ${size}px Oxanium, "Segoe UI", sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillStyle = glyphOnly ? (hot ? "#ffffff" : "#cfcfcf") : this.skin.glyph;
      g.fillText(text, ox + CENTROID[0], oy + CENTROID[1]);
      if (text === "6" || text === "9") g.fillRect(ox + CENTROID[0] - 18, oy + CENTROID[1] + size * 0.42, 36, 5);
      g.restore();
    }
    if (this.map) { this.map.needsUpdate = true; this.emap.needsUpdate = true; }
  }

  faceFor(value) { return this.faces.find((f) => f.value === value) ?? this.faces[0]; }

  /** The orientation that shows `value` to the camera, upright. */
  targetFor(value) {
    const f = this.faceFor(value);
    return faceQuaternion(f.normal.toArray(), f.up.toArray(), VIEW, [0, 1, 0]);
  }

  setPose(q) { this.mesh.quaternion.set(q[0], q[1], q[2], q[3]); }

  /** Relabel the face that is showing — the modifier tally counts on the die. */
  relabel(value, text, hot) {
    const key = `${value}:${text}:${hot}`;
    if (this._label === key) return;
    this._label = key;
    this.drawFace(this.faceFor(value).index, text, { hot });
  }

  /** Seekable shatter, p in 0..1. */
  shatter(p) {
    this.mesh.visible = p <= 0;
    for (const s of this.shards) {
      s.mesh.visible = p > 0 && p < 1;
      if (!s.mesh.visible) continue;
      const e = 1 - Math.pow(1 - p, 2.2);
      s.mesh.quaternion.copy(this.mesh.quaternion);
      const n = s.face.normal.clone().applyQuaternion(this.mesh.quaternion);
      s.mesh.position.copy(n.multiplyScalar(e * 2.4 * s.speed)).add(new THREE.Vector3(0, -e * e * 1.2, 0));
      s.mesh.rotateOnAxis(s.spin, e * 3.5 * s.speed);
      s.mesh.material.opacity = 1 - p;
      s.mesh.scale.setScalar(1 - p * 0.35);
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    this.geo.dispose(); this.material.dispose(); this.map.dispose(); this.emap.dispose();
    for (const s of this.shards) { s.mesh.geometry.dispose(); s.mesh.material.dispose(); }
  }
}
