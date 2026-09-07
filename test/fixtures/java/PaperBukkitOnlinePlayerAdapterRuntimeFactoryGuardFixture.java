import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerAdapterLifecycle;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerAdapterRuntimeFactory;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;

public final class PaperBukkitOnlinePlayerAdapterRuntimeFactoryGuardFixture {
  private PaperBukkitOnlinePlayerAdapterRuntimeFactoryGuardFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("expected mode");
    String mode = args[0];
    BukkitScheduler scheduler = (owner, task) -> {
      throw new AssertionError("snapshot scheduler must not run in guard fixture");
    };
    Bukkit.configure(scheduler, List.of());
    Plugin plugin = new Plugin() {
    };
    var keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
    byte[] publicKey = keyPair.getPublic().getEncoded();
    String keyId = HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(publicKey));
    AtomicInteger publicKeyReads = new AtomicInteger();
    var validAccess = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        publicKeyReads.incrementAndGet();
        return publicKey.clone();
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) throws Exception {
        Signature signature = Signature.getInstance("Ed25519");
        signature.initSign(keyPair.getPrivate());
        signature.update(canonicalPayload);
        return signature.sign();
      }
    };
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        "audience", "verifier", keyId, "binding", "1".repeat(64),
        "provider", "1.0.0", "instance", "trust", "2026.09.01-1",
        "2".repeat(64), "server", "boot", 8);

    if (mode.equals("null-access")) {
      var factory = factory(plugin, freeLoopbackPort(), policy);
      System.out.print(outcome(() -> factory.open(null)));
      return;
    }
    if (mode.equals("provider-failure")) {
      var failingAccess = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
        @Override
        public byte[] publicKeySpkiDer() {
          throw new IllegalStateException("C:\\operator\\prod.jks alias=private password=DO_NOT_EXPOSE");
        }

        @Override
        public byte[] signEd25519(byte[] canonicalPayload) {
          throw new AssertionError("sign must not run");
        }
      };
      var factory = factory(plugin, freeLoopbackPort(), policy);
      System.out.print(outcome(() -> factory.open(failingAccess)));
      return;
    }
    if (mode.equals("bind-retry")) {
      int port = freeLoopbackPort();
      var factory = factory(plugin, port, policy);
      String first;
      try (var occupied = bind(port)) {
        first = outcome(() -> factory.open(validAccess));
      }
      PaperBukkitOnlinePlayerAdapterLifecycle lifecycle = factory.open(validAccess);
      boolean exactPort = lifecycle.localPort() == port
          && lifecycle.localAddress().equals("127.0.0.1");
      lifecycle.close();
      boolean reusable;
      try (var rebound = bind(port)) {
        reusable = rebound.getLocalPort() == port;
      }
      System.out.print(first + "|" + exactPort + "|" + reusable + "|" + publicKeyReads.get());
      return;
    }
    throw new IllegalArgumentException("unknown mode");
  }

  private static PaperBukkitOnlinePlayerAdapterRuntimeFactory factory(
      Plugin plugin,
      int port,
      PaperBukkitOnlinePlayerRequestProcessor.Policy policy) {
    return new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
        plugin, port, 2_000, 2_000L, policy, System::currentTimeMillis,
        () -> System.nanoTime() / 1_000_000L);
  }

  private static String outcome(ThrowingAction action) {
    try {
      AutoCloseable runtime = action.run();
      if (runtime != null) {
        try {
          runtime.close();
        } catch (Exception ignored) {
        }
      }
      return "RETURNED";
    } catch (RuntimeException error) {
      return error.getClass().getSimpleName() + ":" + error.getMessage()
          + ":" + (error.getCause() == null);
    } catch (Exception error) {
      throw new AssertionError(error);
    }
  }

  private static int freeLoopbackPort() throws Exception {
    try (var socket = bind(0)) {
      return socket.getLocalPort();
    }
  }

  private static ServerSocket bind(int port) throws Exception {
    var socket = new ServerSocket();
    socket.setReuseAddress(false);
    socket.bind(new InetSocketAddress(
        InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), port), 1);
    return socket;
  }

  @FunctionalInterface
  private interface ThrowingAction {
    AutoCloseable run() throws Exception;
  }
}
