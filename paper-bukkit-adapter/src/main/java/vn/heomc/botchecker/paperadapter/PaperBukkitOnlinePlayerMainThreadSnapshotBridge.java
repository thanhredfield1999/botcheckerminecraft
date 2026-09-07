package vn.heomc.botchecker.paperadapter;

import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * Bridges one worker request to a scalar snapshot captured on the Paper primary thread.
 * This class contains no Bukkit API dependency; the plugin adapter supplies the scheduler
 * and online-player reader.
 */
public final class PaperBukkitOnlinePlayerMainThreadSnapshotBridge
    implements PaperBukkitOnlinePlayerRequestProcessor.SnapshotProvider, AutoCloseable {
  private static final long MIN_TIMEOUT_MS = 1L;
  private static final long MAX_TIMEOUT_MS = 60_000L;
  private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

  @FunctionalInterface
  public interface ScheduledTask {
    void cancel();
  }

  public interface MainThreadScheduler {
    ScheduledTask schedule(Runnable task);

    boolean isPrimaryThread();
  }

  @FunctionalInterface
  public interface OnlinePlayerCountReader {
    int readOnlinePlayers();
  }

  @FunctionalInterface
  public interface WallClock {
    long nowMs();
  }

  private static final class PendingSnapshot {
    private final CompletableFuture<PaperBukkitOnlinePlayerRequestProcessor.Snapshot> result =
        new CompletableFuture<>();
    private ScheduledTask task;
  }

  private final Object stateLock = new Object();
  private final MainThreadScheduler scheduler;
  private final OnlinePlayerCountReader onlinePlayerCountReader;
  private final WallClock wallClock;
  private final long timeoutMs;
  private boolean open = true;
  private PendingSnapshot pending;

  public PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
      MainThreadScheduler scheduler,
      OnlinePlayerCountReader onlinePlayerCountReader,
      WallClock wallClock,
      long timeoutMs) {
    this.scheduler = Objects.requireNonNull(scheduler, "scheduler");
    this.onlinePlayerCountReader = Objects.requireNonNull(
        onlinePlayerCountReader, "onlinePlayerCountReader");
    this.wallClock = Objects.requireNonNull(wallClock, "wallClock");
    if (timeoutMs < MIN_TIMEOUT_MS || timeoutMs > MAX_TIMEOUT_MS) {
      throw new IllegalArgumentException("PAPER_BUKKIT_SNAPSHOT_TIMEOUT_INVALID");
    }
    this.timeoutMs = timeoutMs;
  }

  @Override
  public PaperBukkitOnlinePlayerRequestProcessor.Snapshot snapshot(
      PaperBukkitOnlinePlayerTransportCodec.Challenge challenge) {
    Objects.requireNonNull(challenge, "challenge");
    if (scheduler.isPrimaryThread()) {
      throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_WAIT_ON_PRIMARY_THREAD");
    }

    PendingSnapshot request = new PendingSnapshot();
    synchronized (stateLock) {
      requireOpen();
      if (pending != null) throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_BRIDGE_BUSY");
      pending = request;
    }

    ScheduledTask scheduledTask;
    try {
      scheduledTask = Objects.requireNonNull(
          scheduler.schedule(() -> captureOnPrimaryThread(request)), "scheduledTask");
    } catch (RuntimeException error) {
      clearPending(request);
      throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_SCHEDULE_FAILED");
    }
    synchronized (stateLock) {
      if (!open || pending != request) {
        cancelQuietly(scheduledTask);
      } else if (!request.result.isDone()) {
        request.task = scheduledTask;
      }
    }

    try {
      PaperBukkitOnlinePlayerRequestProcessor.Snapshot snapshot =
          request.result.get(timeoutMs, TimeUnit.MILLISECONDS);
      synchronized (stateLock) {
        requireOpen();
        if (pending != request) {
          throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_BRIDGE_CLOSED");
        }
        return snapshot;
      }
    } catch (TimeoutException error) {
      cancel(request, "PAPER_BUKKIT_SNAPSHOT_TIMED_OUT");
      throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_TIMED_OUT");
    } catch (InterruptedException error) {
      Thread.currentThread().interrupt();
      cancel(request, "PAPER_BUKKIT_SNAPSHOT_INTERRUPTED");
      throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_INTERRUPTED");
    } catch (ExecutionException error) {
      if (error.getCause() instanceof IllegalStateException failure) throw failure;
      throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_FAILED");
    } finally {
      clearPending(request);
    }
  }

  private void captureOnPrimaryThread(PendingSnapshot request) {
    synchronized (stateLock) {
      if (!open || pending != request || request.result.isDone()) return;
    }
    try {
      if (!scheduler.isPrimaryThread()) {
        throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_NOT_PRIMARY_THREAD");
      }
      int onlinePlayers = onlinePlayerCountReader.readOnlinePlayers();
      synchronized (stateLock) {
        if (!open || pending != request || request.result.isDone()) return;
      }
      long observedAtMs = wallClock.nowMs();
      if (observedAtMs < 0 || observedAtMs > MAX_SAFE_INTEGER) {
        throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_TIME_INVALID");
      }
      var snapshot = new PaperBukkitOnlinePlayerRequestProcessor.Snapshot(
          onlinePlayers, observedAtMs);
      synchronized (stateLock) {
        if (!open || pending != request || request.result.isDone()) return;
        request.result.complete(snapshot);
      }
    } catch (RuntimeException error) {
      request.result.completeExceptionally(
          new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_CAPTURE_FAILED"));
    }
  }

  private void cancel(PendingSnapshot request, String reason) {
    ScheduledTask task;
    synchronized (stateLock) {
      if (pending == request) pending = null;
      task = request.task;
      request.task = null;
      request.result.completeExceptionally(new IllegalStateException(reason));
    }
    cancelQuietly(task);
  }

  private void clearPending(PendingSnapshot request) {
    synchronized (stateLock) {
      if (pending == request) pending = null;
      request.task = null;
    }
  }

  @Override
  public void close() {
    PendingSnapshot request;
    ScheduledTask task = null;
    synchronized (stateLock) {
      if (!open) return;
      open = false;
      request = pending;
      pending = null;
      if (request != null) {
        task = request.task;
        request.task = null;
      }
    }
    if (request != null) {
      request.result.completeExceptionally(
          new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_BRIDGE_CLOSED"));
      cancelQuietly(task);
    }
  }

  private void requireOpen() {
    if (!open) throw new IllegalStateException("PAPER_BUKKIT_SNAPSHOT_BRIDGE_CLOSED");
  }

  private static void cancelQuietly(ScheduledTask task) {
    if (task == null) return;
    try {
      task.cancel();
    } catch (RuntimeException ignored) {
      // The bridge state and future are already fail-closed.
    }
  }
}
