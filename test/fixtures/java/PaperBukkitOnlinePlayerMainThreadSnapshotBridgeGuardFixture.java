import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerMainThreadSnapshotBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerMainThreadSnapshotBridgeGuardFixture {
  private PaperBukkitOnlinePlayerMainThreadSnapshotBridgeGuardFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 3) throw new IllegalArgumentException("expected mode, request and output paths");
    String mode = args[0];
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(
        Files.readAllBytes(Path.of(args[1])));
    AtomicBoolean primary = new AtomicBoolean("primary-caller".equals(mode));
    AtomicInteger schedules = new AtomicInteger();
    AtomicInteger cancellations = new AtomicInteger();
    AtomicInteger reads = new AtomicInteger();
    AtomicInteger clockReads = new AtomicInteger();
    var scheduler = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge.MainThreadScheduler() {
      @Override
      public PaperBukkitOnlinePlayerMainThreadSnapshotBridge.ScheduledTask schedule(Runnable task) {
        schedules.incrementAndGet();
        Thread thread = Thread.ofPlatform().name("fake-paper-primary-guard").start(() -> {
          primary.set(true);
          try {
            task.run();
          } finally {
            primary.set(false);
          }
        });
        return () -> {
          cancellations.incrementAndGet();
          thread.interrupt();
        };
      }

      @Override
      public boolean isPrimaryThread() {
        return primary.get();
      }
    };
    try (var bridge = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
        scheduler,
        () -> {
          reads.incrementAndGet();
          if ("capture-failure".equals(mode)) {
            throw new IllegalStateException("operator-private-value");
          }
          return 2;
        },
        () -> {
          clockReads.incrementAndGet();
          return 10_010L;
        },
        2_000L)) {
      String outcome;
      try {
        bridge.snapshot(challenge);
        outcome = "accepted";
      } catch (IllegalStateException error) {
        outcome = error.getMessage();
      }
      Files.writeString(Path.of(args[2]),
          outcome + " " + schedules.get() + " " + cancellations.get() + " "
              + reads.get() + " " + clockReads.get());
    }
  }
}
