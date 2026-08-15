# Threat model kiểm thử tải Minecraft/Paper

Ngày nghiên cứu: 2026-08-15

Tài liệu này phân biệt nghiên cứu nguy cơ với việc tạo tải. Redstone bị cấm trong execution; không scenario nào được phép đặt, kích hoạt hoặc phá redstone. Không dùng packet-spam, creative item injection, `/give`, `/summon`, `/fill`, `/tp`, force-load chunk hoặc thao tác không có fixture được phê duyệt.

## Nguồn chính

- Paper Profiling: https://docs.papermc.io/paper/profiling
  - Paper 1.21 tích hợp spark; dùng profiler có timeout hữu hạn. MSPT, GC và method hot spots phải được xem cùng nhau, không kết luận từ TPS đơn độc.
- Paper World configuration: https://docs.papermc.io/paper/reference/world-configuration
  - `container-update` ảnh hưởng tần suất cập nhật container/inventory; giá trị không phù hợp có thể tạo desync/visual lag.
  - `max-entity-collisions`, activation range, entity-per-chunk save limit và item merge/activation settings ảnh hưởng chi phí entity.
- Paper API `InventoryClickEvent`: https://jd.papermc.io/paper/1.21.11/org/bukkit/event/inventory/InventoryClickEvent.html
  - Mỗi click đi qua inventory transaction/event; thay đổi view trong handler có ràng buộc và có thể tạo inconsistency nếu làm sai.
- Paper API `PrepareItemCraftEvent` và `CraftItemEvent`:
  - https://jd.papermc.io/paper/1.21.11/org/bukkit/event/inventory/PrepareItemCraftEvent.html
  - https://jd.papermc.io/paper/1.21.11/org/bukkit/event/inventory/CraftItemEvent.html
  - Crafting có bước prepare recipe và event hoàn tất; plugin listener có thể khuếch đại CPU nếu thực hiện I/O, scan inventory hoặc tạo item mới mỗi event.
- Paper API `BlockRedstoneEvent` và event catalogue:
  - https://jd.papermc.io/paper/1.21.11/org/bukkit/event/block/BlockEvent.html
  - Redstone activity có thể dẫn tới block/neighbor updates; plugin listener cũng là một nguồn chi phí riêng.
- Java Edition protocol packets: https://minecraft.wiki/w/Java_Edition_protocol/Packets
  - Container click và các packet container content/slot tạo tải network/serialization; đây là cơ sở threat model, không phải quyền gửi packet tùy ý.

## Các nhóm nguy cơ

### 1. GUI/container

Mở/đóng GUI có thể tạo `Open Screen`, inventory content/slot updates và event handler. Click nhanh có thể làm tăng serverbound container-click, xác nhận transaction, recipe/slot recomputation và plugin callbacks. GUI nhiều item, lore/component hoặc head/profile có thể tăng serialize, packet size và client render; GUI có handler nặng có thể làm tăng MSPT.

Đo riêng:

- server: MSPT/TPS, spark sample, GC pause, log lỗi và plugin event hot spot;
- network: số event/packet nếu server có telemetry hợp lệ;
- client: thời gian mở GUI, frame-time và disconnect/desync;
- correctness: slot state, cursor item, GUI id, đóng sạch.

Không được coi việc giữ GUI mở lâu là spam. Test hợp lệ phải có số lần mở/click cụ thể, cooldown, timeout và stop condition.

### 2. Item/entity/NBT/component

Item entity gây tải theo số entity đang tick, collision/pickup/merge, chunk giữ hoạt động và serialize. Nhiều item nhỏ không đồng nhất với một stack; NBT/component lớn có thể tăng kích thước packet, parse/serialize và client render. Written book/custom component từng liên quan tới lỗi decode trong client nên payload bất thường không được đưa vào server production.

Đo:

- bounded entity snapshot trong bán kính 48, tối đa 64 entity;
- entity type/count theo sample, chunk và log runtime nếu server operator cung cấp;
- không spawn item để benchmark trên server hiện tại;
- item payload chỉ dùng fixture kích thước nhỏ, hợp lệ, trên server cô lập có phê duyệt.

Cleanup phải xác nhận không còn entity/test item và không để chunk bị force-load.

### 3. Crafting cục sắt liên tiếp trong inventory

Đây là workload inventory/crafting, không phải item-entity workload. Mỗi chu kỳ có thể liên quan đến container click, cập nhật crafting matrix, `PrepareItemCraftEvent`, `CraftItemEvent`, slot updates và listener plugin. Nếu click quá nhanh, có thể tạo transaction reject/desync hoặc dồn event; nếu craft rồi drop thành item entity thì đó là workload thứ hai và phải đo riêng.

Benchmark hợp lệ trên server cô lập:

1. baseline đứng yên với inventory đóng;
2. mở crafting/inventory được fixture xác định;
3. craft một số lượng nhỏ, rate cố định, không quá 1 hành động mỗi khoảng thời gian đã chọn;
4. ghi số craft thành công, số transaction reject, inventory trước/sau, MSPT/GC/packet telemetry;
5. đóng GUI, trả item về trạng thái ban đầu và xác nhận cleanup.

Không dùng vòng lặp không giới hạn, không gửi raw packet, không dùng creative để tạo nguyên liệu và không chạy trên production.

### 4. Redstone (chỉ nghiên cứu/detection)

Các nguồn rủi ro cần theo dõi offline/static hoặc từ telemetry server: clock tần suất cao, mạng dây dài, piston/observer, hopper/crafter liên kết, block updates lan rộng, chunk boundary và plugin listener `BlockRedstoneEvent`/`BlockPhysicsEvent`. Hopper/crafter còn giao với container/inventory workload.

Do redstone bị cấm: chỉ kiểm tra cấu hình, log, profiler và detector; không đặt block, không kích hoạt signal, không tạo clock, không thay đổi world.

## Protocol kiểm thử một tester

Mỗi scenario tải phải có:

1. precondition: server/account/fixture được ủy quyền, GUI đóng, health/food hợp lệ, vị trí xác định;
2. baseline tối thiểu 5 giây hoặc theo fixture, không mutation;
3. một biến tải duy nhất cho mỗi run (GUI hoặc crafting hoặc item, không trộn);
4. rate, volume, payload size và duration hữu hạn;
5. telemetry trước/trong/sau: MSPT/TPS, spark hoặc profiler được operator bật, GC, log, packet counter nếu có;
6. stop condition: disconnect, timeout, MSPT vượt ngưỡng đã phê duyệt, queue pressure, memory/GC bất thường hoặc desync;
7. cleanup và hậu kiểm inventory/world/entity;
8. report phải ghi verdict `PASS`, `FAIL` hoặc `INCONCLUSIVE`, không suy đoán root cause khi thiếu profiler.

BotChecker hiện có action `observe_load`: chỉ lấy snapshot thụ động trong tối đa 30 giây, bán kính tối đa 48, tối đa 64 entity và 46 inventory item; action trả `mutation: none`. Action này không mở GUI, không click, không craft, không drop, không place và không gửi chat.

## Kết luận hiện tại

Đã đủ cơ sở để đo baseline và quan sát hậu quả của một fixture được ủy quyền. Chưa có cơ sở để chạy active load trên Paper hiện tại, vì chưa có fixture/action được phê duyệt cho GUI/crafting/item và redstone bị cấm. Không kết luận “server lag” chỉ từ run journey `ThanhRedfield`; run đó dừng ở locator timeout trước mọi tương tác.

## Evidence liên quan

- `reports/82c3c582-a150-40d2-b41c-fd0b59970d3e.json`: precondition và snapshot pass; locator `ThanhRedfield` timeout; không có click/craft/item/redstone.
- Full verification sau action quan sát: typecheck pass, 74 tests gồm 72 pass và 2 skip Windows signal có chủ đích, build pass.
- Paper server hiện tại không bị deploy/reload/restart hay thay đổi world trong nghiên cứu này.

## Quy tắc phê duyệt tiếp theo

Chỉ chạy active benchmark khi người dùng phê duyệt rõ server, account, fixture, thời lượng, rate, ngưỡng dừng và cleanup. Redstone vẫn chỉ được research/detect, không execution.

## Không gian kiểm tra redstone offline an toàn

```text
1. Static config/log scan: tìm các event/plugin/config redstone, hopper, crafter; không kết luận có lag nếu không có runtime evidence.
2. Profiler review: tìm BlockRedstoneEvent/BlockPhysicsEvent, hopper/crafter và chunk ticking trong report đã có.
3. Fixture review: từ chối scenario có place/break redstone hoặc action không whitelist.
4. Runtime detector: chỉ đọc counters/log do server cung cấp; không tạo tín hiệu.
```

Các bước trên không thay thế profiler hoặc benchmark được ủy quyền.
