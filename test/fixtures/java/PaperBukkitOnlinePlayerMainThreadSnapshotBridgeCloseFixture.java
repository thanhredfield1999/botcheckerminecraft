import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerMainThreadSnapshotBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseFixture {
  private PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("expected request and output paths");
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(
        Files.readAllBytes(Path.of(args[0])));
    AtomicInteger schedules = new AtomicInteger();
    AtomicInteger cancellations = new AtomicInteger();
    AtomicInteger reads = new AtomicInteger();
    AtomicReference<String> outcome = new AtomicReference<>("missing");
    var scheduler = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge.MainThreadScheduler() {
      @Override
      public PaperBukkitOnlinePlayerMainThreadSnapshotBridge.ScheduledTask schedule(Runnable task) {
        schedules.incrementAndGet();
        return cancellations::incrementAndGet;
      }

      @Override
      public boolean isPrimaryThread() {
        return false;
      }
    };
    var bridge = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
        scheduler, reads::incrementAndGet, () -> 10_010L, 5_000L);
    Thread worker = Thread.ofPlatform().name("snapshot-worker").start(() -> {
      try {
        bridge.snapshot(challenge);
        outcome.set("accepted");
      } catch (IllegalStateException error) {
        outcome.set(error.getMessage());
      }
    });
    long waitDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (schedules.get() != 1 || worker.getState() != Thread.State.TIMED_WAITING) {
      if (System.nanoTime() >= waitDeadline) throw new IllegalStateException("worker did not start waiting");
      Thread.onSpinWait();
    }
    long closeStarted = System.nanoTime();
    bridge.close();
    long closeElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - closeStarted);
    worker.join(5_000L);
    if (worker.isAlive()) throw new IllegalStateException("worker did not stop");
    Files.writeString(Path.of(args[1]),
        outcome.get() + " " + cancellations.get() + " " + reads.get() + " " + closeElapsedMs);
  }
}
