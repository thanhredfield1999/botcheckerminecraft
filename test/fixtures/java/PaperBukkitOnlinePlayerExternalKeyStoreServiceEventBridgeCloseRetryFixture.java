import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
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
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeCloseRetryFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeCloseRetryFixture() {
  }

  public static void main(String[] args) throws Exception {
    var services = new FixtureServicesManager();
    Plugin owner = new Plugin() {
    };
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    Queue<Runnable> workers = new ArrayDeque<>();
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          entered.countDown();
          while (release.getCount() != 0L) {
            try {
              release.await();
            } catch (InterruptedException ignored) {
              // Deliberately non-cooperative until the fixture releases it.
            }
          }
          return () -> {
          };
        });
    var pluginManager = new FixturePluginManager();
    var bridge = PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.register(
        pluginManager, owner, companion, coordinator);
    Thread worker = Thread.ofPlatform().start(workers.remove());
    require(entered.await(2, TimeUnit.SECONDS), "factory did not enter");

    String first = closeOutcome(bridge);
    boolean listenerRemoved = !HandlerList.isRegisteredForFixture(bridge);
    String second = closeOutcome(bridge);
    boolean aliveAfterSecond = worker.isAlive();
    release.countDown();
    worker.join(2_000L);
    String third = closeOutcome(bridge);
    registration.close();

    System.out.print(first + "|" + listenerRemoved + "|" + second + "|"
        + aliveAfterSecond + "|" + third + "|" + worker.isAlive());
  }

  private static String closeOutcome(
      PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge bridge) {
    try {
      bridge.close();
      return "SUCCESS";
    } catch (IllegalStateException error) {
      return error.getMessage();
    }
  }

  private static void require(boolean condition, String message) {
    if (!condition) throw new IllegalStateException(message);
  }

  private static PaperBukkitOnlinePlayerExternalKeyStoreAccess access() {
    return new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return new byte[] {1};
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        return new byte[] {1};
      }
    };
  }

  private static final class FixturePluginManager implements PluginManager {
    @Override
    public void registerEvents(Listener listener, Plugin plugin) {
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
  }
}
