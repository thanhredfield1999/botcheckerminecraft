import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerBukkitSnapshotAdapter;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerBukkitSnapshotAdapterScheduleFailureFixture {
  private PaperBukkitOnlinePlayerBukkitSnapshotAdapterScheduleFailureFixture() {
  }

  public static void main(String[] args) {
    Plugin plugin = new Plugin() {
    };
    AtomicInteger schedules = new AtomicInteger();
    BukkitScheduler scheduler = (owner, task) -> {
      schedules.incrementAndGet();
      throw new IllegalStateException("DO_NOT_EXPOSE_PLUGIN_STATE");
    };
    Bukkit.configure(scheduler, List.of());
    var challenge = new PaperBukkitOnlinePlayerTransportCodec.Challenge(
        "audience", "verifier", 1L, "challenge", "nonce", "run", "0".repeat(64),
        "binding", "1".repeat(64), "provider", "1.0.0", "instance", "trust",
        "2026.09.01-1", "2".repeat(64), 1L, 10_000L);
    try (var adapter = new PaperBukkitOnlinePlayerBukkitSnapshotAdapter(plugin, 2_000L)) {
      System.out.print(outcome(adapter, challenge) + "|" + outcome(adapter, challenge)
          + "|" + schedules.get() + "|" + Bukkit.onlinePlayerReads());
    }
  }

  private static String outcome(
      PaperBukkitOnlinePlayerBukkitSnapshotAdapter adapter,
      PaperBukkitOnlinePlayerTransportCodec.Challenge challenge) {
    try {
      adapter.snapshot(challenge);
      return "RETURNED";
    } catch (IllegalStateException error) {
      return error.getMessage() + ":" + (error.getCause() == null);
    }
  }
}
