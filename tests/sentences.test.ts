import { describe, expect, it } from "vitest";
import { splitSentences } from "../src/shared/sentences";

const surface = (text: string) => ({ id: "help", label: "t", text });

describe("splitSentences", () => {
  it("keeps bullets and headings as separate sentences and splits multi-sentence lines", () => {
    const text = [
      "⚠️Lưu ý:",
      "- Đối với trường hợp tài khoản bạn đang giới hạn tạm thời chức năng thanh toán COD trong 24 giờ:",
      "Bạn vui lòng thử lại sau thời gian trên. Nếu sau 24h bạn vẫn chưa thể chọn được hình thức thanh toán COD, thì tài khoản của bạn có thể rơi vào trường hợp Shopee tạm thời tắt chức năng Thanh toán khi nhận hàng",
    ].join("\n");
    const sentences = splitSentences(surface(text));
    expect(sentences.map((s) => s.id)).toEqual(["help.1", "help.2", "help.3", "help.4"]);
    expect(sentences[2]?.text).toBe("Bạn vui lòng thử lại sau thời gian trên.");
    expect(sentences[3]?.text.startsWith("Nếu sau 24h")).toBe(true);
  });

  it("does not split after abbreviations, list markers, ellipses inside parentheses, or numbered clauses", () => {
    const text = [
      "Giao tại TP. Hồ Chí Minh trong 2 ngày. Sau đó hoàn hàng.",
      "1. Sau khi Đối tác tài xế đã nhận chuyến; và",
      "2.2 Phí Hủy Chuyến 20.000 đồng sẽ được áp dụng trong các trường hợp sau:",
      "(ví dụ: mã điện tử để nạp điện thoại, mã vé xem phim điện tử...) hoặc",
    ].join("\n");
    expect(splitSentences(surface(text)).map((s) => s.text)).toEqual([
      "Giao tại TP. Hồ Chí Minh trong 2 ngày.",
      "Sau đó hoàn hàng.",
      "1. Sau khi Đối tác tài xế đã nhận chuyến; và",
      "2.2 Phí Hủy Chuyến 20.000 đồng sẽ được áp dụng trong các trường hợp sau:",
      "(ví dụ: mã điện tử để nạp điện thoại, mã vé xem phim điện tử...) hoặc",
    ]);
  });

  it("is deterministic for Windows line endings and blank lines", () => {
    const unix = splitSentences(surface("Câu một.\n\nCâu hai."));
    const windows = splitSentences(surface("Câu một.\r\n\r\nCâu hai."));
    expect(windows).toEqual(unix);
  });
});
