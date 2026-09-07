package vn.heomc.botchecker.paperadapter;

import java.util.List;
import java.util.Objects;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.RegisteredServiceProvider;
import org.bukkit.plugin.ServicesManager;

/** Resolves one opaque key-custody service owned by an exact companion plugin instance. */
public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver {
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver() {
  }

  public static PaperBukkitOnlinePlayerExternalKeyStoreAccess resolve(
      ServicesManager servicesManager,
      Plugin expectedCompanion) {
    Objects.requireNonNull(servicesManager, "servicesManager");
    Objects.requireNonNull(expectedCompanion, "expectedCompanion");
    try {
      List<RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess>> registrations =
          List.copyOf(servicesManager.getRegistrations(
              PaperBukkitOnlinePlayerExternalKeyStoreAccess.class));
      PaperBukkitOnlinePlayerExternalKeyStoreAccess resolved = null;
      for (RegisteredServiceProvider<PaperBukkitOnlinePlayerExternalKeyStoreAccess> registration
          : registrations) {
        if (registration == null || registration.getPlugin() != expectedCompanion) continue;
        if (registration.getService() != PaperBukkitOnlinePlayerExternalKeyStoreAccess.class
            || registration.getProvider() == null
            || !PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.isIssuedProvider(
                registration.getProvider())
            || resolved != null) {
          throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_CONFLICT");
        }
        resolved = registration.getProvider();
      }
      if (resolved == null) {
        throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_UNAVAILABLE");
      }
      return resolved;
    } catch (IllegalStateException error) {
      String message = error.getMessage();
      if ("PAPER_BUKKIT_KEYSTORE_SERVICE_CONFLICT".equals(message)
          || "PAPER_BUKKIT_KEYSTORE_SERVICE_UNAVAILABLE".equals(message)) {
        throw error;
      }
      throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_LOOKUP_FAILED");
    } catch (RuntimeException error) {
      throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_LOOKUP_FAILED");
    }
  }
}
