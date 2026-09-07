package vn.heomc.botchecker.paperadapter;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.Objects;
import org.bukkit.configuration.ConfigurationSection;

/**
 * Strict, fail-closed adapter configuration.
 *
 * <p>Every field is required and bounded. A missing, blank or malformed value throws a
 * fixed diagnostic code and never echoes the offending value — the adapter then stays
 * inactive rather than binding a socket with a partially trusted policy.</p>
 *
 * <p><strong>Boot identity.</strong> {@code claimedBootId} is NOT read from config. It is
 * minted once per {@code onEnable} from {@link SecureRandom} and kept in memory only, per
 * the P0.3 decision. That makes two boots of the same configured server produce different
 * signed claims, so a claim minted during boot A cannot be replayed as evidence about
 * boot B. It binds adapter lifecycle session only — it still does not prove OS process or
 * JVM identity, which requires cross-checking against observed process facts.</p>
 */
public final class PaperBukkitOnlinePlayerAdapterConfig {
  private static final int MIN_PORT = 1;
  private static final int MAX_PORT = 65_535;
  private static final int MIN_TIMEOUT_MS = 1;
  private static final int MAX_TIMEOUT_MS = 60_000;
  private static final int MIN_LEDGER_ENTRIES = 1;
  private static final int MAX_LEDGER_ENTRIES = 1_024;
  private static final int MAX_ID_LENGTH = 128;
  private static final int SHA256_HEX_LENGTH = 64;
  private static final int BOOT_ID_BYTES = 16;

  private final int port;
  private final int socketTimeoutMs;
  private final long snapshotTimeoutMs;
  private final String companionPluginName;
  private final PaperBukkitOnlinePlayerRequestProcessor.Policy policy;

  private PaperBukkitOnlinePlayerAdapterConfig(
      int port,
      int socketTimeoutMs,
      long snapshotTimeoutMs,
      String companionPluginName,
      PaperBukkitOnlinePlayerRequestProcessor.Policy policy) {
    this.port = port;
    this.socketTimeoutMs = socketTimeoutMs;
    this.snapshotTimeoutMs = snapshotTimeoutMs;
    this.companionPluginName = companionPluginName;
    this.policy = policy;
  }

  public int port() {
    return port;
  }

  public int socketTimeoutMs() {
    return socketTimeoutMs;
  }

  public long snapshotTimeoutMs() {
    return snapshotTimeoutMs;
  }

  public String companionPluginName() {
    return companionPluginName;
  }

  public PaperBukkitOnlinePlayerRequestProcessor.Policy policy() {
    return policy;
  }

  /**
   * Parses one adapter configuration section.
   *
   * @param section    the plugin configuration root; {@code null} means no config at all
   * @param bootIdMint supplier of a per-enable boot identity, normally
   *                   {@link #mintBootId()}
   * @throws IllegalArgumentException with a fixed code when anything is missing or out of
   *                                  bounds
   */
  public static PaperBukkitOnlinePlayerAdapterConfig parse(
      ConfigurationSection section, BootIdMint bootIdMint) {
    Objects.requireNonNull(bootIdMint, "bootIdMint");
    if (section == null) {
      throw new IllegalArgumentException("PAPER_BUKKIT_ADAPTER_CONFIG_MISSING");
    }

    int port = boundedInt(section, "transport.port", MIN_PORT, MAX_PORT);
    int socketTimeoutMs =
        boundedInt(section, "transport.socket-timeout-ms", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    long snapshotTimeoutMs =
        boundedInt(section, "transport.snapshot-timeout-ms", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS);
    int maxLedgerEntries =
        boundedInt(section, "transport.max-ledger-entries", MIN_LEDGER_ENTRIES, MAX_LEDGER_ENTRIES);

    String companionPluginName = requiredId(section, "companion-plugin-name");

    String bootId = bootIdMint.mint();
    if (bootId == null || bootId.isBlank() || bootId.length() > MAX_ID_LENGTH) {
      throw new IllegalArgumentException("PAPER_BUKKIT_ADAPTER_BOOT_ID_INVALID");
    }

    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        requiredId(section, "verifier.audience"),
        requiredId(section, "verifier.instance-id"),
        requiredSha256Hex(section, "key.id"),
        requiredId(section, "binding.id"),
        requiredSha256Hex(section, "binding.target-binding-sha256"),
        requiredId(section, "provider.id"),
        requiredId(section, "provider.version"),
        requiredId(section, "provider.instance-id"),
        requiredId(section, "trust-store.id"),
        requiredId(section, "trust-store.version"),
        requiredSha256Hex(section, "trust-store.sha256"),
        requiredId(section, "server.instance-id"),
        bootId,
        maxLedgerEntries);

    return new PaperBukkitOnlinePlayerAdapterConfig(
        port, socketTimeoutMs, snapshotTimeoutMs, companionPluginName, policy);
  }

  /** Mints a fresh in-memory boot identity for one adapter enable. */
  public static String mintBootId() {
    byte[] bytes = new byte[BOOT_ID_BYTES];
    new SecureRandom().nextBytes(bytes);
    return "boot-" + HexFormat.of().formatHex(bytes);
  }

  @FunctionalInterface
  public interface BootIdMint {
    String mint();
  }

  private static int boundedInt(ConfigurationSection section, String key, int min, int max) {
    if (!section.isInt(key)) {
      throw new IllegalArgumentException("PAPER_BUKKIT_ADAPTER_CONFIG_INVALID");
    }
    int value = section.getInt(key);
    if (value < min || value > max) {
      throw new IllegalArgumentException("PAPER_BUKKIT_ADAPTER_CONFIG_INVALID");
    }
    return value;
  }

  private static String requiredId(ConfigurationSection section, String key) {
    String value = section.getString(key);
    if (value == null) {
      throw new IllegalArgumentException("PAPER_BUKKIT_ADAPTER_CONFIG_INVALID");
    }
    String trimmed = value.trim();
    if (trimmed.isEmpty() || trimmed.length() > MAX_ID_LENGTH) {
      throw new IllegalArgumentException("PAPER_BUKKIT_ADAPTER_CONFIG_INVALID");
    }
    return trimmed;
  }

  private static String requiredSha256Hex(ConfigurationSection section, String key) {
    String value = requiredId(section, key);
    if (value.length() != SHA256_HEX_LENGTH) {
      throw new IllegalArgumentException("PAPER_BUKKIT_ADAPTER_CONFIG_INVALID");
    }
    for (int index = 0; index < value.length(); index += 1) {
      char character = value.charAt(index);
      boolean lowerHex = (character >= '0' && character <= '9')
          || (character >= 'a' && character <= 'f');
      if (!lowerHex) {
        throw new IllegalArgumentException("PAPER_BUKKIT_ADAPTER_CONFIG_INVALID");
      }
    }
    return value;
  }
}
