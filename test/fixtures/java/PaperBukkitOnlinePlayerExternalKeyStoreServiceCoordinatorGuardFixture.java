import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Queue;
import java.util.ArrayDeque;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorGuardFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorGuardFixture() {
  }

  public static void main(String[] args) throws Exception {
    System.out.print(scheduleFailure() + "|" + factoryFailure() + "|"
        + removalDuringOpen() + "|" + closeDuringOpen());
  }

  private static String scheduleFailure() {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    Queue<Runnable> workers = new ArrayDeque<>();
    AtomicInteger schedules = new AtomicInteger();
    AtomicInteger opens = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, task -> {
          if (schedules.incrementAndGet() == 1) {
            throw new IllegalStateException("scheduler detail must not escape");
          }
          workers.add(task);
        }, provider -> {
          opens.incrementAndGet();
          return closes::incrementAndGet;
        });
    coordinator.requestReconcile();
    String first = "RETURNED";
    String afterFailure = coordinator.state().name();
    coordinator.requestReconcile();
    workers.remove().run();
    String recovered = coordinator.state().name() + ":" + opens.get();
    coordinator.close();
    registration.close();
    return first + ":" + afterFailure + ":" + recovered + ":" + closes.get();
  }

  private static String factoryFailure() {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    Queue<Runnable> workers = new ArrayDeque<>();
    AtomicInteger attempts = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          if (attempts.incrementAndGet() == 1) {
            throw new IllegalStateException("factory credential detail must not escape");
          }
          return closes::incrementAndGet;
        });
    coordinator.requestReconcile();
    workers.remove().run();
    String failed = coordinator.state().name() + ":" + attempts.get();
    coordinator.requestReconcile();
    workers.remove().run();
    String recovered = coordinator.state().name() + ":" + attempts.get();
    coordinator.close();
    registration.close();
    return failed + ":" + recovered + ":" + closes.get();
  }

  private static String removalDuringOpen() throws Exception {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    Queue<Runnable> workers = new ArrayDeque<>();
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          entered.countDown();
          if (!release.await(2, TimeUnit.SECONDS)) {
            throw new IllegalStateException("factory release timeout");
          }
          return closes::incrementAndGet;
        });
    coordinator.requestReconcile();
    Thread worker = Thread.ofPlatform().start(workers.remove());
    require(entered.await(2, TimeUnit.SECONDS), "factory did not enter");
    registration.close();
    coordinator.requestReconcile();
    release.countDown();
    worker.join(2_000L);
    int queued = workers.size();
    if (queued == 1) workers.remove().run();
    String outcome = queued + ":" + coordinator.state().name() + ":"
        + closes.get() + ":" + worker.isAlive();
    coordinator.close();
    return outcome;
  }

  private static String closeDuringOpen() throws Exception {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    Queue<Runnable> workers = new ArrayDeque<>();
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch interrupted = new CountDownLatch(1);
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          entered.countDown();
          try {
            new CountDownLatch(1).await();
          } catch (InterruptedException error) {
            interrupted.countDown();
            Thread.currentThread().interrupt();
            throw error;
          }
          return closes::incrementAndGet;
        });
    coordinator.requestReconcile();
    Thread worker = Thread.ofPlatform().start(workers.remove());
    require(entered.await(2, TimeUnit.SECONDS), "factory did not enter");
    long started = System.nanoTime();
    coordinator.close();
    long closeMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
    worker.join(500L);
    boolean workerAliveAfterClose = worker.isAlive();
    boolean interruptedByClose = interrupted.getCount() == 0;
    if (workerAliveAfterClose) {
      worker.interrupt();
      worker.join(2_000L);
    }
    String outcome = coordinator.state().name() + ":" + closes.get() + ":"
        + workers.size() + ":" + workerAliveAfterClose + ":" + (closeMs < 2_000L)
        + ":" + interruptedByClose;
    registration.close();
    return outcome;
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
