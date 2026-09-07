package org.bukkit;

import java.util.Collection;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitScheduler;

public final class Bukkit {
  private static BukkitScheduler scheduler;
  private static Collection<? extends Player> onlinePlayers = List.of();
  private static final AtomicReference<Thread> primaryThread = new AtomicReference<>();
  private static final AtomicInteger onlinePlayerReads = new AtomicInteger();
  private static final AtomicBoolean readWasPrimary = new AtomicBoolean();
  private static final AtomicReference<String> readThread = new AtomicReference<>("missing");

  private Bukkit() {
  }

  public static void configure(
      BukkitScheduler configuredScheduler,
      Collection<? extends Player> configuredOnlinePlayers) {
    scheduler = configuredScheduler;
    onlinePlayers = List.copyOf(configuredOnlinePlayers);
    onlinePlayerReads.set(0);
    readWasPrimary.set(false);
    readThread.set("missing");
    primaryThread.set(null);
  }

  public static void enterPrimaryThread() {
    primaryThread.set(Thread.currentThread());
  }

  public static void leavePrimaryThread() {
    primaryThread.compareAndSet(Thread.currentThread(), null);
  }

  public static BukkitScheduler getScheduler() {
    return scheduler;
  }

  public static boolean isPrimaryThread() {
    return primaryThread.get() == Thread.currentThread();
  }

  public static Collection<? extends Player> getOnlinePlayers() {
    onlinePlayerReads.incrementAndGet();
    readWasPrimary.set(isPrimaryThread());
    readThread.set(Thread.currentThread().getName());
    return onlinePlayers;
  }

  public static int onlinePlayerReads() {
    return onlinePlayerReads.get();
  }

  public static String readThread() {
    return readThread.get();
  }

  public static boolean readWasPrimary() {
    return readWasPrimary.get();
  }
}
