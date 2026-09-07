import java.lang.reflect.Method;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Queue;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServiceRegisterEvent;
import org.bukkit.event.server.ServiceUnregisterEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridgeFixture() {
  }

  public static void main(String[] args) throws Exception {
    var services = new FixtureServicesManager();
    Plugin owner = new Plugin() {
    };
    Plugin companion = new Plugin() {
    };
    Plugin foreign = new Plugin() {
    };
    Queue<Runnable> workers = new ArrayDeque<>();
    AtomicInteger opens = new AtomicInteger();
    AtomicInteger closes = new AtomicInteger();
    var coordinator = new PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
        services, companion, workers::add, access -> {
          opens.incrementAndGet();
          return closes::incrementAndGet;
        });
    var pluginManager = new FixturePluginManager(false);
    var bridge = PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.register(
        pluginManager, owner, companion, coordinator);

    boolean initialQueued = workers.size() == 1;
    workers.remove().run();
    String initiallyWaiting = coordinator.state().name() + ":" + opens.get();

    var foreignRegistration = new RegisteredServiceProvider<>(
        PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
        access((byte) 9), ServicePriority.Highest, foreign);
    bridge.onServiceRegister(new ServiceRegisterEvent(foreignRegistration));
    boolean foreignIgnored = workers.isEmpty();

    var differentService = new RegisteredServiceProvider<>(
        String.class, "other", ServicePriority.Normal, companion);
    bridge.onServiceRegister(new ServiceRegisterEvent(differentService));
    boolean differentIgnored = workers.isEmpty();

    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access((byte) 1));
    RegisteredServiceProvider<?> exactRegistration = services.snapshot().get(0);
    bridge.onServiceRegister(new ServiceRegisterEvent(exactRegistration));
    boolean exactQueued = workers.size() == 1;
    workers.remove().run();
    String active = coordinator.state().name() + ":" + opens.get() + ":" + closes.get();

    bridge.onServiceRegister(new ServiceRegisterEvent(exactRegistration));
    workers.remove().run();
    String idempotent = coordinator.state().name() + ":" + opens.get() + ":" + closes.get();

    registration.close();
    bridge.onServiceUnregister(new ServiceUnregisterEvent(exactRegistration));
    boolean unregisterQueued = workers.size() == 1;
    workers.remove().run();
    String waiting = coordinator.state().name() + ":" + opens.get() + ":" + closes.get();

    boolean annotations = monitorAnnotation(
        "onServiceRegister", ServiceRegisterEvent.class)
        && monitorAnnotation("onServiceUnregister", ServiceUnregisterEvent.class);
    boolean registeredBeforeClose = HandlerList.isRegisteredForFixture(bridge)
        && pluginManager.listener == bridge && pluginManager.owner == owner;
    HandlerList.failNextUnregisterForFixture();
    String firstClose;
    try {
      bridge.close();
      firstClose = "RETURNED";
    } catch (IllegalStateException error) {
      firstClose = error.getMessage() + ":" + (error.getCause() == null)
          + ":" + error.getSuppressed().length;
    }
    boolean listenerRetainedWhileCoordinatorClosed = HandlerList.isRegisteredForFixture(bridge)
        && coordinator.state()
            == PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.State.CLOSED;
    bridge.onServiceRegister(new ServiceRegisterEvent(exactRegistration));
    boolean eventBlockedDuringRetry = workers.isEmpty();
    bridge.close();
    bridge.close();
    boolean closed = coordinator.state()
        == PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.State.CLOSED
        && !HandlerList.isRegisteredForFixture(bridge);
    bridge.onServiceRegister(new ServiceRegisterEvent(exactRegistration));
    boolean lateIgnored = workers.isEmpty();

    System.out.print(initialQueued + "|" + initiallyWaiting + "|" + foreignIgnored + "|"
        + differentIgnored + "|" + exactQueued + "|" + active + "|" + idempotent + "|"
        + unregisterQueued + "|" + waiting + "|" + annotations + "|"
        + registeredBeforeClose + "|" + firstClose + "|" + listenerRetainedWhileCoordinatorClosed
        + "|" + eventBlockedDuringRetry + "|" + closed + "|" + lateIgnored);
  }

  private static boolean monitorAnnotation(String methodName, Class<?> parameter) throws Exception {
    Method method = PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge.class
        .getMethod(methodName, parameter);
    EventHandler annotation = method.getAnnotation(EventHandler.class);
    return annotation != null && annotation.priority() == EventPriority.MONITOR;
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

  private static final class FixturePluginManager implements PluginManager {
    private final boolean fail;
    private Listener listener;
    private Plugin owner;

    private FixturePluginManager(boolean fail) {
      this.fail = fail;
    }

    @Override
    public void registerEvents(Listener listener, Plugin plugin) {
      this.listener = listener;
      this.owner = plugin;
      HandlerList.registerForFixture(listener);
      if (fail) throw new IllegalStateException("plugin manager detail must not escape");
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

    private synchronized List<RegisteredServiceProvider<?>> snapshot() {
      return List.copyOf(registrations);
    }
  }
}
