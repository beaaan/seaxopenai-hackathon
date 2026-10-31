import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import type { TunnelData } from "./tunnel";

const RUMOUR = new THREE.Color("#e3a857");
const NOTHING = new THREE.Color("#b9d3d6");
const PARTICLES = 16;
const POINTS_PER_PATH = 160;

interface Geometry {
  w: number;
  h: number;
  phone: boolean;
  textLeft: number;
  textRight: number;
  rowTop: number;
  rowH: number;
  poolX: number;
  poolY: number[];
  gapY: number;
}

function layout(w: number, h: number, data: TunnelData): Geometry {
  const phone = w < 640;
  const textLeft = w * (phone ? 0.24 : 0.27);
  const textRight = w * (phone ? 0.5 : 0.55);
  const rowTop = h * 0.07;
  const rowH = (h * 0.8) / data.sentences.length;
  const poolX = w * (phone ? 0.58 : 0.63);
  const n = data.pools.length;
  const poolY = data.pools.map((_, i) => h * (0.1 + (0.8 * i) / Math.max(1, n - 1)));
  return { w, h, phone, textLeft, textRight, rowTop, rowH, poolX, poolY, gapY: h * 0.94 };
}

/** Deterministic jitter so the picture is the same on every load. */
function jitter(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x) - 0.5;
}

/** Where stream `i` crosses the text: its misreading's sentence, below the text when the text never says it, else its own lane. */
function crossing(g: Geometry, data: TunnelData, i: number): number {
  const stream = data.streams[i]!;
  const pool = data.pools[stream.pool]!;
  const lane = g.rowTop + (g.rowH * data.sentences.length * (i + 0.5)) / data.streams.length;
  if (pool.role !== "misreading") return lane;
  if (pool.sentenceIndex === null) return g.gapY + jitter(i, 3) * g.h * 0.03;
  return g.rowTop + g.rowH * (pool.sentenceIndex + 0.5) + jitter(i, 2) * g.rowH * 0.6;
}

function path(g: Geometry, data: TunnelData, i: number): THREE.Vector3[] {
  const stream = data.streams[i]!;
  const lane = g.h * (0.05 + (0.9 * (i + 0.5)) / data.streams.length);
  const cross = crossing(g, data, i);
  const pool = g.poolY[stream.pool]! + jitter(i, 1) * Math.min(18, g.h * 0.03);
  const mid = (g.textLeft + g.textRight) / 2;
  const v = (x: number, y: number): THREE.Vector3 => new THREE.Vector3(x, -y, 0);
  const curve = new THREE.CatmullRomCurve3([
    v(0, lane),
    v(g.textLeft * 0.45, lane * 0.7 + cross * 0.3),
    v(g.textLeft - 12, cross),
    v(mid, cross + jitter(i, 4) * 4),
    v(g.textRight + 12, cross),
    v(g.textRight + (g.poolX - g.textRight) * 0.6, pool * 0.75 + cross * 0.25),
    v(g.poolX, pool),
  ], false, "centripetal");
  return curve.getSpacedPoints(POINTS_PER_PATH - 1);
}

const VERTEX = `
attribute float alpha;
attribute vec3 tint;
uniform float size;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vAlpha = alpha;
  vTint = tint;
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const FRAGMENT = `
varying float vAlpha;
varying vec3 vTint;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  float a = smoothstep(0.5, 0.15, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vTint, a);
}`;

/**
 * Readers as smoke streams through the policy text. Each of the cohort's readers is one stream, coloured by what they
 * had heard before reading; streams bend at the sentence their misreading is traced to and gather by what they came
 * away believing. Hover or focus a destination to light its readers.
 */
export function WindTunnel(props: { data: TunnelData; active: number; onActive: (pool: number) => void }): ReactNode {
  const { data, active, onActive } = props;
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const g = useMemo(() => (size ? layout(size.w, size.h, data) : null), [size, data]);
  const activeRef = useRef(active);
  activeRef.current = active;
  const repaint = useRef<(() => void) | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const w = Math.round(entry.contentRect.width);
      const h = Math.round(entry.contentRect.height);
      setSize((prev) => (prev && prev.w === w && prev.h === h ? prev : { w, h }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const target = canvas.current;
    if (!g || !target) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: target, antialias: true, alpha: true });
    } catch {
      return; // No WebGL: the labels and the text column still carry the content.
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(ratio);
    renderer.setSize(g.w, g.h, false);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(0, g.w, 0, -g.h, -10, 10);

    const paths = data.streams.map((_, i) => path(g, data, i));
    const tints = data.streams.map((s) => (s.folkId === null ? NOTHING : RUMOUR));

    const lines = paths.map((points, i) => {
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({ color: tints[i]!, transparent: true, opacity: 0.16, depthWrite: false });
      const line = new THREE.Line(geometry, material);
      scene.add(line);
      return line;
    });

    const count = paths.length * PARTICLES;
    const positions = new Float32Array(count * 3);
    const alpha = new Float32Array(count);
    const tint = new Float32Array(count * 3);
    const phase = new Float32Array(count);
    const speed = new Float32Array(count);
    for (let s = 0; s < paths.length; s++) {
      for (let p = 0; p < PARTICLES; p++) {
        const k = s * PARTICLES + p;
        phase[k] = (p + jitter(k, 5) * 0.8) / PARTICLES;
        speed[k] = 0.055 + jitter(k, 6) * 0.012;
        tints[s]!.toArray(tint, k * 3);
      }
    }
    const points = new THREE.BufferGeometry();
    points.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    points.setAttribute("alpha", new THREE.BufferAttribute(alpha, 1));
    points.setAttribute("tint", new THREE.BufferAttribute(tint, 3));
    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { size: { value: (g.phone ? 4 : 5) * ratio } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    scene.add(new THREE.Points(points, material));

    const place = (time: number): void => {
      const lit = activeRef.current;
      for (let s = 0; s < paths.length; s++) {
        const on = data.streams[s]!.pool === lit;
        const path = paths[s]!;
        for (let p = 0; p < PARTICLES; p++) {
          const k = s * PARTICLES + p;
          const t = (((phase[k]! + time * speed[k]!) % 1) + 1) % 1;
          const point = path[Math.min(POINTS_PER_PATH - 1, Math.floor(t * POINTS_PER_PATH))]!;
          positions[k * 3] = point.x;
          positions[k * 3 + 1] = point.y;
          // Fade in at the source and out at the destination, so streams read as continuous flow.
          const edge = Math.min(1, t / 0.06, (1 - t) / 0.08);
          alpha[k] = edge * (on ? 0.95 : 0.22);
        }
        (lines[s]!.material as THREE.LineBasicMaterial).opacity = on ? 0.42 : 0.1;
      }
      points.attributes.position!.needsUpdate = true;
      points.attributes.alpha!.needsUpdate = true;
      renderer.render(scene, camera);
    };

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let visible = true;
    const start = performance.now();
    const tick = (): void => {
      place((performance.now() - start) / 1000);
      frame = visible && !document.hidden ? requestAnimationFrame(tick) : 0;
    };
    repaint.current = () => place(still ? 0 : (performance.now() - start) / 1000);
    const resume = (): void => {
      if (!still && visible && !document.hidden && frame === 0) frame = requestAnimationFrame(tick);
    };
    const seen = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      resume();
    });
    seen.observe(target);
    document.addEventListener("visibilitychange", resume);
    place(0);
    resume();

    return () => {
      cancelAnimationFrame(frame);
      seen.disconnect();
      document.removeEventListener("visibilitychange", resume);
      repaint.current = null;
      for (const line of lines) {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      }
      points.dispose();
      material.dispose();
      renderer.dispose();
    };
  }, [g, data]);

  useEffect(() => repaint.current?.(), [active]);

  const lit = data.pools[active];
  const litRow = lit?.role === "misreading" ? lit.sentenceIndex : null;

  return (
    <div className="tunnel" ref={host} data-ui>
      <canvas ref={canvas} className="tunnel-canvas" aria-hidden="true" />
      {g && (
        <>
          <div className="tunnel-text" style={{ left: g.textLeft, width: g.textRight - g.textLeft, top: g.rowTop, height: g.rowH * data.sentences.length }} aria-hidden="true">
            {data.sentences.map((s, i) => (
              <div key={s.id} className={i === litRow ? "lit" : undefined} style={{ height: g.rowH, WebkitLineClamp: g.rowH >= 36 ? 2 : 1 }}>{s.text}</div>
            ))}
          </div>
          {lit?.role === "misreading" && lit.sentenceIndex === null && (
            <div className="tunnel-gap" style={{ left: g.textLeft, width: g.textRight - g.textLeft, top: g.gapY - 10 }}>not in the text</div>
          )}
          <ul className="tunnel-pools" aria-label="What readers came away believing">
            {data.pools.map((pool, i) => (
              <li key={pool.id} style={{ left: g.poolX + 14, top: g.poolY[i]!, width: g.w - g.poolX - 14 }}>
                <button
                  type="button"
                  className={i === active ? "on" : undefined}
                  aria-pressed={i === active}
                  onMouseEnter={() => onActive(i)}
                  onFocus={() => onActive(i)}
                  onClick={() => onActive(i)}
                >
                  <b>{pool.readers}</b>
                  <span>{pool.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
