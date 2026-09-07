import java.io.BufferedReader;
import java.io.InputStreamReader;
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
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerBukkitSnapshotAdapter;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerOpaqueEd25519Signer;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerAdapterLifecycleFixture {
  private PaperBukkitOnlinePlayerAdapterLifecycleFixture() {
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
        challenge.trustStoreSha256(), "paper-server-a", "paper-boot-a", 8);

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
    Bukkit.configure(scheduler, List.of(player, player, player));
    Thread primaryThread = Thread.ofPlatform().name("fake-paper-primary-lifecycle").start(() -> {
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
    var snapshot = new PaperBukkitOnlinePlayerBukkitSnapshotAdapter(plugin, 2_000L);
    var signer = new PaperBukkitOnlinePlayerOpaqueEd25519Signer(access, keyId);
    PaperBukkitOnlinePlayerAdapterLifecycle lifecycle = null;
    try {
      lifecycle = PaperBukkitOnlinePlayerAdapterLifecycle.bind(
          0, 2_000, policy, System::currentTimeMillis,
          () -> System.nanoTime() / 1_000_000L, snapshot, signer);
      System.out.println("READY " + lifecycle.localAddress() + " " + lifecycle.localPort());
      System.out.flush();
      if (!"CLOSE".equals(input.readLine())) throw new IllegalStateException("expected CLOSE");
    } finally {
      if (lifecycle != null) lifecycle.close();
      else {
        snapshot.close();
        signer.close();
      }
      primaryOpen.set(false);
      primaryThread.interrupt();
      primaryThread.join(5_000L);
    }
    System.out.println("CLOSED " + publicKeyReads.get() + " " + signatures.get() + " "
        + Bukkit.onlinePlayerReads() + " " + Bukkit.readWasPrimary());
    System.out.flush();
  }
}
