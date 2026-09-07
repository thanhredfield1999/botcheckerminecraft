import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceExceptionSanitizationFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceExceptionSanitizationFixture() {
  }

  public static void main(String[] args) {
    var services = new FixtureServicesManager();
    Plugin companion = new Plugin() {
    };
    var access = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        throw new IllegalStateException("alias=[REDACTED] path=[REDACTED]");
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        throw new IllegalStateException("password=[REDACTED] provider detail");
      }
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access);
    var resolved = PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(
        services, companion);

    String publicOutcome = callbackOutcome(() -> resolved.publicKeySpkiDer());
    String signOutcome = callbackOutcome(() -> resolved.signEd25519(new byte[] {1}));
    registration.close();

    var nullServices = new FixtureServicesManager();
    Plugin nullCompanion = new Plugin() {
    };
    var nullAccess = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return null;
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        return null;
      }
    };
    var nullRegistration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        nullServices, nullCompanion, nullAccess);
    var nullResolved = PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(
        nullServices, nullCompanion);
    String nullPublicOutcome = callbackOutcome(() -> nullResolved.publicKeySpkiDer());
    String nullSignOutcome = callbackOutcome(() -> nullResolved.signEd25519(new byte[] {1}));
    nullRegistration.close();

    System.out.print(publicOutcome + "|" + signOutcome + "|"
        + nullPublicOutcome + "|" + nullSignOutcome);
  }

  private static String callbackOutcome(ThrowingCallback callback) {
    try {
      callback.run();
      return "RETURNED";
    } catch (Exception error) {
      return error.getMessage() + ":" + (error.getCause() == null)
          + ":" + error.getSuppressed().length;
    }
  }

  @FunctionalInterface
  private interface ThrowingCallback {
    void run() throws Exception;
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
