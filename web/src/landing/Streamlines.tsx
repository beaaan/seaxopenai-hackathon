import { useEffect, useRef, type ReactNode } from "react";

interface Particle {
  x: number;
  lane: number;
  speed: number;
  phase: number;
}

const COUNT = 48;
/** Below this the flow is laminar; chapters marked `data-turbulent` stir it. */
const CALM = 3;
const ROUGH = 16;

/**
 * Faint streamlines drifting left to right behind the page, like smoke in a wind tunnel. Chapters about misreading
 * carry `data-turbulent`, and while one is on screen the lines wobble harder. Static under reduced motion.
 */
export function Streamlines(): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let w = 0;
    let h = 0;
    const resize = (): void => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const particles: Particle[] = Array.from({ length: COUNT }, (_, i) => ({
      x: Math.random() * w,
      lane: (i + 0.5) / COUNT,
      speed: 0.6 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
    }));

    let target = CALM;
    let amp = CALM;
    const rough = new Set<Element>();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) rough.add(e.target);
        else rough.delete(e.target);
      }
      target = rough.size > 0 ? ROUGH : CALM;
    }, { threshold: 0.35 });
    // Chapters that need the run model mount later; watch the page root for them.
    const observeAll = (): void => {
      for (const el of document.querySelectorAll("[data-turbulent]")) io.observe(el);
    };
    observeAll();
    const mo = new MutationObserver(observeAll);
    if (canvas.parentElement) mo.observe(canvas.parentElement, { childList: true });
    const y = (p: Particle, x: number, t: number): number =>
      p.lane * h + Math.sin(x * 0.006 + t * 0.0003 + p.phase) * amp + Math.sin(x * 0.015 - t * 0.0004 + p.phase * 2) * amp * 0.45;

    let frame = 0;
    const draw = (t: number): void => {
      amp += (target - amp) * 0.02;
      // Fade the previous frame so each particle leaves a short trail.
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 0.045)";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(143, 227, 255, 0.2)";
      ctx.beginPath();
      for (const p of particles) {
        const x0 = p.x;
        p.x += p.speed * 2.2;
        if (p.x > w + 20) p.x = -20;
        if (p.x < x0) continue;
        ctx.moveTo(x0, y(p, x0, t));
        ctx.lineTo(p.x, y(p, p.x, t));
      }
      ctx.stroke();
      frame = requestAnimationFrame(draw);
    };
    const visibility = (): void => {
      cancelAnimationFrame(frame);
      if (!document.hidden) frame = requestAnimationFrame(draw);
    };
    document.addEventListener("visibilitychange", visibility);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      io.disconnect();
      mo.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  return <canvas ref={ref} className="l-flow" aria-hidden="true" />;
}
