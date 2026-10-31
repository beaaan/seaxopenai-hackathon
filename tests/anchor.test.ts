import { describe, expect, it, vi } from "vitest";
import type { DecisionRequest } from "../src/core/llm/decisions";
import { makeVersion } from "../src/core/policy";
import type { StageContext } from "../src/pipeline/context";
import { anchorQuotes, trigramSimilarity } from "../src/sampler/anchor";

function anchorContext() {
  const decide = vi.fn(async (request: DecisionRequest) => request.questions.map((question) => ({
    type: "choice" as const,
    name: question.name,
    choice: "none",
    confidence: 1,
    probabilities: [{ value: "none", probability: 1 }],
  })));
  const ctx = { gateway: { decide } } as unknown as StageContext;
  return { ctx, decide };
}

describe("trigramSimilarity", () => {
  it("normalizes Vietnamese diacritics without discarding them", () => {
    const text = "Thanh toán khi nhận hàng";
    expect(trigramSimilarity(text, text.normalize("NFD"))).toBe(1);
    expect(trigramSimilarity("  THANH TOÁN\n khi\t nhận hàng  ", text)).toBe(1);
    expect(trigramSimilarity(text, "Thanh toan khi nhan hang")).toBeLessThan(1);
  });

  it("uses set Jaccard with an exact half-overlap boundary", () => {
    expect(trigramSimilarity("abcde", "abcdf")).toBe(0.5);
    expect(trigramSimilarity("abcde", "abcdgxy")).toBeCloseTo(1 / 3);
    expect(trigramSimilarity("abcabc", "abc")).toBeCloseTo(1 / 3);
    expect(trigramSimilarity("", " \n ")).toBe(1);
    expect(trigramSimilarity("a", "b")).toBe(0);
  });
});

describe("anchorQuotes", () => {
  it("anchors a sufficiently informative substring even with low whole-sentence overlap", async () => {
    const version = makeVersion("test", 0, null, [{ id: "help", label: "Trợ giúp", text: "Bạn có thể thanh toán COD khi nhận hàng nếu phương thức này khả dụng." }]);
    const { ctx, decide } = anchorContext();
    expect(await anchorQuotes(ctx, version, ["thanh toán COD"], ["help"])).toEqual(["help.1"]);
    expect(decide).not.toHaveBeenCalled();
  });

  it("does not resolve a short quote shared by competing sentences through containment", async () => {
    const version = makeVersion("test", 0, null, [{
      id: "help",
      label: "Trợ giúp",
      text: "Bạn có thể thanh toán COD khi nhận hàng nếu phương thức này khả dụng. Phương thức COD có thể tạm ngừng khi tài khoản gặp giới hạn thanh toán.",
    }]);
    const { ctx, decide } = anchorContext();
    expect(await anchorQuotes(ctx, version, ["COD"], ["help"])).toEqual([null]);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![0].questions).toHaveLength(1);
  });

  it("chooses the most similar containing sentence rather than the first", async () => {
    const version = makeVersion("test", 0, null, [{
      id: "help",
      label: "Trợ giúp",
      text: "Bạn có thể chọn thanh toán khi nhận hàng nếu phương thức này đang khả dụng cho tài khoản và đơn hàng đang đặt. Thanh toán khi nhận hàng.",
    }]);
    const { ctx, decide } = anchorContext();
    expect(await anchorQuotes(ctx, version, ["thanh toán khi nhận hàng"], ["help"])).toEqual(["help.2"]);
    expect(decide).not.toHaveBeenCalled();
  });

  it("requires both twelve normalized characters and three words for containment", async () => {
    const version = makeVersion("test", 0, null, [{
      id: "help",
      label: "Trợ giúp",
      text: "Mã tham khảo 12345 678 90, 1234 678 90 và 1234567890 12 chỉ được dùng trong ví dụ dài nhằm minh họa cách đọc nội dung thông báo, không phải mức hay điều kiện của chính sách.",
    }]);
    const { ctx, decide } = anchorContext();
    expect(await anchorQuotes(ctx, version, ["12345 678 90", "1234 678 90", "1234567890 12"], ["help"])).toEqual(["help.1", null, null]);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(decide.mock.calls[0]![0].questions).toHaveLength(2);
  });

  it("anchors canonically equivalent Vietnamese quotes", async () => {
    const version = makeVersion("test", 0, null, [{ id: "help", label: "Trợ giúp", text: "Thanh toán khi nhận hàng có thể bị giới hạn." }]);
    const { ctx, decide } = anchorContext();
    expect(await anchorQuotes(ctx, version, ["THANH TOÁN KHI NHẬN HÀNG".normalize("NFD")], ["help"])).toEqual(["help.1"]);
    expect(decide).not.toHaveBeenCalled();
  });

  it("accepts similarity exactly 0.5 but sends lower scores through one batched decision", async () => {
    const version = makeVersion("test", 0, null, [{ id: "help", label: "Trợ giúp", text: "abcde" }]);
    const { ctx, decide } = anchorContext();
    expect(await anchorQuotes(ctx, version, ["abcdf", "abcdgxy", "a different claim"], ["help"])).toEqual(["help.1", null, null]);
    expect(decide).toHaveBeenCalledTimes(1);
    const request = decide.mock.calls[0]![0];
    expect(request.questions).toHaveLength(2);
    expect(request.questions[0]).toMatchObject({ choices: [{ value: "help.1", description: "abcde" }, { value: "none" }] });
  });

  it("never anchors a folk-only reading or an unseen official surface", async () => {
    const version = makeVersion("test", 0, null, [
      { id: "help", label: "Trợ giúp", text: "Một điều kiện bí mật khác." },
      { id: "checkout", label: "Thanh toán", text: "Bạn chọn phương thức thanh toán." },
    ]);
    const { ctx, decide } = anchorContext();
    expect(await anchorQuotes(ctx, version, ["Một điều kiện bí mật khác."], [])).toEqual([null]);
    expect(decide).not.toHaveBeenCalled();
    expect(await anchorQuotes(ctx, version, ["Một điều kiện bí mật khác."], ["checkout"])).toEqual([null]);
    const request = decide.mock.calls[0]![0];
    expect(request.evidence).not.toContain("bí mật");
    if (request.questions[0]!.type === "choice") {
      expect(request.questions[0]!.choices.map((choice) => choice.value)).toEqual(["checkout.1", "none"]);
    }
  });

  it("leaves blank quotes unanchored instead of matching every sentence", async () => {
    const version = makeVersion("test", 0, null, [{ id: "help", label: "Trợ giúp", text: "Một câu." }]);
    const { ctx, decide } = anchorContext();
    expect(await anchorQuotes(ctx, version, ["", " \t "], ["help"])).toEqual([null, null]);
    expect(decide).not.toHaveBeenCalled();
  });
});
