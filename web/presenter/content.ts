// Speaker notes and the judges' Q&A. Every number traces to a logged run (runs/cod-main, cod-main-rt1, cod-main-rt2,
// grab-main-noref, cod-demo, usage-probe-metered), a git timestamp, or a cited source on the landing page.

export interface Note {
  /** Matches the landing's data-chapter label exactly. */
  chapter: string;
  /** Cumulative target time when this chapter should start, "m:ss". */
  at: string;
  /** What to say, verbatim. */
  say: string;
  /** Key numbers or facts to land, short. */
  points: string[];
  /** Optional on-screen action. */
  act?: string;
}

/** Total talk budget in seconds. */
export const TALK_SECONDS = 360;

export const NOTES: Note[] = [
  {
    chapter: "Untested",
    at: "0:00",
    say: "Platforms test what they ship: code, checkout pages, servers. Who tests how the rules are read? That's what we built.",
    points: ["Wait for the amber row to land before speaking the question"],
  },
  {
    chapter: "The case",
    at: "0:20",
    say: "One real example. Cash on delivery disappears from your checkout. 77.5 percent of Vietnamese online shoppers choose to pay that way. Why did it go?",
    points: ["77.5% choose COD (VietnamBiz, 15/06/2025)"],
  },
  {
    chapter: "The rule",
    at: "0:40",
    say: "Shopee's help page says: too many failed deliveries, beyond the current rules. How many? Over how long? Locked for how long? For this lock, it never says.",
    points: ["The 24-hour figure on that page is for the daily cap, not this lock"],
  },
  {
    chapter: "Rumours",
    at: "1:05",
    say: "So people fill in the blanks, from coupon sites and blogs. Each one states a rule Shopee never gives.",
    points: ["7 rumours, each with its source site"],
  },
  {
    chapter: "Stakes",
    at: "1:25",
    say: "And it matters. Shopee carries over half the GMV of Vietnam's big four marketplaces, 8 to 12 percent of orders end in bom hàng, and a live support contact costs about 8 dollars. One plain-language letter rewrite cut calls by more than 80 percent.",
    points: ["56% of 2025 GMV, four platforms (Metric)", "8–12% bom hàng (VECOM via Người Lao Động)", "$8.01 per live contact (Gartner 2019)"],
  },
  {
    chapter: "The tunnel",
    at: "1:55",
    say: "So we built a wind tunnel for policy text. 50 AI shoppers, each a different persona, 37 told a rumour first. Each sees what a real shopper sees and tells us what they now believe. A Codex agent decides who reads next.",
    points: ["Let the storyboard loop once (about 30 s)", "16 of 50 end up believing a rule that isn't there"],
  },
  {
    chapter: "Finding",
    at: "2:30",
    say: "16 of 50 believe a rule that isn't in the text. Follow the amber: it starts at one rumour and gets through every channel.",
    points: ["All 16 had heard the 3-in-90-days rumour"],
  },
  {
    chapter: "Voices",
    at: "2:50",
    say: "Three of them, their beliefs translated into English: one read the article, one saw checkout, one saw nothing. All three graded: not in the text.",
    points: [],
  },
  {
    chapter: "Rumour test",
    at: "3:05",
    say: "The rumour survives the official text. Nobody who heard no rumour came up with it.",
    points: ["Told the rumour, then read the help article: 3 of 5 still believe it", "No rumour: 0 of 13"],
  },
  {
    chapter: "Who",
    at: "3:20",
    say: "We ran 50 new readers with age and digital literacy varied. Same top misreading. In this sample, what they heard and where they read it made a much bigger difference than age.",
    points: ["Heard the rumour: 18 of 23 · no rumour: 0 of 11", "Read the help article: 1 of 16 · saw nothing official: 9 of 14"],
  },
  {
    chapter: "The fix",
    at: "3:40",
    say: "We tried the obvious fix: one honest sentence. A fact check confirmed no rule changed. The same 10 readers: the target stayed within noise and another misreading rose. The tunnel caught a fix that would not have worked: only 3 of 10 ever see that article.",
    points: ["Belief scores: 0.85 → 0.82 within ±0.12; another misreading rose 0.17 → 0.28.", "Retest took 17 seconds"],
  },
  {
    chapter: "Every edit",
    at: "3:55",
    say: "When wording can fix it, the same test proves it: on Grab's rider terms the misreading's belief score fell from 0.97 to 0.62. An edit that adds a promise is rejected.",
    points: ["Grab: same 12 simulated readers, noise ±0.05"],
  },
  {
    chapter: "Pipeline",
    at: "4:10",
    say: "Eight AI layers, one question each, each with its estimated cost.",
    points: ["Scroll through quickly; don't read each layer"],
  },
  {
    chapter: "Economics",
    at: "4:30",
    say: "A what-if: 100,000 buyers lose COD, 10 percent misread, a quarter of them call support, at Gartner's 8 dollars a contact. That's about 20,000 dollars. Our estimated model cost for the main run is 2.56; a ten-reader retest, 11 cents.",
    points: ["100k × 10% × 25% × $8.01 = $20,025"],
    act: "Type 10 in the assumed misreading rate; keep 100k and 25%",
  },
  {
    chapter: "Demo",
    at: "4:50",
    say: "Now watch the whole run: the reader flow fills in as the 50 readers report back, and the Codex agent decides who reads next. Then test your own policy and watch the readers grade it live. All of it built today with Codex.",
    points: [
      "Full run (about 30 s): play at 4×; point at the amber band growing and the agent's tool calls",
      "Test your own policy (about 25 s): click the Shopee preset, then Start the test; show the reader grid lighting up",
      "Close on Codex (about 15 s): reviewer and persona sandbox are Codex threads; gpt-6-astra reviewed the major subsystems and these claims (docs/codex-log.md)",
    ],
    act: "Click “Watch the full run”, then go back and click “Test your own policy”",
  },
];

export type Topic = "Validity" | "Method" | "Results" | "Cost" | "Business" | "Codex";
export interface Figure { value: string; label: string; tone?: "cyan" | "amber" | "red" | "green" }
export interface QA {
  id: string;
  topic: Topic;
  q: string;
  /** One or two sentences, the direct answer. */
  a: string;
  /** Supporting facts, each one line. */
  points: string[];
  figures?: Figure[];
  /** Where the evidence is. */
  link?: { label: string; href: string };
}

export const QAS: QA[] = [
  {
    id: "real-people",
    topic: "Validity",
    q: "Do AI readers misread the way real people do?",
    a: "We don't claim they do yet. We measure what simulated readers believe, measure the noise, and replicate. The pipeline already takes real people's answers for the next step.",
    points: [
      "Every reader reads the text twice, so the noise is measured, not guessed",
      "A second run with 50 new personas found the same top misreading first",
      "The report's “Ask real people” page codes human answers against the same belief groups",
      "Use it to choose which sentence to test with people, before paying for interviews",
    ],
    figures: [
      { value: "16/50", label: "first run", tone: "amber" },
      { value: "18/50", label: "second run, new readers", tone: "amber" },
      { value: "±0.10", label: "belief-score noise, same reader twice", tone: "cyan" },
    ],
    link: { label: "Open the report", href: "/#/run/cod-main" },
  },
  {
    id: "rumour",
    topic: "Validity",
    q: "You told them the rumour. Isn't that rigging it?",
    a: "Real buyers hear these rumours; we found them on coupon sites and blogs. The finding is that Shopee's text doesn't undo a rumour readers already heard. Readers told nothing never invented it.",
    points: [
      "Told “3 failures in 90 days”: 16 of 22 still believe it after reading",
      "Told a different rumour (“locked 60 days”): 0 of 15 picked up the 3-failure rule",
      "Told the rumour, then read the help article: 3 of 5 still believe it",
      "7 rumours, each from a real web source",
    ],
    figures: [
      { value: "16/22", label: "heard it, still believe it", tone: "red" },
      { value: "0/13", label: "heard nothing, believe it", tone: "cyan" },
    ],
  },
  {
    id: "noise",
    topic: "Method",
    q: "How do you know a result isn't just noise?",
    a: "Every reader reads the same text twice. A change only counts when it is bigger than that measured noise.",
    points: [
      "Top misreading: ±0.10 on its belief score between two reads by the same reader",
      "Grab rewrite: 0.97 → 0.62 against ±0.05 noise, so it counts",
      "Shopee scope sentence: 0.85 → 0.82 against ±0.12 noise, so it doesn't",
    ],
    figures: [
      { value: "0.97→0.62", label: "Grab, real change", tone: "green" },
      { value: "0.85→0.82", label: "Shopee edit, within noise", tone: "amber" },
    ],
  },
  {
    id: "homework",
    topic: "Method",
    q: "How do you stop the AI from grading its own homework?",
    a: "The known edge cases are withheld from every agent that reads, grades or groups beliefs; only the blind scorer sees them, and the file was committed to git before the run.",
    points: [
      "9 known edge cases live in a file only the scorer can read",
      "Committed at 12:50:25; the run started at 12:50:32",
      "Every list is scored under the same anonymous name, “System X”, so the scorer can't tell whose it is",
      "Code review found persona threads could read files; they now run with an empty folder and file tools off",
    ],
    figures: [
      { value: "9", label: "hidden edge cases", tone: "cyan" },
      { value: "7 s", label: "between commit and run", tone: "cyan" },
    ],
  },
  {
    id: "layers",
    topic: "Method",
    q: "What does each AI layer actually do?",
    a: "Eight layers, each asked one question: who reads it differently, what do you believe, does that fit the text, is it the same idea, who reads next, what's wrong and can wording fix it, score it blind, live with it for 26 weeks.",
    points: [
      "50 readers gave 122 beliefs, in Vietnamese, shown here in English",
      "122 beliefs → 47 groups → 7 misreadings, from 11,880 probability judgments",
      "The reviewer agent made 4 decisions with 17 tool calls; new beliefs per round fell 9 → 5 → 5 → 2",
    ],
    figures: [
      { value: "122", label: "beliefs", tone: "cyan" },
      { value: "47", label: "belief groups", tone: "cyan" },
      { value: "7", label: "misreadings", tone: "amber" },
    ],
    link: { label: "Open the report", href: "/#/run/cod-main" },
  },
  {
    id: "chatgpt",
    topic: "Method",
    q: "Why not just ask ChatGPT to review the policy?",
    a: "Do that too: a single review is a fast way to list possible problems. It can't tell you how many people believe each one, who they are, or whether your fix works. The tunnel measures those.",
    points: [
      "A single review costs about 3¢; a full tunnel run about $2.56",
      "On our hidden list, a single review named more known edge cases (8 of 9 vs 5 of 9); use it to brainstorm, the tunnel to measure",
      "Our tunnel retest caught that the obvious Shopee fix didn't work",
    ],
    figures: [
      { value: "16/50", label: "readers who believe the top misreading", tone: "amber" },
      { value: "11¢", label: "to retest a fix", tone: "cyan" },
    ],
  },
  {
    id: "who",
    topic: "Results",
    q: "Which kinds of buyers misread it?",
    a: "In this simulated sample, what readers heard and where they read it showed much larger differences than age or digital literacy.",
    points: [
      "Second run, 50 new readers with age (18–25, 30–45, 55–70) and digital literacy varied",
      "Heard the rumour: 18 of 23 · heard nothing: 0 of 11",
      "Saw nothing official: 9 of 14 · read the help article: 1 of 16",
      "Age 18–25: 9 of 19 · 30–45: 5 of 18 · 55–70: 4 of 13",
    ],
    figures: [
      { value: "18/23", label: "heard the rumour", tone: "red" },
      { value: "9/14", label: "saw nothing official", tone: "amber" },
      { value: "1/16", label: "read the help article", tone: "cyan" },
    ],
  },
  {
    id: "fix",
    topic: "Results",
    q: "Can it fix the policy, or only find problems?",
    a: "It proposes edits, fact-checks them against the original rules, and retests them on the same readers before anything ships.",
    points: [
      "Grab rider terms: mean belief score 0.97 → 0.62 on the same 12 simulated readers, beyond ±0.05 noise; the rewrite was kept",
      "Shopee scope sentence: the target stayed within noise and another misreading's mean belief score rose 0.17 → 0.28, so the edit failed; only 3 of 10 readers ever see that article",
      "“Pay at a convenience store” edit: rejected, it promised something the original never said",
      "Our ten-reader retests took 17 and 23 seconds",
    ],
    figures: [
      { value: "0.97→0.62", label: "Grab belief score, kept", tone: "green" },
      { value: "+1 promise", label: "Shopee edit, rejected", tone: "red" },
      { value: "17 s", label: "scope-sentence retest", tone: "cyan" },
    ],
  },
  {
    id: "beyond",
    topic: "Results",
    q: "Does it work beyond this one Shopee page?",
    a: "Yes. It takes any policy text; the reader traits are extracted from the policy itself.",
    points: [
      "Tested on Grab's scheduled-ride terms as well as Shopee COD",
      "“Test your own policy” runs on any pasted text",
    ],
    link: { label: "Test your own policy", href: "/#/new" },
  },
  {
    id: "cost",
    topic: "Cost",
    q: "What does a test cost, and how long does it take?",
    a: "A few dollars and about 15 minutes for 50 readers; retesting an edit costs cents and takes seconds.",
    points: [
      "Token counts logged per call in metered runs, priced at OpenAI list prices",
      "Metered: 20 readers, 372 calls, $1.54",
      "Metered: the 50-reader demographic run, $3.24 in 13 minutes",
      "Estimated for the main run: $2.56; a ten-reader edit retest: 11¢, 17 seconds",
    ],
    figures: [
      { value: "$3.24", label: "50 readers, metered", tone: "cyan" },
      { value: "11¢", label: "retest an edit", tone: "cyan" },
      { value: "$4,000", label: "participant incentives, 50 × $80 interviews", tone: "amber" },
    ],
  },
  {
    id: "dollars",
    topic: "Cost",
    q: "Where does the support-cost figure come from?",
    a: "It's a what-if. You type the assumptions; the only published number in it is Gartner's average cost of a live support contact.",
    points: [
      "Assumed: buyers who lose COD, share who misread, share who contact support",
      "Published: $8.01 per live contact, about $0.10 for self-service (Gartner, 2019)",
      "Not a measured Shopee loss",
    ],
  },
  {
    id: "shopee",
    topic: "Business",
    q: "What would Shopee do with this?",
    a: "Test help text and checkout messages before they ship, and fix the rule where buyers actually meet it.",
    points: [
      "The top misreading appeared in 1 of 16 help-article readers versus 9 of 14 who saw no official text",
      "Next step for the policy owner: publish the actual threshold at checkout, then test it the same way",
      "Our ten-reader edit retests took 17 and 23 seconds",
    ],
  },
  {
    id: "data",
    topic: "Business",
    q: "Where does your data come from?",
    a: "Shopee's help article word for word, the checkout message as reported online, and real rumours from the web.",
    points: [
      "Help article 79294 on help.shopee.vn, copied 31/10/2026",
      "Checkout line as quoted by salework.net; not yet checked in the app",
      "7 rumours from coupon sites, seller blogs, a retailer and a newspaper, each linked",
    ],
  },
  {
    id: "codex",
    topic: "Codex",
    q: "How did you use Codex?",
    a: "Codex is inside the product and it helped build it.",
    points: [
      "The reviewer agent is a Codex App Server thread with its own tools; it decides who reads next",
      "The persona that lives with the rule for 26 simulated weeks is a Codex thread; the 50 bulk readers use the Responses API",
      "gpt-6-astra reviewed the major subsystems and the landing's claims; each review is logged",
      "Task agents built usage metering, the source research and the demographic run",
    ],
    link: { label: "Watch the full run", href: "/#/live/cod-main" },
  },
];
