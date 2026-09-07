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

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceSynchronousInjectionFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceSynchronousInjectionFixture() {
  }

  public static void main(String[] args) {
    Plugin companion = new Plugin() {
    };
    var services = new InjectingServicesManager(companion);
    var expected = access((byte) 1);

    String registrationOutcome;
    try {
      PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
          services, companion, expected);
      registrationOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      registrationOutcome = error.getMessage();
    }

    String resolutionOutcome;
    try {
      PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(services, companion);
      resolutionOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      resolutionOutcome = error.getMessage();
    }

    System.out.print(registrationOutcome + "|" + resolutionOutcome + "|"
        + services.registrations.size() + "|" + services.expectedStillRegistered()
        + "|" + services.injectedStillRegistered());
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

  private static final class InjectingServicesManager implements ServicesManager {
    private final Plugin companion;
    private final PaperBukkitOnlinePlayerExternalKeyStoreAccess injected = access((byte) 9);
    private final List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>>
        registrations = new ArrayList<>();
    private PaperBukkitOnlinePlayerExternalKeyStoreAccess expectedLease;
    private boolean injectedOnce;

    private InjectingServicesManager(Plugin companion) {
      this.companion = companion;
    }

    @Override
    public <T> void register(
        Class<T> service,
        T provider,
        Plugin plugin,
        ServicePriority priority) {
      var typed = (PaperBukkitOnlinePlayerExternalKeyStoreAccess) provider;
      registrations.add(new RegisteredServiceProvider<>(
          PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
          typed,
          priority,
          plugin));
      if (!injectedOnce) {
        injectedOnce = true;
        expectedLease = typed;
        registrations.add(new RegisteredServiceProvider<>(
            PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
            injected,
            ServicePriority.Highest,
            companion));
      }
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

    private boolean expectedStillRegistered() {
      return registrations.stream().anyMatch(entry -> entry.getProvider() == expectedLease);
    }

    private boolean injectedStillRegistered() {
      return registrations.stream().anyMatch(entry -> entry.getProvider() == injected);
    }
  }
}
