import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceReentrantCloseFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceReentrantCloseFixture() {
  }

  public static void main(String[] args) throws Exception {
    var services = new ReentrantServicesManager();
    Plugin companion = new Plugin() {
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access());
    services.registration.set(registration);

    AtomicReference<String> outcome = new AtomicReference<>("NONE");
    Thread owner = Thread.ofPlatform().start(() -> {
      try {
        registration.close();
        outcome.set("SUCCESS");
      } catch (IllegalStateException error) {
        outcome.set(error.getMessage());
      }
    });
    owner.join(500L);
    boolean aliveAfterBudget = owner.isAlive();
    if (aliveAfterBudget) {
      owner.interrupt();
      owner.join(2_000L);
    }

    System.out.print(aliveAfterBudget + "|" + outcome.get() + "|"
        + services.reentrantReturned.get() + "|" + services.unregisterCalls.get()
        + "|" + services.registrationCount() + "|" + owner.isAlive());
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

  private static final class ReentrantServicesManager implements ServicesManager {
    private final List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>>
        registrations = new ArrayList<>();
    private final AtomicReference<PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration>
        registration = new AtomicReference<>();
    private final AtomicBoolean reentrantReturned = new AtomicBoolean();
    private final AtomicInteger unregisterCalls = new AtomicInteger();

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
      unregisterCalls.incrementAndGet();
      synchronized (this) {
        registrations.removeIf(entry -> entry.getProvider() == provider);
      }
      registration.get().close();
      reentrantReturned.set(true);
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
