import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerMainThreadSnapshotBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerMainThreadSnapshotBridgeTimeoutFixture {
  private PaperBukkitOnlinePlayerMainThreadSnapshotBridgeTimeoutFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("expected request and output paths");
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(
        Files.readAllBytes(Path.of(args[0])));
    AtomicReference<Runnable> queued = new AtomicReference<>();
    AtomicInteger cancellations = new AtomicInteger();
    AtomicInteger reads = new AtomicInteger();
    var scheduler = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge.MainThreadScheduler() {
      @Override
      public PaperBukkitOnlinePlayerMainThreadSnapshotBridge.ScheduledTask schedule(Runnable task) {
        if (!queued.compareAndSet(null, task)) throw new IllegalStateException("already queued");
        return cancellations::incrementAndGet;
      }

      @Override
      public boolean isPrimaryThread() {
        return Thread.currentThread().getName().equals("fake-paper-primary-late");
      }
    };
    try (var bridge = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
        scheduler, reads::incrementAndGet, () -> 10_010L, 50L)) {
      String outcome;
      long started = System.nanoTime();
      try {
        bridge.snapshot(challenge);
        outcome = "accepted";
      } catch (IllegalStateException error) {
        outcome = error.getMessage();
      }
      long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
      Thread late = Thread.ofPlatform().name("fake-paper-primary-late").start(queued.get());
      late.join(5_000L);
      if (late.isAlive()) throw new IllegalStateException("late task did not stop");
      Files.writeString(Path.of(args[1]),
          outcome + " " + cancellations.get() + " " + reads.get() + " " + elapsedMs);
    }
  }
}
