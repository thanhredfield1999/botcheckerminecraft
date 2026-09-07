package vn.heomc.botchecker.paperadapter;

import java.util.Objects;
import java.util.concurrent.TimeUnit;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.ServicesManager;

/**
 * Coalesces service changes onto an injected worker and owns at most one active runtime.
 * Bukkit service event handlers must only call {@link #requestReconcile()}.
 *
 * <p>The runtime factory must react to interruption. {@link #close()} interrupts and joins an
 * in-flight worker within 250 ms; timeout is reported as
 * {@code PAPER_BUKKIT_SERVICE_COORDINATOR_CLOSE_TIMEOUT}, never as false quiescence. Runtime
 * {@code close()} executes synchronously outside the state lock and must itself be bounded.
 */
public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator
    implements AutoCloseable {
  private static final long CLOSE_JOIN_BUDGET_MS = 250L;
  private static final int MAX_RECONCILE_PASSES = 4;

  public enum State {
    WAITING,
    ACTIVATING,
    ACTIVE,
    CLOSED
  }

  @FunctionalInterface
  public interface WorkerScheduler {
    void execute(Runnable task);
  }

  @FunctionalInterface
  public interface RuntimeFactory {
    AutoCloseable open(PaperBukkitOnlinePlayerExternalKeyStoreAccess access) throws Exception;
  }

  private final ServicesManager servicesManager;
  private final Plugin expectedCompanion;
  private final WorkerScheduler workerScheduler;
  private final RuntimeFactory runtimeFactory;
  private final Object stateLock = new Object();

  private State state = State.WAITING;
  private boolean scheduled;
  private boolean reconciling;
  private boolean reconcileAgain;
  private Thread reconcileThread;
  private PaperBukkitOnlinePlayerExternalKeyStoreAccess activeAccess;
  private AutoCloseable activeRuntime;

  public PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator(
      ServicesManager servicesManager,
      Plugin expectedCompanion,
      WorkerScheduler workerScheduler,
      RuntimeFactory runtimeFactory) {
    this.servicesManager = Objects.requireNonNull(servicesManager, "servicesManager");
    this.expectedCompanion = Objects.requireNonNull(expectedCompanion, "expectedCompanion");
    this.workerScheduler = Objects.requireNonNull(workerScheduler, "workerScheduler");
    this.runtimeFactory = Objects.requireNonNull(runtimeFactory, "runtimeFactory");
  }

  /** Returns a diagnostic snapshot; callers must not use it as an authority or lock-free gate. */
  public State state() {
    synchronized (stateLock) {
      return state;
    }
  }

  /** Coalesces a service change; worker-scheduler rejection is fail-closed and never escapes. */
  public void requestReconcile() {
    synchronized (stateLock) {
      if (state == State.CLOSED) return;
      if (scheduled) {
        reconcileAgain = true;
        return;
      }
      if (reconciling) {
        if (Thread.currentThread() != reconcileThread) reconcileAgain = true;
        return;
      }
      scheduled = true;
      if (activeRuntime == null) state = State.ACTIVATING;
    }
    try {
      workerScheduler.execute(this::runReconcile);
    } catch (RuntimeException error) {
      synchronized (stateLock) {
        scheduled = false;
        reconcileAgain = false;
        if (state != State.CLOSED && activeRuntime == null) state = State.WAITING;
      }
    }
  }

  @Override
  public void close() {
    long deadlineNanos = System.nanoTime()
        + TimeUnit.MILLISECONDS.toNanos(CLOSE_JOIN_BUDGET_MS);
    AutoCloseable runtime;
    Thread worker;
    synchronized (stateLock) {
      if (state != State.CLOSED) {
        state = State.CLOSED;
        scheduled = false;
        reconcileAgain = false;
        activeAccess = null;
      }
      runtime = activeRuntime;
      activeRuntime = null;
      worker = reconcileThread;
    }
    boolean reentrantWorkerClose = worker == Thread.currentThread();
    if (worker != null && !reentrantWorkerClose) worker.interrupt();
    closeQuietly(runtime);
    if (reentrantWorkerClose) {
      throw new IllegalStateException("PAPER_BUKKIT_SERVICE_COORDINATOR_CLOSE_REENTRANT");
    }
    joinWorker(worker, deadlineNanos);
  }

  private void runReconcile() {
    Thread worker = Thread.currentThread();
    synchronized (stateLock) {
      if (state == State.CLOSED) {
        scheduled = false;
        return;
      }
      scheduled = false;
      if (reconciling) {
        reconcileAgain = true;
        return;
      }
      reconciling = true;
      reconcileThread = worker;
    }
    try {
      int passes = 0;
      boolean runAgain;
      do {
        synchronized (stateLock) {
          if (state == State.CLOSED) return;
          reconcileAgain = false;
        }
        boolean selfRetry = reconcileOnce();
        passes++;
        synchronized (stateLock) {
          runAgain = state != State.CLOSED
              && passes < MAX_RECONCILE_PASSES
              && (selfRetry || reconcileAgain);
        }
      } while (runAgain);
    } catch (Throwable error) {
      synchronized (stateLock) {
        if (state != State.CLOSED) state = State.WAITING;
      }
      if (error instanceof Error fatal) throw fatal;
    } finally {
      boolean reschedule;
      synchronized (stateLock) {
        reconciling = false;
        if (reconcileThread == worker) reconcileThread = null;
        reschedule = state != State.CLOSED && reconcileAgain;
        reconcileAgain = false;
        stateLock.notifyAll();
      }
      if (reschedule) requestReconcile();
    }
  }

  private boolean reconcileOnce() {
    PaperBukkitOnlinePlayerExternalKeyStoreAccess desired = resolveOrNull();
    AutoCloseable oldRuntime;
    synchronized (stateLock) {
      if (state == State.CLOSED) return false;
      if (activeRuntime != null && activeAccess == desired) {
        state = State.ACTIVE;
        return false;
      }
      oldRuntime = activeRuntime;
      activeRuntime = null;
      activeAccess = null;
      state = desired == null ? State.WAITING : State.ACTIVATING;
    }
    closeQuietly(oldRuntime);

    synchronized (stateLock) {
      if (state == State.CLOSED) return false;
    }
    if (desired == null) return false;

    AutoCloseable candidate = null;
    boolean selfRetry = false;
    try {
      candidate = Objects.requireNonNull(runtimeFactory.open(desired), "runtime");
      PaperBukkitOnlinePlayerExternalKeyStoreAccess current = resolveOrNull();
      boolean publish;
      synchronized (stateLock) {
        publish = state != State.CLOSED && current == desired;
        if (publish) {
          activeAccess = desired;
          activeRuntime = candidate;
          candidate = null;
          state = State.ACTIVE;
        } else if (state != State.CLOSED) {
          state = State.WAITING;
          selfRetry = true;
        }
      }
    } catch (Throwable error) {
      synchronized (stateLock) {
        if (state != State.CLOSED) state = State.WAITING;
      }
      if (error instanceof InterruptedException) Thread.currentThread().interrupt();
      if (error instanceof Error fatal) throw fatal;
    } finally {
      closeQuietly(candidate);
    }
    return selfRetry;
  }

  private PaperBukkitOnlinePlayerExternalKeyStoreAccess resolveOrNull() {
    try {
      return PaperBukkitOnlinePlayerExternalKeyStoreServiceResolver.resolve(
          servicesManager, expectedCompanion);
    } catch (IllegalStateException error) {
      return null;
    }
  }

  private static void closeQuietly(AutoCloseable runtime) {
    if (runtime == null) return;
    try {
      runtime.close();
    } catch (Throwable ignored) {
      // Ownership is fail-closed; no runtime reference remains published.
    }
  }

  private static void joinWorker(Thread worker, long deadlineNanos) {
    if (worker == null || worker == Thread.currentThread()) return;
    long remainingNanos = deadlineNanos - System.nanoTime();
    if (remainingNanos > 0L) {
      try {
        worker.join(Math.max(1L, TimeUnit.NANOSECONDS.toMillis(remainingNanos)));
      } catch (InterruptedException error) {
        Thread.currentThread().interrupt();
        throw new IllegalStateException("PAPER_BUKKIT_SERVICE_COORDINATOR_CLOSE_INTERRUPTED");
      }
    }
    if (worker.isAlive()) {
      throw new IllegalStateException("PAPER_BUKKIT_SERVICE_COORDINATOR_CLOSE_TIMEOUT");
    }
  }
}
