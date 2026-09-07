import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerMainThreadSnapshotBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseDuringCaptureFixture {
  private PaperBukkitOnlinePlayerMainThreadSnapshotBridgeCloseDuringCaptureFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("expected request and output paths");
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(
        Files.readAllBytes(Path.of(args[0])));
    CountDownLatch readerEntered = new CountDownLatch(1);
    CountDownLatch releaseReader = new CountDownLatch(1);
    AtomicBoolean scheduleReturned = new AtomicBoolean();
    AtomicInteger cancellations = new AtomicInteger();
    AtomicInteger reads = new AtomicInteger();
    AtomicInteger clockReads = new AtomicInteger();
    AtomicReference<String> outcome = new AtomicReference<>("missing");
    AtomicReference<Thread> primaryThread = new AtomicReference<>();
    var scheduler = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge.MainThreadScheduler() {
      @Override
      public PaperBukkitOnlinePlayerMainThreadSnapshotBridge.ScheduledTask schedule(Runnable task) {
        Thread thread = Thread.ofPlatform().name("fake-paper-primary-close-race").start(() -> {
          while (!scheduleReturned.get()) Thread.onSpinWait();
          task.run();
        });
        primaryThread.set(thread);
        scheduleReturned.set(true);
        return cancellations::incrementAndGet;
      }

      @Override
      public boolean isPrimaryThread() {
        return Thread.currentThread().getName().equals("fake-paper-primary-close-race");
      }
    };
    var bridge = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
        scheduler,
        () -> {
          reads.incrementAndGet();
          readerEntered.countDown();
          try {
            if (!releaseReader.await(5, TimeUnit.SECONDS)) {
              throw new IllegalStateException("reader release timed out");
            }
          } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("reader interrupted");
          }
          return 4;
        },
        () -> {
          clockReads.incrementAndGet();
          return 10_010L;
        },
        5_000L);
    Thread worker = Thread.ofPlatform().name("snapshot-worker-close-race").start(() -> {
      try {
        bridge.snapshot(challenge);
        outcome.set("accepted");
      } catch (IllegalStateException error) {
        outcome.set(error.getMessage());
      }
    });
    if (!readerEntered.await(5, TimeUnit.SECONDS)) {
      throw new IllegalStateException("reader was not entered");
    }
    long waitDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
    while (worker.getState() != Thread.State.TIMED_WAITING) {
      if (System.nanoTime() >= waitDeadline) throw new IllegalStateException("worker did not wait");
      Thread.onSpinWait();
    }
    long closeStarted = System.nanoTime();
    bridge.close();
    long closeElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - closeStarted);
    worker.join(5_000L);
    if (worker.isAlive()) throw new IllegalStateException("worker did not stop");
    releaseReader.countDown();
    Thread primary = primaryThread.get();
    primary.join(5_000L);
    if (primary.isAlive()) throw new IllegalStateException("primary task did not stop");
    Files.writeString(Path.of(args[1]),
        outcome.get() + " " + cancellations.get() + " " + reads.get() + " "
            + clockReads.get() + " " + closeElapsedMs);
  }
}
