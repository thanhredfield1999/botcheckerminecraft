import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorConcurrencyFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorConcurrencyFixture() {
  }

  public static void main(String[] args) throws Exception {
    System.out.print(inlineAndErrorRecovery() + "|" + concurrentClose() + "|"
        + nonCooperativeTimeout() + "|" + reentrantWorkerClose());
  }

  private static String inlineAndErrorRecovery() {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    AtomicInteger attempts = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, Runnable::run, provider -> {
          if (attempts.incrementAndGet() == 1) throw new AssertionError("must not stick state");
          return closes::incrementAndGet;
        });
    String errorOutcome;
    try {
      coordinator.requestReconcile();
      errorOutcome = "RETURNED";
    } catch (AssertionError error) {
      errorOutcome = "ASSERTION";
    }
    String failed = errorOutcome + ":" + coordinator.state().name() + ":" + attempts.get();
    coordinator.requestReconcile();
    String recovered = coordinator.state().name() + ":" + attempts.get();
    registration.close();
    coordinator.requestReconcile();
    String removed = coordinator.state().name() + ":" + closes.get();
    coordinator.close();
    return failed + ":" + recovered + ":" + removed;
  }

  private static String concurrentClose() throws Exception {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    ExecutorService workerExecutor = Executors.newSingleThreadExecutor();
    ExecutorService callers = Executors.newFixedThreadPool(8);
    AtomicInteger opens = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workerExecutor::execute, provider -> {
          opens.incrementAndGet();
          return closes::incrementAndGet;
        });
    CountDownLatch requested = new CountDownLatch(32);
    for (int index = 0; index < 32; index++) {
      callers.execute(() -> {
        coordinator.requestReconcile();
        requested.countDown();
      });
    }
    require(requested.await(2, TimeUnit.SECONDS), "requests did not finish");
    awaitState(coordinator, PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.State.ACTIVE);

    CountDownLatch closed = new CountDownLatch(16);
    for (int index = 0; index < 16; index++) {
      callers.execute(() -> {
        coordinator.close();
        closed.countDown();
      });
    }
    require(closed.await(2, TimeUnit.SECONDS), "concurrent closes did not finish");
    callers.shutdownNow();
    workerExecutor.shutdownNow();
    require(callers.awaitTermination(2, TimeUnit.SECONDS), "callers still alive");
    require(workerExecutor.awaitTermination(2, TimeUnit.SECONDS), "worker still alive");
    registration.close();
    return coordinator.state().name() + ":" + opens.get() + ":" + closes.get();
  }

  private static String nonCooperativeTimeout() throws Exception {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    var workers = new java.util.ArrayDeque<Runnable>();
    CountDownLatch entered = new CountDownLatch(1);
    CountDownLatch release = new CountDownLatch(1);
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          entered.countDown();
          while (release.getCount() != 0L) {
            try {
              release.await();
            } catch (InterruptedException ignored) {
              // Deliberately non-cooperative to verify explicit timeout, not false quiescence.
            }
          }
          return () -> {
          };
        });
    coordinator.requestReconcile();
    Thread worker = Thread.ofPlatform().start(workers.remove());
    require(entered.await(2, TimeUnit.SECONDS), "factory did not enter");
    long started = System.nanoTime();
    String outcome;
    try {
      coordinator.close();
      outcome = "RETURNED";
    } catch (IllegalStateException error) {
      outcome = error.getMessage();
    }
    long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
    boolean aliveAtOutcome = worker.isAlive();
    release.countDown();
    worker.join(2_000L);
    coordinator.close();
    registration.close();
    return outcome + ":" + aliveAtOutcome + ":" + (elapsedMs < 1_500L) + ":"
        + worker.isAlive();
  }

  private static String reentrantWorkerClose() throws Exception {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    var workers = new java.util.ArrayDeque<Runnable>();
    var coordinatorRef = new java.util.concurrent.atomic.AtomicReference<
        PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator>();
    var closeOutcome = new java.util.concurrent.atomic.AtomicReference<>("NONE");
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, provider -> {
          try {
            coordinatorRef.get().close();
            closeOutcome.set("RETURNED");
          } catch (IllegalStateException error) {
            closeOutcome.set(error.getMessage());
          }
          return () -> {
          };
        });
    coordinatorRef.set(coordinator);
    coordinator.requestReconcile();
    Thread worker = Thread.ofPlatform().start(workers.remove());
    worker.join(2_000L);
    registration.close();
    return closeOutcome.get() + ":" + coordinator.state().name() + ":" + worker.isAlive();
  }

  private static void awaitState(
      PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator coordinator,
      PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.State expected)
      throws Exception {
    long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
    while (coordinator.state() != expected && System.nanoTime() < deadline) {
      Thread.sleep(1L);
    }
    require(coordinator.state() == expected, "state did not converge to " + expected);
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
