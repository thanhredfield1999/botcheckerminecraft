# Plan gate POSIX cho direct-entrypoint shutdown

## Hiện trạng và khoảng trống

- Harness `test/direct-entrypoint-shutdown.integration.test.ts` đã kiểm tra direct Node entrypoint với `SIGINT` và `SIGTERM`, readiness loopback, exit sạch, listener đóng, PID biến mất, timeout hữu hạn và cleanup child do test sở hữu.
- Trên Windows hai case cố ý skip vì signal của child không đi qua Node handler; local Windows không thể là bằng chứng runtime POSIX.
- Repository chưa có `.github/workflows`, nên chưa có môi trường POSIX nào thực thi hai case không-skip. Đây là khoảng trống được nêu tại `CURRENT_STATE.md`.

## Gate và phạm vi nhỏ nhất

1. Thêm một GitHub Actions workflow chạy trên `ubuntu-latest`, chỉ với quyền đọc nội dung.
2. Trigger trên `push` và `pull_request`; không dùng secret, environment, service, Minecraft hay server bên ngoài.
3. Dùng Node.js 22 theo baseline, `npm ci`, rồi chạy đúng thứ tự project gate: `npm run typecheck`, focused direct-entrypoint shutdown harness, `npm test`, `npm run build`.
4. Đặt timeout hữu hạn ở job; giữ nguyên skip/fail-closed semantics trong harness và không sửa logic sản phẩm.
5. Không upload log/report artifact vì gate không cần và để giảm rủi ro dữ liệu.

## Verification trước khi chốt

- Focused local Windows: harness phải pass unit và skip rõ hai case POSIX; đây chỉ là validation cấu hình/harness cục bộ, không phải POSIX runtime evidence.
- Kiểm tra cú pháp/cấu trúc workflow bằng parser hoặc công cụ sẵn có; kiểm tra trigger, Node 22, timeout, permissions và command order.
- Full local gate theo `AGENTS.md`: typecheck -> test -> build.
- Vì repo chưa có commit và toàn bộ file untracked, dùng kiểm tra whitespace bao phủ cả untracked files thay vì dựa riêng vào `git diff --check`.
- Chỉ cập nhật `CURRENT_STATE.md` với output thực tế; trạng thái POSIX vẫn là “chờ workflow chạy” cho đến khi có GitHub Actions run trên Ubuntu.

## Gate quyết định

Contract đủ rõ và không cần secret/permission sản phẩm: workflow chỉ đọc source, cài dependency khóa bằng `npm ci`, chạy offline test/build và không kết nối Minecraft. Vì vậy có thể triển khai gate nhỏ nhất mà không cần hỏi thêm anh Thành.
