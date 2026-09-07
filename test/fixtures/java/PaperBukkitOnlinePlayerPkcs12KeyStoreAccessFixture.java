package vn.heomc.botchecker.keystorecompanion;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.KeyStore;
import java.security.SecureRandom;
import java.security.Signature;
import java.security.cert.Certificate;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Arrays;

public final class PaperBukkitOnlinePlayerPkcs12KeyStoreAccessFixture {
  private static final SecureRandom RANDOM = new SecureRandom();

  public static void main(String[] args) throws Exception {
    if (args.length == 1 && "mismatch".equals(args[0])) {
      runMismatchedKeyAndCertificate();
      return;
    }
    Path directory = Files.createTempDirectory("botchecker-pkcs12-access-");
    Path keyStorePath = directory.resolve("fixture.p12");
    char[] password = randomPassword();
    byte[] encodedStore = null;
    byte[] payload = new byte[256];
    RANDOM.nextBytes(payload);
    try {
      KeyPair pair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
      X509Certificate certificate = selfSigned(pair);
      KeyStore store = KeyStore.getInstance("PKCS12");
      store.load(null, password);
      store.setKeyEntry("botchecker-ed25519", pair.getPrivate(), password,
          new Certificate[] {certificate});
      var output = new ByteArrayOutputStream();
      store.store(output, password);
      encodedStore = output.toByteArray();
      Files.write(keyStorePath, encodedStore);

      char[] issuedPassword = Arrays.copyOf(password, password.length);
      var access = PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
          keyStorePath,
          "botchecker-ed25519",
          "BOTCHECKER_KEYSTORE_PASSWORD",
          ignored -> issuedPassword);

      byte[] expectedSpki = pair.getPublic().getEncoded();
      byte[] firstSpki = access.publicKeySpkiDer();
      boolean publicKeyMatched = Arrays.equals(expectedSpki, firstSpki);
      firstSpki[0] ^= 0x01;
      boolean publicKeyCopied = Arrays.equals(expectedSpki, access.publicKeySpkiDer());

      byte[] signature = access.signEd25519(payload);
      Signature verifier = Signature.getInstance("Ed25519");
      verifier.initVerify(pair.getPublic());
      verifier.update(payload);
      boolean signatureValid = verifier.verify(signature);
      boolean passwordCleared = allZero(issuedPassword);

      access.close();
      boolean closedPublic = outcome(access::publicKeySpkiDer)
          .equals("PAPER_BUKKIT_KEYSTORE_ACCESS_CLOSED");
      boolean closedSign = outcome(() -> access.signEd25519(payload))
          .equals("PAPER_BUKKIT_KEYSTORE_ACCESS_CLOSED");

      System.out.print(publicKeyMatched + ":" + publicKeyCopied + ":" + signatureValid
          + ":" + passwordCleared + ":" + closedPublic + ":" + closedSign);
    } finally {
      Arrays.fill(password, '\0');
      Arrays.fill(payload, (byte) 0);
      if (encodedStore != null) Arrays.fill(encodedStore, (byte) 0);
      Files.deleteIfExists(keyStorePath);
      Files.deleteIfExists(directory);
    }
  }

  private static void runMismatchedKeyAndCertificate() throws Exception {
    Path directory = Files.createTempDirectory("botchecker-pkcs12-mismatch-");
    Path keyStorePath = directory.resolve("fixture.p12");
    char[] password = randomPassword();
    byte[] encodedStore = null;
    try {
      KeyPair privatePair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
      KeyPair certificatePair = KeyPairGenerator.getInstance("Ed25519").generateKeyPair();
      X509Certificate mismatchedCertificate = selfSigned(certificatePair);
      KeyStore store = KeyStore.getInstance("PKCS12");
      store.load(null, password);
      store.setKeyEntry("botchecker-ed25519", privatePair.getPrivate(), password,
          new Certificate[] {mismatchedCertificate});
      var output = new ByteArrayOutputStream();
      store.store(output, password);
      encodedStore = output.toByteArray();
      Files.write(keyStorePath, encodedStore);

      char[] issuedPassword = Arrays.copyOf(password, password.length);
      String result = outcome(() -> {
        var access = PaperBukkitOnlinePlayerPkcs12KeyStoreAccess.open(
            keyStorePath,
            "botchecker-ed25519",
            "BOTCHECKER_KEYSTORE_PASSWORD",
            ignored -> issuedPassword);
        access.close();
        return null;
      });
      System.out.print(result + ":" + allZero(issuedPassword));
    } finally {
      Arrays.fill(password, '\0');
      if (encodedStore != null) Arrays.fill(encodedStore, (byte) 0);
      Files.deleteIfExists(keyStorePath);
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

  private static boolean allZero(char[] value) {
    for (char item : value) if (item != '\0') return false;
    return true;
  }

  private static char[] randomPassword() {
    char[] value = new char[48];
    for (int index = 0; index < value.length; index++) {
      value[index] = (char) ('!' + RANDOM.nextInt(94));
    }
    return value;
  }

  private static X509Certificate selfSigned(KeyPair pair) throws Exception {
    byte[] algorithm = sequence(oid(0x2b, 0x65, 0x70));
    byte[] name = sequence(set(sequence(oid(0x55, 0x04, 0x03),
        tagged(0x0c, "BotChecker Fixture".getBytes(java.nio.charset.StandardCharsets.UTF_8)))));
    byte[] validity = sequence(
        tagged(0x17, "250101000000Z".getBytes(java.nio.charset.StandardCharsets.US_ASCII)),
        tagged(0x17, "491231235959Z".getBytes(java.nio.charset.StandardCharsets.US_ASCII)));
    byte[] tbs = sequence(
        tagged(0xa0, integer(BigInteger.valueOf(2))),
        integer(BigInteger.ONE),
        algorithm,
        name,
        validity,
        name,
        pair.getPublic().getEncoded());
    Signature signer = Signature.getInstance("Ed25519");
    signer.initSign(pair.getPrivate());
    signer.update(tbs);
    byte[] signed = signer.sign();
    byte[] bitString = new byte[signed.length + 1];
    System.arraycopy(signed, 0, bitString, 1, signed.length);
    byte[] encoded = sequence(tbs, algorithm, tagged(0x03, bitString));
    X509Certificate certificate = (X509Certificate) CertificateFactory.getInstance("X.509")
        .generateCertificate(new ByteArrayInputStream(encoded));
    certificate.verify(pair.getPublic());
    Arrays.fill(signed, (byte) 0);
    Arrays.fill(bitString, (byte) 0);
    return certificate;
  }

  private static byte[] integer(BigInteger value) {
    return tagged(0x02, value.toByteArray());
  }

  private static byte[] oid(int... bytes) {
    byte[] value = new byte[bytes.length];
    for (int index = 0; index < bytes.length; index++) value[index] = (byte) bytes[index];
    return tagged(0x06, value);
  }

  private static byte[] sequence(byte[]... values) {
    return tagged(0x30, concatenate(values));
  }

  private static byte[] set(byte[]... values) {
    return tagged(0x31, concatenate(values));
  }

  private static byte[] concatenate(byte[]... values) {
    int size = 0;
    for (byte[] value : values) size += value.length;
    byte[] output = new byte[size];
    int offset = 0;
    for (byte[] value : values) {
      System.arraycopy(value, 0, output, offset, value.length);
      offset += value.length;
    }
    return output;
  }

  private static byte[] tagged(int tag, byte[] content) {
    byte[] length = length(content.length);
    byte[] output = new byte[1 + length.length + content.length];
    output[0] = (byte) tag;
    System.arraycopy(length, 0, output, 1, length.length);
    System.arraycopy(content, 0, output, 1 + length.length, content.length);
    return output;
  }

  private static byte[] length(int value) {
    if (value < 0x80) return new byte[] {(byte) value};
    if (value <= 0xff) return new byte[] {(byte) 0x81, (byte) value};
    return new byte[] {(byte) 0x82, (byte) (value >>> 8), (byte) value};
  }

  @FunctionalInterface
  private interface CheckedCall {
    Object run() throws Exception;
  }
}
