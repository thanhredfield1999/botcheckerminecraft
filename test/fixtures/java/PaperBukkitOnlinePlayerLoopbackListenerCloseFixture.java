import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerLoopbackListener;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerLoopbackListenerCloseFixture {
  private PaperBukkitOnlinePlayerLoopbackListenerCloseFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("expected request fixture path");
    byte[] request = Files.readAllBytes(Path.of(args[0]));
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(request);
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        challenge.audience(), challenge.verifierInstanceId(), challenge.keyId(), challenge.bindingId(),
        challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
        challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
        challenge.trustStoreSha256(), "paper-server-a", "paper-boot-a", 8);
    CountDownLatch releaseSnapshot = new CountDownLatch(1);
    var processor = new PaperBukkitOnlinePlayerRequestProcessor(
        policy,
        () -> 10_010L,
        () -> 110L,
        ignored -> {
          System.out.println("SNAPSHOT_ENTERED");
          System.out.flush();
          if (!releaseSnapshot.await(5, TimeUnit.SECONDS)) {
            throw new IllegalStateException("snapshot release timed out");
          }
          return new PaperBukkitOnlinePlayerRequestProcessor.Snapshot(0, 10_010L);
        },
        ignored -> new byte[64]);
    var listener = PaperBukkitOnlinePlayerLoopbackListener.bind(0, 5_000, processor);
    try {
      System.out.println(listener.localAddress() + " " + listener.localPort());
      System.out.flush();
      String command = new BufferedReader(
          new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
      if (!"CLOSE".equals(command)) throw new IllegalStateException("expected CLOSE");
      long started = System.nanoTime();
      listener.close();
      long elapsedMs = TimeUnit.NANOSECONDS.toMillis(System.nanoTime() - started);
      System.out.println("CLOSED " + elapsedMs);
      System.out.flush();
    } finally {
      releaseSnapshot.countDown();
      listener.close();
    }
  }
}
