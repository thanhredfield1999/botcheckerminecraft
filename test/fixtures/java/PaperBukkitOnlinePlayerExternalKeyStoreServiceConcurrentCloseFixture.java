import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceConcurrentCloseFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceConcurrentCloseFixture() {
  }

  public static void main(String[] args) throws Exception {
    System.out.print(successRace() + "|" + failureRace() + "|" + interruptedWaiter());
  }

  private static String successRace() throws Exception {
    var services = new BlockingServicesManager(false);
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    var first = new AtomicReference<>("NONE");
    var second = new AtomicReference<>("NONE");
    CountDownLatch secondStarted = new CountDownLatch(1);
    Thread a = Thread.ofPlatform().start(() -> first.set(closeOutcome(registration)));
    require(services.unregisterEntered.await(2, TimeUnit.SECONDS), "first unregister did not enter");
    Thread b = Thread.ofPlatform().start(() -> {
      secondStarted.countDown();
      second.set(closeOutcome(registration));
    });
    require(secondStarted.await(2, TimeUnit.SECONDS), "second close did not start");
    Thread.sleep(25L);
    services.releaseUnregister.countDown();
    a.join(2_000L);
    b.join(2_000L);
    require(!a.isAlive() && !b.isAlive(), "success close threads still alive");
    return services.unregisterCalls.get() + ":" + first.get() + ":" + second.get()
        + ":" + services.registrationCount();
  }

  private static String failureRace() throws Exception {
    var services = new BlockingServicesManager(true);
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    var first = new AtomicReference<>("NONE");
    var second = new AtomicReference<>("NONE");
    CountDownLatch secondStarted = new CountDownLatch(1);
    Thread a = Thread.ofPlatform().start(() -> first.set(closeOutcome(registration)));
    require(services.unregisterEntered.await(2, TimeUnit.SECONDS), "failing unregister did not enter");
    Thread b = Thread.ofPlatform().start(() -> {
      secondStarted.countDown();
      second.set(closeOutcome(registration));
    });
    require(secondStarted.await(2, TimeUnit.SECONDS), "second failing close did not start");
    Thread.sleep(25L);
    services.releaseUnregister.countDown();
    a.join(2_000L);
    b.join(2_000L);
    require(!a.isAlive() && !b.isAlive(), "failure close threads still alive");
    int callsBeforeRetry = services.unregisterCalls.get();
    String retry = closeOutcome(registration);
    return callsBeforeRetry + ":" + first.get() + ":" + second.get() + ":"
        + retry + ":" + services.unregisterCalls.get() + ":" + services.registrationCount();
  }

  private static String interruptedWaiter() throws Exception {
    var services = new BlockingServicesManager(false);
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    var ownerOutcome = new AtomicReference<>("NONE");
    var waiterOutcome = new AtomicReference<>("NONE");
    var waiterInterrupted = new AtomicReference<>(false);
    CountDownLatch waiterStarted = new CountDownLatch(1);
    Thread owner = Thread.ofPlatform().start(() -> ownerOutcome.set(closeOutcome(registration)));
    require(services.unregisterEntered.await(2, TimeUnit.SECONDS), "owner unregister did not enter");
    Thread waiter = Thread.ofPlatform().start(() -> {
      waiterStarted.countDown();
      waiterOutcome.set(closeOutcome(registration));
      waiterInterrupted.set(Thread.currentThread().isInterrupted());
    });
    require(waiterStarted.await(2, TimeUnit.SECONDS), "waiter did not start");
    Thread.sleep(25L);
    waiter.interrupt();
    Thread.sleep(25L);
    services.releaseUnregister.countDown();
    owner.join(2_000L);
    waiter.join(2_000L);
    require(!owner.isAlive() && !waiter.isAlive(), "interrupted waiter race still alive");
    return services.unregisterCalls.get() + ":" + ownerOutcome.get() + ":"
        + waiterOutcome.get() + ":" + waiterInterrupted.get() + ":"
        + services.registrationCount();
  }


  private static String closeOutcome(
      PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration registration) {
    try {
      registration.close();
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

  private static final class BlockingServicesManager implements ServicesManager {
    private final List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>>
        registrations = new ArrayList<>();
    private final boolean failFirst;
    private final AtomicInteger unregisterCalls = new AtomicInteger();
    private final CountDownLatch unregisterEntered = new CountDownLatch(1);
    private final CountDownLatch releaseUnregister = new CountDownLatch(1);

    private BlockingServicesManager(boolean failFirst) {
      this.failFirst = failFirst;
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
    public void unregister(Class<?> service, Object provider) {
      int attempt = unregisterCalls.incrementAndGet();
      if (attempt == 1) {
        unregisterEntered.countDown();
        try {
          if (!releaseUnregister.await(2, TimeUnit.SECONDS)) {
            throw new IllegalStateException("release timeout");
          }
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          throw new IllegalStateException("unregister interrupted");
        }
        if (failFirst) throw new IllegalStateException("provider detail must not escape");
      }
      synchronized (this) {
        registrations.removeIf(entry -> entry.getProvider() == provider);
      }
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

    private synchronized int registrationCount() {
      return registrations.size();
    }
  }
}
