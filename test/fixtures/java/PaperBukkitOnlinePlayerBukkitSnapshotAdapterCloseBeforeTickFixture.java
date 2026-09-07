import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerBukkitSnapshotAdapter;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerBukkitSnapshotAdapterCloseBeforeTickFixture {
  private PaperBukkitOnlinePlayerBukkitSnapshotAdapterCloseBeforeTickFixture() {
  }

  public static void main(String[] args) throws Exception {
    Plugin plugin = new Plugin() {
    };
    CountDownLatch scheduled = new CountDownLatch(1);
    AtomicReference<Runnable> queuedTask = new AtomicReference<>();
    AtomicInteger cancellations = new AtomicInteger();
    BukkitScheduler scheduler = (owner, task) -> {
      queuedTask.set(task);
      scheduled.countDown();
      return new BukkitTask() {
        @Override
        public void cancel() {
          cancellations.incrementAndGet();
        }
      };
    };
    Player player = new Player() {
    };
    Bukkit.configure(scheduler, List.of(player));
    var challenge = new PaperBukkitOnlinePlayerTransportCodec.Challenge(
        "audience", "verifier", 1L, "challenge", "nonce", "run", "0".repeat(64),
        "binding", "1".repeat(64), "provider", "1.0.0", "instance", "trust",
        "2026.09.01-1", "2".repeat(64), 1L, 10_000L);
    var adapter = new PaperBukkitOnlinePlayerBukkitSnapshotAdapter(plugin, 2_000L);
    AtomicReference<String> outcome = new AtomicReference<>("RETURNED");
    Thread worker = Thread.ofPlatform().name("fake-adapter-worker").start(() -> {
      try {
        adapter.snapshot(challenge);
      } catch (IllegalStateException error) {
        outcome.set(error.getMessage());
      }
    });
    if (!scheduled.await(5, TimeUnit.SECONDS)) throw new AssertionError("task was not queued");
    adapter.close();
    worker.join(5_000L);
    if (worker.isAlive()) throw new AssertionError("worker did not stop");
    Bukkit.enterPrimaryThread();
    try {
      queuedTask.get().run();
    } finally {
      Bukkit.leavePrimaryThread();
    }
    System.out.print(outcome.get() + " " + cancellations.get() + " "
        + Bukkit.onlinePlayerReads());
  }
}
