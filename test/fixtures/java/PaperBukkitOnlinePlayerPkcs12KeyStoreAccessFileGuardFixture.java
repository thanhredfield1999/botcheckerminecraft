package vn.heomc.botchecker.keystorecompanion;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicInteger;

public final class PaperBukkitOnlinePlayerPkcs12KeyStoreAccessFileGuardFixture {
  public static void main(String[] args) throws Exception {
    Path directory = Files.createTempDirectory("botchecker-pkcs12-file-guard-");
    Path missing = directory.resolve("missing.p12");
    Path oversized = directory.resolve("oversized.p12");
    Path target = directory.resolve("target.p12");
    Path symbolic = directory.resolve("symbolic.p12");
    Files.write(oversized, new byte[1024 * 1024 + 1]);
    Files.write(target, new byte[] {1, 2, 3});
    var reads = new AtomicInteger();
    PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.PasswordReader reader = ignored -> {
      reads.incrementAndGet();
      return new char[] {'n', 'o', 't', '-', 'u', 's', 'e', 'd'};
    };
    try {
      String missingOutcome = outcome(() -> PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
          missing, "botchecker-ed25519", "BOTCHECKER_KEYSTORE_PASSWORD", reader));
      String directoryOutcome = outcome(() -> PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
          directory, "botchecker-ed25519", "BOTCHECKER_KEYSTORE_PASSWORD", reader));
      String oversizedOutcome = outcome(() -> PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
          oversized, "botchecker-ed25519", "BOTCHECKER_KEYSTORE_PASSWORD", reader));

      String symbolicOutcome = "UNSUPPORTED";
      try {
        Files.createSymbolicLink(symbolic, target.getFileName());
        symbolicOutcome = outcome(() -> PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
            symbolic, "botchecker-ed25519", "BOTCHECKER_KEYSTORE_PASSWORD", reader));
      } catch (UnsupportedOperationException | java.nio.file.FileSystemException error) {
        symbolicOutcome = "UNSUPPORTED";
      }

      System.out.print(missingOutcome + ":" + directoryOutcome + ":" + oversizedOutcome
          + ":" + symbolicOutcome + ":" + reads.get());
    } finally {
      Files.deleteIfExists(symbolic);
      Files.deleteIfExists(target);
      Files.deleteIfExists(oversized);
      Files.deleteIfExists(directory);
    }
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
