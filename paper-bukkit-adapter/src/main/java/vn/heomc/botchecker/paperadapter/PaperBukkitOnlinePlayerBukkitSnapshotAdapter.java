package vn.heomc.botchecker.paperadapter;

import java.util.Objects;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * Paper-facing adapter that supplies the generic snapshot bridge with exact Bukkit APIs.
 * Only the scheduled primary-thread task reads the online-player collection.
 */
public final class PaperBukkitOnlinePlayerBukkitSnapshotAdapter
    implements PaperBukkitOnlinePlayerRequestProcessor.SnapshotProvider, AutoCloseable {
  private final PaperBukkitOnlinePlayerMainThreadSnapshotBridge bridge;

  public PaperBukkitOnlinePlayerBukkitSnapshotAdapter(Plugin plugin, long timeoutMs) {
    Plugin owner = Objects.requireNonNull(plugin, "plugin");
    this.bridge = new PaperBukkitOnlinePlayerMainThreadSnapshotBridge(
        new PaperBukkitOnlinePlayerMainThreadSnapshotBridge.MainThreadScheduler() {
          @Override
          public PaperBukkitOnlinePlayerMainThreadSnapshotBridge.ScheduledTask schedule(
              Runnable task) {
            BukkitTask scheduled = Bukkit.getScheduler().runTask(owner, task);
            return scheduled::cancel;
          }

          @Override
          public boolean isPrimaryThread() {
            return Bukkit.isPrimaryThread();
          }
        },
        () -> Bukkit.getOnlinePlayers().size(),
        System::currentTimeMillis,
        timeoutMs);
  }

  @Override
  public PaperBukkitOnlinePlayerRequestProcessor.Snapshot snapshot(
      PaperBukkitOnlinePlayerTransportCodec.Challenge challenge) {
    return bridge.snapshot(challenge);
  }

  @Override
  public void close() {
    bridge.close();
  }
}
