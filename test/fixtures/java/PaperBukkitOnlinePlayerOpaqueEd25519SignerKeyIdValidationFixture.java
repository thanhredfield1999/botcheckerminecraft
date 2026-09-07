import java.util.concurrent.atomic.AtomicInteger;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerOpaqueEd25519Signer;

public final class PaperBukkitOnlinePlayerOpaqueEd25519SignerKeyIdValidationFixture {
  private PaperBukkitOnlinePlayerOpaqueEd25519SignerKeyIdValidationFixture() {
  }

  public static void main(String[] args) {
    AtomicInteger publicKeyReads = new AtomicInteger();
    var access = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        publicKeyReads.incrementAndGet();
        throw new AssertionError("public key access must not run");
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        throw new AssertionError("signing must not run");
      }
    };
    String upper = "A".repeat(64);
    String shortId = "a".repeat(63);
    System.out.print(outcome(access, upper) + "|" + outcome(access, shortId)
        + "|" + publicKeyReads.get());
  }

  private static String outcome(
      PaperBukkitOnlinePlayerExternalKeyStoreAccess access,
      String keyId) {
    try {
      new PaperBukkitOnlinePlayerOpaqueEd25519Signer(access, keyId);
      return "RETURNED";
    } catch (IllegalArgumentException error) {
      return error.getMessage() + ":" + (error.getCause() == null);
    }
  }
}
