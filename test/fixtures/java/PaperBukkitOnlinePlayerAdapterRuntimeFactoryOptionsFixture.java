import org.bukkit.plugin.Plugin;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerAdapterRuntimeFactory;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;

public final class PaperBukkitOnlinePlayerAdapterRuntimeFactoryOptionsFixture {
  private PaperBukkitOnlinePlayerAdapterRuntimeFactoryOptionsFixture() {
  }

  public static void main(String[] args) {
    Plugin plugin = new Plugin() {
    };
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        "audience", "verifier", "0".repeat(64), "binding", "1".repeat(64),
        "provider", "1.0.0", "instance", "trust", "2026.09.01-1",
        "2".repeat(64), "server", "boot", 8);
    System.out.print(
        outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            plugin, 0, 2_000, 2_000L, policy, System::currentTimeMillis,
            () -> System.nanoTime() / 1_000_000L)) + "|"
        + outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            plugin, 12_345, 0, 2_000L, policy, System::currentTimeMillis,
            () -> System.nanoTime() / 1_000_000L)) + "|"
        + outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            plugin, 12_345, 2_000, 0L, policy, System::currentTimeMillis,
            () -> System.nanoTime() / 1_000_000L)) + "|"
        + outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            plugin, 12_345, 60_001, 2_000L, policy, System::currentTimeMillis,
            () -> System.nanoTime() / 1_000_000L)) + "|"
        + outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            plugin, 12_345, 2_000, 60_001L, policy, System::currentTimeMillis,
            () -> System.nanoTime() / 1_000_000L)) + "|"
        + outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            null, 12_345, 2_000, 2_000L, policy, System::currentTimeMillis,
            () -> System.nanoTime() / 1_000_000L)) + "|"
        + outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            plugin, 12_345, 2_000, 2_000L, null, System::currentTimeMillis,
            () -> System.nanoTime() / 1_000_000L)) + "|"
        + outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            plugin, 12_345, 2_000, 2_000L, policy, null,
            () -> System.nanoTime() / 1_000_000L)) + "|"
        + outcome(() -> new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
            plugin, 12_345, 2_000, 2_000L, policy, System::currentTimeMillis,
            null)));
  }

  private static String outcome(Runnable action) {
    try {
      action.run();
      return "RETURNED";
    } catch (RuntimeException error) {
      return error.getMessage() + ":" + (error.getCause() == null);
    }
  }
}
