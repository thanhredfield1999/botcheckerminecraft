import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerMainThreadSnapshotBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseAfterCaptureFixture {
  private PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseAfterCaptureFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("expected request and output paths");
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(
        Files.readAllBytes(Path.of(args[0])));
    CountDownLatch captureCompleted = new CountDownLatch(1);
    CountDownLatch releaseScheduleReturn = new CountDownLatch(1);
    AtomicBoolean primary = new AtomicBoolean();
    AtomicInteger cancellations = new AtomicInteger();
    AtomicInteger reads = new AtomicInteger();
    AtomicInteger clockReads = new AtomicInteger();
    AtomicReference<String> outcome = new AtomicReference<>("missing");
    var scheduler = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge.MainThreadScheduler() {
      @Override
      public PaperBukkitOnlinePlayerMainThreadSnapshotBridge.ScheduledTask schedule(Runnable task) {
        Thread thread = Thread.ofPlatform().name("fake-paper-primary-close-after-capture").start(() -> {
          primary.set(true);
          try {
            task.run();
          } finally {
            primary.set(false);
            captureCompleted.countDown();
          }
        });
        try {
          if (!captureCompleted.await(5, TimeUnit.SECONDS)) {
            throw new IllegalStateException("capture did not complete");
          }
          if (!releaseScheduleReturn.await(5, TimeUnit.SECONDS)) {
            throw new IllegalStateException("schedule return was not released");
          }
          thread.join(5_000L);
          if (thread.isAlive()) throw new IllegalStateException("primary task did not stop");
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          throw new IllegalStateException("schedule interrupted");
        }
        return cancellations::incrementAndGet;
      }

      @Override
      public boolean isPrimaryThread() {
        return primary.get();
      }
    };
    var bridge = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
        scheduler,
        () -> {
          reads.incrementAndGet();
          return 5;
        },
        () -> {
          clockReads.incrementAndGet();
          return 10_010L;
        },
        5_000L);
    Thread worker = Thread.ofPlatform().name("snapshot-worker-close-after-capture").start(() -> {
      try {
        bridge.snapshot(challenge);
        outcome.set("accepted");
      } catch (IllegalStateException error) {
        outcome.set(error.getMessage());
      }
    });
    if (!captureCompleted.await(5, TimeUnit.SECONDS)) {
      throw new IllegalStateException("capture did not complete");
    }
    long closeStarted = System.nanoTime();
    bridge.close();
    long closeElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - closeStarted);
    releaseScheduleReturn.countDown();
    worker.join(5_000L);
    if (worker.isAlive()) throw new IllegalStateException("worker did not stop");
    Files.writeString(Path.of(args[1]),
        outcome.get() + " " + cancellations.get() + " " + reads.get() + " "
            + clockReads.get() + " " + closeElapsedMs);
  }
}
