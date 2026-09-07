package vn.heomc.botchecker.paperadapter;

import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.ServicesManager;

/**
 * Owns the service coordinator and its Bukkit event bridge as one library composition.
 * This class does not resolve plugin names, read configuration or activate a plugin main.
 */
public final class PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition
    implements AutoCloseable {
  private final PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge eventBridge;

  private PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition(
      PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge eventBridge) {
    this.eventBridge = eventBridge;
  }

  public static PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition register(
      ServicesManager servicesManager,
      PluginManager pluginManager,
      Plugin owner,
      Plugin expectedCompanion,
      PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.WorkerScheduler workerScheduler,
      PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.RuntimeFactory runtimeFactory) {
    if (servicesManager == null
        || pluginManager == null
        || owner == null
        || expectedCompanion == null
        || workerScheduler == null
        || runtimeFactory == null) {
      throw new IllegalArgumentException("PAPER_BUKKIT_RUNTIME_COMPOSITION_OPTIONS_INVALID");
    }
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        servicesManager, expectedCompanion, workerScheduler, runtimeFactory);
    var eventBridge = PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.register(
        pluginManager, owner, expectedCompanion, coordinator);
    return new PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition(eventBridge);
  }

  @Override
  public void close() {
    eventBridge.close();
  }
}
