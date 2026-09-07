import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServiceRegisterEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeConcurrentCloseFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeConcurrentCloseFixture() {
  }

  public static void main(String[] args) throws Exception {
    var services = new EmptyServicesManager();
    Plugin owner = new Plugin() {
    };
    Plugin companion = new Plugin() {
    };
    Queue<Runnable> workers = new ArrayDeque<>();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, access -> () -> {
        });
    var pluginManager = new CountingPluginManager();
    var bridge = PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.register(
        pluginManager, owner, companion, coordinator);
    workers.remove().run();

    CountDownLatch start = new CountDownLatch(1);
    AtomicReference<String> first = new AtomicReference<>("NONE");
    AtomicReference<String> second = new AtomicReference<>("NONE");
    Thread a = Thread.ofPlatform().start(() -> {
      await(start);
      first.set(closeOutcome(bridge));
    });
    Thread b = Thread.ofPlatform().start(() -> {
      await(start);
      second.set(closeOutcome(bridge));
    });
    start.countDown();
    a.join(2_000L);
    b.join(2_000L);

    var exact = new RegisteredServiceProvider<>(
        PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
        access(), ServicePriority.Normal, companion);
    bridge.onServiceRegister(new ServiceRegisterEvent(exact));
    System.out.print(first.get() + ":" + second.get() + ":"
        + !HandlerList.isRegisteredForFixture(bridge) + ":"
        + pluginManager.registerCalls.get() + ":" + workers.size() + ":"
        + coordinator.state().name() + ":" + a.isAlive() + ":" + b.isAlive());
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

  private static void await(CountDownLatch latch) {
    try {
      latch.await();
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      throw new IllegalStateException("fixture interrupted");
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
        return new byte[] {1};
      }
    };
  }

  private static final class CountingPluginManager implements PluginManager {
    private final AtomicInteger registerCalls = new AtomicInteger();

    @Override
    public void registerEvents(Listener listener, Plugin plugin) {
      registerCalls.incrementAndGet();
      HandlerList.registerForFixture(listener);
    }
  }

  private static final class EmptyServicesManager implements ServicesManager {
    @Override
    public <T> void register(Class<T> service, T provider, Plugin plugin, ServicePriority priority) {
    }

    @Override
    public void unregisterAll(Plugin plugin) {
    }

    @Override
    public void unregister(Class<?> service, Object provider) {
    }

    @Override
    public void unregister(Object provider) {
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
      return List.of();
    }

    @Override
    public <T> Collection<RegisteredServiceProvider<T>> getRegistrations(Class<T> service) {
      return List.of();
    }

    @Override
    public Collection<Class<?>> getKnownServices() {
      return List.of();
    }

    @Override
    public <T> boolean isProvidedFor(Class<T> service) {
      return false;
    }
  }
}
