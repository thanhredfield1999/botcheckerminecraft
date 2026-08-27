# Route Pixel Map

`src/route-pixel-map.ts` tạo HTML/SVG từ trajectory thật của BotChecker.

Mỗi ô biểu diễn một block trên mặt phẳng X/Z:

- A, B, C: checkpoint.
- Nâu: fence.
- Cam: gate mở.
- Xám: gate đóng.
- Xanh lá: đoạn A→B.
- Tím: đoạn sau B→C.
- Xanh nhạt: sample trajectory.

Mỗi sample runtime mang `segmentIndex` từ `RouteOracle`. Renderer dùng segment này để tô màu; không suy đoán bằng tọa độ X+Z. Vì vậy route vòng, route chữ L ngược hoặc route đổi trục vẫn hiển thị đúng leg.
- Đỏ: shortcut, backtrack, discontinuity, identity hoặc pairing issue.

`backtrack` được latch khi NPC quay lại vùng checkpoint đã hoàn tất trước đó. Một route đã đi tới C rồi quay về B không được pass lại.

`gate-order-violation` được latch khi NPC crossing gate của checkpoint sau trước checkpoint hiện tại. Nhiều gate phải qua theo thứ tự checkpoint; map vẽ đoạn vi phạm màu đỏ.

## Input contract

```ts
{
  checkpoints: [
    { id: 'A', position: { x, y, z }, radius },
    { id: 'B', position: { x, y, z }, radius },
    { id: 'C', position: { x, y, z }, radius }
  ],
  fences: [{ x, y, z }],
  gates: [{ id, block: { x, y, z }, open }],
  samples: [{ position: { x, y, z }, elapsedMs, checkpoint?, issue? }],
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
}
```

`route-pixel-map.ts` không tự tạo dữ liệu NPC. Runner phải đưa vào samples quan sát từ entity UUID đã pin. Không dùng LivingNPC phase để tạo path.

## Đọc map

- A→C thẳng đi qua vùng fence: fixture có thể hợp lệ.
- Path A→C không qua B: đánh dấu `shortcut`, verdict `FAIL`.
- Có khoảng nhảy lớn giữa 2 sample: đánh dấu `discontinuity`, verdict runtime inconclusive/fail theo policy.
- Sample quay ngược sau B: đánh dấu `backtrack`.
- Gate có màu cam nhưng không có đoạn trajectory đi qua block gate: chưa có crossing evidence.
- Map không hiển thị gate/fence đúng tọa độ: `INCONCLUSIVE_FIXTURE`, không quy lỗi NPC.

## Quy tắc evidence

Pixel map là lớp debug trực quan. Route oracle geometry vẫn là verdict chính.

Không được gọi map minh họa là runtime evidence khi samples không đến từ:

1. BotChecker đã login thành công.
2. Entity UUID đã pin.
3. World/dimension đã pair.
4. Block/chunk state đã kiểm.
5. Trajectory sample có timestamp monotonic.

## Runtime integration

`observe_route` đã nối renderer sau khi observation kết thúc. Nếu step có trajectory, report directory nhận thêm:

- `<run-id>-<step-id>-route-map.json`.
- `<run-id>-<step-id>-route-map.html`.

JSON giữ checkpoint/fence/gate/samples/verdict. HTML tự chứa, mở trực tiếp bằng browser.

Gate map đánh dấu `open=true` nếu gate từng được quan sát mở trong window; đây là evidence state, không tự chứng minh crossing. Crossing vẫn cần signed-plane + exit dwell từ `RouteOracle`.

Nếu timeout, identity mất, pairing sai hoặc fixture sai, map vẫn được ghi với verdict `INCONCLUSIVE` và samples đã thu thập trước lỗi.

Input map dùng sample timestamp tương đối từ lúc bắt đầu route. Tối đa 512 observation cuối được giữ để giới hạn report.

Paper route fixture thật vẫn `NOT VERIFIED`.

Production unchanged.

## Runtime integration còn thiếu

Còn thiếu fixture Paper thật và scenario A→B→C để tạo artifact map từ movement NPC thật. Không dùng map từ unit fixture làm runtime evidence.
