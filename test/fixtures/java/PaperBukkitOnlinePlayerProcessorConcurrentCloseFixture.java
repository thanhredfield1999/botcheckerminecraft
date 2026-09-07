import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerProcessorConcurrentCloseFixture {
  private PaperBukkitOnlinePlayerProcessorConcurrentCloseFixture() {
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
    CountDownLatch snapshotEntered = new CountDownLatch(1);
    CountDownLatch releaseSnapshot = new CountDownLatch(1);
    AtomicInteger signatures = new AtomicInteger();
    AtomicReference<String> outcome = new AtomicReference<>("missing");
    var processor = new PaperBukkitOnlinePlayerRequestProcessor(
        policy,
        () -> 10_010L,
        () -> 110L,
        ignored -> {
          snapshotEntered.countDown();
          if (!releaseSnapshot.await(5, TimeUnit.SECONDS)) {
            throw new IllegalStateException("snapshot release timed out");
          }
          return new PaperBukkitOnlinePlayerRequestProcessor.Snapshot(0, 10_010L);
        },
        canonicalPayload -> {
          signatures.incrementAndGet();
          return new byte[64];
        });
    Thread worker = Thread.ofPlatform().name("processor-fixture-worker").start(() -> {
      try {
        processor.process(request);
        outcome.set("accepted");
      } catch (IllegalStateException error) {
        outcome.set(error.getMessage());
      }
    });
    if (!snapshotEntered.await(5, TimeUnit.SECONDS)) {
      throw new IllegalStateException("snapshot was not entered");
    }
    long closeStarted = System.nanoTime();
    processor.close();
    long closeElapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - closeStarted);
    releaseSnapshot.countDown();
    worker.join(5_000L);
    if (worker.isAlive()) throw new IllegalStateException("worker did not stop");
    Files.writeString(Path.of(args[1]), outcome.get() + " " + signatures.get() + " " + closeElapsedMs);
  }
}
