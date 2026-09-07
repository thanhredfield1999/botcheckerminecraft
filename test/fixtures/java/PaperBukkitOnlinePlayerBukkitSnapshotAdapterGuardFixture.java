import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerBukkitSnapshotAdapter;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerBukkitSnapshotAdapterGuardFixture {
  private PaperBukkitOnlinePlayerBukkitSnapshotAdapterGuardFixture() {
  }

  public static void main(String[] args) {
    if (args.length != 1) throw new IllegalArgumentException("expected mode");
    String mode = args[0];
    Plugin plugin = new Plugin() {
    };
    AtomicInteger schedules = new AtomicInteger();
    AtomicInteger cancellations = new AtomicInteger();
    AtomicReference<Runnable> queued = new AtomicReference<>();
    BukkitScheduler scheduler = (owner, task) -> {
      schedules.incrementAndGet();
      queued.set(task);
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
    if (mode.equals("primary-caller")) Bukkit.enterPrimaryThread();
    String outcome;
    try (var adapter = new PaperBukkitOnlinePlayerBukkitSnapshotAdapter(plugin, 25L)) {
      try {
        adapter.snapshot(challenge);
        outcome = "RETURNED";
      } catch (IllegalStateException error) {
        outcome = error.getMessage();
      }
      if (mode.equals("queued-timeout") && queued.get() != null) {
        Bukkit.enterPrimaryThread();
        try {
          queued.get().run();
        } finally {
          Bukkit.leavePrimaryThread();
        }
      }
    } finally {
      if (mode.equals("primary-caller")) Bukkit.leavePrimaryThread();
    }
    System.out.print(outcome + " " + schedules.get() + " " + cancellations.get()
        + " " + Bukkit.onlinePlayerReads());
  }
}
