import { useState, type ReactNode } from "react";
import type { Misreading, RunModel } from "../model";
import { CountUp, SUPPORT_CONTACT } from "./Stakes";

/** Scales to try: Shopee knows how many buyers lose COD; the viewer picks one. */
const BUYERS = [10_000, 100_000, 1_000_000] as const;
/** Share of misreaders who then contact support; unmeasured, so the viewer picks it too. */
const CONTACT = [0.1, 0.25, 0.5] as const;

function compact(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : String(n);
}

/**
 * What one misreading costs in support contacts: buyers × the share who believe it (measured in the run) × the share
 * who then contact support (chosen) × the average cost of a live contact (Gartner). Set beside what the run cost.
 */
export function MisreadCost(props: { model: RunModel | null; top: Misreading | undefined; runCost: number }): ReactNode {
  const { model, top, runCost } = props;
  const [buyers, setBuyers] = useState<number>(BUYERS[1]);
  const [contact, setContact] = useState<number>(CONTACT[1]);
  if (!model || !top || model.scenarios.length === 0) return null;
  const held = top.readers.length;
  const share = held / model.scenarios.length;
  const cost = buyers * share * contact * SUPPORT_CONTACT.usd;
  return (
    <section className="l-ch l-cost" id="cost" aria-labelledby="cost-title" data-chapter="The cost">
      <span className="l-kick" data-rise>What it costs</span>
      <h2 id="cost-title" data-rise>One misreading, priced in support calls</h2>
      <div className="c-eq" data-rise>
        <div className="c-term">
          <strong>{compact(buyers)}</strong>
          <span>buyers lose COD</span>
          <div className="c-pick" role="group" aria-label="Buyers who lose COD">
            {BUYERS.map((b) => <button key={b} type="button" className={b === buyers ? "on" : undefined} onClick={() => setBuyers(b)}>{compact(b)}</button>)}
          </div>
        </div>
        <b className="c-op">×</b>
        <div className="c-term measured">
          <strong>{Math.round(share * 100)}%</strong>
          <span>believe a rule that isn't there</span>
          <small>{held} of {model.scenarios.length} readers in our run</small>
        </div>
        <b className="c-op">×</b>
        <div className="c-term">
          <strong>{Math.round(contact * 100)}%</strong>
          <span>of them contact support</span>
          <div className="c-pick" role="group" aria-label="Share who contact support">
            {CONTACT.map((c) => <button key={c} type="button" className={c === contact ? "on" : undefined} onClick={() => setContact(c)}>{Math.round(c * 100)}%</button>)}
          </div>
        </div>
        <b className="c-op">×</b>
        <div className="c-term">
          <strong>${SUPPORT_CONTACT.usd.toFixed(2)}</strong>
          <span>per live contact</span>
          <a href={SUPPORT_CONTACT.url} target="_blank" rel="noreferrer">{SUPPORT_CONTACT.source}</a>
        </div>
      </div>
      <div className="c-total" data-rise>
        <strong><CountUp fact={{ value: Math.round(cost), prefix: "$" }} /></strong>
        <span>in support contacts, for this one misreading</span>
      </div>
      {runCost > 0 && (
        <p className="c-vs" data-rise>
          Finding it took one run: <b>${runCost.toFixed(2)}</b>.
        </p>
      )}
    </section>
  );
}
