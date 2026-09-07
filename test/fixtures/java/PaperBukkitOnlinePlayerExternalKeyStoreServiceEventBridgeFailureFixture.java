import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Queue;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFailureFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFailureFixture() {
  }

  public static void main(String[] args) {
    var services = new EmptyServicesManager();
    Plugin owner = new Plugin() {
    };
    Plugin companion = new Plugin() {
    };
    Queue<Runnable> workers = new ArrayDeque<>();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, access -> () -> {
        });
    var manager = new PublishingFailurePluginManager();
    String outcome;
    try {
      PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.register(
          manager, owner, companion, coordinator);
      outcome = "RETURNED";
    } catch (IllegalStateException error) {
      outcome = error.getMessage() + ":" + (error.getCause() == null)
          + ":" + error.getSuppressed().length;
    }
    System.out.print(outcome + "|" + coordinator.state().name() + "|"
        + workers.size() + "|" + !HandlerList.isRegisteredForFixture(manager.listener));
  }

  private static final class PublishingFailurePluginManager implements PluginManager {
    private Listener listener;

    @Override
    public void registerEvents(Listener listener, Plugin plugin) {
      this.listener = listener;
      HandlerList.registerForFixture(listener);
      throw new IllegalStateException("plugin manager detail must not escape");
    }
  }

  private static final class EmptyServicesManager implements ServicesManager {
    @Override
    public <T> void register(Class<T> service, T provider, Plugin plugin, ServicePriority priority) {
    }

    @Override
    public void unregisterAll(Plugin plugin) {
    }

    @Override
    public void unregister(Class<?> service, Object provider) {
    }

    @Override
    public void unregister(Object provider) {
    }

    @Override
    public <T> T load(Class<T> service) {
      return null;
    }

    @Override
    public <T> RegisteredServiceProvider<T> getRegistration(Class<T> service) {
      return null;
    }

    @Override
    public List<RegisteredServiceProvider<?>> getRegistrations(Plugin plugin) {
      return List.of();
    }

    @Override
    public <T> Collection<RegisteredServiceProvider<T>> getRegistrations(Class<T> service) {
      return List.of();
    }

    @Override
    public Collection<Class<?>> getKnownServices() {
      return List.of();
    }

    @Override
    public <T> boolean isProvidedFor(Class<T> service) {
      return false;
    }
  }
}
