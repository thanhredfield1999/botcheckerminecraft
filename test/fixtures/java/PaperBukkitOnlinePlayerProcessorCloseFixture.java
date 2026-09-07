import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerProcessorCloseFixture {
  private PaperBukkitOnlinePlayerProcessorCloseFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 2) throw new IllegalArgumentException("expected request and output");
    byte[] request = Files.readAllBytes(Path.of(args[0]));
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(request);
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        challenge.audience(), challenge.verifierInstanceId(), challenge.keyId(), challenge.bindingId(),
        challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
        challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
        challenge.trustStoreSha256(), "paper-server-a", "paper-boot-a", 8);
    AtomicInteger snapshots = new AtomicInteger();
    AtomicInteger signatures = new AtomicInteger();
    AtomicReference<PaperBukkitOnlinePlayerRequestProcessor> reference = new AtomicReference<>();
    var processor = new PaperBukkitOnlinePlayerRequestProcessor(
        policy,
        () -> 10_010L,
        () -> 110L,
        ignored -> {
          snapshots.incrementAndGet();
          reference.get().close();
          return new PaperBukkitOnlinePlayerRequestProcessor.Snapshot(0, 10_010L);
        },
        canonicalPayload -> {
          signatures.incrementAndGet();
          return new byte[64];
        });
    reference.set(processor);
    String outcome;
    try {
      processor.process(request);
      outcome = "accepted";
    } catch (IllegalStateException error) {
      outcome = error.getMessage();
    }
    Files.writeString(Path.of(args[1]), outcome + " " + snapshots.get() + " " + signatures.get());
  }
}
