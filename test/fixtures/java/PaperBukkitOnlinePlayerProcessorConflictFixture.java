import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerProcessorConflictFixture {
  private PaperBukkitOnlinePlayerProcessorConflictFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 3) throw new IllegalArgumentException("expected two requests and outcome path");
    byte[] requestA = Files.readAllBytes(Path.of(args[0]));
    byte[] requestB = Files.readAllBytes(Path.of(args[1]));
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(requestA);
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        challenge.audience(), challenge.verifierInstanceId(), challenge.keyId(), challenge.bindingId(),
        challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
        challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
        challenge.trustStoreSha256(), "paper-server-a", "paper-boot-a", 8);
    AtomicInteger snapshots = new AtomicInteger();
    AtomicInteger signatures = new AtomicInteger();
    String outcome;
    try (var processor = new PaperBukkitOnlinePlayerRequestProcessor(
        policy,
        () -> 10_010L,
        () -> 110L,
        ignored -> {
          snapshots.incrementAndGet();
          return new PaperBukkitOnlinePlayerRequestProcessor.Snapshot(0, 10_010L);
        },
        ignored -> {
          signatures.incrementAndGet();
          return new byte[64];
        })) {
      processor.process(requestA);
      try {
        processor.process(requestB);
        outcome = "accepted";
      } catch (RuntimeException error) {
        outcome = error.getMessage();
      }
    }
    Files.writeString(Path.of(args[2]), outcome + " " + snapshots.get() + " " + signatures.get());
  }
}
