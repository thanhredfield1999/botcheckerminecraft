package vn.heomc.botchecker.paperadapter;

import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PublicKey;
import java.security.Signature;
import java.security.spec.X509EncodedKeySpec;
import java.util.Arrays;
import java.util.HexFormat;
import java.util.Objects;

/**
 * Ed25519 signer that delegates private-key operations to operator-owned opaque access.
 * This class never receives private-key bytes, KeyStore paths, aliases or credentials.
 */
public final class PaperBukkitOnlinePlayerOpaqueEd25519Signer
    implements PaperBukkitOnlinePlayerRequestProcessor.OpaqueSigner, AutoCloseable {
  private static final int ED25519_SPKI_BYTES = 44;
  private static final int ED25519_SIGNATURE_BYTES = 64;
  private static final int MAX_PAYLOAD_BYTES = 16 * 1024;
  private static final String KEY_ID_PATTERN = "[a-f0-9]{64}";

  private final Object stateLock = new Object();
  private final PaperBukkitOnlinePlayerExternalKeyStoreAccess access;
  private final PublicKey publicKey;
  private boolean open = true;
  private boolean signing;

  public PaperBukkitOnlinePlayerOpaqueEd25519Signer(
      PaperBukkitOnlinePlayerExternalKeyStoreAccess access,
      String expectedKeyId) {
    this.access = Objects.requireNonNull(access, "access");
    if (expectedKeyId == null || !expectedKeyId.matches(KEY_ID_PATTERN)) {
      throw new IllegalArgumentException("PAPER_BUKKIT_SIGNER_KEY_ID_INVALID");
    }
    byte[] rawSpki;
    try {
      rawSpki = access.publicKeySpkiDer();
    } catch (Exception error) {
      throw new IllegalStateException("PAPER_BUKKIT_SIGNER_INITIALIZATION_FAILED");
    }
    try {
      byte[] spki = ownedSpki(rawSpki);
      PublicKey candidate = KeyFactory.getInstance("Ed25519")
          .generatePublic(new X509EncodedKeySpec(spki));
      if (!Arrays.equals(candidate.getEncoded(), spki)
          || !expectedKeyId.equals(hexSha256(spki))) {
        throw new IllegalStateException("PAPER_BUKKIT_SIGNER_KEY_MISMATCH");
      }
      this.publicKey = candidate;
    } catch (IllegalStateException error) {
      throw error;
    } catch (Exception error) {
      throw new IllegalStateException("PAPER_BUKKIT_SIGNER_INITIALIZATION_FAILED");
    }
  }

  @Override
  public byte[] sign(byte[] canonicalPayload) {
    byte[] payload = ownedPayload(canonicalPayload);
    synchronized (stateLock) {
      requireOpen();
      if (signing) throw new IllegalStateException("PAPER_BUKKIT_SIGNER_BUSY");
      signing = true;
    }
    try {
      byte[] rawSignature;
      try {
        rawSignature = access.signEd25519(Arrays.copyOf(payload, payload.length));
      } catch (Exception error) {
        throw new IllegalStateException("PAPER_BUKKIT_SIGNING_FAILED");
      }
      byte[] signature = ownedSignature(rawSignature);
      if (!verify(payload, signature)) {
        throw new IllegalStateException("PAPER_BUKKIT_SIGNATURE_INVALID");
      }
      synchronized (stateLock) {
        requireOpen();
        return Arrays.copyOf(signature, signature.length);
      }
    } finally {
      synchronized (stateLock) {
        signing = false;
      }
    }
  }

  @Override
  public void close() {
    synchronized (stateLock) {
      open = false;
    }
  }

  private boolean verify(byte[] payload, byte[] signature) {
    try {
      Signature verifier = Signature.getInstance("Ed25519");
      verifier.initVerify(publicKey);
      verifier.update(payload);
      return verifier.verify(signature);
    } catch (Exception error) {
      throw new IllegalStateException("PAPER_BUKKIT_SIGNATURE_VERIFICATION_FAILED");
    }
  }

  private void requireOpen() {
    if (!open) throw new IllegalStateException("PAPER_BUKKIT_SIGNER_CLOSED");
  }

  private static byte[] ownedSpki(byte[] input) {
    if (input == null || input.length != ED25519_SPKI_BYTES) {
      throw new IllegalStateException("PAPER_BUKKIT_SIGNER_PUBLIC_KEY_INVALID");
    }
    return Arrays.copyOf(input, input.length);
  }

  private static byte[] ownedPayload(byte[] input) {
    if (input == null || input.length == 0 || input.length > MAX_PAYLOAD_BYTES) {
      throw new IllegalArgumentException("PAPER_BUKKIT_SIGNER_PAYLOAD_INVALID");
    }
    return Arrays.copyOf(input, input.length);
  }

  private static byte[] ownedSignature(byte[] input) {
    if (input == null || input.length != ED25519_SIGNATURE_BYTES) {
      throw new IllegalStateException("PAPER_BUKKIT_SIGNATURE_INVALID");
    }
    return Arrays.copyOf(input, input.length);
  }

  private static String hexSha256(byte[] input) {
    try {
      byte[] digest = MessageDigest.getInstance("SHA-256").digest(input);
      return HexFormat.of().formatHex(digest);
    } catch (Exception error) {
      throw new IllegalStateException("PAPER_BUKKIT_SHA256_UNAVAILABLE");
    }
  }
}
