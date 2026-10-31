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
 * Hypothetical support costs use buyer assumptions independent of the simulation.
 * Estimated model costs and external benchmarks provide separate cost context.
 */
export function Economics(props: { model: RunModel | null; top: Misreading | undefined; wallSeconds: number | null }): ReactNode {
  const { model, top, wallSeconds } = props;
  const [buyers, setBuyers] = useState<number>(BUYERS[1]);
  const [contact, setContact] = useState<number>(CONTACT[1]);
  const [misreading, setMisreading] = useState({ text: "", badInput: false });
  if (!model || !top || model.scenarios.length === 0) return null;
  const readers = model.scenarios.length;
  const held = top.readers.length;
  const rate = misreading.text.trim() === "" ? null : Number(misreading.text);
  const invalid = misreading.badInput || (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100));
  const bill = invalid || rate === null ? null : buyers * (rate / 100) * contact * SUPPORT_CONTACT.usd;
  const run = runCost(model);
  const retest = editTestCost(RETEST_READERS);
  const review = reviewCost();
  return (
    <section className="l-section l-econ" id="economics" aria-labelledby="econ-title" data-chapter="Economics">
      <span className="l-kick" data-rise>The economics</span>
      <h2 id="econ-title" data-rise>What-if support cost and estimated testing costs</h2>
      <p className="c-observed" data-rise>
        <span>Simulation result: <b>{held} of {readers} simulated readers</b> held this belief.</span>
        <small>These scenarios do not estimate how common the belief is among real buyers.</small>
      </p>

      <div className="c-eq" data-rise>
        <div className="c-term">
          <strong>{compact(buyers)}</strong>
          <span>assumed buyers who lose COD</span>
          <div className="c-pick" role="group" aria-label="Assumed buyer count">
            {BUYERS.map((b) => <button key={b} type="button" aria-pressed={b === buyers} className={b === buyers ? "on" : undefined} onClick={() => setBuyers(b)}>{compact(b)}</button>)}
          </div>
        </div>
        <b className="c-op">×</b>
        <div className="c-term">
          <label htmlFor="cost-misreading-rate">Assumed share of buyers who misread (%)</label>
          <input
            id="cost-misreading-rate"
            className="c-rate-input"
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="any"
            value={misreading.text}
            aria-invalid={invalid}
            aria-describedby={invalid ? "cost-rate-help cost-rate-error" : "cost-rate-help"}
            onInput={(event) => setMisreading({ text: event.currentTarget.value, badInput: event.currentTarget.validity.badInput })}
          />
          <small id="cost-rate-help">Choose a hypothetical rate from 0 to 100%. Decimals are allowed.</small>
          {invalid && <small id="cost-rate-error" role="alert">Enter a number from 0 to 100.</small>}
        </div>
        <b className="c-op">×</b>
        <div className="c-term">
          <strong>{Math.round(contact * 100)}%</strong>
          <span>assumed share of those buyers contacting support</span>
          <div className="c-pick" role="group" aria-label="Assumed share contacting support">
            {CONTACT.map((c) => <button key={c} type="button" aria-pressed={c === contact} className={c === contact ? "on" : undefined} onClick={() => setContact(c)}>{Math.round(c * 100)}%</button>)}
          </div>
        </div>
        <b className="c-op">×</b>
        <div className="c-term">
          <strong>${SUPPORT_CONTACT.usd.toFixed(2)}</strong>
          <span>historical benchmark per live contact</span>
          <a href={SUPPORT_CONTACT.url} target="_blank" rel="noreferrer">{SUPPORT_CONTACT.source}</a>
          <small>This is not a measured Shopee support cost.</small>
        </div>
      </div>

      <div className="e-versus" data-rise>
        <output className="e-side bill" aria-live="polite" aria-atomic="true">
          {bill === null ? <span>Enter an assumed misreading rate to calculate a scenario.</span> : (
            <>
              <strong>${Math.round(bill).toLocaleString("en-US")}</strong>
              <span>Hypothetical support cost under these assumptions</span>
            </>
          )}
        </output>
        <b className="e-vs">vs</b>
        <div className="e-side find">
          <strong><CountUp fact={{ value: run, decimals: 2, prefix: "$" }} /></strong>
          <span>estimated model cost: one run, {readers} readers{wallSeconds ? `, ${Math.round(wallSeconds / 60)} min` : ""}</span>
          <ul>
            <li><b>{usd(retest)}</b> to retest a fix on {RETEST_READERS} readers, in 17 seconds</li>
            <li><b>{usd(review)}</b> for one AI review, which lists problems but can't count who believes them</li>
          </ul>
        </div>
      </div>
      <p className="c-note" data-rise>An illustrative scenario, not measured business impact or predicted savings. Totals are rounded to whole US dollars.</p>
      {bill !== null && run > 0 && <p className="e-ratio">Under these assumptions, the hypothetical support cost is <b>{Math.round(bill / run).toLocaleString("en-US")}×</b> the estimated model cost of this run.</p>}

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
