import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerOpaqueEd25519Signer;

public final class PaperBukkitOnlinePlayerOpaqueEd25519SignerInitializationFailureFixture {
  private PaperBukkitOnlinePlayerOpaqueEd25519SignerInitializationFailureFixture() {
  }

  public static void main(String[] args) {
    var access = new PaperBukkitOnlinePlayerExternalKeyStoreAccess() {
      @Override
      public byte[] publicKeySpkiDer() {
        throw new IllegalStateException("DO_NOT_EXPOSE_ACCESS_DETAIL");
      }

      @Override
      public byte[] signEd25519(byte[] canonicalPayload) {
        throw new AssertionError("signing must not run");
      }
    };
    try {
      new PaperBukkitOnlinePlayerOpaqueEd25519Signer(access, "0".repeat(64));
      throw new AssertionError("constructor should fail");
    } catch (IllegalStateException error) {
      System.out.print(error.getMessage() + "|" + (error.getCause() == null));
    }
  }
}
