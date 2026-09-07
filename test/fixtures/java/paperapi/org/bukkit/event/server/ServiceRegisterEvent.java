package org.bukkit.event.server;

import org.bukkit.plugin.RegisteredServiceProvider;

public final class ServiceRegisterEvent {
  private final RegisteredServiceProvider<?> provider;

  public ServiceRegisterEvent(RegisteredServiceProvider<?> provider) {
    this.provider = provider;
  }

  public RegisteredServiceProvider<?> getProvider() {
    return provider;
  }
}
