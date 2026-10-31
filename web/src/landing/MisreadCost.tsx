import { useState, type ReactNode } from "react";
import type { Misreading, RunModel } from "../model";
import { SUPPORT_CONTACT } from "./Stakes";

/** Scales to try: Shopee knows how many buyers lose COD; the viewer picks one. */
const BUYERS = [10_000, 100_000, 1_000_000] as const;
/** Share of misreaders who then contact support; unmeasured, so the viewer picks it too. */
const CONTACT = [0.1, 0.25, 0.5] as const;

function compact(n: number): string {
  return n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : String(n);
}

/** A what-if scenario: all buyer rates are assumptions, independent of the simulated readers. */
export function MisreadCost(props: { model: RunModel | null; top: Misreading | undefined; runCost: number }): ReactNode {
  const { model, top, runCost } = props;
  const [buyers, setBuyers] = useState<number>(BUYERS[1]);
  const [contact, setContact] = useState<number>(CONTACT[1]);
  const [misreading, setMisreading] = useState({ text: "", badInput: false });
  if (!model || !top || model.scenarios.length === 0) return null;
  const held = top.readers.length;
  const rate = misreading.text.trim() === "" ? null : Number(misreading.text);
  const invalid = misreading.badInput || (rate !== null && (!Number.isFinite(rate) || rate < 0 || rate > 100));
  const cost = invalid || rate === null ? null : buyers * (rate / 100) * contact * SUPPORT_CONTACT.usd;
  return (
    <section className="l-ch l-cost" id="cost" aria-labelledby="cost-title" data-chapter="What-if cost">
      <span className="l-kick" data-rise>Explore an illustrative scenario</span>
      <h2 id="cost-title" data-rise>What-if support cost</h2>
      <p className="c-observed" data-rise>
        <span>Simulation result: <b>{held} of {model.scenarios.length} simulated readers</b> held this belief.</span>
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
      <output className="c-total" aria-live="polite" aria-atomic="true" data-rise>
        {cost === null ? <span>Enter an assumed misreading rate to calculate a scenario.</span> : (
          <>
            <strong>${Math.round(cost).toLocaleString("en-US")}</strong>
            <span>Hypothetical support cost under these assumptions</span>
          </>
        )}
      </output>
      <p className="c-note" data-rise>An illustrative scenario, not measured business impact or predicted savings. Totals are rounded to whole US dollars.</p>
      {runCost > 0 && (
        <p className="c-vs" data-rise>
          Estimated model cost of this run: <b>${runCost.toFixed(2)}</b>.
        </p>
      )}
    </section>
  );
}
