package vn.heomc.botchecker.keystorecompanion;

import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;

public final class PaperBukkitOnlinePlayerPkcs12KeyStoreAccessOptionsFixture {
  public static void main(String[] args) {
    var reads = new AtomicInteger();
    PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.PasswordReader reader = ignored -> {
      reads.incrementAndGet();
      return new char[] {'n', 'o', 't', '-', 'u', 's', 'e', 'd'};
    };

    String outcomes = String.join(":",
        outcome(() -> PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
            Path.of("relative.p12"), "botchecker-ed25519", "BOTCHECKER_KEYSTORE_PASSWORD", reader)),
        outcome(() -> PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
            Path.of("C:/fixture.p12"), "../alias", "BOTCHECKER_KEYSTORE_PASSWORD", reader)),
        outcome(() -> PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
            Path.of("C:/fixture.p12"), "botchecker-ed25519", "bad-env-name", reader)));

    System.out.print(outcomes + ":" + reads.get());
  }

  private static String outcome(CheckedCall call) {
    try {
      call.run();
      return "RETURNED";
    } catch (Exception error) {
      return error.getMessage();
    }
  }

  @FunctionalInterface
  private interface CheckedCall {
    Object run() throws Exception;
  }
}
