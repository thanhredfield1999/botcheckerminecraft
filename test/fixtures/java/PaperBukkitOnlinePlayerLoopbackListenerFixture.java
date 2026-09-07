import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerLoopbackListener;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerRequestProcessor;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerTransportCodec;

public final class PaperBukkitOnlinePlayerLoopbackListenerFixture {
  private PaperBukkitOnlinePlayerLoopbackListenerFixture() {
  }

  public static void main(String[] args) throws Exception {
    if (args.length != 1) throw new IllegalArgumentException("expected request fixture path");
    byte[] expectedRequest = Files.readAllBytes(Path.of(args[0]));
    var challenge = PaperBukkitOnlinePlayerTransportCodec.decodeRequestFrame(expectedRequest);
    var policy = new PaperBukkitOnlinePlayerRequestProcessor.Policy(
        challenge.audience(), challenge.verifierInstanceId(), challenge.keyId(), challenge.bindingId(),
        challenge.targetBindingSha256(), challenge.providerId(), challenge.providerVersion(),
        challenge.providerInstanceId(), challenge.trustStoreId(), challenge.trustStoreVersion(),
        challenge.trustStoreSha256(), "paper-server-a", "paper-boot-a", 8);
    var processor = new PaperBukkitOnlinePlayerRequestProcessor(
        policy,
        () -> 10_010L,
        () -> 110L,
        ignored -> new PaperBukkitOnlinePlayerRequestProcessor.Snapshot(0, 10_010L),
        ignored -> new byte[64]);
    try (var listener = PaperBukkitOnlinePlayerLoopbackListener.bind(0, 2_000, processor)) {
      System.out.println(listener.localAddress() + " " + listener.localPort());
      System.out.flush();
      new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8)).readLine();
    }
  }
}
