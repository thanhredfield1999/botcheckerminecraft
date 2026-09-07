import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServiceRegisterEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionCloseFailureFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreRuntimeCompositionCloseFailureFixture() {
  }

  public static void main(String[] args) {
    var services = new FixtureServicesManager();
    var pluginManager = new FixturePluginManager();
    Plugin owner = new Plugin() {
    };
    Plugin companion = new Plugin() {
    };
    Queue<Runnable> workers = new ArrayDeque<>();
    AtomicInteger opens = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    RegisteredServiceProvider<?> exact = services.snapshot().get(0);
    var composition = PaperBukkitOnlinePlayerExternalKeyStoreRuntimeComposition.register(
        services, pluginManager, owner, companion, workers::add, access -> {
          opens.incrementAndGet();
          return closes::incrementAndGet;
        });
    workers.remove().run();
    var bridge = (PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge) pluginManager.listener;

    HandlerList.failNextUnregisterForFixture();
    String firstClose = outcome(composition::close);
    boolean runtimeClosedDespiteListenerFailure = opens.get() == 1 && closes.get() == 1;
    boolean listenerRetainedForRetry = HandlerList.isRegisteredForFixture(bridge);
    bridge.onServiceRegister(new ServiceRegisterEvent(exact));
    boolean lateEventBlocked = workers.isEmpty();

    String secondClose = outcome(composition::close);
    composition.close();
    boolean fullyClosed = !HandlerList.isRegisteredForFixture(bridge)
        && opens.get() == 1 && closes.get() == 1;
    registration.close();

    System.out.print(firstClose + "|" + runtimeClosedDespiteListenerFailure + "|"
        + listenerRetainedForRetry + "|" + lateEventBlocked + "|" + secondClose + "|"
        + fullyClosed);
  }

  private static String outcome(Runnable action) {
    try {
      action.run();
      return "SUCCESS";
    } catch (IllegalStateException error) {
      return error.getMessage() + ":" + (error.getCause() == null)
          + ":" + error.getSuppressed().length;
    }
  }

  private static PaperBukkitOnlinePlayerExternalKeyStoreAccess access() {
    return new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return new byte[] {1};
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        return new byte[] {2};
      }
    };
  }

  private static final class FixturePluginManager implements PluginManager {
    private Listener listener;

    @Override
    public void registerEvents(Listener listener, Plugin plugin) {
      this.listener = listener;
      HandlerList.registerForFixture(listener);
    }
  }

  private static final class FixtureServicesManager implements ServicesManager {
    private final List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>>
        registrations = new ArrayList<>();

    @Override
    public synchronized <T> void register(
        Class<T> service, T provider, Plugin plugin, ServicePriority priority) {
      registrations.add(new RegisteredServiceProvider<>(
          PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
          (PaperBukkitOnlinePlayerExternalKeyStoreAccess) provider,
          priority,
          plugin));
    }

    @Override
    public synchronized void unregisterAll(Plugin plugin) {
      registrations.removeIf(entry -> entry.getPlugin() == plugin);
    }

    @Override
    public synchronized void unregister(Class<?> service, Object provider) {
      registrations.removeIf(entry -> entry.getProvider() == provider);
    }

    @Override
    public void unregister(Object provider) {
      unregister(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class, provider);
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
    public synchronized List<RegisteredServiceProvider<?>> getRegistrations(Plugin plugin) {
      List<RegisteredServiceProvider<?>> result = new ArrayList<>();
      for (var entry : registrations) if (entry.getPlugin() == plugin) result.add(entry);
      return List.copyOf(result);
    }

    @Override
    public synchronized <T> Collection<RegisteredServiceProvider<T>> getRegistrations(
        Class<T> service) {
      List<RegisteredServiceProvider<T>> result = new ArrayList<>();
      for (var entry : registrations) {
        @SuppressWarnings("unchecked")
        RegisteredServiceProvider<T> typed = (RegisteredServiceProvider<T>) entry;
        result.add(typed);
      }
      return List.copyOf(result);
    }

    @Override
    public synchronized Collection<Class<?>> getKnownServices() {
      return registrations.isEmpty()
          ? List.of()
          : List.of(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class);
    }

    @Override
    public synchronized <T> boolean isProvidedFor(Class<T> service) {
      return !registrations.isEmpty();
    }

    private synchronized List<RegisteredServiceProvider<?>> snapshot() {
      return List.copyOf(registrations);
    }
  }
}
