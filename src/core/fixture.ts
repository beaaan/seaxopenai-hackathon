/**
 * Deterministic synthetic run on the real COD policy, for UI work and demos without LLM calls.
 * Every persona is prefixed "[fixture] " so nobody mistakes it for real output.
 *
 *   npx tsx -e "import('./src/core/fixture.ts').then(m => console.log(m.writeFixtureRun({ runId: 'fixture' })))"
 */
import { existsSync, rmSync } from "node:fs";
import type { ActionEnum } from "../shared/actions";
import type {
  AllocationDecision,
  Cluster,
  Dimension,
  FidelityResult,
  Finding,
  Grade,
  GradeLabel,
  Interpretation,
  LevelChoice,
  PolicyVersion,
  Reading,
  Scenario,
  SplitRow,
  Surface,
} from "../shared/schema";
import { loadPolicyPackage, makeVersion, versionZero } from "./policy";
import { eventsPath, RunWriter } from "./store";

const MODEL = "gpt-6.1-sol";
const POLICY_ID = "cod";
const SEED_SIZE = 16;
const BATCH_SIZE = 10;

/** mulberry32: small, seedable, good enough for synthetic data. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
}

function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// Dimensions

const DIMENSIONS: Dimension[] = [
  {
    id: "payment",
    name: "Phương thức thanh toán sẵn có",
    description: "Người đọc có phương thức trả trước nào ngoài COD hay không.",
    levels: [
      { id: "cod_only", label: "Chỉ dùng COD", description: "Không có ví, thẻ hay tài khoản ngân hàng liên kết." },
      { id: "ewallet", label: "Có ví điện tử", description: "Có ShopeePay hoặc ví khác nhưng ít dùng." },
      { id: "card", label: "Có thẻ ngân hàng", description: "Thanh toán thẻ / chuyển khoản thường xuyên." },
    ],
    origin: "extracted",
    rationale: "help.11 chỉ cách mở lại COD bằng phương thức khác; người chỉ dùng COD đọc câu này khác hẳn.",
  },
  {
    id: "account_sharing",
    name: "Dùng chung tài khoản",
    description: "Tài khoản có bị nhiều người dùng chung hoặc người đọc có nhiều tài khoản không.",
    levels: [
      { id: "solo", label: "Một mình dùng", description: "Một người, một tài khoản." },
      { id: "family_shared", label: "Dùng chung gia đình", description: "Cả nhà đặt hàng trên một tài khoản." },
      { id: "multi_account", label: "Nhiều tài khoản", description: "Người đọc có sẵn hoặc dễ tạo tài khoản khác." },
    ],
    origin: "extracted",
    rationale: "help.3 nói giới hạn theo 'tài khoản đang sử dụng', gợi ý đổi tài khoản là lối thoát.",
  },
  {
    id: "prior_belief",
    name: "Niềm tin có sẵn",
    description: "Phiên bản truyền miệng người đọc đã nghe trước khi đọc văn bản.",
    levels: [
      { id: "none", label: "Chưa nghe gì", description: "Đọc văn bản lần đầu." },
      { id: "folk_3_in_90", label: "3 đơn trong 90 ngày", description: "Tin rằng 3 đơn giao thất bại trong 90 ngày sẽ bị khóa." },
      { id: "folk_60_days", label: "Khóa 60 ngày", description: "Tin rằng khóa COD kéo dài khoảng 60 ngày." },
    ],
    origin: "extracted",
    rationale: "Các trang mã giảm giá lan truyền con số cụ thể mà văn bản chính thức không nêu.",
  },
  {
    id: "channel",
    name: "Kênh tiếp xúc",
    description: "Người đọc thấy chính sách qua đâu.",
    levels: [
      { id: "help_article", label: "Bài trợ giúp", description: "Đọc toàn bộ bài Help Center." },
      { id: "checkout_only", label: "Chỉ dòng thanh toán", description: "Chỉ thấy dòng thông báo ở bước thanh toán." },
      { id: "friend_paraphrase", label: "Bạn bè kể lại", description: "Chỉ nghe bạn bè diễn giải." },
    ],
    origin: "extracted",
    rationale: "Dòng ở checkout không nêu lý do; người chỉ thấy dòng này phải tự đoán.",
  },
];

const FOLK_BY_LEVEL: Record<string, string | null> = {
  none: null,
  folk_3_in_90: "folk-3-in-90-consecutive",
  folk_60_days: "folk-60-days",
};

// ---------------------------------------------------------------------------
// Interpretation archetypes = the clusters they will form

interface Archetype {
  clusterId: string;
  sentenceId: string | null;
  quote: string;
  meaningVi: string;
  glossEn: string;
  labelEn: string;
  labelVi: string;
  conflictProb: number;
  otherLabel: GradeLabel;
  factIds: string[];
  action: ActionEnum;
  actionVi: string;
}

const ARCHETYPES: Record<string, Archetype> = {
  h3Failed: {
    clusterId: "c-h3-failed",
    sentenceId: "help.3",
    quote: "vượt mức giới hạn về số đơn hàng được chọn hình thức thanh toán COD trong ngày",
    meaningVi: "Hôm nay tôi có mấy đơn bị giao không thành công nên bị khóa COD 24 giờ.",
    glossEn: "The 24h block is caused by failed deliveries today.",
    labelEn: "24h daily cap read as a failed-delivery penalty",
    labelVi: "Hiểu giới hạn 24 giờ là phạt vì giao thất bại",
    conflictProb: 0.85,
    otherLabel: "unclear",
    factIds: ["F1"],
    action: "wait_and_retry",
    actionVi: "Đợi qua ngày mai rồi đặt lại COD.",
  },
  h3Account: {
    clusterId: "c-h3-account",
    sentenceId: "help.3",
    quote: "tài khoản đang sử dụng",
    meaningVi: "Giới hạn chỉ tính theo tài khoản, nên đổi sang tài khoản khác là đặt COD được ngay.",
    glossEn: "The cap is per account, so switching accounts gets around it.",
    labelEn: "Per-account cap invites a second account",
    labelVi: "Giới hạn theo tài khoản → dùng tài khoản khác",
    conflictProb: 0.15,
    otherLabel: "consistent",
    factIds: ["F1"],
    action: "use_other_account",
    actionVi: "Mượn tài khoản của chị gái để đặt COD.",
  },
  h4AnyFault: {
    clusterId: "c-h4-anyfault",
    sentenceId: "help.4",
    quote: "giao không thành công",
    meaningVi: "Đơn nào giao không thành công cũng bị tính, kể cả shipper không gọi hay người bán hủy.",
    glossEn: "Any failed delivery counts, even when the courier or seller caused it.",
    labelEn: "Every failed delivery counts, whoever caused it",
    labelVi: "Mọi đơn giao thất bại đều bị tính",
    conflictProb: 0.8,
    otherLabel: "unclear",
    factIds: ["F2", "F4"],
    action: "switch_prepaid",
    actionVi: "Thôi dùng COD, chuyển sang trả trước cho chắc.",
  },
  h4Refusal: {
    clusterId: "c-h4-refusal",
    sentenceId: "help.4",
    quote: "lịch sử mua hàng của bạn có số lượng đơn hàng COD giao không thành công",
    meaningVi: "Chỉ những đơn tôi từ chối nhận mới bị tính vào lịch sử.",
    glossEn: "Only orders I refused count toward the history.",
    labelEn: "Only the buyer's own refusals count",
    labelVi: "Chỉ đơn mình từ chối mới bị tính",
    conflictProb: 0.1,
    otherLabel: "consistent",
    factIds: ["F2"],
    action: "place_order_cod",
    actionVi: "Vẫn đặt COD vì mình chưa từng boom hàng.",
  },
  h11Auto: {
    clusterId: "c-h11-auto",
    sentenceId: "help.11",
    quote: "tự mở lại chức năng COD khi bạn đủ điều kiện sử dụng",
    meaningVi: "Cứ chờ một thời gian là hệ thống tự mở lại COD, không cần làm gì.",
    glossEn: "COD reopens by itself after some waiting time.",
    labelEn: "Unlock is automatic after waiting",
    labelVi: "Chờ là tự mở lại",
    conflictProb: 0.9,
    otherLabel: "unclear",
    factIds: ["F3"],
    action: "wait_and_retry",
    actionVi: "Chờ vài tuần rồi thử lại COD.",
  },
  h11Prepaid: {
    clusterId: "c-h11-prepaid",
    sentenceId: "help.11",
    quote: "mua và nhận hàng thành công theo các hình thức thanh toán khác",
    meaningVi: "Phải mua thành công vài đơn bằng ví hoặc thẻ thì COD mới mở lại.",
    glossEn: "Successful prepaid orders are what reopens COD.",
    labelEn: "Unlock needs successful prepaid orders",
    labelVi: "Cần đơn trả trước thành công để mở lại",
    conflictProb: 0.05,
    otherLabel: "consistent",
    factIds: ["F3"],
    action: "switch_prepaid",
    actionVi: "Nạp ShopeePay và đặt vài đơn nhỏ.",
  },
  nullThreshold: {
    clusterId: "c-null-threshold",
    sentenceId: null,
    quote: "vượt quá quy định hiện hành",
    meaningVi: "Văn bản không nói bao nhiêu đơn thì bị khóa và khóa bao lâu; chắc là 3 đơn trong 90 ngày.",
    glossEn: "The text never states the threshold or the lock duration; reader fills in a number.",
    labelEn: "Threshold and lock duration are not in the text",
    labelVi: "Ngưỡng và thời gian khóa không có trong văn bản",
    conflictProb: 0.3,
    otherLabel: "outside",
    factIds: [],
    action: "contact_support",
    actionVi: "Hỏi CSKH xem còn bao nhiêu lượt giao thất bại.",
  },
};

type ArchetypeKey = keyof typeof ARCHETYPES;

/** Sentence archetypes available per batch: the per-account cluster only surfaces once allocation focuses on account sharing. */
const SEED_POOL: ArchetypeKey[] = ["h3Failed", "h4AnyFault", "h4Refusal", "h11Auto", "h11Prepaid"];
const ADAPTIVE_POOL: ArchetypeKey[] = ["h3Account", "h3Failed", "h4AnyFault", "h11Auto", "h3Account"];

function archetype(key: ArchetypeKey): Archetype {
  const a = ARCHETYPES[key];
  if (a === undefined) throw new Error(`unknown archetype ${key}`);
  return a;
}

// ---------------------------------------------------------------------------
// Personas and scenarios

const NAMES = [
  "Nguyễn Thị Lan",
  "Trần Văn Hùng",
  "Lê Thị Mai",
  "Phạm Quốc Bảo",
  "Hoàng Thị Thu",
  "Võ Minh Khoa",
  "Đặng Thị Hạnh",
  "Bùi Văn Tâm",
  "Đỗ Thị Ngọc",
  "Huỳnh Gia Huy",
  "Phan Thị Yến",
  "Vũ Đức Anh",
  "Ngô Thị Hồng",
  "Dương Văn Lộc",
];
const PROVINCES = ["TP. Hồ Chí Minh", "Hà Nội", "Đà Nẵng", "Cần Thơ", "Nghệ An", "Đắk Lắk", "Hải Phòng", "An Giang"];
const OCCUPATIONS = ["sinh viên", "công nhân may", "bán hàng online", "nội trợ", "tài xế công nghệ", "giáo viên", "nông dân", "nhân viên văn phòng"];
const SITUATIONS = [
  "Bạn vừa thấy dòng báo COD không khả dụng khi đặt một nồi chiên không dầu 890.000đ.",
  "Tuần trước bạn có 2 đơn shipper báo giao thất bại dù bạn không nhận được cuộc gọi nào.",
  "Hôm nay bạn đã đặt 6 đơn COD cho cả nhà và đơn thứ 7 không chọn được COD.",
  "Bạn từ chối nhận một đơn vì hộp bị móp, giờ không đặt COD được nữa.",
  "Bạn chưa từng có thẻ ngân hàng và chỉ quen trả tiền mặt cho shipper.",
  "Em gái dùng chung tài khoản của bạn và hay hủy đơn khi shipper tới.",
];

const PAYMENT_INSTRUMENTS: Record<string, string[]> = {
  cod_only: ["tiền mặt"],
  ewallet: ["tiền mặt", "ShopeePay"],
  card: ["tiền mặt", "thẻ ATM", "chuyển khoản"],
};

const ACCOUNT_SHARING: Record<string, string> = {
  solo: "Dùng một mình.",
  family_shared: "Cả nhà dùng chung một tài khoản.",
  multi_account: "Có hai tài khoản, một cái của em trai.",
};

const SURFACES_BY_CHANNEL: Record<string, string[]> = {
  help_article: ["help", "checkout"],
  checkout_only: ["checkout"],
  friend_paraphrase: [],
};

function levelOf(levels: LevelChoice[], dimId: string): string {
  const choice = levels.find((l) => l.dimId === dimId);
  if (choice === undefined) throw new Error(`scenario has no level for ${dimId}`);
  return choice.levelId;
}

function makeScenario(rand: () => number, index: number, batch: number, focus: string | null): Scenario {
  const levels: LevelChoice[] = DIMENSIONS.map((dim, d) => {
    // Seed: Latin-square-ish cover; adaptive: oversample the focus dimension's non-default levels.
    const levelIdx = focus === dim.id ? 1 + (index % 2) : batch === 0 ? (index + d * (index >> 2)) % 3 : Math.floor(rand() * 3);
    const level = dim.levels[levelIdx];
    if (level === undefined) throw new Error("level index out of range");
    return { dimId: dim.id, levelId: level.id };
  });
  const payment = levelOf(levels, "payment");
  const sharing = levelOf(levels, "account_sharing");
  const prior = levelOf(levels, "prior_belief");
  const channel = levelOf(levels, "channel");
  const surfaceIds = SURFACES_BY_CHANNEL[channel] ?? [];
  const folk = FOLK_BY_LEVEL[prior] ?? null;
  const name = NAMES[index % NAMES.length] ?? "Khách";
  return {
    id: `s${String(index + 1).padStart(3, "0")}`,
    policyId: POLICY_ID,
    batch,
    origin: batch === 0 ? "seed" : "adaptive",
    levels,
    persona: {
      name: `[fixture] ${name}`,
      age: 18 + Math.floor(rand() * 45),
      province: pick(rand, PROVINCES),
      occupation: pick(rand, OCCUPATIONS),
      literacy: pick(rand, ["low", "medium", "high"] as const),
      paymentInstruments: PAYMENT_INSTRUMENTS[payment] ?? [],
      accountSharing: ACCOUNT_SHARING[sharing] ?? "",
      history: `${1 + Math.floor(rand() * 40)} đơn trên Shopee, ${Math.floor(rand() * 3)} đơn giao thất bại trong 3 tháng.`,
    },
    exposure: {
      surfaceIds,
      folkVersionId: surfaceIds.length === 0 ? (folk ?? "folk-more-than-2") : folk,
      attention: rand() < 0.6 ? "skim" : "careful",
    },
    situationVi: pick(rand, SITUATIONS),
    allocationReason: focus === null ? null : `Tập trung vào chiều "${focus}" theo quyết định phân bổ lô ${batch}.`,
  };
}

interface Generated {
  reading: Reading;
  grades: Grade[];
  /** interpretation id → archetype key */
  archetypes: Map<string, ArchetypeKey>;
}

function makeReading(rand: () => number, scenario: Scenario, index: number, pool: ArchetypeKey[]): Generated {
  const readingId = `r-${scenario.id}-v0`;
  const first = pool[index % pool.length];
  if (first === undefined) throw new Error("empty pool");
  const keys: ArchetypeKey[] = [first];
  if (rand() < 0.5) {
    const second = pick(rand, pool);
    if (second !== first) keys.push(second);
  }
  keys.push("nullThreshold");

  const archetypes = new Map<string, ArchetypeKey>();
  const interpretations: Interpretation[] = [];
  const grades: Grade[] = [];
  keys.forEach((key, i) => {
    const a = archetype(key);
    const id = `${readingId}.i${i + 1}`;
    archetypes.set(id, key);
    interpretations.push({
      id,
      quote: a.quote,
      sentenceId: a.sentenceId,
      meaningVi: a.meaningVi,
      glossEn: a.glossEn,
      confidence: round(0.45 + rand() * 0.5),
    });
    const conflicts = rand() < a.conflictProb;
    grades.push({
      readingId,
      interpretationId: id,
      label: conflicts ? "conflicts" : a.otherLabel,
      confidence: round(0.6 + rand() * 0.39),
      factIds: a.factIds,
      why: conflicts ? `Trái với ${a.factIds.join(", ") || "văn bản"}: ${a.labelEn}.` : `Phù hợp hoặc không kiểm chứng được: ${a.labelEn}.`,
    });
  });

  const main = archetype(first);
  const actions = [{ action: main.action, detailVi: main.actionVi }];
  if (rand() < 0.4) actions.push({ action: "contact_support", detailVi: "Nhắn CSKH hỏi tại sao bị khóa COD." });

  return {
    reading: {
      id: readingId,
      scenarioId: scenario.id,
      policyId: POLICY_ID,
      policyVersion: 0,
      model: MODEL,
      paraphraseVi: `Theo tôi hiểu: ${main.meaningVi}`,
      interpretations,
      questions: [
        {
          id: `${readingId}.q1`,
          quote: "vượt quá quy định hiện hành",
          questionVi: "Quy định hiện hành là bao nhiêu đơn, và bị khóa trong bao lâu?",
          glossEn: "What is the current threshold, and how long does the lock last?",
        },
      ],
      actions,
      feelingVi: pick(rand, ["Bực mình vì không rõ lý do.", "Lo bị khóa tài khoản luôn.", "Hơi khó hiểu nhưng chắc chờ là được.", "Thấy bị đối xử không công bằng."]),
    },
    grades,
    archetypes,
  };
}

function buildClusters(generated: Generated[], gradesById: Map<string, Grade>): Cluster[] {
  const order = Object.keys(ARCHETYPES) as ArchetypeKey[];
  const clusters: Cluster[] = [];
  for (const key of order) {
    const a = archetype(key);
    const interpretationIds: string[] = [];
    const readingIds = new Set<string>();
    for (const g of generated) {
      for (const [interpId, k] of g.archetypes) {
        if (k !== key) continue;
        interpretationIds.push(interpId);
        readingIds.add(g.reading.id);
      }
    }
    if (interpretationIds.length === 0) continue;
    const conflicts = interpretationIds.filter((id) => gradesById.get(id)?.label === "conflicts").length;
    clusters.push({
      id: a.clusterId,
      policyVersion: 0,
      sentenceId: a.sentenceId,
      interpretationIds,
      readingIds: [...readingIds],
      labelEn: a.labelEn,
      labelVi: a.labelVi,
      conflictShare: round(conflicts / interpretationIds.length),
    });
  }
  return clusters;
}

const SPLIT_STATS: Record<string, { nmi: number; z: number }> = {
  payment: { nmi: 0.11, z: 1.4 },
  account_sharing: { nmi: 0.27, z: 3.1 },
  prior_belief: { nmi: 0.19, z: 2.2 },
  channel: { nmi: 0.05, z: 0.6 },
};

function buildSplit(generated: Generated[], scenarios: Map<string, Scenario>, gradesById: Map<string, Grade>): SplitRow[] {
  return DIMENSIONS.map((dim) => {
    const stats = SPLIT_STATS[dim.id] ?? { nmi: 0, z: 0 };
    return {
      dimId: dim.id,
      nmi: stats.nmi,
      z: stats.z,
      byLevel: dim.levels.map((level) => {
        const inLevel = generated.filter((g) => {
          const s = scenarios.get(g.reading.scenarioId);
          return s !== undefined && levelOf(s.levels, dim.id) === level.id;
        });
        const interps = inLevel.flatMap((g) => g.reading.interpretations.map((i) => i.id));
        const conflicts = interps.filter((id) => gradesById.get(id)?.label === "conflicts").length;
        return { levelId: level.id, n: inLevel.length, conflictShare: interps.length === 0 ? 0 : round(conflicts / interps.length) };
      }),
    };
  });
}

// ---------------------------------------------------------------------------
// Findings and rewrite

function sentenceText(version: PolicyVersion, id: string): string {
  const s = version.sentences.find((x) => x.id === id);
  if (s === undefined) throw new Error(`no sentence ${id}`);
  return s.text;
}

const PASSING = (factIds: string[]): FidelityResult => ({
  passed: true,
  facts: factIds.map((factId) => ({ factId, entailed: true, why: "Bản viết lại vẫn nêu đúng nội dung này." })),
  newCommitments: [],
  requiresNewFact: null,
});

function evidence(clusterIds: string[], clusters: Cluster[], readings: Reading[]): Finding["evidence"] {
  const readingIds = [...new Set(clusters.filter((c) => clusterIds.includes(c.id)).flatMap((c) => c.readingIds))];
  const scenarioIds = readings.filter((r) => readingIds.includes(r.id)).map((r) => r.scenarioId);
  return { clusterIds, scenarioIds, readingIds };
}

function buildRewriteTexts(v0: PolicyVersion): Record<"help.3" | "help.4" | "help.11", { before: string; after: string }> {
  return {
    "help.3": {
      before: sentenceText(v0, "help.3"),
      after:
        "- Bạn đang bị giới hạn tạm thời chức năng thanh toán này trong 24 giờ do tài khoản đã đặt quá nhiều đơn hàng COD trong cùng một ngày (giới hạn này tính theo số đơn đặt, không phải số đơn giao không thành công) hoặc",
    },
    "help.4": {
      before: sentenceText(v0, "help.4"),
      after:
        "- Shopee đang tạm thời tắt chức năng Thanh toán khi nhận hàng của bạn do có quá nhiều đơn hàng COD giao không thành công vì bạn không nhận hàng; đơn giao thất bại do lỗi người bán hoặc đơn vị vận chuyển có thể khiếu nại qua CSKH",
    },
    "help.11": {
      before: sentenceText(v0, "help.11"),
      after:
        "Chức năng COD không tự mở lại sau một thời gian chờ: hệ thống kiểm tra mỗi ngày và sẽ mở lại khi bạn có thêm đơn hàng nhận thành công bằng phương thức thanh toán khác (ví dụ ShopeePay, thẻ, chuyển khoản).",
    },
  };
}

function buildFindings(v0: PolicyVersion, clusters: Cluster[], readings: Reading[]): Finding[] {
  const texts = buildRewriteTexts(v0);
  return [
    {
      id: "find-1",
      title: "\"Giao không thành công\" không nói rõ lỗi của ai thì bị tính",
      sentenceIds: ["help.4"],
      readingSummary: "Phần lớn người đọc cho rằng mọi đơn giao thất bại đều bị tính, kể cả khi shipper hoặc người bán gây ra.",
      plausibility: "Rất dễ xảy ra: người mua từng gặp shipper báo giao thất bại sai đọc câu này như một hình phạt không công bằng.",
      dimsAssociated: ["prior_belief", "channel"],
      conflictsReference: true,
      factIds: ["F2", "F4"],
      class: "wording_fix",
      classRationale: "Quy tắc đã có (F4: khiếu nại qua CSKH); chỉ cần nói ra trong văn bản.",
      repair: { targetSentenceIds: ["help.4"], rewriteVi: texts["help.4"].after, fidelity: PASSING(["F2", "F4"]) },
      evidence: evidence(["c-h4-anyfault", "c-h4-refusal"], clusters, readings),
    },
    {
      id: "find-2",
      title: "Giới hạn 24 giờ bị hiểu là phạt vì giao thất bại",
      sentenceIds: ["help.3"],
      readingSummary: "Người đọc gộp giới hạn số đơn COD trong ngày với khóa do giao thất bại.",
      plausibility: "Hai lý do nằm cạnh nhau và đều dùng chữ 'giới hạn'; các bài báo cũng gộp chung (folk-24h-failed-orders).",
      dimsAssociated: ["prior_belief"],
      conflictsReference: true,
      factIds: ["F1"],
      class: "wording_fix",
      classRationale: "F1 đã quy định rõ giới hạn theo số đơn đặt; chỉ cần tách nghĩa.",
      repair: { targetSentenceIds: ["help.3"], rewriteVi: texts["help.3"].after, fidelity: PASSING(["F1"]) },
      evidence: evidence(["c-h3-failed"], clusters, readings),
    },
    {
      id: "find-3",
      title: "Cách mở lại COD bị hiểu là tự động sau thời gian chờ",
      sentenceIds: ["help.11"],
      readingSummary: "Nhiều người nghĩ chỉ cần chờ là COD tự mở lại, trong khi văn bản yêu cầu đơn trả trước thành công.",
      plausibility: "Cụm 'tự mở lại' đứng cuối câu dài và được nhớ nhiều nhất; người chỉ dùng tiền mặt bỏ qua phần điều kiện.",
      dimsAssociated: ["payment"],
      conflictsReference: true,
      factIds: ["F3"],
      class: "wording_fix",
      classRationale: "F3 đã có; viết lại để điều kiện đứng trước.",
      repair: { targetSentenceIds: ["help.11"], rewriteVi: texts["help.11"].after, fidelity: PASSING(["F3"]) },
      evidence: evidence(["c-h11-auto", "c-h11-prepaid"], clusters, readings),
    },
    {
      id: "find-4",
      title: "Giới hạn theo tài khoản khuyến khích dùng tài khoản khác",
      sentenceIds: ["help.3"],
      readingSummary: "Người có nhiều tài khoản hoặc dùng chung gia đình định chuyển sang tài khoản khác để đặt COD ngay.",
      plausibility: "Văn bản nói 'tài khoản đang sử dụng', nên lách bằng tài khoản khác là suy luận hợp lý.",
      dimsAssociated: ["account_sharing"],
      conflictsReference: false,
      factIds: ["F1"],
      class: "design_gap",
      classRationale: "Sửa câu chữ không đủ: muốn chặn hành vi này phải đổi quy tắc (giới hạn theo người/thiết bị).",
      repair: {
        targetSentenceIds: ["help.3"],
        rewriteVi:
          "- Bạn đang bị giới hạn tạm thời chức năng thanh toán này trong 24 giờ do bạn (trên mọi tài khoản và thiết bị) đã vượt mức giới hạn số đơn hàng COD trong ngày hoặc",
        fidelity: {
          passed: false,
          facts: [{ factId: "F1", entailed: false, why: "F1 chỉ nói giới hạn theo tài khoản, không theo người hay thiết bị." }],
          newCommitments: ["Giới hạn áp dụng trên mọi tài khoản và thiết bị của cùng một người."],
          requiresNewFact: { text: "Giới hạn số đơn COD trong ngày áp dụng theo người mua (mọi tài khoản/thiết bị), không theo từng tài khoản.", kind: "changes_rule" },
        },
      },
      evidence: evidence(["c-h3-account"], clusters, readings),
    },
    {
      id: "find-5",
      title: "Ngưỡng và thời gian khóa không được công bố",
      sentenceIds: ["help.4"],
      readingSummary: "Hầu hết người đọc hỏi bao nhiêu đơn thì bị khóa và khóa bao lâu, rồi tự điền con số từ tin đồn (3 đơn/90 ngày, 60 ngày).",
      plausibility: "Văn bản chỉ nói 'vượt quá quy định hiện hành'; các trang ngoài lan truyền con số cụ thể.",
      dimsAssociated: ["prior_belief"],
      conflictsReference: false,
      factIds: [],
      class: "unresolvable",
      classRationale: "Không có nguồn chính thức nào nêu ngưỡng; không thể viết lại mà không bịa thông tin.",
      repair: {
        targetSentenceIds: ["help.4"],
        rewriteVi: "- Shopee tạm thời tắt chức năng Thanh toán khi nhận hàng nếu bạn có từ 3 đơn COD giao không thành công trong 90 ngày",
        fidelity: {
          passed: false,
          facts: [{ factId: "F2", entailed: true, why: "Vẫn nêu việc tắt COD do giao thất bại." }],
          newCommitments: ["Ngưỡng 3 đơn trong 90 ngày."],
          requiresNewFact: { text: "Ngưỡng số đơn giao thất bại và thời gian khóa COD.", kind: "missing_info" },
        },
      },
      evidence: evidence(["c-null-threshold"], clusters, readings),
    },
  ];
}

// ---------------------------------------------------------------------------

export function writeFixtureRun(opts: { runId: string; runsDir?: string }): { events: number } {
  const file = eventsPath(opts.runId, opts.runsDir);
  if (existsSync(file)) rmSync(file);
  const w = new RunWriter(opts.runId, opts.runsDir);
  const rand = prng(20261031);
  let count = 0;
  const append: RunWriter["append"] = (type, payload) => {
    count += 1;
    return w.append(type, payload);
  };

  const pkg = loadPolicyPackage(POLICY_ID);
  const v0 = versionZero(pkg);

  append("run.started", {
    config: {
      policyId: POLICY_ID,
      budget: 50,
      seedSize: SEED_SIZE,
      batchSize: BATCH_SIZE,
      maxIterations: 3,
      models: { reader: MODEL, judge: MODEL, grader: MODEL, reviewer: MODEL },
      fresh: false,
    },
  });
  append("log", { level: "info", message: "[fixture] synthetic run: no model was called" });
  append("policy.version", { policy: v0 });
  append("dims.extracted", { dimensions: DIMENSIONS });

  const scenarios = new Map<string, Scenario>();
  const generated: Generated[] = [];
  const gradesById = new Map<string, Grade>();

  const runBatch = (batch: number, from: number, size: number, pool: ArchetypeKey[], focus: string | null): void => {
    const batchGenerated: Generated[] = [];
    for (let i = from; i < from + size; i++) {
      const scenario = makeScenario(rand, i, batch, focus);
      scenarios.set(scenario.id, scenario);
      append("scenario.created", { scenario });
    }
    for (let i = from; i < from + size; i++) {
      const scenario = scenarios.get(`s${String(i + 1).padStart(3, "0")}`);
      if (scenario === undefined) throw new Error("scenario missing");
      const g = makeReading(rand, scenario, i - from, pool);
      batchGenerated.push(g);
      append("reading.completed", { reading: g.reading });
    }
    const grades = batchGenerated.flatMap((g) => g.grades);
    for (const grade of grades) gradesById.set(grade.interpretationId, grade);
    generated.push(...batchGenerated);
    append("grades.added", { grades });
  };

  // Batch 0: seed.
  runBatch(0, 0, SEED_SIZE, SEED_POOL, null);
  const clusters0 = buildClusters(generated, gradesById);
  append("clusters.updated", { policyVersion: 0, clusters: clusters0 });

  const decision: AllocationDecision = {
    batch: 1,
    split: buildSplit(generated, scenarios, gradesById),
    discovery: [{ batch: 0, readings: SEED_SIZE, newClusters: clusters0.length }],
    focusDimIds: ["account_sharing", "prior_belief"],
    newLevels: [],
    n: BATCH_SIZE,
    stopExploring: false,
    rationale: "Chiều 'Dùng chung tài khoản' tách mạnh nhất (z=3.1) nhưng mới có ít kịch bản ở mức nhiều tài khoản; dồn lô tiếp theo vào đó.",
    decidedBy: "reviewer",
  };
  append("allocation.decided", { decision });
  append("thread.item", {
    record: {
      threadId: "thr-reviewer-1",
      role: "reviewer",
      label: "[fixture] reviewer: allocation batch 1",
      backend: "appserver",
      itemType: "agentMessage",
      item: { type: "agentMessage", id: "msg-1", text: "Split on account_sharing is strongest (z=3.1); focusing batch 1 there." },
    },
  });
  append("thread.item", {
    record: {
      threadId: "thr-reviewer-1",
      role: "reviewer",
      label: "[fixture] reviewer: allocate tool",
      backend: "appserver",
      itemType: "dynamicToolCall",
      item: {
        type: "dynamicToolCall",
        id: "call-1",
        tool: "allocate_batch",
        arguments: { focusDimIds: ["account_sharing", "prior_belief"], n: BATCH_SIZE },
        status: "completed",
      },
    },
  });

  // Batch 1: adaptive.
  runBatch(1, SEED_SIZE, BATCH_SIZE, ADAPTIVE_POOL, "account_sharing");
  const clusters1 = buildClusters(generated, gradesById);
  append("clusters.updated", { policyVersion: 0, clusters: clusters1 });

  const readings = generated.map((g) => g.reading);
  const findings = buildFindings(v0, clusters1, readings);
  append("findings.updated", { findings });

  const texts = buildRewriteTexts(v0);
  const editSpec: { id: "help.3" | "help.4" | "help.11"; findingId: string }[] = [
    { id: "help.3", findingId: "find-2" },
    { id: "help.4", findingId: "find-1" },
    { id: "help.11", findingId: "find-3" },
  ];
  append("rewrite.proposed", {
    rewrite: {
      fromVersion: 0,
      toVersion: 1,
      edits: editSpec.map(({ id, findingId }) => ({ sentenceIds: [id], before: texts[id].before, after: texts[id].after, findingIds: [findingId] })),
      fidelity: PASSING(["F1", "F2", "F3", "F4"]),
    },
  });
  const surfaces: Surface[] = v0.surfaces.map((surface) => {
    let text = surface.text;
    for (const { id } of editSpec) {
      if (!id.startsWith(`${surface.id}.`)) continue;
      const next = text.replace(texts[id].before, texts[id].after);
      if (next === text) throw new Error(`edit for ${id} did not apply`);
      text = next;
    }
    return { ...surface, text };
  });
  const v1 = makeVersion(POLICY_ID, 1, 0, surfaces);
  append("policy.version", { policy: v1 });

  append("iteration.completed", {
    iteration: {
      policyVersion: 0,
      readings: readings.length,
      conflictRate: 0.42,
      ci95: { lo: 0.33, hi: 0.51 },
      openQuestionRate: 1,
      openWordingFindings: 3,
      findingReproduction: [
        { findingId: "find-1", rate: 0.46 },
        { findingId: "find-2", rate: 0.31 },
        { findingId: "find-3", rate: 0.38 },
      ],
      noiseBand: 0.05,
      decision: "continue",
      reason: "3 wording fixes open; rewrite v1 and retest.",
    },
  });
  append("iteration.completed", {
    iteration: {
      policyVersion: 1,
      readings: readings.length,
      conflictRate: 0.17,
      ci95: { lo: 0.1, hi: 0.25 },
      openQuestionRate: 0.81,
      openWordingFindings: 0,
      findingReproduction: [
        { findingId: "find-1", rate: 0.08 },
        { findingId: "find-2", rate: 0.04 },
        { findingId: "find-3", rate: 0.12 },
      ],
      noiseBand: 0.05,
      decision: "stop",
      reason: "Conflict rate fell 0.42 → 0.17 (beyond the 0.05 noise band); no wording fixes remain, the rest need a rule change or missing information.",
    },
  });
  append("stop.decided", { finalVersion: 1, reason: "No open wording findings; remaining findings are design gaps or unresolvable." });

  append("baseline.completed", {
    run: {
      id: "baseline-1",
      model: MODEL,
      effort: "high",
      issues: [
        { id: "b1-1", sentenceQuote: "vượt quá quy định hiện hành", issue: "Threshold is not stated.", why: "Readers cannot predict when COD gets disabled." },
        { id: "b1-2", sentenceQuote: "giao không thành công", issue: "Fault attribution unclear.", why: "Courier-caused failures may be assumed to count." },
        { id: "b1-3", sentenceQuote: "(như ảnh bên dưới)", issue: "References an image that is missing.", why: "The screenshot is not part of the text." },
      ],
    },
  });
  append("baseline.completed", {
    run: {
      id: "baseline-2",
      model: MODEL,
      effort: "medium",
      issues: [
        { id: "b2-1", sentenceQuote: "vượt quá quy định hiện hành", issue: "Vague threshold.", why: "No number given." },
        { id: "b2-2", sentenceQuote: "Vui lòng chọn phương thức khác", issue: "Checkout line gives no reason.", why: "Users cannot tell which cause applies." },
      ],
    },
  });

  const edgeCases = ["H1", "H2", "H3", "H4"];
  const matchTable: Record<string, (string | null)[]> = {
    "wind-tunnel": ["find-1", "find-2", "find-4", null],
    "baseline-1": ["b1-2", null, null, "b1-1"],
    "baseline-2": [null, null, null, "b2-1"],
  };
  append("score.completed", {
    score: {
      systems: [
        { id: "wind-tunnel", label: "Wind Tunnel", recall: 0.75 },
        { id: "baseline-1", label: "Baseline #1 (high)", recall: 0.5 },
        { id: "baseline-2", label: "Baseline #2 (medium)", recall: 0.25 },
        { id: "baseline-mean", label: "Baseline (mean)", recall: 0.375 },
      ],
      matches: Object.entries(matchTable).flatMap(([systemId, items]) =>
        edgeCases.map((edgeCaseId, i) => {
          const itemId = items[i] ?? null;
          return { edgeCaseId, systemId, matched: itemId !== null, itemId, why: itemId === null ? "No item covers this edge case." : `${itemId} describes the same misreading.` };
        }),
      ),
      outsideReference: [
        { systemId: "wind-tunnel", itemId: "find-3" },
        { systemId: "baseline-1", itemId: "b1-3" },
      ],
    },
  });
  append("run.completed", { summary: "[fixture] 26 readings, 5 findings (3 wording fixes applied in v1); conflict rate 0.42 → 0.17." });

  return { events: count };
}
