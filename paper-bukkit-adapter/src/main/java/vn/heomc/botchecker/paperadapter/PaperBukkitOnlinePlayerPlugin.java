package vn.heomc.botchecker.paperadapter;

import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Adapter plugin main.
 *
 * <p>On enable it parses a strict configuration, mints a fresh in-memory boot identity and
 * registers the runtime composition. The composition follows companion service
 * register/unregister events: the companion hard-depends on this plugin, so Paper loads
 * this plugin first and the key service is NOT expected to exist yet during onEnable.</p>
 *
 * <p>Fail-closed everywhere: an incomplete configuration, an unknown companion plugin or a
 * failed registration leaves no listener bound and logs a fixed code. No configuration
 * value, key identifier, path or exception detail is ever logged.</p>
 *
 * <p>This wires lifecycle only. It does not prove Paper load order, scheduler behaviour,
 * key custody or that a signed claim can be produced — those need a controlled Paper
 * runtime.</p>
 */
public final class PaperBukkitOnlinePlayerPlugin extends JavaPlugin {
  private PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition composition;

  @Override
  public void onEnable() {
    saveDefaultConfig();

    PaperBukkitOnlinePlayerAdapterConfig config;
    try {
      config = PaperBukkitOnlinePlayerAdapterConfig.parse(
          getConfig(), PaperBukkitOnlinePlayerAdapterConfig::mintBootId);
    } catch (RuntimeException error) {
      getLogger().warning(
          "PAPER_BUKKIT_ADAPTER_CONFIG_INVALID; transport disabled, no listener bound.");
      return;
    }

    Plugin companion = getServer().getPluginManager().getPlugin(config.companionPluginName());
    if (companion == null) {
      getLogger().warning(
          "PAPER_BUKKIT_ADAPTER_COMPANION_UNAVAILABLE; transport disabled, no listener bound.");
      return;
    }

    var runtimeFactory = new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
        this,
        config.port(),
        config.socketTimeoutMs(),
        config.snapshotTimeoutMs(),
        config.policy(),
        System::currentTimeMillis,
        () -> System.nanoTime() / 1_000_000L);

    try {
      composition = PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
          getServer().getServicesManager(),
          getServer().getPluginManager(),
          this,
          companion,
          task -> getServer().getScheduler().runTaskAsynchronously(this, task),
          runtimeFactory);
    } catch (RuntimeException error) {
      composition = null;
      getLogger().warning(
          "PAPER_BUKKIT_ADAPTER_RUNTIME_REGISTER_FAILED; transport disabled, no listener bound.");
      return;
    }

    getLogger().info(
        "BotChecker Paper adapter armed; awaiting companion key service registration.");
  }

  @Override
  public void onDisable() {
    if (composition == null) return;
    try {
      composition.close();
    } catch (RuntimeException ignored) {
      // Best-effort teardown; close() is already bounded and never logs custody detail.
    } finally {
      composition = null;
    }
  }
}
