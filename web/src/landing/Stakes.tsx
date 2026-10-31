import { useEffect, useRef, useState, type ReactNode } from "react";

/** A sourced fact: the number, what it measures, and where it comes from. Every quote was read on the source page. */
export interface Fact {
  /** Numeric value to count up to; the display is `prefix + value + suffix`. */
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Shown instead of the counted number once counting ends (e.g. a range). */
  final?: string;
  claim: string;
  source: string;
  url: string;
}

const MARKET: Fact[] = [
  {
    value: 77.5, decimals: 1, suffix: "%",
    claim: "of Vietnamese online shoppers choose cash on delivery.",
    source: "Ministry of Industry and Trade official, via VietnamBiz, 15/06/2025",
    url: "https://vietnambiz.vn/nghich-ly-tmdt-viet-nam-775-nguoi-tieu-dung-van-chon-thanh-toan-bang-tien-mat-khi-nhan-hang-2025615192910833.htm",
  },
  {
    value: 56, suffix: "%",
    claim: "of 2025 GMV on Vietnam's four largest marketplaces went through Shopee (VND 429.7 trillion in total).",
    source: "Metric, via The Investor, 16/01/2026",
    url: "https://theinvestor.vn/online-retail-sales-in-vietnam-jump-35-to-over-16-bln-in-2025-report-d18140.html",
  },
  {
    value: 12, suffix: "%", final: "8–12%",
    claim: "of online orders end in what the report calls “bom hàng”. The rate depends on category and area.",
    source: "VECOM, via Người Lao Động, 19/07/2025",
    url: "https://tuoitre.vn/nld/nhuc-nhoi-nan-bom-hang-19625071822023801.htm",
  },
  {
    value: 50, prefix: "+", suffix: "%",
    claim: "of the shipping fee again: what GHN charges the shop to return a failed delivery between provinces.",
    source: "Giao Hàng Nhanh (GHN) published tariff",
    url: "https://ghn.vn/blogs/van-de-khac/don-hang-giao-khong-thanh-cong-tra-hang-thi-toi-co-mat-phi-khong",
  },
  {
    value: 8.01, decimals: 2, prefix: "$",
    claim: "per live support contact (phone, chat, email), against about $0.10 for self-service.",
    source: "Gartner, 2019",
    url: "https://emt.gartnerweb.com/ngw/globalassets/en/sales-service/documents/trends/delivering-on-the-digital-promise-ebook.pdf",
  },
];

const PRECEDENT: Fact[] = [
  {
    value: 80, prefix: ">", suffix: "%",
    claim: "fewer calls about one US Veterans Affairs letter after a plain-language rewrite: from over 1,100 a year to under 200.",
    source: "US Senate Report 110-412, 2008",
    url: "https://www.govinfo.gov/content/pkg/CRPT-110srpt412/html/CRPT-110srpt412.htm",
  },
  {
    value: 11000, prefix: "−",
    claim: "phone calls in a year after Arizona rewrote 100 form letters; staff processed 30,000 more claims.",
    source: "US Senate Report 110-412, 2008, citing The Arizona Republic",
    url: "https://www.govinfo.gov/content/pkg/CRPT-110srpt412/html/CRPT-110srpt412.htm",
  },
  {
    value: 35, suffix: "%",
    claim: "of doctors sent a revised tax letter responded, against 21% for the traditional letter, in a randomised UK trial. The rewrite also spelled out next steps and consequences.",
    source: "Behavioural Insights Team, UK Cabinet Office, 2012",
    url: "https://assets.publishing.service.gov.uk/media/5a789ae740f0b62b22cbb536/BIT_FraudErrorDebt_accessible.pdf",
  },
];

/** Counts from 0 to the value once the element scrolls into view. */
export function CountUp(props: { fact: Pick<Fact, "value" | "decimals" | "prefix" | "suffix" | "final"> }): ReactNode {
  const { fact } = props;
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(fact.value);
      return;
    }
    let frame = 0;
    const io = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      io.disconnect();
      const start = performance.now();
      const tick = (now: number): void => {
        const t = Math.min(1, (now - start) / 1400);
        setShown(fact.value * (1 - Math.pow(1 - t, 3)));
        if (t < 1) frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    }, { threshold: 0.5 });
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [fact.value]);
  const done = shown !== null && shown >= fact.value;
  const n = shown ?? 0;
  const text = done && fact.final ? fact.final : `${fact.prefix ?? ""}${n.toLocaleString("en-US", { minimumFractionDigits: fact.decimals ?? 0, maximumFractionDigits: fact.decimals ?? 0 })}${fact.suffix ?? ""}`;
  return <span ref={ref} className="count">{text}</span>;
}

function FactCard(props: { fact: Fact }): ReactNode {
  const { fact } = props;
  return (
    <li data-rise>
      <strong><CountUp fact={fact} /></strong>
      <p>{fact.claim}</p>
      <a href={fact.url} target="_blank" rel="noreferrer">{fact.source}</a>
    </li>
  );
}

export function Stakes(): ReactNode {
  return (
    <section className="l-ch l-stakes" id="stakes" aria-labelledby="stakes-title" data-chapter="Stakes">
      <span className="l-kick" data-rise>Why it matters</span>
      <h2 id="stakes-title" data-rise>A vague sentence is expensive</h2>
      <ol className="s-facts">{MARKET.map((f) => <FactCard key={f.source + f.value} fact={f} />)}</ol>
      <h3 className="s-sub" data-rise>Clearer words have paid off before</h3>
      <ol className="s-facts precedent">{PRECEDENT.map((f) => <FactCard key={f.source + f.value} fact={f} />)}</ol>
      <p className="s-gap" data-rise>Test policy text before it ships, like code.</p>
    </section>
  );
}
