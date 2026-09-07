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

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceUnregisterRetryFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceUnregisterRetryFixture() {
  }

  public static void main(String[] args) {
    var services = new FailFirstUnregisterServicesManager();
    Plugin companion = new Plugin() {
    };
    var access = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return new byte[] {1};
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        return new byte[64];
      }
    };
    var registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
        services, companion, access);
    var stale = PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(
        services, companion);

    String first = closeOutcome(registration);
    int afterFirst = services.registrationCount();
    String staleOutcome;
    try {
      stale.signEd25519(new byte[] {7});
      staleOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      staleOutcome = error.getMessage();
    } catch (Exception error) {
      staleOutcome = "UNEXPECTED";
    }
    String second = closeOutcome(registration);

    System.out.print(first + "|" + afterFirst + "|" + staleOutcome + "|"
        + second + "|" + services.registrationCount() + "|" + services.unregisterAttempts);
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

  private static final class FailFirstUnregisterServicesManager implements ServicesManager {
    private final List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>>
        registrations = new ArrayList<>();
    private int unregisterAttempts;

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
      unregisterAttempts++;
      if (unregisterAttempts == 1) {
        throw new IllegalStateException("first unregister detail must not escape");
      }
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

    private int registrationCount() {
      return registrations.size();
    }
  }
}
