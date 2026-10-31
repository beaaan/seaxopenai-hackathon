import { useEffect, useRef, useState, type ReactNode } from "react";

interface Chapter {
  el: HTMLElement;
  label: string;
}

/** Story progress at the right edge: one dot per `[data-chapter]` section, the one in mid-screen lit; click to jump. */
export function ChapterRail(): ReactNode {
  const ref = useRef<HTMLElement>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [active, setActive] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = ref.current?.parentElement;
    if (!root) return;
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) setActive(e.target as HTMLElement);
    }, { rootMargin: "-50% 0px -50% 0px" });
    // Chapters that need the run model mount later, so re-read the list whenever the root's children change.
    const scan = (): void => {
      const found = [...root.querySelectorAll<HTMLElement>(":scope > section[data-chapter]")];
      setChapters(found.map((el) => ({ el, label: el.dataset.chapter ?? "" })));
      for (const el of found) io.observe(el);
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true });
    return () => {
      io.disconnect();
      mo.disconnect();
    };
  }, []);

  return (
    <nav ref={ref} className="l-rail" aria-label="Chapters">
      {chapters.map((c) => (
        <button
          key={c.label}
          type="button"
          className={c.el === active ? "on" : undefined}
          aria-current={c.el === active ? "step" : undefined}
          onClick={() => c.el.scrollIntoView({ behavior: "smooth" })}
        >
          <span>{c.label}</span>
          <i />
        </button>
      ))}
    </nav>
  );
}
