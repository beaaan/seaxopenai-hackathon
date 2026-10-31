import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { sankey, sankeyLinkHorizontal, type SankeyGraph } from "d3-sankey";
import { shortClaim, type Saw, type TunnelData, type TunnelPool } from "./tunnel";

type Tone = "top" | "misreading" | "other" | "none" | "pending" | "rumour" | "calm" | "plain";

interface FlowNode {
  key: string;
  column: 0 | 1 | 2;
  lines: string[];
  count: number;
  /** Pool index for destination nodes. */
  pool: number | null;
  tone: Tone;
}

interface FlowLink {
  key: string;
  source: number;
  target: number;
  value: number;
  /** Destination pool of the readers in this band; bands are coloured by where they end up. */
  pool: number;
}

const W = 1000;
const H = 500;
/** x extent of the node columns; labels sit outside it on the left and right. */
const X0 = 250;
const X1 = 640;

const SAW_LABEL: Record<Saw, string> = { help: "Read the help article", checkout: "Saw the checkout message", none: "Saw nothing official" };
const SAW_ORDER: Saw[] = ["help", "checkout", "none"];

function wrap(text: string, width: number, max: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${kept[max - 1]!.replace(/[\s,.;:]*$/, "")}…`;
  return kept;
}

function poolTone(p: TunnelPool, i: number): Tone {
  if (p.role === "none") return "none";
  if (p.role === "pending" || p.role === "ungrouped") return "pending";
  if (p.role === "other") return "other";
  return i === 0 ? "top" : "misreading";
}

function build(data: TunnelData): { nodes: FlowNode[]; links: FlowLink[] } {
  const nodes: FlowNode[] = [];
  const index = new Map<string, number>();
  const add = (node: FlowNode): void => {
    index.set(node.key, nodes.length);
    nodes.push(node);
  };
  const heardCount = new Map<string | null, number>();
  const sawCount = new Map<Saw, number>();
  for (const s of data.streams) {
    heardCount.set(s.folkId, (heardCount.get(s.folkId) ?? 0) + 1);
    sawCount.set(s.saw, (sawCount.get(s.saw) ?? 0) + 1);
  }
  // Rumours, most common first, then readers told nothing.
  const heard = [...heardCount].sort((a, b) => Number(a[0] === null) - Number(b[0] === null) || b[1] - a[1]);
  for (const [folkId, count] of heard) {
    const folk = folkId === null ? undefined : data.folk.get(folkId);
    const label = folkId === null ? "Heard no rumour" : folk ? `Heard “${shortClaim(folk)}”` : "Heard a rumour";
    add({ key: `h:${folkId}`, column: 0, lines: wrap(label, 30, 3), count, pool: null, tone: folkId === null ? "calm" : "rumour" });
  }
  for (const saw of SAW_ORDER) {
    const count = sawCount.get(saw);
    if (count) add({ key: `s:${saw}`, column: 1, lines: [SAW_LABEL[saw]], count, pool: null, tone: "plain" });
  }
  data.pools.forEach((p, i) => add({ key: `p:${p.id}`, column: 2, lines: wrap(p.label, 34, 2), count: p.readers, pool: i, tone: poolTone(p, i) }));

  const bands = new Map<string, FlowLink>();
  const flow = (from: string, to: string, pool: number): void => {
    const key = `${from}>${to}#${data.pools[pool]!.id}`;
    const band = bands.get(key);
    if (band) band.value++;
    else bands.set(key, { key, source: index.get(from)!, target: index.get(to)!, value: 1, pool });
  };
  for (const s of data.streams) {
    flow(`h:${s.folkId}`, `s:${s.saw}`, s.pool);
    flow(`s:${s.saw}`, `p:${data.pools[s.pool]!.id}`, s.pool);
  }
  // In pool order, so bands between the same two nodes stack as their pools sit; d3-sankey orders the rest by position.
  const links = [...bands.values()].sort((a, b) => a.pool - b.pool);
  return { nodes, links };
}
/** Keep a band's identity as its destination grows, so geometry changes interpolate instead of jumping. */
function FlowBand(props: { d: string; width: number; tone: Tone; dim: boolean; onActive: () => void }): ReactNode {
  const element = useRef<SVGPathElement>(null);
  const previous = useRef<{ d: string; width: number } | null>(null);
  useLayoutEffect(() => {
    const node = element.current;
    const from = previous.current;
    previous.current = { d: props.d, width: props.width };
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = node.animate(
      [
        { d: `path("${from?.d ?? props.d}")`, strokeWidth: from?.width ?? 0 },
        { d: `path("${props.d}")`, strokeWidth: props.width },
      ],
      { duration: 500, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
    return () => animation.cancel();
  }, [props.d, props.width]);
  return <path ref={element} d={props.d} className={`tone-${props.tone}${props.dim ? " dim" : ""}`} strokeWidth={props.width} onMouseEnter={props.onActive} onClick={props.onActive} />;
}


/**
 * Every reader as a band: what they heard first, where they met the rule, and the most common wrong idea they ended
 * up holding. Band width is readers; colour is the destination, so one belief can be followed back to its sources.
 */
export function ReaderFlow(props: { data: TunnelData; active: number; onActive: (pool: number) => void }): ReactNode {
  const { data, active, onActive } = props;
  const graph = useMemo((): SankeyGraph<FlowNode, FlowLink> => {
    const { nodes, links } = build(data);
    return sankey<FlowNode, FlowLink>()
      .nodeWidth(12)
      .nodePadding(44)
      .nodeSort(null)
      .extent([[X0, 64], [X1, H - 12]])({ nodes: nodes.map((n) => ({ ...n })), links: links.map((l) => ({ ...l })) });
  }, [data]);
  const path = sankeyLinkHorizontal<FlowNode, FlowLink>();
  const top = data.pools[0];

  return (
    <div className="flow">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={top?.role === "pending" ? `${top.readers} of ${data.total} readers are still reading` : top?.role === "ungrouped" ? `${top.readers} of ${data.total} readers have not been grouped yet` : top ? `${top.readers} of ${data.total} readers end up believing: ${top.label}` : "Where readers end up"}>
        <g className="flow-heads">
          <text x={X0 - 14} y={14} textAnchor="end">What they heard</text>
          <text x={(X0 + X1) / 2} y={14} textAnchor="middle">Where they read it</text>
          <text x={X1 + 18} y={14}>What they believe</text>
        </g>
        <g className="flow-links">
          {graph.links.map((l) => (
            <FlowBand
              key={l.key}
              d={path(l) ?? ""}
              tone={poolTone(data.pools[l.pool]!, l.pool)}
              dim={active >= 0 && l.pool !== active}
              width={Math.max(1, l.width ?? 1)}
              onActive={() => onActive(l.pool)}
            />
          ))}
        </g>
        <g className="flow-nodes">
          {graph.nodes.map((n) => {
            const x0 = n.x0 ?? 0;
            const x1 = n.x1 ?? 0;
            const y0 = n.y0 ?? 0;
            const y1 = n.y1 ?? 0;
            const mid = (y0 + y1) / 2;
            const on = n.pool !== null && n.pool === active;
            return (
              <g key={n.key} className={`tone-${n.tone}${on ? " on" : ""}`} role={n.pool === null ? undefined : "button"} tabIndex={n.pool === null ? undefined : 0} aria-label={n.pool === null ? undefined : `${n.count} readers: ${data.pools[n.pool]!.label}`} aria-pressed={n.pool === null ? undefined : on} onMouseEnter={n.pool === null ? undefined : () => onActive(n.pool!)} onClick={n.pool === null ? undefined : () => onActive(n.pool!)} onKeyDown={n.pool === null ? undefined : (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onActive(n.pool!);
                }
              }}>
                <rect x={x0} y={y0} width={x1 - x0} height={Math.max(2, y1 - y0)} rx={3} />
                {n.column === 0 && (
                  <text x={x0 - 14} y={mid - (n.lines.length * 18) / 2} textAnchor="end" dominantBaseline="middle">
                    {n.lines.map((line, i) => <tspan key={i} x={x0 - 14} dy={i === 0 ? 0 : 18}>{line}</tspan>)}
                    <tspan className="flow-n" x={x0 - 14} dy={20}>{n.count}</tspan>
                  </text>
                )}
                {n.column === 1 && (
                  <text x={(x0 + x1) / 2} y={y0 - 10} textAnchor="middle">
                    {n.lines[0]} <tspan className="flow-n">{n.count}</tspan>
                  </text>
                )}
                {n.column === 2 && (
                  <text x={x1 + 18} y={mid - ((n.lines.length - 1) * 18) / 2} dominantBaseline="middle">
                    <tspan className="flow-count" x={x1 + 18}>{n.count}</tspan>
                    {n.lines.map((line, i) => <tspan key={i} x={x1 + 58} dy={i === 0 ? 0 : 18}>{line}</tspan>)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
