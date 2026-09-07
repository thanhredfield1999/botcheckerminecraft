import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPairGenerator;
import java.security.MessageDigest;
import java.security.Signature;
import java.util.HexFormat;
import java.util.concurrent.atomic.AtomicInteger;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerOpaqueEd25519Signer;

public final class PaperBukkitOnlinePlayerOpaqueEd25519SignerFixture {
  private PaperBukkitOnlinePlayerOpaqueEd25519SignerFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 4) {
      throw new IllegalArgumentException("expected payload, public key output, signature and counters");
    }
    byte[] payload = Files.readAllBytes(Path.of(args[0]));
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
        Signature signer = Signature.getInstance("Ed25519");
        signer.initSign(keyPair.getPrivate());
        signer.update(canonicalPayload);
        return signer.sign();
      }
    };
    Files.write(Path.of(args[1]), publicKey);
    try (var signer = new PaperBukkitOnlinePlayerOpaqueEd25519Signer(access, keyId)) {
      Files.write(Path.of(args[2]), signer.sign(payload));
    }
    Files.writeString(Path.of(args[3]), publicKeyReads.get() + " " + signatures.get());
  }
}
