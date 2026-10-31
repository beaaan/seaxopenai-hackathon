# Policy Wind Tunnel — Source Research
Accessed 2026-10-31. Verbatim Vietnamese is quoted exactly, including typos in the original. [UNVERIFIED] = not confirmed at a primary source. [INFERENCE] = my own conclusion.

## 1. Shopee VN — official COD-restriction text

### 1.1 Main article (buyer side): help 79294
URL: https://help.shopee.vn/portal/4/article/79294 (canonical: https://help.shopee.vn/4/article/79294-%5BThanh-to%C3%A1n-khi-nh%E1%BA%ADn-h%C3%A0ng%5D-T%E1%BA%A1i-sao-t%C3%B4i-kh%C3%B4ng-th%E1%BB%83-ch%E1%BB%8Dn-ph%C6%B0%C6%A1ng-th%E1%BB%A9c-Thanh-to%C3%A1n-khi-nh%E1%BA%ADn-h%C3%A0ng)
Title: "[Thanh toán khi nhận hàng] Tại sao tôi không thể chọn phương thức Thanh toán khi nhận hàng?" — the page shows no date or "last updated".

> Bạn không thể lựa chọn hình thức Thanh toán khi nhận hàng (gọi tắt là COD) do một trong các nguyên nhân sau:
> - Người bán không sử dụng các hình thức vận chuyển của Shopee và không cung cấp hình thức thanh toán này cho sản phẩm bạn chọn mua (ví dụ: mã điện tử để nạp điện thoại, mã vé xem phim điện tử...) hoặc
> - Bạn đang bị giới hạn tạm thời chức năng thanh toán này trong 24 giờ do tài khoản đang sử dụng đã vượt mức giới hạn về số đơn hàng được chọn hình thức thanh toán COD trong ngày hoặc
> - Shopee đang tạm thời tắt chức năng Thanh toán khi nhận hàng của bạn do hệ thống ghi nhận lịch sử mua hàng của bạn có số lượng đơn hàng COD giao không thành công vượt quá quy định hiện hành
>
> Shopee giám sát hoạt động thanh toán của bạn và sẽ có thông báo nhắc nhở mỗi lần bạn có đơn hàng "Thanh toán khi nhận hàng" giao không thành công (như ảnh bên dưới)
>
> ⚠️Lưu ý:
> - Đối với trường hợp tài khoản bạn đang giới hạn tạm thời chức năng thanh toán COD trong 24 giờ:
> Bạn vui lòng thử lại sau thời gian trên. Nếu sau 24h bạn vẫn chưa thể chọn được hình thức thanh toán COD, thì tài khoản của bạn có thể rơi vào trường hợp Shopee tạm thời tắt chức năng Thanh toán khi nhận hàng
> - Đối với trường hợp Shopee tạm thời tắt chức năng Thanh toán khi nhận hàng:
> Hệ thống sẽ liên tục kiểm tra lịch sử mua hàng thành công của bạn mỗi ngày, bạn có thể mua và nhận hàng thành công theo các hình thức thanh toán khác hiện có trên Shopee để hệ thống ghi nhận và tự mở lại chức năng COD khi bạn đủ điều kiện sử dụng.

What the official text does not specify:
- **Threshold:** no number ("vượt quá quy định hiện hành").
- **Time window:** none given.
- **Buyer fault:** never mentioned. Any "đơn hàng COD giao không thành công" counts.
- **Recovery:** prepaid orders delivered successfully, checked daily. No number of orders given.
- **Daily COD cap:** exists, but no number given.

### 1.2 Related official lines
- **help 84824** (https://help.shopee.vn/portal/4/article/84824), payment error table. This is a general daily payment cap, not specific to COD:
  > Lỗi (M10): Rất tiếc, tài khoản của bạn đã vượt hạn mức thanh toán trong ngày. Vui lòng thử lại ngày tiếp theo | Bạn vui lòng đặt hàng lại vào ngày mai
- **help 79522** "[Lỗi] Tại Sao Tôi Không Đặt Hàng Được Trên Shopee?" (https://help.shopee.vn/portal/4/article/79522): has no COD-lock row at all. The only payment row is "Phương thức thanh toán không phù hợp".
- **help 79084** (https://help.shopee.vn/portal/4/article/79084). This is the only official recovery path when the failure was the shipper's fault:
  > **2. Shipper không liên hệ nhưng lại cập nhật chuyển hoàn:** … 2. Trường hợp tài khoản của bạn bị khóa hình thức Thanh toán khi nhận hàng vì nguyên nhân trên, vui lòng liên hệ **nhân viên CSKH của Shopee** để được hỗ trợ
  > **1. Shipper không liên hệ nhưng cập nhật trạng thái giao không thành công:** … Shipper sẽ có 3 lần liên hệ với bạn để giao đơn hàng theo **thời gian nhận hàng dự kiến**
- **Chính sách vận chuyển, help 77250** (https://help.shopee.vn/portal/4/article/77250; "Chính Sách này được cập nhật và đăng tải ngày 15/9/2026"). Shopee itself tells buyers to refuse in some cases:
  > 3. Người Mua vui lòng kiểm tra kỹ bao bì của sản phẩm. Nếu bao bì sản phẩm có dấu hiệu bị hư hại (rách/móp méo/vỡ/ướt), không còn "nguyên đai, nguyên kiện" hoặc bạn nghi ngờ hàng hóa bên trong bị hư hại, vui lòng từ chối nhận hàng.
- **help 188931**, return/refund rules (https://help.shopee.vn/portal/4/article/188931):
  > Nếu hàng nhận được có vấn đề (khác với mô tả, hư hỏng,...), bạn có thể từ chối nhận hàng khi đồng kiểm (đối với đơn hàng được Đồng kiểm)
- **Điều khoản dịch vụ, help 77243** (https://help.shopee.vn/portal/4/article/77243). This is the only COD clause in the ToS:
  > (ii) Thanh Toán Khi Nhận Hàng (COD) — Shopee cung cấp dịch vụ COD ở một số nước. Người Mua có thể trả tiền mặt trực tiếp cho người vận chuyển vào thời điểm nhận hàng.

### 1.3 Seller side (Shopee Uni / banhang.shopee.vn)
These pages load their content with JavaScript, so a normal fetch is empty. I read them through the reader https://r.jina.ai/<url>.

- **"Giao không thành công là gì?"**, https://banhang.shopee.vn/edu/article/14303 (page date **12-06-2025**). The definition below includes wrong address and repeated failed contact, not just refusal:
  > Giao không thành công xảy ra khi các đơn vị vận chuyển không thể giao hàng cho Người mua, với những lý do như: 1. Đơn giao không thành công: Người mua từ chối nhận hàng, địa chỉ Người mua không chính xác hoặc nhiều lần liên hệ giao hàng không thành công; 2. Đơn hủy trên đường giao: Người mua hủy đơn khi đơn hàng đang trong quá trình vận chuyển.
  > - Để đảm bảo môi trường mua sắm lành mạnh và tích cực, Shopee sẽ theo dõi lượng đơn hàng COD không thành công do Người mua tự chối nhận hàng và có thể sẽ hạn chế chức năng "Thanh toán khi nhận hàng" của Người mua nếu hệ thống ghi nhận Người mua có lịch sử từ chối nhận đơn hàng COD chưa phù hợp
- **"Tỷ lệ đơn hàng không thành công là gì?"**, https://banhang.shopee.vn/edu/article/240 (page date **10-09-2026**):
  > Tỷ lệ đơn hàng không thành công (NFR) phản ánh tỷ lệ đơn hàng bị hủy và hoàn hàng do **lỗi của Người bán** trong tuần trước (từ T2-CN).
  > **Đơn hàng không thành công do lỗi Người bán**= Đơn bị hủy bởi Người bán + Đơn bị hủy tự động bởi hệ thống + Đơn bị trả hàng/hoàn tiền + Đơn hủy do yêu cầu từ Người bán

  Buyer refusals are not in the seller's NFR formula.
- **https://banhang.shopee.vn/edu/article/14305**: gives the same definition, plus return logistics (4 working days for the return; 7 days to file a claim).

**Conflict inside Shopee's own pages:**
- The buyer article (79294) counts every failed COD order.
- The seller article (14303) says only refusals by the buyer count, and only "chưa phù hợp" (inappropriate) ones.
- The seller article also defines "giao không thành công" to include wrong address and unreachable buyer.
- The shipping policy (77250) tells buyers to refuse damaged parcels.

## 2. Third-party pages — where they disagree

| Source (date shown) | Threshold | Window | What counts as buyer fault | How COD comes back |
|---|---|---|---|---|
| Official help 79294 (no date) | "vượt quá quy định hiện hành" (no number) | none | any "đơn hàng COD giao không thành công" | prepaid orders delivered; system checks daily; "khi bạn đủ điều kiện" |
| Shopee Uni 14303 (12-06-2025) | none | none | "do Người mua tự chối nhận hàng"; "lịch sử … chưa phù hợp" | not stated |
| magiamgiashopee.vn (pub 2022-06-20, mod 2025-05-31) | 3 orders | "90 ngày liên tiếp" / "90 ngày gần nhất" | any failed COD order | "Sử dụng thanh toán trả trước và nhận hàng thành công"; "khi tỷ lệ nhận hàng thành công của bạn cao lên" |
| bloggiamgia.vn (30-05-2025) | "từ 3 … trở lên" | "90 ngày gần nhất" | any failed COD order | success rate rises → auto-unlock; also suggests making a new account |
| magiamgia.com (mod 2024-03-25) | 3 orders | "90 ngày" | "mà lỗi không xuất phát từ phía người bán hay đơn vị vận chuyển" | "tỷ lệ nhận đơn thành công cao lên" → auto-unlock |
| salework.net (07/02/2023) | "hơn 2 đơn" | "90 ngày gần nhất" | any failed order; if not your fault → contact CSKH | check after 90 days; "trong 90 ngày tính năng này bị khóa không có thêm đơn giao không thành công" |
| viettelstore.vn (05/01/2026) | "nhiều lần không nhận hàng" | "khoảng 60 ngày" (length of the lock) | not receiving the parcel | "Shopee sẽ cân nhắc mở lại" (Shopee will consider; discretionary) |
| Người Lao Động (19/07/2025) | — | 24h | misstates the 24h rule as being about failed orders | — |
| Tuổi Trẻ (11/06/2025) | "vượt quá mức quy định" | 24h rule stated correctly | — | — |

Exact quotes and URLs:
- **https://magiamgiashopee.vn/shopee-khong-cho-thanh-toan-khi-nhan-hang**: "Trong vòng 90 ngày liên tiếp bạn có 3 đơn hàng sử dụng hình thức thanh toán khi nhận hàng giao không thành công thì Shopee sẽ khóa tính năng thanh toán khi nhận hàng."
- **https://bloggiamgia.vn/shopee-khong-cho-thanh-toan-khi-nhan-hang**: "Trong vòng **90 ngày gần nhất**, bạn có từ **3 đơn hàng sử dụng COD** trở lên **giao không thành công**."
- **https://magiamgia.com/shopee-khong-cho-thanh-toan-khi-nhan-hang**: "Nếu trong vòng 90 ngày, có 3 đơn hàng … giao không thành công tới bạn mà lỗi không xuất phát từ phía người bán hay đơn vị vận chuyển, tài khoản … sẽ bị khóa tính năng thanh toán khi nhận hàng."
- **https://salework.net/tai-sao-shopee-khong-cho-thanh-toan-khi-nhan-hang**: "bạn có hơn 2 đơn hàng thanh toán khi nhận hàng nhưng giao không thành công" … "Lưu ý: Để được mở lại … bạn cần đảm bảo trong 90 ngày tính năng này bị khóa không có thêm đơn giao không thành công." It also gives the checkout message: "Phương thức Thanh toán khi nhận hàng tạm thời không khả dụng. Vui lòng chọn phương thức khác". [UNVERIFIED in the app]
- **https://viettelstore.vn/tin-tuc/tai-khoan-shopee-bi-khoa**: "tài khoản Shopee bị khóa chức năng thanh toán COD tạm thời do người dùng nhiều lần không nhận hàng. Thời gian hạn chế thường kéo dài khoảng 60 ngày."
- **https://tuoitre.vn/nld/nhuc-nhoi-nan-bom-hang-19625071822023801.htm** (NLĐ): "Shopee áp dụng hình thức tạm khóa chức năng thanh toán COD trong 24 giờ nếu tài khoản người dùng vượt quá giới hạn đơn hàng COD không thành công trong ngày." This contradicts 79294, where the 24h cap is about the number of COD orders placed in a day.
- **https://tuoitre.vn/khoc-rong-voi-khach-bom-hang-mua-online-20250611084935056.htm**: "khách hàng sẽ bị giới hạn tạm thời chức năng thanh toán COD trong 24 giờ nếu tài khoản của họ vượt quá số đơn hàng được phép thanh toán bằng hình thức này trong ngày."

The "3 orders / 90 days" rule appears in no current Shopee page I could reach. A Wayback lookup of help 79294 returned 404. Status: [UNVERIFIED]. It may be an old rule. [INFERENCE]

## 3. Stat verification

**Claim A: "VECOM: bom hàng 8–12% nationally, up to 20% in remote areas"**
- **Found:** Người Lao Động, "Nhức nhối nạn 'bom hàng'", 19/07/2025, https://tuoitre.vn/nld/nhuc-nhoi-nan-bom-hang-19625071822023801.htm:
  > Theo số liệu từ Hiệp hội TMĐT Việt Nam (VECOM), tỉ lệ đơn hàng bị "bom" trong TMĐT tại Việt Nam dao động từ 8% - 12%, tùy theo ngành hàng và khu vực giao nhận. Con số này có thể lên tới 20% tại các vùng sâu vùng xa, nơi người tiêu dùng ít tiếp cận với TMĐT hoặc chưa quen với quy trình thanh toán trước.
- **Primary VECOM source:** [UNVERIFIED].
  - The article doesn't say which report it comes from.
  - The EBI 2026 page (https://vecom.vn/bao-cao-chi-so-thuong-mai-dien-tu-viet-nam-2026, posted 27/05/2026) links the report only on Google Drive. I did not search that file.
  - I searched the EBI 2024 PDF (https://sct.dongnai.gov.vn/uploads/sct/news/2024/05/bao-cao-eb[...]n.pdf) for "bom|boom|không nhận hàng|hoàn hàng|giao hàng không thành công|từ chối nhận" with no hits. The PDF's extracted text had garbled diacritics, so that negative result isn't conclusive.
- **Suggested citation:** "VECOM, theo báo Người Lao Động (19/07/2025)".

**Claim B: "a refused parcel costs the seller 2–3x a normal order"**
- **Same NLĐ article, but attributed to sellers, not VECOM**, and it's an estimate, not a measurement:
  > Theo nhiều nhà bán hàng, mỗi đơn bị "bom" không chỉ khiến họ mất chi phí vận chuyển hai chiều, mà còn phải gánh thêm phí đóng gói, xử lý đơn, vận hành… có thể cao gấp 2–3 lần so với đơn hàng thông thường.
- **Attributing "2–3x" to VECOM would be wrong.**

**Closest real numbers**

| Number | Who says it | Source |
|---|---|---|
| 10–15%; can exceed 25–30% during sale peaks | ThS Trần Anh Tùng (ĐH Kinh tế-Tài chính TP HCM) | Same NLĐ article |
| Return cost from northern mountain districts "chiếm tới 15% tổng chi phí vận hành" | One unnamed business | Same NLĐ article |
| "khoảng 15 - 20% tổng số đơn hàng toàn ngành"; "Có sàn ghi nhận con số này lên tới 30% (năm 2021)" | Allied Market Research (original [UNVERIFIED]) | Tuổi Trẻ, 11/06/2025, https://tuoitre.vn/khoc-rong-voi-khach-bom-hang-mua-online-20250611084935056.htm |
| Marketplace failed delivery "4-6%"; livestream "tỷ lệ hoàn hàng lên đến 25-30%" | Nguyễn Mạnh Tấn (Haravan) | VnExpress, 15/11/2023, https://vnexpress.net/san-hang-bom-4676281.html |
| Return fee: "nội tỉnh: Phí trả hàng = 5.000đ/đơn hàng"; "liên tỉnh: Phí trả hàng = 50% phí chuyển đi"; "Cước phí chuyển hoàn đơn BBS = 100% cước phí vận chuyển" | GHTK published tariff (date not shown in the lines I read) | https://ghtk.vn/dich-vu-giao-hang/bang-gia-dich-vu-ghtk |
| "bạn phải trả thêm 100% cước phí ban đầu để nhận lại hàng hoá bưu gửi" | GrabExpress ToS B.2 §1.7 | https://www.grab.com/vn/terms-policies/transport-delivery-logistics |

[INFERENCE] From these published tariffs, the shipping cost of a refused parcel is 1.5–2x the outbound fee, before packaging and handling. That is consistent with the sellers' 2–3x estimate.

## 4. Candidate second policies (not COD-related)

### 4A. Grab VN — "Đặt xe cố định giờ đón" cancellation (rider + driver) — RECOMMENDED
URL: https://www.grab.com/vn/terms-policies/transport-delivery-logistics, section J. The page shows "Ngày hiệu lực: 22/7/2026". About 380 words. Verbatim:

> **2. Chính sách hủy chuyến đối với Người Dùng**
> 2.1 Nếu tại bất kỳ thời điểm nào, thời gian dự kiến đến điểm đón của Đối tác tài xế nhận chuyến muộn hơn thời gian đón cam kết theo lịch trình của bạn, bạn có quyền hủy chuyến xe cố định giờ đón mà không bị áp dụng Phí Hủy Chuyến.
> 2.2 Phí Hủy Chuyến 20.000 đồng sẽ được áp dụng trong các trường hợp sau:
> 1. Sau khi Đối tác tài xế đã nhận chuyến; và
> 2. Thời gian dự kiến đến điểm đón sớm hơn hoặc bằng thời gian đón theo lịch trình cam kết; và
> 3. Người Dùng hủy chuyến xe, cho dù Đối tác tài xế đã đến hay chưa đến điểm đón; hoặc Người Dùng không xuất hiện tại điểm đón trong vòng năm (5) phút kể từ thời gian đón được thông báo.
> 2.3 Bằng cách chọn tham gia Ride Cover – Quyền lợi chuyến xe, Người Dùng sẽ nhận được Phiếu ưu đãi dịch vụ Grab nếu Đối tác tài xế đến muộn hơn mười (10) phút so với thời gian đón theo lịch trình. Phiếu ưu đãi dịch vụ Grab tuân theo các chính sách Ride Cover hiện hành.
> 2.4 Nếu không có Đối tác tài xế nào nhận chuyến xe cố định giờ đón, Người Dùng sẽ nhận được một phiếu ưu đãi dịch vụ Grab. Giá trị phiếu ưu đãi sẽ được thông báo vào từng thời điểm thông qua các phương tiện truyền thông hiện hành theo quyết định riêng của Grab.
> 2.5 Người Dùng cũng phải chịu các khoản phí áp dụng khác theo chính sách hủy chuyến hiện hành được công bố trên trang web của Grab và được thông báo cho Người Dùng vào từng thời điểm.
> **3. Chính sách hủy chuyến đối với Đối tác tài xế**
> 3.1 Chính sách hủy chuyến của Grab áp dụng cho Đối tác tài xế đối với các chuyến xe cố định giờ đón mà họ chấp nhận, bằng cách bấm nút "Chấp nhận cuốc" hoặc thông qua tính năng "Tự động nhận cuốc xe", với điều kiện việc hủy chuyến không phải do lỗi của Người Dùng được xác định theo toàn quyền quyết định riêng của Grab và được cập nhật cho Đối tác tài xế vào từng thời điểm.
> 3.2 Đối tác tài xế sẽ được hai (2) lần hủy chuyến không bị tính phí hoặc theo thông báo của Grab. Grab bảo lưu quyền xác định và điều chỉnh chính sách này bất kỳ lúc nào.
> 3.3 Đối tác tài xế sẽ nhận được một khoản hỗ trợ nếu Người Dùng hủy chuyến xe cố định giờ đón sau khi Đối tác tài xế đã nhận chuyến hoặc sau giờ đón theo lịch trình trong khi Đối tác tài xế đang trên đường đến điểm đón. […]
> 4. Điều khoản chung — Trong trường hợp có sự mâu thuẫn giữa các điều khoản khác trong Điều Khoản Sử Dụng và phần K này, phần K này sẽ được ưu tiên […]

Ambiguities:
1. **Which clock starts the 5-minute no-show window?** §2.2(3) says "thời gian đón được thông báo" (the pickup time that was notified). §2.1/§2.2(2) say "thời gian đón cam kết theo lịch trình" (the committed scheduled pickup time). If the driver arrives early and notifies, does the window start then or at the scheduled time?
2. **What does the trailing "hoặc" cover?** §2.2 joins three conditions with "và … và …" and then adds "hoặc" (no-show). Must a no-show also meet conditions 1–2? If the driver's ETA was later than the commitment, is a no-show still charged?
3. **What does "two free cancellations" mean?** §3.2 doesn't say whether it's per day, per week, or lifetime, and "hoặc theo thông báo của Grab" lets Grab change it. §3.1 leaves who was at fault to "toàn quyền quyết định riêng của Grab" (Grab's sole discretion).

Bonus issues:
- §2.5 adds unspecified "phí khác" on top of the fixed 20.000đ.
- §2.1 "tại bất kỳ thời điểm nào": does a brief ETA spike allow a free cancel?
- Section J's closing clause says "phần K", which is the wrong section letter.

### 4B. Be (beBike/beCar) — driver quality and sanctions rules (driver-facing)
URL: https://be.com.vn/be-rider-blog/bebike-becar-quy-dinh-che-tai-ve-chat-luong-an-toan-gian-lan/ — page dated "Thứ hai, 24/02/2020"; about 330 words. Verbatim (section A):

> **1. Các tiêu chí để đánh giá chất lượng dịch vụ là gì?** Chất lượng dịch vụ được xét theo 3 tiêu chí: - Số sao trung bình hàng tuần - Các phản hồi của Khách hàng - Tỷ lệ nhận chuyến và Tỷ lệ hủy chuyến.
> **2. Tỷ lệ nhận chuyến, tỷ lệ hủy chuyến, tỷ lệ hoàn thành chuyến được tính như thế nào?** […] **(\*) Tổng số chuyến xe được hệ thống phát đến: KHÔNG BAO GỒM** các chuyến xe bị Khách hàng hủy với các lý do sau đây: - Thay đổi lộ trình - Đã đặt chuyến khác - Thời gian chờ quá lâu - Khác (với lý do bất kỳ được Khách hàng nhập vào)
> **3. Chế tài Chất lượng dịch vụ xét theo ngày hay tuần?** Hàng tuần, **Be** sẽ tổng hợp tất cả phản hồi/đánh giá của Khách hàng về tài xế sau mỗi chuyến xe để xét chế tài (nếu có). Nếu chạm ngưỡng chế tài của các tiêu chí trên, sẽ áp dụng chế tài.
> **4. Cơ chế xử lý vi phạm (chế tài) về Chất lượng dịch vụ là gì?** - Vi phạm lần 1: Cảnh báo lần 1 - Vi phạm lần 2: Cảnh báo lần 2 - Vi phạm lần 3: Tạm khóa tài khoản 7 ngày - Vi phạm lần 4: Ngưng hợp tác vĩnh viễn. Trong trường hợp hành vi vi phạm các tiêu chuẩn chất lượng được đánh giá là gây thiệt hại nghiêm trọng về tài sản, hình ảnh hoặc danh tiếng của be, hình thức chế tài sẽ tăng nặng tùy vào mức độ.
> **5. Sau bao lâu thì lịch sử chế tài về Chất lượng dịch vụ của tôi sẽ được xóa bỏ?** Nếu Tài xế không phát sinh vi phạm trong vòng 06 tháng kể từ lần vi phạm cuối cùng, lịch sử chế tài Chất lượng dịch vụ có thể được xóa bỏ (trừ trường hợp tài khoản bị khóa vĩnh viễn). […]
> **6. […]** Tài xế đợi hết thời hạn 07 ngày, hệ thống sẽ tự động bật và Tài xế có thể tiếp tục nhận chuyến xe từ ngày thứ 08 trở đi. Trong thời gian 07 ngày tạm khóa, be sẽ không hỗ trợ mở tài khoản với bất kỳ lý do gì.

The rate formula and the "ngưỡng" (thresholds) are only in images and linked pages, not in the text.

Ambiguities:
1. **Unknown thresholds.** "Chạm ngưỡng chế tài" doesn't say what the threshold is. Rates vary by area ("Mức tỷ lệ theo khu vực") behind a link, so a driver can't work out their own risk from this page.
2. **Who caused the customer's cancellation?** Customer cancellations for "Thời gian chờ quá lâu" (waited too long) are removed from the denominator, even when the driver caused the wait. "Khác (với lý do bất kỳ…)" makes the exclusion effectively unlimited.
3. **How violations are counted and reset.** It doesn't say whether "Vi phạm lần 1–4" counts per criterion or overall, and per week or cumulatively. Wiping the history after 6 months only "có thể" (may) happen. "Tăng nặng tùy vào mức độ" (heavier depending on severity) is undefined.

### 4C. SPayLater overdue / late fee (consumer). Note: same Sea/Shopee group, so less "unrelated"
URL: https://help.shopee.vn/portal/4/article/106519 — "[SPayLater] Hóa đơn SPayLater bị quá hạn là gì?" (no date shown). About 300 words. Verbatim:

> 1. Khi nào Hóa đơn SPayLater sẽ bị quá hạn? Sau Ngày đến hạn nhưng bạn vẫn chưa thanh toán TOÀN BỘ SỐ TIỀN hiển thị trên Hóa đơn SPayLater, hóa đơn của bạn được xem là quá hạn.
> 2. Điều gì xảy ra nếu tôi có Hóa đơn SPayLater quá hạn?
> - Dịch vụ SPayLater sẽ bị đóng băng cho đến khi bạn thực hiện thanh toán TOÀN BỘ SỐ TIỀN cần thanh toán (tùy từng trường hợp)
> - Đồng thời, bạn sẽ bị tính Phí trả chậm là 30,000 VNĐ (\*) cho mỗi kỳ Hóa đơn bị quá hạn. Phí này sẽ được cộng vào Hóa đơn SPayLater của kỳ tiếp theo
> - Nhân viên Ngân hàng Đối tác sẽ liên hệ để thông báo cho bạn (hoặc người được bạn chỉ định có thể liên lạc trong trường hợp khẩn cấp) về hóa đơn SPayLater cần thanh toán […]
> - Ngân hàng đối tác sẽ thực hiện việc báo cáo theo quy định cho Trung tâm thông tin tín dụng Quốc gia Việt Nam (CIC) theo đúng quy trình và chu kỳ của ngân hàng.
> (\*) Phí trả chậm SPayLater 30.000 VNĐ/kỳ (mức cố định): là phí sẽ phát sinh nếu bạn chậm hoặc không thanh toán đúng hạn. Phí trả chậm sẽ phát sinh trên tài khoản SPayLater 01 ngày sau ngày đến hạn thanh toán và sẽ được cộng vào hóa đơn của kỳ thanh toán tiếp theo.
> (Ví dụ: Hóa đơn SPayLater tháng 4 được phát hành vào ngày 24/04/2024 với ngày đến hạn thanh toán là 10/05/2024. Nếu bạn thanh toán trễ hơn ngày 10/05/2024, Phí trả chậm 30.000 VNĐ sẽ được ghi nhận vào Hóa đơn SPayLater tháng 5 được phát hành vào ngày 24/05/2024)
> 4. […] Khi bạn có hóa đơn SPayLater quá hạn, ngân hàng đối tác sẽ khi nhận vào lịch sử tín dụng và cập nhật lên hệ thống Trung Tâm Thông Tin Tín Dụng Quốc Gia (CIC). Điều này sẽ ảnh hưởng đến điểm tín dụng của bạn

Ambiguities:
1. **Does the fee repeat?** "30,000 VNĐ cho mỗi kỳ Hóa đơn bị quá hạn": if one bill stays unpaid for 3 cycles, is the fee charged once or every cycle? And is the 30k added to next month's bill itself "overdue" if unpaid?
2. **When is a payment late?** "01 ngày sau ngày đến hạn" vs "thanh toán trễ hơn ngày 10/05/2024": does a 23:59 payment on the due date that settles the next day count as late? (A linked FAQ, article 89672, advises paying 2 days early for NAPAS transfers.)
3. **Partial payment and credit reporting.** "TOÀN BỘ SỐ TIỀN … (tùy từng trường hợp)" (full amount, "case by case"): does a partial payment unfreeze anything? Is a 1-day delay reported to CIC, given §2 says "theo chu kỳ của ngân hàng" (per the bank's cycle) but §4 implies any overdue bill is recorded?

Other options I found but didn't pick:
- **Xanh SM service agreement §3.2.8** (https://www.greensm.com/vn-vi/terms-policies/service-agreement): cancellation fee "nếu có áp dụng" (if applicable), with no amount.
- **Grab ToS A.7** (driver "lý do hủy có thể chấp nhận", acceptable cancellation reasons): too short and vague to use on its own.
