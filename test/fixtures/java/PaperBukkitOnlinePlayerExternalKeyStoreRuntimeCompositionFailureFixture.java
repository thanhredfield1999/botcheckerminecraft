import java.util.Collection;
import java.util.List;
import java.util.Queue;
import java.util.ArrayDeque;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition;

public final class PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionFailureFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionFailureFixture() {
  }

  public static void main(String[] args) {
    var services = new EmptyServicesManager();
    Plugin owner = new Plugin() {
    };
    Plugin companion = new Plugin() {
    };
    Queue<Runnable> workers = new ArrayDeque<>();
    AtomicInteger opens = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var pluginManager = new PublishingFailurePluginManager();
    String outcome;
    try {
      PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
          services, pluginManager, owner, companion, workers::add, access -> {
            opens.incrementAndGet();
            return closes::incrementAndGet;
          });
      outcome = "RETURNED";
    } catch (IllegalStateException error) {
      outcome = error.getMessage() + ":" + (error.getCause() == null)
          + ":" + error.getSuppressed().length;
    }
    boolean rolledBack = pluginManager.listener != null
        && !HandlerList.isRegisteredForFixture(pluginManager.listener)
        && workers.isEmpty()
        && opens.get() == 0
        && closes.get() == 0;
    System.out.print(outcome + "|" + rolledBack);
  }

  private static final class PublishingFailurePluginManager implements PluginManager {
    private Listener listener;

    @Override
    public void registerEvents(Listener listener, Plugin plugin) {
      this.listener = listener;
      HandlerList.registerForFixture(listener);
      throw new IllegalStateException("C:\\operator\\plugin-state password=DO_NOT_EXPOSE");
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
