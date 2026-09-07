import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import org.bukkit.scheduler.BukkitTask;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerAdapterLifecycle;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerAdapterRuntimeFactory;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerAdapterRuntimeFactoryFixture {
  private PaperBukkitOnlinePlayerAdapterRuntimeFactoryFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 0) throw new IllegalArgumentException("fixture accepts no arguments");
    var keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
    byte[] publicKey = keyPair.getPublic().getEncoded();
    String keyId = HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(publicKey));
    AtomicInteger publicKeyReads = new AtomicInteger();
    AtomicInteger signatures = new AtomicInteger();
    var access = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        publicKeyReads.incrementAndGet();
        return publicKey.clone();
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) throws Exception {
        signatures.incrementAndGet();
        Signature signature = Signature.getInstance("Ed25519");
        signature.initSign(keyPair.getPrivate());
        signature.update(canonicalPayload);
        return signature.sign();
      }
    };
    System.out.println("PUBLIC " + Base64.getEncoder().encodeToString(publicKey) + " " + keyId);
    System.out.flush();

    BufferedReader input = new BufferedReader(
        new InputStreamReader(System.in, StandardCharsets.UTF_8));
    String requestLine = input.readLine();
    if (requestLine == null || !requestLine.startsWith("REQUEST ")) {
      throw new IllegalStateException("expected public request frame");
    }
    byte[] requestFrame = Base64.getUrlDecoder().decode(requestLine.substring("REQUEST ".length()));
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(requestFrame);
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        challenge.audience(), challenge.verifierInstanceId(), challenge.keyId(), challenge.bindingId(),
        challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
        challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
        challenge.trustStoreSha256(), "paper-server-factory", "paper-boot-factory", 8);

    BlockingQueue<Runnable> primaryTasks = new LinkedBlockingQueue<>();
    AtomicBoolean primaryOpen = new AtomicBoolean(true);
    BukkitScheduler scheduler = (owner, task) -> {
      AtomicBoolean cancelled = new AtomicBoolean();
      primaryTasks.add(() -> {
        if (!cancelled.get()) task.run();
      });
      return new BukkitTask() {
        @Override
        public void cancel() {
          cancelled.set(true);
        }
      };
    };
    Player player = new Player() {
    };
    Bukkit.configure(scheduler, List.of(player, player, player, player));
    Thread primaryThread = Thread.ofPlatform().name("fake-paper-primary-runtime-factory").start(() -> {
      while (primaryOpen.get()) {
        try {
          Runnable task = primaryTasks.take();
          Bukkit.enterPrimaryThread();
          try {
            task.run();
          } finally {
            Bukkit.leavePrimaryThread();
          }
        } catch (InterruptedException error) {
          Thread.currentThread().interrupt();
          return;
        }
      }
    });

    Plugin plugin = new Plugin() {
    };
    int port = freeLoopbackPort();
    var factory = new PaperBukkitOnlinePlayerAdapterRuntimeFactory(
        plugin, port, 2_000, 2_000L, policy, System::currentTimeMillis,
        () -> System.nanoTime() / 1_000_000L);
    PaperBukkitOnlinePlayerAdapterLifecycle lifecycle = null;
    try {
      lifecycle = factory.open(access);
      System.out.println("READY " + lifecycle.localAddress() + " " + lifecycle.localPort());
      System.out.flush();
      if (!"CLOSE".equals(input.readLine())) throw new IllegalStateException("expected CLOSE");
    } finally {
      if (lifecycle != null) lifecycle.close();
      primaryOpen.set(false);
      primaryThread.interrupt();
      primaryThread.join(5_000L);
    }
    System.out.println("CLOSED " + publicKeyReads.get() + " " + signatures.get() + " "
        + Bukkit.onlinePlayerReads() + " " + Bukkit.readWasPrimary());
    System.out.flush();
  }

  private static int freeLoopbackPort() throws Exception {
    try (var socket = new ServerSocket()) {
      socket.setReuseAddress(false);
      socket.bind(new InetSocketAddress(
          InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0), 1);
      return socket.getLocalPort();
    }
  }
}
