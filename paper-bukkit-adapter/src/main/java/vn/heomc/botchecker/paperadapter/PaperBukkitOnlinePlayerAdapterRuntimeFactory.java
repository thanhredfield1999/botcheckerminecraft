package vn.heomc.botchecker.paperadapter;

import java.util.Objects;
import org.bukkit.plugin.Plugin;

/**
 * Composes one fixed-policy adapter runtime from an opaque external key-custody lease.
 * This factory receives no KeyStore path, alias, password or private-key material.
 */
public final class PaperBukkitOnlinePlayerAdapterRuntimeFactory
    implements PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator.RuntimeFactory {
  private static final int MIN_TIMEOUT_MS = 1;
  private static final int MAX_TIMEOUT_MS = 60_000;

  private final Plugin owner;
  private final int port;
  private final int socketTimeoutMs;
  private final long snapshotTimeoutMs;
  private final PaperBukkitOnlinePlayerRequestProcessor.Policy policy;
  private final PaperBukkitOnlinePlayerRequestProcessor.TimeSource wallNow;
  private final PaperBukkitOnlinePlayerRequestProcessor.TimeSource monotonicNow;

  public PaperBukkitOnlinePlayerAdapterRuntimeFactory(
      Plugin owner,
      int port,
      int socketTimeoutMs,
      long snapshotTimeoutMs,
      PaperBukkitOnlinePlayerRequestProcessor.Policy policy,
      PaperBukkitOnlinePlayerRequestProcessor.TimeSource wallNow,
      PaperBukkitOnlinePlayerRequestProcessor.TimeSource monotonicNow) {
    if (owner == null
        || policy == null
        || wallNow == null
        || monotonicNow == null
        || port < 1 || port > 65_535
        || socketTimeoutMs < MIN_TIMEOUT_MS
        || socketTimeoutMs > MAX_TIMEOUT_MS
        || snapshotTimeoutMs < MIN_TIMEOUT_MS
        || snapshotTimeoutMs > MAX_TIMEOUT_MS) {
      throw new IllegalArgumentException("PAPER_BUKKIT_RUNTIME_OPTIONS_INVALID");
    }
    this.owner = owner;
    this.port = port;
    this.socketTimeoutMs = socketTimeoutMs;
    this.snapshotTimeoutMs = snapshotTimeoutMs;
    this.policy = policy;
    this.wallNow = wallNow;
    this.monotonicNow = monotonicNow;
  }

  @Override
  public PaperBukkitOnlinePlayerAdapterLifecycle open(
      PaperBukkitOnlinePlayerExternalKeyStoreAccess access) {
    if (access == null) {
      throw new IllegalStateException("PAPER_BUKKIT_RUNTIME_OPEN_FAILED");
    }
    var snapshot = new PaperBukkitOnlinePlayerBukkitSnapshotAdapter(owner, snapshotTimeoutMs);
    PaperBukkitOnlinePlayerOpaqueEd25519Signer signer = null;
    try {
      signer = new PaperBukkitOnlinePlayerOpaqueEd25519Signer(access, policy.keyId());
      return PaperBukkitOnlinePlayerAdapterLifecycle.bind(
          port, socketTimeoutMs, policy, wallNow, monotonicNow, snapshot, signer);
    } catch (RuntimeException error) {
      snapshot.close();
      if (signer != null) signer.close();
      throw new IllegalStateException("PAPER_BUKKIT_RUNTIME_OPEN_FAILED");
    }
  }
}
