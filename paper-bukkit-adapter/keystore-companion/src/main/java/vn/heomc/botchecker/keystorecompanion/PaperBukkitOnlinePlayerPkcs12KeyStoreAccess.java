package vn.heomc.botchecker.keystorecompanion;

import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.Key;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.interfaces.EdECPrivateKey;
import java.security.interfaces.EdECPublicKey;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import vn.heomc.botchecker.paperadapter.PaperBukkitOnlinePlayerExternalKeyStoreAccess;

/** PKCS12-backed Ed25519 custody provider for the companion plugin. */
public final class PaperBukkitOnlinePlayerPkcs12KeyStoreAccess
    implements PaperBukkitOnlinePlayerExternalKeyStoreAccess, AutoCloseable {
  private static final int MAX_PAYLOAD_BYTES = 16 * 1024;
  private static final int ED25519_SIGNATURE_BYTES = 64;
  private static final int ED25519_SPKI_BYTES = 44;
  private static final int MAX_PATH_CHARACTERS = 1_024;
  private static final int MAX_KEYSTORE_BYTES = 1024 * 1024;
  private static final String SAFE_ALIAS = "[A-Za-z0-9][A-Za-z0-9._:-]{0,127}";
  private static final String SAFE_ENVIRONMENT_NAME = "[A-Za-z_][A-Za-z0-9_]{0,127}";

  @FunctionalInterface
  public interface PasswordReader {
    char[] read(String environmentVariableName) throws Exception;
  }

  private final Object stateLock = new Object();
  private PrivateKey privateKey;
  private byte[] publicKeySpkiDer;
  private boolean open = true;
  private boolean signing;

  private PaperBukkitOnlinePlayerPkcs12KeyStoreAccess(
      PrivateKey privateKey,
      byte[] publicKeySpkiDer) {
    this.privateKey = privateKey;
    this.publicKeySpkiDer = Arrays.copyOf(publicKeySpkiDer, publicKeySpkiDer.length);
  }

  public static PaperBukkitOnlinePlayerPkcs12KeyStoreAccess open(
      Path keyStorePath,
      String alias,
      String passwordEnvironmentVariable,
      PasswordReader passwordReader) {
    requireValidOptions(keyStorePath, alias, passwordEnvironmentVariable, passwordReader);
    byte[] keyStoreBytes = null;
    char[] password = null;
    try {
      keyStoreBytes = readBoundedRegularFile(keyStorePath);
      password = passwordReader.read(passwordEnvironmentVariable);
      if (password == null || password.length == 0) throw new IllegalArgumentException();

      KeyStore keyStore = KeyStore.getInstance("PKCS12");
      try (var input = new ByteArrayInputStream(keyStoreBytes)) {
        keyStore.load(input, password);
      }
      Key key = keyStore.getKey(alias, password);
      Certificate certificate = keyStore.getCertificate(alias);
      if (!(key instanceof EdECPrivateKey privateKey)
          || certificate == null
          || !(certificate.getPublicKey() instanceof EdECPublicKey publicKey)) {
        throw new IllegalArgumentException();
      }
      byte[] spki = publicKey.getEncoded();
      if (spki == null || spki.length != ED25519_SPKI_BYTES) {
        throw new IllegalArgumentException();
      }
      requireMatchingKeyPair(privateKey, publicKey);
      try {
        return new PaperBukkitOnlinePlayerPkcs12KeyStoreAccess(privateKey, spki);
      } finally {
        Arrays.fill(spki, (byte) 0);
      }
    } catch (Throwable error) {
      throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_OPEN_FAILED");
    } finally {
      if (password != null) Arrays.fill(password, '\0');
      if (keyStoreBytes != null) Arrays.fill(keyStoreBytes, (byte) 0);
    }
  }

  @Override
  public byte[] publicKeySpkiDer() {
    synchronized (stateLock) {
      requireOpen();
      return Arrays.copyOf(publicKeySpkiDer, publicKeySpkiDer.length);
    }
  }

  @Override
  public byte[] signEd25519(byte[] canonicalPayload) {
    byte[] payload = ownedPayload(canonicalPayload);
    PrivateKey key;
    synchronized (stateLock) {
      requireOpen();
      if (signing) throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_BUSY");
      signing = true;
      key = privateKey;
    }
    byte[] signature = null;
    try {
      Signature signer = Signature.getInstance("Ed25519");
      signer.initSign(key);
      signer.update(payload);
      signature = signer.sign();
      if (signature.length != ED25519_SIGNATURE_BYTES) throw new IllegalStateException();
      synchronized (stateLock) {
        requireOpen();
        return Arrays.copyOf(signature, signature.length);
      }
    } catch (IllegalStateException error) {
      if ("PAPER_BUKKIT_KEYSTORE_ACCESS_CLOSED".equals(error.getMessage())) throw error;
      throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_SIGN_FAILED");
    } catch (Throwable error) {
      throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_SIGN_FAILED");
    } finally {
      Arrays.fill(payload, (byte) 0);
      if (signature != null) Arrays.fill(signature, (byte) 0);
      synchronized (stateLock) {
        signing = false;
        stateLock.notifyAll();
      }
    }
  }

  @Override
  public void close() {
    synchronized (stateLock) {
      if (!open) return;
      open = false;
      privateKey = null;
      Arrays.fill(publicKeySpkiDer, (byte) 0);
      publicKeySpkiDer = new byte[0];
    }
  }

  private void requireOpen() {
    if (!open) throw new IllegalStateException("PAPER_BUKKIT_KEYSTORE_ACCESS_CLOSED");
  }

  private static void requireValidOptions(
      Path keyStorePath,
      String alias,
      String passwordEnvironmentVariable,
      PasswordReader passwordReader) {
    if (keyStorePath == null
        || alias == null
        || passwordEnvironmentVariable == null
        || passwordReader == null
        || !keyStorePath.isAbsolute()
        || !keyStorePath.normalize().equals(keyStorePath)
        || keyStorePath.toString().length() > MAX_PATH_CHARACTERS
        || !alias.matches(SAFE_ALIAS)
        || !passwordEnvironmentVariable.matches(SAFE_ENVIRONMENT_NAME)) {
      throw new IllegalArgumentException("PAPER_BUKKIT_KEYSTORE_ACCESS_OPTIONS_INVALID");
    }
  }

  private static void requireMatchingKeyPair(
      PrivateKey privateKey,
      EdECPublicKey publicKey) throws Exception {
    byte[] probe = "botchecker-paper-bukkit-keystore-keypair-v1"
        .getBytes(StandardCharsets.US_ASCII);
    byte[] signature = null;
    try {
      Signature signer = Signature.getInstance("Ed25519");
      signer.initSign(privateKey);
      signer.update(probe);
      signature = signer.sign();
      Signature verifier = Signature.getInstance("Ed25519");
      verifier.initVerify(publicKey);
      verifier.update(probe);
      if (signature.length != ED25519_SIGNATURE_BYTES || !verifier.verify(signature)) {
        throw new IllegalArgumentException();
      }
    } finally {
      Arrays.fill(probe, (byte) 0);
      if (signature != null) Arrays.fill(signature, (byte) 0);
    }
  }

  private static byte[] readBoundedRegularFile(Path path) throws Exception {
    BasicFileAttributes before = Files.readAttributes(
        path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
    if (!before.isRegularFile()
        || before.isSymbolicLink()
        || before.size() < 1
        || before.size() > MAX_KEYSTORE_BYTES) {
      throw new IllegalArgumentException();
    }
    byte[] bytes;
    try (var input = Files.newInputStream(
        path, StandardOpenOption.READ, LinkOption.NOFOLLOW_LINKS)) {
      bytes = input.readNBytes(MAX_KEYSTORE_BYTES + 1);
    }
    BasicFileAttributes after = Files.readAttributes(
        path, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
    if (!after.isRegularFile()
        || after.isSymbolicLink()
        || bytes.length < 1
        || bytes.length > MAX_KEYSTORE_BYTES
        || before.size() != bytes.length
        || after.size() != bytes.length
        || !before.lastModifiedTime().equals(after.lastModifiedTime())
        || !java.util.Objects.equals(before.fileKey(), after.fileKey())) {
      Arrays.fill(bytes, (byte) 0);
      throw new IllegalArgumentException();
    }
    return bytes;
  }

  private static byte[] ownedPayload(byte[] input) {
    if (input == null || input.length == 0 || input.length > MAX_PAYLOAD_BYTES) {
      throw new IllegalArgumentException("PAPER_BUKKIT_KEYSTORE_ACCESS_PAYLOAD_INVALID");
    }
    return Arrays.copyOf(input, input.length);
  }
}
