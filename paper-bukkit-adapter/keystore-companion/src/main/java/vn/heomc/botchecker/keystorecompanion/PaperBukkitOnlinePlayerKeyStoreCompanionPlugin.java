package vn.heomc.botchecker.keystorecompanion;

import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.Arrays;
import org.bukkit.plugin.java.JavaPlugin;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration;

/**
 * Operator-owned custody plugin.
 *
 * <p>It opens exactly one externally provisioned PKCS12 Ed25519 entry and publishes it
 * through Bukkit {@code ServicesManager} so the adapter can sign without ever receiving
 * the private key, alias, path or password.</p>
 *
 * <p>Fail-closed by design: an incomplete or invalid configuration registers no service
 * and logs a fixed diagnostic code. The adapter then finds no provider and stays
 * inactive, which is the correct outcome — it must never fall back to a weaker key
 * source. No configuration value, path, alias, password or exception detail is ever
 * logged.</p>
 *
 * <p>The password is read from an environment variable supplied only to the Paper JVM.
 * {@code config.yml} carries non-secret metadata only.</p>
 */
public final class PaperBukkitOnlinePlayerKeyStoreCompanionPlugin extends JavaPlugin {
  private static final String CONFIG_PATH = "keystore.path";
  private static final String CONFIG_ALIAS = "keystore.alias";
  private static final String CONFIG_PASSWORD_ENV = "keystore.password-environment-variable";

  private PaperBukkitOnlinePlayerPkcs12KeyStoreAccess access;
  private PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration registration;

  @Override
  public void onEnable() {
    saveDefaultConfig();

    String rawPath = trimmedConfig(CONFIG_PATH);
    String alias = trimmedConfig(CONFIG_ALIAS);
    String passwordEnvironmentVariable = trimmedConfig(CONFIG_PASSWORD_ENV);
    if (rawPath == null || alias == null || passwordEnvironmentVariable == null) {
      getLogger().warning("PAPER_BUKKIT_COMPANION_CONFIG_INCOMPLETE; no key service registered.");
      return;
    }

    Path keyStorePath;
    try {
      keyStorePath = Path.of(rawPath);
    } catch (InvalidPathException error) {
      getLogger().warning("PAPER_BUKKIT_COMPANION_CONFIG_INVALID; no key service registered.");
      return;
    }

    try {
      access = PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
          keyStorePath,
          alias,
          passwordEnvironmentVariable,
          PaperBukkitOnlinePlayerKeyStoreCompanionPlugin::readPasswordFromEnvironment);
    } catch (RuntimeException error) {
      access = null;
      getLogger().warning("PAPER_BUKKIT_KEYSTORE_ACCESS_OPEN_FAILED; no key service registered.");
      return;
    }

    try {
      registration = PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration.register(
          getServer().getServicesManager(), this, access);
    } catch (RuntimeException error) {
      // Registration failed: close custody immediately so no key material outlives it.
      closeQuietly(access);
      access = null;
      registration = null;
      getLogger().warning("PAPER_BUKKIT_KEYSTORE_SERVICE_REGISTER_FAILED; no key service registered.");
      return;
    }

    getLogger().info("BotChecker KeyStore companion registered one opaque Ed25519 provider.");
  }

  @Override
  public void onDisable() {
    // Deregister before tearing down custody: the adapter must lose the lease first.
    closeQuietly(registration);
    registration = null;
    closeQuietly(access);
    access = null;
  }

  private String trimmedConfig(String key) {
    String value = getConfig().getString(key);
    if (value == null) return null;
    String trimmed = value.trim();
    return trimmed.isEmpty() ? null : trimmed;
  }

  private static char[] readPasswordFromEnvironment(String variableName) {
    String value = System.getenv(variableName);
    if (value == null || value.isEmpty()) return null;
    char[] password = value.toCharArray();
    // The String copy stays interned until GC; the char[] is what callers must zero.
    return Arrays.copyOf(password, password.length);
  }

  private void closeQuietly(AutoCloseable closeable) {
    if (closeable == null) return;
    try {
      closeable.close();
    } catch (Exception ignored) {
      // Best-effort teardown; never log custody detail.
    }
  }
}
