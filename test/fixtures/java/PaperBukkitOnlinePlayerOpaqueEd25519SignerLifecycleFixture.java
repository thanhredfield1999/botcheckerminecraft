import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.util.HexFormat;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerOpaqueEd25519Signer;

public final class PaperBukkitOnlinePlayerOpaqueEd25519SignerLifecycleFixture {
  private PaperBukkitOnlinePlayerOpaqueEd25519SignerLifecycleFixture() {
  }

  public static void main(String[] args) throws Exception {
    var keyPair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
    byte[] publicKey = keyPair.getPublic().getEncoded();
    String keyId = HexFormat.of().formatHex(
        MessageDigest.getInstance("SHA-256").digest(publicKey));
    CountDownLatch callbackStarted = new CountDownLatch(1);
    CountDownLatch releaseCallback = new CountDownLatch(1);
    AtomicInteger signatures = new AtomicInteger();
    var access = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return publicKey.clone();
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) throws Exception {
        signatures.incrementAndGet();
        callbackStarted.countDown();
        if (!releaseCallback.await(5, TimeUnit.SECONDS)) {
          throw new IllegalStateException("fixture timeout");
        }
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(keyPair.getPrivate());
        signer.update(canonicalPayload);
        return signer.sign();
      }
    };
    var signer = new PaperBukkitOnlinePlayerOpaqueEd25519Signer(access, keyId);
    AtomicReference<String> firstOutcome = new AtomicReference<>("RETURNED");
    Thread worker = Thread.ofPlatform().start(() -> {
      try {
        signer.sign(new byte[] {1, 2, 3});
      } catch (IllegalStateException error) {
        firstOutcome.set(error.getMessage());
      }
    });
    if (!callbackStarted.await(5, TimeUnit.SECONDS)) throw new AssertionError("callback did not start");
    String busyOutcome;
    try {
      signer.sign(new byte[] {4});
      busyOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      busyOutcome = error.getMessage();
    }
    long closeStarted = System.nanoTime();
    signer.close();
    long closeElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - closeStarted);
    String closedOutcome;
    try {
      signer.sign(new byte[] {5});
      closedOutcome = "RETURNED";
    } catch (IllegalStateException error) {
      closedOutcome = error.getMessage();
    }
    releaseCallback.countDown();
    worker.join(5_000L);
    if (worker.isAlive()) throw new AssertionError("worker did not stop");
    System.out.print(firstOutcome.get() + "|" + busyOutcome + "|" + closedOutcome
        + "|" + signatures.get() + "|" + closeElapsedMs);
  }
}
