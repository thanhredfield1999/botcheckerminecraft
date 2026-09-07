package vn.heomc.botchecker.paperadapter;

import java.util.Arrays;
import java.util.Objects;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.ServicePriority;
import org.bukkit.plugin.ServicesManager;

/** Owns one ServicesManager registration for an opaque external key-custody provider. */
public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration
    implements AutoCloseable {
  private final ServicesManager servicesManager;
  private final LeasedAccess provider;
  private final Object stateLock = new Object();
  private boolean leaseClosed;
  private boolean unregistered;
  private UnregisterAttempt currentUnregisterAttempt;

  private PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration(
      ServicesManager servicesManager,
      LeasedAccess provider) {
    this.servicesManager = servicesManager;
    this.provider = provider;
  }

  public static PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration register(
      ServicesManager servicesManager,
      Plugin companion,
      PaperBukkitOnlinePlayerExternalKeyStoreAccess provider) {
    Objects.requireNonNull(servicesManager, "servicesManager");
    Objects.requireNonNull(companion, "companion");
    Objects.requireNonNull(provider, "provider");
    LeasedAccess leased = new LeasedAccess(provider);
    try {
      servicesManager.register(
          PaperBukkitOnlinePlayerExternalKeyStoreAccess.class,
          leased,
          companion,
          ServicePriority.Normal);
      PaperBukkitOnlinePlayerExternalKeyStoreAccess resolved =
          PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(
              servicesManager, companion);
      if (resolved != leased) {
        throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_CONFLICT");
      }
      return new PaperBukkitOnlinePlayerExternalKeyStoreServiceRegistration(
          servicesManager, leased);
    } catch (RuntimeException error) {
      leased.close();
      unregisterQuietly(servicesManager, leased);
      String message = error.getMessage();
      if ("PAPER_BUKKIT_KEYSTORE_SERVICE_CONFLICT".equals(message)) {
        throw error;
      }
      throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_REGISTER_FAILED");
    }
  }

  @Override
  public void close() {
    UnregisterAttempt attempt;
    boolean owner;
    synchronized (stateLock) {
      if (unregistered) return;
      if (!leaseClosed) {
        leaseClosed = true;
        provider.close();
      }
      if (currentUnregisterAttempt == null || currentUnregisterAttempt.completed) {
        currentUnregisterAttempt = new UnregisterAttempt(Thread.currentThread());
        owner = true;
      } else {
        if (currentUnregisterAttempt.owner == Thread.currentThread()) return;
        owner = false;
      }
      attempt = currentUnregisterAttempt;
    }

    if (!owner) {
      awaitUnregisterAttempt(attempt);
      return;
    }

    boolean success = false;
    try {
      servicesManager.unregister(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class, provider);
      success = true;
    } catch (RuntimeException error) {
      // Publish only a stable outcome below; provider details must not escape.
    } finally {
      synchronized (stateLock) {
        attempt.success = success;
        attempt.completed = true;
        if (success) unregistered = true;
        stateLock.notifyAll();
      }
    }
    if (!success) {
      throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_UNREGISTER_FAILED");
    }
  }

  private void awaitUnregisterAttempt(UnregisterAttempt attempt) {
    boolean interrupted = false;
    synchronized (stateLock) {
      while (!attempt.completed) {
        try {
          stateLock.wait();
        } catch (InterruptedException error) {
          interrupted = true;
        }
      }
      if (interrupted) Thread.currentThread().interrupt();
      if (!attempt.success) {
        throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_UNREGISTER_FAILED");
      }
    }
  }

  private static void unregisterQuietly(
      ServicesManager servicesManager,
      PaperBukkitOnlinePlayerExternalKeyStoreAccess provider) {
    try {
      servicesManager.unregister(PaperBukkitOnlinePlayerExternalKeyStoreAccess.class, provider);
    } catch (RuntimeException ignored) {
      // Registration failed and no usable service handle may escape.
    }
  }

  static boolean isIssuedProvider(
      PaperBukkitOnlinePlayerExternalKeyStoreAccess provider) {
    return provider instanceof LeasedAccess;
  }

  private static final class UnregisterAttempt {
    private final Thread owner;
    private boolean completed;
    private boolean success;

    private UnregisterAttempt(Thread owner) {
      this.owner = owner;
    }
  }

  private static final class LeasedAccess
      implements PaperBukkitOnlinePlayerExternalKeyStoreAccess, AutoCloseable {
    private final PaperBukkitOnlinePlayerExternalKeyStoreAccess delegate;
    private final Object stateLock = new Object();
    private boolean open = true;

    private LeasedAccess(PaperBukkitOnlinePlayerExternalKeyStoreAccess delegate) {
      this.delegate = delegate;
    }

    @Override
    public byte[] publicKeySpkiDer() throws Exception {
      requireOpen();
      byte[] result;
      try {
        result = delegate.publicKeySpkiDer();
      } catch (Exception error) {
        throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_FAILED");
      }
      if (result == null) {
        throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_FAILED");
      }
      requireOpen();
      return Arrays.copyOf(result, result.length);
    }

    @Override
    public byte[] signEd25519(byte[] canonicalPayload) throws Exception {
      requireOpen();
      byte[] ownedPayload = canonicalPayload == null
          ? null
          : Arrays.copyOf(canonicalPayload, canonicalPayload.length);
      byte[] result;
      try {
        result = delegate.signEd25519(ownedPayload);
      } catch (Exception error) {
        throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_FAILED");
      }
      if (result == null) {
        throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_FAILED");
      }
      requireOpen();
      return Arrays.copyOf(result, result.length);
    }

    @Override
    public void close() {
      synchronized (stateLock) {
        open = false;
      }
    }

    private void requireOpen() {
      synchronized (stateLock) {
        if (!open) throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_CLOSED");
      }
    }
  }
}
