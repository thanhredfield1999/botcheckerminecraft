package vn.heomc.botchecker.paperadapter;

import java.util.Objects;

/**
 * Owns the offline-composed listener, processor, Bukkit snapshot adapter and opaque signer.
 * This class does not provision keys or register itself with the plugin lifecycle.
 */
public final class PaperBukkitOnlinePlayerAdapterLifecycle implements AutoCloseable {
  private final Object stateLock = new Object();
  private final PaperBukkitOnlinePlayerLoopbackListener listener;
  private final PaperBukkitOnlinePlayerBukkitSnapshotAdapter snapshotAdapter;
  private final PaperBukkitOnlinePlayerOpaqueEd25519Signer signer;
  private boolean open = true;

  private PaperBukkitOnlinePlayerAdapterLifecycle(
      PaperBukkitOnlinePlayerLoopbackListener listener,
      PaperBukkitOnlinePlayerBukkitSnapshotAdapter snapshotAdapter,
      PaperBukkitOnlinePlayerOpaqueEd25519Signer signer) {
    this.listener = listener;
    this.snapshotAdapter = snapshotAdapter;
    this.signer = signer;
  }

  public static PaperBukkitOnlinePlayerAdapterLifecycle bind(
      int port,
      int socketTimeoutMs,
      PaperBukkitOnlinePlayerRequestProcessor.Policy policy,
      PaperBukkitOnlinePlayerRequestProcessor.TimeSource wallNow,
      PaperBukkitOnlinePlayerRequestProcessor.TimeSource monotonicNow,
      PaperBukkitOnlinePlayerBukkitSnapshotAdapter snapshotAdapter,
      PaperBukkitOnlinePlayerOpaqueEd25519Signer signer) {
    Objects.requireNonNull(snapshotAdapter, "snapshotAdapter");
    Objects.requireNonNull(signer, "signer");
    PaperBukkitOnlinePlayerRequestProcessor processor = null;
    try {
      processor = new PaperBukkitOnlinePlayerRequestProcessor(
          policy, wallNow, monotonicNow, snapshotAdapter, signer);
      var listener = PaperBukkitOnlinePlayerLoopbackListener.bind(
          port, socketTimeoutMs, processor);
      return new PaperBukkitOnlinePlayerAdapterLifecycle(listener, snapshotAdapter, signer);
    } catch (RuntimeException error) {
      closeQuietly(processor);
      closeQuietly(snapshotAdapter);
      closeQuietly(signer);
      throw new IllegalStateException("PAPER_BUKKIT_LIFECYCLE_BIND_FAILED");
    }
  }

  public String localAddress() {
    synchronized (stateLock) {
      requireOpen();
      return listener.localAddress();
    }
  }

  public int localPort() {
    synchronized (stateLock) {
      requireOpen();
      return listener.localPort();
    }
  }

  @Override
  public void close() {
    synchronized (stateLock) {
      if (!open) return;
      open = false;
    }
    closeQuietly(listener);
    closeQuietly(snapshotAdapter);
    closeQuietly(signer);
  }

  private void requireOpen() {
    if (!open) throw new IllegalStateException("PAPER_BUKKIT_LIFECYCLE_CLOSED");
  }

  private static void closeQuietly(AutoCloseable closeable) {
    if (closeable == null) return;
    try {
      closeable.close();
    } catch (Exception ignored) {
      // Ownership is fail-closed; every remaining component is still closed in order.
    }
  }
}
