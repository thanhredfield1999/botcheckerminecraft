package vn.heomc.botchecker.paperadapter;

/**
 * Operator-owned opaque access to one externally provisioned Ed25519 KeyStore entry.
 * Implementations retain all private-key, alias, path and credential custody.
 */
public interface PaperBukkitOnlinePlayerExternalKeyStoreAccess {
  byte[] publicKeySpkiDer() throws Exception;

  byte[] signEd25519(byte[] canonicalPayload) throws Exception;
}
