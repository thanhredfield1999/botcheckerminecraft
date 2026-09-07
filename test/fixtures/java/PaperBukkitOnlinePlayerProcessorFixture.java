import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyFactory;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.concurrent.atomic.AtomicInteger;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerProcessorFixture {
  private PaperBukkitOnlinePlayerProcessorFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 5) throw new IllegalArgumentException("expected request, private key, two responses and counters");
    byte[] request = Files.readAllBytes(Path.of(args[0]));
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(request);
    var privateKey = KeyFactory.getInstance("Ed25519").generatePrivate(
        new PKCS8EncodedKeySpec(Files.readAllBytes(Path.of(args[1]))));
    AtomicInteger snapshots = new AtomicInteger();
    AtomicInteger signatures = new AtomicInteger();
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        challenge.audience(), challenge.verifierInstanceId(), challenge.keyId(), challenge.bindingId(),
        challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
        challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
        challenge.trustStoreSha256(), "paper-server-a", "paper-boot-a", 8);
    try (var processor = new PaperBukkitOnlinePlayerRequestProcessor(
        policy,
        () -> 10_010L,
        () -> 110L,
        ignored -> {
          snapshots.incrementAndGet();
          return new PaperBukkitOnlinePlayerRequestProcessor.Snapshot(0, 10_010L);
        },
        canonicalPayload -> {
          signatures.incrementAndGet();
          Signature signer = Signature.getInstance("Ed25519");
          signer.initSign(privateKey);
          signer.update(canonicalPayload);
          return signer.sign();
        })) {
      Files.write(Path.of(args[2]), processor.process(request));
      Files.write(Path.of(args[3]), processor.process(request));
      Files.writeString(Path.of(args[4]), snapshots.get() + " " + signatures.get());
    }
  }
}
