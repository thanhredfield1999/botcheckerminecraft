package org.bukkit.event;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;

public final class HandlerList {
  private static final Set<Listener> REGISTERED =
      Collections.newSetFromMap(new IdentityHashMap<>());
  private static boolean failNextUnregister;

  private HandlerList() {
  }

  public static synchronized void registerForFixture(Listener listener) {
    REGISTERED.add(listener);
  }

  public static synchronized void unregisterAll(Listener listener) {
    if (failNextUnregister) {
      failNextUnregister = false;
      throw new IllegalStateException("handler detail must not escape");
    }
    REGISTERED.remove(listener);
  }

  public static synchronized void failNextUnregisterForFixture() {
    failNextUnregister = true;
  }

  public static synchronized boolean isRegisteredForFixture(Listener listener) {
    return REGISTERED.contains(listener);
  }
}
