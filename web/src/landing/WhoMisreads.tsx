import type { ReactNode } from "react";
import type { Misreading, RunModel } from "../model";

/** English names for the traits a run varies; traits without one are left off the landing. */
const TRAIT_EN: Record<string, string> = {
  heard: "What they heard first",
  saw: "Where they met the rule",
  age_group: "Age",
  digital_literacy: "Digital literacy",
  attention: "How closely they read",
  account_usage_control: "Whose account it is",
  alternative_payment_access: "Other ways to pay",
  cod_delivery_history: "Past deliveries",
  purchase_fulfillment_context: "What they buy",
};

const LEVEL_EN: Record<string, string> = {
  "folk-3-in-90-consecutive": "“3 failures in 90 days”",
  "folk-60-days": "“Locked for 60 days”",
  "no-rumour": "No rumour",
  "other-rumour": "Another rumour",
  help: "Read the help article",
  checkout: "Saw the checkout message",
  none: "Saw nothing official",
  young: "18 to 25",
  middle: "30 to 45",
  older: "55 to 70",
  low: "Low",
  high: "High",
  careful: "Read carefully",
  skim: "Skimmed",
  shared_account_user: "Shares the account",
  sole_account_user: "Own account",
  usable_alternative: "Has another way",
  cash_dependent: "Cash only",
  repeated_unsuccessful_deliveries: "Several failed",
  mostly_successful_deliveries: "Mostly successful",
  digital_goods_or_non_shopee_shipping: "Digital or off-platform",
  physical_goods_shopee_shipping: "Physical goods",
};

interface Row {
  key: string;
  label: string;
  held: number;
  n: number;
}

interface Trait {
  key: string;
  label: string;
  rows: Row[];
  /** Highest minus lowest share across levels with at least three readers. */
  spread: number;
}

const MIN_N = 3;

function traits(m: RunModel, holders: ReadonlySet<string>): Trait[] {
  const groups = new Map<string, Map<string, Row>>();
  const add = (trait: string, level: string, scenarioId: string): void => {
    const label = LEVEL_EN[level];
    if (!TRAIT_EN[trait] || !label) return;
    const rows = groups.get(trait) ?? new Map<string, Row>();
    const row = rows.get(level) ?? { key: level, label, held: 0, n: 0 };
    row.n++;
    if (holders.has(scenarioId)) row.held++;
    rows.set(level, row);
    groups.set(trait, rows);
  };
  for (const s of m.scenarios) {
    const folk = s.exposure.folkVersionId;
    add("heard", folk === null ? "no-rumour" : LEVEL_EN[folk] ? folk : "other-rumour", s.id);
    add("saw", s.exposure.surfaceIds.length === 0 ? "none" : s.exposure.surfaceIds.includes("help") ? "help" : "checkout", s.id);
    for (const l of s.levels) {
      if (l.dimId === "exposure_channel" || l.dimId === "prior_belief") continue;
      add(l.dimId, l.levelId, s.id);
    }
  }
  return [...groups].map(([key, rows]) => {
    const list = [...rows.values()].sort((a, b) => b.held / b.n - a.held / a.n);
    const shares = list.filter((r) => r.n >= MIN_N).map((r) => r.held / r.n);
    return { key, label: TRAIT_EN[key] ?? key, rows: list, spread: shares.length > 1 ? Math.max(...shares) - Math.min(...shares) : 0 };
  }).sort((a, b) => b.spread - a.spread);
}

/** For the top misreading: who holds it, trait by trait, the biggest split first. */
export function WhoMisreads(props: { model: RunModel | null; top: Misreading | undefined; demographic: boolean }): ReactNode {
  const { model, top } = props;
  if (!model || !top) return null;
  const list = traits(model, new Set(top.readers)).filter((t) => t.spread > 0).slice(0, 6);
  if (list.length === 0) return null;
  return (
    <section className="l-section l-who" id="who" aria-labelledby="who-title" data-chapter="Who">
      <span className="l-kick" data-rise>{props.demographic ? "A second run, with age and digital literacy varied" : "Same 50 readers, split by trait"}</span>
      <h2 id="who-title" data-rise>Who misreads it</h2>
      <p className="w-what" data-rise>Readers who believe: {top.title}</p>
      <ol className="w-traits">
        {list.map((t, i) => (
          <li key={t.key} className={i === 0 ? "lead" : undefined} data-rise>
            <h3>{t.label}{i === 0 && <em>Biggest split</em>}</h3>
            {t.rows.map((r) => (
              <div key={r.key} className="w-row">
                <span>{r.label}</span>
                <i><b style={{ width: `${(r.held / r.n) * 100}%` }} /></i>
                <small>{r.held}/{r.n}</small>
              </div>
            ))}
          </li>
        ))}
      </ol>
    </section>
  );
}
