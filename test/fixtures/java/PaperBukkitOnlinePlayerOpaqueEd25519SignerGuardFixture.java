import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.util.concurrent.atomic.AtomicInteger;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerOpaqueEd25519Signer;

public final class PaperBukkitOnlinePlayerOpaqueEd25519SignerGuardFixture {
  private PaperBukkitOnlinePlayerOpaqueEd25519SignerGuardFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 3) throw new IllegalArgumentException("expected mode, public key and key id");
    byte[] publicKey = Files.readAllBytes(Path.of(args[1]));
    AtomicInteger signatures = new AtomicInteger();
    var access = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        return publicKey.clone();
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        signatures.incrementAndGet();
        if (args[0].equals("callback-failure")) {
          throw new IllegalStateException("DO_NOT_EXPOSE_SIGN_DETAIL");
        }
        if (args[0].equals("key-substitution")) {
          try {
            var substitute = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
            Signature signer = Signature.getInstance("Ed25519");
            signer.initSign(substitute.getPrivate());
            signer.update(canonicalPayload);
            return signer.sign();
          } catch (Exception error) {
            throw new IllegalStateException("fixture signing failed");
          }
        }
        return new byte[64];
      }
    };
    try {
      String expectedKeyId = args[0].equals("key-mismatch") ? "0".repeat(64) : args[2];
      try (var signer = new PaperBukkitOnlinePlayerOpaqueEd25519Signer(access, expectedKeyId)) {
        signer.sign(new byte[] {1, 2, 3});
      }
      throw new AssertionError("operation should fail");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage() + "|" + (error.getCause() == null) + "|" + signatures.get());
    }
  }
}
