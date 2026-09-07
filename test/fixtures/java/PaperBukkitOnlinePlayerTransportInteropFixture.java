import java.nio.file.Files;
import java.nio.file.Path;
import vn.heomc.botchecker.paperadapter.CanonicalPaperBukkitOnlinePlayerPayload;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerTransportInteropFixture {
  private PaperBukkitOnlinePlayerTransportInteropFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 3) throw new IllegalArgumentException("expected request, signature and response");
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(Files.readAllBytes(Path.of(args[0])));
    var payload = new CanonicalPaperBukkitOnlinePlayerPayload.Fields(
        challenge.audience(), challenge.verifierInstanceId(), challenge.sequence(), challenge.challengeId(),
        challenge.nonceBase64Url(), challenge.runId(), challenge.keyId(), challenge.bindingId(),
        challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
        challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
        challenge.trustStoreSha256(), challenge.issuedAtMs(), challenge.expiresAtMs(),
        challenge.issuedAtMs() + 10L, "paper-server-a", "paper-boot-a", 0);
    byte[] canonical = CanonicalPaperBukkitOnlinePlayerPayload.canonicalUtf8(payload);
    byte[] signature = Files.readAllBytes(Path.of(args[1]));
    Files.write(Path.of(args[2]), PaperBukkitOnlinePlayerTransportCodec.encodeResponseFrame(canonical, signature));
  }
}
