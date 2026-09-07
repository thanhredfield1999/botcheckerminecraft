import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinatorFixture() {
  }

  public static void main(String[] args) {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    Plugin attacker = new Plugin() {
    };
    var hostile = access((byte) 9);
    services.register(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
        hostile, attacker, ServicePriority.Highest);

    Queue<Runnable> workers = new ArrayDeque<>();
    AtomicInteger opens = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services,
        companion,
        workers::add,
        provider -> {
          opens.incrementAndGet();
          if (provider.publicKeySpkiDer()[0] != 1) {
            throw new IllegalStateException("wrong provider");
          }
          return closes::incrementAndGet;
        });

    coordinator.requestReconcile();
    String scheduledWithoutService = coordinator.state().name() + ":" + workers.size();
    workers.remove().run();
    String waiting = coordinator.state().name() + ":" + opens.get();

    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access((byte) 1));
    coordinator.requestReconcile();
    workers.remove().run();
    String active = coordinator.state().name() + ":" + opens.get() + ":" + closes.get();

    coordinator.requestReconcile();
    workers.remove().run();
    String stable = coordinator.state().name() + ":" + opens.get() + ":" + closes.get();

    registration.close();
    coordinator.requestReconcile();
    workers.remove().run();
    String removed = coordinator.state().name() + ":" + opens.get() + ":" + closes.get();

    coordinator.close();
    coordinator.requestReconcile();
    String closed = coordinator.state().name() + ":" + workers.size();

    System.out.print(scheduledWithoutService + "|" + waiting + "|" + active + "|"
        + stable + "|" + removed + "|" + closed);
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
    public <T> void register(
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
    public void unregisterAll(Plugin plugin) {
      registrations.removeIf(entry -> entry.getPlugin() == plugin);
    }

    @Override
    public void unregister(Class<?> service, Object provider) {
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
    public List<RegisteredServiceProvider<?>> getRegistrations(Plugin plugin) {
      List<RegisteredServiceProvider<?>> result = new ArrayList<>();
      for (var entry : registrations) {
        if (entry.getPlugin() == plugin) result.add(entry);
      }
      return List.copyOf(result);
    }

    @Override
    public <T> Collection<RegisteredServiceProvider<T>> getRegistrations(Class<T> service) {
      List<RegisteredServiceProvider<T>> result = new ArrayList<>();
      for (var entry : registrations) {
        @SuppressWarnings("unchecked")
        RegisteredServiceProvider<T> typed = (RegisteredServiceProvider<T>) entry;
        result.add(typed);
      }
      return List.copyOf(result);
    }

    @Override
    public Collection<Class<?>> getKnownServices() {
      return registrations.isEmpty()
          ? List.of()
          : List.of(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class);
    }

    @Override
    public <T> boolean isProvidedFor(Class<T> service) {
      return !registrations.isEmpty();
    }
  }
}
