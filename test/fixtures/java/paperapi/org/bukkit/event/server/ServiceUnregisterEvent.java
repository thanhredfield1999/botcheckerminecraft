package org.bukkit.event.server;

import org.bukkit.plugin.RegisteredServiceProvider;

public final class ServiceUnregisterEvent {
  private final RegisteredServiceProvider<?> provider;

  public ServiceUnregisterEvent(RegisteredServiceProvider<?> provider) {
    this.provider = provider;
  }

  public RegisteredServiceProvider<?> getProvider() {
    return provider;
  }
}
