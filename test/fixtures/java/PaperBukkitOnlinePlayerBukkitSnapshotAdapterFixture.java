import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerBukkitSnapshotAdapter;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerBukkitSnapshotAdapterFixture {
  private PaperBukkitOnlinePlayerBukkitSnapshotAdapterFixture() {
  }

  public static void main(String[] args) throws Exception {
    Plugin plugin = new Plugin() {
    };
    AtomicInteger schedules = new AtomicInteger();
    AtomicInteger cancellations = new AtomicInteger();
    AtomicBoolean cancelled = new AtomicBoolean();
    CountDownLatch scheduled = new CountDownLatch(1);
    AtomicReference<Runnable> queuedTask = new AtomicReference<>();
    AtomicReference<Plugin> scheduledPlugin = new AtomicReference<>();
    BukkitScheduler scheduler = (owner, task) -> {
      schedules.incrementAndGet();
      scheduledPlugin.set(owner);
      queuedTask.set(task);
      scheduled.countDown();
      return new BukkitTask() {
        @Override
        public void cancel() {
          cancelled.set(true);
          cancellations.incrementAndGet();
        }
      };
    };
    Player player = new Player() {
    };
    Bukkit.configure(scheduler, List.of(player, player, player));
    var challenge = new PaperBukkitOnlinePlayerTransportCodec.Challenge(
        "audience", "verifier", 1L, "challenge", "nonce", "run", "0".repeat(64),
        "binding", "1".repeat(64), "provider", "1.0.0", "instance", "trust",
        "2026.09.01-1", "2".repeat(64), 1L, 10_000L);
    long before = System.currentTimeMillis();
    try (var adapter = new PaperBukkitOnlinePlayerBukkitSnapshotAdapter(plugin, 2_000L)) {
      AtomicReference<PaperBukkitOnlinePlayerRequestProcessor.Snapshot> snapshot =
          new AtomicReference<>();
      AtomicReference<Throwable> failure = new AtomicReference<>();
      Thread worker = Thread.ofPlatform().name("fake-adapter-worker").start(() -> {
        try {
          snapshot.set(adapter.snapshot(challenge));
        } catch (Throwable error) {
          failure.set(error);
        }
      });
      if (!scheduled.await(5, TimeUnit.SECONDS)) throw new AssertionError("task was not queued");
      if (Bukkit.onlinePlayerReads() != 0) throw new AssertionError("task ran before explicit tick");
      Bukkit.enterPrimaryThread();
      try {
        if (!cancelled.get()) queuedTask.get().run();
      } finally {
        Bukkit.leavePrimaryThread();
      }
      worker.join(5_000L);
      if (worker.isAlive()) throw new AssertionError("worker did not stop");
      if (failure.get() != null) throw new AssertionError("snapshot failed", failure.get());
      long after = System.currentTimeMillis();
      if (snapshot.get().observedAtMs() < before || snapshot.get().observedAtMs() > after) {
        throw new AssertionError("observation time outside fixture window");
      }
      System.out.print(snapshot.get().onlinePlayers() + " " + Bukkit.onlinePlayerReads() + " "
          + Bukkit.readWasPrimary() + " " + schedules.get() + " " + cancellations.get() + " "
          + (scheduledPlugin.get() == plugin));
    }
  }
}
