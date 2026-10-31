import { useState, type ReactNode } from "react";
import type { Misreading, RunModel } from "../model";
import { PROBE, editTestCost, reviewCost, runCost, usd } from "./costs";
import { CountUp, SUPPORT_CONTACT } from "./Stakes";

/** Scales to try: Shopee knows how many buyers lose COD; the viewer picks one. */
const BUYERS = [10_000, 100_000, 1_000_000] as const;
/** Share of misreaders who then contact support; unmeasured, so the viewer picks it too. */
const CONTACT = [0.1, 0.25, 0.5] as const;
/** Readers an edit test reruns. */
const RETEST_READERS = 10;
/** Participant pay for one hour of a remote consumer interview (User Interviews' recommendation). */
const INTERVIEW_HOUR_USD = 80;

function compact(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : String(n);
}

/**
 * The economics on one screen: what one misreading could cost in support contacts (buyers × the simulated share who
 * believe it × the share who contact support × Gartner's cost per contact), against what finding and retesting it
 * costs, and what the usual alternatives cost.
 */
export function Economics(props: { model: RunModel | null; top: Misreading | undefined; wallSeconds: number | null }): ReactNode {
  const { model, top, wallSeconds } = props;
  const [buyers, setBuyers] = useState<number>(BUYERS[1]);
  const [contact, setContact] = useState<number>(CONTACT[1]);
  if (!model || !top || model.scenarios.length === 0) return null;
  const readers = model.scenarios.length;
  const held = top.readers.length;
  const share = held / readers;
  const bill = buyers * share * contact * SUPPORT_CONTACT.usd;
  const run = runCost(model);
  const retest = editTestCost(RETEST_READERS);
  const review = reviewCost();
  return (
    <section className="l-section l-econ" id="economics" aria-labelledby="econ-title" data-chapter="Economics">
      <span className="l-kick" data-rise>The economics</span>
      <h2 id="econ-title" data-rise>What a misreading could cost, and what finding it costs</h2>

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
          <small>{held} of {readers} simulated readers</small>
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

      <div className="e-versus" data-rise>
        <div className="e-side bill">
          <strong><CountUp fact={{ value: Math.round(bill), prefix: "$" }} /></strong>
          <span>illustrative support-cost scenario for this one misreading</span>
        </div>
        <b className="e-vs">vs</b>
        <div className="e-side find">
          <strong><CountUp fact={{ value: run, decimals: 2, prefix: "$" }} /></strong>
          <span>to find it: one run, {readers} readers{wallSeconds ? `, ${Math.round(wallSeconds / 60)} min` : ""}</span>
          <ul>
            <li><b>{usd(retest)}</b> to retest a fix on {RETEST_READERS} readers, in 17 seconds</li>
            <li><b>{usd(review)}</b> for one AI review, which lists problems but can't count who believes them</li>
          </ul>
        </div>
      </div>
      {run > 0 && <p className="e-ratio" data-rise>In this scenario the support bill is <b>{Math.round(bill / run).toLocaleString("en-US")}×</b> the cost of the run that found it.</p>}

      <h3 className="p-econ-title" data-rise>What the alternatives cost</h3>
      <div className="p-econ versus" data-rise>
        <div>
          <strong><CountUp fact={{ value: readers * INTERVIEW_HOUR_USD, prefix: "$" }} /></strong>
          <span>to pay {readers} people for a one-hour interview, at ${INTERVIEW_HOUR_USD} an hour</span>
          <a href="https://www.userinterviews.com/blog/research-incentives-report" target="_blank" rel="noreferrer">User Interviews incentive report, updated 2025</a>
        </div>
        <div>
          <strong><CountUp fact={{ value: SUPPORT_CONTACT.usd, decimals: 2, prefix: "$" }} /></strong>
          <span>for one live support contact{run > 0 && run < SUPPORT_CONTACT.usd ? `, as much as ${Math.floor(SUPPORT_CONTACT.usd / run)} full test runs` : ""}</span>
          <a href={SUPPORT_CONTACT.url} target="_blank" rel="noreferrer">{SUPPORT_CONTACT.source}</a>
        </div>
      </div>
      <p className="p-note" data-rise>
        Run costs estimated from token counts measured on a {PROBE.readers}-reader run ({PROBE.runId}) at OpenAI list prices, scaled to {readers} readers.
      </p>
    </section>
  );
}
