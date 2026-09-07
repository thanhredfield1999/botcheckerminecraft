import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerMainThreadSnapshotBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerMainThreadSnapshotBridgeSynchronousFixture {
  private PaperBukkitOnlinePlayerMainThreadSnapshotBridgeSynchronousFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("expected request and output paths");
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(
        Files.readAllBytes(Path.of(args[0])));
    AtomicBoolean primary = new AtomicBoolean();
    AtomicInteger cancellations = new AtomicInteger();
    AtomicInteger reads = new AtomicInteger();
    var scheduler = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge.MainThreadScheduler() {
      @Override
      public PaperBukkitOnlinePlayerMainThreadSnapshotBridge.ScheduledTask schedule(Runnable task) {
        primary.set(true);
        try {
          task.run();
        } finally {
          primary.set(false);
        }
        return cancellations::incrementAndGet;
      }

      @Override
      public boolean isPrimaryThread() {
        return primary.get();
      }
    };
    try (var bridge = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
        scheduler, reads::incrementAndGet, () -> 10_010L, 2_000L)) {
      var snapshot = bridge.snapshot(challenge);
      Files.writeString(Path.of(args[1]),
          snapshot.onlinePlayers() + " " + snapshot.observedAtMs() + " "
              + cancellations.get() + " " + reads.get());
    }
  }
}
