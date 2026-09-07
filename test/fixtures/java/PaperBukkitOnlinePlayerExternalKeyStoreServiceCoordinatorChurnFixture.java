import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorChurnFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorChurnFixture() {
  }

  public static void main(String[] args) throws Exception {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var currentRegistration = new AtomicReference<>(
        PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
            services, companion, access((byte) 1)));
    Queue<Runnable> workers = new ArrayDeque<>();
    AtomicInteger opens = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var coordinatorRef = new AtomicReference<
        PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator>();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          int attempt = opens.incrementAndGet();
          currentRegistration.get().close();
          currentRegistration.set(
              PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
                  services, companion, access((byte) (attempt + 1))));
          coordinatorRef.get().requestReconcile();
          return closes::incrementAndGet;
        });
    coordinatorRef.set(coordinator);

    coordinator.requestReconcile();
    Thread worker = Thread.ofPlatform().start(workers.remove());
    worker.join(500L);
    boolean aliveAfterBudget = worker.isAlive();
    int observedOpens = opens.get();
    String stateAfterBudget = coordinator.state().name();
    coordinator.close();
    worker.join(2_000L);
    currentRegistration.get().close();

    System.out.print(aliveAfterBudget + "|" + (observedOpens <= 8) + "|"
        + (closes.get() == opens.get()) + "|" + stateAfterBudget + "|"
        + worker.isAlive() + "|" + workers.isEmpty());
  }

  private static PaperBukkitOnlinePlayerExternalKeyStoreAccess access(byte marker) {
    return new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return new byte[] {marker};
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        return new byte[] {marker};
      }
    };
  }

  private static final class FixtureServicesManager implements ServicesManager {
    private final List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>>
        registrations = new ArrayList<>();

    @Override
    public synchronized <T> void register(
        Class<T> service,
        T provider,
        Plugin plugin,
        ServicePriority priority) {
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
      for (var entry : registrations) {
        if (entry.getPlugin() == plugin) result.add(entry);
      }
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
