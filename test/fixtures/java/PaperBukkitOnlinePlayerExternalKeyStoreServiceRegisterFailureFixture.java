import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceRegisterFailureFixture {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceRegisterFailureFixture() {
  }

  public static void main(String[] args) {
    var services = new PublishThenThrowServicesManager();
    Plugin companion = new Plugin() {
    };
    var provider = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return new byte[] {1};
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        return new byte[] {1};
      }
    };
    String outcome;
    try {
      PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
          services, companion, provider);
      outcome = "RETURNED";
    } catch (IllegalStateException error) {
      outcome = error.getMessage();
    }
    System.out.print(outcome + "|" + services.getRegistrations(
        PaperBukkitOnlinePlayerExternalKeyStoreAccess.class).size());
  }

  private static final class PublishThenThrowServicesManager implements ServicesManager {
    private final List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>>
        registrations = new ArrayList<>();

    @Override
    public <T> void register(
        Class<T> service,
        T provider,
        Plugin plugin,
        ServicePriority priority) {
      if (service == PaperBukkitOnlinePlayerExternalKeyStoreAccess.class) {
        @SuppressWarnings("unchecked")
        T ignored = provider;
        registrations.add(new RegisteredServiceProvider<>(
            PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
            (PaperBukkitOnlinePlayerExternalKeyStoreAccess) ignored,
            priority,
            plugin));
      }
      throw new IllegalStateException("event detail must not escape");
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
      for (RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess> entry
          : registrations) {
        if (entry.getPlugin() == plugin) result.add(entry);
      }
      return List.copyOf(result);
    }

    @Override
    public <T> Collection<RegisteredServiceProvider<T>> getRegistrations(Class<T> service) {
      List<RegisteredServiceProvider<T>> result = new ArrayList<>();
      for (RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess> entry
          : registrations) {
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
