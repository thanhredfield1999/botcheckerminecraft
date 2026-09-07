import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorRemovalRaceFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorRemovalRaceFixture() {
  }

  public static void main(String[] args) throws Exception {
    var services = new SnapshotBlockingServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    var workers = new LinkedBlockingQueue<Runnable>();
    AtomicInteger opens = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          opens.incrementAndGet();
          return closes::incrementAndGet;
        });

    coordinator.requestReconcile();
    workers.take().run();
    services.blockNextLookup();
    coordinator.requestReconcile();
    Thread reconcile = Thread.ofPlatform().start(workers.take());
    if (!services.snapshotTaken.await(2, TimeUnit.SECONDS)) {
      throw new IllegalStateException("lookup did not take snapshot");
    }
    registration.close();
    coordinator.requestReconcile();
    services.releaseLookup.countDown();
    reconcile.join(2_000L);

    int queuedAfterRace = workers.size();
    if (queuedAfterRace == 1) workers.take().run();
    System.out.print(queuedAfterRace + "|" + coordinator.state().name() + "|"
        + opens.get() + "|" + closes.get() + "|" + reconcile.isAlive());
    coordinator.close();
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

  private static final class SnapshotBlockingServicesManager implements ServicesManager {
    private final List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>>
        registrations = new ArrayList<>();
    private volatile boolean blockNextLookup;
    private CountDownLatch snapshotTaken = new CountDownLatch(1);
    private CountDownLatch releaseLookup = new CountDownLatch(1);

    private void blockNextLookup() {
      blockNextLookup = true;
      snapshotTaken = new CountDownLatch(1);
      releaseLookup = new CountDownLatch(1);
    }

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
    public <T> Collection<RegisteredServiceProvider<T>> getRegistrations(Class<T> service) {
      List<RegisteredServiceProvider<T>> snapshot = new ArrayList<>();
      synchronized (this) {
        for (var entry : registrations) {
          @SuppressWarnings("unchecked")
          RegisteredServiceProvider<T> typed = (RegisteredServiceProvider<T>) entry;
          snapshot.add(typed);
        }
      }
      if (blockNextLookup) {
        blockNextLookup = false;
        snapshotTaken.countDown();
        try {
          if (!releaseLookup.await(2, TimeUnit.SECONDS)) {
            throw new IllegalStateException("lookup release timeout");
          }
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          throw new IllegalStateException("lookup interrupted");
        }
      }
      return List.copyOf(snapshot);
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
