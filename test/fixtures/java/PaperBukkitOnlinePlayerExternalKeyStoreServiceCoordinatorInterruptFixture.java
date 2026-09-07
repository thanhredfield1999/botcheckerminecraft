import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorInterruptFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorInterruptFixture() {
  }

  public static void main(String[] args) throws Exception {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    var workers = new java.util.ArrayDeque<Runnable>();
    CountDownLatch entered = new CountDownLatch(1);
    AtomicBoolean interruptPreservedAfterReconcile = new AtomicBoolean();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          entered.countDown();
          new CountDownLatch(1).await();
          return () -> {
          };
        });
    coordinator.requestReconcile();
    Runnable reconcile = workers.remove();
    Thread worker = Thread.ofPlatform().start(() -> {
      reconcile.run();
      interruptPreservedAfterReconcile.set(Thread.currentThread().isInterrupted());
    });
    require(entered.await(2, TimeUnit.SECONDS), "factory did not enter");
    worker.interrupt();
    worker.join(2_000L);
    boolean stopped = !worker.isAlive();
    String state = coordinator.state().name();
    coordinator.close();
    registration.close();
    System.out.print(stopped + ":" + state + ":" + interruptPreservedAfterReconcile.get());
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
