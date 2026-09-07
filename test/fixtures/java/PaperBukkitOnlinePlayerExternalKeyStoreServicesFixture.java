import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServicesFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServicesFixture() {
  }

  public static void main(String[] args) throws Exception {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    Plugin attacker = new Plugin() {
    };
    AtomicInteger expectedSignatures = new AtomicInteger();
    var expected = access((byte) 1, expectedSignatures);
    var hostileHighest = access((byte) 9, new AtomicInteger());
    services.register(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
        hostileHighest, attacker, ServicePriority.Highest);

    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, expected);
    PaperBukkitOnlinePlayerExternalKeyStoreAccess resolved =
        PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(services, companion);
    boolean ignoredHighest = services.load(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class)
        == hostileHighest
        && resolved != expected
        && resolved.publicKeySpkiDer()[0] == 1;
    byte[] publicCopy = resolved.publicKeySpkiDer();
    publicCopy[0] = 8;
    boolean publicKeyCopyIsolated = resolved.publicKeySpkiDer()[0] == 1;
    byte[] callerPayload = new byte[] {3};
    byte[] returnedSignature = resolved.signEd25519(callerPayload);
    callerPayload[0] = 7;
    returnedSignature[0] = 7;
    boolean payloadAndSignatureCopiesIsolated = expectedLastPayload[0] == 3
        && expectedLastSignature[0] == 1;

    var duplicate = access((byte) 2, new AtomicInteger());
    String duplicateOutcome;
    try {
      PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
          services, companion, duplicate);
      duplicateOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      duplicateOutcome = error.getMessage();
    }

    boolean recovered = PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(
        services, companion) == resolved;
    registration.close();
    registration.close();
    String staleOutcome;
    try {
      resolved.signEd25519(new byte[] {3});
      staleOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      staleOutcome = error.getMessage();
    } catch (Exception error) {
      staleOutcome = "UNEXPECTED";
    }
    String closedOutcome;
    try {
      PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(services, companion);
      closedOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      closedOutcome = error.getMessage();
    }
    boolean hostileStillRegistered = services.load(
        PaperBukkitOnlinePlayerExternalKeyStoreAccess.class) == hostileHighest;

    var rawSameCompanion = access((byte) 4, new AtomicInteger());
    services.register(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
        rawSameCompanion, companion, ServicePriority.Normal);
    String rawOutcome;
    try {
      PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(services, companion);
      rawOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      rawOutcome = error.getMessage();
    }
    services.unregister(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class, rawSameCompanion);

    System.out.print(ignoredHighest + "|" + duplicateOutcome + "|" + recovered
        + "|" + closedOutcome + "|" + hostileStillRegistered + "|" + staleOutcome
        + "|" + expectedSignatures.get() + "|" + rawOutcome + "|"
        + publicKeyCopyIsolated + "|" + payloadAndSignatureCopiesIsolated);
  }

  private static PaperBukkitOnlinePlayerExternalKeyStoreAccess access(
      byte marker,
      AtomicInteger signatures) {
    byte[] sharedPublicKey = new byte[] {marker};
    byte[] sharedSignature = new byte[] {marker};
    return new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return sharedPublicKey;
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        signatures.incrementAndGet();
        expectedLastPayload = canonicalPayload;
        expectedLastSignature = sharedSignature;
        return sharedSignature;
      }
    };
  }

  private static byte[] expectedLastPayload;
  private static byte[] expectedLastSignature;

  private static final class FixtureServicesManager implements ServicesManager {
    private final Map<Class<?>, List<RegisteredServiceProvider<?>>> registrations = new HashMap<>();

    @Override
    public <T> void register(
        Class<T> service,
        T provider,
        Plugin plugin,
        ServicePriority priority) {
      registrations.computeIfAbsent(service, ignored -> new ArrayList<>())
          .add(new RegisteredServiceProvider<>(service, provider, priority, plugin));
    }

    @Override
    public void unregisterAll(Plugin plugin) {
      registrations.values().forEach(entries -> entries.removeIf(entry -> entry.getPlugin() == plugin));
    }

    @Override
    public void unregister(Class<?> service, Object provider) {
      List<RegisteredServiceProvider<?>> entries = registrations.get(service);
      if (entries != null) entries.removeIf(entry -> entry.getProvider() == provider);
    }

    @Override
    public void unregister(Object provider) {
      registrations.values().forEach(entries -> entries.removeIf(entry -> entry.getProvider() == provider));
    }

    @Override
    public <T> T load(Class<T> service) {
      RegisteredServiceProvider<T> registration = getRegistration(service);
      return registration == null ? null : registration.getProvider();
    }

    @Override
    public <T> RegisteredServiceProvider<T> getRegistration(Class<T> service) {
      return getRegistrations(service).stream()
          .max((left, right) -> left.getPriority().compareTo(right.getPriority()))
          .orElse(null);
    }

    @Override
    public List<RegisteredServiceProvider<?>> getRegistrations(Plugin plugin) {
      return registrations.values().stream().flatMap(Collection::stream)
          .filter(entry -> entry.getPlugin() == plugin).toList();
    }

    @Override
    public <T> Collection<RegisteredServiceProvider<T>> getRegistrations(Class<T> service) {
      List<RegisteredServiceProvider<?>> entries = registrations.getOrDefault(service, List.of());
      List<RegisteredServiceProvider<T>> result = new ArrayList<>();
      for (RegisteredServiceProvider<?> entry : entries) {
        @SuppressWarnings("unchecked")
        RegisteredServiceProvider<T> typed = (RegisteredServiceProvider<T>) entry;
        result.add(typed);
      }
      return List.copyOf(result);
    }

    @Override
    public Collection<Class<?>> getKnownServices() {
      return List.copyOf(registrations.keySet());
    }

    @Override
    public <T> boolean isProvidedFor(Class<T> service) {
      return !getRegistrations(service).isEmpty();
    }
  }
}
