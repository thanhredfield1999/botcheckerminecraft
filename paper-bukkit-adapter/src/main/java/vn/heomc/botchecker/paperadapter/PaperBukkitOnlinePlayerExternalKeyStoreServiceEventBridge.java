package vn.heomc.botchecker.paperadapter;

import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.server.ServiceRegisterEvent;
import org.bukkit.event.server.ServiceUnregisterEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredServiceProvider;

/** Bridges exact Bukkit service changes into the library-only runtime coordinator. */
public final class PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge
    implements Listener, AutoCloseable {
  private final Plugin expectedCompanion;
  private final PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator coordinator;
  private final Object stateLock = new Object();
  private boolean acceptingEvents = true;
  private boolean listenerRegistered = true;
  private boolean unregisteringListener;
  private boolean coordinatorClosed;

  private PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge(
      Plugin expectedCompanion,
      PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator coordinator) {
    this.expectedCompanion = expectedCompanion;
    this.coordinator = coordinator;
  }

  public static PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge register(
      PluginManager pluginManager,
      Plugin owner,
      Plugin expectedCompanion,
      PaperBukkitOnlinePlayerExternalKeyStoreServiceCoordinator coordinator) {
    if (pluginManager == null
        || owner == null
        || expectedCompanion == null
        || coordinator == null) {
      throw new IllegalArgumentException(
          "PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_OPTIONS_INVALID");
    }
    var bridge = new PaperBukkitOnlinePlayerExternalKeyStoreServiceEventBridge(
        expectedCompanion, coordinator);
    try {
      pluginManager.registerEvents(bridge, owner);
      coordinator.requestReconcile();
      return bridge;
    } catch (Throwable error) {
      try {
        bridge.close();
      } catch (Throwable ignored) {
        // The original failure remains authoritative and no detail may escape.
      }
      if (error instanceof Error fatal) throw fatal;
      throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_REGISTER_FAILED");
    }
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onServiceRegister(ServiceRegisterEvent event) {
    onServiceChange(event == null ? null : event.getProvider());
  }

  @EventHandler(priority = EventPriority.MONITOR)
  public void onServiceUnregister(ServiceUnregisterEvent event) {
    onServiceChange(event == null ? null : event.getProvider());
  }

  @Override
  public void close() {
    boolean unregisterListener = false;
    synchronized (stateLock) {
      if (coordinatorClosed && !listenerRegistered) return;
      acceptingEvents = false;
      while (unregisteringListener) {
        try {
          stateLock.wait();
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          throw new IllegalStateException(
              "PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_CLOSE_INTERRUPTED");
        }
      }
      if (listenerRegistered) {
        unregisteringListener = true;
        unregisterListener = true;
      }
    }
    boolean unregisterFailed = false;
    if (unregisterListener) {
      boolean unregistered = false;
      try {
        HandlerList.unregisterAll(this);
        unregistered = true;
      } catch (RuntimeException error) {
        unregisterFailed = true;
      } finally {
        synchronized (stateLock) {
          if (unregistered) listenerRegistered = false;
          unregisteringListener = false;
          stateLock.notifyAll();
        }
      }
    }
    boolean closeCoordinator;
    synchronized (stateLock) {
      closeCoordinator = !coordinatorClosed;
    }
    if (closeCoordinator) {
      coordinator.close();
      synchronized (stateLock) {
        coordinatorClosed = true;
      }
    }
    if (unregisterFailed) {
      throw new IllegalStateException(
          "PAPER_BUKKIT_KEYSTORE_SERVICE_EVENT_BRIDGE_UNREGISTER_FAILED");
    }
  }

  private void onServiceChange(RegisteredServiceProvider<?> registration) {
    synchronized (stateLock) {
      if (!acceptingEvents) return;
    }
    if (registration == null
        || registration.getService() != PaperBukkitOnlinePlayerExternalKeyStoreAccess.class
        || registration.getPlugin() != expectedCompanion) {
      return;
    }
    coordinator.requestReconcile();
  }
}
