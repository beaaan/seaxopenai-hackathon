import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { Cluster, Grade, Reading, Scenario, Sentence } from "@shared/schema";

/** Colours: what readers had heard, and how each interpretation was graded against the reference. */
export const TINT = {
  rumour: new THREE.Color("#ffb347"),
  nothing: new THREE.Color("#8fe3ff"),
  spark: new THREE.Color("#ffffff"),
  consistent: new THREE.Color("#4fd1a5"),
  outside: new THREE.Color("#ffb347"),
  conflicts: new THREE.Color("#ff5d5d"),
  unclear: new THREE.Color("#9aa0a6"),
  slab: new THREE.Color("#3d5a80"),
  orb: new THREE.Color("#bfe6ff"),
  hit: new THREE.Color("#ffd28a"),
};

const READERS_AT = new THREE.Vector3(-7.6, 0, 0);
const BELIEFS_AT = new THREE.Vector3(6.4, 0, -1.2);
const COLUMN_X = 7.9;
const HOLDING_AT = new THREE.Vector3(4.2, 0, 0);
/** The largest belief clusters stand in a labelled column; the rest float behind them. */
const COLUMN = 6;
const MAX_FLIGHT_POINTS = 9000;
const TRAIL = 9;
const MAX_SPARKS = 1600;

interface Flight {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3; // control point
  t0: number;
  duration: number;
  color: THREE.Color;
  size: number;
  arrive?: () => void;
  done: boolean;
}

interface Spark {
  id: string;
  pos: THREE.Vector3;
  target: THREE.Vector3;
  color: THREE.Color;
  goal: THREE.Color;
  phase: number;
  visible: boolean;
}

interface Orb {
  id: string;
  mesh: THREE.Mesh;
  center: THREE.Vector3;
  radius: number;
  label: HTMLDivElement;
  readers: number;
  born: number;
  dying: number | null;
}

const POINT_VERTEX = `
attribute float alpha;
attribute float size;
attribute vec3 tint;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * (300.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const POINT_FRAGMENT = `
varying float vAlpha;
varying vec3 vTint;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.0, d);
  a = a * a * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vTint * (0.6 + 0.8 * a), a);
}`;

/** A pool of soft additive points with per-point position, colour, size and alpha. */
class PointCloud {
  readonly positions: Float32Array;
  readonly tints: Float32Array;
  readonly sizes: Float32Array;
  readonly alphas: Float32Array;
  readonly geometry = new THREE.BufferGeometry();
  readonly material: THREE.ShaderMaterial;
  readonly points: THREE.Points;
  constructor(readonly capacity: number) {
    this.positions = new Float32Array(capacity * 3);
    this.tints = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute("tint", new THREE.BufferAttribute(this.tints, 3));
    this.geometry.setAttribute("size", new THREE.BufferAttribute(this.sizes, 1));
    this.geometry.setAttribute("alpha", new THREE.BufferAttribute(this.alphas, 1));
    this.material = new THREE.ShaderMaterial({ vertexShader: POINT_VERTEX, fragmentShader: POINT_FRAGMENT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }
  set(i: number, p: THREE.Vector3, c: THREE.Color, size: number, alpha: number): void {
    this.positions[i * 3] = p.x;
    this.positions[i * 3 + 1] = p.y;
    this.positions[i * 3 + 2] = p.z;
    this.tints[i * 3] = c.r;
    this.tints[i * 3 + 1] = c.g;
    this.tints[i * 3 + 2] = c.b;
    this.sizes[i] = size;
    this.alphas[i] = alpha;
  }
  commit(count: number): void {
    this.geometry.setDrawRange(0, count);
    for (const name of ["position", "tint", "size", "alpha"]) this.geometry.getAttribute(name).needsUpdate = true;
  }
  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

function hash(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Point `i` of `n` on a Fibonacci sphere. */
function sphere(i: number, n: number, radius: number, squash = 1): THREE.Vector3 {
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(1 - y * y);
  const theta = i * 2.399963;
  return new THREE.Vector3(Math.cos(theta) * r * radius * 0.75, y * radius * squash, Math.sin(theta) * r * radius);
}

/**
 * The run as a scene: readers on the left, the policy's sentences in the middle, beliefs on the right. Events drive it;
 * nothing moves that the log did not record.
 */
export class TheatreScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly passes: Array<{ dispose(): void }>;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  private readonly root = new THREE.Group();
  private readonly flights = new PointCloud(MAX_FLIGHT_POINTS);
  private readonly sparkCloud = new PointCloud(MAX_SPARKS);
  private readonly readerCloud = new PointCloud(400);
  private readonly dust = new PointCloud(1400);
  private active: Flight[] = [];
  private sparks: Spark[] = [];
  private sparkById = new Map<string, Spark>();
  private readers: Array<{ id: string; pos: THREE.Vector3; color: THREE.Color; born: number; pulse: number }> = [];
  private readerIndex = new Map<string, number>();
  private slabs: Array<{ id: string; mesh: THREE.Mesh; y: number; heat: number; label: HTMLDivElement }> = [];
  private gapSlab: { mesh: THREE.Mesh; heat: number; label: HTMLDivElement } | null = null;
  private orbs: Orb[] = [];
  private tags: Array<{ el: HTMLDivElement; at: THREE.Vector3; until: number }> = [];
  private time = 0;
  private thoughts = 0;
  private framing = { back: 1, lift: 0 };
  private w = 1;
  private h = 1;
  private readerTotal = 50;
  private readonly still: boolean;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly overlay: HTMLDivElement) {
    this.still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x05070b, 1);
    this.scene.add(this.root);
    for (const cloud of [this.dust, this.flights, this.sparkCloud, this.readerCloud]) this.root.add(cloud.points);
    this.camera.position.set(0, -1.6, 25);
    this.composer = new EffectComposer(this.renderer);
    const render = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.7, 0.5, 0.16);
    const output = new OutputPass();
    this.passes = [render, this.bloom, output];
    for (const pass of [render, this.bloom, output]) this.composer.addPass(pass);
    this.seedDust();
  }

  /** Back the camera off by `back` and raise the content by `lift` of the height, for panels that own the bottom. */
  setFraming(back: number, lift: number): void {
    this.framing = { back, lift };
    if (this.w > 1) this.resize(this.w, this.h);
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.bloom.resolution.set(w, h);
    this.camera.aspect = w / h;
    // Content sits in the upper two thirds; panels own the bottom. Narrower screens back the camera off.
    this.camera.position.z = 25 * Math.max(1, 1.7 / (w / h)) * this.framing.back;
    if (this.framing.lift) this.camera.setViewOffset(w, h, 0, this.framing.lift * h, w, h);
    this.camera.updateProjectionMatrix();
  }

  setReaderTotal(n: number): void {
    this.readerTotal = Math.max(n, 1);
  }

  /** Clear every event-driven object; the dust stays. */
  reset(): void {
    this.active = [];
    this.dropSlabs();
    for (const o of this.orbs) this.dropOrb(o);
    this.orbs = [];
    for (const t of this.tags) t.el.remove();
    this.tags = [];
    this.sparks = [];
    this.sparkById.clear();
    this.readers = [];
    this.readerIndex.clear();
  }

  // -------------------------------------------------------------------------
  // Event handlers. `instant` applies the end state without animation (skipping ahead).

  private dropSlabs(): void {
    for (const s of this.slabs) {
      this.root.remove(s.mesh);
      s.mesh.geometry.dispose();
      (s.mesh.material as THREE.Material).dispose();
      s.label.remove();
    }
    this.slabs = [];
    if (this.gapSlab) {
      this.root.remove(this.gapSlab.mesh);
      this.gapSlab.mesh.geometry.dispose();
      (this.gapSlab.mesh.material as THREE.Material).dispose();
      this.gapSlab.label.remove();
      this.gapSlab = null;
    }
  }

  policy(sentences: readonly Sentence[]): void {
    this.dropSlabs();
    const n = sentences.length;
    const span = Math.min(7.2, n * 0.62);
    this.slabs = sentences.map((s, i) => {
      const y = span / 2 - (span * i) / Math.max(1, n - 1);
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(3.6, Math.min(0.42, (span / n) * 0.72)),
        new THREE.MeshBasicMaterial({ color: TINT.slab, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      mesh.position.set(0, y, 0);
      this.root.add(mesh);
      const label = this.label("slab", `<b>${escape(s.id)}</b> ${escape(clip(s.text, 64))}`);
      return { id: s.id, mesh, y, heat: 1.2 + i * 0.08, label };
    });
    const gap = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 0.3),
      new THREE.MeshBasicMaterial({ color: TINT.rumour, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    gap.position.set(0, -span / 2 - 0.9, 0);
    this.root.add(gap);
    this.gapSlab = { mesh: gap, heat: 0, label: this.label("slab gap", "<b>not in the text</b> what readers filled in themselves") };
  }

  reader(s: Scenario, instant: boolean, heard: string | null): void {
    if (this.readerIndex.has(s.id)) return;
    const i = this.readers.length;
    const pos = sphere(i, Math.max(this.readerTotal, i + 1), 2.7, 1.15).add(READERS_AT);
    const color = s.exposure.folkVersionId ? TINT.rumour : TINT.nothing;
    this.readers.push({ id: s.id, pos, color, born: instant ? -10 : this.time, pulse: 0 });
    this.readerIndex.set(s.id, i);
    if (!instant) {
      const text = `<b>${escape(s.persona.name)}, ${s.persona.age}</b><span>${escape(s.persona.occupation)} · ${escape(s.persona.province)}</span>${heard ? `<em>heard: “${escape(clip(heard, 54))}”</em>` : "<span>heard nothing about the rule</span>"}`;
      this.tag("persona", text, pos.clone().add(new THREE.Vector3(0, 0.25, 0)), 1.6);
    }
  }

  read(r: Reading, retest: boolean, instant: boolean): void {
    const ri = this.readerIndex.get(r.scenarioId);
    const reader = ri === undefined ? null : this.readers[ri]!;
    const from = reader?.pos ?? READERS_AT.clone();
    const color = reader?.color ?? TINT.spark;
    if (reader && !instant) reader.pulse = 1;
    // A re-read measures variation and a rewrite's reading refers to another version's sentences: neither adds beliefs.
    const beliefs = !retest && r.policyVersion === 0;
    // Every few readings, the reader's own words float up: the interpretation it formed outside the text if any.
    if (beliefs && !instant && reader && this.thoughts++ % 3 === 0) {
      const it = r.interpretations.find((x) => x.sentenceId === null) ?? r.interpretations[0];
      if (it) {
        const said = it.glossEn.split(/(?<=[.;!?])\s|,\s(?:but|so)\s/)[0] ?? it.glossEn;
        this.tag(it.sentenceId === null ? "thought gap" : "thought", `“${escape(clip(said, 92))}”`, reader.pos.clone().add(new THREE.Vector3(0, 0.25, 0)), 1.1);
      }
    }
    for (const [k, it] of r.interpretations.entries()) {
      const slab = this.slabs.find((s) => s.id === it.sentenceId);
      const hitAt = slab ? new THREE.Vector3((hash(k, 3) - 0.5) * 2.6, slab.y, 0.05) : this.gapSlab ? this.gapSlab.mesh.position.clone().add(new THREE.Vector3((hash(k, 4) - 0.5) * 2.6, 0, 0)) : new THREE.Vector3();
      // The interpretation exists from now on, so grades and clusters that arrive mid-flight still apply to it.
      const spark = beliefs ? this.spawnSpark(it.id, hitAt, instant) : null;
      const land = (): void => {
        if (slab) slab.heat = Math.min(2.2, slab.heat + 0.7);
        else if (this.gapSlab) this.gapSlab.heat = Math.min(2.2, this.gapSlab.heat + 0.7);
        if (spark && !spark.visible) {
          spark.pos.copy(hitAt);
          spark.visible = true;
        }
      };
      if (instant) {
        land();
        continue;
      }
      const delay = k * 0.12;
      this.fly(from, hitAt, color, beliefs ? 1.1 : 0.75, delay, beliefs ? 1 : 0.55, land);
    }
  }

  grade(grades: readonly Grade[], instant: boolean): void {
    for (const g of grades) {
      const s = this.sparkById.get(g.interpretationId);
      if (!s) continue;
      s.goal = TINT[g.label as keyof typeof TINT] ?? TINT.unclear;
      if (instant) s.color.copy(s.goal);
    }
  }

  clusters(clusters: readonly Cluster[], readerCount: (c: Cluster) => number, instant: boolean): void {
    const sorted = [...clusters].sort((a, b) => readerCount(b) - readerCount(a));
    const keep = new Set(sorted.map((c) => c.id));
    for (const o of this.orbs) if (!keep.has(o.id) && o.dying === null) o.dying = this.time;
    const n = sorted.length;
    sorted.forEach((c, i) => {
      const readers = readerCount(c);
      const center = i < COLUMN ? new THREE.Vector3(COLUMN_X, 3.1 - i * 1.15, 0.4) : sphere(i - COLUMN, Math.max(n - COLUMN, 8), 2.3, 1.25).add(BELIEFS_AT);
      const radius = 0.1 + 0.075 * Math.sqrt(readers);
      let orb = this.orbs.find((o) => o.id === c.id && o.dying === null);
      if (!orb) {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(1, 24, 16),
          new THREE.MeshBasicMaterial({ color: c.conflictShare > 0.3 ? TINT.conflicts : TINT.orb, transparent: true, opacity: 0.0, depthWrite: false, blending: THREE.AdditiveBlending }),
        );
        mesh.position.copy(center);
        this.root.add(mesh);
        orb = { id: c.id, mesh, center, radius, label: this.label("orb", ""), readers, born: instant ? -10 : this.time, dying: null };
        this.orbs.push(orb);
      }
      orb.center.copy(center);
      orb.radius = radius;
      orb.readers = readers;
      orb.label.innerHTML = i < COLUMN && readers >= 2 ? `<b>${readers}</b> ${escape(clip(c.labelEn, 78))}` : "";
      for (const [k, id] of c.interpretationIds.entries()) {
        const s = this.sparkById.get(id);
        if (!s) continue;
        s.target = center.clone().add(sphere(k, Math.max(4, c.interpretationIds.length), radius * 1.9));
        if (instant) s.pos.copy(s.target);
      }
    });
  }

  /** The agent decided which readers to add next: a sweep across the reader cloud. */
  agentPulse(): void {
    for (const r of this.readers) r.pulse = Math.max(r.pulse, 0.6);
  }

  /** Findings landed: the orbs holding them flare. */
  findingsLanded(): void {
    for (const o of this.orbs.slice(0, 8)) o.born = this.time - 0.2;
  }

  // -------------------------------------------------------------------------

  private label(kind: string, html: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = `t-label ${kind}`;
    el.innerHTML = html;
    this.overlay.appendChild(el);
    return el;
  }

  private tag(kind: string, html: string, at: THREE.Vector3, seconds: number): void {
    const el = this.label(`tag ${kind}`, html);
    this.tags.push({ el, at, until: this.time + seconds });
    // Keep at most a few transient tags on screen.
    while (this.tags.length > 1) this.tags.shift()!.el.remove();
  }

  /** Create an interpretation's spark; it stays hidden until its flight lands (`instant` shows it at once). */
  private spawnSpark(id: string, at: THREE.Vector3, instant: boolean): Spark | null {
    const existing = this.sparkById.get(id);
    if (existing) return existing;
    if (this.sparks.length >= MAX_SPARKS) return null;
    const i = this.sparks.length;
    // Concentric shells of 160, so any number of interpretations has a place to wait.
    const target = HOLDING_AT.clone().add(sphere(i % 160, 160, 1.3 + Math.floor(i / 160) * 0.35, 1.6));
    const spark: Spark = { id, pos: instant ? target.clone() : at.clone(), target, color: TINT.spark.clone(), goal: TINT.spark.clone(), phase: hash(i, 9) * Math.PI * 2, visible: instant };
    this.sparks.push(spark);
    this.sparkById.set(id, spark);
    return spark;
  }

  private fly(a: THREE.Vector3, b: THREE.Vector3, color: THREE.Color, duration: number, delay: number, size: number, arrive?: () => void): void {
    const mid = a.clone().lerp(b, 0.5);
    mid.y += 1.2 + Math.random() * 1.2;
    mid.z += (Math.random() - 0.5) * 3;
    this.active.push({ a: a.clone(), b: b.clone(), c: mid, t0: this.time + delay, duration, color, size, arrive, done: false });
  }

  private dropOrb(o: Orb): void {
    this.root.remove(o.mesh);
    o.mesh.geometry.dispose();
    (o.mesh.material as THREE.Material).dispose();
    o.label.remove();
  }

  private seedDust(): void {
    const v = new THREE.Vector3();
    const c = new THREE.Color("#2b4a6f");
    for (let i = 0; i < this.dust.capacity; i++) {
      v.set((hash(i, 1) - 0.5) * 60, (hash(i, 2) - 0.5) * 34, -6 - hash(i, 3) * 30);
      this.dust.set(i, v, c, 0.6 + hash(i, 4) * 1.4, 0.25 + hash(i, 5) * 0.35);
    }
    this.dust.commit(this.dust.capacity);
  }

  // -------------------------------------------------------------------------

  frame(dt: number): void {
    this.time += dt;
    const t = this.time;
    const sway = this.still ? 0 : 1;
    this.root.rotation.y = Math.sin(t * 0.07) * 0.09 * sway;
    this.root.rotation.x = Math.sin(t * 0.05) * 0.03 * sway;
    this.dust.points.rotation.y = t * 0.004 * sway;

    // Readers.
    const tmp = new THREE.Vector3();
    this.readers.forEach((r, i) => {
      const age = t - r.born;
      const grow = Math.min(1, age / 0.5);
      const flash = age < 0.6 ? (0.6 - age) * 6 : 0;
      r.pulse = Math.max(0, r.pulse - dt * 1.4);
      tmp.copy(r.pos);
      tmp.y += Math.sin(t * 0.8 + i) * 0.04 * sway;
      this.readerCloud.set(i, tmp, r.color, (1.6 + flash * 3 + r.pulse * 3) * grow, 0.95);
    });
    this.readerCloud.commit(this.readers.length);

    // Flights with trails.
    let p = 0;
    const pos = new THREE.Vector3();
    for (const f of this.active) {
      const u = (t - f.t0) / f.duration;
      if (u < 0) continue;
      if (u >= 1) {
        if (!f.done) {
          f.done = true;
          f.arrive?.();
        }
        continue;
      }
      for (let k = 0; k < TRAIL && p < MAX_FLIGHT_POINTS; k++) {
        const v = Math.max(0, u - k * 0.022);
        bezier(f.a, f.c, f.b, ease(v), pos);
        this.flights.set(p++, pos, f.color, (2.6 - k * 0.22) * f.size, (1 - k / TRAIL) * 0.9);
      }
    }
    this.active = this.active.filter((f) => !f.done);
    this.flights.commit(p);

    // Sparks drift toward their target and settle into their grade colour.
    this.sparks.forEach((s, i) => {
      if (s.visible) s.pos.lerp(s.target, Math.min(1, dt * 2.2));
      s.color.lerp(s.goal, Math.min(1, dt * 3));
      tmp.copy(s.pos);
      tmp.x += Math.cos(t * 0.9 + s.phase) * 0.05 * sway;
      tmp.y += Math.sin(t * 1.1 + s.phase) * 0.05 * sway;
      this.sparkCloud.set(i, tmp, s.color, 1.5, s.visible ? 0.9 : 0);
    });
    this.sparkCloud.commit(this.sparks.length);

    // Sentences glow when hit, then cool.
    for (const s of this.slabs) {
      s.heat = Math.max(0, s.heat - dt * 0.9);
      const m = s.mesh.material as THREE.MeshBasicMaterial;
      m.opacity = 0.16 + Math.min(1, s.heat) * 0.4;
      m.color.copy(TINT.slab).lerp(TINT.hit, Math.min(1, s.heat));
      s.label.classList.toggle("hot", s.heat > 0.35);
    }
    if (this.gapSlab) {
      this.gapSlab.heat = Math.max(0, this.gapSlab.heat - dt * 0.9);
      (this.gapSlab.mesh.material as THREE.MeshBasicMaterial).opacity = 0.08 + Math.min(1, this.gapSlab.heat) * 0.4;
      this.gapSlab.label.classList.toggle("hot", this.gapSlab.heat > 0.35);
    }

    // Belief orbs breathe; dying ones fade out.
    for (const o of this.orbs) {
      const m = o.mesh.material as THREE.MeshBasicMaterial;
      const age = t - o.born;
      const flare = age < 1.2 ? (1.2 - age) * 0.5 : 0;
      const fade = o.dying === null ? 1 : Math.max(0, 1 - (t - o.dying) / 0.8);
      o.mesh.position.lerp(o.center, Math.min(1, dt * 2));
      o.mesh.scale.setScalar(o.radius * (1 + Math.sin(t * 1.3 + o.radius * 9) * 0.05 * sway));
      m.opacity = (0.16 + flare) * fade;
    }
    for (const o of this.orbs.filter((x) => x.dying !== null && t - x.dying > 0.8)) this.dropOrb(o);
    this.orbs = this.orbs.filter((x) => x.dying === null || t - x.dying <= 0.8);

    this.composer.render();
    this.placeLabels();
  }

  private placeLabels(): void {
    const v = new THREE.Vector3();
    const put = (el: HTMLElement, world: THREE.Vector3): void => {
      v.copy(world);
      this.root.localToWorld(v);
      v.project(this.camera);
      const x = (v.x * 0.5 + 0.5) * this.w;
      const y = (-v.y * 0.5 + 0.5) * this.h;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    };
    for (const s of this.slabs) put(s.label, new THREE.Vector3(-1.75, s.y, 0.1));
    if (this.gapSlab) put(this.gapSlab.label, this.gapSlab.mesh.position.clone().add(new THREE.Vector3(-1.75, 0, 0.1)));
    for (const o of this.orbs) put(o.label, o.mesh.position.clone().add(new THREE.Vector3(o.radius * 1.4 + 0.1, 0, 0)));
    for (const tag of this.tags) {
      put(tag.el, tag.at);
      tag.el.style.opacity = this.time > tag.until ? "0" : "1";
    }
    this.tags = this.tags.filter((tag) => {
      if (this.time > tag.until + 0.5) {
        tag.el.remove();
        return false;
      }
      return true;
    });
  }

  dispose(): void {
    this.reset();
    for (const cloud of [this.dust, this.flights, this.sparkCloud, this.readerCloud]) cloud.dispose();
    for (const pass of this.passes) pass.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}

function ease(u: number): number {
  return u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
}

function bezier(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, u: number, out: THREE.Vector3): void {
  const k = 1 - u;
  out.set(k * k * a.x + 2 * k * u * c.x + u * u * b.x, k * k * a.y + 2 * k * u * c.y + u * u * b.y, k * k * a.z + 2 * k * u * c.z + u * u * b.z);
}

function clip(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n).replace(/\s+\S*$/, "")}…`;
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
}
