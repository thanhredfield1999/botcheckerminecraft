import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerMainThreadSnapshotBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerMainThreadSnapshotBridgeFixture {
  private PaperBukkitOnlinePlayerMainThreadSnapshotBridgeFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("expected request and output paths");
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(
        Files.readAllBytes(Path.of(args[0])));
    AtomicInteger reads = new AtomicInteger();
    AtomicReference<String> readThread = new AtomicReference<>("missing");
    var scheduler = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge.MainThreadScheduler() {
      @Override
      public PaperBukkitOnlinePlayerMainThreadSnapshotBridge.ScheduledTask schedule(Runnable task) {
        Thread thread = Thread.ofPlatform().name("fake-paper-primary").start(task);
        return () -> thread.interrupt();
      }

      @Override
      public boolean isPrimaryThread() {
        return Thread.currentThread().getName().equals("fake-paper-primary");
      }
    };
    try (var bridge = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
        scheduler,
        () -> {
          if (!scheduler.isPrimaryThread()) throw new IllegalStateException("not primary");
          reads.incrementAndGet();
          readThread.set(Thread.currentThread().getName());
          return 3;
        },
        () -> 10_010L,
        2_000L)) {
      var snapshot = bridge.snapshot(challenge);
      Files.writeString(Path.of(args[1]),
          snapshot.onlinePlayers() + " " + snapshot.observedAtMs() + " "
              + reads.get() + " " + readThread.get());
    }
  }
}
