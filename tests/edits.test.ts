import { describe, expect, it } from "vitest";
import { makeVersion } from "../src/core/policy";
import { applyEdits } from "../src/reviewer/edits";
import { splitSurfaces } from "../src/shared/sentences";

const version = () => makeVersion("example", 0, null, [
  { id: "help", label: "Bài hướng dẫn", text: "Bạn có thể đặt hàng.\nHãy chọn thanh toán trước.\nHệ thống kiểm tra mỗi ngày." },
  { id: "checkout", label: "Thanh toán", text: "Vui lòng chọn cách thanh toán khác." },
]);

describe("applyEdits", () => {
  it("replaces only the exact anchored sentence and preserves the source", () => {
    const original = version();
    const result = applyEdits(original, [{ sentenceId: "help.2", newText: "Bạn hãy trả tiền trước khi nhận hàng." }]);
    expect(result[0]?.text).toBe("Bạn có thể đặt hàng.\nBạn hãy trả tiền trước khi nhận hàng.\nHệ thống kiểm tra mỗi ngày.");
    expect(result[1]).toEqual(original.surfaces[1]);
    expect(original.surfaces[0]?.text).toContain("Hãy chọn thanh toán trước.");
  });

  it("inserts a new line after a sentence, including a sentence in the middle of a line", () => {
    const original = makeVersion("example", 0, null, [{ id: "main", label: "T", text: "Câu một. Câu hai." }]);
    const result = applyEdits(original, [{ afterSentenceId: "main.1", text: "Câu được thêm." }]);
    expect(result[0]?.text).toBe("Câu một.\nCâu được thêm.\n Câu hai.");
    expect(splitSurfaces(result).map((sentence) => sentence.text)).toEqual(["Câu một.", "Câu được thêm.", "Câu hai."]);
  });

  it("applies multiple edits against original positions and re-splits expected sentences", () => {
    const result = applyEdits(version(), [
      { sentenceId: "help.3", newText: "Hệ thống xem lại hằng ngày. Bạn không cần chờ một số ngày cố định." },
      { afterSentenceId: "help.1", text: "Bạn được chọn cách thanh toán hiện có." },
      { sentenceId: "help.2", newText: "Bạn hãy thanh toán trước." },
    ]);
    expect(splitSurfaces(result).map((sentence) => [sentence.id, sentence.text])).toEqual([
      ["help.1", "Bạn có thể đặt hàng."],
      ["help.2", "Bạn được chọn cách thanh toán hiện có."],
      ["help.3", "Bạn hãy thanh toán trước."],
      ["help.4", "Hệ thống xem lại hằng ngày."],
      ["help.5", "Bạn không cần chờ một số ngày cố định."],
      ["checkout.1", "Vui lòng chọn cách thanh toán khác."],
    ]);
  });

  it("supports replacement and insertion at the same sentence boundary", () => {
    const result = applyEdits(version(), [
      { afterSentenceId: "help.1", text: "Câu mới." },
      { sentenceId: "help.1", newText: "Bạn vẫn đặt hàng được." },
    ]);
    expect(result[0]?.text).toBe("Bạn vẫn đặt hàng được.\nCâu mới.\nHãy chọn thanh toán trước.\nHệ thống kiểm tra mỗi ngày.");
  });

  it("throws on unknown ids for both edit forms", () => {
    expect(() => applyEdits(version(), [{ sentenceId: "missing.1", newText: "Câu mới." }])).toThrow("Unknown sentence id");
    expect(() => applyEdits(version(), [{ afterSentenceId: "help.99", text: "Câu mới." }])).toThrow("Unknown sentence id");
  });

  it("rejects overlapping replacements and ambiguous insertions", () => {
    expect(() => applyEdits(version(), [
      { sentenceId: "help.1", newText: "Một." },
      { sentenceId: "help.1", newText: "Hai." },
    ])).toThrow("Overlapping edits");
    expect(() => applyEdits(version(), [
      { afterSentenceId: "help.1", text: "Một." },
      { afterSentenceId: "help.1", text: "Hai." },
    ])).toThrow("Overlapping edits");
  });

  it("distinguishes repeated sentences by their ordered occurrence", () => {
    const repeated = makeVersion("example", 0, null, [{ id: "main", label: "T", text: "Same.\nSame." }]);
    expect(applyEdits(repeated, [{ sentenceId: "main.2", newText: "Changed." }])[0]?.text).toBe("Same.\nChanged.");
    expect(applyEdits(repeated, [
      { sentenceId: "main.2", newText: "Second." },
      { sentenceId: "main.1", newText: "First." },
    ])[0]?.text).toBe("First.\nSecond.");
    expect(applyEdits(repeated, [{ afterSentenceId: "main.2", text: "Last." }])[0]?.text).toBe("Same.\nSame.\nLast.");
  });

  it("does not replace a sentence-shaped substring of an earlier sentence", () => {
    const original = makeVersion("example", 0, null, [{ id: "main", label: "T", text: "Not eligible.\neligible." }]);
    expect(applyEdits(original, [{ sentenceId: "main.2", newText: "Qualified." }])[0]?.text).toBe("Not eligible.\nQualified.");
    expect(applyEdits(original, [
      { sentenceId: "main.1", newText: "Disqualified." },
      { sentenceId: "main.2", newText: "Qualified." },
    ])[0]?.text).toBe("Disqualified.\nQualified.");
  });
});
