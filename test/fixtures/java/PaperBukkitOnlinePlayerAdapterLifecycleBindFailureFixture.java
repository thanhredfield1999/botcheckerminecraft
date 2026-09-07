import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import org.bukkit.Bukkit;
import org.bukkit.plugin.Plugin;
import org.bukkit.scheduler.BukkitScheduler;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerAdapterLifecycle;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerBukkitSnapshotAdapter;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerOpaqueEd25519Signer;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerAdapterLifecycleBindFailureFixture {
  private PaperBukkitOnlinePlayerAdapterLifecycleBindFailureFixture() {
  }

  public static void main(String[] args) throws Exception {
    AtomicInteger schedules = new AtomicInteger();
    AtomicInteger signatures = new AtomicInteger();
    BukkitScheduler scheduler = (owner, task) -> {
      schedules.incrementAndGet();
      throw new AssertionError("scheduler must not run after bind failure");
    };
    Bukkit.configure(scheduler, List.of());
    Plugin plugin = new Plugin() {
    };
    var snapshot = new PaperBukkitOnlinePlayerBukkitSnapshotAdapter(plugin, 2_000L);

    var keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
    byte[] publicKey = keyPair.getPublic().getEncoded();
    String keyId = HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(publicKey));
    var access = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return publicKey.clone();
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        signatures.incrementAndGet();
        throw new AssertionError("signer callback must not run after bind failure");
      }
    };
    var signer = new PaperBukkitOnlinePlayerOpaqueEd25519Signer(access, keyId);
    var challenge = new PaperBukkitOnlinePlayerTransportCodec.Challenge(
        "audience", "verifier", 1L, "challenge", "nonce", "run", keyId,
        "binding", "1".repeat(64), "provider", "1.0.0", "instance", "trust",
        "2026.09.01-1", "2".repeat(64), 1L, 10_000L);
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        challenge.audience(), challenge.verifierInstanceId(), challenge.keyId(), challenge.bindingId(),
        challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
        challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
        challenge.trustStoreSha256(), "paper-server-a", "paper-boot-a", 8);

    try (var occupied = new ServerSocket()) {
      occupied.setReuseAddress(false);
      occupied.bind(new InetSocketAddress(
          InetAddress.getByAddress(new byte[] {127, 0, 0, 1}), 0), 1);
      String bindOutcome;
      try {
        PaperBukkitOnlinePlayerAdapterLifecycle.bind(
            occupied.getLocalPort(), 2_000, policy, System::currentTimeMillis,
            () -> System.nanoTime() / 1_000_000L, snapshot, signer);
        bindOutcome = "RETURNED";
      } catch (IllegalStateException error) {
        bindOutcome = error.getMessage() + ":" + (error.getCause() == null);
      }
      String snapshotOutcome;
      try {
        snapshot.snapshot(challenge);
        snapshotOutcome = "RETURNED";
      } catch (IllegalStateException error) {
        snapshotOutcome = error.getMessage();
      }
      String signerOutcome;
      try {
        signer.sign(new byte[] {1});
        signerOutcome = "RETURNED";
      } catch (IllegalStateException error) {
        signerOutcome = error.getMessage();
      }
      System.out.print(bindOutcome + "|" + snapshotOutcome + "|" + signerOutcome
          + "|" + schedules.get() + "|" + signatures.get() + "|" + !occupied.isClosed());
    }
  }
}
