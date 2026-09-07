import java.util.Collection;
import java.util.List;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;

public final class PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionOptionsFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionOptionsFixture() {
  }

  public static void main(String[] args) {
    ServicesManager services = new EmptyServicesManager();
    PluginManager pluginManager = (listener, plugin) -> {
      throw new AssertionError("listener registration must not run for invalid options");
    };
    Plugin owner = new Plugin() {
    };
    Plugin companion = new Plugin() {
    };
    PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.WorkerScheduler scheduler = task -> {
      throw new AssertionError("scheduler must not run for invalid options");
    };
    PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.RuntimeFactory factory = access -> {
      throw new AssertionError("factory must not run for invalid options");
    };

    System.out.print(
        outcome(() -> PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
            null, pluginManager, owner, companion, scheduler, factory)) + "|"
        + outcome(() -> PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
            services, null, owner, companion, scheduler, factory)) + "|"
        + outcome(() -> PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
            services, pluginManager, null, companion, scheduler, factory)) + "|"
        + outcome(() -> PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
            services, pluginManager, owner, null, scheduler, factory)) + "|"
        + outcome(() -> PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
            services, pluginManager, owner, companion, null, factory)) + "|"
        + outcome(() -> PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
            services, pluginManager, owner, companion, scheduler, null)));
  }

  private static String outcome(Runnable action) {
    try {
      action.run();
      return "RETURNED";
    } catch (RuntimeException error) {
      return error.getMessage() + ":" + (error.getCause() == null);
    }
  }

  private static final class EmptyServicesManager implements ServicesManager {
    @Override public <T> void register(Class<T> service, T provider, Plugin plugin,
        org.bukkit.plugin.ServicePriority priority) {
    }
    @Override public void unregisterAll(Plugin plugin) {
    }
    @Override public void unregister(Class<?> service, Object provider) {
    }
    @Override public void unregister(Object provider) {
    }
    @Override public <T> T load(Class<T> service) {
      return null;
    }
    @Override public <T> RegisteredServiceProvider<T> getRegistration(Class<T> service) {
      return null;
    }
    @Override public List<RegisteredServiceProvider<?>> getRegistrations(Plugin plugin) {
      return List.of();
    }
    @Override public <T> Collection<RegisteredServiceProvider<T>> getRegistrations(Class<T> service) {
      return List.of();
    }
    @Override public Collection<Class<?>> getKnownServices() {
      return List.of();
    }
    @Override public <T> boolean isProvidedFor(Class<T> service) {
      return false;
    }
  }
}
